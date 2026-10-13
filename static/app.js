/* itch-colmgr UI. Every edit stays local until the user confirms a write. */
"use strict";

const S = {
  snapshot: null,
  plan: { create: [], add: [], remove: [], order: [], deleteCollections: [] },
  view: "home",
  mode: "grid",
  search: "",
  selected: new Set(),
  // Which concrete card the user actually clicked, as its data-akey. Needed
  // because 主页 renders one card per collection, so the same asset can be on
  // screen several times at once.
  anchor: null,
  // akey of the card clicked last, so Shift+click can select everything between
  // it and the new one in DOM order — across shelves on 主页 too, not only
  // within a single row.
  lastKey: null,
  demo: false,
  execRunning: false,
  // Whether an API key is saved (from /api/state; only drives placeholder text).
  keySaved: false,
  // Last executor status, for offering 「撤销刚才的写入」 after a reload.
  exec: null,
  // Sidebar order, by collection title. A local view preference — itch stores
  // no order for the collection list, so this never becomes part of a write.
  order: [],
};
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const PLAN_BUCKETS = ["create", "add", "remove", "order", "deleteCollections"];
const planSize = () => PLAN_BUCKETS.reduce((n, k) => n + S.plan[k].length, 0);
const emptyPlan = () => ({ create: [], add: [], remove: [], order: [], deleteCollections: [] });
// 主页每个收藏夹的预览行长度；超出时计数标签说明还有多少没展示。
const SHELF_LIMIT = 12;

async function api(path, body) {
  const opt = body !== undefined
    ? { method: "POST", headers: { "Content-Type": "application/json", "X-Lang": getLang() }, body: JSON.stringify(body) }
    : { headers: { "X-Lang": getLang() } };
  const r = await fetch(path, opt);
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
  if (!r.ok) {
    const err = new Error((data && data.detail) || (r.status + " " + r.statusText));
    err.status = r.status;
    throw err;
  }
  return data;
}

let planQueue = Promise.resolve();
// True while a save is queued but has not run yet. A queued send reads S.plan
// when it actually fires, so it always carries the latest queue — which makes
// any further savePlan() before then redundant. Without this, a burst of edits
// (dragging card after card) fires one full-plan POST per edit, each carrying a
// state the next one immediately supersedes.
let planQueued = false;
function savePlan() {
  updatePill();
  if (planQueued) return;
  planQueued = true;
  planQueue = planQueue.then(() => {
    planQueued = false;
    return fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Lang": getLang() },
      // Serialized inside the callback, not at call time, so a coalesced send
      // still reflects every edit made up to the moment it runs.
      body: JSON.stringify({ plan: S.plan }),
    });
  }).catch(() => {
    // Until this lands the queue lives in memory only, so a failed save has to
    // be loud: a reload would silently drop everything queued since the last
    // successful write.
    toast(t("err.planSave"));
  });
}

// ---- derived state -------------------------------------------------------
// The game map and the plan preview both walk the whole library, and the
// marquee asks for them on every mousemove. They are pure functions of exactly
// two inputs — the snapshot and the plan — so they are cached and the cache is
// dropped whenever either one changes. That is only safe because every plan
// write goes through mutatePlan() / setPlan() below: one invalidation point.
let _ver = 0;
let _cache = { ver: -1, games: null, preview: null };
function bump() { _ver++; }
function cached(kind, make) {
  if (_cache.ver !== _ver) _cache = { ver: _ver, games: null, preview: null };
  if (!_cache[kind]) _cache[kind] = make();
  return _cache[kind];
}
/** gameId -> game, across every collection. Treat the result as read-only. */
function allGames() {
  return cached("games", () => {
    const m = new Map();
    for (const c of S.snapshot.collections) {
      for (const g of c.games) if (g && g.id != null && !m.has(g.id)) m.set(g.id, g);
    }
    return m;
  });
}

function snapshotCol(title) {
  return S.snapshot.collections.find((c) => c.title === title) || null;
}

function asTarget(col) {
  if (typeof col === "string") {
    const created = S.plan.create.some((c) => c.title === col);
    const old = snapshotCol(col);
    if (created && !old) return { title: col, isNew: true, id: null };
    if (old) return { title: old.title, isNew: false, id: old.id };
    return { title: col, isNew: true, id: null };
  }
  return { title: col.title, isNew: !!col.isNew || col.id == null, id: col.isNew ? null : col.id };
}

function refOf(target) {
  if (target.isNew || target.id == null) return { collection: target.title };
  return { collection: target.title, collectionId: target.id };
}

function sameMembership(item, target, gameId) {
  if (item.gameId !== gameId) return false;
  if (target.isNew || target.id == null) return item.collection === target.title && !item.collectionId;
  if (item.collectionId) return item.collectionId === target.id;
  return item.collection === target.title && !target.isNew;
}

function inTarget(target, gameId) {
  if (target.isNew || target.id == null) return false;
  const col = S.snapshot.collections.find((c) => c.id === target.id) || snapshotCol(target.title);
  return !!(col && col.games.some((g) => g.id === gameId));
}

function findCol(cols, byTitle, it) {
  if (it.collectionId) {
    const hit = cols.find((c) => c.id === it.collectionId);
    if (hit) return hit;
  }
  return byTitle.get(it.collection) || null;
}

/** snapshot + pending plan, as the UI should show it. Treat the result as read-only. */
function previewCollections() { return cached("preview", buildPreview); }

function buildPreview() {
  const games = allGames();
  const cols = S.snapshot.collections.map((c) => ({
    id: c.id, title: c.title, games: c.games.slice(), real: true,
  }));
  for (const it of S.plan.create) {
    cols.push({ id: null, title: it.title, games: [], real: false, isNew: true });
  }
  // A new collection of the same name wins, matching the executor:
  // adds without an id go to the collection created in this plan.
  const byTitle = new Map();
  for (const c of cols) {
    if (!byTitle.has(c.title) || c.isNew) byTitle.set(c.title, c);
  }
  for (const it of S.plan.remove) {
    const c = findCol(cols, byTitle, it);
    if (c) c.games = c.games.filter((g) => g.id !== it.gameId);
  }
  for (const it of S.plan.add) {
    const c = findCol(cols, byTitle, it);
    const g = games.get(it.gameId);
    if (c && g && !c.games.some((x) => x.id === g.id)) c.games.push(g);
  }
  // Same rule as the server's apply_plan_to_snapshot: ordering only reorders,
  // and anything the list does not mention keeps its relative position behind
  // the games it does name.
  for (const it of S.plan.order) {
    const c = findCol(cols, byTitle, it);
    if (!c) continue;
    const rank = new Map(it.gameIds.map((gid, i) => [gid, i]));
    c.games.sort((a, b) => {
      const ra = rank.has(a.id) ? rank.get(a.id) : Infinity;
      const rb = rank.has(b.id) ? rank.get(b.id) : Infinity;
      return ra === rb ? 0 : (ra < rb ? -1 : 1);
    });
  }
  for (const it of S.plan.deleteCollections) {
    const i = cols.findIndex((c) => (it.collectionId && c.id === it.collectionId) || (!it.collectionId && c.title === it.title));
    if (i >= 0) cols.splice(i, 1);
  }
  // Fold in the user's own sidebar order so every list of collections — the
  // sidebar, 主页's shelves, the pick menus — agrees. Array.sort is stable, so
  // anything the order does not mention keeps its natural position.
  const rank = new Map(S.order.map((t, i) => [t, i]));
  const rankOf = (c) => (rank.has(c.title) ? rank.get(c.title) : Infinity);
  cols.sort((a, b) => {
    const ra = rankOf(a), rb = rankOf(b);
    return ra === rb ? 0 : (ra < rb ? -1 : 1);
  });
  const member = new Map();
  for (const c of cols) {
    for (const g of c.games) {
      if (!member.has(g.id)) member.set(g.id, []);
      member.get(g.id).push(c);
    }
  }
  return { cols, memberOf: (gid) => member.get(gid) || [] };
}

// The only two ways to write the plan. Both invalidate the derived cache, which
// is what lets allGames()/previewCollections() be cached at all.
function mutatePlan(fn) {
  const before = JSON.stringify(S.plan);
  fn();
  if (JSON.stringify(S.plan) === before) return false;
  bump();
  return true;
}
function setPlan(plan) {
  S.plan = plan || emptyPlan();
  bump();
}

/** Collections this plan already deletes take no new games, and the games they
 *  hold are about to disappear along with them. Takes an asTarget(). */
function collectionPendingDelete(target) {
  if (target.isNew) return false;
  return S.plan.deleteCollections.some((d) =>
    (target.id && d.collectionId === target.id) || (!d.collectionId && d.title === target.title));
}

// Pure plan edits. They touch S.plan and nothing else, and return whether the
// game's *net* membership really changed — a queued op that the new one cancels
// out reports false, so callers can say "已经在里面了" without lying.
function planAddTo(target, gameId, gt) {
  S.plan.remove = S.plan.remove.filter((x) => !sameMembership(x, target, gameId));
  if (inTarget(target, gameId)) return false;
  if (S.plan.add.some((x) => sameMembership(x, target, gameId))) return false;
  S.plan.add.push({ ...refOf(target), gameId, gameTitle: gt });
  return true;
}
function planRemoveFrom(target, gameId, gt) {
  S.plan.add = S.plan.add.filter((x) => !sameMembership(x, target, gameId));
  if (!inTarget(target, gameId)) return false;
  if (S.plan.remove.some((x) => sameMembership(x, target, gameId))) return false;
  S.plan.remove.push({ ...refOf(target), gameId, gameTitle: gt });
  return true;
}
/** Move = land in `target`, leave every other collection (membership becomes exclusive). */
function planMoveTo(target, gameId, gt) {
  const tkey = viewKey(target);
  let changed = false;
  // previewCollections() is the cached pre-batch view, so this sees the state
  // the user was looking at rather than a half-applied batch.
  for (const c of previewCollections().memberOf(gameId)) {
    if (viewKey(c) !== tkey) changed = planRemoveFrom(asTarget(c), gameId, gt) || changed;
  }
  return planAddTo(target, gameId, gt) || changed;
}
/** Pull a game out of every collection it currently belongs to (back to 未分类). */
function planRemoveFromAll(gameId, gt) {
  let changed = false;
  for (const c of previewCollections().memberOf(gameId)) {
    changed = planRemoveFrom(asTarget(c), gameId, gt) || changed;
  }
  return changed;
}
function planCreate(title) {
  title = (title || "").trim();
  if (!title) return false;
  if (S.plan.create.some((c) => c.title === title)) return false;
  // A name that still exists on the server is not a new collection — unless the
  // user just queued its deletion, in which case this is a recreate.
  const exists = S.snapshot.collections.some((c) => c.title === title);
  if (exists && !S.plan.deleteCollections.some((d) => d.title === title)) return false;
  S.plan.create.push({ title });
  return true;
}

