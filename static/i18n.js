/* UI dictionary and language switching.
 *
 * Keys are semantic ids shared by both tables; the zh table is the source of
 * truth for wording. t() covers strings built in JS, applyI18n() covers the
 * static markup via data-i18n / data-i18n-ph / data-i18n-title attributes.
 * A missing entry falls back to the zh text, so an incomplete en table
 * degrades to Chinese instead of showing raw key names.
 *
 * Plural slot: zh counts nouns with classifiers (个 / 项 / 条) inside the
 * string, so only en templates carry a {unit} placeholder. Call sites pass
 * unit: plural(n, "collection", "collections"); zh templates have no {unit}
 * and ignore it.
 */
"use strict";

const I18N_ZH = {
  "app.title": "itch 收藏夹管理器",

  // ---- setup page ----
  "setup.eyebrow": "itch.io 收藏夹",
  "setup.h1": "先把游戏库接过来",
  "setup.lead": "整理都发生在这台电脑上。只有你稍后点右下角、再确认写入，itch 上的收藏夹才会变。游戏本身不会被删除。",
  "setup.apiKey.ph": "在 itch.io → 设置 → API keys 里生成",
  "setup.apiKey.hint": "只保存在本机。已经保存过的话，留空就继续用原来的。",
  "setup.proxy.label": "网络代理",
  "setup.proxy.hint": "国内访问 itch 一般要填本地代理端口。留空则直接连接。",
  "setup.connect": "连接并同步",
  "setup.demo": "先用演示数据看看",
  "setup.back": "返回游戏库",
  "setup.advancedSummary": "连不上、要检查权限，或要配 AI 时再打开",
  "setup.testRead": "测试能否读取",
  "setup.testWrite": "检查写入权限",
  "setup.syncSnapshot": "同步快照",
  "setup.testWriteHint": "检查写入权限会临时建一个叫 <code>_colmgr_test</code> 的收藏夹，建完就删掉。",
  "setup.rate.label": "写入速度（每秒最多几次请求）",
  "setup.exportCsv": "导出当前游戏库 CSV",
  "setup.exportHint": "导出的是已经同步下来的游戏库，不包括还没写入 itch 的修改。",
  "setup.ph.saved": "已保存——留空则沿用原 key",
  "setup.ph.gen": "在 itch.io/user/settings/api-keys 生成",
  "setup.syncing": "同步中…",

  // ---- sidebar ----
  "side.search.ph": "搜标题或作者",
  "side.home": "主页",
  "side.all": "全部游戏",
  "side.unassigned": "未分类",
  "side.colGroup": "收藏夹",
  "side.newColTitle": "新建收藏夹",
  "side.settings": "设置",
  "side.langTitle": "切换界面语言",
  "tag.new": "（新）",

  // ---- toolbar ----
  "toolbar.backHome": "← 主页",
  "toolbar.backHome.title": "返回主页（Esc）",
  "toolbar.grid": "网格",
  "toolbar.list": "列表",
  "toolbar.selAll": "全选",
  "toolbar.selInvert": "反选",
  "toolbar.selClear": "取消",
  "toolbar.selClear.title": "取消全部选择",
  "toolbar.batchRemove": "移出收藏夹",
  "toolbar.batchRemoveAll": "移出全部收藏夹",
  "toolbar.batchRemoveAll.title": "从所有收藏夹移出，回到未分类",
  "toolbar.resync": "刷新游戏库",
  "toolbar.refreshing": "正在刷新…",
  "toolbar.removeOne.title": "把选中的素材从「{name}」移出",
  "toolbar.removeMulti.title": "从指定的收藏夹移出（选中的素材分布在 {n} 个收藏夹里）",
  "sel.info": "已选 {n} 个",
  "demo.banner": "正在看演示数据。这里的修改不会写到你的 itch 账号。要整理自己的库，请到设置里连接。",

  // ---- hint strip ----
  "hint.click": "<kbd>单击</kbd>选中这一个",
  "hint.ctrlClick": "<kbd>Ctrl</kbd>+单击 加选／取消",
  "hint.shiftClick": "<kbd>Shift</kbd>+单击 连选一段",
  "hint.marquee": "<kbd>空白拖拽</kbd>框选，左右键均可（<kbd>Ctrl</kbd> 叠加）",
  "hint.dblclick": "<kbd>双击</kbd>打开 itch 素材页",
  "hint.rightClick": "<kbd>右键单击</kbd>素材或空白＝菜单",
  "hint.dragToCol": "<kbd>拖到收藏夹</kbd>移入（<kbd>Ctrl</kbd> 拖＝添加）",
  "hint.dragToOrder": "<kbd>在收藏夹里拖到卡片之间</kbd>调整顺序",
  "hint.dragToBin": "<kbd>拖到右下角红框</kbd>移出它所在的那个收藏夹",
  "hint.localNote": "改动先留本机，点右下角确认后才写入",

  // ---- corner bin ----
  "bin.title": "把素材从它所在的收藏夹移出（itch 上不会删除）",
  "bin.verb": "移出",
  "bin.title.named": "把素材从「{name}」移出（itch 上不会删除）",

  // ---- pill / confirm panel ----
  "pill.count": "{n} 项修改还没写入 itch",
  "pill.create": "新建 {n}",
  "pill.add": "加入 {n}",
  "pill.remove": "移出 {n}",
  "pill.order": "排序 {n}",
  "pill.delete": "删除收藏夹 {n}",
  "confirm.title": "写入 itch 之前确认一下",
  "confirm.clearAll": "全部放弃",
  "confirm.clearAll.title": "丢弃全部还没写入 itch 的改动",
  "confirm.cancel": "取消",
  "confirm.exec": "确认写入",
  "confirm.empty": "没有待写入的修改。",
  "confirm.countSuffix": "（{n} 条）",
  "confirm.group.create": "新建收藏夹",
  "confirm.group.add": "加入「{col}」",
  "confirm.group.remove": "移出「{col}」",
  "confirm.group.order": "调整收藏夹内的顺序",
  "confirm.group.delete": "删除收藏夹",
  "confirm.summary": "共 {n} 项 · 每秒最多 {rate} 次 · 素材本身不会被删",
  "common.undo": "撤销",
  "confirm.clearAllConfirm": "确认全部放弃？\n\n· 这 {n} 项还没写入 itch 的改动会被全部丢弃，无法恢复。\n· itch 上的收藏夹不会有任何变化。\n· 之前已经写入成功的部分不受影响，也不会被撤销。",
  "toast.cleared": "队列已清空。已经写到 itch 的部分还在，点「刷新游戏库」查看。",

  // ---- risk box ----
  "risk.head": "⚠️ 写入前请确认",
  "risk.delete": "<b>将删除 {n} 个收藏夹。</b>删除<b>不可回滚</b>——本工具的撤销只覆盖「新建 / 加入 / 移出」，收藏夹一旦删除就补不回来。",
  "risk.orphans": "<b>{n} 个素材写入后将不属于任何收藏夹，它们会从本工具里消失。</b>",
  "risk.orphansNote": "写入时 itch 会按你的操作把这些素材移出对应收藏夹，本工具也不再显示它们。若想保留它们的归属，先取消写入，把它们放进一个收藏夹再写。",
  "risk.wasIn": " 原属「{names}」",
  "risk.wasInSep": "」「",
  "risk.more": "…还有 {n} 个",
  "risk.ack": "我已知晓以上后果，确认继续写入",
  "risk.ackFirst": "请先勾选「我已知晓以上后果」",

  // ---- diff rows ----
  "diff.add": "＋ 加入",
  "diff.remove": "－ 移出",
  "diff.order": "排序",
  "diff.create": "新建",
  "diff.delete": "删除",
  "diff.moveTo": "{game} → 「{col}」",
  "diff.orderText": "「{col}」共 {n} 个：{head}",
  "diff.orderMore": " → …",

  // ---- exec overlay ----
  "exec.title": "正在写入 itch",
  "exec.starting": "正在启动…",
  "exec.waiting": "等待…",
  "exec.done": "完成：成功 {ok} · 失败 {fail}",
  "exec.drySuffix": "（只预览，没有修改 itch）",
  "exec.cancel": "停止",
  "exec.rollback": "撤销刚才的写入",
  "exec.reload": "刷新页面",
  "exec.reload.title": "重新加载页面，得到干净的选择状态和视图（游戏库在写入完成时已经同步过）",
  "toast.execRunning": "写入还在进行，完成前不能关掉这个窗口",
  "toast.rollbackOffer": "上一次写入还能撤销",

  // ---- empty states ----
  "empty.col.title": "这里没有游戏",
  "empty.col.body": "到「全部游戏」里选中几款，点「添加到」，或直接拖到左侧收藏夹。这些改动先留在本地。",
  "empty.noMatch.title": "没有符合的游戏",
  "empty.noMatch.body": "换个标题或作者里的词再搜。",
  "empty.home.title": "主页还是空的",
  "empty.home.body": "从左侧打开一个收藏夹，或切到「全部游戏」。",
  "empty.unassigned.title": "没有未分类的游戏",
  "empty.unassigned.body": "每款游戏都已经在至少一个收藏夹里。",
  "empty.newCol.title": "这个新收藏夹还是空的",
  "empty.newCol.body": "选中游戏后点「添加到」，或拖到左侧这个名字上。确认写入之前，itch 上不会变化。",

  // ---- batch toasts ----
  "batch.add.done": "{n} 个 →「{name}」",
  "batch.add.none": "这些素材已经在「{name}」里了",
  "batch.move.done": "{n} 个移入「{name}」（只保留这一个）",
  "batch.move.none": "这些素材已经只在「{name}」里了",
  "batch.remove.done": "{n} 个 ←「{name}」",
  "batch.remove.none": "这些素材本来就不在「{name}」里",
  "batch.removeAll.done": "{n} 个已移出所有收藏夹（回到未分类）",
  "batch.removeAll.none": "这些素材本来就不在任何收藏夹里",
  "toast.pendingDelete": "「{name}」已在待删除列表里",
  "toast.undoDone": "已撤销这一步",

  // ---- drag & drop ----
  "drag.add": "添加到",
  "drag.move": "移入",
  "drag.badge": "{verb} {n} 个{to}",
  "drag.target": " →「{name}」",
  "drag.reorder": "调整顺序",
  "sidebar.reorder.title": "拖动可调整顺序（只影响本机显示）",

  // ---- context menus ----
  "menu.openItch": "在 itch.io 打开",
  "menu.openItch.hint": "浏览器里打开素材页",
  "menu.add.hint": "可同时放进多个收藏夹",
  "menu.move.hint": "只保留这一个收藏夹",
  "menu.countSuffix": " {n} 个",
  "menu.removeOne.hint": "只从这一个收藏夹移出",
  "menu.removeOthers": "移出其他收藏夹…",
  "menu.removeOthers.hint": "这个素材还在另外 {n} 个收藏夹里",
  "menu.removePick.hint": "从指定的收藏夹移出",
  "menu.removeNone.hint": "当前不在任何收藏夹里",
  "menu.removeAll": "从所有收藏夹移出",
  "menu.removeAll.hint": "回到未分类",
  "menu.current": "（当前）",
  "menu.selectAll": "全选本页",
  "menu.selectAllCount": "全选本页（{n} 个）",
  "menu.selectAll.hint": "当前视图里的全部素材",
  "menu.invert": "反选",
  "menu.invert.hint": "选中还没被选中的",
  "menu.clearSel": "取消选择",
  "menu.newCol": "新建收藏夹…",
  "menu.newCol.hint": "先存在本地，写入后 itch 上才出现",
  "menu.openCol": "打开收藏夹",
  "menu.cancelCreate": "取消新建",
  "menu.deleteCol": "删除收藏夹（进待写入队列）",

  // ---- shared labels (toolbar buttons, menus, corner bin) ----
  "act.add": "添加到…",
  "act.move": "移入…",
  "act.removePick": "移出…",
  "act.removeFrom": "移出「{name}」",
  "common.count": "{n} 个",

  // ---- misc ----
  "order.adjusted": "「{col}」里的顺序已调整（{n} 个）",
  "confirm.cancelCreate": "取消新建收藏夹「{title}」？\n还没写入 itch，只是从本地队列里去掉。",
  "confirm.deleteCol": "把收藏夹「{title}」加入待写入的删除列表？\n现在不会删除；确认写入后才会真正删除。收藏夹里的游戏本身不会被删。",
  "prompt.newCol": "新收藏夹名称：",
  "toast.colExists": "这个收藏夹已经存在了",
  "toast.created": "已创建「{name}」（本地暂存，写入后生效）",
  "toast.notInAny": "选中的素材不在任何收藏夹里",
  "check.linked": "同",
  "sync.info": "同步于 {at} · {n} 个游戏",
  "sync.incomplete": " · {n} 个收藏夹可能没拉全",
  "sync.demo": "演示数据",
  "sync.confirmForce": "\n\n仍要重新同步吗？待写入队列会保留，但可能和服务器对不上。",
  "err.syncCancelled": "已取消同步",
  "err.syncFailed": "同步失败：{msg}",
  "err.planSave": "改动没能存进本地队列（本地服务是否还在运行？）。在恢复服务、看到这条提示消失之前，不要刷新页面，否则这些改动会丢。",
  "shelf.more": "先显示 {limit} / {total} 个，点标题看全部",
};

