"""Entry point: start the local server, open the browser, hold a small window.

From source this is a console app (Ctrl+C to quit). Frozen (PyInstaller) it is
a windowed app whose launcher window owns the server's lifetime — closing the
window quits. Either way only 127.0.0.1 is ever bound.

Ports: 8756 by default. If it is taken by another itch-colmgr instance, that
instance is focused and this launch exits; if it is taken by anything else the
next free port up to 8765 is used, and the URL is shown in the window.

Environment:
    COLMGR_NO_BROWSER=1  start the server without opening a browser tab.
"""
import os
import socket
import sys
import threading
import time
import traceback
import webbrowser

HOST = "127.0.0.1"
FIRST_PORT = 8756
PORT_TRIES = 10


# ---------------------------------------------------------------- ports

def _serving(port: int) -> bool:
    """True when something already answers /api/state on this port."""
    import urllib.request

    try:
        # The machine may carry a system proxy that knows nothing about
        # localhost; the probe has to go straight to 127.0.0.1.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(f"http://{HOST}:{port}/api/state", timeout=0.8) as r:
            return r.status == 200
    except Exception:
        return False


def resolve_port() -> tuple:
    """(socket to serve on, None) or (None, port already serving).

    The socket is bound here and stays open until the server picks it up, so
    the port cannot be grabbed by anyone between the check and the actual
    bind. A plain bind (no SO_REUSEADDR) is what makes the check honest on
    Windows: it fails while another socket listens, yet a port left in
    TIME_WAIT by a previous run still binds fine.
    """
    for port in range(FIRST_PORT, FIRST_PORT + PORT_TRIES):
        if _serving(port):
            return None, port
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            s.bind((HOST, port))
        except OSError:
            s.close()
            continue
        return s, None
    raise RuntimeError("ports busy")


# ---------------------------------------------------------------- server

def _make_server():
    import uvicorn
    from app.server import app as fastapi_app

    # h11 and lifespan are named explicitly: uvicorn otherwise resolves them
    # through importlib at load() time, which frozen builds cannot follow.
    # No host/port — the caller hands over an already-bound socket.
    cfg = uvicorn.Config(
        fastapi_app, log_level="warning", http="h11", lifespan="on",
    )
    return uvicorn.Server(cfg)


def _start_server(sock) -> tuple:
    """Start uvicorn on the pre-bound socket; returns (server, thread)."""
    server = _make_server()
    thread = threading.Thread(
        target=lambda: _serve(server, sock), name="uvicorn", daemon=True)
    thread.start()
    return server, thread


def _serve(server, sock) -> None:
    """Run uvicorn, making a crash visible however this build is packaged.

    A windowed build has no console: the traceback would otherwise land in a
    sink nobody reads, while the launcher window keeps promising an error.log
    that never appears. Source runs print it to stderr as usual.
    """
    from app import paths

    try:
        server.run(sockets=[sock])
    except BaseException:
        detail = traceback.format_exc()
        _append_error_log(detail)
        if not paths.is_frozen():
            print(detail, file=sys.stderr)


def _open(url: str) -> None:
    if os.environ.get("COLMGR_NO_BROWSER"):
        return
    webbrowser.open(url)


# ---------------------------------------------------------------- dialogs

def _ui_lang() -> str:
    """Follow the Windows UI language so the launcher matches the system."""
    try:
        import ctypes

        return "zh" if (ctypes.windll.kernel32.GetUserDefaultUILanguage() & 0x3FF) == 0x04 else "en"
    except Exception:
        return "zh"


def _dialog(kind: str, title: str, message: str) -> None:
    """Show a message box in windowed builds; print otherwise."""
    if not _frozen():
        print(message, file=sys.stderr if kind == "error" else sys.stdout)
        return
    try:
        import tkinter as tk
        from tkinter import messagebox

        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        (messagebox.showerror if kind == "error" else messagebox.showinfo)(title, message)
        root.destroy()
    except Exception:
        pass


def _append_error_log(text: str) -> None:
    """Append a timestamped block to error.log beside the user data."""
    from app import paths

    try:
        with open(os.path.join(paths.user_dir(), "error.log"), "a", encoding="utf-8") as f:
            f.write(f"\n{time.strftime('%Y-%m-%d %H:%M:%S')}\n{text}\n")
    except OSError:
        pass


def _fatal(message: str, lang: str) -> None:
    """Log to error.log beside the exe, then surface it however we can."""
    from app import i18n

    _append_error_log(message)
    _dialog("error", i18n.tr(lang, "launcher.title"), message)


# ---------------------------------------------------------------- launchers

