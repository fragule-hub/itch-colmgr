"""Snapshot and plan persistence + CSV export + reverse plan."""
from __future__ import annotations

import csv
import io
import json
import os

from . import config

SNAPSHOT_PATH = os.path.join(config.DATA_DIR, "snapshot.json")
PLAN_PATH = os.path.join(config.DATA_DIR, "plan.json")
PROGRESS_PATH = os.path.join(config.DATA_DIR, "exec_progress.json")
LAST_REVERSE_PATH = os.path.join(config.DATA_DIR, "last_reverse.json")

EMPTY_PLAN = {"create": [], "add": [], "remove": [], "order": [], "deleteCollections": []}


def _read_json(path: str):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _write_json(path: str, data, indent: int | None = None) -> None:
    config.ensure_data_dir()
    text = json.dumps(data, ensure_ascii=False, indent=indent)
    config.atomic_write(path, text)


def load_snapshot() -> dict | None:
    if os.path.exists(SNAPSHOT_PATH):
        try:
            snap = _read_json(SNAPSHOT_PATH)
        except (OSError, ValueError):
            return None         # unreadable or corrupt: treat as no snapshot
        # A snapshot without a collections list would break every consumer;
        # treating it like a missing file sends the UI back to the setup page.
        if isinstance(snap, dict) and isinstance(snap.get("collections"), list):
            return snap
    return None


def save_snapshot(snap: dict) -> None:
    _write_json(SNAPSHOT_PATH, snap)


def empty_plan() -> dict:
    return {k: list(v) for k, v in EMPTY_PLAN.items()}


def load_plan() -> dict:
    if os.path.exists(PLAN_PATH):
        try:
            plan = _read_json(PLAN_PATH)
        except (OSError, ValueError):
            return empty_plan()
        if isinstance(plan, dict):
            for k in EMPTY_PLAN:
                if k not in plan or not isinstance(plan[k], list):
                    plan[k] = []
            return plan
    return empty_plan()


def save_plan(plan: dict) -> None:
    _write_json(PLAN_PATH, plan, indent=2)


def plan_size(plan: dict) -> int:
    return sum(len(plan.get(k, [])) for k in EMPTY_PLAN)


def clear_progress() -> None:
    try:
        os.remove(PROGRESS_PATH)
    except OSError:
        pass


def save_progress(done: set, reverse: dict) -> None:
    """Remember which ops already landed, so a retry can skip them."""
    config.ensure_data_dir()
    config.atomic_write(
        PROGRESS_PATH,
        json.dumps({"done": sorted(done), "reverse": reverse}, ensure_ascii=False),
    )


def load_last_reverse() -> dict | None:
    if not os.path.exists(LAST_REVERSE_PATH):
        return None
    try:
        plan = _read_json(LAST_REVERSE_PATH)
    except (OSError, ValueError):
        return None
    if not isinstance(plan, dict):
        return None
    return plan if plan_size(plan) else None


def save_last_reverse(plan: dict | None) -> None:
    if not plan or not plan_size(plan):
        try:
            os.remove(LAST_REVERSE_PATH)
        except OSError:
            pass
        return
    _write_json(LAST_REVERSE_PATH, plan, indent=2)


def merge_plans(base: dict, extra: dict) -> dict:
    """Union two plans, then normalize. Used when an outside writer adds ops
    without meaning to discard what the user already queued."""
    pooled = empty_plan()
    for it in flatten_plan(base) + flatten_plan(extra):
        pooled[it["bucket"]].append(it["raw"])
    return normalize_plan(pooled)


def games_orphaned_by_plan(snap: dict, plan: dict) -> list[dict]:
    """Assets that would belong to no collection at all once this plan runs.

    itch exposes no "my whole library" endpoint: the snapshot is produced by
    walking your collections. So a zero-membership asset is simply absent from
    the *next* snapshot — it drops out of 主页 / 全部 / 未分类 and this tool has
    no entry point to bring it back. Nothing is deleted on itch; the tool just
    loses sight of it. Callers use this to warn before a write.

    The UI builds the same list in JS for its live banner (with the collections
    each asset came from); this copy is the authority for the write gate, which
    must not take the client's word for it.
    """
    snap = snap or {"collections": []}
    prev = apply_plan_to_snapshot(snap, plan)
    alive = {g.get("id") for c in prev.get("collections", []) for g in c.get("games", [])}
    seen: set = set()
    out: list[dict] = []
    for c in snap.get("collections", []):
        for g in c.get("games", []):
            gid = g.get("id")
            if gid is None or gid in alive or gid in seen:
                continue
            seen.add(gid)
            out.append({"id": gid, "title": g.get("title", "")})
    return out


