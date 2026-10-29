#!/usr/bin/env python3
"""Development-only, resumable creation of the bundled emotional voice pack.

Requires Node/TypeScript from npm install, Python 3 and ffmpeg/ffprobe.
Uses the official Qwen demo serially, or MLX on an Apple Silicon development
machine. Neither Python nor a model is included in the application.
"""

import argparse
import hashlib
import http.cookiejar
import io
import json
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import wave

ROOT = Path(__file__).resolve().parent.parent
PACK = ROOT / 'resources' / 'combat-voices'
HOST = 'https://qwen-qwen3-tts.hf.space'
MODEL = 'Qwen3-TTS-12Hz-1.7B-CustomVoice'
USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36'


def open_request(opener, request, timeout):
    for attempt in range(4):
        try:
            return opener.open(request, timeout=timeout)
        except urllib.error.HTTPError as error:
            if error.code < 500 or attempt == 3:
                raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt == 3:
                raise
        time.sleep(2 ** attempt)


def generate(job, opener):
    payload = {'data': [job['text'], 'Chinese', job['speaker'], job['instruction'], '1.7B']}
    request = urllib.request.Request(
        HOST + '/gradio_api/call/generate_custom_voice',
        data=json.dumps(payload, ensure_ascii=False).encode('utf8'),
        headers={'User-Agent': USER_AGENT, 'Content-Type': 'application/json',
                 'Accept': 'application/json', 'Origin': HOST, 'Referer': HOST + '/'},
    )
    with open_request(opener, request, timeout=30) as response:
        event_id = json.load(response)['event_id']
    request = urllib.request.Request(
        HOST + '/gradio_api/call/generate_custom_voice/' + event_id,
        headers={'User-Agent': USER_AGENT, 'Accept': 'text/event-stream', 'Referer': HOST + '/'},
    )
    event = ''
    with open_request(opener, request, timeout=180) as response:
        for raw in response:
            line = raw.decode('utf8').strip()
            if line.startswith('event: '):
                event = line[7:]
            elif line.startswith('data: ') and event == 'error':
                raise RuntimeError('Qwen generation failed (including any quota limit): ' + line[6:])
            elif line.startswith('data: ') and event == 'complete':
                result = json.loads(line[6:])
                if not result or not isinstance(result[0], dict) or not result[0].get('url'):
                    raise RuntimeError('Qwen returned no audio: ' + str(result))
                url = result[0]['url']
                if not url.startswith(HOST + '/gradio_api/file='):
                    raise RuntimeError('Unexpected audio host')
                request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, 'Accept': 'audio/*'})
                with open_request(opener, request, timeout=60) as audio:
                    return audio.read()
    raise RuntimeError('The generation stream ended before audio was returned')


def encode(wave, target, ffmpeg):
    with tempfile.TemporaryDirectory(prefix='rift-voice-') as temporary:
        source = Path(temporary) / 'source.wav'
        output = Path(temporary) / 'voice.mp3'
        source.write_bytes(wave)
        subprocess.run([
            ffmpeg, '-nostdin', '-v', 'error', '-y', '-i', str(source),
            '-map_metadata', '-1', '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', '64k',
            '-af', 'loudnorm=I=-18:TP=-2:LRA=11', str(output),
        ], check=True)
        duration = float(subprocess.check_output([
            'ffprobe', '-v', 'error', '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1', str(output),
        ], text=True).strip())
        if not 0.5 < duration <= 10:
            raise RuntimeError(f'Unexpected clip duration: {duration}s')
        data = output.read_bytes()
        target.write_bytes(data)
        return duration, len(data), hashlib.sha256(data).hexdigest()


