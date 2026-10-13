"""Where bundled assets and per-user data live.

Frozen builds (PyInstaller) run from a single exe: assets are unpacked to a
temp dir (``sys._MEIPASS``), while user data sits next to the exe, so the tool
stays portable — copy the exe anywhere and it carries its own ``data/`` and
``config.local.json``. From source both are the project root.
"""
import os
import sys

_FROZEN = bool(getattr(sys, "frozen", False))
_USER_DIR = None


def is_frozen() -> bool:
    return _FROZEN


def resource_dir() -> str:
    """Read-only assets shipped inside the exe (``static/`` and friends)."""
    if _FROZEN:
        return sys._MEIPASS
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def user_dir() -> str:
    """Writable per-install data: ``data/`` and ``config.local.json``."""
    if not _FROZEN:
        return resource_dir()
    global _USER_DIR
    if _USER_DIR is None:
        _USER_DIR = _pick_user_dir()
    return _USER_DIR


def _pick_user_dir() -> str:
    """Exe folder when writable, else %LOCALAPPDATA% so the app still runs."""
    exe_dir = os.path.dirname(os.path.abspath(sys.executable))
    try:
        os.makedirs(exe_dir, exist_ok=True)
        probe = os.path.join(exe_dir, ".colmgr-write-test")
        with open(probe, "w", encoding="utf-8") as f:
            f.write("")
        os.remove(probe)
        return exe_dir
    except OSError:
        fallback = os.path.join(
            os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "itch-colmgr"
        )
        os.makedirs(fallback, exist_ok=True)
        return fallback