/** Queue N membership edits in one shot. kind: add | move | remove | removeAll. */
function planBatch(ids, kind, col) {
  const gm = allGames();
  const target = col ? asTarget(col) : null;
  let n = 0;
  for (const id of ids) {
    const gt = (gm.get(id) || {}).title || "";
    const changed =
      kind === "add" ? planAddTo(target, id, gt)
      : kind === "remove" ? planRemoveFrom(target, id, gt)
      : kind === "move" ? planMoveTo(target, id, gt)
      : planRemoveFromAll(id, gt);
    if (changed) n++;
  }
  return n;
}

function opCreate(title) {
  return mutatePlan(() => planCreate(title));
}

/** An order op carries a whole list, not a delta, so two of them for the same
 *  collection would fight: the new one replaces the old. */
const orderKey = (item) => (item.collectionId ? "id:" + item.collectionId : "new:" + item.collection);

function planSetOrder(target, gameIds) {
  const ref = refOf(target);
  S.plan.order = S.plan.order.filter((o) => orderKey(o) !== orderKey(ref));
  S.plan.order.push({ ...ref, gameIds });
}

/** Drop the dragged ids next to `targetGid` inside one collection, keeping the
 *  rest of the order as it was. Stages it in the queue like every other edit —
 *  the order only reaches itch through 确认写入. */
function applyReorder(col, ids, targetGid, after) {
  const order = col.games.map((g) => g.id);
  const moving = order.filter((id) => ids.includes(id));
  if (!moving.length || (moving.length === 1 && moving[0] === targetGid)) return;
  const rest = order.filter((id) => !ids.includes(id));
  const at = rest.indexOf(targetGid);
  if (at < 0) return;
  rest.splice(at + (after ? 1 : 0), 0, ...moving);
  const snap = planSnapshot();
  commitBatch(snap, () => {
    if (!mutatePlan(() => planSetOrder(asTarget(col), rest))) return null;
    return t("order.adjusted", { col: col.title, n: rest.length, unit: plural(rest.length, "item", "items") });
  });
}

function opDeleteCol(title) {
  const col = previewCollections().cols.find((c) => c.title === title);
  if (!col) return;
  let changed = false;
  if (col.isNew) {
    if (!confirm(t("confirm.cancelCreate", { title }))) return;
    // Never existed remotely: drop the creates AND everything aimed at it.
    changed = mutatePlan(() => {
      S.plan.create = S.plan.create.filter((c) => c.title !== title);
      S.plan.add = S.plan.add.filter((a) => a.collection !== title);
      S.plan.remove = S.plan.remove.filter((r) => r.collection !== title);
    });
  } else {
    if (S.plan.deleteCollections.some((d) => d.collectionId === col.id)) {
      toast(t("toast.pendingDelete", { name: title }));
      return;
    }
    if (!confirm(t("confirm.deleteCol", { title }))) return;
    changed = mutatePlan(() => {
      S.plan.deleteCollections.push({ title, collectionId: col.id });
      S.plan.add = S.plan.add.filter((a) => a.collectionId !== col.id);
      S.plan.remove = S.plan.remove.filter((r) => r.collectionId !== col.id);
    });
  }
  if (!changed) return;
  savePlan();
  render();
}

function updatePill() {
  const n = planSize();
  $("pill").classList.toggle("hidden", n === 0);
  $("pillCount").textContent = t("pill.count", { n, unit: plural(n, "change", "changes") });
  const parts = [];
  if (S.plan.create.length) parts.push(t("pill.create", { n: S.plan.create.length }));
  if (S.plan.add.length) parts.push(t("pill.add", { n: S.plan.add.length }));
  if (S.plan.remove.length) parts.push(t("pill.remove", { n: S.plan.remove.length }));
  if (S.plan.order.length) parts.push(t("pill.order", { n: S.plan.order.length }));
  if (S.plan.deleteCollections.length) parts.push(t("pill.delete", { n: S.plan.deleteCollections.length }));
  $("pillSub").textContent = parts.join(" · ");
}

function matchGame(g) {
  const q = S.search.toLowerCase();
  return !q || (g.title + " " + (g.author || "")).toLowerCase().includes(q);
}

function viewKey(c) {
  return c.isNew || c.id == null ? "new:" + c.title : "id:" + c.id;
}

// Identity of one rendered card: the asset plus which shelf/collection it sits in.
function cardKey(gid, owner) {
  return gid + "@" + (owner ? viewKey(owner) : "");
}

// A single asset can be on screen more than once (主页 shows it in every
// collection it belongs to). Only the card the user actually clicked is
// "selected"; the other copies get "linked" so it stays obvious which one the
// menu and the batch buttons will act on.
function paintSelection(nodes, anchor) {
  const counts = new Map();
  for (const n of nodes) counts.set(n.dataset.gid, (counts.get(n.dataset.gid) || 0) + 1);
  const claimed = new Set();   // gids that already have a solid card on screen
  const linked = [];           // dashed copies, promoted below if no solid one exists
  const mark = (n, cls) => {
    n.classList.remove("selected", "linked");
    n.classList.add(cls);
    const c = n.querySelector(".check");
    if (c) c.textContent = cls === "linked" ? t("check.linked") : "✓";
  };
  for (const n of nodes) {
    n.classList.remove("selected", "linked");
    if (!S.selected.has(Number(n.dataset.gid))) continue;
    // The card the user actually clicked is the solid one; the same asset
    // appearing in another collection is only a dashed reference to it.
    if (counts.get(n.dataset.gid) === 1 || (anchor && anchor.key === n.dataset.akey)) {
      mark(n, "selected");
      claimed.add(n.dataset.gid);
    } else {
      mark(n, "linked");
      linked.push(n);
    }
  }
  // The clicked card may not be on screen at all (filtered out, or the view
  // changed): promote the first copy so the selection still reads as real.
  for (const n of linked) {
    if (claimed.has(n.dataset.gid)) continue;
    mark(n, "selected");
    claimed.add(n.dataset.gid);
  }
}
// ---- derived state: which cards are on screen, and what they belong to ----

const colView = (c) => "col:" + viewKey(c);

/** The only way the view ever changes. All four callers behaved subtly
 *  differently before (one kept the selection, others did not); the selection
 *  and the Shift anchor are meaningless once the list underneath changes, so
 *  both always go. */
function openView(view) {
  S.view = view;
  S.selected.clear();
  S.anchor = null;
  S.lastKey = null;
  render();
}

function currentCol(preview) {
  if (!S.view.startsWith("col:")) return null;
  const key = S.view.slice(4);
  return preview.cols.find((c) => viewKey(c) === key) || null;
}

// Which collections actually hold the target(s). "Remove from current
// collection" only makes sense inside a collection view, but "remove" itself
// must work everywhere — so we derive the candidate list from membership
// instead of from the open view. The open collection is hoisted to the front.
function sourceCols(ids, preview) {
  const keys = new Set();
  for (const id of ids) for (const c of preview.memberOf(id)) keys.add(viewKey(c));
  const cols = preview.cols.filter((c) => keys.has(viewKey(c)));
  const opened = currentCol(preview);
  if (opened) {
    const i = cols.findIndex((c) => viewKey(c) === viewKey(opened));
    if (i > 0) cols.unshift(cols.splice(i, 1)[0]);
  }
  return cols;
}
// Submenu entries for "移出…": one per collection that currently holds a target.
function removeSub(ids, cols) {
  return cols.map((c) => ({
    label: t("act.removeFrom", { name: c.title }),
    act: () => applyBatch(ids, "remove", c),
  }));
}

// ---- sidebar reorder: local display order only ------------------------------
// itch exposes no endpoint that stores an order for the collection list, so this
// never enters the plan and never reaches itch: it is a local view preference,
// kept in config.local.json alongside the proxy and the API key.
let sortDrag = null;   // title of the collection being dragged, while it is

/** Where the dragged row would land relative to `item`: after it, or before.
 *  `axis` is how the list flows — rows stack (y), grid cards sit side by side
 *  in reading order (x). */
function dropSideOf(e, item, axis) {
  const r = item.getBoundingClientRect();
  return axis === "x" ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
}

function markSort(item, after) {
  clearSortMarks();
  item.classList.add(after ? "sort-after" : "sort-before");
}

function clearSortMarks() {
  document.querySelectorAll(".sort-before, .sort-after")
    .forEach((n) => n.classList.remove("sort-before", "sort-after"));
}

/** Reordering is only meaningful where a single collection is on screen and
 *  that collection already exists on itch (a queued 新建 has no id to order).
 *  Anywhere else, dropping a card onto another card stays a no-op — the drop
 *  targets are the sidebar, the shelves and the bin. */
function reorderTargetKey() {
  if (!dragBadge) return "";
  const key = S.view.startsWith("col:") ? S.view.slice(4) : "";
  if (!key || key !== dragSourceKey) return "";
  const col = previewCollections().cols.find((c) => viewKey(c) === key);
  return col && !col.isNew && col.id > 0 ? key : "";
}

/** Wire a card / list row as an insertion point for a same-collection drag. */
function makeInsertable(el) {
  el.addEventListener("dragover", (e) => {
    if (!reorderTargetKey()) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    markDrop(null);   // a card is not a collection: no "移入 X" highlight
    markSort(el, dropSideOf(e, el, S.mode === "grid" ? "x" : "y"));
    updateDragBadge(e.clientX, e.clientY, false, t("drag.reorder"));
  });
  el.addEventListener("dragleave", () => {
    el.classList.remove("sort-before", "sort-after");
  });
  el.addEventListener("drop", (e) => {
    if (!reorderTargetKey()) return;
    e.preventDefault();
    // A card is a drop target for reordering only: without this the document
    // handler would read the same drop as "move into a collection".
    e.stopPropagation();
    const after = dropSideOf(e, el, S.mode === "grid" ? "x" : "y");
    const ids = parseDragIds(e);
    const col = currentCol(previewCollections());
    cleanupDrag();
    if (col && ids.length) applyReorder(col, ids, Number(el.dataset.gid), after);
  });
}

/** Move `from` next to `to` in the shown order, keep the whole shown order as
 *  the new preference (which also prunes titles that no longer exist). */
