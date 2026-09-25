"""Resident JSON-lines bridge for Kokoro ONNX speech synthesis."""

import base64
import io
import json
import os
import sys
import wave

PROTOCOL_OUT = sys.stdout
sys.stdout = sys.stderr

import numpy as np
import onnxruntime as ort
from kokoro_onnx import Kokoro


def emit(payload):
    PROTOCOL_OUT.write(json.dumps(payload, ensure_ascii=False) + "\n")
    PROTOCOL_OUT.flush()


def load_kokoro(model_path, voices_path):
    options = ort.SessionOptions()
    options.intra_op_num_threads = max(1, int(os.environ.get("AUTOSUB_KOKORO_THREADS", "2")))
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(
        model_path,
        sess_options=options,
        providers=["CPUExecutionProvider"],
    )
    return Kokoro.from_session(session, voices_path)


def wav_base64(samples, sample_rate):
    audio = np.asarray(samples, dtype=np.float32)
    pcm = (np.clip(audio, -1.0, 1.0) * 32767.0).astype("<i2", copy=False)
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(int(sample_rate))
        wav.writeframes(pcm.tobytes())
    return base64.b64encode(output.getvalue()).decode("ascii")


def main():
    if len(sys.argv) != 3:
        emit({"ok": False, "error": "Kokoro bridge requires model and voice paths."})
        return 2

    try:
        kokoro = load_kokoro(sys.argv[1], sys.argv[2])
    except Exception as error:
        emit({"ok": False, "fatal": True, "error": str(error)})
        return 1

    emit({"ready": True})
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            request_id = str(request.get("id", ""))
            samples, sample_rate = kokoro.create(
                str(request["text"]),
                voice=str(request["voice"]),
                speed=float(request.get("speed", 1.0)),
                lang=str(request["language"]),
            )
            emit({"id": request_id, "ok": True, "audioBase64": wav_base64(samples, sample_rate)})
        except Exception as error:
            emit({"id": str(request.get("id", "")) if "request" in locals() else "", "ok": False, "error": str(error)})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
