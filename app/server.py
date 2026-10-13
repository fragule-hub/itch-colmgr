"""FastAPI server: local UI and a small JSON API. localhost only."""
from __future__ import annotations

import os
import threading
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse
from pydantic import BaseModel

from . import config, demo_data, executor, i18n, paths, snapshot_store
from .itch_api import ItchApiError, ItchClient, fetch_snapshot

app = FastAPI(title="itch-colmgr")
STATIC = os.path.join(paths.resource_dir(), "static")
_LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}
_start_lock = threading.Lock()


def _hostname(value: str) -> str:
    if not value:
        return ""
    if value.startswith("["):
        return value.split("]")[0][1:].lower()
    return value.split(":")[0].lower()


@app.middleware("http")
async def localhost_only(request: Request, call_next):
    """Refuse other interfaces and cross-site browser calls.

    The API key lives in this process. A page on another site must not be
    able to POST a write to 127.0.0.1.
    """
    if _hostname(request.headers.get("host") or "") not in _LOCAL_HOSTS:
        return JSONResponse({"detail": i18n.tr(i18n.lang_of(request), "err.localOnly")}, status_code=403)
    origin = request.headers.get("origin")
    if origin and origin != "null":
        if _hostname(urlparse(origin).hostname or "") not in _LOCAL_HOSTS:
            return JSONResponse({"detail": i18n.tr(i18n.lang_of(request), "err.crossSite")}, status_code=403)
    return await call_next(request)


@app.middleware("http")
async def no_store_frontend(request: Request, call_next):
    """Never let the browser cache the UI.

    Without an explicit Cache-Control the browser falls back to heuristic
    caching: after an edit to app.js the page keeps running the old file until
    a hard reload, which looks exactly like "my change didn't take effect".
    """
    resp = await call_next(request)
    path = request.url.path
    if path in ("/", "/index.html") or path.startswith("/static/"):
        resp.headers["Cache-Control"] = "no-store, must-revalidate"
        resp.headers["Pragma"] = "no-cache"
        resp.headers["Expires"] = "0"
    return resp


def resolve_static(path: str) -> str | None:
    """Map a URL path onto a file inside static/, or None if it escapes."""
    root = os.path.realpath(STATIC)
    fp = os.path.realpath(os.path.join(root, path))
    try:
        if os.path.commonpath([root, fp]) != root:
            return None
    except ValueError:
        return None
    if not os.path.isfile(fp):
        return None
    return fp


# ---------- models ----------

class ConfigBody(BaseModel):
    apiKey: str = ""
    demoMode: bool | None = None
    rateLimitPerSec: float | None = None
    proxy: str | None = None
    # Sidebar order (collection titles). Purely a local view preference — itch
    # has no endpoint that stores an order for the collection list.
    collectionOrder: list | None = None


class PlanBody(BaseModel):
    plan: dict
    # "replace" (default, the UI sends the full desired queue) or "merge"
    # (an outside writer adds ops without wiping what is already queued).
    mode: str = "replace"


class ExecBody(BaseModel):
    dryRun: bool = False
    # An asset that ends up in no collection is invisible to this tool forever
    # (itch has no "whole library" endpoint), so the write is refused unless the
    # caller explicitly acknowledged that. The UI sets it from its tick box;
    # external agents must set it themselves.
    ackOrphans: bool = False
    # Language for the executor's run log ("zh" / "en"). Errors raised before
    # the run starts travel with the X-Lang header instead.
    lang: str = "zh"


class SyncBody(BaseModel):
    force: bool = False


def _client_from_cfg(cfg: dict) -> ItchClient:
    return ItchClient(cfg["apiKey"], proxy=cfg.get("proxy") or None)


def _itch_call(cfg: dict, fn, lang: str = "zh", prefix: str = "", tail=None):
    """Run `fn(client)` against itch.io, turning every failure into a 400.

    The wording of the two failure modes lives here so the four call sites
    cannot drift apart. `tail()` is evaluated only on failure, for context the
    caller learnt along the way (e.g. an id it may have left behind).
    """
    if not cfg.get("apiKey"):
        raise HTTPException(400, i18n.tr(lang, "err.noKey"))
    extra = tail() if tail else ""
    try:
        with _client_from_cfg(cfg) as client:
            return fn(client)
    except ItchApiError as e:
        raise HTTPException(400, f"{prefix}{e}{extra}") from None
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, i18n.tr(lang, "err.netFail", e=e, extra=extra)) from None


def _begin(plan: dict, dry_run: bool, lang: str = "zh") -> None:
    with _start_lock:
        executor.executor.start(plan, dry_run, lang)


# ---------- static ----------