function reorderCollections(from, to, after) {
  if (!from || from === to) return;
  const shown = previewCollections().cols.map((c) => c.title);
  if (!shown.includes(from) || !shown.includes(to)) return;
  shown.splice(shown.indexOf(from), 1);
  shown.splice(shown.indexOf(to) + (after ? 1 : 0), 0, from);
  S.order = shown;
  bump();                       // the preview is derived from the order too
  api("/api/config", { collectionOrder: S.order }).catch(() => {});
  // A full render, not just the sidebar: 主页's shelves and the "添加到…" menus
  // are built from the same order, and they must not disagree with the sidebar.
  render();
}

function makeSortable(item, col) {
  item.draggable = true;
  item.title = t("sidebar.reorder.title");
  item.addEventListener("dragstart", (e) => {
    sortDrag = col.title;
    item.classList.add("sorting");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", col.title);   // makes the drop legal
  });
  item.addEventListener("dragend", () => {
    sortDrag = null;
    item.classList.remove("sorting");
    clearSortMarks();
  });
  // These listeners run alongside the ones makeDropTarget() installs for game
  // drops. The two never overlap: this one only acts during a row drag, and
  // makeDropTarget only acts during a game drag.
  item.addEventListener("dragover", (e) => {
    if (!sortDrag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    markSort(item, dropSideOf(e, item, "y"));
  });
  item.addEventListener("dragleave", () => {
    if (sortDrag) item.classList.remove("sort-before", "sort-after");
  });
  item.addEventListener("drop", (e) => {
    if (!sortDrag) return;
    e.preventDefault();
    e.stopPropagation();
    const from = sortDrag;
    const after = dropSideOf(e, item, "y");
    sortDrag = null;
    item.classList.remove("sorting");
    clearSortMarks();
    reorderCollections(from, col.title, after);
  });
}

function renderSidebar(preview) {
  const q = S.search.toLowerCase();
  const colList = $("colList");
  colList.innerHTML = "";
  document.querySelectorAll("#sidebar .side-item[data-view]").forEach((d) => {
    d.classList.toggle("active", d.dataset.view === S.view);
  });
  for (const c of preview.cols) {
    const cnt = c.games.filter((g) => !q || matchGame(g)).length;
    const div = document.createElement("div");
    div.className = "side-item" + (S.view === colView(c) ? " active" : "");
    div.innerHTML = `<span>${esc(c.title)}${c.isNew ? esc(t("tag.new")) : ""}</span><span class="badge">${cnt}</span>`;
    div.onclick = () => openView(colView(c));
    div.oncontextmenu = (e) => { e.preventDefault(); colContextMenu(e, c); };
    makeDropTarget(div, viewKey(c), c.title);
    makeSortable(div, c);
    colList.appendChild(div);
  }
}

function render() {
  const preview = previewCollections();
  const gm = allGames();
  renderSidebar(preview);
  const content = $("content");
  const opened = currentCol(preview);
  const title = { home: t("side.home"), all: t("side.all"), unassigned: t("side.unassigned") }[S.view] || (opened ? opened.title : "");
  $("viewTitle").textContent = title + (opened && opened.isNew ? t("tag.new") : "");
  $("demoBanner").classList.toggle("hidden", !S.demo);
  const incomplete = S.snapshot.collections.filter((c) => c.incomplete).length;
  const at = S.demo ? t("sync.demo") : S.snapshot.syncedAt;
  $("syncInfo").textContent = t("sync.info", { at, n: gm.size, unit: plural(gm.size, "game", "games") })
    + (incomplete ? t("sync.incomplete", { n: incomplete, unit: plural(incomplete, "collection", "collections") }) : "");
  content.innerHTML = "";

  let list = [];
  if (S.view === "all") list = [...gm.values()];
  else if (S.view === "unassigned") list = [...gm.values()].filter((g) => preview.memberOf(g.id).length === 0);
  else if (opened) list = opened.games;
  if (S.view === "home") {
    for (const c of preview.cols) {
      const games = c.games.filter(matchGame);
      if (!games.length) continue;
      const sh = document.createElement("div");
      sh.className = "shelf";
      const countLabel = games.length > SHELF_LIMIT
        ? t("shelf.more", { limit: SHELF_LIMIT, total: games.length })
        : t("common.count", { n: games.length });
      sh.innerHTML = `<div class="shelf-head"><h3 style="cursor:pointer;">${esc(c.title)}</h3><span class="muted">${esc(countLabel)}</span></div>`;
      sh.querySelector("h3").onclick = () => openView(colView(c));
      // Dropping onto a shelf on 主页 moves the assets into that collection.
      makeDropTarget(sh, viewKey(c), c.title);
      const row = document.createElement("div");
      row.className = "shelf-row";
      // owner = the collection this shelf stands for, so a card knows whether it
      // is the copy the user picked or just the same asset appearing elsewhere.
      games.slice(0, SHELF_LIMIT).forEach((g) => row.appendChild(card(g, preview.memberOf, c)));
      sh.appendChild(row);
      content.appendChild(sh);
    }
  } else {
    list = list.filter(matchGame);
    if (S.mode === "grid") {
      const grid = document.createElement("div");
      grid.className = "grid";
      list.forEach((g) => grid.appendChild(card(g, preview.memberOf, null)));
      content.appendChild(grid);
    } else {
      list.forEach((g) => content.appendChild(listRow(g, preview.memberOf, null)));
    }
    if (!list.length) content.innerHTML = emptyHtml(opened);
  }
  if (S.view === "home" && !content.children.length) content.innerHTML = emptyHtml(null);
  paintSelection([...content.querySelectorAll("[data-gid]")], S.anchor);
  renderToolbar(preview);
}

// ---- selection helpers (shared by the toolbar, the context menu and Ctrl+A) ----
function visibleGames(preview) {
  const gm = allGames();
  if (S.view === "all") return [...gm.values()];
  if (S.view === "unassigned") return [...gm.values()].filter((g) => preview.memberOf(g.id).length === 0);
  // 主页 shows every collection at once, so "everything visible" is everything.
  if (S.view === "home") return [...gm.values()];
  const c = currentCol(preview);
  return c ? c.games : [];
}
function visibleIds() {
  return visibleGames(previewCollections()).filter(matchGame).map((g) => g.id);
}
// Selection is a visual state, not a structural one: repaint the cards in
// place instead of rebuilding the list. A full render() would drop the scroll
// position, which is painful in a 180-asset grid.
function repaintSelection() {
  paintSelection([...document.querySelectorAll("#content [data-gid]")], S.anchor);
  renderToolbar(previewCollections());
}
function selectAllVisible() {
  for (const id of visibleIds()) S.selected.add(id);
  S.anchor = null;
  repaintSelection();
}
function invertSelection() {
  const cur = new Set(S.selected);
  S.selected.clear();
  for (const id of visibleIds()) if (!cur.has(id)) S.selected.add(id);
  S.anchor = null;
  repaintSelection();
}
function clearSelection() {
  S.selected.clear();
  S.anchor = null;
  S.lastKey = null;
  repaintSelection();
}

function emptyHtml(opened) {
  let title = t("empty.col.title");
  let body = t("empty.col.body");
  if (S.search) {
    title = t("empty.noMatch.title");
    body = t("empty.noMatch.body");
  } else if (S.view === "home") {
    title = t("empty.home.title");
    body = t("empty.home.body");
  } else if (S.view === "unassigned") {
    title = t("empty.unassigned.title");
    body = t("empty.unassigned.body");
  } else if (opened && opened.isNew) {
    title = t("empty.newCol.title");
    body = t("empty.newCol.body");
  }
  return `<div class="empty"><p class="empty-title">${esc(title)}</p><p>${esc(body)}</p></div>`;
}

/** The fallback tile: the asset's initial. Used when there is no cover at all,
 *  and again when one fails to load (a dead URL, or a proxy that blocks it). */
function initialSpan(g) {
  const s = document.createElement("span");
  s.className = "ph";
  s.textContent = (g.title || "?")[0];
  return s;
}

/** `lazy` off for the drag image: it is snapshotted the instant the drag
 *  starts, so an image still waiting to load would come out blank. */
function coverHtml(g, lazy = true) {
  if (!g.coverUrl) return `<span class="ph">${esc((g.title || "?")[0])}</span>`;
  return `<img src="${esc(g.coverUrl)}"${lazy ? ' loading="lazy"' : ""} alt="">`;
}

// A card and a list row are the same thing in two skins: same identity, same
// selection / context-menu / drag behaviour. Only the markup and the extra
// double-click differ, so everything else lives here once.
function bindGameNode(el, g, owner) {
  el.draggable = true;
  el.dataset.gid = String(g.id);
  el.dataset.akey = cardKey(g.id, owner);
  el.onclick = (e) => selectClick(g, e, el);
  el.ondblclick = () => g.url && window.open(g.url, "_blank");
  el.oncontextmenu = (e) => { e.preventDefault(); gameContextMenu(e, g, el); };
  el.ondragstart = (e) => startDrag(e, g, el);
  makeInsertable(el);
  return el;
}

function card(g, memberOf, owner) {
  const el = document.createElement("div");
  el.className = "gcard";
  const tags = memberOf(g.id).map((c) => `<span class="tag${c.isNew ? " new" : ""}">${esc(c.title)}</span>`).join("");
  el.innerHTML = `
    <div class="cover">${coverHtml(g)}<div class="check">✓</div></div>
    <div class="meta"><div class="g-title" title="${esc(g.title)}">${esc(g.title)}</div>
    <div class="g-author">${esc(g.author)}</div>
    <div class="g-tags">${tags || `<span class="tag">${esc(t("side.unassigned"))}</span>`}</div></div>`;
  bindGameNode(el, g, owner);
  // A cover that 404s (or is blocked by the proxy) falls back to the initial.
  const img = el.querySelector("img");
  if (img) img.onerror = () => { img.replaceWith(initialSpan(g)); };
  return el;
}

function listRow(g, memberOf, owner) {
  const el = document.createElement("div");
  el.className = "list-row";
  const tags = memberOf(g.id).map((c) => esc(c.title)).join(" · ");
  el.innerHTML = `<div class="g-title">${esc(g.title)}</div><div class="g-desc">${esc(g.shortText || "")}</div>
    <div class="tag">${tags || esc(t("side.unassigned"))}</div><div class="muted" style="font-size:11px;">${esc(g.author)}</div>`;
  return bindGameNode(el, g, owner);
}

// ---- auto-scroll: keep a list moving while the pointer sits near its edge ----
// Shared by marquee selection and by drag & drop, so a 180-asset grid can be
// swept or dragged past without touching the scrollbar.
//
// During a drag this is the *only* thing that can scroll the list: the browser
// takes the pointer into its own drag session, which stops dispatching wheel
// events to the page altogether, so no wheel handler can serve that case.
// Parking the pointer in a band is therefore the gesture that has to feel
// right, which is why the band is a share of the viewport rather than a
// hairline strip, and why the speed ramps up with depth. The one carve-out is
// the corner bin: it lives inside the bottom band, so the band yields that
// patch to it for the duration of a drag (see overBin below).
const AutoScroll = (() => {
  const MAX_SPEED = 16;   // px per frame at the very edge — about 960 px/s, a
                          // screenful per second. The band is wide, so this top
                          // speed is easy to reach: keep it modest.
  let pt = null, raf = null, cb = null, sidebar = true;

  /** Depth of the sensitive band at each end of a scroller. Proportional to the
   *  viewport so a short sidebar does not turn into one big band, and clamped
   *  so a tall list keeps a comfortable dead zone in the middle. */
  const bandOf = (r, min, ratio, max) => Math.max(min, Math.min(max, r.height * ratio));

  /** -1 at the very top edge, +1 at the very bottom, 0 in the middle. */
  const ramp = (y, r, band) => {
    if (y < r.top + band) return -Math.min(1, (r.top + band - y) / band);
    if (y > r.bottom - band) return Math.min(1, (y - (r.bottom - band)) / band);
    return 0;
  };

  /** The corner bin is a fixed target that sits inside the bottom band, so the
   *  pointer resting on it — reading its label, lining up the drop — stops the
   *  scroll instead of sliding content away. The bin doubles as a dead zone for
   *  the band while it is visible, which is only during an asset drag; a
   *  marquee drag parks and scrolls in that corner as before. */
  const overBin = (p) => {
    const bin = $("dropRemove");
    if (!bin || bin.classList.contains("hidden")) return false;
    const b = bin.getBoundingClientRect();
    return p.clientX >= b.left - 10 && p.clientX <= b.right + 10
        && p.clientY >= b.top - 10 && p.clientY <= b.bottom + 10;
  };

  function tick() {
    raf = null;
    if (!pt) return;
    let moved = false;
    const c = $("content");
    if (c && c.scrollHeight > c.clientHeight) {
      const r = c.getBoundingClientRect();
      const d = ramp(pt.clientY, r, bandOf(r, 72, 0.3, 220));
      // Only when the pointer is actually over the list, so dragging off to the
      // left does not keep the list sliding underneath — and not while it is on
      // the corner bin, which claims that patch of the band for itself.
      if (d && pt.clientX >= r.left && !overBin(pt)) {
        const was = c.scrollTop;
        c.scrollTop = was + d * MAX_SPEED;
        if (c.scrollTop !== was) moved = true;   // already at the end: not a move
      }
    }
    const sb = sidebar ? $("sidebar") : null;
    if (sb && sb.scrollHeight > sb.clientHeight) {
      const r = sb.getBoundingClientRect();
      const d = ramp(pt.clientY, r, bandOf(r, 40, 0.25, 100));
      if (d) {
        const was = sb.scrollTop;
        sb.scrollTop = was + d * MAX_SPEED;
        if (sb.scrollTop !== was) moved = true;
      }
    }
    // Scrolling moved the cards under a parked pointer: whoever is tracking has
    // to recompute (the marquee re-hit-tests its box, for instance).
    if (moved && cb) cb(pt);
    if (pt) raf = requestAnimationFrame(tick);
  }

  return {
    start(e, cbk, wantSidebar) {
      pt = { clientX: e.clientX, clientY: e.clientY };
      cb = cbk || null;
      sidebar = wantSidebar !== false;
      if (!raf) raf = requestAnimationFrame(tick);
    },
    track(e) { if (pt) { pt.clientX = e.clientX; pt.clientY = e.clientY; } },
    stop() { pt = null; cb = null; if (raf) { cancelAnimationFrame(raf); raf = null; } },
  };
})();

// ---- drag & drop: 移入 a collection, with a live preview of what will happen ----
let dragBadge = null, dragCount = 0, dropNode = null, dragGhost = null;
// Which single collection this drag is pulling out of, if any. Captured at
// dragstart because it depends on the card that started the drag.
let dragSourceKey = "";

// The corner bin is not a collection, but it plays by the same rules: it is a
// drop target with a sentinel key, so the badge, the highlight and the
// elementFromPoint rescue all work on it without a special case anywhere.
const BIN_KEY = "__bin__";

function makeDropTarget(node, key, title, opts = {}) {
  // verb replaces the default "移入 / 添加到" wording; copyable=false means the
  // Ctrl modifier is meaningless here (there is no "copy into the bin").
  const { verb = "", copyable = true } = opts;
  node.dataset.dropkey = key;
  node.dataset.droptitle = title;
  node.dataset.dropverb = verb;
  const over = (e) => {
    if (!dragBadge) return;
    e.preventDefault();
    const copy = copyable && (e.ctrlKey || e.metaKey);
    e.dataTransfer.dropEffect = copy ? "copy" : "move";
    markDrop(node, copy);
    updateDragBadge(e.clientX, e.clientY, copy);
  };
  node.ondragenter = over;
  node.ondragover = over;
  // Without this the highlight sticks to wherever the cursor last hovered,
  // which reads as "this is still the target" while the cursor is somewhere
  // else entirely. relatedTarget is the element being entered.
  node.ondragleave = (e) => {
    if (e.relatedTarget && node.contains(e.relatedTarget)) return;
    if (dropNode === node) markDrop(null);
  };
}

function markDrop(node, copy) {
  if (dropNode && dropNode !== node) dropNode.classList.remove("drop-target", "copy");
  dropNode = node;
  if (!node) return;
  node.classList.add("drop-target");
  node.classList.toggle("copy", !!copy);
}

/** `text` overrides the usual "移入 N 个 →「X」" line, for drops that are not a
 *  move between collections (the insertion point between two cards). */
function updateDragBadge(x, y, copy, text) {
  if (!dragBadge) return;
  dragBadge.style.left = x + "px";
  dragBadge.style.top = y + "px";
  dragBadge.classList.toggle("copy", !!copy);
  if (text) { dragBadge.textContent = text; return; }
  const name = dropNode ? dropNode.dataset.droptitle : "";
  const verb = dropNode ? dropNode.dataset.dropverb : "";
  const to = name ? t("drag.target", { name }) : "";
  dragBadge.textContent = verb
    ? t("drag.badge", { verb, n: dragCount, to })
    : t("drag.badge", { verb: copy ? t("drag.add") : t("drag.move"), n: dragCount, to });
}

/** The game ids a drag is carrying, from the payload startDrag() wrote. */
function parseDragIds(e) {
  try {
    const raw = e.dataTransfer.getData("text/games") || e.dataTransfer.getData("text/plain") || "[]";
    const ids = JSON.parse(raw);
    return Array.isArray(ids) ? ids : [];
  } catch (err) {
    return [];
  }
}

/** The one collection a drag could be pulling out of, if any.
 *  A card on 主页 carries its shelf in data-akey ("<gid>@<collection key>");
 *  inside a collection view every card belongs to the open collection. */
function dragSourceKeyOf(el) {
  const akey = (el && el.dataset.akey) || "";
  const owner = akey.slice(akey.indexOf("@") + 1);
  if (owner) return owner;
  return S.view.startsWith("col:") ? S.view.slice(4) : "";
}

/** The bin only ever means one thing — "out of the collection this came from" —
 *  so it is offered only when the drag actually has a single one to point at. */
function prepareBin() {
  const bin = $("dropRemove");
  const src = previewCollections().cols.find((c) => viewKey(c) === dragSourceKey);
  if (!src) { bin.classList.add("hidden"); return; }
  bin.dataset.droptitle = src.title;
  bin.title = t("bin.title.named", { name: src.title });
  bin.querySelector(".lbl").textContent = t("act.removeFrom", { name: src.title });
  bin.classList.remove("hidden");
}

function startDragPreview(e, el) {
  dragCount = S.selected.size;
  dragSourceKey = dragSourceKeyOf(el);
  dragBadge = document.createElement("div");
  dragBadge.id = "dragBadge";
  document.body.appendChild(dragBadge);
  // The bin takes over the pill's corner while assets are in flight.
  $("pill").classList.add("hidden");
  prepareBin();
  updateDragBadge(e.clientX, e.clientY, false);
  AutoScroll.start(e);
}

// The browser's default drag image is a snapshot of the one card that started
// the drag, which reads as "moving a single asset" even when ten are selected.
// For a multi-selection we hand it a stack of the picked covers instead, so the
// whole bundle visibly travels with the cursor.
function buildDragGhost() {
  const gm = allGames();
  const ids = [...S.selected];
  const wrap = document.createElement("div");
  wrap.id = "dragGhost";
  const picked = ids.slice(0, 3).map((id) => gm.get(id)).filter(Boolean);
  picked.forEach((g, i) => {
    const c = document.createElement("div");
    c.className = "dg-card";
    c.style.left = (i * 8) + "px";
    c.style.top = (i * 8) + "px";
    c.style.zIndex = String(10 - i);
    c.innerHTML = coverHtml(g, false);
    wrap.appendChild(c);
  });
  if (ids.length > 1) {
    const b = document.createElement("div");
    b.className = "dg-count";
    b.textContent = t("common.count", { n: ids.length });
    wrap.appendChild(b);
  }
  document.body.appendChild(wrap);
  return wrap;
}

function cleanupDrag() {
  AutoScroll.stop();
  if (dropNode) dropNode.classList.remove("drop-target", "copy");
  dropNode = null;
  if (dragBadge) { dragBadge.remove(); dragBadge = null; }
  if (dragGhost) { dragGhost.remove(); dragGhost = null; }
  // The insertion marker is the one thing a drag leaves behind: markSort() puts
  // it on the last card it hovered, and a drag that ends anywhere else (empty
  // space, Esc) would otherwise strand it there.
  clearSortMarks();
  document.querySelectorAll("#content .dragging").forEach((n) => n.classList.remove("dragging"));
  dragSourceKey = "";
  $("dropRemove").classList.add("hidden");
  updatePill();     // the pill comes back to its corner, if there is anything to write
}

function dropKeyAt(x, y) {
  const el = document.elementFromPoint(x, y);
  const n = el && el.closest ? el.closest("[data-dropkey]") : null;
  return n ? n.dataset.dropkey : null;
}

document.addEventListener("dragover", (e) => {
  if (!dragBadge) return;
  e.preventDefault();
  AutoScroll.track(e);
  updateDragBadge(e.clientX, e.clientY, e.ctrlKey || e.metaKey);
});
// One drop handler for the whole document. It also rescues the case where the
// list auto-scrolled under a parked cursor: no dragover ever fired over the new
// element, so the per-element target would be stale — elementFromPoint fixes it.
document.addEventListener("drop", (e) => {
  if (!dragBadge) return;
  e.preventDefault();
  const ids = parseDragIds(e);
  const node = e.target && e.target.closest ? e.target.closest("[data-dropkey]") : null;
  // The event target is the reliable one (it is what the browser resolved as the
  // drop target). elementFromPoint is only a rescue for a drop that landed after
  // the list auto-scrolled under a parked cursor.
  const key = (node && node.dataset.dropkey) || dropKeyAt(e.clientX, e.clientY);
  const copy = e.ctrlKey || e.metaKey;
  const srcKey = dragSourceKey;     // cleanupDrag() clears it
  cleanupDrag();
  if (!key || !ids.length) return;
  if (key === BIN_KEY) {
    // Out of the one collection the drag came from — the same 移出 the context
    // menu offers, just by gesture. The bin is hidden unless we know which one.
    const src = previewCollections().cols.find((x) => viewKey(x) === srcKey);
    if (src) applyBatch(ids, "remove", src);
    return;
  }
  const c = previewCollections().cols.find((x) => viewKey(x) === key);
  if (!c) return;
  applyBatch(ids, copy ? "add" : "move", c);
});
document.addEventListener("dragend", cleanupDrag);
// The corner bin, registered like any other drop target — it just carries a
// verb instead of a collection name (which prepareBin fills in per drag).
makeDropTarget($("dropRemove"), BIN_KEY, "", { verb: t("bin.verb"), copyable: false });

/** Make this one card the whole selection. Called when a right-click or a drag
 *  starts on a card that was not selected yet, so the menu / the drop can never
 *  quietly act on a stale multi-selection. */
function selectOnly(g, el) {
  S.selected.clear();
  S.selected.add(g.id);
  S.lastKey = (el && el.dataset.akey) || cardKey(g.id, null);
  S.anchor = { key: S.lastKey };
  repaintSelection();
}

function startDrag(e, g, el) {
  if (!S.selected.has(g.id)) selectOnly(g, el);
  const payload = JSON.stringify([...S.selected]);
  e.dataTransfer.setData("text/plain", payload);
  try { e.dataTransfer.setData("text/games", payload); } catch (err) { /* some browsers only allow text/plain */ }
  e.dataTransfer.effectAllowed = "copyMove";
  // One asset: leave the browser's own card snapshot. Several: swap in the
  // stacked ghost so the whole selection looks like it is being carried.
  if (S.selected.size > 1) {
    dragGhost = buildDragGhost();
    try {
      // Anchor near the ghost's bottom-right, which leaves room for the badge
      // (drawn at cursor +16/+14) to sit clear of it.
      e.dataTransfer.setDragImage(dragGhost, 52, 52);
    } catch (err) { /* older engines just keep the default image */ }
  }
  // Fade every card that is part of the drag, not only the one under the cursor.
  document.querySelectorAll("#content [data-gid]").forEach((n) => {
    if (S.selected.has(Number(n.dataset.gid))) n.classList.add("dragging");
  });
  startDragPreview(e, el);
}

function selectClick(g, e, el) {
  // The range is taken over every card currently on screen, in DOM order, so
  // Shift works between shelves on 主页 as well as inside one grid/row.
  const nodes = [...document.querySelectorAll("#content [data-gid]")];
  const cur = nodes.indexOf(el);
  const prev = S.lastKey ? nodes.findIndex((n) => n.dataset.akey === S.lastKey) : -1;
  if (e.shiftKey && prev >= 0 && cur >= 0) {
    const a = Math.min(prev, cur), b = Math.max(prev, cur);
    for (let i = a; i <= b; i++) S.selected.add(Number(nodes[i].dataset.gid));
  } else if (e.ctrlKey || e.metaKey) {
    S.selected.has(g.id) ? S.selected.delete(g.id) : S.selected.add(g.id);
  } else {
    S.selected.clear();
    S.selected.add(g.id);
  }
  S.lastKey = el.dataset.akey;
  S.anchor = S.selected.has(g.id) ? { key: el.dataset.akey } : null;
  // Selecting is a visual change only — repaint the cards instead of rebuilding
  // the list, which would scroll the user back to the top of a 180-asset grid.
  repaintSelection();
}

function renderToolbar(preview) {
  const n = S.selected.size;
  const ids = [...S.selected];
  const srcs = sourceCols(ids, preview);
  const away = S.view !== "home";       // no "current collection" outside a collection view
  const show = (id, on) => $(id).classList.toggle("hidden", !on);

  show("btnSelAll", away);
  show("btnSelInvert", away && n > 0);
  show("btnSelClear", n > 0);
  show("selSep", away && n > 0);
  show("btnBatchAdd", n > 0);
  show("btnBatchMove", n > 0);
  // Removal is a membership question, not a view question: it must be available
  // in home / all / unassigned too, where there is no "current collection".
  show("btnBatchRemove", n > 0 && srcs.length > 0);
  show("btnBatchRemoveAll", n > 0 && ids.some((id) => preview.memberOf(id).length > 0));
  show("viewModes", away);
  // One click back to the shelf overview from any collection / list view.
  show("btnBackHome", away);
  show("homeSep", away);

  const rb = $("btnBatchRemove");
  rb.textContent = srcs.length > 1 ? t("act.removePick") : t("toolbar.batchRemove");
  rb.title = srcs.length === 0 ? ""
    : srcs.length === 1 ? t("toolbar.removeOne.title", { name: srcs[0].title })
    : t("toolbar.removeMulti.title", { n: srcs.length, unit: plural(srcs.length, "collection", "collections") });
  $("selInfo").classList.toggle("hidden", n === 0);
  $("selInfo").textContent = n ? t("sel.info", { n }) : "";
}

const ctx = $("ctxmenu");

// A submenu can be very long (21 collections and counting). Cap it to the
// viewport and slide it up so it never gets pushed out of the window.
function fitSubmenus() {
  const H = window.innerHeight;
  for (const mi of ctx.querySelectorAll(".mi.has-sub")) {
    const sm = mi.querySelector(".submenu");
    if (!sm) continue;
    sm.style.display = "block";
    sm.style.visibility = "hidden";
    sm.style.maxHeight = (H - 16) + "px";
    const r = mi.getBoundingClientRect();
    const h = sm.offsetHeight;
    const naturalTop = r.top - 4;
    let top = -4;
    if (naturalTop + h > H - 8) top -= (naturalTop + h) - (H - 8);
    if (r.top + top < 8) top = 8 - r.top;
    sm.style.top = top + "px";
    sm.style.display = "";
    sm.style.visibility = "";
  }
}

function showMenu(e, items) {
  // A menu opened by a toolbar click must survive that very click: without
  // this, the event bubbles on to the document handler below, which hides the
  // menu again the instant it appears.
  if (e && e.type === "click") e.stopPropagation();
  ctx.innerHTML = "";
  for (const it of items) {
    if (it === "-") {
      const s = document.createElement("div");
      s.className = "sep";
      ctx.appendChild(s);
      continue;
    }
    const d = document.createElement("div");
    d.className = "mi" + (it.danger ? " danger" : "") + (it.sub ? " has-sub" : "") + (it.disabled ? " disabled" : "");
    const label = it.hint
      ? `<span class="lbl"><span>${esc(it.label)}</span><small>${esc(it.hint)}</small></span>`
      : `<span>${esc(it.label)}</span>`;
    d.innerHTML = label + (it.sub ? "<span>›</span>" : "");
    d.onclick = (ev) => {
      if (it.disabled) return;
      if (ev.target.closest(".submenu")) return;
      if (it.act) it.act();
    };
    ctx.appendChild(d);
    if (it.sub) {
      const sm = document.createElement("div");
      sm.className = "submenu";
      for (const s of it.sub) {
        const sd = document.createElement("div");
        sd.className = "mi";
        sd.textContent = s.label;
        sd.onclick = (ev) => { ev.stopPropagation(); ctx.classList.add("hidden"); s.act(); };
        sm.appendChild(sd);
      }
      d.appendChild(sm);
    }
  }
  ctx.classList.remove("hidden");
  // Context menu: open at the pointer. Toolbar click: open under the button, so
  // the menu does not sit under the cursor with a submenu already open.
  const btn = e && e.type === "click" && e.currentTarget && e.currentTarget.getBoundingClientRect
    ? e.currentTarget.getBoundingClientRect() : null;
  const px = btn ? btn.left : e.clientX;
  const py = btn ? btn.bottom + 4 : e.clientY;
  ctx.classList.toggle("flip", px > window.innerWidth - 430);
  const x = Math.max(8, Math.min(px, window.innerWidth - 230));
  const y = Math.max(8, Math.min(py, window.innerHeight - ctx.offsetHeight - 10));
  ctx.style.left = x + "px";
  ctx.style.top = y + "px";
  fitSubmenus();
}
// An open menu must not outlive the next press anywhere else. Waiting for a
// "click" is not enough — starting a marquee or a drag never fires one — so the
// menu closes on mousedown, in the capture phase, ahead of the card and canvas
// handlers that decide what the press means.
document.addEventListener("mousedown", (e) => {
  if (e.target.closest && e.target.closest("#ctxmenu")) return;
  ctx.classList.add("hidden");
}, true);
document.addEventListener("click", (e) => {
  ctx.classList.add("hidden");
  const closer = e.target.closest && e.target.closest("[data-close]");
  if (!closer) return;
  const id = closer.dataset.close;
  if (id === "execOverlay" && S.execRunning) {
    toast(t("toast.execRunning"));
    return;
  }
  $(id).classList.add("hidden");
});

function targetIds(g) {
  return S.selected.has(g.id) && S.selected.size > 1 ? [...S.selected] : [g.id];
}
function planSnapshot() { return JSON.parse(JSON.stringify(S.plan)); }

// Run a batch edit. `fn` returns the message to confirm it, or null when there
// is nothing worth announcing. The queue is persisted whenever it really
// changed — an edit can cancel an earlier queued op and still end up with a net
// "nothing happened", which must not be silently dropped.
function commitBatch(snap, fn) {
  const before = JSON.stringify(S.plan);
  const msg = fn();
  if (JSON.stringify(S.plan) === before) return false;
  savePlan();
  render();
  if (msg) toast(msg, { label: t("common.undo"), fn: () => {
    setPlan(snap);
    savePlan();
    render();
    toast(t("toast.undoDone"));
  } });
  return true;
}

// The one funnel for every membership edit — batch buttons, context menus,
// drag & drop and the AI queue all land here, so the pending-delete guard, the
// undo snapshot and the toast wording exist exactly once.
const BATCH = {
  add: { done: (n, name) => t("batch.add.done", { n, name }),
         none: (name) => t("batch.add.none", { name }) },
  move: { done: (n, name) => t("batch.move.done", { n, name }),
          none: (name) => t("batch.move.none", { name }) },
  remove: { done: (n, name) => t("batch.remove.done", { n, name }),
            none: (name) => t("batch.remove.none", { name }) },
  removeAll: { done: (n) => t("batch.removeAll.done", { n }),
               none: () => t("batch.removeAll.none") },
};

function applyBatch(ids, kind, col) {
  if (!ids.length) return;
  const target = col ? asTarget(col) : null;
  if (target && collectionPendingDelete(target)) { toast(t("toast.pendingDelete", { name: target.title })); return; }
  const snap = planSnapshot();
  commitBatch(snap, () => {
    const n = mutatePlan(() => planBatch(ids, kind, target));
    if (!n) { toast(BATCH[kind].none(target ? target.title : "")); return null; }
    return BATCH[kind].done(n, target ? target.title : "");
  });
}

function pickCollection(e, onPick) {
  showMenu(e, previewCollections().cols.map((c) => ({
    label: c.title + (c.isNew ? t("tag.new") : ""),
    act: () => onPick(c),
  })));
}

function gameContextMenu(e, g, el) {
  if (!S.selected.has(g.id)) selectOnly(g, el);
  const preview = previewCollections();
  const ids = targetIds(g);
  const opened = currentCol(preview);
  const suffix = ids.length > 1 ? t("menu.countSuffix", { n: ids.length }) : "";
  // "Leave everything" is redundant when "leave this collection" already covers all targets.
  const needAll = ids.some((id) => {
    const ms = preview.memberOf(id);
    if (ms.length > 1) return true;
    return ms.length === 1 && (!opened || viewKey(ms[0]) !== viewKey(opened));
  });

  const sub = (act) => preview.cols.map((c) => ({
    label: c.title + (c.isNew ? t("tag.new") : ""),
    act: () => act(c),
  }));
  const srcs = sourceCols(ids, preview);

  const items = [
    { label: t("menu.openItch"), hint: t("menu.openItch.hint"), disabled: ids.length > 1,
      act: () => g.url && window.open(g.url, "_blank") },
    "-",
    { label: t("act.add") + suffix, hint: t("menu.add.hint"), sub: sub((c) => applyBatch(ids, "add", c)) },
    { label: t("act.move") + suffix, hint: t("menu.move.hint"), sub: sub((c) => applyBatch(ids, "move", c)) },
  ];
  if (srcs.length === 1) {
    items.push({ label: t("act.removeFrom", { name: srcs[0].title }) + suffix, hint: t("menu.removeOne.hint"),
      act: () => applyBatch(ids, "remove", srcs[0]) });
  } else if (srcs.length > 1) {
    // Inside a collection view the open one is the common target: expose it
    // directly, and tuck the remaining ones into a submenu.
    const cur = opened ? srcs.find((c) => viewKey(c) === viewKey(opened)) : null;
    if (cur) items.push({ label: t("act.removeFrom", { name: cur.title }) + suffix, hint: t("menu.removeOne.hint"),
      act: () => applyBatch(ids, "remove", cur) });
    const rest = cur ? srcs.filter((c) => viewKey(c) !== viewKey(cur)) : srcs;
    items.push({ label: cur ? t("menu.removeOthers") : t("act.removePick") + suffix,
      hint: cur ? t("menu.removeOthers.hint", { n: rest.length, unit: plural(rest.length, "collection", "collections") }) : t("menu.removePick.hint"),
      sub: removeSub(ids, rest) });
  } else {
    items.push({ label: t("act.removePick") + suffix, hint: t("menu.removeNone.hint"), disabled: true });
  }
  if (needAll) items.push({ label: t("menu.removeAll"), hint: t("menu.removeAll.hint"), danger: true, act: () => applyBatch(ids, "removeAll") });
  items.push("-");
  items.push({ label: t("menu.selectAll"), act: selectAllVisible });
  items.push({ label: t("menu.invert"), act: invertSelection });
  showMenu(e, items);
}
function colContextMenu(e, c) {
  showMenu(e, [
    { label: t("menu.openCol"), act: () => openView(colView(c)) },
    "-",
    { label: c.isNew ? t("menu.cancelCreate") : t("menu.deleteCol"), danger: !c.isNew, act: () => opDeleteCol(c.title) },
  ]);
}

$("pill").onclick = openConfirm;

// ---- pre-write safety: assets that fall out of every collection ----
// itch exposes no "my whole library" endpoint: the snapshot is built by walking
// your collections. So an asset that ends up in no collection is absent from the
// next snapshot — it drops out of 主页 / 全部 / 未分类 and there is no entry point
// to bring it back. Nothing is deleted on itch; the tool just loses sight of it.
function orphansAfterPlan() {
  const preview = previewCollections();
  const wasIn = new Map();
  for (const c of S.snapshot.collections) {
    for (const g of c.games) {
      if (!wasIn.has(g.id)) wasIn.set(g.id, []);
      if (!wasIn.get(g.id).includes(c.title)) wasIn.get(g.id).push(c.title);
    }
  }
  const out = [];
  for (const [id, g] of allGames()) {
    if (preview.memberOf(id).length) continue;
    out.push({ id, title: g.title || `#${id}`, wasIn: wasIn.get(id) || [] });
  }
  return out;
}

function renderRiskBanner(body, orphans, deletes) {
  if (!orphans.length && !deletes) return;
  const parts = [`<div class="riskbox-head">${esc(t("risk.head"))}</div>`];
  if (deletes) {
    parts.push(`<p class="riskbox-line">${t("risk.delete", { n: deletes, unit: plural(deletes, "collection", "collections") })}</p>`);
  }
  if (orphans.length) {
    parts.push(`<p class="riskbox-line">${t("risk.orphans", { n: orphans.length, unit: plural(orphans.length, "asset", "assets") })}</p>`);
    parts.push(`<p class="riskbox-note">${esc(t("risk.orphansNote"))}</p>`);
    parts.push(`<ul class="riskbox-list">${orphans.slice(0, 12).map((o) =>
      `<li>${esc(o.title)}${o.wasIn.length ? `<span class="muted">${esc(t("risk.wasIn", { names: o.wasIn.join(t("risk.wasInSep")) }))}</span>` : ""}</li>`
    ).join("")}</ul>`);
    if (orphans.length > 12) parts.push(`<p class="muted">${esc(t("risk.more", { n: orphans.length - 12 }))}</p>`);
  }
  parts.push(`<label class="checkline"><input type="checkbox" id="ackRisk"> ${esc(t("risk.ack"))}</label>`);
  const box = document.createElement("div");
  box.className = "riskbox";
  box.innerHTML = parts.join("");
  body.appendChild(box);
}

// The write button stays disabled until the risk tick box above is checked.
// A plan with no risk carries no tick box, and the button is simply enabled.
function syncExecGate() {
  const btn = $("btnConfirmExec");
  const ack = $("ackRisk");
  btn.disabled = !!ack && !ack.checked;
  btn.title = btn.disabled ? t("risk.ackFirst") : "";
}

/** One line of the confirmation list: the action, and what it acts on. */
function diffRow(kind, it, gm) {
  if (kind === "add" || kind === "remove") {
    const gt = it.gameTitle || (gm.get(it.gameId) || {}).title || it.gameId || "";
    return {
      verb: kind === "add" ? t("diff.add") : t("diff.remove"),
      text: t("diff.moveTo", { game: gt, col: it.collection || it.title || "" }),
    };
  }
  if (kind === "order") {
    const ids = it.gameIds || [];
    const head = ids.slice(0, 5).map((id) => (gm.get(id) || {}).title || id).join(" → ");
    return {
      verb: t("diff.order"),
      text: t("diff.orderText", { col: it.collection || "", n: ids.length, head, unit: plural(ids.length, "item", "items") })
        + (ids.length > 5 ? t("diff.orderMore") : ""),
    };
  }
  if (kind === "colCreate") return { verb: t("diff.create"), text: it.title || "" };
  return { verb: t("diff.delete"), text: it.title || "" };
}

function openConfirm() {
  const body = $("confirmBody");
  body.innerHTML = "";
  const gm = allGames();
  const group = (title, entries, kind) => {
    if (!entries.length) return;
    const box = document.createElement("div");
    box.className = "diff-group";
    box.innerHTML = `<div class="dg-head">${esc(title)} <span class="muted">${esc(t("confirm.countSuffix", { n: entries.length }))}</span></div>`;
    for (const it of entries) {
      const { verb, text } = diffRow(kind, it, gm);
      const row = document.createElement("div");
      row.className = "diff-item";
      row.innerHTML = `<span class="op ${kind}">${esc(verb)}</span><span>${esc(text)}</span>
        <button class="undo" style="margin-left:auto;padding:2px 8px;font-size:11px;">${esc(t("common.undo"))}</button>`;
      row.querySelector(".undo").onclick = () => { removeFromPlan(kind, it); openConfirm(); };
      box.appendChild(row);
    }
    body.appendChild(box);
  };
  group(t("confirm.group.create"), S.plan.create, "colCreate");
  const byCol = {};
  for (const a of S.plan.add) (byCol[a.collection] = byCol[a.collection] || []).push(a);
  for (const [col, arr] of Object.entries(byCol)) group(t("confirm.group.add", { col }), arr, "add");
  const byCol2 = {};
  for (const r of S.plan.remove) (byCol2[r.collection] = byCol2[r.collection] || []).push(r);
  for (const [col, arr] of Object.entries(byCol2)) group(t("confirm.group.remove", { col }), arr, "remove");
  group(t("confirm.group.order"), S.plan.order, "order");
  group(t("confirm.group.delete"), S.plan.deleteCollections, "colDelete");
  if (!body.children.length) body.innerHTML = `<p class="muted">${esc(t("confirm.empty"))}</p>`;
  const orphans = orphansAfterPlan();
  const deletes = S.plan.deleteCollections.length;
  renderRiskBanner(body, orphans, deletes);
  const rb = body.querySelector(".riskbox");
  if (rb) {
    // Warnings go on top: the diff groups can be hundreds of rows long.
    body.insertBefore(rb, body.firstChild);
    rb.querySelector("#ackRisk").onchange = syncExecGate;
  }
  syncExecGate();
  $("confirmSummary").textContent = t("confirm.summary", { n: planSize(), rate: $("rate").value || 1, unit: plural(planSize(), "operation", "operations") });
  $("confirmOverlay").classList.remove("hidden");
}
function removeFromPlan(kind, it) {
  mutatePlan(() => {
    if (kind === "add") S.plan.add = S.plan.add.filter((x) => !(x.collection === it.collection && x.gameId === it.gameId));
    if (kind === "remove") S.plan.remove = S.plan.remove.filter((x) => !(x.collection === it.collection && x.gameId === it.gameId));
    if (kind === "order") S.plan.order = S.plan.order.filter((x) => orderKey(x) !== orderKey(it));
    if (kind === "colCreate") S.plan.create = S.plan.create.filter((x) => x.title !== it.title);
    if (kind === "colDelete") {
      S.plan.deleteCollections = S.plan.deleteCollections.filter((x) =>
        it.collectionId ? x.collectionId !== it.collectionId : x.title !== it.title);
    }
  });
  savePlan();
  render();
}
$("btnClearPlan").onclick = async () => {
  const n = planSize();
  if (!confirm(t("confirm.clearAllConfirm", { n, unit: plural(n, "change", "changes") }))) return;
  setPlan(emptyPlan());
  const r = await api("/api/plan/clear", {});
  updatePill();
  render();
  openConfirm();
  if (r && r.hadProgress) toast(t("toast.cleared"));
};
$("btnConfirmExec").onclick = async () => {
  if (!document.querySelector("#confirmBody .diff-item")) return;
  const ack = $("ackRisk");
  // Covers both risks (orphaned assets and collection deletion) in one gate,
  // so there is no second confirm() dialog stacked on top of it.
  if (ack && !ack.checked) { toast(t("risk.ackFirst")); return; }
  await planQueue;
  await api("/api/config", { rateLimitPerSec: parseFloat($("rate").value || "1") });
  $("confirmOverlay").classList.add("hidden");
  // Start the run *before* opening the progress panel. The executor keeps its
  // last status object until the next start() resets it, so opening the panel
  // first would let the very first poll read the PREVIOUS run's `finished:true`,
  // kill the timer and freeze the panel on "完成" while the backend was in fact
  // still writing. Starting first guarantees the first poll sees this run.
  try {
    await api("/api/execute", { dryRun: false, ackOrphans: !!(ack && ack.checked), lang: getLang() });
  } catch (e) {
    if (execTimer) { clearInterval(execTimer); execTimer = null; }
    S.execRunning = false;
    $("execOverlay").classList.add("hidden");
    await loadState();
    updatePill();
    render();
    alert(e.message);
    return;
  }
  openExec();
};

let execTimer = null;
function openExec() {
  $("execOverlay").classList.remove("hidden");
  $("btnRollback").classList.add("hidden");
  $("btnReloadAfter").classList.add("hidden");
  $("execlog").textContent = "";
  // Never open on the previous run's leftovers.
  $("execFill").style.width = "0%";
  $("execStat").textContent = t("exec.starting");
  S.execRunning = true;
  if (execTimer) clearInterval(execTimer);
  execTimer = setInterval(pollExec, 700);
  pollExec();
}
async function pollExec() {
  let st;
  try { st = await api("/api/exec/status"); }
  catch (e) { return; }
  S.execRunning = !!st.running;
  $("execFill").style.width = st.total ? (100 * st.done / st.total) + "%" : "0%";
  $("execStat").textContent = st.running ? `${st.done} / ${st.total}` :
    (st.finished ? t("exec.done", { ok: (st.summary && st.summary.ok) || 0, fail: (st.summary && st.summary.fail) || 0 })
      + (st.dryRun ? t("exec.drySuffix") : "") : t("exec.waiting"));
  $("execlog").textContent = (st.logs || []).join("\n");
  $("execlog").scrollTop = $("execlog").scrollHeight;
  if (!st.finished) return;
  clearInterval(execTimer);
  execTimer = null;
  S.execRunning = false;
  await loadState();
  updatePill();
  render();
  const rev = st.reversePlan;
  if (!st.dryRun && hasReverse(rev) && planSize() === 0) $("btnRollback").classList.remove("hidden");
  $("btnReloadAfter").classList.remove("hidden");
  if (st.error) $("execStat").textContent += " — " + st.error;
}

/** Does this run's status carry an inverse plan worth offering? */
function hasReverse(rev) {
  if (!rev) return false;
  return ["add", "remove", "deleteCollections"].some((k) => (rev[k] || []).length > 0);
}

/** The last finished real write can still be undone, and nothing local is
 *  queued that a rollback would trample. */
function rollbackAvailable() {
  const st = S.exec;
  return !!st && st.finished && !st.dryRun && planSize() === 0 && hasReverse(st.reversePlan);
}

async function doRollback() {
  try { await api("/api/rollback", {}); openExec(); }
  catch (e) { alert(e.message); }
}

$("btnExecCancel").onclick = () => api("/api/exec/cancel", {}).catch(() => {});
// After a write: just reload the page. The library needs nothing from here — a
// successful write already resynced the snapshot server-side (that is how the
// queue ended up empty) and the panel above re-rendered from it. A partial
// write keeps the queue on purpose, which is precisely the state the app
// refuses to sync over (409). So this button only rebuilds the page's own
// state, and its label says exactly that.
//
// The toolbar's 「刷新游戏库」 is the one that really re-pulls from itch, with
// the 409 guard for a non-empty queue.
$("btnReloadAfter").onclick = () => location.reload();
$("btnRollback").onclick = doRollback;

$("search").oninput = (e) => { S.search = e.target.value; render(); };
document.querySelectorAll("#viewModes button[data-mode]").forEach((b) => {
  b.onclick = () => {
    S.mode = b.dataset.mode;
    document.querySelectorAll("#viewModes button[data-mode]").forEach((x) => x.classList.toggle("active", x === b));
    render();
  };
});
$("btnHome2").onclick = () => window.open("/api/export/csv", "_blank");
document.querySelectorAll("#sidebar .side-item[data-view]").forEach((d) => {
  d.onclick = () => openView(d.dataset.view);
});
function newCollectionPrompt() {
  const name = prompt(t("prompt.newCol"));
  if (!name || !name.trim()) return;
  if (!opCreate(name.trim())) { toast(t("toast.colExists")); return; }
  savePlan();
  render();
  toast(t("toast.created", { name: name.trim() }));
}
$("btnNewCol").onclick = newCollectionPrompt;
$("btnBatchAdd").onclick = (e) => {
  if (!S.selected.size) return;
  const ids = [...S.selected];
  pickCollection(e, (c) => applyBatch(ids, "add", c));
};
$("btnBatchMove").onclick = (e) => {
  if (!S.selected.size) return;
  const ids = [...S.selected];
  pickCollection(e, (c) => applyBatch(ids, "move", c));
};
$("btnBatchRemove").onclick = (e) => {
  const ids = [...S.selected];
  if (!ids.length) return;
  const srcs = sourceCols(ids, previewCollections());
  if (!srcs.length) { toast(t("toast.notInAny")); return; }
  // One possible source: no point asking, just do it.
  if (srcs.length === 1) { applyBatch(ids, "remove", srcs[0]); return; }
  const opened = currentCol(previewCollections());
  showMenu(e, srcs.map((c) => ({
    label: t("act.removeFrom", { name: c.title }) + (opened && viewKey(c) === viewKey(opened) ? t("menu.current") : ""),
    act: () => applyBatch(ids, "remove", c),
  })));
};
$("btnBatchRemoveAll").onclick = () => {
  if (S.selected.size) applyBatch([...S.selected], "removeAll");
};
$("btnSelAll").onclick = () => selectAllVisible();
$("btnSelInvert").onclick = () => invertSelection();
$("btnSelClear").onclick = () => clearSelection();
$("btnResync").onclick = () => doSync();
function goHome() {
  if (S.view !== "home") openView("home");
}
$("btnBackHome").onclick = goHome;
// Overlays own Esc: never yank the view out from under an open dialog.
const OVERLAYS = ["confirmOverlay", "execOverlay", "setup"];
function overlayOpen() {
  return OVERLAYS.some((id) => !$(id).classList.contains("hidden"));
}
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const tag = (e.target && e.target.tagName) || "";
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if (overlayOpen()) return;
  if ($("layout").classList.contains("hidden")) return;
  e.preventDefault();
  goHome();
});

