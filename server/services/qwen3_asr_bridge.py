"""Qwen3-ASR bridge for AutoSub with Qwen3 ForcedAligner timestamps.

Segmentation follows the same broad strategy used by mature subtitle pipelines:
sentence punctuation first, real speech gaps second, length only as a trigger to
look for a nearby safe boundary. A duration/character limit never directly cuts
between two Chinese alignment units.
"""
import argparse
import json
import os
import re
import sys
from importlib.metadata import version
from pathlib import Path
from stt_runtime import background_priority

background_priority()

MODEL_SPECS = {
    "qwen3-asr-0.6b": "Qwen/Qwen3-ASR-0.6B",
    "qwen3-asr-1.7b": "Qwen/Qwen3-ASR-1.7B",
}
ALIGNER_MODEL = "Qwen/Qwen3-ForcedAligner-0.6B"

STRONG_END_RE = re.compile(r"[。！？!?…]+[”’\"）)\]】》]*$")
WEAK_END_RE = re.compile(r"[，,、；;：:]+[”’\"）)\]】》]*$")
VISIBLE_RE = re.compile(r"[^\s，,、；;：:。！？!?…“”‘’\"（）()\[\]【】《》]")


def progress(value):
    print(f"QWEN3_ASR_PROGRESS {int(value)}", file=sys.stderr, flush=True)


def choose_device(requested):
    import torch
    value = (requested or "auto").strip().lower()
    if value == "auto":
        return "cuda:0" if torch.cuda.is_available() else "cpu"
    if value.startswith("cuda") and not torch.cuda.is_available():
        raise RuntimeError("AUTOSUB_QWEN3_ASR_DEVICE yêu cầu CUDA nhưng PyTorch hiện tại không thấy GPU CUDA.")
    if value == "cuda":
        return "cuda:0"
    return value


def choose_dtype(device):
    import torch
    if str(device).startswith("cuda"):
        return torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    return torch.float32


def smart_join(tokens):
    output = ""
    for token in tokens:
        token = str(token or "").strip()
        if not token:
            continue
        if not output:
            output = token
            continue
        if re.fullmatch(r"[。！？!?；;，,、：:“”‘’（）()《》…]+", token):
            output += token
        elif re.search(r"[\u3400-\u9fff]$", output) or re.match(r"^[\u3400-\u9fff]", token):
            output += token
        else:
            output += " " + token
    return output.strip()


def _visible_len(items):
    return sum(len(VISIBLE_RE.findall(item["text"])) for item in items)


def _gap(left, right):
    if not right:
        return 0.0
    return max(0.0, float(right["start"]) - float(left["end"]))


def _boundary_strength(left, right):
    """Return (score, kind) for a safe cut after left.

    Strong sentence punctuation and clear silence dominate. Commas and shorter
    pauses are candidates only when a sentence has become long enough.
    """
    text = left["text"].strip()
    gap = _gap(left, right)
    if STRONG_END_RE.search(text):
        return 1000.0, "sentence"
    if gap >= 0.55:
        return 900.0 + min(gap, 1.5) * 20.0, "silence"
    if WEAK_END_RE.search(text):
        return 520.0 + min(gap, 0.5) * 50.0, "clause"
    if gap >= 0.32:
        return 460.0 + gap * 50.0, "pause"
    if gap >= 0.18:
        return 260.0 + gap * 40.0, "micro-pause"
    if gap >= 0.10:
        return 120.0 + gap * 30.0, "tiny-pause"
    return 0.0, ""


def _emit_segment(items):
    return {
        "start": items[0]["start"],
        "end": items[-1]["end"],
        "text": smart_join([entry["text"] for entry in items]),
        "words": [
            {"word": entry["text"], "start": entry["start"], "end": entry["end"]}
            for entry in items
        ],
    }


