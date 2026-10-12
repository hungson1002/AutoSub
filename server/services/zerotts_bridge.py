"""Persistent ZeroTTS ONNX worker for AutoSub."""
import argparse
import json
import os
import sys
import traceback
from pathlib import Path

_MODEL = None


def _load_model():
    global _MODEL
    if _MODEL is not None:
        return _MODEL
    from zerotts import ZeroTTS
    _MODEL = ZeroTTS.from_pretrained("zeroweight-ai/ZeroTTS")
    return _MODEL


def _synthesize(request):
    import hashlib
    import numpy as np
    import soundfile as sf
    from zerotts import normalize_vi_text

    model = _load_model()
    text = normalize_vi_text(str(request.get("text") or "").strip())
    voice = str(request.get("voice") or "").strip()
    output_path = str(request.get("outputPath") or "").strip()
    if not text:
        raise ValueError("text is empty")
    if voice not in model.list_voices():
        raise ValueError(f"unknown ZeroTTS voice: {voice}")
    if not output_path:
        raise ValueError("outputPath is empty")

    # ZeroTTS samples with NumPy random values. Derive a stable seed from the
    # actual utterance so preview, retry and final render keep identical timing
    # while different sentences still receive different sampler trajectories.
    digest = hashlib.sha256((voice + "\0" + text).encode("utf-8")).digest()
    np.random.seed(int.from_bytes(digest[:4], "little", signed=False))
    audio = model.synthesize(text, voice=voice)
    flat = np.asarray(audio, dtype=np.float32).reshape(-1)
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    sf.write(output_path, flat, int(model.sample_rate), subtype="PCM_16")
    return {"sampleRate": int(model.sample_rate)}


def _handle(request):
    op = request.get("op")
    if op == "warmup":
        _load_model()
        return {}
    if op == "synthesize":
        return _synthesize(request)
    raise ValueError(f"unknown op: {op}")


def worker_loop():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request_id = ""
        try:
            request = json.loads(line)
            request_id = str(request.get("requestId") or "")
            payload = _handle(request)
            print(json.dumps({"requestId": request_id, "ok": True, **payload}), flush=True)
        except Exception as exc:
            print(json.dumps({
                "requestId": request_id,
                "ok": False,
                "error": f"{type(exc).__name__}: {exc}",
            }, ensure_ascii=True), flush=True)
            traceback.print_exc(file=sys.stderr)


def check_runtime():
    from zerotts import ZeroTTS  # noqa: F401
    import soundfile  # noqa: F401
    print("ok")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--worker", action="store_true")
    args = parser.parse_args()
    if args.check:
        check_runtime()
        return
    if args.worker:
        worker_loop()
        return
    parser.error("--check or --worker is required")


if __name__ == "__main__":
    main()
