"""Rate-limited plan executor with retries, checkpoint resume and reverse plan."""
from __future__ import annotations

import copy
import threading
import time

from . import config, i18n, snapshot_store
from .itch_api import ItchApiError, ItchClient, fetch_snapshot

_TRANSIENT = {429, 500, 502, 503, 504}
_ALREADY = ("already", "exists", "duplicate")


class Executor:
    """Runs a plan against itch (or simulates in demo mode)."""

    def __init__(self):
        self._lock = threading.Lock()
        self._status = self._fresh_status()
        self._lang = "zh"

    def _fresh_status(self) -> dict:
        return {
            "running": False, "dryRun": False, "done": 0, "total": 0,
            "logs": [], "finished": False, "error": "", "cancelled": False,
            "reversePlan": None, "summary": {},
        }

    def status(self) -> dict:
        """A snapshot of the run safe to hand to another thread.

        The UI polls this every 700ms while a run is going, so a deep copy is
        the wrong tool: it would re-serialize up to 400 log lines and the whole
        reverse plan on every poll. Everything in `_status` is built from plain
        JSON-safe values and only `logs` is mutated in place, so a shallow copy
        plus a fresh log list is enough to keep the caller off the live object.
        """
        with self._lock:
            s = self._status
            return {
                **s,
                "logs": list(s["logs"]),
                "summary": dict(s["summary"]),
                "reversePlan": copy.deepcopy(s["reversePlan"]),
            }

    def cancel(self):
        with self._lock:
            self._status["cancelled"] = True

    def _cancelled(self) -> bool:
        with self._lock:
            return bool(self._status["cancelled"])

    def _log(self, line: str):
        with self._lock:
            logs = self._status["logs"]
            logs.append(line)
            if len(logs) > 400:
                self._status["logs"] = logs[-400:]

    def _set(self, **kw):
        with self._lock:
            self._status.update(kw)

    def start(self, plan: dict, dry_run: bool = False, lang: str = "zh") -> None:
        with self._lock:
            if self._status["running"]:
                raise RuntimeError(i18n.tr(lang, "exec.alreadyRunning"))
            self._status = self._fresh_status()
            self._status["running"] = True
            self._status["dryRun"] = dry_run
            self._lang = lang
        threading.Thread(target=self._run, args=(plan, dry_run), daemon=True).start()

    def _run(self, plan: dict, dry_run: bool):
        try:
            self._run_inner(plan, dry_run)
        except Exception as e:  # noqa: BLE001
            self._log(i18n.tr(self._lang, "exec.error", e=e))
            self._set(error=str(e), finished=True, running=False)

    def _run_inner(self, plan: dict, dry_run: bool):
        lang = self._lang
        cfg = config.load()
        demo = bool(cfg.get("demoMode"))
        if not demo and not cfg.get("apiKey"):
            self._log(i18n.tr(lang, "err.noKey"))
            self._set(error=i18n.tr(lang, "err.noKey"), finished=True, running=False, total=0)
            return

        snap = snapshot_store.load_snapshot() or {"collections": []}
        if not demo and not dry_run and snap.get("demo"):
            self._log(i18n.tr(lang, "exec.demoSnapshot"))
            self._set(error=i18n.tr(lang, "exec.demoSnapshotErr"), finished=True, running=False, total=0)
            return

        plan = snapshot_store.normalize_plan(plan)
        items = snapshot_store.flatten_plan(plan)
        # What the library is meant to look like once this plan is through.
        # Ordering needs it: the ids it sends must match the final membership,
        # or a game removed by this very plan would be ordered (and re-added).
        post = snapshot_store.apply_plan_to_snapshot(snap, plan)
        self._set(total=len(items))
        note = ""
        if dry_run:
            note = i18n.tr(lang, "exec.dryNote")
        elif demo:
            note = i18n.tr(lang, "exec.demoNote")
        self._log(i18n.tr(lang, "exec.planTotal", n=len(items), note=note,
                          unit=i18n.plural(len(items), "operation", "operations")))

        done_ids, reverse = self._load_progress(dry_run)
        results = {"ok": 0, "skip": 0, "fail": 0}
        interval = 1.0 / max(float(cfg.get("rateLimitPerSec", 1.0)), 0.05)
        last_call = 0.0
        id_by_title: dict[str, int] = {}
        created_ids: dict[str, int] = {}
        # What the run started from — collection ids, titles and the game order
        # of each one — for the reverse plan. One walk serves both the
        # title→id map and this, instead of iterating the collections twice.
        known = {"ids": set(), "titles": set(), "order": {}}
        for c in snap.get("collections", []):
            # First title wins so a later duplicate cannot hide the earlier id.
            id_by_title.setdefault(c.get("title", ""), c["id"])
            known["ids"].add(c["id"])
            known["titles"].add(c.get("title"))
            known["order"][c["id"]] = [g.get("id") for g in c.get("games", [])]
        client = None
        succeeded_keys: set[str] = set()

        try:
            if not demo:
                client = ItchClient(cfg["apiKey"], proxy=cfg.get("proxy") or None)
            for idx, it in enumerate(items):
                if self._cancelled():
                    self._log(i18n.tr(lang, "exec.cancelledLeft"))
                    break
                if it["key"] in done_ids:
                    results["skip"] += 1
                    succeeded_keys.add(it["key"])
                    self._set(done=idx + 1)
                    continue
                wait = interval - (time.time() - last_call)
                if wait > 0 and not dry_run:
                    time.sleep(wait)
                if self._cancelled():
                    self._log(i18n.tr(lang, "exec.cancelledLeft"))
                    break
                last_call = time.time()
                ok, msg = self._exec_with_retry(client, it, id_by_title, dry_run, created_ids, post)
                label = f"[{idx + 1}/{len(items)}] {self._label(it)}"
                if ok:
                    results["ok"] += 1
                    self._log(f"✓ {label}" + (f"（{msg}）" if msg else ""))
                    if not dry_run:
                        succeeded_keys.add(it["key"])
                        done_ids.add(it["key"])
                        self._record_reverse(reverse, it, known)
                        self._checkpoint(done_ids, reverse)
                else:
                    results["fail"] += 1
                    self._log(f"✗ {label} — {msg}")
                self._set(done=idx + 1)
        finally:
            if client is not None:
                client.close()

        # Preview is snapshot + plan. Succeeded ops stay in the plan until the
        # snapshot catches up, otherwise the UI snaps back and the user re-queues
        # a write that already landed. Real mode catches up by resyncing; demo
        # mode applies the succeeded ops locally.
        if not dry_run and succeeded_keys:
            if demo:
                base = snapshot_store.load_snapshot() or snap
                done_plan = snapshot_store.keep_keys(plan, succeeded_keys)
                snapshot_store.save_snapshot(snapshot_store.apply_plan_to_snapshot(base, done_plan))
                snapshot_store.save_plan(snapshot_store.drop_keys(snapshot_store.load_plan(), succeeded_keys))
                snapshot_store.clear_progress()
                self._log(i18n.tr(lang, "exec.demoApplied"))
            elif results["fail"] == 0 and not self._cancelled() and results["ok"] + results["skip"] == len(items):
                if self._resync(cfg):
                    snapshot_store.save_plan(snapshot_store.drop_keys(snapshot_store.load_plan(), succeeded_keys))
                    snapshot_store.clear_progress()
                else:
                    self._checkpoint(done_ids, reverse)
            else:
                # Partial failure or cancel: remember what landed so a retry skips it.
                self._checkpoint(done_ids, reverse)
            if not demo and snapshot_store.plan_size(reverse):
                snapshot_store.save_last_reverse(reverse)

        error = ""
        if results["fail"]:
            error = i18n.tr(lang, "exec.failSummary", n=results["fail"])
        elif self._cancelled():
            error = i18n.tr(lang, "exec.cancelSummary")
        self._set(
            finished=True, running=False, summary=results,
            reversePlan=None if dry_run else reverse, error=error,
        )
        self._log(i18n.tr(lang, "exec.doneSummary", ok=results["ok"], skip=results["skip"], fail=results["fail"]))

    def _load_progress(self, dry_run: bool) -> tuple[set, dict]:
        if dry_run:
            return set(), snapshot_store.empty_plan()
        done, reverse = snapshot_store.load_progress()
        if done:
            self._log(i18n.tr(self._lang, "exec.resume", n=len(done),
                              unit=i18n.plural(len(done), "item", "items")))
        return done, reverse

    def _resync(self, cfg: dict) -> bool:
        self._log(i18n.tr(self._lang, "exec.resyncing"))
        try:
            with ItchClient(cfg["apiKey"], proxy=cfg.get("proxy") or None) as client:
                snapshot_store.save_snapshot(fetch_snapshot(client))
            self._log(i18n.tr(self._lang, "exec.snapshotUpdated"))
            return True
        except Exception as e:  # noqa: BLE001
            self._log(i18n.tr(self._lang, "exec.resyncFailed", e=e))
            return False

    def _label(self, it: dict) -> str:
        """Localized one-line description of a plan item, for the run log.

        Built here instead of read from flatten_plan's data-facing `desc`, so
        the log follows the language of the page that started the run.
        """
        lang = self._lang
        op = it["op"]
        if op == "create":
            return i18n.tr(lang, "exec.item.create", title=it.get("title", ""))
        col = str(it.get("collection") or it.get("collectionId") or "")
        game = str(it.get("gameTitle") or it.get("gameId") or "")
        if op == "add":
            return i18n.tr(lang, "exec.item.add", game=game, col=col)
        if op == "remove":
            return i18n.tr(lang, "exec.item.remove", game=game, col=col)
        if op == "order":
            n = len(it.get("gameIds") or [])
            return i18n.tr(lang, "exec.item.order", col=col, n=n,
                           unit=i18n.plural(n, "asset", "assets"))
        return i18n.tr(lang, "exec.item.delete", col=it.get("title") or it.get("collectionId") or "")

    def _exec_with_retry(self, client, it, id_by_title, dry_run, created_ids, post):
        delays = (0, 1.5, 4.0)
        last = i18n.tr(self._lang, "exec.unknownError")
        for attempt, delay in enumerate(delays):
            if delay:
                if self._cancelled():
                    return False, i18n.tr(self._lang, "exec.cancelled")
                time.sleep(delay)
            ok, msg, transient = self._exec_item(client, it, id_by_title, dry_run, created_ids, post)
            if ok or not transient:
                return ok, msg
            last = msg
            if attempt + 1 < len(delays):
                self._log(i18n.tr(self._lang, "exec.retry", msg=msg))
        return False, last

    def _exec_item(self, client, it, id_by_title, dry_run, created_ids, post):
        """Return (ok, message, transient)."""
        lang = self._lang
        try:
            if dry_run:
                return True, "", False
            if client is None:
                if it["op"] == "create":
                    created_ids[it["title"]] = -int(time.time() * 1000) - len(created_ids)
                return True, i18n.tr(lang, "exec.simulated"), False
            if it["op"] == "create":
                data = client.create_collection(it["title"])
                cid = (data.get("collection") or {}).get("id")
                if not cid:
                    return False, i18n.tr(lang, "exec.createNoId"), False
                created_ids[it["title"]] = cid
                it["resolvedId"] = cid
                return True, i18n.tr(lang, "exec.newId", id=cid), False
            if it["op"] == "deleteCollection":
                cid = self._collection_id(it, id_by_title, created_ids, prefer_explicit=True)
                it["resolvedId"] = cid
                if cid and cid > 0:
                    client.delete_collection(cid)
                elif not cid:
                    return False, i18n.tr(lang, "exec.deleteNotFound",
                                          name=it.get("title") or it.get("collectionId")), False
                return True, "", False
            cid = self._collection_id(it, id_by_title, created_ids, prefer_explicit=False)
            it["resolvedId"] = cid
            if not cid or cid < 0:
                return False, i18n.tr(lang, "exec.colNotFound", name=it.get("collection")), False
            if it["op"] == "add":
                client.add_game(cid, it["gameId"])
                return True, "", False
            if it["op"] == "remove":
                client.remove_game(cid, it["gameId"])
                return True, "", False
            if it["op"] == "order":
                wanted = self._final_order(post, cid, it)
                if not wanted:
                    return True, i18n.tr(lang, "exec.nothingToOrder"), False
                client.order_collection_games(cid, wanted)
                return True, i18n.tr(lang, "exec.ordered", n=len(wanted)), False
            return False, i18n.tr(lang, "exec.unknownOp", op=it["op"]), False
        except ItchApiError as e:
            text = str(e).lower()
            if e.status in (400, 422) and any(w in text for w in _ALREADY):
                return True, i18n.tr(lang, "exec.alreadyState"), False
            if e.status in (401, 403):
                return False, i18n.tr(lang, "exec.forbidden", status=e.status), False
            return False, str(e), e.status in _TRANSIENT
        except Exception as e:  # noqa: BLE001
            return False, i18n.tr(lang, "exec.netError", e=e), True

    @staticmethod
    def _final_order(post: dict, cid: int, it: dict) -> list[int]:
        """The complete id list to send to /collections/{id}/order.

        Never a subset, and never a list assembled from the plan's own ids: the
        endpoint takes a whole order, so an id that a pending remove took out of
        the collection would put that game straight back. `post` is the snapshot
        with this plan applied, which is already ordered the way the user asked.
        """
        cols = post.get("collections", [])
        col = next((c for c in cols if c.get("id") == cid), None)
        if col is None and it.get("collection"):
            col = next((c for c in cols if c.get("title") == it["collection"]), None)
        if col is None:
            return []
        return [g["id"] for g in col.get("games", []) if g.get("id") is not None]

    def _collection_id(self, it, id_by_title, created_ids, prefer_explicit: bool):
        """Resolve a collection id.

        Deletes prefer the id captured when the user queued the op, so a
        same-named collection created earlier in this plan is not deleted
        in its place. Adds prefer an id created earlier in this same run.
        """
        title = it.get("title") if it.get("op") == "deleteCollection" else it.get("collection")
        explicit = it.get("collectionId")
        explicit_ok = explicit if isinstance(explicit, int) and explicit > 0 else None
        created = created_ids.get(title) if title else None
        named = id_by_title.get(title) if title else None
        if prefer_explicit:
            return explicit_ok or created or named
        return created or explicit_ok or named

    def _record_reverse(self, reverse: dict, it: dict, known: dict):
        """Queue the inverse of one succeeded op.

        `known` holds what the run started from — collection ids, titles and the
        game order of each one. Joining a collection created *in* this run needs
        no undo, since the create itself is already reversed by deleting it.
        """
        cid = it.get("resolvedId") or it.get("collectionId")
        if it["op"] == "create":
            entry = {"title": it["title"]}
            if isinstance(cid, int) and cid > 0:
                entry["collectionId"] = cid
            reverse["deleteCollections"].append(entry)
        elif it["op"] == "deleteCollection":
            return  # remote contents cannot be reconstructed from here
        elif it["op"] == "add":
            entry = {"collection": it.get("collection"), "gameId": it["gameId"]}
            if isinstance(cid, int) and cid > 0:
                entry["collectionId"] = cid
            reverse["remove"].append(entry)
        elif it["op"] == "remove":
            title = it.get("collection") or ""
            if cid in known["ids"] or (title and title in known["titles"]):
                entry = {"collection": it.get("collection"), "gameId": it["gameId"]}
                if isinstance(cid, int) and cid > 0:
                    entry["collectionId"] = cid
                reverse["add"].append(entry)
        elif it["op"] == "order":
            was = known["order"].get(cid)
            if was is None:
                return  # a collection created in this run: there was no order
            entry = {"collection": it.get("collection"), "gameIds": was}
            if isinstance(cid, int) and cid > 0:
                entry["collectionId"] = cid
            reverse["order"].append(entry)

    def _checkpoint(self, done_ids: set, reverse: dict):
        snapshot_store.save_progress(done_ids, reverse)


executor = Executor()
