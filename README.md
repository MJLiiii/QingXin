# 情心 · 慢读古典

> 慢读古典的诗词阅读站，采用应用式液态玻璃（Liquid Glass）界面。以静态 JSON 数据驱动，提供诗词原文、注释、译文、赏析、创作背景和诗人信息浏览。

情心是一个纯静态、无后端的古诗词阅读项目。前端使用原生 HTML、CSS、JavaScript 编写，不依赖框架或打包工具；运行时所有内容都由浏览器从 `data/` 目录下的 JSON 文件中 `fetch` 加载，诗词正文不写死在 HTML 里。

线上地址：<https://mjliiii.github.io/QingXin/>

界面特点：悬浮胶囊导航（手机为底部标签栏）、彩色流光背景、今日一诗加搜索的简洁首页、原文与注解分栏。

站点早先同时提供 Kyne（黑白编辑排版）和 Liquid Glass 两种界面，现只保留 Liquid Glass。旧地址 `…/QingXin/kyne/`、`…/QingXin/liquidglass/`（含 `#/poem/…` 等路由）会自动跳到根地址的同一页。

## 功能特性

- 收录约 78,660 首作品，包括全唐诗 57,607 首和宋词 21,053 首。
- 首页「今日一诗」按本地日期每天固定一首，点击“换一首”随机抽取。
- 诗集浏览支持分页，以及标题 / 作者 / 名句搜索：繁简、标点归一和轻微错字容错；名句检索覆盖有注释的名篇，并容忍一字异文（如全唐诗《静夜思》作“床前看月光”）。
- 搜索词写入地址栏：从结果进入诗词再返回，搜索词、结果和滚动位置都会保留；链接可在新标签页打开。
- 诗人页支持按作品数浏览全部作者、近似姓名搜索，并可进入作者详情页。
- 诗词详情页固定展示原文、注释、译文、赏析、创作背景五个板块；原文与词序中的注释词可点按查看释义，无内容的栏目标明“未收录”。宽屏上左栏钉住原文，右栏用分段标签切换注解，并记住上次看的栏目。
- 阅读工具：复制全文、分享链接、原文竖排、字号调节，以及跟随系统或手动切换的夜读模式。
- 注释、译文、赏析、创作背景使用独立叠加层维护，不需要修改大体量原文数据。
- 可直接部署到 GitHub Pages、Netlify、Vercel 或任意静态文件服务。

## 技术栈

- 原生 HTML/CSS/JavaScript
- Hash Router：`#/home`、`#/list/:page`、`#/poem/:id`、`#/author/:slug`、`#/authors/:page`、`#/about`（诗集、诗人页可带 `?q=` 搜索词）
- 前端资源：`assets/css/`、`assets/js/`
- 静态数据：`data/**/*.json`
- 数据准备脚本：Node.js ESM
- 繁简转换：`opencc-js`

## 快速开始

本项目没有构建步骤。由于浏览器会限制 `file://` 下的 `fetch()`，本地预览必须通过 HTTP 服务打开。

```bash
node tools/server/serve.mjs
```

然后访问 <http://localhost:8080>。

如需更换端口：

```bash
PORT=4173 node tools/server/serve.mjs
```

## 常用命令

```bash
# 本地预览
node tools/server/serve.mjs

# 安装数据处理脚本依赖
cd tools
npm install

# 语法检查 + 单元测试 + 数据一致性校验
npm run check

# 注释覆盖变化后，重建首页精选池与名句检索语料
node data/build-featured.mjs

# 重建 data/** 数据
node data/prep.mjs --src ../../chinese-poetry-src

# 试运行批量注释导入，不写文件
node annotations/annotate-import.mjs --dry-run

# 导入 chinese-gushiwen 的译文、注释、赏析
node annotations/annotate-import.mjs
```

也可以使用 npm scripts：

```bash
cd tools
npm run serve
npm test
npm run check
npm run validate
npm run featured
npm run prep -- --src ../../chinese-poetry-src
npm run annotate:import -- --dry-run
npm run annotate:scrape -- id t1-100 --dry-run
```

说明：`tools/annotations/annotate-import.mjs` 会联网下载数据并缓存到 `tools/.cache/`。缓存目录、`tools/node_modules/` 以及 iCloud 产生的冲突副本都已在 `.gitignore` 中排除。

## 目录结构

