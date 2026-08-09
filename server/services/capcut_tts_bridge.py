"""Small stdin/stdout bridge for the unofficial capcut-tts-api package.

AutoSub deliberately keeps the CapCut SDK in Python because the upstream
project implements CapCut's request signing there. The Node server sends one
JSON command, this process performs the SDK operation, and one JSON response
is written back. No API key is handled by this bridge.
"""

from __future__ import annotations

import base64
import json
import sys
import time
from typing import Any

if hasattr(sys.stdin, "reconfigure"):
    sys.stdin.reconfigure(encoding="utf-8")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

CATALOG_URL = "https://raw.githubusercontent.com/K07VN/capcut-tts-api/main/Voice.json"
FALLBACK_CATALOG = [
    {"lan": "vi", "lang": "vi-VN", "voice_type": "BV421_vivn_streaming", "display_name": "Nhỏ Ngọt Ngào", "resource_id": "7252594014782755330"},
    {"lan": "vi", "lang": "vi-VN", "voice_type": "vi_female_huong", "display_name": "Giọng Nữ Phổ Thông", "resource_id": "7264854897953083905"},
    {"lan": "vi", "lang": "vi-VN", "voice_type": "BV074_streaming_dsp", "display_name": "Giọng Bé", "resource_id": "7550087831092251920"},
    {"lan": "vi", "lang": "vi-VN", "voice_type": "BV074_streaming", "display_name": "Cô Gái Hoạt Ngôn", "resource_id": "7102355709945188865"},
    {"lan": "vi", "lang": "vi-VN", "voice_type": "BV562_streaming", "display_name": "Mai", "resource_id": "7483736254694035984"},
]


def clean_text(value: Any) -> str:
    """Remove lone surrogates before the SDK builds its UTF-8 SSML body."""
    return str(value).encode("utf-8", "replace").decode("utf-8")


def emit(value: dict[str, Any]) -> None:
    # Escape non-ASCII code points at the process boundary. This avoids a
    # Windows stdout codec failure if the upstream response contains an
    # unpaired surrogate; JSON.parse restores normal Unicode in Node.
    sys.stdout.write(json.dumps(value, ensure_ascii=True) + "\n")
    sys.stdout.flush()


def payload_object(task: dict[str, Any]) -> dict[str, Any]:
    payload = task.get("payload", {})
    if isinstance(payload, str):
        payload = json.loads(payload or "{}")
    return payload if isinstance(payload, dict) else {}


def catalog(client: Any) -> list[dict[str, Any]]:
    try:
        installed = client.list_voices()
        if installed:
            return [
                {"lan": getattr(item, "lan", ""), "lang": getattr(item, "lang", ""), "voice_type": getattr(item, "voice_type", ""), "display_name": getattr(item, "display_name", ""), "resource_id": getattr(item, "resource_id", "")}
                for item in installed
            ]
    except Exception:
        pass
    try:
        import requests
        response = requests.get(CATALOG_URL, timeout=20)
        response.raise_for_status()
        downloaded = response.json()
        if isinstance(downloaded, list) and downloaded:
            return downloaded
    except Exception:
        pass
    return FALLBACK_CATALOG


def voices(client: Any) -> list[dict[str, str]]:
    return [
        {
            "id": str(item.get("voice_type", "")),
            "name": str(item.get("display_name", "")),
            "language": str(item.get("lang", "") or item.get("lan", "")),
            "resourceId": str(item.get("resource_id", "")),
        }
        for item in catalog(client)
        if item.get("voice_type")
    ]


def generate_speech(client: Any, text: str, voice: str, resource_id: str | None, rate: str, timeout: float) -> dict[str, Any]:
    """Poll both statuses used by the live API: `success` and `succeed`."""
    created = client.create_tts_task(texts=text, voice=voice, resource_id=resource_id, rate=rate)
    tasks = ((created.get("data") or {}).get("tasks") or [])
    if not tasks:
        raise RuntimeError(f"CapCut TTS không trả về task: {created}")
    task_id = tasks[0].get("id")
    token = tasks[0].get("token")
    if not task_id or not token:
        raise RuntimeError("CapCut TTS trả task thiếu id hoặc token.")
    started = time.time()
    while time.time() - started < timeout:
        queried = client.query_tts_task(task_id, token)
        query_tasks = ((queried.get("data") or {}).get("tasks") or [])
        status = query_tasks[0].get("status") if query_tasks else None
        if status in ("success", "succeed"):
            return queried
        if status in ("failed", "error"):
            raise RuntimeError(f"CapCut TTS task thất bại: {query_tasks[0] if query_tasks else queried}")
        time.sleep(1.0)
    raise RuntimeError(f"CapCut TTS task timeout sau {timeout:.0f} giây.")


def main() -> None:
    raw = sys.stdin.readline()
    if not raw:
        raise RuntimeError("AutoSub CapCut bridge không nhận được lệnh.")
    request = json.loads(raw)
    from capcut_tts_api import CapCutClient

    client = CapCutClient()
    operation = request.get("op")
    if operation == "health":
        emit({"ok": True, "voiceCount": len(voices(client))})
        return
    if operation == "voices":
        emit({"ok": True, "voices": voices(client)})
        return
    if operation != "synthesize":
        raise ValueError(f"CapCut bridge không hỗ trợ operation: {operation}")

    text = clean_text(request.get("text", "")).strip()
    voice = clean_text(request.get("voice", "")).strip()
    if not text:
        raise ValueError("Nội dung TTS đang trống.")
    if not voice:
        raise ValueError("CapCut TTS cần Voice ID.")

    import requests

    resource_id = request.get("resourceId") or next((item.get("resource_id") for item in catalog(client) if str(item.get("voice_type", "")).lower() == voice.lower()), None)
    resource_id = clean_text(resource_id) if resource_id else None

    result = generate_speech(client, text, voice, resource_id or None, str(request.get("rate", "1.0")), float(request.get("timeout", 90)))
    tasks = ((result.get("data") or {}).get("tasks") or [])
    if not tasks:
        raise RuntimeError("CapCut TTS không trả về task hoàn tất.")
    audio_subtitles = payload_object(tasks[0]).get("audio_subtitles") or []
    speech_url = audio_subtitles[0].get("speech_url") if audio_subtitles else None
    if not speech_url:
        raise RuntimeError("CapCut TTS hoàn tất nhưng không có speech_url trong response.")
    audio_response = requests.get(speech_url, timeout=60)
    audio_response.raise_for_status()
    emit({
        "ok": True,
        "format": "mp3",
        "audioBase64": base64.b64encode(audio_response.content).decode("ascii"),
        "bytes": len(audio_response.content),
    })


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit({"ok": False, "error": str(error)})
        raise SystemExit(1)