def snapshot_to_csv(snap: dict) -> str:
    """CSV columns compatible with the community 'Itch Collection CSV Exporter'."""
    buf = io.StringIO()
    w = csv.writer(buf, quoting=csv.QUOTE_ALL)
    w.writerow(["gameid", "category", "title", "author", "synopsis", "imagepath", "url", "blurb"])
    for c in snap.get("collections", []):
        for g in c.get("games", []):
            w.writerow([g.get("id"), c.get("title"), g.get("title"), g.get("author"),
                        (g.get("shortText") or "").replace("\n", " "),
                        g.get("coverUrl"), g.get("url"), c.get("title")])
    return buf.getvalue()


def _clean_title(value) -> str:
    return str(value or "").strip()


def normalize_plan(plan: dict) -> dict:
    """Drop contradictory and duplicate ops before they hit the network.

    - create + title-only delete of the same name cancel out (never existed remotely)
    - add and remove of the same game/collection cancel out
    - adds/removes into a collection that this plan also deletes are dropped
    - duplicate titles / pairs collapse to one
    - one order per collection survives, the last one queued (each carries the
      whole order, so it is not a delta that could be merged)
    """
    creates = []
    seen_create = set()
    for c in plan.get("create") or []:
        if not isinstance(c, dict):
            continue
        title = _clean_title(c.get("title"))
        if not title or title in seen_create:
            continue
        seen_create.add(title)
        creates.append({"title": title})

    deletes = []
    seen_del = set()
    local_undo_titles: set[str] = set()
    for raw in plan.get("deleteCollections") or []:
        if isinstance(raw, str):
            item = {"title": raw}
        elif isinstance(raw, dict):
            item = raw
        else:
            continue
        title = _clean_title(item.get("title"))
        cid = item.get("collectionId")
        cid = cid if isinstance(cid, int) and cid > 0 else None
        key = ("id", cid) if cid else ("title", title)
        if key in seen_del or (not title and not cid):
            continue
        seen_del.add(key)
        # A title-only delete of a collection this plan also creates is a local undo.
        if not cid and title in seen_create:
            creates = [c for c in creates if c["title"] != title]
            seen_create.discard(title)
            local_undo_titles.add(title)
            continue
        out = {}
        if title:
            out["title"] = title
        if cid:
            out["collectionId"] = cid
        deletes.append(out)

    deleted_ids = {d["collectionId"] for d in deletes if d.get("collectionId")}
    # Title-only deletes have no id, so every op aimed at that name goes with them.
    # An id-targeted delete must not swallow ops aimed at a new collection of the same name.
    title_only_deletes = {d["title"] for d in deletes if d.get("title") and not d.get("collectionId")}

    def doomed(item: dict) -> bool:
        if item.get("collectionId") in deleted_ids:
            return True
        title = item.get("collection") or ""
        if title in local_undo_titles or title in title_only_deletes:
            return True
        return False

    add_pairs = set()
    rem_pairs = set()
    for bucket, dest in (("add", add_pairs), ("remove", rem_pairs)):
        for item in plan.get(bucket) or []:
            if isinstance(item, dict) and item.get("gameId") is not None:
                dest.add((item.get("collection"), item.get("collectionId"), item.get("gameId")))
    # Cancellation only cares about (collection, gameId): one side naming a
    # collectionId and the other only a title must still cancel out. Collapsing
    # each opposite bucket to those loose keys turns the per-item scan into an
    # O(1) lookup, which matters for the large batch plans the UI can queue.
    rem_loose = {(p[0], p[2]) for p in rem_pairs}
    add_loose = {(p[0], p[2]) for p in add_pairs}

    def keep_membership(item: dict, seen: set, out: list, opposite_loose: set) -> None:
        if not isinstance(item, dict) or item.get("gameId") is None:
            return
        pair = (item.get("collection"), item.get("collectionId"), item.get("gameId"))
        if (item.get("collection"), item.get("gameId")) in opposite_loose:
            return
        if doomed(item) or pair in seen:
            return
        seen.add(pair)
        out.append(dict(item))

    adds: list = []
    removes: list = []
    keep_seen_a: set = set()
    keep_seen_r: set = set()
    for item in plan.get("add") or []:
        keep_membership(item, keep_seen_a, adds, rem_loose)
    for item in plan.get("remove") or []:
        keep_membership(item, keep_seen_r, removes, add_loose)

    orders: list = []
    for item in plan.get("order") or []:
        if not isinstance(item, dict):
            continue
        cid = item.get("collectionId")
        cid = cid if isinstance(cid, int) and cid > 0 else None
        title = _clean_title(item.get("collection"))
        if not cid and not title:
            continue
        ids: list[int] = []
        for gid in item.get("gameIds") or []:
            if isinstance(gid, int) and gid not in ids:
                ids.append(gid)
        if not ids or doomed(item):
            continue
        out = {"gameIds": ids}
        if title:
            out["collection"] = title
        if cid:
            out["collectionId"] = cid
        # Last one wins: an order is a whole list, not a delta to merge.
        orders = [o for o in orders if _target_key(o) != _target_key(out)]
        orders.append(out)

    return {"create": creates, "add": adds, "remove": removes,
            "order": orders, "deleteCollections": deletes}