```text
QingXin/
├── index.html                # 页面骨架：胶囊页眉、底部标签栏、流光背景、折射滤镜和空容器
├── kyne/index.html           # 旧地址跳转页（跳到根地址同一页）
├── liquidglass/index.html    # 旧地址跳转页（与 kyne/index.html 相同）
├── sw.js                     # Service Worker：离线与跨刷新缓存
├── assets/                   # 浏览器直接加载的前端资源
│   ├── css/
│   │   └── glass.css         # 视觉样式和设计变量（含夜读主题）
│   └── js/
│       ├── glass-app.js      # 入口：启动路由与界面交互
│       ├── router.js         # hash 路由、渲染缓存与滚动恢复
│       ├── glass-pages.js    # 各页面渲染
│       ├── glass-ui.js       # 界面交互：分段标签、首页搜索、钉住的阅读栏
│       ├── pages.js          # 搜索 / 分页 / 今日一诗 / 诗文数据等辅助函数
│       ├── reader.js         # 阅读偏好、原文工具栏与注释浮层
│       ├── glass-templates.js # 页面 HTML 片段构建
│       ├── templates.js      # 通用 HTML 小工具（路由链接、命中高亮、注释词定位等）
│       ├── search*.js        # 标题 / 作者 / 名句检索（含 Web Worker）
│       ├── data.js、utils.js # 数据加载与工具函数
│       └── vendor/           # 本地 OpenCC 繁→简模块（搜索词归一化）
├── data/
│   ├── manifest.json         # 数据总量、分页、分块信息
│   ├── search.json           # 全局搜索索引：[id, title, author]
│   ├── lines.json            # 名句检索语料：有注释诗词的正文
│   ├── featured.json         # 首页精选池
│   ├── authors-index.json    # 作者索引，按作品数排序
│   ├── about.json            # 关于页文案
│   ├── index/page-*.json     # 诗集浏览索引，500 条/文件
│   ├── poems/*.json          # 诗词原文详情，100 首/文件
│   ├── authors/bucket-*.json # 作者简介和代表作，按 slug 哈希分 256 桶
│   └── annotations/          # 注释、译文、赏析、创作背景叠加层（格式见其中的 README.md）
└── tools/
    ├── server/
    │   └── serve.mjs         # 本地静态服务器
    ├── data/
    │   ├── prep.mjs          # 从 chinese-poetry 生成 data/**
    │   ├── build-featured.mjs # 生成首页精选池与名句检索语料
    │   └── validate.mjs      # 只读数据一致性校验
    ├── annotations/
    │   ├── annotate-import.mjs   # 从 chinese-gushiwen 数据集导入
    │   ├── annotate-scrape.mjs   # 从古诗文网抓取（backfill / expand / id / authors）
    │   ├── crawl-all-authors.mjs # 逐作者全量抓取驱动（可并发、可断点续爬）
    │   ├── check-dups.mjs        # 只读：列出共用同一网页的兄弟 id 组
    │   ├── gushiwen-client.mjs   # 礼貌的 HTTP 客户端（节流、重试、磁盘缓存）
    │   ├── gushiwen-parse.mjs    # 纯 HTML 解析
    │   └── annotate-lib.mjs      # 归一化、相似度、语料匹配、字段转换
    ├── lib/                  # 脚本共用：路径、id/分桶/分片公式、参数解析
    ├── tests/                # node:test 单元测试
    ├── check.mjs             # npm run check：语法检查 + 单元测试 + 数据校验
    └── package.json          # 工具脚本入口与依赖
```

分类规则：

- 根目录保留页面骨架、项目说明和部署配置，例如 `index.html`、`README.md`、`.nojekyll`；`kyne/`、`liquidglass/` 只放旧地址的跳转页。
- `assets/` 放浏览器直接加载的前端资源，按类型拆分为 `css/` 和 `js/`。
- `data/` 放站点运行所需的静态内容数据，包含可重建数据和手工注释叠加层。
- `tools/server/` 放本地静态服务器。
- `tools/data/` 放主数据生成脚本。
- `tools/annotations/` 放注释导入、抓取、匹配和归一化脚本。
- `tools/lib/` 放脚本共用的小模块（路径、id 公式、参数解析）；id / 分桶公式直接复用前端的 `assets/js/data.js`。

## 数据模型

诗词 ID 直接编码存储位置：

```text
t<chunk>-<index>  # 唐诗
c<chunk>-<index>  # 宋词
```

例如 `c59-66` 表示第 `59` 个 ID 分块中的第 `66` 首。每个 1000 首的分块再拆成 10 个 100 首的子文件，`assets/js/data.js` 会根据 ID 直接定位到：

```text
data/poems/0059-0.json[66]
```

核心数据分为三层：

- `data/index/page-*.json`：轻量列表索引，用于诗集分页浏览。
- `data/poems/*.json`：只读原文数据，用于详情页。
- `data/annotations/<id>.json`：可手工维护的内容叠加层，用于补充注释、译文、赏析和创作背景。

## 补充单首诗词内容

进入任意诗词详情页，地址栏会显示对应 ID，例如：

```text
#/poem/c59-66
```

在 `data/annotations/` 中新建同名 JSON 文件：

