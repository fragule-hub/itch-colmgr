# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for itch-colmgr — one source of truth for the build.

Build it with the helper (recommended), which sets the env vars below and
reports the result size:

    python scripts/build.py                # one-file, windowed (default, ~17 MB)
    python scripts/build.py --console      # one-file, keeps a console for logs
    python scripts/build.py --onedir       # one-folder, starts faster
    python scripts/build.py --onedir --console

or call PyInstaller directly for the default one-file windowed build:

    pyinstaller --noconfirm --clean itch_colmgr.spec

Output: dist/itch-colmgr.exe (one-file) or dist/itch-colmgr/ (one-folder).
Double-click it and it serves the UI on 127.0.0.1, opens the browser, and shows
a launcher window that quits the server when closed.

The env switches exist so the two variants share this file instead of keeping a
commented-out copy of the EXE/COLLECT block in sync by hand:

    COLMGR_BUILD_ONEDIR=1    one-folder build (EXE + COLLECT) instead of one-file
    COLMGR_BUILD_CONSOLE=1   keep the console window (useful for --console runs)
"""
import os
import re

from PyInstaller.utils.win32.versioninfo import (
    FixedFileInfo,
    StringFileInfo,
    StringStruct,
    StringTable,
    VarFileInfo,
    VarStruct,
    VSVersionInfo,
)

block_cipher = None

ONEDIR = os.environ.get("COLMGR_BUILD_ONEDIR") == "1"
CONSOLE = os.environ.get("COLMGR_BUILD_CONSOLE") == "1"

# Only what the frozen app actually imports is kept. Verified against the
# runtime import graph (import uvicorn + fastapi + app.server): everything below
# is absent from sys.modules at import time and is not imported lazily on any
# path this tool uses. setuptools is by far the largest (~820 KB compressed).
#
# Deliberately NOT excluded, because the app needs them at runtime:
#   multiprocessing / concurrent.futures  (uvicorn imports them)
#   click                                 (uvicorn/__init__ -> uvicorn.main)
#   ast / unicodedata / email / http       (pydantic, starlette, httpx)
EXCLUDES = [
    # Build- and install-time only.
    "setuptools", "setuptools._distutils", "_distutils_hack", "pkg_resources",
    "packaging", "pip", "wheel",
    # stdlib reachable only from the interpreter's own help/CLI surfaces.
    "pydoc", "pydoc_data", "doctest", "unittest", "argparse", "difflib",
    # stdlib reachable only from unused protocol handlers / CLIs.
    "xmlrpc", "smtplib", "ftplib", "imaplib", "poplib", "nntplib",
    "telnetlib", "netrc", "tty", "rlcompleter", "getpass", "sqlite3",
    "curses", "lib2to3", "idlelib", "tarfile",
    # Heavy third-party that PyInstaller hooks sometimes drag in via tests.
    "numpy", "PIL", "pillow", "pandas", "matplotlib", "scipy", "IPython",
    "pytest", "nose", "tkinter.test", "test",
]

# One source of truth for the version: app/__init__.py. The paths below are
# relative to the project root, same as datas= and icon=, so run pyinstaller
# from there.
with open("app/__init__.py", encoding="utf-8") as _f:
    VERSION = re.search(r'__version__\s*=\s*"([^"]+)"', _f.read()).group(1)


def _vtuple(v: str) -> tuple:
    """'1.0.0' -> (1, 0, 0, 0); Windows wants exactly four parts."""
    parts = [int(x) for x in v.split(".") if x.isdigit()]
    return tuple((parts + [0, 0, 0, 0])[:4])


_v = _vtuple(VERSION)

a = Analysis(
    ["main.py"],
    pathex=[],
    binaries=[],
    datas=[("static", "static")],
    hiddenimports=[
        # uvicorn resolves these through importlib at load() time, which
        # static analysis cannot follow, so name them here.
        "uvicorn.protocols.http.h11_impl",
        "uvicorn.lifespan.on",
        # tkinter is imported inside main.py's launcher path.
        "tkinter",
        "tkinter.ttk",
        "tkinter.messagebox",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=EXCLUDES,
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

version_info = VSVersionInfo(
    ffi=FixedFileInfo(
        filevers=_v,
        prodvers=_v,
        mask=0x3F,
        flags=0x0,
        OS=0x40004,
        fileType=0x1,
        subtype=0x0,
        date=(0, 0),
    ),
    kids=[
        StringFileInfo([
            StringTable(
                "080404B0",
                [
                    StringStruct("FileDescription", "itch collection manager"),
                    StringStruct("FileVersion", f"{VERSION}.0"),
                    StringStruct("ProductName", "itch-colmgr"),
                    StringStruct("ProductVersion", f"{VERSION}.0"),
                    StringStruct("OriginalFilename", "itch-colmgr.exe"),
                ],
            )
        ]),
        VarFileInfo([VarStruct("Translation", [0x0804, 1200])]),
    ],
)

if ONEDIR:
    # One-folder: no unpacking on every launch, so it starts faster, at the cost
    # of shipping a directory instead of a single file.
    exe = EXE(
        pyz,
        a.scripts,
        [],
        exclude_binaries=True,
        name="itch-colmgr",
        debug=False,
        bootloader_ignore_signals=False,
        strip=False,
        upx=False,
        console=CONSOLE,
        disable_windowed_traceback=False,
        argv_emulation=False,
        target_arch=None,
        codesign_identity=None,
        entitlements_file=None,
        version=version_info,
        icon="assets/icon.ico",
    )
    coll = COLLECT(
        exe,
        a.binaries,
        a.zipfiles,
        a.datas,
        strip=False,
        upx=False,
        name="itch-colmgr",
    )
else:
    exe = EXE(
        pyz,
        a.scripts,
        a.binaries,
        a.zipfiles,
        a.datas,
        [],
        name="itch-colmgr",
        debug=False,
        bootloader_ignore_signals=False,
        strip=False,
        upx=False,
        runtime_tmpdir=None,
        console=CONSOLE,
        disable_windowed_traceback=False,
        argv_emulation=False,
        target_arch=None,
        codesign_identity=None,
        entitlements_file=None,
        version=version_info,
        icon="assets/icon.ico",
    )
