"""FunASR bridge for AutoSub: Chinese-first ASR with subtitle-friendly timestamps."""
import argparse
import json
import os
import re
import sys
from pathlib import Path
from stt_runtime import background_priority

background_priority()


MODEL_SPECS = {
    "funasr-paraformer-zh": {
        "model": "funasr/paraformer-zh",
        "vad_model": "funasr/fsmn-vad",
        "punc_model": "ct-punc",
        "hub": "hf",
        "mode": "paraformer",
    },
    "funasr-sensevoice-small": {
        "model": "FunAudioLLM/SenseVoiceSmall",
        "vad_model": "funasr/fsmn-vad",
        "punc_model": "ct-punc",
        "hub": "hf",
        "mode": "sensevoice",
    },
    "funasr-nano-2512": {
        "model": "FunAudioLLM/Fun-ASR-Nano-2512",
        "vad_model": "funasr/fsmn-vad",
        "punc_model": "ct-punc",
        "hub": "hf",
        "mode": "nano",
    },
}

RICH_TAG_RE = re.compile(r"<\|[^|]*\|>")
SENTENCE_RE = re.compile(r"[^。！？!?；;\n]+[。！？!?；;]?")
SPEECH_UNIT_RE = re.compile(r"[\u3400-\u9fff]|[A-Za-z0-9]+(?:['._-][A-Za-z0-9]+)*|[^\s]")


def progress(value):
    print(f"FUNASR_PROGRESS {int(value)}", file=sys.stderr, flush=True)


def clean_text(value):
    if not isinstance(value, str):
        return ""
    text = re.sub(r"([。！？!?；;，,])\1+", r"\1", RICH_TAG_RE.sub("", value)).strip().lstrip("，。；,;").lstrip()
    return text if any(character.isalnum() for character in text) else ""


def speech_units(text):
    return [token for token in SPEECH_UNIT_RE.findall(clean_text(text)) if not re.fullmatch(r"[。！？!?；;，,、：:“”‘’（）()《》…\-]", token)]


def valid_timestamp_pair(value):
    return (
        isinstance(value, (list, tuple))
        and len(value) >= 2
        and isinstance(value[0], (int, float))
        and isinstance(value[1], (int, float))
        and value[0] >= 0
        and value[1] > value[0]
    )


def normalize_timestamp_pairs(value):
    if not isinstance(value, list):
        return []
    return [[float(item[0]), float(item[1])] for item in value if valid_timestamp_pair(item)]


def timestamp_dict_pairs(value):
    output = []
    if not isinstance(value, list):
        return output
    for item in value:
        if not isinstance(item, dict):
            continue
        start = item.get("start_time")
        end = item.get("end_time")
        token = clean_text(item.get("token", ""))
        if isinstance(start, (int, float)) and isinstance(end, (int, float)) and end > start >= 0:
            output.append((token, float(start) * 1000.0, float(end) * 1000.0))
    return output


def word_entries(text, timestamps, explicit_words=None):
    pairs = normalize_timestamp_pairs(timestamps)
    tokens = []
    if isinstance(explicit_words, list):
        tokens = [clean_text(item) for item in explicit_words if isinstance(item, str) and clean_text(item)]
    if not tokens:
        tokens = speech_units(text)
    if len(tokens) != len(pairs):
        return []
    return [
        {"word": token, "start": start_ms / 1000.0, "end": end_ms / 1000.0}
        for token, (start_ms, end_ms) in zip(tokens, pairs)
    ]


def sentence_segments_from_outer(text, timestamps):
    pairs = normalize_timestamp_pairs(timestamps)
    if not text or not pairs:
        return []
    sentences = [item.strip() for item in SENTENCE_RE.findall(text) if item.strip()]
    if not sentences:
        sentences = [text]
    counts = [len(speech_units(item)) for item in sentences]
    if sum(counts) != len(pairs):
        words = word_entries(text, pairs)
        return [{
            "start": pairs[0][0] / 1000.0,
            "end": pairs[-1][1] / 1000.0,
            "text": text,
            **({"words": words} if words else {}),
        }]
    output = []
    cursor = 0
    for sentence, count in zip(sentences, counts):
        if count <= 0:
            continue
        sentence_pairs = pairs[cursor:cursor + count]
        cursor += count
        words = word_entries(sentence, sentence_pairs)
        output.append({
            "start": sentence_pairs[0][0] / 1000.0,
            "end": sentence_pairs[-1][1] / 1000.0,
            "text": sentence,
            **({"words": words} if words else {}),
        })
    return output