```json
{
  "id": "c59-66",
  "preface": "",
  "notes": [
    {
      "term": "明月几时有",
      "def": "化用前人诗意，以问月起兴。"
    }
  ],
  "prefaceTranslation": "",
  "translation": [
    "译文第一段。"
  ],
  "appreciation": [
    "赏析第一段。"
  ],
  "background": [
    "创作背景第一段。"
  ]
}
```

保存后刷新页面即可生效，不需要重跑数据脚本。字段可留空，前端会显示“尚未收录，敬请期待。”占位。注释词条 `term` 若与原文或词序逐字一致（可带“（拼音）”括注），原文中会自动出现可点按的释义链接。更详细的格式说明见 `data/annotations/README.md`。

新增注释后，如希望这首诗进入首页精选池和名句检索，在 `tools/` 下运行 `node data/build-featured.mjs`。

自动生成的注释文件带 `source` 字段，优先级为：手写（无 `source`）> `gushiwen-web`（古诗文网抓取）> `gushiwen`（数据集导入）> `ai`。脚本只会覆盖优先级不高于自己的文件，手写文件永不被触碰；手工改好一个自动生成的文件后请删除它的 `source` 字段。详见 `data/annotations/README.md`。

## 重建诗词数据

只有在需要刷新原始诗词数据时才需要执行本步骤。先把源数据仓库克隆到 `QingXin` 的同级目录：

```bash
git clone --depth 1 https://github.com/chinese-poetry/chinese-poetry ../chinese-poetry-src
```

然后运行：

```bash
cd tools
npm install
node data/prep.mjs --src ../../chinese-poetry-src
```

脚本会重新生成：

- `data/manifest.json`
- `data/search.json`
- `data/authors-index.json`
- `data/index/`
- `data/poems/`
- `data/authors/`

脚本会保留 `data/annotations/` 目录（因此手工补充的注释不会被清空；内置种子文件 `c59-66.json` 可能会被重写）和 `data/about.json`。它还会删除 `data/featured.json` 与 `data/lines.json`——二者由 `build-featured.mjs` 派生，不会被 prep 重建——因此重建后**必须**运行 `node data/build-featured.mjs`，否则首页无法加载、`npm run check` 会报 error。

## 批量导入注释

`tools/annotations/annotate-import.mjs` 可从 `aopao/chinese-gushiwen` 数据集中导入译文、注释和赏析，并通过作者、正文前缀和 Dice 相似度匹配到本项目的诗词 ID。

```bash
cd tools
node annotations/annotate-import.mjs --dry-run
node annotations/annotate-import.mjs
```

安全规则：

- 默认跳过已存在的注释文件。
- `--force` 只会覆盖带 `"source": "gushiwen"` 的旧导入文件。
- 手写注释不会被自动覆盖。
- 数据集中没有创作背景时，`background` 会保持为空数组。

## 网页抓取注释

绝大多数注释（4,079 / 4,120 首）来自 `tools/annotations/annotate-scrape.mjs` 对古诗文网（gushiwen.cn）的抓取，标记为 `"source": "gushiwen-web"`，含创作背景：

```bash
cd tools
node annotations/annotate-scrape.mjs id t1-100 --dry-run      # 单首试运行（c59-66 是手写种子，脚本永不触碰）
node annotations/annotate-scrape.mjs authors 李白 --limit 20   # 按作者抓取
node annotations/crawl-all-authors.mjs --pause 1 --workers 3   # 逐作者全量驱动，可断点续爬
node annotations/check-dups.mjs --quiet                        # 手改前先查共用同一网页的兄弟 id
```

抓取有 2.5 秒/请求的节流并把页面缓存到 `tools/.cache/`，可随时中断重跑。各模式、参数与「赏析投毒」检测见 `AGENTS.md`。

## 部署

项目可直接作为静态站点部署。使用 GitHub Pages 时推荐配置：

- Source：Deploy from a branch
- Branch：`main`
- Folder：`/ (root)`

根目录中的 `.nojekyll` 用于让 GitHub Pages 原样服务 `data/` 目录中的 JSON 文件和中文文件名。项目使用相对路径和 hash 路由，部署在 `/QingXin/` 子路径下不需要额外 rewrite 配置；旧地址 `/kyne/`、`/liquidglass/` 由 Pages 返回各自目录下的跳转页。

## 数据来源与致谢

- 诗词原文来自 [chinese-poetry/chinese-poetry](https://github.com/chinese-poetry/chinese-poetry)。
- 注释、译文、赏析与创作背景大多整理自 [古诗文网](https://www.gushiwen.cn/)（gushiwen.cn）。
- 部分译文、注释和赏析可由 [aopao/chinese-gushiwen](https://github.com/aopao/chinese-gushiwen) 导入。
- 繁简转换使用 [opencc-js](https://github.com/nk2028/opencc-js)。

诗词原文为公有领域作品。复用本项目代码或整理后的数据前，请根据实际发布需求补充清晰的许可证说明。