def _best_safe_boundary(clean, start_index, end_index, target_duration=6.0, emergency=False):
    """Pick a natural cut inside clean[start_index:end_index].

    Never returns a boundary solely because a length limit was reached. For an
    emergency long sentence, even the fallback must have a measurable acoustic
    gap; otherwise the sentence is kept intact rather than splitting a Chinese
    word/phrase arbitrarily.
    """
    if end_index - start_index < 2:
        return None
    segment_start = clean[start_index]["start"]
    segment_end = clean[end_index - 1]["end"]
    candidates = []
    for boundary in range(start_index + 1, end_index):
        left = clean[boundary - 1]
        right = clean[boundary]
        left_duration = left["end"] - segment_start
        right_duration = segment_end - right["start"]
        if left_duration < 0.75 or right_duration < 0.55:
            continue
        score, kind = _boundary_strength(left, right)
        if not score:
            continue
        if kind == "tiny-pause" and not emergency:
            continue
        if kind == "micro-pause" and not emergency and left_duration < 4.5:
            continue
        distance_penalty = abs(left_duration - target_duration) * 9.0
        candidates.append((score - distance_penalty, boundary, kind))
    if not candidates:
        return None
    candidates.sort(key=lambda item: item[0], reverse=True)
    return candidates[0][1]


def build_segments(items):
    clean = []
    for item in items or []:
        text = str(getattr(item, "text", "") or "").strip()
        start = getattr(item, "start_time", None)
        end = getattr(item, "end_time", None)
        if not text or not isinstance(start, (int, float)) or not isinstance(end, (int, float)) or end <= start:
            continue
        clean.append({"text": text, "start": float(start), "end": float(end)})
    if not clean:
        return []

    # Philosophy:
    #   1) sentence punctuation => cut immediately;
    #   2) clear >=550ms speech gap => cut immediately;
    #   3) when a sentence is getting long, search backwards/nearby for a comma
    #      or real pause;
    #   4) if no safe boundary exists, KEEP THE SENTENCE LONGER. Never split
    #      because "7 seconds elapsed" or "60 chars reached".
    SOFT_MAX_SECONDS = 7.5
    SOFT_MAX_CHARS = 42
    HARD_MAX_SECONDS = 13.5
    HARD_MAX_CHARS = 76

    segments = []
    start_index = 0
    index = 0
    while index < len(clean):
        item = clean[index]
        next_item = clean[index + 1] if index + 1 < len(clean) else None
        duration = item["end"] - clean[start_index]["start"]
        current_items = clean[start_index:index + 1]
        visible_chars = _visible_len(current_items)
        score, kind = _boundary_strength(item, next_item)

        immediate = next_item is None or kind in ("sentence", "silence")
        if immediate:
            segments.append(_emit_segment(current_items))
            start_index = index + 1
            index += 1
            continue

        if duration >= SOFT_MAX_SECONDS or visible_chars >= SOFT_MAX_CHARS:
            boundary = _best_safe_boundary(clean, start_index, index + 2, target_duration=6.0, emergency=False)
            if boundary is not None and boundary > start_index:
                segments.append(_emit_segment(clean[start_index:boundary]))
                start_index = boundary
                # Re-evaluate from the first item of the remaining phrase so a
                # comma chosen behind the current cursor does not drop tokens.
                index = max(start_index, index)
                continue

        if duration >= HARD_MAX_SECONDS or visible_chars >= HARD_MAX_CHARS:
            boundary = _best_safe_boundary(clean, start_index, index + 2, target_duration=8.0, emergency=True)
            if boundary is not None and boundary > start_index:
                segments.append(_emit_segment(clean[start_index:boundary]))
                start_index = boundary
                index = max(start_index, index)
                continue
            # No punctuation and no measurable speech gap: intentionally keep
            # accumulating. Correct sentence/word boundaries are more important
            # than an arbitrary display-length target.

        index += 1

    if start_index < len(clean):
        segments.append(_emit_segment(clean[start_index:]))
    return [segment for segment in segments if segment["text"].strip()]


