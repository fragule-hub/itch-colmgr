"""UI-facing message dictionary for the backend.

Covers every string the page shows on the backend's behalf: server error
details and the executor's run log. The frontend sends its language with every
call as the X-Lang header, and the write request also carries it in the body,
so request-time errors and the executor's async logs both come back in the
language the page is showing.

zh is the source of truth: a key missing from EN falls back to ZH.
"""
from __future__ import annotations

ZH = {
    # ---- server: middleware / generic errors ----
    "err.localOnly": "只接受本机访问",
    "err.crossSite": "已拒绝跨站请求",
    "err.noIndex": "index.html 不见了",
    "err.noKey": "尚未填写 API Key",
    "err.netFail": "网络请求失败：{e}（检查代理设置，或代理是否在运行）{extra}",
    "err.pendingChanges": "还有未写入的本地变更。写入或清空后再同步，否则这些变更会叠在新快照上，可能和服务器不一致。",
    "err.noSnapshot": "还没有快照，请先同步",
    "err.planField": "plan 字段 {k} 必须是数组",
    "err.queueEmpty": "待写入队列为空（互相抵消的操作已去掉）",
    "err.rollbackQueue": "待写入队列还没空。先写完或清空后，再回滚上一次已经成功的写入。",
    "err.nothingToRollback": "没有可回滚的记录",

    # ---- server: orphan gate ----
    "err.orphans": "{n} 个素材写入后不属于任何收藏夹（{sample}{more}）。"
    "它们不会从 itch 上被删除，但本工具只能通过收藏夹认识素材："
    "零归属会让它们在下次同步后从主页 / 全部 / 未分类一起消失，且无法找回。"
    "确认无误请带 ackOrphans=true 重新提交。",
    "err.orphansMore": " 等 {n} 个",

    # ---- server: connection tests ----
    "test.demoRead": "演示模式：读取正常（模拟）",
    "test.readOk": "读取成功，找到 {n} 个收藏夹",
    "test.demoWrite": "演示模式：写入权限 OK（模拟）",
    "test.createNoId": "创建成功但响应里没有 id，请到 itch 检查是否留下 _colmgr_test",
    "test.leftover": "（测试收藏夹 id={id} 可能还在，请手动删除）",
    "test.writeFailPrefix": "写入测试失败：",
    "test.writeOk": "写入权限验证通过（已创建并删除测试收藏夹）",

    # ---- executor: run log ----
    "exec.alreadyRunning": "已有写入在进行",
    "exec.error": "执行器异常：{e}",
    "exec.demoSnapshot": "当前快照是演示数据，已拒绝写入真实账号。请先同步自己的收藏夹。",
    "exec.demoSnapshotErr": "当前快照是演示数据，已拒绝写入。请先同步。",
    "exec.dryNote": "（dry-run，不实际写入）",
    "exec.demoNote": "（演示模式，模拟写入）",
    "exec.planTotal": "计划共 {n} 条操作{note}",
    "exec.cancelledLeft": "已取消，未执行的条目仍留在待写入队列。",
    "exec.demoApplied": "演示模式：已完成的变更写进了本地快照。",
    "exec.failSummary": "{n} 条失败。再次写入会跳过已经成功的条目。",
    "exec.cancelSummary": "已取消。再次写入会跳过已经成功的条目。",
    "exec.doneSummary": "完成：成功 {ok} / 跳过 {skip} / 失败 {fail}",
    "exec.resume": "断点续跑：跳过已完成 {n} 条",
    "exec.resyncing": "写入完成，正在重新同步快照…",
    "exec.snapshotUpdated": "快照已更新。",
    "exec.resyncFailed": "写入已完成，但重新同步失败：{e}。队列先留着，再次写入会跳过已成功的条目并重试同步。",

    # ---- executor: per-item results ----
    "exec.item.create": "新建收藏夹「{title}」",
    "exec.item.add": "把游戏 {game} 加入「{col}」",
    "exec.item.remove": "把游戏 {game} 移出「{col}」",
    "exec.item.order": "调整「{col}」里 {n} 个素材的顺序",
    "exec.item.delete": "删除收藏夹「{col}」",
    "exec.simulated": "模拟写入",
    "exec.createNoId": "创建成功但响应里没有收藏夹 id",
    "exec.newId": "新 id={id}",
    "exec.deleteNotFound": "找不到要删除的收藏夹「{name}」",
    "exec.colNotFound": "找不到收藏夹「{name}」",
    "exec.nothingToOrder": "这个收藏夹里没有素材可排序",
    "exec.ordered": "共 {n} 个",
    "exec.unknownOp": "未知操作 {op}",
    "exec.alreadyState": "服务器表示已是该状态",
    "exec.forbidden": "权限被拒（{status}）。个人 key 可能没有收藏夹写权限",
    "exec.netError": "网络异常：{e}",
    "exec.unknownError": "未知错误",
    "exec.cancelled": "已取消",
    "exec.retry": "  暂时失败，准备重试：{msg}",
    # ---- launcher window (main.py, frozen builds) ----
    "launcher.title": "itch 收藏夹管理器",
    "launcher.starting": "正在启动…",
    "launcher.running": "服务运行中",
    "launcher.failed": "服务启动失败，详情见同目录 error.log",
    "launcher.open": "打开界面",
    "launcher.quit": "退出",
    "launcher.data": "数据目录",
    "launcher.already": "程序已经在运行了，已为你打开界面。",
    "launcher.portsBusy": "端口 {first}-{last} 都被占用了。关掉占用这些端口的程序后再试。",
}

