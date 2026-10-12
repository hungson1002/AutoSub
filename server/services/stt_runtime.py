"""Keep local inference below interactive applications in Windows scheduling."""
import os


def background_priority():
    if os.name != "nt" or os.environ.get("AUTOSUB_BACKGROUND_PRIORITY") == "0":
        return
    try:
        import ctypes
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.GetCurrentProcess.restype = ctypes.c_void_p
        kernel.SetPriorityClass.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
        kernel.SetPriorityClass(kernel.GetCurrentProcess(), 0x4000)  # BELOW_NORMAL
    except OSError:
        pass