// ---- marquee selection: drag across empty space to box-select cards ----
/** True when a press landed on the element's own scrollbar rather than its
 *  content. The bar fills the strip between the client box and the border box,
 *  so any point past clientWidth/clientHeight is on it — not a card, not empty
 *  space. Without this guard a scrollbar drag reads as "press on empty space",
 *  starts a marquee, and the edge auto-scroll then fights the native scrollbar,
 *  yanking the list around while the user is only trying to scroll it. */
function onScrollbar(el, ev) {
  const r = el.getBoundingClientRect();
  const x = ev.clientX - r.left - el.clientLeft;
  const y = ev.clientY - r.top - el.clientTop;
  return x >= el.clientWidth || y >= el.clientHeight;
}

function setupMarquee() {
  const host = $("content");
  let box = null, base = null, startX = 0, startY = 0;
  // Right button on empty space: a plain click must still open the app menu, so
  // nothing happens until the pointer actually travels. `rBtn` holds the press
  // point while we wait to find out which of the two it will be.
  let rBtn = null, rMoved = false;
  const SLOP = 4;

  const paint = (set) => {
    S.selected = set;
    S.anchor = null;
    paintSelection([...host.querySelectorAll("[data-gid]")], null);
    const badge = $("selInfo");
    badge.classList.toggle("hidden", set.size === 0);
    badge.textContent = set.size ? t("sel.info", { n: set.size }) : "";
    renderToolbar(previewCollections());
  };

  const apply = (pt) => {
    const x1 = Math.min(startX, pt.clientX), x2 = Math.max(startX, pt.clientX);
    const y1 = Math.min(startY, pt.clientY), y2 = Math.max(startY, pt.clientY);
    if (box) {
      box.style.left = x1 + "px"; box.style.top = y1 + "px";
      box.style.width = (x2 - x1) + "px"; box.style.height = (y2 - y1) + "px";
    }
    const set = new Set(base);
    host.querySelectorAll("[data-gid]").forEach((n) => {
      const r = n.getBoundingClientRect();
      if (r.left < x2 && r.right > x1 && r.top < y2 && r.bottom > y1) set.add(Number(n.dataset.gid));
    });
    paint(set);
  };

  // Starts a real marquee. The origin is passed in because a right-drag only
  // becomes a box after the pointer has moved — the box must still be anchored
  // where the button went down, not where the pointer happens to be by then.
  const beginBox = (ox, oy, additive) => {
    // Pressing empty space drops the old selection — that is what a click on
    // nothing means. Ctrl keeps it and adds whatever the box sweeps up.
    if (!additive) { S.selected.clear(); S.anchor = null; S.lastKey = null; }
    base = new Set(S.selected);
    paint(new Set(S.selected));
    startX = ox; startY = oy;
    box = document.createElement("div");
    box.id = "marquee";
    box.style.cssText = `left:${startX}px;top:${startY}px;width:0;height:0;`;
    document.body.appendChild(box);
    // Keeps selecting while the pointer is parked at the top/bottom edge.
    AutoScroll.start({ clientX: ox, clientY: oy }, apply, false);
  };

  const onMove = (ev) => {
    if (rBtn && !rMoved) {
      if (Math.abs(ev.clientX - rBtn.x) + Math.abs(ev.clientY - rBtn.y) < SLOP) return;
      rMoved = true;
      beginBox(rBtn.x, rBtn.y, ev.ctrlKey || ev.metaKey);
    }
    AutoScroll.track(ev);
    apply(ev);
  };

  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    AutoScroll.stop();
    if (box) { box.remove(); box = null; }
    // A right-press that never moved is an ordinary right-click, and that is
    // where the empty-space menu belongs. Deferring it to mouseup (instead of
    // the contextmenu event, which fires on press on Windows) is what lets a
    // right-drag box-select without a menu blinking open mid-gesture.
    if (rBtn && !rMoved) blankContextMenu({ clientX: rBtn.x, clientY: rBtn.y });
    rBtn = null;   // rMoved stays until the next press, so the trailing
                   // contextmenu event some platforms fire after mouseup
                   // cannot pop the menu back up at the end of a drag.
    renderToolbar(previewCollections());
  };

  host.addEventListener("mousedown", (ev) => {
    // Fresh gesture: clear the "that was a drag" memory from the previous one.
    // Done before any early return so a press on a card clears it too.
    rMoved = false;
    if (ev.button !== 0 && ev.button !== 2) return;
    // A scrollbar drag belongs to the browser. Treating it as a press on empty
    // space would start a marquee, and the edge auto-scroll would then yank the
    // list out from under the pointer instead of letting it scroll normally.
    if (onScrollbar(host, ev)) return;
    if (ev.target.closest("[data-gid]")) return;
    if (ev.target.closest("button, input, a, select, textarea")) return;
    if (ev.button === 2) {
      rBtn = { x: ev.clientX, y: ev.clientY };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      return;
    }
    // Left button on empty space: a click means "clicked nothing" (drop the
    // selection), a drag sweeps a box. Both live in beginBox. The shelf title
    // is the one spot on this surface that still belongs to its own click
    // handler, so it is left alone.
    if (ev.target.closest("h3")) return;
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    ev.preventDefault();   // no text-selection sweep while boxing
    beginBox(ev.clientX, ev.clientY, ev.ctrlKey || ev.metaKey);
  });

  // Empty space gets this app's menu instead of the browser's. Right-presses are
  // left to onUp above; this only catches the ones we never saw a mousedown for
  // (menu key, Shift+F10) and suppresses the native menu everywhere else.
  host.addEventListener("contextmenu", (ev) => {
    if (ev.target.closest("[data-gid]") || onScrollbar(host, ev)) return;
    ev.preventDefault();
    if (rBtn || rMoved) return;
    // Some platforms fire contextmenu *after* mouseup: onUp already opened the
    // menu for this very click, so do not build it a second time.
    if (!ctx.classList.contains("hidden")) return;
    blankContextMenu(ev);
  });
}
setupMarquee();