def fallback_segment(audio_path, text):
    import soundfile as sf
    duration = float(sf.info(audio_path).duration)
    if not text.strip() or duration <= 0:
        return []
    return [{"start": 0.0, "end": max(0.01, duration), "text": text.strip()}]


def self_test_segmentation():
    from types import SimpleNamespace

    tokens = [
        "搭", "上", "了", "跳", "板，", "准", "备", "骑", "摩", "托", "车",
        "冲", "进", "去，", "结", "果", "又", "卡", "在", "了", "围", "墙",
        "上，", "最", "终", "掏", "出", "了", "天", "地", "炸", "药，",
        "直", "奔", "他", "家", "而", "去。",
    ]
    items = [
        SimpleNamespace(text=token, start_time=index * 0.4, end_time=index * 0.4 + 0.38)
        for index, token in enumerate(tokens)
    ]
    segments = build_segments(items)
    texts = [segment["text"] for segment in segments]
    if any(left.endswith("结") and right.startswith("果") for left, right in zip(texts, texts[1:])):
        raise RuntimeError("Segmentation regression: split Chinese word 结果 across cues")
    if not any("结果" in text for text in texts):
        raise RuntimeError(f"Segmentation regression: 结果 not preserved in one cue: {texts}")
    print(json.dumps(texts, ensure_ascii=True))


def transcribe(args):
    import torch
    from qwen_asr import Qwen3ASRModel

    torch.set_num_threads(max(1, int(args.threads)))
    device = choose_device(args.device)
    dtype = choose_dtype(device)
    model_path = MODEL_SPECS[args.model]
    progress(5)

    model = Qwen3ASRModel.from_pretrained(
        model_path,
        forced_aligner=ALIGNER_MODEL,
        forced_aligner_kwargs={
            "device_map": device,
            "dtype": dtype,
        },
        max_inference_batch_size=1,
        max_new_tokens=512,
        device_map=device,
        dtype=dtype,
        low_cpu_mem_usage=True,
    )
    progress(45)

    forced_language = None if args.language == "auto" else args.language
    # Use Qwen's official integrated timestamp path. It handles ASR chunking,
    # forced alignment and timestamp offset merging in one contract.
    result = model.transcribe(
        audio=args.audio,
        language=forced_language,
        return_time_stamps=True,
    )[0]
    text = str(result.text or "").strip()
    language = str(result.language or forced_language or "").strip()
    progress(88)

    aligned = getattr(result, "time_stamps", None)
    aligned_items = getattr(aligned, "items", aligned) if aligned is not None else []
    segments = build_segments(aligned_items or [])
    progress(96)

    if not segments:
        segments = fallback_segment(args.audio, text)

    Path(args.output).write_text(json.dumps({
        "text": text,
        "language": language,
        "segments": segments,
    }, ensure_ascii=False), encoding="utf-8")
    progress(100)


def check_runtime():
    import torch  # noqa: F401
    import soundfile  # noqa: F401
    import qwen_asr  # noqa: F401
    installed = version("qwen-asr")
    if installed != "0.0.6":
        raise RuntimeError(f"Qwen3-ASR runtime cần cập nhật: qwen-asr={installed} (expected 0.0.6)")
    print("ok")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--self-test-segmentation", action="store_true")
    parser.add_argument("--audio")
    parser.add_argument("--output")
    parser.add_argument("--model", choices=sorted(MODEL_SPECS))
    parser.add_argument("--language", default="auto")
    parser.add_argument("--threads", default=str(max(1, os.cpu_count() // 2 if os.cpu_count() else 4)))
    parser.add_argument("--device", default="auto")
    args = parser.parse_args()

    if args.check:
        check_runtime()
        return
    if args.self_test_segmentation:
        self_test_segmentation()
        return
    if not args.audio or not args.output or not args.model:
        parser.error("--audio, --output và --model là bắt buộc.")
    transcribe(args)


if __name__ == "__main__":
    main()
