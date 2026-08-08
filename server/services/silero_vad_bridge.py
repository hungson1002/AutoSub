"""Small, CPU-only bridge for streaming Silero VAD over a normalized WAV file.

The Node service passes a file path and receives only speech-region metadata on
stdout. Audio is read in bounded windows so neither Python nor Node needs to
hold a long recording in memory.
"""

from __future__ import annotations

import argparse
import json
import sys
import wave
from typing import Any


def fail(message: str) -> "NoReturn":
    print(message, file=sys.stderr)
    raise SystemExit(1)


def check_dependencies() -> None:
    try:
        import torch  # noqa: F401
        import silero_vad  # noqa: F401
    except Exception as error:  # pragma: no cover - depends on host Python
        fail(f"Silero VAD unavailable: {error}")
    print(json.dumps({"available": True}))


def load_audio_window(raw: bytes, torch: Any) -> Any:
    if not raw:
        return torch.empty(0, dtype=torch.float32)
    # clone() detaches the tensor from the temporary Python bytes buffer while
    # keeping this allocation bounded to one VAD window.
    return torch.frombuffer(bytearray(raw), dtype=torch.int16).clone().to(torch.float32) / 32768.0


def run_vad(args: argparse.Namespace) -> None:
    try:
        import torch
        from silero_vad import get_speech_timestamps, load_silero_vad
    except Exception as error:  # pragma: no cover - depends on host Python
        fail(f"Silero VAD unavailable: {error}")

    torch.set_num_threads(1)
    torch.set_grad_enabled(False)
    model = load_silero_vad(onnx=False)
    model.to("cpu")
    model.eval()

    sample_rate = 16000
    window_samples = 30 * sample_rate
    overlap_samples = 1 * sample_rate
    regions: list[dict[str, int]] = []

    try:
        with wave.open(args.audio_path, "rb") as audio:
            if audio.getnchannels() != 1 or audio.getsampwidth() != 2 or audio.getframerate() != sample_rate:
                fail("Silero VAD input must be mono 16 kHz PCM16 WAV")

            total_samples = audio.getnframes()
            position = 0
            while position < total_samples:
                audio.setpos(position)
                raw = audio.readframes(min(window_samples, total_samples - position))
                sample_count = len(raw) // 2
                if sample_count < 512:
                    break

                window = load_audio_window(raw, torch)
                timestamps = get_speech_timestamps(
                    window,
                    model,
                    threshold=max(0.05, min(0.95, args.threshold)),
                    sampling_rate=sample_rate,
                    min_speech_duration_ms=max(1, args.min_speech_ms),
                    min_silence_duration_ms=max(1, args.min_silence_ms),
                    speech_pad_ms=0,
                    return_seconds=False,
                )
                for timestamp in timestamps:
                    start = position + int(timestamp["start"])
                    end = position + int(timestamp["end"])
                    if end > start:
                        regions.append({"startMs": round(start * 1000 / sample_rate), "endMs": round(end * 1000 / sample_rate)})

                if position + sample_count >= total_samples:
                    break
                position += max(1, sample_count - overlap_samples)
    except wave.Error as error:
        fail(f"Silero VAD could not read WAV: {error}")

    print(json.dumps({"speechRegions": regions}, separators=(",", ":")))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("audio_path", nargs="?")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--threshold", type=float, default=0.5)
    parser.add_argument("--min-speech-ms", type=int, default=120)
    parser.add_argument("--min-silence-ms", type=int, default=100)
    return parser.parse_args()


if __name__ == "__main__":
    arguments = parse_args()
    if arguments.check:
        check_dependencies()
    elif not arguments.audio_path:
        fail("Silero VAD audio path is required")
    else:
        run_vad(arguments)