// The hint strip is deliberately one single row, so on a narrow window it has to
// scroll sideways — but a plain wheel only scrolls vertically, and the
// scrollbar is hidden, so there was no way to reach the rest of it at all.
// Map vertical wheel onto horizontal, and let the strip be dragged sideways.
function setupHintScroll() {
  const bar = $("hintbar");
  if (!bar) return;
  const overflows = () => bar.scrollWidth - bar.clientWidth > 1;
  const sync = () => bar.classList.toggle("can-scroll", overflows());
  bar.addEventListener("wheel", (e) => {
    if (!overflows()) return;
    const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (!d) return;
    bar.scrollLeft += d;
    e.preventDefault();
  }, { passive: false });
  bar.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || !overflows()) return;
    const x0 = e.clientX, left0 = bar.scrollLeft;
    e.preventDefault();     // pan the strip; do not sweep a text selection
    const mv = (ev) => { bar.scrollLeft = left0 - (ev.clientX - x0); };
    const up = () => {
      document.removeEventListener("mousemove", mv);
      document.removeEventListener("mouseup", up);
      sync();
    };
    document.addEventListener("mousemove", mv);
    document.addEventListener("mouseup", up);
  });
  sync();
  // The layout starts hidden and only gets its real width once boot() reveals
  // it, so watch the element instead of only the window.
  if (window.ResizeObserver) new ResizeObserver(sync).observe(bar);
  window.addEventListener("resize", sync);
}
setupHintScroll();

