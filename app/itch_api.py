"""itch.io API client.

Read endpoints are publicly documented; collection write endpoints are the
ones used by itch.io's official clients (see itchio/go-itchio). Auth: Bearer
token from a personal API key (https://itch.io/user/settings/api-keys).

Two things about collections are worth knowing before reaching for them:

- There is **no** endpoint that stores an order for the collection list itself.
  `POST /collections/{id}` takes only title / description / private / layout /
  on_profile, and `GET /profile/collections` takes only a `game_id` filter. That
  is why the sidebar order lives in config.local.json as a local preference.
- `POST /collections/{id}/order` does exist, but it orders the games *inside*
  one collection (`game_ids` up to 500, JSON-encoded array) — that is what
  `order_collection_games` uses.
"""
from __future__ import annotations

import json
import time

import httpx

from . import __version__

BASE = "https://api.itch.io"


class ItchApiError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        super().__init__(f"itch API {status}: {message}")


class ItchClient:
    def __init__(self, api_key: str, proxy: str | None = None, timeout: float = 30.0):
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
            "User-Agent": f"itch-colmgr/{__version__}",
        }
        # Never trust HTTP_PROXY from the environment: IDEs inject one that
        # intercepts itch.io and returns 502. Empty proxy means direct connect.
        kw: dict = {
            "base_url": BASE,
            "headers": self._headers,
            "timeout": timeout,
            "trust_env": False,
        }
        if proxy:
            kw["proxy"] = proxy
        self._client = httpx.Client(**kw)

    def close(self) -> None:
        self._client.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    # ---------- read ----------

    def get_profile(self) -> dict:
        return self._get("/profile")

    def list_collections(self) -> list[dict]:
        data = self._get("/profile/collections")
        return data.get("collections", [])

    def get_collection_games_page(self, collection_id: int, page: int) -> dict:
        return self._get(f"/collections/{collection_id}/collection-games", params={"page": page})

    # ---------- write ----------

    def create_collection(self, title: str, private: bool = True) -> dict:
        return self._post("/collections", data={"title": title, "private": "1" if private else "0"})

    def delete_collection(self, collection_id: int) -> dict:
        return self._post(f"/collections/{collection_id}/delete")

    def add_game(self, collection_id: int, game_id: int) -> dict:
        return self._post(f"/collections/{collection_id}/add-game", data={"game_id": str(game_id)})

    def remove_game(self, collection_id: int, game_id: int) -> dict:
        return self._post(f"/collections/{collection_id}/remove-game", data={"game_id": str(game_id)})

    def order_collection_games(self, collection_id: int, game_ids: list[int]) -> dict:
        """Set the order of the games inside one collection.

        `game_ids` is the complete desired order, first shown first, capped at
        500 by the API. The field must be a JSON-encoded array — go-itchio sends
        it through AddInt64List, which json.Marshal's the slice, while a plain
        comma list is a different helper used by other endpoints.
        """
        payload = json.dumps(game_ids[:500], separators=(",", ":"))
        return self._post(f"/collections/{collection_id}/order", data={"game_ids": payload})

    # ---------- helpers ----------

    def _json(self, r: httpx.Response) -> dict:
        if r.status_code not in (200, 201):
            raise ItchApiError(r.status_code, r.text[:300])
        if not r.content:
            return {}
        try:
            data = r.json()
        except json.JSONDecodeError as e:
            raise ItchApiError(r.status_code, f"响应不是 JSON：{e}") from None
        return data if isinstance(data, dict) else {"value": data}

    def _get(self, path: str, params: dict | None = None) -> dict:
        return self._json(self._client.get(path, params=params))

    def _post(self, path: str, data: dict | None = None) -> dict:
        return self._json(self._client.post(path, data=data or {}))


def parse_game(raw: dict) -> dict:
    """Normalize a collectionGames[] entry into our snapshot game shape."""
    g = raw.get("game", {}) or {}
    u = g.get("user", {}) or {}
    min_price = g.get("min_price")
    if min_price is None:
        min_price = g.get("minPrice")
    return {
        "id": g.get("id"),
        "title": g.get("title", "(untitled)"),
        "coverUrl": g.get("cover_url") or g.get("coverUrl") or "",
        "url": g.get("url") or g.get("website") or "",
        "shortText": g.get("short_text") or g.get("shortText") or "",
        "author": u.get("display_name") or u.get("username") or "",
        "classification": g.get("classification", ""),
        "type": g.get("type", ""),
        # itch reports 0 for free and "pay what you want"; anything above is a
        # required minimum price, i.e. a paid asset.
        "minPrice": min_price if isinstance(min_price, int) else None,
    }


def fetch_snapshot(client: ItchClient, sleep: float = 0.35, max_pages: int = 100) -> dict:
    """Pull all collections with all games. Polite pacing between pages.

    Stops if a page repeats the previous one (page parameter ignored) or if
    max_pages is hit. A truncated collection is marked incomplete=True.
    """
    profile = client.get_profile().get("user", {})
    collections_out = []
    for c in client.list_collections():
        games, seen_ids = [], set()
        prev_sig = None
        incomplete = False
        for page in range(1, max_pages + 1):
            data = client.get_collection_games_page(c["id"], page)
            entries = data.get("collectionGames") or data.get("collection_games") or []
            if not entries:
                break
            parsed = []
            for e in entries:
                g = parse_game(e)
                if g.get("id") is None:
                    continue
                parsed.append(g)
            sig = tuple(g["id"] for g in parsed)
            if not sig or sig == prev_sig:
                break  # empty after filtering, or the API ignored ?page=
            prev_sig = sig
            for g in parsed:
                if g["id"] in seen_ids:
                    continue
                seen_ids.add(g["id"])
                games.append(g)
            per_page = data.get("perPage") or data.get("per_page") or 0
            if per_page and len(entries) < per_page:
                break
            if page == max_pages:
                incomplete = True
                break
            time.sleep(sleep)
        collections_out.append({
            "id": c["id"],
            "title": c.get("title", f"collection-{c['id']}"),
            "gamesCount": len(games),
            "games": games,
            "incomplete": incomplete,
        })
        time.sleep(sleep)
    return {
        "syncedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "profile": {"id": profile.get("id"), "username": profile.get("username", "")},
        "demo": False,
        "collections": collections_out,
    }
