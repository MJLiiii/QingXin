# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

情心 (QingXin) — a static, **no-backend** classical-Chinese poetry reading site. Vanilla
HTML/CSS/JS: no framework, no bundler, no npm dependencies at runtime. The site is fully
data-driven from the [chinese-poetry](https://github.com/chinese-poetry/chinese-poetry)
dataset (~78,660 poems: 全唐诗 + 宋词). **No poem text is hardcoded in HTML** — `index.html`
is only header/footer + empty page containers; everything else is `fetch`ed from `data/`.

## Commands

There is no build, lint, or test step. Two things you actually run:

- **Preview locally** (required — `fetch()` blocks `file://`):
  `node tools/serve.mjs` → http://localhost:8080  (cwd-independent static server).
  In Claude Code, use the `.claude/launch.json` config named **`qingxin`**.
  Do NOT use `python -m http.server` — it crashes under the preview launcher (`os.getcwd`).

- **Regenerate the data** (only when refreshing/rebuilding `data/**`):
  ```bash
  git clone --depth 1 https://github.com/chinese-poetry/chinese-poetry ../chinese-poetry-src
  cd tools && npm install && node prep.mjs --src ../../chinese-poetry-src
  ```
  `--include-song-shi` is a stub flag to also import 宋诗 (~255k, off by default).

## Architecture

**Three-layer static data model** (all produced by `tools/prep.mjs`, committed under `data/`):
1. `data/index/page-*.json` — lightweight paginated browse index (500/page): id, title,
   author, dynasty, kind, excerpt. Also `data/search.json` (compact `[id,title,author]` for
   global search) and `data/manifest.json` (counts/pagination).
2. `data/poems/*.json` — **read-only** full 原文 detail, 1000 poems/file.
3. `data/annotations/<id>.json` — **hand-editable** overlay carrying 注释/译文/赏析/创作背景.
   Plus `data/authors/<slug>.json` (bios + up to 50 works), `data/authors-index.json`
   (all poets sorted by output, for the 诗人 browse page), and `data/about.json` (关于 page copy).

**Poem IDs encode storage location:** `t<chunk>-<i>` (唐) / `c<chunk>-<i>` (宋词) resolves
directly to `data/poems/<chunk>.json[i]` — no lookup table. See `parseId()`/`loadPoem()` in
`app.js`. The flagship 水调歌头 is `c59-66`.

**`app.js`** is an IIFE hash router (extends the original 3-page toggle):
routes `#/home | #/list/:page | #/poem/:id | #/author/:slug | #/authors/:page | #/about` →
`RENDERERS` map → `renderHome/renderList/renderPoem/renderAuthor/renderAuthors/renderAbout`.
Home picks a **random** poem each render (换一首 re-invokes it via `data-nav="home"`); 诗集
paginates 25/page (`DISPLAY`) over the 500-row index files; 诗人 lists all poets from
`authors-index.json`. Each renderer builds HTML strings **reusing the existing CSS classes**
and injects into `#page-<name>`; `fetchJSON()` memoizes via a `Map`. `data-nav="poem/<id>"`-style
attributes drive navigation through one delegated click handler.

**Detail-page invariant:** all five section headings (原文/注释/译文/赏析/创作背景) always
render. Only 原文 + author bio come from source data; the other four come from the annotation
overlay (`loadAnnotation()` merges it over the read-only poem) and show a
"尚未收录，敬请期待。" faint placeholder when absent.

## Conventions & gotchas

- **Design system** lives in `styles.css` `:root` (`--paper` #F5F1E8 米纸, `--ink` #221F1A,
  `--accent` #9A3B2E 朱砂, `--serif` Noto Serif SC, `--latin` Cormorant Garamond). Preserve it
  exactly; build any new UI from these tokens (that's how search/pagination were added).
- **`prep.mjs`**: converts 全唐诗 繁→简 via `opencc-js` (宋词 is already simplified); strips
  lone UTF-16 surrogates; synthesizes ci titles/ids. On re-run it **preserves
  `data/annotations/`** (your hand-written overlays), only regenerating index/poems/authors +
  top-level JSON + the seed `c59-66.json`.
- **To annotate a poem:** create `data/annotations/<id>.json` (id is in the URL `#/poem/<id>`);
  fill `notes:[{term,def}]`, `translation:[…]`, `appreciation:[…]`, `background:[…]`,
  optional `preface`/`prefaceTranslation`. Save + reload; no rebuild. See
  `data/annotations/README.md`.
- `data/**` (~67MB) is committed and is what the site serves; `tools/node_modules` and the
  external `../chinese-poetry-src` clone are gitignored.
- This repo sits under iCloud-synced `~/Documents`: re-running `prep.mjs` can spawn conflict
  copies like `data/poems 2/`. Clean with `find data -name '* [0-9]*' -exec rm -rf {} +`.
