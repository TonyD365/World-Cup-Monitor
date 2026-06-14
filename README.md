# World Cup Live Monitor

A hacker-terminal-style live monitor for the FIFA World Cup. It is **not** tied to a single
fixture: a horizontal, time-sorted timeline lists matches, and the selected match's
score / clock / events refresh **every 5 seconds**. It is a **pure static site** — the browser
fetches data directly from no-key, CORS-friendly sources and merges them client-side, with the
most authoritative source winning when they disagree.

## Features
- 🖥️ Black CRT / terminal aesthetic: scanlines, flicker, blinking cursor, phosphor green + amber.
- 🔄 5-second polling with a live progress bar and per-refresh screen flash.
- ⏱️ Live match clock above the score: `NOT STARTED`, ticking `MM:SS`, `45:00 (+x)` / `90:00 (+x)`
  stoppage, `HALF TIME`, `COOLING BREAK`, `FULL TIME`.
- 🗓️ Timeline selector: matches shown as boxes on a time axis (day, start–estimated end, teams,
  scores, status), sorted by kick-off; click to select.
- 📊 Match tabs: **Timeline** (goals, cards, subs, fouls, corners, throw-ins, offsides — each
  tagged with the team), **Lineups** (starting XI + subs), **Stats** (possession/shots/…),
  **Table** (group standings).
- 🌐 Built-in Google Translate picker (top-right) — manual, no auto-translate.
- 🏅 Field-by-field merge with on-screen `SOURCE CONFLICT` notices; authority order
  FIFA > ESPN > openfootball > mock.

## Data sources (all no API key, fetched directly in the browser)
- **ESPN** hidden API (`site.api.espn.com/.../soccer/fifa.world`) — primary live source
  (scores, clock, full commentary, lineups, stats, standings). Sends permissive CORS headers.
- **openfootball/worldcup.json** — public-domain schedule / fixtures fallback (not live).
- **FIFA official** (`api.fifa.com/api/v3`) — optional, **off by default** (`CONFIG.TRY_FIFA_DIRECT`)
  because it's usually CORS-blocked in the browser. When unavailable, ESPN is the authoritative source.
- **mock** — built-in demo data so the screen is never blank.

> No backend / no Cloudflare Function: every request goes straight from the viewer's browser to
> ESPN/openfootball, so there are no server-side request limits to worry about. The trade-off is
> the FIFA-official feed (no browser CORS) and reliance on ESPN keeping its endpoints open.

## Project layout
```
index.html            Single-page monitor (UI text in English)
css/monitor.css       CRT / terminal theme
js/                   config, data orchestration, render, controller
shared/               Source adapters + normalize/merge (also reusable server-side)
```

## Local development
Pure static — just serve the folder. With external APIs blocked, DEMO MODE shows mock data.
```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy to Cloudflare Pages
1. Push this repo to GitHub.
2. In Cloudflare Pages, create a project from the repo.
3. Build command: **(none)** · Build output directory: **/** (repo root).

No build step, no Functions, no environment variables, no API keys.

## Notes
- ESPN/FIFA endpoints are undocumented/community-reverse-engineered and may change or rate-limit.
  The app is defensive: any single source failing never breaks the others.
- `openfootball` is not real-time; it only backfills fixtures/opponents.
- Times render in the **viewer's local timezone** (`toLocale*`), not a fixed zone.

---

# 世界杯实时监控（中文）

一个**黑客终端风格**的 FIFA 世界杯实时监控页面。它**不绑定**某一场比赛:用**横向时间线**列出比赛,
所选比赛的比分 / 计时 / 事件**每 5 秒刷新一次**。它是**纯静态站点**——由浏览器**直接**从免密钥、
CORS 友好的数据源拉取并在客户端合并,冲突时以最权威的源为准。

## 功能特性
- 🖥️ 黑色 CRT / 终端风格:扫描线、闪烁、闪烁光标、磷光绿 + 琥珀色。
- 🔄 5 秒轮询,带进度条,每次刷新整屏闪烁。
- ⏱️ 比分上方的比赛计时:`NOT STARTED`、跳秒 `MM:SS`、`45:00 (+x)`/`90:00 (+x)` 补时、
  `HALF TIME`、`COOLING BREAK`、`FULL TIME`。
- 🗓️ 时间线选择器:比赛以方框排在时间轴上(日期、开始–预计结束、两队、比分、状态),
  按开球时间排序,点击选择。
- 📊 比赛标签页:**Timeline**(进球/红黄牌/换人/犯规/角球/界外球/越位,每条带队伍)、
  **Lineups**(首发 + 替补)、**Stats**(控球/射门等)、**Table**(小组积分榜)。
- 🌐 内置 Google 翻译选择框(右上角)——手动,不自动翻译。
- 🏅 逐字段合并,界面显示 `SOURCE CONFLICT` 冲突提示;权威顺序 FIFA > ESPN > openfootball > mock。

## 数据源(全部免密钥,浏览器直连)
- **ESPN** 隐藏接口——主实时源(比分、计时、完整文字直播、阵容、统计、积分榜),带 CORS。
- **openfootball/worldcup.json**——公有领域赛程/对阵兜底(非实时)。
- **FIFA 官方**(`api.fifa.com/api/v3`)——可选,**默认关闭**(`CONFIG.TRY_FIFA_DIRECT`),
  因为浏览器多半被 CORS 拦。拿不到时以 ESPN 为权威源。
- **mock**——内置演示数据,界面永不空白。

> 无后端 / 无 Cloudflare Function:每个请求都从访客浏览器直连 ESPN/openfootball,**不占用**
> 你账号的服务端请求额度。代价是丢掉 FIFA 官方源(浏览器无 CORS),并依赖 ESPN 持续开放接口。

## 目录结构
```
index.html            单页监控界面(界面文案为英文)
css/monitor.css       CRT / 终端主题
js/                   配置、数据编排、渲染、控制器
shared/               数据源适配器 + 归一化/合并
```

## 本地开发
纯静态,起个静态服务器即可。外部 API 被封时会显示 DEMO MODE 演示数据。
```bash
python3 -m http.server 8000
# 打开 http://localhost:8000
```

## 部署到 Cloudflare Pages
1. 推送到 GitHub。
2. Cloudflare Pages 基于该仓库建项目。
3. 构建命令:**(无)**;构建输出目录:**/**(仓库根目录)。

无构建步骤、无 Functions、无环境变量、无 API Key。

## 说明
- ESPN/FIFA 接口为未公开/社区逆向,可能变更或限流;应用做了防御式设计,任一源失败不影响其他源。
- `openfootball` 非实时,仅补全赛程/对阵。
- 时间按**访客本地时区**显示(`toLocale*`),非固定时区。