def _asset_version(name: str) -> str:
    """mtime of a static asset, used as a cache-busting query token."""
    try:
        return str(int(os.path.getmtime(os.path.join(STATIC, name))))
    except OSError:
        return "0"


def _index_response(lang: str) -> HTMLResponse:
    """Serve index.html with versioned asset URLs.

    Cache-Control alone is not enough: a copy of index.html the browser cached
    *before* that header existed stays heuristically fresh, so it keeps asking
    for the same /static/app.js URL and never picks up an edit. Stamping the
    URL with the file's mtime means an edited file is a different URL, which no
    cache can serve.
    """
    try:
        with open(os.path.join(STATIC, "index.html"), encoding="utf-8") as f:
            html = f.read()
    except OSError:
        raise HTTPException(404, i18n.tr(lang, "err.noIndex"))
    html = html.replace('href="/static/style.css"', f'href="/static/style.css?v={_asset_version("style.css")}"')
    html = html.replace('src="/static/i18n.js"', f'src="/static/i18n.js?v={_asset_version("i18n.js")}"')
    html = html.replace('src="/static/app.js"', f'src="/static/app.js?v={_asset_version("app.js")}"')
    return HTMLResponse(html, headers={
        "Cache-Control": "no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0",
    })


@app.get("/")
@app.get("/index.html")
def index(request: Request):
    return _index_response(i18n.lang_of(request))


@app.get("/static/{path:path}")
def static_files(path: str):
    fp = resolve_static(path)
    if fp is None:
        raise HTTPException(404)
    return FileResponse(fp)


# ---------- state & config ----------

@app.get("/api/state")
def state():
    cfg = config.load()
    return {
        "keySaved": bool(cfg.get("apiKey")),
        "demoMode": bool(cfg.get("demoMode")),
        "rateLimitPerSec": cfg.get("rateLimitPerSec", 1.0),
        "proxy": cfg.get("proxy", ""),
        "collectionOrder": cfg.get("collectionOrder") or [],
        "snapshot": snapshot_store.load_snapshot(),
        "plan": snapshot_store.load_plan(),
        "exec": executor.executor.status(),
    }


@app.post("/api/config")
def set_config(body: ConfigBody):
    kw = {}
    if body.apiKey != "":
        kw["apiKey"] = body.apiKey.strip()
    if body.demoMode is not None:
        kw["demoMode"] = body.demoMode
    if body.rateLimitPerSec is not None:
        kw["rateLimitPerSec"] = max(0.2, min(5.0, float(body.rateLimitPerSec)))
    if body.proxy is not None:
        kw["proxy"] = body.proxy.strip()
    if body.collectionOrder is not None:
        kw["collectionOrder"] = [str(t).strip() for t in body.collectionOrder if str(t).strip()]
    config.patch(**kw)
    if body.demoMode:
        config.ensure_data_dir()
        snapshot_store.save_snapshot(demo_data.load())
    return {"ok": True}


@app.post("/api/config/test-read")
def test_read(request: Request):
    lang = i18n.lang_of(request)
    cfg = config.load()
    if cfg.get("demoMode"):
        return {"ok": True, "message": i18n.tr(lang, "test.demoRead")}
    cols = _itch_call(cfg, lambda c: c.list_collections(), lang)
    return {"ok": True, "message": i18n.tr(lang, "test.readOk", n=len(cols),
                                            unit=i18n.plural(len(cols), "collection", "collections"))}


@app.post("/api/config/test-write")
def test_write(request: Request):
    lang = i18n.lang_of(request)
    cfg = config.load()
    if cfg.get("demoMode"):
        return {"ok": True, "message": i18n.tr(lang, "test.demoWrite")}
    leftover: dict = {}

    def run(client: ItchClient):
        """Create a scratch collection, then delete it whatever happens."""
        cid = None
        try:
            data = client.create_collection("_colmgr_test")
            cid = (data.get("collection") or {}).get("id")
            leftover["id"] = cid
            if not cid:
                raise ItchApiError(200, i18n.tr(lang, "test.createNoId"))
        finally:
            if cid:
                client.delete_collection(cid)

    def tail() -> str:
        return i18n.tr(lang, "test.leftover", id=leftover["id"]) if leftover.get("id") else ""

    _itch_call(cfg, run, lang, prefix=i18n.tr(lang, "test.writeFailPrefix"), tail=tail)
    return {"ok": True, "message": i18n.tr(lang, "test.writeOk")}


@app.post("/api/sync")
def sync(body: SyncBody, request: Request):
    lang = i18n.lang_of(request)
    if snapshot_store.plan_size(snapshot_store.load_plan()) and not body.force:
        raise HTTPException(409, i18n.tr(lang, "err.pendingChanges"))
    cfg = config.load()
    if cfg.get("demoMode"):
        snap = demo_data.load()
    else:
        snap = _itch_call(cfg, fetch_snapshot, lang)
    snapshot_store.save_snapshot(snap)
    return {"ok": True, "snapshot": snap}