EN = {
    "err.localOnly": "Local connections only",
    "err.crossSite": "Cross-site request refused",
    "err.noIndex": "index.html is missing",
    "err.noKey": "No API key configured yet",
    "err.netFail": "Network request failed: {e} (check the proxy settings, or whether the proxy is running){extra}",
    "err.pendingChanges": "There are local changes not yet written. Write or clear the queue before syncing, otherwise those changes will stack on top of the new snapshot and may disagree with the server.",
    "err.noSnapshot": "No snapshot yet — sync first",
    "err.planField": "plan field {k} must be a list",
    "err.queueEmpty": "The pending queue is empty (self-cancelling ops were dropped)",
    "err.rollbackQueue": "The pending queue is not empty yet. Finish or clear it before rolling back the last successful write.",
    "err.nothingToRollback": "Nothing to roll back",

    "err.orphans": "{n} {unit} would belong to no collection after the write ({sample}{more}). "
    "They would not be deleted from itch, but this tool only knows assets through your collections: "
    "once orphaned, they vanish from Home / All games / Unsorted after the next sync and cannot be recovered. "
    "If that is intended, resubmit with ackOrphans=true.",
    "err.orphansMore": " and {n} more",

    "test.demoRead": "Demo mode: read OK (simulated)",
    "test.readOk": "Read OK — found {n} {unit}",
    "test.demoWrite": "Demo mode: write access OK (simulated)",
    "test.createNoId": "Created but the response has no id — check on itch whether _colmgr_test was left behind",
    "test.leftover": " (test collection id={id} may still exist; delete it manually)",
    "test.writeFailPrefix": "Write test failed: ",
    "test.writeOk": "Write access verified (created and deleted a test collection)",

    "exec.alreadyRunning": "A write is already running",
    "exec.error": "Executor error: {e}",
    "exec.demoSnapshot": "The current snapshot is demo data; writing to a real account was refused. Sync your own collections first.",
    "exec.demoSnapshotErr": "The current snapshot is demo data; the write was refused. Sync first.",
    "exec.dryNote": " (dry run — nothing written)",
    "exec.demoNote": " (demo mode — write simulated)",
    "exec.planTotal": "Plan: {n} {unit}{note}",
    "exec.cancelledLeft": "Cancelled; unexecuted items stay in the pending queue.",
    "exec.demoApplied": "Demo mode: completed changes were applied to the local snapshot.",
    "exec.failSummary": "{n} failed. Writing again skips the items that already succeeded.",
    "exec.cancelSummary": "Cancelled. Writing again skips the items that already succeeded.",
    "exec.doneSummary": "Done: {ok} succeeded / {skip} skipped / {fail} failed",
    "exec.resume": "Resuming: skipping {n} already-done {unit}",
    "exec.resyncing": "Write finished; resyncing the snapshot…",
    "exec.snapshotUpdated": "Snapshot updated.",
    "exec.resyncFailed": "The write finished, but resyncing failed: {e}. The queue is kept; writing again skips the items that already succeeded and retries the sync.",

    "exec.item.create": "Create collection “{title}”",
    "exec.item.add": "Add game {game} to “{col}”",
    "exec.item.remove": "Remove game {game} from “{col}”",
    "exec.item.order": "Reorder {n} {unit} in “{col}”",
    "exec.item.delete": "Delete collection “{col}”",
    "exec.simulated": "Simulated write",
    "exec.createNoId": "Created but the response has no collection id",
    "exec.newId": "new id={id}",
    "exec.deleteNotFound": "Collection to delete not found: “{name}”",
    "exec.colNotFound": "Collection not found: “{name}”",
    "exec.nothingToOrder": "No assets to order in this collection",
    "exec.ordered": "{n} in total",
    "exec.unknownOp": "Unknown op {op}",
    "exec.alreadyState": "Server says that state is already in place",
    "exec.forbidden": "Permission denied ({status}). The personal key may lack collection write access",
    "exec.netError": "Network error: {e}",
    "exec.unknownError": "Unknown error",
    "exec.cancelled": "Cancelled",
    "exec.retry": "  transient failure, retrying: {msg}",
    # ---- launcher window (main.py, frozen builds) ----
    "launcher.title": "itch collection manager",
    "launcher.starting": "Starting…",
    "launcher.running": "Server running",
    "launcher.failed": "The server failed to start; see error.log next to the exe",
    "launcher.open": "Open",
    "launcher.quit": "Quit",
    "launcher.data": "Data folder",
    "launcher.already": "Already running — opened the interface for you.",
    "launcher.portsBusy": "Ports {first}-{last} are all taken. Quit whatever holds them and retry.",
}


def tr(lang: str, key: str, **kw) -> str:
    """Translate `key` for `lang`; kw values fill {placeholders}.

    An unknown key yields the key itself rather than raising, so a typo shows
    up as a readable token in the log instead of a 500.
    """
    table = EN if (lang or "").lower().startswith("en") else ZH
    s = table.get(key) or ZH.get(key) or key
    return s.format(**kw) if kw else s


def plural(n: int, one: str, many: str) -> str:
    """English noun form for a count: plural(1, "asset", "assets") -> "asset".

    zh templates carry classifiers (个 / 项 / 条) instead of a {unit} slot, so
    the value is ignored there; only en templates use it.
    """
    return one if n == 1 else many


def lang_of(request) -> str:
    """Language requested by the UI: the X-Lang header, zh by default."""
    return "en" if (request.headers.get("x-lang") or "").lower().startswith("en") else "zh"