def _target_key(item: dict) -> tuple:
    """What a membership-shaped plan item points at: an id if it has one, else a title."""
    cid = item.get("collectionId")
    if isinstance(cid, int) and cid > 0:
        return ("id", cid)
    return ("title", (item.get("collection") or "").strip())


def flatten_plan(plan: dict) -> list[dict]:
    """Stable execution order: create, add, remove, order, delete.

    Ordering is deliberately after membership: the ids it carries only matter
    once the adds and removes of the same run have happened.
    """
    items = []
    for c in plan.get("create", []):
        title = c.get("title", "")
        items.append({
            "op": "create", "title": title, "key": f"create:{title}",
            "desc": f"新建收藏夹「{title}」", "raw": dict(c), "bucket": "create",
        })
    for a in plan.get("add", []):
        label = a.get("collection") or a.get("collectionId")
        gid = a.get("gameId")
        items.append({
            "op": "add", "collection": a.get("collection"), "collectionId": a.get("collectionId"),
            "gameId": gid, "key": f"add:{label}:{gid}",
            "desc": f"把游戏 {a.get('gameTitle', gid)} 加入「{label}」",
            "raw": dict(a), "bucket": "add",
        })
    for r in plan.get("remove", []):
        label = r.get("collection") or r.get("collectionId")
        gid = r.get("gameId")
        items.append({
            "op": "remove", "collection": r.get("collection"), "collectionId": r.get("collectionId"),
            "gameId": gid, "key": f"remove:{label}:{gid}",
            "desc": f"把游戏 {r.get('gameTitle', gid)} 移出「{label}」",
            "raw": dict(r), "bucket": "remove",
        })
    for o in plan.get("order", []):
        label = o.get("collection") or o.get("collectionId")
        ids = o.get("gameIds") or []
        items.append({
            "op": "order", "collection": o.get("collection"), "collectionId": o.get("collectionId"),
            "gameIds": ids, "key": f"order:{o.get('collectionId') or o.get('collection')}",
            "desc": f"调整「{label}」里 {len(ids)} 个素材的顺序",
            "raw": dict(o), "bucket": "order",
        })
    for d in plan.get("deleteCollections", []):
        title = d.get("title") or ""
        cid = d.get("collectionId")
        label = title or str(cid)
        items.append({
            "op": "deleteCollection", "title": title, "collectionId": cid,
            "key": f"del:{cid or title}",
            "desc": f"删除收藏夹「{label}」", "raw": dict(d), "bucket": "deleteCollections",
        })
    return items


