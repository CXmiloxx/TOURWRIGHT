# Speech to text with faster-whisper, kept loaded while `tourwright voices --check` listens to every voice.
#
#   python transcribe.py <model> <ffmpeg>
#   stdin   {"file": "/path/audio.wav", "language": "es"}
#   stdout  {"text": "…"} | {"error": "…"}
#
# ffmpeg decodes the audio (any format) to 16 kHz mono: no other audio library is needed.
import json
import subprocess
import sys

import numpy as np
from faster_whisper import WhisperModel

model_name, ffmpeg = sys.argv[1], sys.argv[2]
model = WhisperModel(model_name, device="cpu", compute_type="int8")
print(json.dumps({"ready": True}), flush=True)

for line in sys.stdin:
    if not line.strip():
        continue
    try:
        job = json.loads(line)
        pcm = subprocess.run([ffmpeg, "-v", "error", "-i", job["file"], "-f", "s16le", "-ac", "1", "-ar", "16000", "-"],
                             capture_output=True, check=True).stdout
        audio = np.frombuffer(pcm, np.int16).astype(np.float32) / 32768
        segments, _ = model.transcribe(audio, language=job.get("language"), beam_size=5, condition_on_previous_text=False)
        print(json.dumps({"text": " ".join(s.text.strip() for s in segments)}, ensure_ascii=False), flush=True)
    except Exception as error:
        print(json.dumps({"error": str(error)}), flush=True)