function blankContextMenu(e) {
  showMenu(e, [
    { label: t("menu.selectAllCount", { n: visibleIds().length }), hint: t("menu.selectAll.hint"), act: selectAllVisible },
    { label: t("menu.invert"), hint: t("menu.invert.hint"), act: invertSelection },
    { label: t("menu.clearSel"), disabled: !S.selected.size, act: clearSelection },
    "-",
    { label: t("menu.newCol"), hint: t("menu.newCol.hint"), act: newCollectionPrompt },
  ]);
}

let toastTimer;
function toast(msg, action, ms) {
  let t = document.getElementById("toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    document.body.appendChild(t);
  }
  t.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);display:flex;align-items:center;gap:10px;background:var(--surface);border:0.5px solid var(--border2);border-radius:99px;padding:8px 16px;z-index:1200;box-shadow:0 3px 10px rgba(0,0,0,.12);";
  t.innerHTML = "";
  const span = document.createElement("span");
  span.textContent = msg;
  t.appendChild(span);
  if (action) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = action.label;
    b.onclick = () => { t.style.display = "none"; clearTimeout(toastTimer); action.fn(); };
    t.appendChild(b);
  }
  t.style.display = "flex";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.display = "none"; }, ms || (action ? 8000 : 2600));
}

document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "a") return;
  const tag = (e.target && e.target.tagName) || "";
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if ($("layout").classList.contains("hidden") || overlayOpen()) return;
  e.preventDefault();
  selectAllVisible();
});