const I18N_EN = {
  "app.title": "itch Collections Manager",

  "setup.eyebrow": "itch.io collections",
  "setup.h1": "Connect your library first",
  "setup.lead": "All organizing happens on this computer. Only when you click the corner button and confirm the write do your itch collections change. Games themselves are never deleted.",
  "setup.apiKey.ph": "Generate at itch.io → Settings → API keys",
  "setup.apiKey.hint": "Stored on this machine only. If a key is already saved, leave this empty to keep using it.",
  "setup.proxy.label": "Network proxy",
  "setup.proxy.hint": "Accessing itch from mainland China usually needs a local proxy port. Leave empty to connect directly.",
  "setup.connect": "Connect and sync",
  "setup.demo": "Look around with demo data",
  "setup.back": "Back to library",
  "setup.advancedSummary": "Open to troubleshoot connection, check permissions, or configure AI access",
  "setup.testRead": "Test read access",
  "setup.testWrite": "Check write access",
  "setup.syncSnapshot": "Sync snapshot",
  "setup.testWriteHint": "Checking write access briefly creates a collection named <code>_colmgr_test</code> and deletes it right away.",
  "setup.rate.label": "Write speed (max requests per second)",
  "setup.exportCsv": "Export current library as CSV",
  "setup.exportHint": "Exports the library already synced here; changes not yet written to itch are not included.",
  "setup.ph.saved": "Saved — leave empty to reuse the existing key",
  "setup.ph.gen": "Generate at itch.io/user/settings/api-keys",
  "setup.syncing": "Syncing…",

  "side.search.ph": "Search titles or authors",
  "side.home": "Home",
  "side.all": "All games",
  "side.unassigned": "Unsorted",
  "side.colGroup": "Collections",
  "side.newColTitle": "New collection",
  "side.settings": "Settings",
  "side.langTitle": "Switch interface language",
  "tag.new": " (new)",

  "toolbar.backHome": "← Home",
  "toolbar.backHome.title": "Back to home (Esc)",
  "toolbar.grid": "Grid",
  "toolbar.list": "List",
  "toolbar.selAll": "Select all",
  "toolbar.selInvert": "Invert",
  "toolbar.selClear": "Clear",
  "toolbar.selClear.title": "Clear the selection",
  "toolbar.batchRemove": "Remove from collection",
  "toolbar.batchRemoveAll": "Remove from all",
  "toolbar.batchRemoveAll.title": "Remove from every collection, back to unsorted",
  "toolbar.resync": "Refresh library",
  "toolbar.refreshing": "Refreshing…",
  "toolbar.removeOne.title": "Remove the selected items from “{name}”",
  "toolbar.removeMulti.title": "Remove from chosen collections (the selection spans {n} {unit})",
  "sel.info": "{n} selected",
  "demo.banner": "You are looking at demo data. Changes here are never written to your itch account. To organize your own library, connect in Settings.",

  "hint.click": "<kbd>Click</kbd> select one",
  "hint.ctrlClick": "<kbd>Ctrl</kbd>+click add / remove",
  "hint.shiftClick": "<kbd>Shift</kbd>+click select a range",
  "hint.marquee": "<kbd>Drag empty space</kbd> box-select, either button (<kbd>Ctrl</kbd> adds)",
  "hint.dblclick": "<kbd>Double-click</kbd> open the itch page",
  "hint.rightClick": "<kbd>Right-click</kbd> an asset or empty space = menu",
  "hint.dragToCol": "<kbd>Drop on a collection</kbd> move into it (<kbd>Ctrl</kbd>-drag adds)",
  "hint.dragToOrder": "<kbd>Drop between cards in a collection</kbd> reorder",
  "hint.dragToBin": "<kbd>Drop on the red corner bin</kbd> remove from its collection",
  "hint.localNote": "Edits stay local until you confirm the write in the corner",

  "bin.title": "Remove assets from the collection they came from (nothing is deleted on itch)",
  "bin.verb": "Remove",
  "bin.title.named": "Remove assets from “{name}” (nothing is deleted on itch)",

  "pill.count": "{n} {unit} not yet written to itch",
  "pill.create": "create {n}",
  "pill.add": "add {n}",
  "pill.remove": "remove {n}",
  "pill.order": "reorder {n}",
  "pill.delete": "delete collections {n}",
  "confirm.title": "Review before writing to itch",
  "confirm.clearAll": "Discard all",
  "confirm.clearAll.title": "Discard every change not yet written to itch",
  "confirm.cancel": "Cancel",
  "confirm.exec": "Write to itch",
  "confirm.empty": "Nothing queued to write.",
  "confirm.countSuffix": " ({n})",
  "confirm.group.create": "Create collections",
  "confirm.group.add": "Add to “{col}”",
  "confirm.group.remove": "Remove from “{col}”",
  "confirm.group.order": "Reorder within collections",
  "confirm.group.delete": "Delete collections",
  "confirm.summary": "{n} {unit} total · up to {rate}/s · games themselves are never deleted",
  "common.undo": "Undo",
  "confirm.clearAllConfirm": "Discard everything?\n\n· All {n} {unit} not yet written to itch will be dropped and cannot be recovered.\n· Your itch collections will not change at all.\n· Parts already written successfully are unaffected and cannot be undone.",
  "toast.cleared": "Queue cleared. What already reached itch stays there; use “Refresh library” to see it.",

  "risk.head": "⚠️ Confirm before writing",
  "risk.delete": "<b>{n} {unit} will be deleted.</b> Deletion <b>cannot be undone</b> — the tool's undo covers create / add / remove only; once a collection is deleted it cannot be brought back.",
  "risk.orphans": "<b>{n} {unit} will belong to no collection after the write and will disappear from this tool.</b>",
  "risk.orphansNote": "The write removes them from their collections on itch, and this tool stops showing them. To keep them, cancel the write and put them into a collection first.",
  "risk.wasIn": " was in “{names}”",
  "risk.wasInSep": ", ",
  "risk.more": "…and {n} more",
  "risk.ack": "I understand the consequences — proceed with the write",
  "risk.ackFirst": "Tick “I understand the consequences” first",

  "diff.add": "＋ add",
  "diff.remove": "－ remove",
  "diff.order": "Reorder",
  "diff.create": "Create",
  "diff.delete": "Delete",
  "diff.moveTo": "{game} → “{col}”",
  "diff.orderText": "“{col}”, {n} {unit}: {head}",
  "diff.orderMore": " → …",

  "exec.title": "Writing to itch",
  "exec.starting": "Starting…",
  "exec.waiting": "Waiting…",
  "exec.done": "Done: {ok} succeeded · {fail} failed",
  "exec.drySuffix": " (dry run — itch was not modified)",
  "exec.cancel": "Stop",
  "exec.rollback": "Undo that write",
  "exec.reload": "Reload page",
  "exec.reload.title": "Reload the page for a clean selection and view (the library was already synced when the write finished)",
  "toast.execRunning": "A write is still running; this panel cannot be closed yet",
  "toast.rollbackOffer": "The last write can still be undone",

  "empty.col.title": "No games here",
  "empty.col.body": "Select a few in “All games” and click “Add to”, or drag them onto a collection on the left. These edits stay local for now.",
  "empty.noMatch.title": "No matching games",
  "empty.noMatch.body": "Try different words from the title or author.",
  "empty.home.title": "Home is still empty",
  "empty.home.body": "Open a collection on the left, or switch to “All games”.",
  "empty.unassigned.title": "No unsorted games",
  "empty.unassigned.body": "Every game is already in at least one collection.",
  "empty.newCol.title": "This new collection is still empty",
  "empty.newCol.body": "Select games and click “Add to”, or drop them onto the name on the left. Nothing changes on itch until you confirm the write.",

  "batch.add.done": "{n} added → “{name}”",
  "batch.add.none": "These assets are already in “{name}”",
  "batch.move.done": "{n} moved into “{name}” (kept only there)",
  "batch.move.none": "These assets are already only in “{name}”",
  "batch.remove.done": "{n} removed ← “{name}”",
  "batch.remove.none": "These assets were not in “{name}”",
  "batch.removeAll.done": "{n} removed from all collections (back to unsorted)",
  "batch.removeAll.none": "These assets were in no collection to begin with",
  "toast.pendingDelete": "“{name}” is already queued for deletion",
  "toast.undoDone": "That step was undone",

  "drag.add": "Add",
  "drag.move": "Move",
  "drag.badge": "{verb} {n}{to}",
  "drag.target": " → “{name}”",
  "drag.reorder": "Reorder",
  "sidebar.reorder.title": "Drag to reorder (changes the display order on this machine only)",

  "menu.openItch": "Open on itch.io",
  "menu.openItch.hint": "Open the asset page in your browser",
  "menu.add.hint": "Can go into several collections at once",
  "menu.move.hint": "Keep only this collection",
  "menu.countSuffix": " ({n})",
  "menu.removeOne.hint": "Remove from this one collection only",
  "menu.removeOthers": "Remove from other collections…",
  "menu.removeOthers.hint": "This asset is also in {n} other {unit}",
  "menu.removePick.hint": "Remove from chosen collections",
  "menu.removeNone.hint": "Not in any collection right now",
  "menu.removeAll": "Remove from all collections",
  "menu.removeAll.hint": "Back to unsorted",
  "menu.current": " (current)",
  "menu.selectAll": "Select all on this page",
  "menu.selectAllCount": "Select all on this page ({n})",
  "menu.selectAll.hint": "Everything in the current view",
  "menu.invert": "Invert selection",
  "menu.invert.hint": "Select what is not selected yet",
  "menu.clearSel": "Clear selection",
  "menu.newCol": "New collection…",
  "menu.newCol.hint": "Saved locally first; appears on itch after the write",
  "menu.openCol": "Open collection",
  "menu.cancelCreate": "Cancel creation",
  "menu.deleteCol": "Delete collection (queues the write)",

  // ---- shared labels (toolbar buttons, menus, corner bin) ----
  "act.add": "Add to…",
  "act.move": "Move to…",
  "act.removePick": "Remove from…",
  "act.removeFrom": "Remove from “{name}”",
  "common.count": "{n}",

  "order.adjusted": "Reordered {n} {unit} in “{col}”",
  "confirm.cancelCreate": "Cancel the new collection “{title}”?\nIt was never written to itch; this only removes it from the local queue.",
  "confirm.deleteCol": "Queue collection “{title}” for deletion?\nNothing is deleted now; it is really deleted only after you confirm the write. Games inside it are never deleted.",
  "prompt.newCol": "New collection name:",
  "toast.colExists": "A collection with this name already exists",
  "toast.created": "Created “{name}” (staged locally; takes effect after the write)",
  "toast.notInAny": "The selected assets are not in any collection",
  "check.linked": "≡",
  "sync.info": "Synced {at} · {n} {unit}",
  "sync.incomplete": " · {n} {unit} may be incomplete",
  "sync.demo": "Demo data",
  "sync.confirmForce": "\n\nResync anyway? The pending queue is kept, but it may disagree with the server.",
  "err.syncCancelled": "Sync cancelled",
  "err.syncFailed": "Sync failed: {msg}",
  "err.planSave": "Changes could not be saved to the local queue (is the service still running?). Do not reload the page until the service is back and this warning is gone, or these changes are lost.",
  "shelf.more": "Showing {limit} of {total} — click the title to see all",
};

