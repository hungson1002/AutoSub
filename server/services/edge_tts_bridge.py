"""One-shot JSON bridge for the unofficial edge-tts Python package."""

from __future__ import annotations

import asyncio
import base64
import json
import re
import sys
from typing import Any

if hasattr(sys.stdin, "reconfigure"):
    sys.stdin.reconfigure(encoding="utf-8")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

FALLBACK_VOICES = [
    {"id": "vi-VN-HoaiMyNeural", "name": "Hoài My · Nữ", "language": "vi-VN"},
    {"id": "vi-VN-NamMinhNeural", "name": "Nam Minh · Nam", "language": "vi-VN"},
]


def emit(value: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(value, ensure_ascii=True) + "\n")
    sys.stdout.flush()


def clean_text(value: Any) -> str:
    return str(value).encode("utf-8", "replace").decode("utf-8").strip()


def rate_from_speed(value: Any) -> str:
    try:
        speed = max(0.5, min(2.0, float(value)))
    except (TypeError, ValueError):
        speed = 1.0
    percent = round((speed - 1.0) * 100)
    return f"{percent:+d}%"


async def vietnamese_voices() -> list[dict[str, str]]:
    import edge_tts

    try:
        available = await edge_tts.list_voices()
        voices = [
            {
                "id": str(item.get("ShortName", "")),
                "name": ("Hoài My · Nữ" if item.get("ShortName") == "vi-VN-HoaiMyNeural" else "Nam Minh · Nam" if item.get("ShortName") == "vi-VN-NamMinhNeural" else str(item.get("FriendlyName") or item.get("ShortName") or "")),
                "language": str(item.get("Locale") or "vi-VN"),
            }
            for item in available
            if str(item.get("Locale", "")).lower() == "vi-vn" and item.get("ShortName")
        ]
        return voices or FALLBACK_VOICES
    except Exception:
        return FALLBACK_VOICES


async def stream_audio(text: str, voice: str, speed: Any, boundary: str = "SentenceBoundary") -> tuple[bytes, list[dict[str, Any]]]:
    import edge_tts

    last_error: Exception | None = None
    for attempt in range(3):
        try:
            communication = edge_tts.Communicate(
                text,
                voice,
                rate=rate_from_speed(speed),
                volume="+0%",
                pitch="+0Hz",
                boundary=boundary,
                connect_timeout=15,
                receive_timeout=90,
            )
            output = bytearray()
            boundaries: list[dict[str, Any]] = []
            async for chunk in communication.stream():
                if chunk.get("type") == "audio":
                    output.extend(chunk.get("data", b""))
                elif chunk.get("type") in ("WordBoundary", "SentenceBoundary"):
                    boundaries.append(chunk)
            if output:
                return bytes(output), boundaries
            raise RuntimeError("Edge TTS không trả về audio.")
        except Exception as error:
            last_error = error
            if attempt < 2:
                await asyncio.sleep(1.5 * (attempt + 1))
    raise RuntimeError(str(last_error or "Edge TTS thất bại."))


async def synthesize(text: str, voice: str, speed: Any) -> bytes:
    audio, _boundaries = await stream_audio(text, voice, speed)
    return audio


async def synthesize_batch(texts: list[str], voice: str, speed: Any) -> tuple[bytes, list[dict[str, int | None]]]:
    marker = "zzautosubngatzz"
    if not texts or len(texts) > 32:
        raise ValueError("Mỗi batch Edge TTS cần từ 1 đến 32 đoạn.")
    if any(marker in text.lower() for text in texts):
        raise ValueError("Nội dung chứa marker nội bộ của Edge TTS.")
    combined = f". {marker}. ".join(texts)
    if len(combined) > 30_000:
        raise ValueError("Batch Edge TTS quá dài.")
    audio, boundaries = await stream_audio(combined, voice, speed, "WordBoundary")
    marker_events = [
        event for event in boundaries
        if re.sub(r"[^a-z0-9]", "", str(event.get("text", "")).lower()) == marker
    ]
    if len(marker_events) != len(texts) - 1:
        raise RuntimeError(f"Edge TTS không trả đủ marker căn đoạn ({len(marker_events)}/{len(texts) - 1}).")
    ranges: list[dict[str, int | None]] = []
    for index in range(len(texts)):
        start_ms = 0 if index == 0 else round((float(marker_events[index - 1]["offset"]) + float(marker_events[index - 1]["duration"])) / 10_000)
        end_ms = None if index == len(texts) - 1 else round(float(marker_events[index]["offset"]) / 10_000)
        if end_ms is not None and end_ms <= start_ms:
            raise RuntimeError("Edge TTS trả về timestamp batch không hợp lệ.")
        ranges.append({"startMs": start_ms, "endMs": end_ms})
    return audio, ranges


async def run(request: dict[str, Any]) -> dict[str, Any]:
    import edge_tts  # noqa: F401 - dependency/health check

    operation = request.get("op")
    if operation in ("health", "voices"):
        voices = await vietnamese_voices()
        return {"ok": True, "voiceCount": len(voices), "voices": voices}
    if operation not in ("synthesize", "synthesize_batch"):
        raise ValueError(f"Edge TTS bridge không hỗ trợ operation: {operation}")

    voice = clean_text(request.get("voice", ""))
    if voice not in {item["id"] for item in FALLBACK_VOICES}:
        raise ValueError("Edge TTS chỉ cho phép chọn một trong hai giọng Việt đã kiểm tra.")
    if operation == "synthesize_batch":
        raw_texts = request.get("texts")
        if not isinstance(raw_texts, list):
            raise ValueError("Batch Edge TTS thiếu danh sách nội dung.")
        texts = [clean_text(item) for item in raw_texts]
        if any(not text for text in texts):
            raise ValueError("Batch Edge TTS có nội dung trống.")
        audio, ranges = await synthesize_batch(texts, voice, request.get("speed", 1.0))
        return {"ok": True, "format": "mp3", "audioBase64": base64.b64encode(audio).decode("ascii"), "bytes": len(audio), "ranges": ranges}

    text = clean_text(request.get("text", ""))
    if not text:
        raise ValueError("Nội dung TTS đang trống.")
    audio = await synthesize(text, voice, request.get("speed", 1.0))
    return {"ok": True, "format": "mp3", "audioBase64": base64.b64encode(audio).decode("ascii"), "bytes": len(audio)}


def main() -> None:
    raw = sys.stdin.readline()
    if not raw:
        raise RuntimeError("AutoSub Edge TTS bridge không nhận được lệnh.")
    request = json.loads(raw)
    emit(asyncio.run(run(request)))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit({"ok": False, "error": str(error)})
        raise SystemExit(1)
