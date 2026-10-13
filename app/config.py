"""Local configuration: config.local.json beside the user data dir."""
import copy
import json
import os

from . import paths

CONFIG_PATH = os.path.join(paths.user_dir(), "config.local.json")
DATA_DIR = os.path.join(paths.user_dir(), "data")

DEFAULTS = {
    "apiKey": "",
    "demoMode": False,
    "rateLimitPerSec": 1.0,
    "proxy": "http://127.0.0.1:7890",
    # Sidebar order, by collection title. A local view preference only: itch has
    # no endpoint that stores an order for the collection list, so this never
    # becomes part of a write.
    "collectionOrder": [],
}


def _coerce(key: str, value):
    """Accept `value` for `key` only when it holds the expected type.

    config.local.json is a hand-editable file: a stray string where a number
    belongs (or a truncated write) must degrade to the default instead of
    crashing the boot or poisoning a later float() conversion.
    """
    if key == "apiKey":
        return value if isinstance(value, str) else None
    if key == "demoMode":
        return value if isinstance(value, bool) else None
    if key == "proxy":
        return value if isinstance(value, str) else None
    if key == "collectionOrder":
        return [str(t) for t in value] if isinstance(value, list) else None
    if key == "rateLimitPerSec" and not isinstance(value, bool):
        try:
            return float(value)
        except (TypeError, ValueError):
            return None
    return None


def load() -> dict:
    cfg = copy.deepcopy(DEFAULTS)
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                stored = json.load(f)
        except (OSError, ValueError):
            return cfg          # unreadable or corrupt: fall back to defaults
        # Only known keys are honoured, so anything else in the file is ignored.
        if isinstance(stored, dict):
            for k in DEFAULTS:
                if k in stored:
                    v = _coerce(k, stored[k])
                    if v is not None:
                        cfg[k] = v
    return cfg


def atomic_write(path: str, text: str) -> None:
    """Write via temp file + replace so a crash cannot leave a half-written JSON."""
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def save(cfg: dict) -> None:
    atomic_write(CONFIG_PATH, json.dumps(cfg, ensure_ascii=False, indent=2))


def ensure_data_dir() -> None:
    os.makedirs(DATA_DIR, exist_ok=True)


def patch(**kwargs) -> dict:
    cfg = load()
    cfg.update(kwargs)
    save(cfg)
    return cfg
