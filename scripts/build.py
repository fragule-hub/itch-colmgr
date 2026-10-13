"""One-command build for itch-colmgr.

    python scripts/build.py                 # one-file, windowed (default)
    python scripts/build.py --console       # one-file, keeps a console
    python scripts/build.py --onedir        # one-folder (faster start)
    python scripts/build.py --onedir --console

Wraps PyInstaller so nobody has to remember the flags, and prints the size of
what came out. The spec file (itch_colmgr.spec) stays the single source of
truth for what goes into the build; this only drives it.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPEC = "itch_colmgr.spec"
DIST = os.path.join(ROOT, "dist")


def _mb(path: str) -> float:
    return os.path.getsize(path) / (1024 * 1024)


def _dir_mb(path: str) -> float:
    total = 0
    for base, _dirs, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(base, f))
            except OSError:
                pass
    return total / (1024 * 1024)


def _have_pyinstaller() -> bool:
    try:
        import PyInstaller  # noqa: F401
    except ImportError:
        return False
    return True


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Build itch-colmgr with PyInstaller.")
    ap.add_argument("--onedir", action="store_true",
                    help="one-folder build (starts faster, ships a directory)")
    ap.add_argument("--console", action="store_true",
                    help="keep the console window (diagnosable headless runs)")
    ap.add_argument("--no-clean", action="store_true",
                    help="reuse PyInstaller's cache instead of rebuilding clean")
    ap.add_argument("--quiet", action="store_true",
                    help="only print the final result")
    args = ap.parse_args(argv)

    if not _have_pyinstaller():
        print("PyInstaller is not installed in this interpreter.\n"
              f"    {sys.executable} -m pip install pyinstaller",
              file=sys.stderr)
        return 1

    env = dict(os.environ)
    env["COLMGR_BUILD_ONEDIR"] = "1" if args.onedir else "0"
    env["COLMGR_BUILD_CONSOLE"] = "1" if args.console else "0"

    cmd = [sys.executable, "-m", "PyInstaller", "--noconfirm"]
    if not args.no_clean:
        cmd.append("--clean")
    cmd.append(SPEC)

    label = ("one-folder" if args.onedir else "one-file") + \
            (", console" if args.console else ", windowed")
    print(f"Building itch-colmgr ({label}) …")
    proc = subprocess.run(
        cmd, cwd=ROOT, env=env,
        stdout=subprocess.DEVNULL if args.quiet else None,
        stderr=subprocess.DEVNULL if args.quiet else None,
    )
    if proc.returncode != 0:
        print("Build failed.", file=sys.stderr)
        return proc.returncode

    # Report the artifact this variant produces (the other may still be lying
    # around in dist/ from an earlier build).
    if args.onedir:
        target = os.path.join(DIST, "itch-colmgr")
        size = _dir_mb(target) if os.path.isdir(target) else 0.0
    else:
        target = os.path.join(DIST, "itch-colmgr.exe")
        size = _mb(target) if os.path.exists(target) else 0.0

    if not size:
        print("Build reported success but no artifact was found.", file=sys.stderr)
        return 1
    print(f"OK: {target}  ({size:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
