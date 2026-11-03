#!/usr/bin/env python3
"""Resumable VoxCPM2 production pack using the approved synthetic references.

Development on Apple Silicon: uv run --python 3.12 --with mlx-audio==0.6.3
python scripts/generate-combat-voices.py. Models and reference WAVs do not ship.
"""
import argparse
from functools import lru_cache
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import time
import wave
from combat_voice_delivery import DeliveryRejected, SETTINGS as DELIVERY, encode

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / 'scripts'
PACK = ROOT / 'resources' / 'combat-voices'
RELEASE = json.loads((SCRIPTS / 'combat-voice-release.json').read_text())


def normalized(text):
    return re.sub(r'[^\u4e00-\u9fffA-Za-z0-9]', '', text)


def generate(job, model, seed):
    import mlx.core as mx
    import numpy as np
    mx.random.seed(seed)
    segments = []
    for result in model.generate(
        text=job['text'], instruct=job['instruction'], ref_audio=str(SCRIPTS / job['referenceFile']),
        inference_timesteps=RELEASE['inferenceTimesteps'], cfg_value=RELEASE['cfgValue'],
        warmup_patches=0, max_tokens=160, verbose=False,
    ):
        segments.append(np.asarray(result.audio).reshape(-1))
        sample_rate = result.sample_rate
    if not segments:
        raise DeliveryRejected('VoxCPM2 returned no audio')
    samples = np.concatenate(segments)
    if not np.isfinite(samples).all():
        raise DeliveryRejected('VoxCPM2 returned invalid samples')
    output = io.BytesIO()
    with wave.open(output, 'wb') as encoded:
        encoded.setnchannels(1)
        encoded.setsampwidth(2)
        encoded.setframerate(sample_rate)
        encoded.writeframes((np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes())
    mx.clear_cache()
    return output.getvalue()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--limit', type=int)
    parser.add_argument('--ffmpeg', default='/opt/homebrew/bin/ffmpeg')
    parser.add_argument('--ffprobe', default='/opt/homebrew/bin/ffprobe')
    parser.add_argument('--local-model', help='A prepared snapshot of the pinned VoxCPM2 revision')
    parser.add_argument('--force', action='store_true')
    parser.add_argument('--files', nargs='+')
    parser.add_argument('--styles', nargs='+')
    parser.add_argument('--kinds', nargs='+')
    parser.add_argument('--prune', action='store_true')
    parser.add_argument('--seed-offset', type=int, default=0)
    args = parser.parse_args()
    jobs = json.loads(subprocess.check_output(['node', str(SCRIPTS / 'combat-voice-catalog.mjs')], text=True))
    for selected, field in [(args.styles, 'style'), (args.kinds, 'kind'), (args.files, 'file')]:
        if selected and set(selected) - {job[field] for job in jobs}:
            parser.error('Unknown selection for ' + field)
    for profile in RELEASE['profiles'].values():
        assert hashlib.sha256((SCRIPTS / profile['referenceFile']).read_bytes()).hexdigest() == profile['referenceSha256'], 'Approved reference has changed'
    PACK.mkdir(parents=True, exist_ok=True)
    manifest_path = PACK / 'manifest.json'
    old = json.loads(manifest_path.read_text()) if manifest_path.exists() else {'clips': []}
    clips = {clip['file']: clip for clip in old['clips']}
    manifest = {
        'version': 2, 'model': RELEASE['model'], 'source': 'https://github.com/OpenBMB/VoxCPM',
        'generationSource': 'https://huggingface.co/' + RELEASE['sourceModel'],
        'modelRevision': RELEASE['modelRevision'],
        'inferenceTimesteps': RELEASE['inferenceTimesteps'], 'cfgValue': RELEASE['cfgValue'],
        'format': 'mp3', 'sampleRate': DELIVERY['sampleRate'], 'bitrate': DELIVERY['bitrate'],
        'processing': 'Original speed and pauses; loudness normalization only.', 'clips': [],
    }
    cache = ROOT / 'output' / 'voice-generation' / 'voxcpm2-release-sources'
    cache.mkdir(parents=True, exist_ok=True)
    model = None
    generated = 0
    for index, job in enumerate(jobs):
        if any(selected and job[field] not in selected for selected, field in [(args.styles, 'style'), (args.kinds, 'kind'), (args.files, 'file')]):
            continue
        if args.limit is not None and generated >= args.limit:
            break
        fingerprint = hashlib.sha256(json.dumps([job, RELEASE['modelRevision'], RELEASE['inferenceTimesteps'], RELEASE['cfgValue'], DELIVERY], ensure_ascii=False, sort_keys=True).encode()).hexdigest()
        previous = clips.get(job['file'], {})
        target = PACK / job['file']
        if not args.force and previous.get('fingerprint') == fingerprint and target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == previous.get('sha256'):
            continue
        print(f'{index + 1}/{len(jobs)} {job["style"]}/{job["kind"]}: {job["text"]}', flush=True)
        started = time.monotonic()
        approved = next((take for take in RELEASE['approvedTakes'] if take['style'] == job['style'] and normalized(take['text']) == normalized(job['text'])), None)
        for attempt in range(4):
            seed = (int(hashlib.sha256((job['style'] + job['text']).encode()).hexdigest()[:8], 16) + args.seed_offset + attempt) % (2 ** 32)
            actual_instruction = job['instruction']
            actual_reference = job['referenceSha256']
            original = cache / f'{target.stem}-{fingerprint[:16]}-{seed}.wav'
            try:
                if approved:
                    source = (SCRIPTS / approved['file']).read_bytes()
                    assert hashlib.sha256(source).hexdigest() == approved['sourceSha256']
                    seed = approved['seed']
                    actual_instruction = approved['synthesisInstruction']
                    actual_reference = approved['actualReferenceSha256']
                elif original.exists():
                    source = original.read_bytes()
                else:
                    if model is None:
                        from mlx_audio.tts.utils import load_model
                        from huggingface_hub import snapshot_download
                        local = args.local_model or snapshot_download(RELEASE['sourceModel'], revision=RELEASE['modelRevision'])
                        if Path(local).name != RELEASE['modelRevision']:
                            parser.error('--local-model must point to the pinned snapshot revision')
                        model = load_model(local)
                        # Each reference is immutable and reused for sixty lines.
                        model._encode_wav = lru_cache(maxsize=len(RELEASE['profiles']))(model._encode_wav)
                    source = generate(job, model, seed)
                if not approved:
                    original.write_bytes(source)
                encoded = encode(source, target, args.ffmpeg, args.ffprobe, job)
                break
            except DeliveryRejected as error:
                if approved or attempt == 3:
                    raise
                print(f'  Retaking unusual delivery: {error}', flush=True)
        clips[job['file']] = {
            **job, 'backend': 'mlx-voxcpm2', 'sourceModel': RELEASE['sourceModel'],
            'modelRevision': RELEASE['modelRevision'], 'synthesisInstruction': actual_instruction,
            'actualReferenceSha256': actual_reference, 'approvedTake': bool(approved),
            'seed': seed, 'fingerprint': fingerprint, **encoded,
        }
        manifest['clips'] = [clips[j['file']] for j in jobs if j['file'] in clips]
        temporary = manifest_path.with_suffix('.json.tmp')
        temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
        temporary.replace(manifest_path)
        generated += 1
        print(f'  Saved {encoded["duration"]:.2f}s / {encoded["delivery"]["charactersPerSecond"]:.2f} chars/s in {time.monotonic() - started:.1f}s', flush=True)
    current_files = {job['file'] for job in jobs}
    if args.prune:
        if not all(name in clips and clips[name].get('modelRevision') == RELEASE['modelRevision'] and (PACK / name).exists() for name in current_files):
            raise RuntimeError('Refusing to prune before the full catalog is ready')
        for retired in PACK.glob('*.mp3'):
            if retired.name not in current_files:
                retired.unlink()
    print(f'Completed {generated} clips.', flush=True)


if __name__ == '__main__':
    main()
