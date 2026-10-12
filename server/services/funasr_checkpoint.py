"""Avoid a redundant tensor clone in the pinned FunASR inference loader."""
from contextlib import contextmanager
from importlib import import_module
from types import SimpleNamespace
import os
import zipfile


@contextmanager
def inference_checkpoint_loading():
    loader = import_module("funasr.train_utils.load_pretrained_model")
    original = loader.copy
    original_torch = loader.torch
    def load(path, *args, **kwargs):
        # Read tensor storage from the existing file instead of allocating a
        # second full checkpoint in RAM. Older non-ZIP checkpoints keep their
        # normal loading path.
        if isinstance(path, (str, os.PathLike)) and zipfile.is_zipfile(path):
            kwargs.setdefault("mmap", True)
        return original_torch.load(path, *args, **kwargs)
    # FunASR 1.4.16 only reads src_state, then copies parameters through
    # load_state_dict. The source checkpoint can therefore be shared unchanged.
    loader.copy = SimpleNamespace(deepcopy=lambda state: state)
    loader.torch = SimpleNamespace(load=load)
    try:
        yield
    finally:
        loader.copy = original
        loader.torch = original_torch