def generate_mlx(job, model, seed_offset=0):
    import mlx.core as mx
    import numpy as np
    mx.random.seed((int(hashlib.sha256((job['style'] + job['text']).encode()).hexdigest()[:8], 16) + seed_offset) % (2 ** 32))
    segments = []
    sample_rate = 24000
    for result in model.generate(text=job['text'], voice=job['speaker'], instruct=job['instruction'],
                                 lang_code='Chinese', max_tokens=160, temperature=0.7, verbose=False):
        segments.append(np.asarray(result.audio).reshape(-1))
        sample_rate = result.sample_rate
    if not segments:
        raise RuntimeError('Local Qwen returned no audio')
    samples = np.concatenate(segments)
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
    parser.add_argument('--limit', type=int, help='Limit newly generated clips (existing clips are resumed)')
    parser.add_argument('--ffmpeg', default='ffmpeg', help='ffmpeg binary built with libmp3lame')
    parser.add_argument('--backend', choices=['demo', 'mlx'], default='demo')
    parser.add_argument('--local-model', default='mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-4bit')
    parser.add_argument('--force', action='store_true', help='Re-encode matching clips, using cached source audio when available')
    parser.add_argument('--files', nargs='+', help='Regenerate/check only the specified clip filenames')
    parser.add_argument('--styles', nargs='+', help='Generate only the specified persona names')
    parser.add_argument('--seed-offset', type=int, default=0, help='Change the seed to repair a rejected local generation')
    args = parser.parse_args()
    jobs = json.loads(subprocess.check_output(['node', str(ROOT / 'scripts' / 'combat-voice-catalog.mjs')], text=True))
    if args.styles and set(args.styles) - {job['style'] for job in jobs}:
        parser.error('Unknown persona in --styles')
    PACK.mkdir(parents=True, exist_ok=True)
    manifest_path = PACK / 'manifest.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {
        'version': 1, 'model': MODEL, 'source': 'https://huggingface.co/spaces/Qwen/Qwen3-TTS',
        'format': 'mp3', 'sampleRate': 24000, 'bitrate': 64000, 'clips': [],
    }
    source_model = args.local_model if args.backend == 'mlx' else 'Qwen/' + MODEL
    manifest['source'] = 'https://github.com/QwenLM/Qwen3-TTS'
    manifest['generationSource'] = 'https://huggingface.co/' + source_model
    clips = {clip['file']: clip for clip in manifest['clips']}
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    generated = 0
    model = None
    for index, job in enumerate(jobs):
        if args.styles and job['style'] not in args.styles:
            continue
        if args.files and job['file'] not in args.files:
            continue
        target = PACK / job['file']
        previous = clips.get(job['file'])
        if (not args.force and previous and target.exists() and previous.get('instruction') == job['instruction']
                and previous.get('duration', 999) <= 10
                and hashlib.sha256(target.read_bytes()).hexdigest() == previous['sha256']):
            continue
        if args.limit is not None and generated >= args.limit:
            break
        print(f'[{index + 1}/{len(jobs)}] {job["style"]}/{job["kind"]}: {job["text"]}', flush=True)
        started = time.monotonic()
        cache = ROOT / 'output' / 'voice-generation'
        cache.mkdir(parents=True, exist_ok=True)
        for attempt in range(4 if args.backend == 'mlx' else 1):
            seed_offset = args.seed_offset + attempt
            instruction_key = hashlib.sha256((args.backend + source_model + str(seed_offset) + job['speaker'] + job['instruction']).encode()).hexdigest()[:12]
            original = cache / (target.stem + '-' + instruction_key + '.wav')
            try:
                if original.exists():
                    wave = original.read_bytes()
                elif args.backend == 'mlx':
                    if model is None:
                        print('Loading development-only model: ' + source_model, flush=True)
                        from mlx_audio.tts.utils import load_model
                        model = load_model(source_model)
                    wave = generate_mlx(job, model, seed_offset)
                else:
                    wave = generate(job, opener)
            except urllib.error.HTTPError as error:
                # Respect the service's cooldown; do not change identities or endpoints to evade limits.
                raise RuntimeError(f'HTTP {error.code}; Retry-After={error.headers.get("Retry-After", "not supplied")}') from error
            original.write_bytes(wave)
            try:
                duration, size, digest = encode(wave, target, args.ffmpeg)
                break
            except RuntimeError as error:
                if args.backend != 'mlx' or attempt == 3 or 'Unexpected clip duration' not in str(error):
                    raise
                print(f'  rejected ({error}); sampling again', flush=True)
        clips[job['file']] = {**job, 'backend': args.backend, 'sourceModel': source_model,
                             'seedOffset': seed_offset,
                             'duration': round(duration, 3), 'bytes': size, 'sha256': digest}
        manifest['clips'] = [clips[j['file']] for j in jobs if j['file'] in clips]
        temporary = manifest_path.with_suffix('.json.tmp')
        temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
        temporary.replace(manifest_path)
        generated += 1
        print(f'  saved {duration:.2f}s / {size} bytes in {time.monotonic() - started:.1f}s; {len(clips)}/{len(jobs)} complete', flush=True)
        if args.backend == 'demo':
            time.sleep(1)
    print(f'Completed {generated} new clips; {len(clips)}/{len(jobs)} bundled clips.', flush=True)


if __name__ == '__main__':
    main()
