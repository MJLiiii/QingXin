# 情心 · 慢读古典

> 水墨留白的古诗文赏读站 —— 原文、注释、译文、赏析、创作背景，逐层深入。

一个**纯静态、无后端**的古典诗词阅读网站。原生 HTML/CSS/JS，无框架、无打包工具、
运行时零依赖。全站内容由 [chinese-poetry](https://github.com/chinese-poetry/chinese-poetry)
数据集驱动，共约 **78,660 首**（全唐诗 + 宋词）。**诗词文字不写死在 HTML 里**，
一律由前端 `fetch` 加载 `data/` 下的静态 JSON。

## 特性

- 📖 **海量诗词**：全唐诗（约 5.8 万）+ 宋词（约 2.1 万），全唐诗已繁→简。
- 🎲 **首页随机推荐**：每次打开随缘一首，可"换一首"重抽。
- 🔍 **全局搜索 + 小分页**：按标题 / 作者检索，诗集每页 25 首翻阅。
- 🖋 **五段式详情页**：原文 / 注释 / 译文 / 赏析 / 创作背景，板块恒在，内容可逐首补。
- 👤 **诗人浏览**：全部 5000+ 位诗人按作品数排序、可搜索，点入见小传与代表作。
- 🎨 **宋代美学**：米纸底 + 软墨黑 + 朱砂点缀，Noto Serif SC / Cormorant Garamond。
- ⚡ **零后端**：可直接部署到 GitHub Pages 等任意静态托管。

## 目录结构

```
QingXin/
├── index.html          页眉/页脚 + 空页面容器（无诗文）
├── app.js              hash 路由 + fetch/渲染层
├── styles.css          设计系统与样式
├── data/               站点数据（已提交，由 tools/prep.mjs 生成）
│   ├── manifest.json         总数 / 分页信息
│   ├── search.json           全局搜索索引（紧凑 [id,标题,作者]）
│   ├── authors-index.json    诗人总索引（按作品数排序，供“诗人”页）
│   ├── about.json            “关于”页文案（可手工编辑）
│   ├── index/page-*.json     浏览索引，500 条/页
│   ├── poems/*.json          原文详情块，1000 首/文件（只读）
│   ├── authors/*.json        作者简介
│   └── annotations/*.json    注释叠加层（手工编辑）
└── tools/
    ├── prep.mjs        数据准备脚本
    ├── serve.mjs       本地静态服务器
    └── README.md       数据重建说明
```

## 本地预览

`fetch()` 在 `file://` 下会被拦截，必须用 HTTP 服务器打开：

```bash
node tools/serve.mjs
# 打开 http://localhost:8080
```

> 请勿用 `python -m http.server`：本机预览环境的工作目录限制会使其崩溃。

## 给某首诗补内容

数据源只提供原文与作者简介；注释 / 译文 / 赏析 / 创作背景需手工补。方法：

1. 打开任意诗的详情页，记下地址栏里的 id（如 `#/poem/c59-66` 中的 `c59-66`）。
2. 在 `data/annotations/` 新建 `<id>.json`：

   ```json
   {
     "id": "c59-66",
     "preface": "词序原文（可选）",
     "notes": [ { "term": "词语", "def": "释义" } ],
     "prefaceTranslation": "词序白话（作译文首段淡墨，可选）",
     "translation": [ "译文第一段", "第二段" ],
     "appreciation": [ "赏析" ],
     "background": [ "创作背景" ]
   }
   ```

3. 保存刷新即生效 —— **无需重跑脚本，也不改动任何大文件**。留空的字段会显示
   “尚未收录，敬请期待。”占位。详见 `data/annotations/README.md`。

## 重建数据（一般无需）

只有在刷新 / 重建 `data/**` 时才需要：

```bash
# 1. 克隆源数据到本仓库同级目录（约 450MB，勿提交）
git clone --depth 1 https://github.com/chinese-poetry/chinese-poetry ../chinese-poetry-src

# 2. 安装依赖并生成
cd tools && npm install && node prep.mjs --src ../../chinese-poetry-src
```

脚本会做繁→简（全唐诗）、剔除孤立代理字符、为宋词合成标题与 id，并**保留**
`data/annotations/`（你手写的注释不会丢），仅重建索引 / 原文 / 作者 + 顶层 JSON +
种子文件 `c59-66.json`（《水调歌头》）。`--include-song-shi` 预留开关可追加宋诗（约 25.5 万，默认关闭）。

## 实现要点

- **id 编码存储位置**：`t<块>-<序>`（唐）/ `c<块>-<序>`（宋词）直接定位
  `data/poems/<块>.json[序]`，无需查找表。
- **路由**：`#/home | #/list/:page | #/poem/:id | #/author/:slug`，各渲染函数复用既有 CSS 类，
  注入对应 `#page-<name>` 容器；`fetchJSON()` 用 `Map` 缓存。
- **设计令牌**在 `styles.css` `:root`（`--paper` #F5F1E8、`--ink` #221F1A、`--accent` #9A3B2E、
  `--serif`、`--latin`），新增 UI 一律沿用，不引入新配色。

## 部署（GitHub Pages）

本站已按 GitHub Pages 直发配置，线上地址：

**https://mjliiii.github.io/QingXin/**

启用方式（一次性，仓库设置里点一下）：

1. 打开 GitHub 仓库 → **Settings** → **Pages**。
2. **Build and deployment** → Source 选 **Deploy from a branch**。
3. Branch 选 **`main`** ，目录选 **`/ (root)`** → **Save**。
4. 约 1 分钟后上面的地址即生效。

说明：

- 仓库根有一个空的 **`.nojekyll`** 文件，禁用 Jekyll 构建，让 Pages 原样服务全部
  静态文件（含 `data/` 下数千个 JSON 与中文文件名的作者文件）。
- 所有资源与 `fetch` 路径均为相对路径，站点在 `/QingXin/` 子路径下可直接工作，无需改动。
- 采用 hash 路由（`#/…`），真实 HTTP 路径始终是 `index.html`，深链不会 404，无需额外兜底。
- `data/**` 已提交入库即为站点内容；`tools/node_modules` 与外部的
  `../chinese-poetry-src` 不纳入版本库。

## 数据来源与致谢

诗词数据来自 [chinese-poetry/chinese-poetry](https://github.com/chinese-poetry/chinese-poetry)。
繁简转换使用 [opencc-js](https://github.com/nk2028/opencc-js)。诗词原文均为公有领域作品。