function showMsg(id, text, ok) {
  $(id).innerHTML = `<div class="msg ${ok ? "ok" : "err"}">${esc(text)}</div>`;
}
$("btnTestRead").onclick = async () => {
  try { await saveSetupCfg(); const r = await api("/api/config/test-read", {}); showMsg("setupMsg", r.message, true); }
  catch (e) { showMsg("setupMsg", e.message, false); }
};
$("btnTestWrite").onclick = async () => {
  try { await saveSetupCfg(); const r = await api("/api/config/test-write", {}); showMsg("setupMsg", r.message, true); }
  catch (e) { showMsg("setupMsg", e.message, false); }
};
$("btnSync").onclick = () => doSyncFromSetup();
$("btnSaveSetup").onclick = () => doSyncFromSetup();
$("btnDemo").onclick = async () => {
  await api("/api/config", { demoMode: true });
  await boot(true);
};
$("btnSettings").onclick = () => {
  $("apiKey").placeholder = S.keySaved ? t("setup.ph.saved") : t("setup.ph.gen");
  $("layout").classList.add("hidden");
  $("setup").classList.remove("hidden");
};
$("btnSetupBack").onclick = () => boot();
async function saveSetupCfg() {
  const hadKey = $("apiKey").value.trim();
  await api("/api/config", {
    apiKey: hadKey,
    demoMode: false,
    rateLimitPerSec: parseFloat($("rate").value || "1"),
    proxy: $("proxy").value.trim(),
  });
  if (hadKey) $("apiKey").placeholder = t("setup.ph.saved");
  $("apiKey").value = "";
}
async function syncSnapshot(force) {
  try {
    return await api("/api/sync", { force: !!force });
  } catch (e) {
    if (!force && e.status === 409) {
      if (confirm(e.message + t("sync.confirmForce"))) {
        return api("/api/sync", { force: true });
      }
      const cancel = new Error(t("err.syncCancelled"));
      cancel.status = 499;
      throw cancel;
    }
    throw e;
  }
}
async function doSyncFromSetup() {
  try {
    await saveSetupCfg();
    showMsg("setupMsg", t("setup.syncing"), true);
    await syncSnapshot(false);
    await boot();
  } catch (e) {
    showMsg("setupMsg", e.message, e.status === 499);
  }
}
async function doSync() {
  $("btnResync").textContent = t("toolbar.refreshing");
  try {
    await syncSnapshot(false);
    await loadState();
    render();
  } catch (e) {
    if (e.status !== 499) alert(t("err.syncFailed", { msg: e.message }));
  }
  $("btnResync").textContent = t("toolbar.resync");
}