@app.get("/api/export/csv", response_class=PlainTextResponse)
def export_csv(request: Request):
    snap = snapshot_store.load_snapshot()
    if not snap:
        raise HTTPException(400, i18n.tr(i18n.lang_of(request), "err.noSnapshot"))
    # A download, not a tab: the button says 导出, and a saved file keeps the
    # right name. The BOM is what makes Excel read the UTF-8 Chinese titles
    # correctly on a double-click.
    return PlainTextResponse(
        "\ufeff" + snapshot_store.snapshot_to_csv(snap),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="itch-collections.csv"'},
    )


# ---------- plan (pending changes) ----------

@app.post("/api/plan")
def save_plan(body: PlanBody, request: Request):
    p = body.plan
    # A queue written by an older client (or an outside agent) may not know every
    # bucket yet: fill the missing ones rather than refusing the whole plan.
    for k in snapshot_store.EMPTY_PLAN:
        if k in p and not isinstance(p[k], list):
            raise HTTPException(400, i18n.tr(i18n.lang_of(request), "err.planField", k=k))
        p.setdefault(k, [])
    if body.mode == "merge":
        p = snapshot_store.merge_plans(snapshot_store.load_plan(), p)
    else:
        # Canonical on the way in, either way: what the confirm page lists is
        # exactly what the executor will do. A plan the UI wrote is already in
        # this shape, so this only ever bites hand-written ones.
        p = snapshot_store.normalize_plan(p)
    snapshot_store.save_plan(p)
    return {"ok": True, "plan": p, "size": snapshot_store.plan_size(p)}


@app.post("/api/plan/clear")
def clear_plan():
    _done, reverse = snapshot_store.load_progress()
    had_progress = bool(_done)
    if snapshot_store.plan_size(reverse):
        snapshot_store.save_last_reverse(reverse)
    snapshot_store.clear_progress()
    snapshot_store.save_plan(snapshot_store.empty_plan())
    return {"ok": True, "hadProgress": had_progress}


# ---------- execute ----------

@app.post("/api/execute")
def execute(body: ExecBody, request: Request):
    lang = i18n.lang_of(request)
    cfg = config.load()
    if not cfg.get("demoMode") and not cfg.get("apiKey"):
        raise HTTPException(400, i18n.tr(lang, "err.noKey"))
    plan = snapshot_store.normalize_plan(snapshot_store.load_plan())
    snapshot_store.save_plan(plan)
    if not snapshot_store.plan_size(plan):
        raise HTTPException(400, i18n.tr(lang, "err.queueEmpty"))
    if not body.dryRun and not body.ackOrphans:
        orphans = snapshot_store.games_orphaned_by_plan(
            snapshot_store.load_snapshot() or {}, plan)
        if orphans:
            sample = "、".join(o["title"] for o in orphans[:5] if o["title"]) or "…"
            more = i18n.tr(lang, "err.orphansMore", n=len(orphans)) if len(orphans) > 5 else ""
            raise HTTPException(409, i18n.tr(
                lang, "err.orphans", n=len(orphans), sample=sample, more=more,
                unit=i18n.plural(len(orphans), "asset", "assets")))
    try:
        _begin(plan, body.dryRun, body.lang)
    except RuntimeError as e:
        raise HTTPException(409, str(e))
    return {"ok": True}


@app.get("/api/exec/status")
def exec_status():
    return executor.executor.status()


@app.post("/api/exec/cancel")
def exec_cancel():
    executor.executor.cancel()
    return {"ok": True}


@app.post("/api/rollback")
def rollback(request: Request):
    """Re-queue the inverse of the last real write and run it.

    Refused while a forward queue is still open, so a rollback cannot wipe
    edits the user made afterwards.
    """
    lang = i18n.lang_of(request)
    if snapshot_store.plan_size(snapshot_store.load_plan()):
        raise HTTPException(400, i18n.tr(lang, "err.rollbackQueue"))
    rev = snapshot_store.load_last_reverse()
    if not rev or not snapshot_store.plan_size(rev):
        raise HTTPException(400, i18n.tr(lang, "err.nothingToRollback"))
    with _start_lock:
        if executor.executor.status().get("running"):
            raise HTTPException(409, i18n.tr(lang, "exec.alreadyRunning"))
        snapshot_store.save_plan(rev)
        try:
            executor.executor.start(rev, dry_run=False, lang=lang)
        except RuntimeError as e:
            snapshot_store.save_plan(snapshot_store.empty_plan())
            raise HTTPException(409, str(e))
    return {"ok": True}