def normalize_result(raw):
    items = raw if isinstance(raw, list) else [raw]
    all_segments = []
    full_text = []

    for item in items:
        if not isinstance(item, dict):
            continue
        text = clean_text(item.get("text", ""))
        if text:
            full_text.append(text)

        outer_pairs = normalize_timestamp_pairs(item.get("timestamp"))
        if not outer_pairs:
            nano_pairs = timestamp_dict_pairs(item.get("timestamps"))
            if nano_pairs:
                outer_pairs = [[start, end] for _, start, end in nano_pairs]

        sentence_info = item.get("sentence_info")
        segments = []
        if isinstance(sentence_info, list):
            for sentence in sentence_info:
                if not isinstance(sentence, dict):
                    continue
                sentence_text = clean_text(sentence.get("text") or sentence.get("sentence") or "")
                start = sentence.get("start")
                end = sentence.get("end")
                if not sentence_text or not isinstance(start, (int, float)) or not isinstance(end, (int, float)) or end <= start:
                    continue
                sentence_timestamps = sentence.get("timestamp")
                words = word_entries(sentence_text, sentence_timestamps)
                speaker = sentence.get("spk")
                segment = {
                    "start": float(start) / 1000.0,
                    "end": float(end) / 1000.0,
                    "text": sentence_text,
                }
                if words:
                    segment["words"] = words
                if speaker is not None:
                    segment["speaker_id"] = f"speaker_{speaker}"
                segments.append(segment)

        if not segments and text and outer_pairs:
            segments = sentence_segments_from_outer(text, outer_pairs)

        if not segments and text:
            # Last-resort fallback. VAD/punctuation normally supplies sentence_info
            # for Paraformer and SenseVoice; keep text rather than fabricating silence.
            segments = [{"start": 0.0, "end": 0.01, "text": text}]

        all_segments.extend(segments)

    # Drop the synthetic fallback duration when there are any real timed segments.
    real = [segment for segment in all_segments if segment["end"] - segment["start"] > 0.02]
    if real:
        all_segments = real

    return {"text": "".join(full_text), "segments": all_segments}


def choose_device(requested):
    import torch
    value = (requested or "auto").strip().lower()
    if value == "auto":
        return "cuda" if torch.cuda.is_available() else "cpu"
    if value.startswith("cuda") and not torch.cuda.is_available():
        raise RuntimeError("AUTOSUB_FUNASR_DEVICE yêu cầu CUDA nhưng PyTorch hiện tại không thấy GPU CUDA.")
    return value


def build_model(model_id, device, threads=2):
    from funasr import AutoModel
    spec = MODEL_SPECS[model_id]
    kwargs = {
        "model": spec["model"],
        "vad_model": spec["vad_model"],
        "punc_model": spec["punc_model"],
        "vad_kwargs": {"max_single_segment_time": 30000},
        "device": device,
        "ncpu": max(1, int(threads)),
        "hub": spec.get("hub", "hf"),
    }
    if spec["mode"] == "nano":
        kwargs["trust_remote_code"] = True
    from funasr_checkpoint import inference_checkpoint_loading
    with inference_checkpoint_loading():
        return AutoModel(**kwargs), spec["mode"]


def transcribe(args):
    import torch
    torch.set_num_threads(max(1, int(args.threads)))
    progress(3)
    device = choose_device(args.device)
    model, mode = build_model(args.model, device, args.threads)
    progress(20)
    kwargs = {
        "input": args.audio,
        "cache": {},
        "batch_size_s": 60,
        "batch_size_threshold_s": 30,
        "sentence_timestamp": True,
        "use_itn": True,
    }
    if args.language and args.language != "auto":
        kwargs["language"] = args.language
    if mode == "paraformer":
        kwargs["pred_timestamp"] = True
        kwargs["return_raw_text"] = True
    elif mode == "sensevoice":
        kwargs["output_timestamp"] = True
    progress(25)
    result = model.generate(**kwargs)
    progress(95)
    normalized = normalize_result(result)
    Path(args.output).write_text(json.dumps(normalized, ensure_ascii=False), encoding="utf-8")
    progress(100)


def check_runtime():
    from importlib.metadata import version
    import torch  # noqa: F401
    import soundfile  # noqa: F401
    import funasr  # noqa: F401
    expected = {
        "funasr": "1.4.16",
        "transformers": "4.51.0",
    }
    mismatches = [
        f"{package}={version(package)} (expected {wanted})"
        for package, wanted in expected.items()
        if version(package) != wanted
    ]
    if mismatches:
        raise RuntimeError("FunASR runtime cần cập nhật: " + ", ".join(mismatches))
    print("ok")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
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
    if not args.audio or not args.output or not args.model:
        parser.error("--audio, --output và --model là bắt buộc.")
    transcribe(args)


if __name__ == "__main__":
    main()
