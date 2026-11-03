import array
import io
import math
from pathlib import Path
import subprocess
import tempfile
import unittest
import wave

from combat_voice_delivery import DeliveryRejected, encode


def recording(samples):
    source = io.BytesIO()
    with wave.open(source, 'wb') as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(48000)
        audio.writeframes(array.array('h', samples).tobytes())
    return source.getvalue()


class NaturalTimingTest(unittest.TestCase):
    def test_mp3_keeps_the_original_pause_and_duration(self):
        tone = [round(math.sin(index * 2 * math.pi * 240 / 48000) * 6000) for index in range(38400)]
        source = recording(tone + [0] * 19200 + tone)
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / 'voice.mp3'
            result = encode(source, target, 'ffmpeg', 'ffprobe', {'style': 'sweet', 'text': '这波打得漂亮真的很不错'})
            decoded = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(target), '-f', 's16le', '-'])
        samples = array.array('h', decoded)
        self.assertAlmostEqual(len(samples) / 48000, 2, delta=.01)
        self.assertLess(max(abs(value) for value in samples[43200:52800]), 100)
        self.assertGreater(max(abs(value) for value in samples[24000:28800]), 1000)
        self.assertGreater(max(abs(value) for value in samples[67200:72000]), 1000)
        self.assertEqual(result['delivery']['tempo'], 1)
        self.assertEqual(result['delivery']['removedSilenceSeconds'], 0)

    def test_rejected_silence_does_not_replace_existing_audio(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / 'voice.mp3'
            target.write_bytes(b'existing recording')
            with self.assertRaises(DeliveryRejected):
                encode(recording([0] * 48000), target, 'ffmpeg', 'ffprobe', {'style': 'sweet', 'text': '这波很漂亮'})
            self.assertEqual(target.read_bytes(), b'existing recording')


if __name__ == '__main__':
    unittest.main()
