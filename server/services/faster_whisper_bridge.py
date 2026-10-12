"""CPU INT8 transcription with native word timestamps and stable-ts regrouping."""
import argparse
import json
import os
import sys
from pathlib import Path
from stt_runtime import background_priority

background_priority()


def regroup_segment(segment):
    from stable_whisper import WhisperResult
    # Regroup one native segment at a time: confidence metadata and pauses
    # between source segments remain intact. No proportional/fake word times.
    result = WhisperResult({'segments': [segment]}, check_sorted=True)
    result.split_by_gap(.65).split_by_punctuation(['.', '?', '!', '。', '？', '！'])
    result.split_by_length(max_chars=76, max_words=16)
    return [{**item, **{key: segment[key] for key in
             ['avg_logprob', 'no_speech_prob', 'compression_ratio']}}
            for item in result.to_dict()['segments']]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--audio')
    parser.add_argument('--output')
    parser.add_argument('--model', choices=['small', 'medium'], default='small')
    parser.add_argument('--language', default='auto')
    parser.add_argument('--threads', type=int, default=2)
    parser.add_argument('--cache')
    args = parser.parse_args()
    import faster_whisper
    import stable_whisper
    import torch
    torch.set_num_threads(1)
    if args.check:
        from importlib.metadata import version
        for package, expected in [('faster-whisper', '1.2.1'), ('stable-ts', '2.19.1'), ('av', '16.1.0')]:
            if version(package) != expected:
                raise RuntimeError(f'{package} must be {expected}')
        print(json.dumps({'ready': True}))
        return
    threads = max(1, min(4, args.threads))
    model = faster_whisper.WhisperModel(args.model, device='cpu', compute_type='int8',
                                      cpu_threads=threads, num_workers=1,
                                      download_root=args.cache)
    segments, info = model.transcribe(
        args.audio, language=None if args.language == 'auto' else args.language,
        beam_size=5, best_of=1, word_timestamps=True, vad_filter=True,
        vad_parameters={'min_silence_duration_ms': 500, 'speech_pad_ms': 200},
        condition_on_previous_text=False, hallucination_silence_threshold=2,
        no_speech_threshold=.6, log_prob_threshold=-1, compression_ratio_threshold=2.4)
    output = []
    for segment in segments:
        raw = {'start': segment.start, 'end': segment.end, 'text': segment.text,
               'avg_logprob': segment.avg_logprob, 'no_speech_prob': segment.no_speech_prob,
               'compression_ratio': segment.compression_ratio,
               'words': [{'start': w.start, 'end': w.end, 'word': w.word,
                          'probability': w.probability} for w in segment.words or []]}
        if not (segment.no_speech_prob > .6 and segment.avg_logprob < -1):
            output.extend(regroup_segment(raw) if raw['words'] else [raw])
        print(f'progress = {min(99, int(segment.end / max(info.duration, .001) * 100))}%',
              file=sys.stderr, flush=True)
    payload = {'segments': output, 'language': info.language, 'duration': info.duration,
               'engine': 'faster-whisper', 'computeType': 'int8', 'regrouping': 'stable-ts'}
    destination = Path(args.output)
    temporary = destination.with_suffix('.partial')
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8')
    os.replace(temporary, destination)
    print('progress = 100%', file=sys.stderr, flush=True)


if __name__ == '__main__':
    main()
