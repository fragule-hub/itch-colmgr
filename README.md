# itch-colmgr

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Python](https://img.shields.io/badge/python-3.10%2B-blue.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-local%20web%20UI-009688.svg)](https://fastapi.tiangolo.com/)
[![Platform](https://img.shields.io/badge/platform-Windows-lightgrey.svg)](#)

<p align="center">
  <a href="#中文"><img alt="中文" src="https://img.shields.io/badge/%E8%AF%AD%E8%A8%80-%E4%B8%AD%E6%96%87-red"></a>
  <a href="#english"><img alt="English" src="https://img.shields.io/badge/language-English-blue"></a>
</p>

---

## 中文

**itch.io 收藏夹批量管理器** —— 一个在本地运行的整理工具，界面参考了 Steam 游戏库的一些交互习惯。

itch 的收藏夹只能一个个游戏手动添加 / 移除，库一大就没法整理。本工具把它变成可以批量整理的样子：左侧收藏夹树、封面墙、拖拽归类、右键菜单、多选，改完一次性批量写回。

- 技术栈：Python 3.10+ + FastAPI（本地 Web 服务）+ 原生 JS 前端
- 接口：itch.io 官方 API（`api.itch.io`，个人 API Key + Bearer 认证）
- 形态：纯本地，只监听 `127.0.0.1`，数据不出本机（写入 itch 除外）

> 为外部 AI 编辑器预留了接口：Codex、Claude Code 等 agent 读 `data/snapshot.json`、写 `data/plan.json` 就能给出整理方案（见 [docs/external-ai.md](docs/external-ai.md)），你在界面确认后再写回 itch。

### 特性

- **全本地暂存**：所有操作（含拖拽）都不直接写 itch，累积到右下角气泡，确认后批量写入
- **两种排序**：侧栏收藏夹顺序只存本机；收藏夹内素材顺序会随确认写回 itch
- **人工闸门**：写入前逐条核对，不属于任何收藏夹的素材 / 删收藏夹有红色警告，写入后可撤销
- **安全**：限速写入、失败重试、断点续跑、演示模式（无 key 也能体验）
- **中英双语**：侧栏底部一键切换界面与写入日志，偏好存浏览器本机
- 网格 / 列表视图、主页 Shelf、Ctrl / Shift 多选、右键菜单、拖拽归类

### 快速开始

```bash
pip install -r requirements.txt   # 建议 venv
python main.py                    # 自动打开浏览器
```

1. 首启在设置页粘贴 API Key（生成地址：<https://itch.io/user/settings/api-keys>），需要就填本地代理，点「连接并同步」
2. 选中游戏拖到左侧收藏夹（拖＝移入，Ctrl 拖＝添加到多个），改动先留本机
3. 点右下角「还没写入 itch」→ 逐条核对 → 确认写入

没有 Key 时点「先用演示数据看看」；读不到或写不进去时，展开设置页底部，用「测试能否读取」「检查写入权限」（会临时建删一个 `_colmgr_test`）。

### 界面操作指南

**布局**：左侧栏＝搜索框 +「主页 / 全部游戏 / 未分类」+ 收藏夹列表；右侧＝封面墙。工具栏可切网格 / 列表、刷新游戏库；有选中项时出现批量按钮。

**浏览与搜索**
- 单击侧栏进入收藏夹；双击素材卡打开它在 itch 的页面
- 侧栏搜索框按标题或作者过滤

**选择**
- 单击选中；`Ctrl`+单击加选 / 取消；`Shift`+单击连选一段
- 在空白处按住拖动＝框选（左右键均可，`Ctrl` 叠加到已有选择）
- 工具栏：全选 / 反选 / 取消；快捷键 `Ctrl+A` 全选当前视图，`Esc` 返回主页

**拖拽素材有四个落点**

拖拽的对象是素材，把素材拖到：

| 拖到 | 作用 |
|---|---|
| 侧栏收藏夹 | 移入（按住 `Ctrl` ＝添加到多个收藏夹） |
| 右下角红框 | 从它所在的那个收藏夹移出 |
| 收藏夹视图里两张卡片之间 | 调整素材顺序（会写回 itch） |
| 空白处 | 取消这次拖拽 |

调整顺序只在**点进某个收藏夹后的收藏夹视图**里有效；在主页或「全部 / 未分类」里拖到卡片之间不会排序。

> 「框选」是另一种手势：起点落在空白背景上按住拖动（见上面的「选择」）；拖素材松手在空白处只是取消这次拖拽，不会触发框选。

**排序**：侧栏收藏夹可上下拖动排序，这只是本机偏好（itch 无对应接口，不会写入）。

**右键菜单**：素材卡＝打开 itch / 添加到 / 移入 / 移出 / 从所有收藏夹移出；收藏夹＝打开 / 删除；空白处＝全选 / 反选 / 取消。

**写入**：右下角气泡点开是确认页，按收藏夹分组列出 +N / −M，可逐条撤掉；确认后限速写入，有进度和日志、可中途停止；完成后可「撤销刚才的写入」。

> 拖拽时鼠标滚轮不生效（原生拖拽把指针交给了浏览器）。把指针停到列表的上 / 下三分之一，列表就会持续滚动。

### 打包成可执行文件

装一次 PyInstaller，之后一条命令（脚本会打印最终体积）：

```bash
pip install pyinstaller
python scripts/build.py            # 单文件、无控制台（默认，约 17 MB）
python scripts/build.py --onedir   # 文件夹版，启动更快
python scripts/build.py --console  # 保留控制台，便于看日志
```

产物：`dist/itch-colmgr.exe` 或 `dist/itch-colmgr/`，两种形态共用 `itch_colmgr.spec`。双击后起服务、开浏览器、弹一个小窗口（关窗即退出）。数据（`data/` 和 `config.local.json`）住在 exe 同级目录，整个文件夹可一起迁移；端口默认 8756，被占用会自动顺延，`COLMGR_NO_BROWSER=1` 可禁止自动开浏览器。

### 配置文件

| 文件 | 作用 |
|---|---|
| `config.local.json` | API key、代理、侧栏收藏夹顺序（已 gitignore，勿提交） |
| `data/snapshot.json` | itch 数据快照（唯一事实来源） |
| `data/plan.json` | 待写入变更队列（持久化） |
| `data/exec_progress.json` | 写入断点，用于中断后续跑 |
| `data/last_reverse.json` | 上一次写入的反向计划，供「撤销」使用 |

### 注意

- 默认限速 1 请求/秒，确认页可调；侧栏收藏夹顺序是本机偏好（itch 没有对应接口，不会写入）
- **不属于任何收藏夹的素材，写入后会从工具中消失**：本地暂存期间，被移出收藏夹的素材会落在「未分类」；确认写入后，itch 上会按你的操作正确地把它们移出收藏夹，工具里也不再显示它们。写入前会有提醒
- 收藏夹写端点属于官方客户端在用的半公开 API，个人 key 权限以「检查写入权限」的结果为准

### 许可

以 **GNU AGPL-3.0** 发布，详见 [LICENSE](LICENSE)。

---

## English

**itch.io collection batch manager** — a local tool whose interface borrows a few interaction habits from the Steam library.

itch.io collections can only be edited one game at a time, which breaks down once a library grows. This tool turns that into batch work: a sidebar collection tree, a cover-art grid, drag-to-file, right-click menus and multi-select — staged locally, then written back in one confirmed batch.

- Stack: Python 3.10+ + FastAPI (local web service) + vanilla JS frontend
- API: the official itch.io API (`api.itch.io`, personal API key + Bearer auth)
- Shape: purely local, binds only `127.0.0.1`; nothing leaves your machine (except the writes to itch)

> Built to plug into AI editors: external agents such as Codex or Claude Code can read `data/snapshot.json` and write `data/plan.json` to propose a plan (see [docs/external-ai.md](docs/external-ai.md)); you confirm it in the UI before it reaches itch.

### Features

- **Fully local staging**: nothing (including drags) writes to itch directly — changes pile into the bottom-right pill and go out as one confirmed batch
- **Two kinds of ordering**: the sidebar order is a local preference; the order inside a collection is written back to itch
- **Human gate**: per-item review before writing, red warnings for assets that would end up in no collection and for deletions, and an undo after a write
- **Safe**: rate-limited writes, retries, resume-from-checkpoint, demo mode (works without a key)
- **Bilingual UI**: switch the interface and write log from the sidebar; the preference is stored in your browser
- Grid / list views, a Home shelf, Ctrl / Shift multi-select, right-click menus, drag-to-file

### Quick start

```bash
pip install -r requirements.txt   # a venv is recommended
python main.py                    # opens the browser
```

1. On first run, paste an API key (create one at <https://itch.io/user/settings/api-keys>), set a local proxy if needed, then click "Connect and sync"
2. Select games and drag them onto a sidebar collection (drag = move, Ctrl-drag = add to several); changes stay local
3. Click the "not yet written to itch" pill → review each item → confirm the write

Without a key, click "Try the demo data first". If reads or writes fail, expand the bottom of the settings page and use "Test read" / "Check write access" (it creates and deletes a temporary `_colmgr_test`).

### UI guide

**Layout**: the sidebar holds the search box, "Home / All games / Unsorted" and the collection list; the main area is the cover-art grid. The toolbar switches grid / list, refreshes the library, and shows batch buttons once anything is selected.

**Browsing and search**
- Click a sidebar entry to open a collection; double-click an asset to open its itch page
- The sidebar search box filters by title or author

**Selecting**
- Click to select; `Ctrl`+click to add / remove; `Shift`+click to select a range
- Press and drag on empty space to marquee-select (either mouse button; `Ctrl` adds to the current selection)
- Toolbar: select all / invert / clear; shortcuts `Ctrl+A` selects everything in view, `Esc` returns Home

**Dragging an asset has four drop targets**

What you drag is an asset. Drop it on:

| Drop on | Effect |
|---|---|
| A sidebar collection | Move into it (hold `Ctrl` to add to several) |
| The red bin at the bottom-right | Remove from the collection it came from |
| Between two cards in a collection view | Reorder the assets (written back to itch) |
| Empty space | Cancel the drag |

Reordering only applies inside a **collection view** (after you click into a collection); dropping between cards on Home or under All games / Unsorted does nothing.

> Marquee-select is a different gesture: it starts by pressing on the empty background (see Selecting above). Releasing an asset drag on empty space only cancels the drag.

**Ordering**: sidebar collections can be dragged up and down, but that is a local preference only (itch has no endpoint for it, so it is never written).

**Right-click menus**: on an asset = open on itch / add to / move to / remove from / remove from all collections; on a collection = open / delete; on empty space = select all / invert / clear.

**Writing**: clicking the bottom-right pill opens the review page, grouped per collection as +N / −M, with per-item removal. Confirm to write at a limited rate — with progress and a log, stoppable mid-run, and undoable afterwards.

> The mouse wheel is inactive mid-drag (a native drag hands the pointer to the browser). Park the pointer on the top / bottom third of the list to keep it scrolling.

### Build a standalone executable

Install PyInstaller once, then one command (the script prints the final size):

```bash
pip install pyinstaller
python scripts/build.py            # one-file, windowed (default, ~17 MB)
python scripts/build.py --onedir   # one-folder, starts faster
python scripts/build.py --console  # keeps a console for logs
```

Output: `dist/itch-colmgr.exe` or `dist/itch-colmgr/`; both share `itch_colmgr.spec`. Double-clicking serves the UI, opens the browser and shows a small launcher window (closing it quits). Data (`data/`, `config.local.json`) lives next to the exe, so the folder is portable; the port is 8756 by default and shifts if taken, and `COLMGR_NO_BROWSER=1` suppresses the browser.

### Configuration files

| File | Purpose |
|---|---|
| `config.local.json` | API key, proxy, sidebar collection order (gitignored; do not commit) |
| `data/snapshot.json` | the itch data snapshot (single source of truth) |
| `data/plan.json` | the pending-changes queue (persisted) |
| `data/exec_progress.json` | write checkpoint, for resuming after an interruption |
| `data/last_reverse.json` | the inverse of the last write, for undo |

### Notes

- Writes are rate-limited to 1 request/second by default (adjustable on the review page); the sidebar order is a local preference (itch has no endpoint for it, so it is never written)
- **Assets that belong to no collection disappear from the tool once written**: while staged locally they show up under Unsorted; after you confirm the write, itch removes them from their collections exactly as you asked, and the tool stops showing them too. You are warned before writing
- The collection write endpoints are the semi-public ones used by itch's own clients; whether your personal key may use them is what "Check write access" tells you

### License

Released under the **GNU AGPL-3.0**. See [LICENSE](LICENSE).
