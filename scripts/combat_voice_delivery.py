"""Development-only encoding: preserve the accepted voices' speed and pauses."""
import array
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import tempfile
import wave

SETTINGS = json.loads(Path(__file__).with_name('combat-voice-delivery.json').read_text())


class DeliveryRejected(RuntimeError):
    pass


def character_count(text):
    return len(re.findall(r'[\u4e00-\u9fffA-Za-z0-9]', text))


def source_duration(source):
    with wave.open(io.BytesIO(source), 'rb') as audio:
        if audio.getnchannels() != 1 or audio.getsampwidth() != 2:
            raise DeliveryRejected('Expected a mono 16-bit source WAV')
        duration = audio.getnframes() / audio.getframerate()
        samples = array.array('h', audio.readframes(audio.getnframes()))
    if max((abs(sample) for sample in samples), default=0) < 32:
        raise DeliveryRejected('Source recording has no usable speech signal')
    return duration


def encode(source, target, ffmpeg, ffprobe, job):
    profile = SETTINGS['profiles'][job['style']]
    original_duration = source_duration(source)
    characters = character_count(job['text'])
    rate = characters / original_duration
    if not 0.5 < original_duration <= SETTINGS['maximumDuration'] or not profile['minimumCharactersPerSecond'] <= rate <= profile['maximumCharactersPerSecond']:
        raise DeliveryRejected(f'{job["style"]}: unusual delivery ({original_duration:.2f}s, {rate:.2f} chars/s)')
    with tempfile.TemporaryDirectory(prefix='rift-voice-') as temporary:
        input_path = Path(temporary) / 'source.wav'
        output = Path(temporary) / 'voice.mp3'
        input_path.write_bytes(source)
        subprocess.run([
            ffmpeg, '-nostdin', '-v', 'error', '-y', '-i', str(input_path),
            '-map_metadata', '-1', '-ac', '1', '-ar', str(SETTINGS['sampleRate']),
            '-c:a', 'libmp3lame', '-b:a', str(SETTINGS['bitrate']),
            '-af', 'loudnorm=I=-18:TP=-2:LRA=11', str(output),
        ], check=True)
        decoded = subprocess.check_output([
            ffmpeg, '-nostdin', '-v', 'error', '-i', str(output), '-ac', '1',
            '-ar', str(SETTINGS['sampleRate']), '-f', 's16le', '-',
        ])
        duration = len(decoded) / (SETTINGS['sampleRate'] * 2)
        if abs(duration - original_duration) > 0.01:
            raise DeliveryRejected('Encoding changed the original timing')
        data = output.read_bytes()
        target.write_bytes(data)
        return {
            'duration': round(duration, 3), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
            'delivery': {
                'version': SETTINGS['version'], 'profile': profile, 'tempo': 1,
                'sourceSha256': hashlib.sha256(source).hexdigest(),
                'sourceDuration': round(original_duration, 3), 'removedSilenceSeconds': 0,
                'charactersPerSecond': round(characters / duration, 3),
            },
        }
