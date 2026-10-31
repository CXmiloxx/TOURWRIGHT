# Pocket TTS (Kyutai) kept loaded for a whole render: Tourwright starts it once per language and voice, then
# sends one JSON line per sentence and reads one JSON line back. Loading the model takes seconds; a
# sentence after that takes about as long as it lasts.
#
#   python pocket.py <language> <voice>        voice: a built-in name (lola) or a .wav to clone
#   stdin   {"text": "…", "out": "/path/file.wav"}
#   stdout  {"ok": true} | {"error": "…"}
import json
import sys

import scipy.io.wavfile
from pocket_tts import TTSModel

language, voice = sys.argv[1], sys.argv[2]
model = TTSModel.load_model(language=language)
state = model.get_state_for_audio_prompt(voice)
print(json.dumps({"ready": True, "sampleRate": model.sample_rate}), flush=True)

for line in sys.stdin:
    if not line.strip():
        continue
    try:
        job = json.loads(line)
        audio = model.generate_audio(state, job["text"])
        scipy.io.wavfile.write(job["out"], model.sample_rate, audio.numpy())
        print(json.dumps({"ok": True}), flush=True)
    except Exception as error:  # the next sentence must still work
        print(json.dumps({"error": str(error)}), flush=True)
