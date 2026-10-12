import sys
import types
import unittest
from unittest.mock import patch
from contextlib import nullcontext
from funasr_bridge import build_model, clean_text, normalize_result


class ThreadTests(unittest.TestCase):
    def test_native_punctuation_is_not_doubled_or_a_fake_transcript(self):
        self.assertEqual(clean_text("<|zh|>你好，，世界。。"), "你好，世界。")
        self.assertEqual(clean_text("。"), "")
        self.assertEqual(clean_text("。小兰说，"), "小兰说，")
        self.assertEqual(clean_text(".5"), ".5")

    def test_sentence_boundaries_do_not_repeat_punctuation_from_the_previous_sentence(self):
        result = normalize_result({"text": "晚上，，小明来到河边。。小兰说，回家吧。", "sentence_info": [
            {"text": "晚上，", "start": 0, "end": 1000},
            {"text": "，小明来到河边。", "start": 1000, "end": 3000},
            {"text": "。小兰说，回家吧。", "start": 3000, "end": 5000},
        ]})
        self.assertEqual(''.join(item['text'] for item in result['segments']), "晚上，小明来到河边。小兰说，回家吧。")
        self.assertEqual(result['segments'][1]['start'], 1.0)
        self.assertEqual(result['segments'][1]['end'], 3.0)

    def test_cpu_budget_is_passed_to_asr_vad_and_punctuation_owner(self):
        fake = types.ModuleType("funasr")
        fake.AutoModel = lambda **kwargs: kwargs
        with patch.dict(sys.modules, {"funasr": fake}), patch("funasr_checkpoint.inference_checkpoint_loading", return_value=nullcontext()):
            kwargs, _ = build_model("funasr-paraformer-zh", "cpu", 2)
        self.assertEqual(kwargs["ncpu"], 2)
        self.assertEqual(kwargs["device"], "cpu")

    @unittest.skipUnless(__import__("os").environ.get("STT_TEST_REAL_LOADER") == "1", "Requires installed FunASR runtime")
    def test_memory_safe_loader_preserves_every_parameter_bit(self):
        import tempfile
        import torch
        from importlib import import_module
        from pathlib import Path
        from funasr_checkpoint import inference_checkpoint_loading
        torch.set_num_threads(1)
        loader = import_module("funasr.train_utils.load_pretrained_model")
        with tempfile.TemporaryDirectory() as directory:
            source = torch.nn.Linear(4, 2)
            checkpoint = Path(directory) / "weights.pt"
            torch.save(source.state_dict(), checkpoint)
            before, after = torch.nn.Linear(4, 2), torch.nn.Linear(4, 2)
            original_copy, original_torch = loader.copy, loader.torch
            loader.load_pretrained_model(str(checkpoint), before, scope_map=[])
            with inference_checkpoint_loading():
                loader.load_pretrained_model(str(checkpoint), after, scope_map=[])
            self.assertIs(loader.copy, original_copy)
            self.assertIs(loader.torch, original_torch)
            for name, value in before.state_dict().items():
                self.assertTrue(torch.equal(value, after.state_dict()[name]))


if __name__ == "__main__":
    unittest.main()
