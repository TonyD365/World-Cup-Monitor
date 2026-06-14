# World Cup Live Monitor

A hacker-terminal-style live monitor for the FIFA World Cup. It is **not** tied to a single
fixture: a dropdown lists matches that are currently in progress, and the selected match's
score / clock / events refresh **every 5 seconds**. Data is pulled from multiple no-key
sources and merged **official-first** — when sources disagree, the most authoritative one wins
(FIFA official > ESPN > openfootball > mock), and the conflict is shown on screen.

## Features
- 🖥️ Black CRT / terminal aesthetic: scanlines, flicker, blinking cursor, phosphor green + amber.
- 🔄 5-second polling with a live progress bar and per-refresh screen flash.
- 🧩 Multi-source aggregation, all **no API key**:
  - **ESPN** hidden API (`site.api.espn.com/.../soccer/fifa.world`) — primary live source.
  - **FIFA official** (`api.fifa.com/api/v3`) — best-effort; treated as the authoritative source when reachable.
  - **openfootball/worldcup.json** — public-domain schedule / fixtures fallback (not live).
  - **mock** — built-in demo data so the screen is never blank.
- 🏅 Official-first, field-by-field merge with on-screen `SOURCE CONFLICT` notices and per-field
  source tags.
- 🚦 Source health LEDs (FIFA / ESPN / OPENFB / PROXY / MOCK) and an `OFFICIAL PRECEDENCE` badge.
- ☁️ Deploys to **Cloudflare Pages** with zero build step. A Pages Function proxy
  (`/functions/api/*`) aggregates the sources server-side to avoid browser CORS; if the proxy is
  absent (e.g. opened locally), the frontend falls back to direct client-side fetches.

## Project layout
```
index.html            Single-page monitor (UI text in English)
css/monitor.css       CRT / terminal theme
js/                   Frontend: config, data orchestration, render, controller
shared/               Source adapters + normalize/merge, shared by frontend AND Functions
functions/api/        Cloudflare Pages Functions: /api/matches, /api/summary
```

## Local development
The UI works fully offline thanks to mock mode (in restricted networks the live APIs are blocked
and DEMO MODE is shown).

Static only (frontend + mock / direct fetch):
```bash
python3 -m http.server 8000
# open http://localhost:8000
```

With the Pages Functions proxy (recommended, mirrors production):
```bash
npx wrangler pages dev .
# open the URL it prints; /api/matches and /api/summary are live
```

## Deploy to Cloudflare Pages
1. Push this repo to GitHub.
2. In Cloudflare Pages, create a project from the repo.
3. Build command: **(none)** · Build output directory: **/** (repo root).
4. `functions/` is auto-detected — no extra configuration needed.

No environment variables or API keys are required.

## Notes
- The ESPN and FIFA endpoints are undocumented/community-reverse-engineered; they may change or
  rate-limit. The app is defensive: any single source failing never breaks the others.
- `openfootball` is not real-time; it only backfills fixtures/opponents when live sources lack them.

---

# 世界杯实时监控（中文）

一个**黑客终端风格**的 FIFA 世界杯实时监控页面。它**不绑定**某一场固定比赛：下拉框列出当前
正在进行的比赛，所选比赛的比分 / 计时 / 事件**每 5 秒刷新一次**。数据从多个**免密钥**源拉取，
并按**官方优先**合并——当数据源冲突时，以最权威的源为准
（FIFA 官方 > ESPN > openfootball > mock），并在界面上显示冲突提示。

## 功能特性
- 🖥️ 黑色 CRT / 终端风格：扫描线、闪烁、闪烁光标、磷光绿 + 琥珀色。
- 🔄 5 秒轮询，带实时进度条，每次刷新有整屏闪烁反馈。
- 🧩 多源聚合，全部**无需 API Key**：
  - **ESPN** 隐藏接口（`site.api.espn.com/.../soccer/fifa.world`）——主实时源。
  - **FIFA 官方**（`api.fifa.com/api/v3`）——尽力尝试；可达时视为权威源。
  - **openfootball/worldcup.json**——公有领域的赛程/对阵兜底（非实时）。
  - **mock**——内置演示数据，保证界面永不空白。
- 🏅 官方优先、逐字段合并，界面显示 `SOURCE CONFLICT` 冲突提示和每个字段的来源标签。
- 🚦 数据源健康指示灯（FIFA / ESPN / OPENFB / PROXY / MOCK）与 `OFFICIAL PRECEDENCE` 徽标。
- ☁️ 零构建步骤部署到 **Cloudflare Pages**。Pages Function 代理（`/functions/api/*`）在服务端
  聚合数据以绕开浏览器 CORS；若没有该代理（例如本地直接打开），前端自动降级为客户端直连拉取。

## 目录结构
```
index.html            单页监控界面（界面文案为英文）
css/monitor.css       CRT / 终端主题样式
js/                   前端：配置、数据编排、渲染、控制器
shared/               数据源适配器 + 归一化/合并，前端与 Function 共用
functions/api/        Cloudflare Pages Functions：/api/matches、/api/summary
```

## 本地开发
得益于 mock 模式，界面完全离线可用（受限网络下实时 API 被封会显示 DEMO MODE）。

纯静态（前端 + mock / 直连）：
```bash
python3 -m http.server 8000
# 打开 http://localhost:8000
```

带 Pages Functions 代理（推荐，贴近生产）：
```bash
npx wrangler pages dev .
# 打开它输出的地址；/api/matches 与 /api/summary 生效
```

## 部署到 Cloudflare Pages
1. 将本仓库推送到 GitHub。
2. 在 Cloudflare Pages 中基于该仓库创建项目。
3. 构建命令：**（无）**；构建输出目录：**/**（仓库根目录）。
4. `functions/` 会被自动识别——无需额外配置。

无需任何环境变量或 API Key。

## 说明
- ESPN 与 FIFA 接口为未公开 / 社区逆向，可能变更或限流。应用做了防御式设计：任一单源失败
  都不会影响其他源。
- `openfootball` 非实时，仅在实时源缺数据时用来补全赛程/对阵。
