# 数据准备（tools/）

一次性把 [chinese-poetry](https://github.com/chinese-poetry/chinese-poetry) 的原始
JSON 转成本站可直接 `fetch` 的静态数据 `../data/**`。**产物已提交入库，网站运行时不依赖这里。**
只有在需要更新/重建数据时才需要重跑。

## 步骤

1. 克隆源仓库到本仓库同级目录（约 450MB，**不要提交**）：

   ```bash
   git clone --depth 1 https://github.com/chinese-poetry/chinese-poetry ../../chinese-poetry-src
   ```

   > 固定使用某个 commit 可保证再次运行时 id 稳定（id 编码了存储位置）。

2. 安装依赖并运行：

   ```bash
   cd tools
   npm install
   node prep.mjs --src ../../chinese-poetry-src
   ```

## 参数

- `--src <path>` 源仓库路径，默认 `../../chinese-poetry-src`（即 QingXin 的同级目录）。
- `--include-song-shi` 预留开关：纳入宋诗 `poet.song.*`（约 25.5 万首，默认不启用）。

## 产出（`../data/`）

| 文件 | 说明 |
|---|---|
| `manifest.json` | 总数 / 分页信息 / 朝代分面 |
| `index/page-XXXX.json` | 浏览索引，500 条/页（`{id,title,rhythmic,author,authorSlug,dynasty,kind,excerpt}`）|
| `poems/XXXX.json` | 原文详情块，1000 首/文件，**只读**（`{…,paragraphs[]}`）|
| `authors/<slug>.json` | 作者简介（一人一文件）|
| `featured.json` | 首页精选（保留原站 5 首）|
| `annotations/<id>.json` | 注释叠加层，用户手工编辑；含《水调歌头》种子 |

## 说明

- **繁 → 简**：仅对全唐诗做 `opencc-js` `t→cn` 转换；宋词本就是简体，不动。
- **id 方案**：`t<块号>-<块内序号>`（唐）/ `c<块号>-<块内序号>`（宋词），
  直接定位 `poems/<块号>.json[序号]`，注释文件名即 id。
- 重跑脚本会**清空并重建** `../data/`（幂等）。
