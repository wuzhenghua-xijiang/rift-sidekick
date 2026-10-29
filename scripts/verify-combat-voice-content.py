#!/usr/bin/env python3
"""Silent, development-only ASR screening of generated clips; not a listening test.

Run with uv run --python 3.12 --with mlx-audio==0.6.3 --with pypinyin.
Chinese game terms and expressive voices can confuse ASR; flagged results need
review rather than treating this diagnostic as a proof of pronunciation quality.
"""
import argparse
import difflib
import json
from pathlib import Path
import re
import subprocess
import time

ROOT = Path(__file__).resolve().parent.parent
PACK = ROOT / 'resources' / 'combat-voices'
REPORT = ROOT / 'output' / 'voice-generation' / 'content-verification.json'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', default='mlx-community/whisper-small-asr-fp16')
    parser.add_argument('--limit', type=int)
    args = parser.parse_args()
    from mlx_audio.stt.utils import load_model
    from pypinyin import lazy_pinyin
    model = load_model(args.model)
    results = json.loads(REPORT.read_text()) if REPORT.exists() else {}
    clips = json.loads((PACK / 'manifest.json').read_text())['clips']
    checked = 0
    for clip in clips:
        previous = results.get(clip['file'])
        if previous and previous['sha256'] == clip['sha256'] and previous['model'] == args.model:
            continue
        if args.limit is not None and checked >= args.limit:
            break
        started = time.monotonic()
        pcm = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(PACK / clip['file']),
                                       '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'])
        import numpy as np
        output = model.generate(np.frombuffer(pcm, dtype='<f4').copy(), language='zh', temperature=0.0,
                                condition_on_previous_text=False, return_timestamps=False)
        actual = output['text'] if isinstance(output, dict) else output.text
        def phonemes(text):
            return lazy_pinyin(re.sub(r'[^\u4e00-\u9fff]', '', text))
        score = difflib.SequenceMatcher(None, phonemes(clip['text']), phonemes(actual), autojunk=False).ratio()
        result = {'style': clip['style'], 'kind': clip['kind'], 'expected': clip['text'], 'actual': actual,
                  'phoneticSimilarity': round(score, 3), 'duration': clip['duration'],
                  'sha256': clip['sha256'], 'model': args.model}
        results[clip['file']] = result
        REPORT.parent.mkdir(parents=True, exist_ok=True)
        temporary = REPORT.with_suffix('.json.tmp')
        temporary.write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n')
        temporary.replace(REPORT)
        checked += 1
        print(f'{len(results)}/{len(clips)} {clip["style"]}/{clip["kind"]} {score:.2f} {time.monotonic()-started:.1f}s: {actual}', flush=True)
    flags = [r for r in results.values() if r['phoneticSimilarity'] < 0.7 or r['duration'] > 10]
    print(json.dumps({'screened': len(results), 'flags': flags}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
