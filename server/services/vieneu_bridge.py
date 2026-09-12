"""Persistent JSON-lines bridge for VieNeu-TTS v3 Turbo ONNX voice cloning."""

from __future__ import annotations

import contextlib
import json
import os
from pathlib import Path
import sys
import traceback
from typing import Any

if hasattr(sys.stdin, "reconfigure"):
    sys.stdin.reconfigure(encoding="utf-8")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

_tts = None
_voice_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def emit(value: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(value, ensure_ascii=True) + "\n")
    sys.stdout.flush()


def get_tts():
    global _tts
    if _tts is None:
        threads = max(1, min(4, int(os.environ.get("AUTOSUB_VIENEU_THREADS", "2"))))
        with contextlib.redirect_stdout(sys.stderr):
            from vieneu import Vieneu

            # VieNeu >= 3.6 has a torch-free ONNX speaker encoder. Its audio
            # frontend is part of the model pipeline and must not be replaced.
            _tts = Vieneu(backend="onnx", precision="fp32", threads=threads)
    return _tts


def enrolled_voice(reference_path: str) -> dict[str, Any]:
    reference = Path(reference_path).resolve(strict=True)
    if not reference.is_file():
        raise ValueError("Không tìm thấy file mẫu giọng.")
    key = str(reference)
    modified = reference.stat().st_mtime
    cached = _voice_cache.get(key)
    if cached and cached[0] == modified:
        return cached[1]
    tts = get_tts()
    with contextlib.redirect_stdout(sys.stderr):
        # VieNeu trims, denoises and extracts both the speaker embedding and
        # reference codes. Keeping both is important for timbre and prosody.
        speaker_emb, codes = tts.encode_reference(reference, denoise=True)
    voice = {"speaker_emb": speaker_emb, "codes": codes}
    _voice_cache.clear()
    _voice_cache[key] = (modified, voice)
    return voice


def run(request: dict[str, Any]) -> dict[str, Any]:
    operation = request.get("op")
    if operation == "health":
        import vieneu  # noqa: F401

        return {"ok": True}
    if operation != "synthesize":
        raise ValueError(f"VieNeu bridge không hỗ trợ operation: {operation}")
    text = str(request.get("text", "")).strip()
    if not text:
        raise ValueError("Nội dung TTS đang trống.")
    output = Path(str(request.get("outputPath", ""))).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    preset_name = str(request.get("presetName", "")).strip()
    voice = preset_name if preset_name else enrolled_voice(str(request.get("referencePath", "")))
    tts = get_tts()
    temperature = max(0.35, min(1.0, float(request.get("temperature", 0.75))))
    with contextlib.redirect_stdout(sys.stderr):
        audio = tts.infer(
            text,
            voice=voice,
            denoise=False,
            show_progress=False,
            # The exported track is already rendered locally; the optional
            # watermark can sound like a faint doubled voice on short cues.
            apply_watermark=False,
            temperature=temperature,
            top_k=25,
            top_p=0.95,
            repetition_penalty=1.2,
        )
        tts.save(audio, str(output))
    return {"ok": True, "bytes": output.stat().st_size, "sampleRate": 48000}


def main() -> None:
    for line in sys.stdin:
        request_id = ""
        try:
            request = json.loads(line)
            request_id = str(request.get("requestId", ""))
            emit({"requestId": request_id, **run(request)})
        except Exception as error:
            traceback.print_exc(file=sys.stderr)
            emit({"requestId": request_id, "ok": False, "error": str(error)})


if __name__ == "__main__":
    main()