async function loadState() {
  await planQueue;
  const st = await api("/api/state");
  S.snapshot = st.snapshot;
  S.demo = st.demoMode;
  S.keySaved = !!st.keySaved;
  S.exec = st.exec || null;
  S.order = Array.isArray(st.collectionOrder) ? st.collectionOrder : [];
  // setPlan() also busts the derived cache, which the fresh snapshot needs.
  setPlan(st.plan);
  if (st.rateLimitPerSec) $("rate").value = st.rateLimitPerSec;
  if (typeof st.proxy === "string") $("proxy").value = st.proxy;
}
async function boot() {
  await loadState();
  if (!S.snapshot) {
    $("btnSetupBack").classList.add("hidden");
    $("setup").classList.remove("hidden");
    return;
  }
  $("btnSetupBack").classList.remove("hidden");
  $("setup").classList.add("hidden");
  $("layout").classList.remove("hidden");
  updatePill();
  render();
  // A write may still be running in the background — e.g. the tab was reloaded
  // or closed mid-run. Re-attach to it so the progress is never invisible.
  if (S.exec && S.exec.running) openExec();
  // That panel is also the only place 「撤销刚才的写入」 appears, and the reload
  // has just closed it, so the undo is re-offered here.
  else if (rollbackAvailable()) toast(t("toast.rollbackOffer"), { label: t("common.undo"), fn: doRollback }, 20000);
}

// ---- language toggle ----
// The buttons always show the language you would switch to. applyI18n() covers
// the static markup; a full render() rebuilds every dynamically written string
// (toolbar, shelves, pill). Skipped while no library is loaded yet, since the
// render pipeline needs a snapshot.
document.querySelectorAll("[data-lang-toggle]").forEach((b) => {
  b.onclick = () => {
    I18N.set(getLang() === "zh" ? "en" : "zh");
    if (S.snapshot) {
      updatePill();
      render();
    }
    $("apiKey").placeholder = S.keySaved ? t("setup.ph.saved") : t("setup.ph.gen");
  };
});
boot();
