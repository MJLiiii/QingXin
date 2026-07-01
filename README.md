# 情心 · 慢读古典

> 水墨留白风格的古典诗词阅读站。以静态 JSON 数据驱动，提供诗词原文、注释、译文、赏析、创作背景和诗人信息浏览。

情心是一个纯静态、无后端的古诗词阅读项目。前端使用原生 HTML、CSS、JavaScript 编写，不依赖框架或打包工具；运行时所有内容都由浏览器从 `data/` 目录下的 JSON 文件中 `fetch` 加载，诗词正文不写死在 `index.html` 里。

线上地址：<https://mjliiii.github.io/QingXin/>

## 功能特性

- 收录约 78,660 首作品，包括全唐诗 57,607 首和宋词 21,053 首。
- 首页随机推荐，每次进入或点击“换一首”都会重新抽取作品。
- 诗集浏览支持分页、标题搜索和作者搜索。
- 诗人页支持按作品数浏览全部作者，并可进入作者详情页。
- 诗词详情页固定展示原文、注释、译文、赏析、创作背景五个板块。
- 注释、译文、赏析、创作背景使用独立叠加层维护，不需要修改大体量原文数据。
- 可直接部署到 GitHub Pages、Netlify、Vercel 或任意静态文件服务。

## 技术栈

- 原生 HTML/CSS/JavaScript
- Hash Router：`#/home`、`#/list/:page`、`#/poem/:id`、`#/author/:slug`、`#/authors/:page`、`#/about`
- 前端资源：`assets/css/`、`assets/js/`
- 静态数据：`data/**/*.json`
- 数据准备脚本：Node.js ESM
- 繁简转换：`opencc-js`

## 快速开始

本项目没有构建步骤。由于浏览器会限制 `file://` 下的 `fetch()`，本地预览必须通过 HTTP 服务打开。

```bash
node tools/server/serve.mjs
```

然后访问：

```text
http://localhost:8080
```

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
npm run prep -- --src ../../chinese-poetry-src
npm run annotate:import -- --dry-run
```

说明：`tools/annotations/annotate-import.mjs` 会联网下载数据并缓存到 `tools/.cache/`。缓存目录、`tools/node_modules/` 以及 iCloud 产生的冲突副本都已在 `.gitignore` 中排除。

## 目录结构

```text
QingXin/
├── index.html                # 页面骨架：页眉、页脚和空容器
├── assets/                   # 浏览器直接加载的前端资源
│   ├── css/
│   │   └── styles.css        # 视觉样式和设计变量
│   └── js/
│       └── app.js            # 客户端路由、数据加载和页面渲染
├── data/
│   ├── manifest.json         # 数据总量、分页、分块信息
│   ├── search.json           # 全局搜索索引：[id, title, author]
│   ├── authors-index.json    # 作者索引，按作品数排序
│   ├── about.json            # 关于页文案
│   ├── index/page-*.json     # 诗集浏览索引，500 条/文件
│   ├── poems/*.json          # 诗词原文详情，1000 首/文件
│   ├── authors/*.json        # 作者简介和代表作
│   └── annotations/          # 注释、译文、赏析、创作背景叠加层
└── tools/
    ├── server/
    │   └── serve.mjs         # 本地静态服务器
    ├── data/
    │   └── prep.mjs          # 从 chinese-poetry 生成 data/**
    ├── annotations/
    │   ├── annotate-import.mjs
    │   └── annotate-lib.mjs
    └── package.json          # 工具脚本入口与依赖
```

分类规则：

- 根目录保留站点入口、项目说明和部署配置，例如 `index.html`、`README.md`、`.nojekyll`。
- `assets/` 放浏览器直接加载的前端资源，按类型拆分为 `css/` 和 `js/`。
- `data/` 放站点运行所需的静态内容数据，包含可重建数据和手工注释叠加层。
- `tools/server/` 放本地静态服务器。
- `tools/data/` 放主数据生成脚本。
- `tools/annotations/` 放注释导入、匹配和归一化脚本。

## 数据模型

诗词 ID 直接编码存储位置：

```text
t<chunk>-<index>  # 唐诗
c<chunk>-<index>  # 宋词
```

例如 `c59-66` 表示宋词数据第 `0059.json` 个分块中的第 `66` 首。`assets/js/app.js` 会根据 ID 直接定位到：

```text
data/poems/0059.json[66]
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

保存后刷新页面即可生效，不需要重跑数据脚本。字段可留空，前端会显示“尚未收录，敬请期待。”占位。更详细的格式说明见 `data/annotations/README.md`。

如果某个注释文件来自批量导入，文件中可能带有 `"source": "gushiwen"`。手工改好后建议删除这个字段，避免以后使用 `--force` 重新导入时覆盖。

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

脚本会保留 `data/annotations/` 目录，因此手工补充的注释不会被清空。内置种子文件 `c59-66.json` 可能会被重写。

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

## 部署

项目可直接作为静态站点部署。使用 GitHub Pages 时推荐配置：

- Source：Deploy from a branch
- Branch：`main`
- Folder：`/ (root)`

根目录中的 `.nojekyll` 用于让 GitHub Pages 原样服务 `data/` 目录中的 JSON 文件和中文文件名。项目使用相对路径和 hash 路由，部署在 `/QingXin/` 子路径下不需要额外 rewrite 配置。

## 数据来源与致谢

- 诗词原文来自 [chinese-poetry/chinese-poetry](https://github.com/chinese-poetry/chinese-poetry)。
- 部分译文、注释和赏析可由 [aopao/chinese-gushiwen](https://github.com/aopao/chinese-gushiwen) 导入。
- 繁简转换使用 [opencc-js](https://github.com/nk2028/opencc-js)。

诗词原文为公有领域作品。复用本项目代码或整理后的数据前，请根据实际发布需求补充清晰的许可证说明。