def _filter_keys(plan: dict, keys: set, keep: bool) -> dict:
    out = empty_plan()
    for it in flatten_plan(plan):
        hit = it["key"] in keys
        if keep and not hit:
            continue
        if not keep and hit:
            continue
        out[it["bucket"]].append(it["raw"])
    return out


def drop_keys(plan: dict, keys: set) -> dict:
    """Copy of plan without the ops whose flatten key is in keys."""
    return _filter_keys(plan, keys, keep=False)


def keep_keys(plan: dict, keys: set) -> dict:
    """Copy of plan with only the ops whose flatten key is in keys."""
    return _filter_keys(plan, keys, keep=True)


def load_progress() -> tuple[set, dict]:
    if not os.path.exists(PROGRESS_PATH):
        return set(), empty_plan()
    try:
        data = _read_json(PROGRESS_PATH)
    except (OSError, ValueError):
        return set(), empty_plan()
    if not isinstance(data, dict):
        return set(), empty_plan()
    done = set(data.get("done") or [])
    reverse = data.get("reverse") or empty_plan()
    if not isinstance(reverse, dict):
        reverse = empty_plan()
    return done, reverse


def apply_plan_to_snapshot(snap: dict, plan: dict) -> dict:
    """Local preview: snapshot + pending plan, without touching the snapshot file."""
    plan = normalize_plan(plan)
    preview = json.loads(json.dumps(snap))
    preview.setdefault("collections", [])
    cols = {c["id"]: c for c in preview["collections"]}
    next_new_id = -1
    for item in plan.get("create", []):
        while next_new_id in cols:
            next_new_id -= 1
        created = {
            "id": next_new_id, "title": item["title"], "gamesCount": 0,
            "games": [], "new": True,
        }
        cols[next_new_id] = created
        preview["collections"].append(created)
        next_new_id -= 1
    for item in plan.get("add", []):
        c = _resolve(cols, item)
        if c and not any(g.get("id") == item["gameId"] for g in c["games"]):
            g = _find_game(preview, item["gameId"]) or {
                "id": item["gameId"],
                "title": item.get("gameTitle") or str(item["gameId"]),
                "author": "", "coverUrl": "", "url": "", "shortText": "", "classification": "",
            }
            c["games"].append(dict(g))
            c["gamesCount"] = len(c["games"])
    for item in plan.get("remove", []):
        c = _resolve(cols, item)
        if c:
            c["games"] = [g for g in c["games"] if g.get("id") != item["gameId"]]
            c["gamesCount"] = len(c["games"])
    # Ordering runs after membership is settled, and only reorders: games the
    # list does not mention keep their relative position, behind the ones it
    # does. Same rule as the UI's own preview — keep the two in step.
    for item in plan.get("order", []):
        c = _resolve(cols, item)
        if not c:
            continue
        rank = {gid: i for i, gid in enumerate(item.get("gameIds") or [])}
        c["games"].sort(key=lambda g: rank.get(g.get("id"), len(rank)))
    for item in plan.get("deleteCollections", []):
        preview["collections"] = [c for c in preview["collections"] if not _is_deleted(c, item)]
    return preview


def _is_deleted(c: dict, item: dict) -> bool:
    cid = item.get("collectionId")
    if isinstance(cid, int) and cid > 0:
        return c.get("id") == cid
    title = item.get("title")
    return bool(title) and c.get("title") == title


def _resolve(cols: dict, item: dict) -> dict | None:
    cid = item.get("collectionId")
    if cid in cols:
        return cols[cid]
    title = item.get("collection")
    if not title:
        return None
    matches = [c for c in cols.values() if c.get("title") == title]
    # No id means "the collection this plan is creating", when one exists.
    # Otherwise the add would land on the old collection and be deleted with it.
    for c in matches:
        if c.get("new"):
            return c
    return matches[0] if matches else None


def _find_game(snap: dict, game_id: int) -> dict | None:
    for c in snap.get("collections", []):
        for g in c.get("games", []):
            if g.get("id") == game_id:
                return g
    return None

