#!/usr/bin/env python3
"""Development-only, original-speed conversational voice auditions.

Uses cached MLX models on Apple Silicon; nothing here is bundled into the app.
Each persona gets independent praise and taunt takes, plus an unhurried preview.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import time
import wave

ROOT = Path(__file__).resolve().parent.parent
SETTINGS = json.loads(Path(__file__).with_name('combat-voice-natural.json').read_text())
MODELS = {
    'qwen': 'mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-4bit',
    'voxcpm': 'mlx-community/VoxCPM2-8bit',
}


def write_wav(samples, rate):
    import numpy as np
    data = io.BytesIO()
    with wave.open(data, 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(rate)
        output.writeframes((np.clip(samples, -1, 1)*32767).astype('<i2').tobytes())
    return data.getvalue()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backend', choices=MODELS, required=True)
    parser.add_argument('--local-model', help='A prepared local snapshot of the backend model')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--ffmpeg', default='/opt/homebrew/bin/ffmpeg')
    parser.add_argument('--styles', nargs='+')
    parser.add_argument('--kinds', nargs='+', choices=['reference', 'praise', 'taunt'],
                        help='Generate only selected kinds, preserving accepted takes')
    parser.add_argument('--variant', help='A named candidate voice under each selected persona')
    parser.add_argument('--seed-offset', type=int, default=0)
    parser.add_argument('--temperature', type=float, default=0.9)
    args = parser.parse_args()
    import mlx.core as mx
    import numpy as np
    from mlx_audio.tts.utils import load_model
    output = args.output or ROOT/'output'/'voice-optimization'/'natural-v2'/args.backend
    output.mkdir(parents=True, exist_ok=True)
    if args.styles and set(args.styles)-SETTINGS['profiles'].keys():
        parser.error('Unknown persona')
    model_name = MODELS[args.backend]
    path = output/'manifest.json'
    manifest = json.loads(path.read_text()) if path.exists() else {'clips': []}
    manifest.update({'model': model_name, 'settingsVersion': SETTINGS['version'],
                     'processing': 'Original speed; loudness normalization only.', 'tempo': 1})
    if args.variant:
        manifest['variant'] = args.variant
    if args.local_model and re.fullmatch(r'[0-9a-f]{40}', Path(args.local_model).name):
        manifest['modelRevision'] = Path(args.local_model).name
    clips = {clip['id']: clip for clip in manifest['clips']}
    model = load_model(args.local_model or model_name)
    for role_index, (style, base_role) in enumerate(SETTINGS['profiles'].items(), 1):
        if args.styles and style not in args.styles:
            continue
        role = base_role
        if args.variant:
            candidate = role.get('variants', {}).get(args.variant)
            if not candidate:
                parser.error(f'No variant {args.variant} for {style}; select --styles explicitly')
            role = {**role, **candidate}
        kinds = ['reference', 'praise', 'taunt'] if role.get('reference') else ['praise', 'taunt']
        for kind in kinds:
            if args.kinds and kind not in args.kinds:
                continue
            key = f'{style}-{kind}'
            instruction = role.get(kind+'Instruction', role['voice']+SETTINGS['common']+SETTINGS.get(kind, ''))
            characters = len(re.findall(r'[\u4e00-\u9fff]', role[kind]))
            minimum_pace = role.get('minimumCharactersPerSecond', 2.7)
            maximum_duration = 12 if kind == 'reference' else 9
            seed = 29000+role_index*100+{'praise': 0, 'taunt': 10, 'reference': 20}[kind]+args.seed_offset
            options = {'temperature': args.temperature, 'top_k': 50, 'top_p': 1.0,
                       'repetition_penalty': 1.05} if args.backend == 'qwen' else {
                           'inference_timesteps': 20, 'cfg_value': 2.0, 'warmup_patches': 0}
            reference = None
            reference_hash = None
            if args.backend == 'voxcpm' and ((kind != 'reference' and role.get('reference')) or kind == 'taunt'):
                # Reuse a same-persona reference, including an accepted taunt
                # when only its companion praise needs a new take.
                anchor_kind = role.get(kind+'ReferenceKind', 'reference' if role.get('reference') else 'praise')
                if anchor_kind == kind:
                    parser.error(f'{style}/{kind} cannot use itself as its reference')
                anchor = clips[f'{style}-{anchor_kind}']
                reference = output/Path(anchor['file']).with_suffix('.wav')
                reference_hash = hashlib.sha256(reference.read_bytes()).hexdigest()
                assert reference_hash == anchor['sourceSha256'], 'Reference WAV differs from its recorded source'
            configuration = [model_name, instruction, role[kind], seed, options]
            if reference_hash:
                configuration.append(reference_hash)
            fingerprint = hashlib.sha256(json.dumps(configuration,
                                                    ensure_ascii=False, sort_keys=True).encode()).hexdigest()
            suffix = {'reference': '参考', 'praise': '夸夸', 'taunt': '嘲讽'}[kind]
            target = output/f'{role_index:02}-{role["label"]}-{suffix}.mp3'
            previous = clips.get(key)
            if (previous and previous.get('fingerprint') == fingerprint and target.exists()
                    and 0.8 <= previous['duration'] <= maximum_duration
                    and minimum_pace <= characters/previous['duration'] <= 8
                    and hashlib.sha256(target.read_bytes()).hexdigest() == previous['sha256']):
                continue
            print(f'{args.backend} {style}/{kind}: {role[kind]}', flush=True)
            started = time.monotonic()
            for attempt in range(3):
                mx.random.seed(seed+attempt*1000)
                segments = []
                for result in model.generate(text=role[kind], instruct=instruction, lang_code='Chinese',
                                             max_tokens=160, verbose=False,
                                             **({'ref_audio': str(reference)} if reference else {}), **options):
                    segments.append(np.asarray(result.audio).reshape(-1))
                    rate = result.sample_rate
                assert segments, 'No generated audio'
                samples = np.concatenate(segments)
                duration = len(samples)/rate
                if (0.8 <= duration <= maximum_duration and minimum_pace <= characters/duration <= 8
                        and np.isfinite(samples).all() and np.max(np.abs(samples)) > .01):
                    break
                print(f'  Retaking unusual duration: {duration:.2f}s, {characters/duration:.2f} chars/s', flush=True)
            else:
                raise RuntimeError(f'Cannot get a normally paced take for {key}')
            original = target.with_suffix('.wav')
            original.write_bytes(write_wav(samples, rate))
            subprocess.run([args.ffmpeg, '-nostdin', '-v', 'error', '-y', '-i', str(original),
                            '-map_metadata', '-1', '-ac', '1', '-ar', '48000', '-c:a', 'libmp3lame',
                            '-b:a', '128k', '-af', 'loudnorm=I=-18:TP=-2:LRA=11', str(target)], check=True)
            clips[key] = {'id': key, 'style': style, 'label': role['label'], 'kind': kind,
                          'variant': args.variant, 'candidate': role.get('candidate'),
                          'text': role[kind], 'instruction': instruction, 'seed': seed+attempt*1000,
                          'options': options, 'fingerprint': fingerprint, 'file': target.name,
                          'duration': round(duration, 3), 'sourceSampleRate': rate, 'tempo': 1,
                          'referenceSha256': reference_hash,
                          'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
                          'sourceSha256': hashlib.sha256(original.read_bytes()).hexdigest()}
            manifest['clips'] = list(clips.values())
            path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')
            mx.clear_cache()
            print(f'  Saved original-speed {duration:.2f}s in {time.monotonic()-started:.1f}s', flush=True)
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')
    print('Conversational auditions ready', flush=True)


if __name__ == '__main__':
    main()
