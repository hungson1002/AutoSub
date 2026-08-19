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


class NativeOnnxSpeakerEncoder:
    """VieNeu speaker encoder with a small native Kaldi fbank frontend.

    The upstream fresh-clone path imports the multi-gigabyte PyTorch/torchaudio
    wheels only to calculate this 80-bin feature matrix. kaldi-native-fbank
    produces the same Kaldi features while the actual encoder remains ONNX.
    """

    def __init__(self, onnx_path: str, max_seconds: float = 30.0):
        import onnxruntime as ort

        self.session = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
        self.input_name = self.session.get_inputs()[0].name
        self.output_name = self.session.get_outputs()[0].name
        self.max_seconds = float(max_seconds)

    def embed(self, wav, sr: int):
        import kaldi_native_fbank as knf
        import numpy as np
        import soxr

        mono = np.asarray(wav, dtype=np.float32)
        if mono.ndim == 2:
            mono = mono.mean(axis=0) if mono.shape[0] <= mono.shape[1] else mono.mean(axis=1)
        mono = mono.reshape(-1)
        if self.max_seconds > 0:
            mono = mono[: int(sr * self.max_seconds)]
        if sr != 16000:
            mono = soxr.resample(mono, sr, 16000).astype(np.float32)
        options = knf.FbankOptions()
        options.frame_opts.samp_freq = 16000
        options.frame_opts.dither = 0.0
        options.mel_opts.num_bins = 80
        fbank = knf.OnlineFbank(options)
        fbank.accept_waveform(16000, mono.tolist())
        fbank.input_finished()
        if fbank.num_frames_ready <= 0:
            raise ValueError("Mẫu giọng không có đủ âm thanh để nhận dạng người nói.")
        features = np.stack([fbank.get_frame(index) for index in range(fbank.num_frames_ready)]).astype(np.float32)
        features -= features.mean(axis=0, keepdims=True)
        output = self.session.run([self.output_name], {self.input_name: features[None]})[0]
        return output[0].astype(np.float32)


def emit(value: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(value, ensure_ascii=True) + "\n")
    sys.stdout.flush()


def get_tts():
    global _tts
    if _tts is None:
        threads = max(1, min(4, int(os.environ.get("AUTOSUB_VIENEU_THREADS", "2"))))
        with contextlib.redirect_stdout(sys.stderr):
            from vieneu import Vieneu
            _tts = Vieneu(backend="onnx", threads=threads)
            speaker_path = _tts.engine._resolve_root_file("speaker_encoder.onnx")
            if not speaker_path:
                raise RuntimeError("Không tải được speaker_encoder.onnx của VieNeu.")
            _tts.engine.speaker_encoder = NativeOnnxSpeakerEncoder(speaker_path)
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
        # Reference profiles are levelled and edge-trimmed on upload, while the
        # model denoiser removes steady room noise before both the speaker
        # embedding and reference codes are extracted.
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
            apply_watermark=True,
            temperature=temperature,
            top_k=20,
            top_p=0.90,
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