def _console_wait(server, thread, url: str) -> None:
    print(f"itch-colmgr 运行中：{url}  （关闭此窗口或 Ctrl+C 退出）")
    try:
        while thread.is_alive():
            thread.join(timeout=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        server.should_exit = True
        thread.join(timeout=3)


def _run_windowed(sock, url: str) -> None:
    import tkinter as tk
    from tkinter import ttk

    from app import config, i18n

    lang = _ui_lang()

    def tr(key: str, **kw) -> str:
        return i18n.tr(lang, key, **kw)

    root = tk.Tk()
    root.title(tr("launcher.title"))
    root.resizable(False, False)
    root.eval("tk::PlaceWindow . center")

    status = ttk.Label(root, text=tr("launcher.starting"), font=("Segoe UI", 11, "bold"))
    status.grid(row=0, column=0, sticky="w", padx=16, pady=(14, 4))

    link = ttk.Label(root, text=url, foreground="#0563c1", cursor="hand2")
    link.grid(row=1, column=0, sticky="w", padx=16)
    link.bind("<Button-1>", lambda e: _open(url))

    ttk.Label(
        root, text=f'{tr("launcher.data")}: {config.DATA_DIR}',
        foreground="#909090", wraplength=340, justify="left",
    ).grid(row=2, column=0, sticky="w", padx=16, pady=(8, 0))

    buttons = ttk.Frame(root)
    buttons.grid(row=3, column=0, sticky="e", padx=16, pady=14)
    ttk.Button(buttons, text=tr("launcher.open"), command=lambda: _open(url)).pack(side="left", padx=(0, 8))
    ttk.Button(buttons, text=tr("launcher.quit"), command=lambda: _quit(server, thread)).pack(side="left")

    def poll() -> None:
        if server.started:
            status.configure(text=tr("launcher.running"))
            _open(url)
        elif not thread.is_alive():
            status.configure(text=tr("launcher.failed"))
        else:
            root.after(100, poll)

    server, thread = _start_server(sock)
    root.protocol("WM_DELETE_WINDOW", lambda: _quit(server, thread))
    root.after(100, poll)
    root.mainloop()


def _quit(server, thread) -> None:
    server.should_exit = True
    deadline = time.time() + 3
    while time.time() < deadline and thread.is_alive():
        time.sleep(0.05)
    # Keep-alive sockets can outlive the graceful window, and the process owns
    # nothing but this local server, so exiting hard is safe here.
    os._exit(0)


# ---------------------------------------------------------------- windowed io

def _harden_windowed_stdio(force_log: bool) -> None:
    """Windowed builds have no console: depending on the bootloader, sys.stdout
    and sys.stderr are either None (a stray print() would crash) or sinks that
    swallow everything. Route them to a log file when a console is missing, and
    always when --console asks for a diagnosable headless run."""
    if not force_log and sys.stdout is not None and sys.stderr is not None:
        return
    from app import paths

    try:
        log = open(os.path.join(paths.user_dir(), "itch-colmgr.log"), "a", encoding="utf-8", buffering=1)
    except OSError:
        log = open(os.devnull, "w")
    if force_log or sys.stdout is None:
        sys.stdout = log
    if force_log or sys.stderr is None:
        sys.stderr = log


# ---------------------------------------------------------------- entry

def _frozen() -> bool:
    from app import paths

    return paths.is_frozen()


def main(argv=None) -> int:
    force_console = "--console" in (argv or sys.argv[1:])
    from app import config, i18n, paths

    if paths.is_frozen():
        _harden_windowed_stdio(force_console)

    config.ensure_data_dir()
    lang = _ui_lang()

    try:
        sock, running = resolve_port()
    except RuntimeError:
        _fatal(i18n.tr(lang, "launcher.portsBusy",
                       first=FIRST_PORT, last=FIRST_PORT + PORT_TRIES - 1), lang)
        return 1
    if running is not None:
        # A second launch focuses the instance that is already serving.
        _open(f"http://{HOST}:{running}/")
        _dialog("info", i18n.tr(lang, "launcher.title"), i18n.tr(lang, "launcher.already"))
        return 0

    url = f"http://{HOST}:{sock.getsockname()[1]}/"
    if force_console or not paths.is_frozen():
        server, thread = _start_server(sock)
        deadline = time.time() + 15
        while time.time() < deadline and thread.is_alive() and not server.started:
            time.sleep(0.05)
        if not server.started:
            _fatal(i18n.tr(lang, "launcher.failed"), lang)
            return 1
        _open(url)
        _console_wait(server, thread, url)
    else:
        _run_windowed(sock, url)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except BaseException:
        detail = traceback.format_exc()
        _append_error_log(detail)
        try:
            from app import i18n, paths

            if paths.is_frozen():
                _dialog("error", i18n.tr(_ui_lang(), "launcher.title"), detail)
        except Exception:
            pass
        raise