const I18N = {
  lang: "zh",
  tables: { zh: I18N_ZH, en: I18N_EN },

  t(key, params) {
    let s = this.tables[this.lang][key] ?? I18N_ZH[key] ?? key;
    if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? String(params[k]) : m));
    return s;
  },

  /** Apply the language to every statically marked node, plus <title> and
   *  <html lang>. data-i18n fills innerHTML on purpose: some entries carry
   *  light markup (<kbd>, <code>) and the table is first-party code. */
  apply() {
    const lang = this.lang === "en" ? "en" : "zh-CN";
    document.documentElement.lang = lang;
    document.title = this.t("app.title");
    document.querySelectorAll("[data-i18n]").forEach((n) => { n.innerHTML = this.t(n.dataset.i18n); });
    document.querySelectorAll("[data-i18n-ph]").forEach((n) => { n.placeholder = this.t(n.dataset.i18nPh); });
    document.querySelectorAll("[data-i18n-title]").forEach((n) => { n.title = this.t(n.dataset.i18nTitle); });
    // The switch buttons always show the language you would switch TO.
    const other = this.lang === "zh" ? "English" : "中文";
    document.querySelectorAll("[data-lang-toggle]").forEach((b) => { b.textContent = other; });
  },

  load() {
    let saved = null;
    try { saved = localStorage.getItem("colmgr.lang"); } catch (e) { /* private mode etc. */ }
    this.lang = saved === "en" || saved === "zh" ? saved
      : (navigator.language || "").toLowerCase().startsWith("en") ? "en" : "zh";
  },

  set(lang) {
    this.lang = lang === "en" ? "en" : "zh";
    try { localStorage.setItem("colmgr.lang", this.lang); } catch (e) { /* ignore */ }
    this.apply();
  },
};

function t(key, params) { return I18N.t(key, params); }
function applyI18n() { I18N.apply(); }
function getLang() { return I18N.lang; }
/** English noun form for a count: plural(1, "asset", "assets") -> "asset".
 *  zh templates carry classifiers (个 / 项 / 条) instead of a {unit} slot, so
 *  the value is ignored there; only en templates use it. */
function plural(n, one, many) { return n === 1 ? one : many; }

I18N.load();
I18N.apply();
