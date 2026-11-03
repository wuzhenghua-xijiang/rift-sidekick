#!/usr/bin/env python3
"""Decode and silently screen conversational auditions, then create previews."""
import argparse
import difflib
import hashlib
import json
from pathlib import Path
import re
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--ffmpeg', default='/opt/homebrew/bin/ffmpeg')
    parser.add_argument('--styles', nargs='+', default=['classic', 'grumpy', 'teen', 'sweet', 'taiwan'])
    args = parser.parse_args()
    import numpy as np
    from mlx_audio.stt.utils import load_model
    from pypinyin import lazy_pinyin
    directory = args.directory.resolve()
    manifest = json.loads((directory/'manifest.json').read_text())
    clips = manifest['clips']
    expected = {(style, kind) for style in args.styles for kind in ['praise', 'taunt']}
    takes = [c for c in clips if c['kind'] in ['praise', 'taunt']]
    assert {(c['style'], c['kind']) for c in takes} == expected and len(takes) == len(expected)
    assert all(c['style'] in args.styles and c['kind'] in ['reference', 'praise', 'taunt'] for c in clips)
    assert all(c['tempo'] == 1 for c in clips)
    model_name = 'mlx-community/whisper-small-asr-fp16'
    model = load_model(model_name)
    report_path = directory/'verification.json'
    previous = json.loads(report_path.read_text()) if report_path.exists() else {}
    previous_clips = previous.get('clips', [])
    if not isinstance(previous_clips, list):
        previous_clips = []
    cached = {r['file']: r for r in previous_clips if isinstance(r, dict) and r.get('asrModel') == model_name}
    report = {'sourceModel': manifest['model'], 'clips': [], 'flags': [], 'previews': [],
              'scope': 'Decoding and content screening only. Naturalness, timbre and accent require listening.'}

    def decode(path, rate):
        return subprocess.check_output([args.ffmpeg, '-nostdin', '-v', 'error', '-i', str(path),
                                        '-ac', '1', '-ar', str(rate), '-f', 'f32le', '-'])

    def phonemes(text):
        return lazy_pinyin(re.sub(r'[^\u4e00-\u9fff]', '', text))

    for clip in clips:
        path = directory/clip['file']
        assert hashlib.sha256(path.read_bytes()).hexdigest() == clip['sha256']
        original = path.with_suffix('.wav')
        assert hashlib.sha256(original.read_bytes()).hexdigest() == clip['sourceSha256']
        if clip.get('referenceSha256'):
            assert any(c['sourceSha256'] == clip['referenceSha256'] and c['style'] == clip['style']
                       for c in clips), 'Reference must belong to the same persona'
        samples = np.frombuffer(decode(path, 16000), dtype='<f4').copy()
        assert np.isfinite(samples).all() and np.max(np.abs(samples)) > .01
        result = cached.get(clip['file'])
        if not result or result['sha256'] != clip['sha256']:
            output = model.generate(samples, language='zh', temperature=0.0,
                                    condition_on_previous_text=False, return_timestamps=False)
            text = output['text'] if isinstance(output, dict) else output.text
            score = difflib.SequenceMatcher(None, phonemes(clip['text']), phonemes(text), autojunk=False).ratio()
            result = {'file': clip['file'], 'expected': clip['text'], 'actual': text,
                      'phoneticSimilarity': round(score, 3), 'sha256': clip['sha256'],
                      'asrModel': model_name, 'duration': round(len(samples)/16000, 3)}
        report['clips'].append(result)
        if result['phoneticSimilarity'] < .75:
            report['flags'].append(clip['file'])
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
        print(f'{clip["file"]}: {result["phoneticSimilarity"]:.2f}: {result["actual"]}', flush=True)
    if report['flags']:
        raise RuntimeError(f'Content flags: {report["flags"]}')
    roles = {}
    for clip in takes:
        roles.setdefault(clip['style'], {})[clip['kind']] = clip
    for style, parts in roles.items():
        a, b = parts['praise'], parts['taunt']
        prefix = a['file'].split('-', 1)[0]
        target = directory/f'{prefix}-{a["label"]}-先夸后嘲.mp3'
        audio = decode(directory/a['file'], 48000)+np.zeros(28800, dtype='<f4').tobytes()+decode(directory/b['file'], 48000)
        subprocess.run([args.ffmpeg, '-nostdin', '-v', 'error', '-y', '-f', 'f32le', '-ar', '48000',
                        '-ac', '1', '-i', '-', '-map_metadata', '-1', '-c:a', 'libmp3lame', '-b:a', '128k',
                        str(target)], input=audio, check=True)
        report['previews'].append({'style': style, 'file': target.name,
                                   'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
        print('Preview ready: '+target.name, flush=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')


if __name__ == '__main__':
    main()
