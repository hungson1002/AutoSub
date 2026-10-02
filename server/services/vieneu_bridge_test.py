"""Cache-first model loading regressions; no model or network needed."""
import importlib.util
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("bridge", Path(__file__).with_name("vieneu_bridge.py"))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class CachedModelTests(unittest.TestCase):
    def setUp(self):
        bridge._tts = None
        self.directory = tempfile.TemporaryDirectory()
        self.cached = Path(self.directory.name) / "model"
        self.cached.write_bytes(b"cached")
        self.constants = types.SimpleNamespace(HF_HUB_OFFLINE=False)
        self.hub = types.SimpleNamespace(constants=self.constants, try_to_load_from_cache=lambda *_: str(self.cached))
        self.modules = patch.dict("sys.modules", {"huggingface_hub": self.hub})
        self.modules.start()

    def tearDown(self):
        self.modules.stop()
        self.directory.cleanup()
        bridge._tts = None

    def test_cache_requires_all_artifacts_to_exist(self):
        self.assertTrue(bridge.model_cache_complete())
        self.hub.try_to_load_from_cache = lambda _, name: None if name.endswith("tokenizer.json") else str(self.cached)
        self.assertFalse(bridge.model_cache_complete())

    def test_cached_constructor_is_offline_and_restores_original_setting(self):
        seen = []
        with patch.dict("sys.modules", {"vieneu": types.SimpleNamespace(Vieneu=lambda **_: seen.append(self.constants.HF_HUB_OFFLINE) or object())}):
            bridge.get_tts()
        self.assertEqual(seen, [True])
        self.assertFalse(self.constants.HF_HUB_OFFLINE)

    def test_incomplete_cache_keeps_download_path(self):
        self.hub.try_to_load_from_cache = lambda *_: None
        seen = []
        with patch.dict("sys.modules", {"vieneu": types.SimpleNamespace(Vieneu=lambda **_: seen.append(self.constants.HF_HUB_OFFLINE) or object())}):
            bridge.get_tts()
        self.assertEqual(seen, [False])

    def test_failed_load_restores_setting(self):
        def fail(**_):
            raise RuntimeError("invalid model")
        with patch.dict("sys.modules", {"vieneu": types.SimpleNamespace(Vieneu=fail)}):
            with self.assertRaises(RuntimeError):
                bridge.get_tts()
        self.assertFalse(self.constants.HF_HUB_OFFLINE)


class VoiceCacheTests(unittest.TestCase):
    def test_alternating_actors_reuse_reference_codes_with_bounded_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            files=[]
            for index in range(5):
                reference=Path(directory)/f"{index}.wav"
                reference.write_bytes(b"voice")
                files.append(reference)
            calls=[]
            tts=types.SimpleNamespace(encode_reference=lambda reference, **_: calls.append(reference) or ("speaker", "codes"))
            bridge._voice_cache.clear()
            with patch.object(bridge,"get_tts",return_value=tts):
                first=bridge.enrolled_voice(str(files[0]))
                bridge.enrolled_voice(str(files[1]))
                self.assertIs(bridge.enrolled_voice(str(files[0])),first)
                self.assertEqual(len(calls),2)
                for reference in files[2:]: bridge.enrolled_voice(str(reference))
                self.assertEqual(len(bridge._voice_cache),4)
                self.assertIn(str(files[0].resolve()),bridge._voice_cache)
                self.assertNotIn(str(files[1].resolve()),bridge._voice_cache)
            bridge._voice_cache.clear()


if __name__ == "__main__":
    unittest.main()
