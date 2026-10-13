# 让外部 AI 编辑器来整理（外部接入契约）

本工具为外部 AI 编辑器预留了接口。Codex、Claude Code、WorkBuddy 或一段脚本，只要能读写
本机文件，就可以读快照、写队列，把整理方案交给界面核对。

分工很简单：agent 负责把队列写对，写入由你在界面上点一下确认。

## 一句话流程

```
外部 agent 读 data/snapshot.json → 写 data/plan.json
        → 用户刷新页面 → 右下角气泡显示待写入条数
        → 确认页逐条核对 → 确认写入 → 真正改 itch
```

## 两种写入方式，选一个

| 方式 | 适用 | 要点 |
|---|---|---|
| **直接改文件** `data/plan.json` | agent 能访问文件系统（`下载到本地后直接修改`） | 写的是完整队列；界面刷新即读到。别在用户正拖拽时写，会互相覆盖 |
| `POST /api/plan` | agent 只能走 HTTP | `mode` 可为 `replace`（默认，整份覆盖）或 `merge`（并进已有队列） |

服务只监听 `127.0.0.1:8756`，中间件会拒掉非本机 Host 与跨站 Origin。本机 curl 直接调用，
无需 token。

## 队列格式（`data/plan.json` 或 `POST /api/plan` 的 `plan` 字段）

```json
{
  "mode": "merge",
  "plan": {
    "create": [{ "title": "示例收藏夹" }],
    "add": [{ "collection": "示例收藏夹", "gameId": 123456 }],
    "remove": [{ "collection": "旧收藏夹", "collectionId": 1000001, "gameId": 123456 }],
    "order": [{ "collection": "示例收藏夹", "collectionId": 1000002, "gameIds": [123456, 654321] }],
    "deleteCollections": [{ "title": "旧收藏夹", "collectionId": 1000001 }]
  }
}
```

> 直接改文件时没有 `mode` 这一层，`data/plan.json` 的内容就是 `plan` 本身。

- `mode: "merge"` 把新操作并进已有队列；`replace` 整份覆盖
- `deleteCollections` **务必带上 `collectionId`**。只给 `title` 会被当成
  「撤销本计划里同名的新建操作」，反而把 create 一起吃掉
- 执行顺序固定为 create → add → remove → **order** → deleteCollections
- `order` 排的是**收藏夹里的素材**（对应 `POST /collections/{id}/order`），
  需要 `collectionId`（要新建的收藏夹还不能排序）。`gameIds` 是一个完整顺序，
  不是增量：同一个收藏夹的多个 order 只有最后一个生效。名单里没提到的素材
  会保持相对顺序排在后面 —— 所以漏传 id 不会把它们挤出收藏夹。
  这个接口每 500 个 id 截断一次。
- 相互抵消的操作（同名 create+delete、同一 game 的 add+remove、指向已删除收藏夹的 order）会被自动去重
- `add` / `remove` 的 `collection` 是名字，`collectionId` 是已有的收藏夹 id。
  名字指向本计划新建的收藏夹时不要带 id

## 只读端点

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/state` | 全量状态：`snapshot`、`plan`、`exec` |
| GET | `/api/export/csv` | 导出当前快照 |

## 边界与注意事项

- **零归属素材会被工具遗忘（重要）**：itch 没有「读取我全部素材」的端点，快照是靠
  遍历「你的收藏夹」拼出来的。所以一个素材如果被移出所有收藏夹，它就不在下一份快照里
  —— 主页 / 全部 / 未分类一起消失，且没有入口加回来。itch 上**不会**删除它
  （`remove-game` 只是摘掉收藏夹关联，全库唯一的删除类 API 是 `delete-collection`），
  但工具从此看不见它。

  因此 `POST /api/execute` 会预检：若本次写入会产生零归属素材，且调用方没有显式确认，
  直接返回 **409** 并列出样例，需要：

  ```json
  { "dryRun": false, "ackOrphans": true }
  ```

  `ackOrphans` 就是「我已知晓这些素材会从工具里消失」。`dryRun: true` 不需要它。
  界面上的同款闸门是一个必须勾选的确认框。
- **删除收藏夹不可回滚**：回滚只覆盖 create / add / remove。删除一个已存在的收藏夹，
  其内部排序等信息无法从本工具重建。
- **写入由你确认**：外部 agent 只负责把队列写对，你在确认页点一次「确认写入」，改动才真正落到 itch。
- **前端是内存态**：外部写入后界面不会自动刷新，让用户刷新一次页面即可。
