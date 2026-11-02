# Piper (piper-tts 1.8+, OHF-Voice/piper1-gpl) kept loaded for a whole render: Tourwright starts it once per
# voice, then sends one JSON line per sentence and reads one JSON line back. Loading a voice takes about two
# seconds; a sentence after that takes a fraction of one (starting the `piper` command each time costs the load
# again for every sentence).
#
#   python piper_voice.py <model.onnx>  (not piper.py: that name would hide the piper package)
#   stdin   {"text": "…", "out": "/path/file.wav", "lengthScale": 1.1, "speaker": 0}
#   stdout  {"ok": true} | {"error": "…"}
import json
import sys
import wave

from piper import PiperVoice, SynthesisConfig

voice = PiperVoice.load(sys.argv[1])
print(json.dumps({"ready": True, "sampleRate": voice.config.sample_rate}), flush=True)

for line in sys.stdin:
    if not line.strip():
        continue
    try:
        job = json.loads(line)
        speaker = job.get("speaker")
        config = SynthesisConfig(
            length_scale=job.get("lengthScale"),
            speaker_id=int(speaker) if speaker not in (None, "") else None,
        )
        with wave.open(job["out"], "wb") as wav:
            voice.synthesize_wav(job["text"], wav, syn_config=config)
        print(json.dumps({"ok": True}), flush=True)
    except Exception as error:  # the next sentence must still work
        print(json.dumps({"error": str(error)}), flush=True)
