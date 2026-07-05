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
  `node tools/server/serve.mjs` → http://localhost:8080  (cwd-independent static server).
  In Claude Code, use the `.claude/launch.json` config named **`qingxin`**.
  Do NOT use `python -m http.server` — it crashes under the preview launcher (`os.getcwd`).

- **Regenerate the data** (only when refreshing/rebuilding `data/**`):
  ```bash
  git clone --depth 1 https://github.com/chinese-poetry/chinese-poetry ../chinese-poetry-src
  cd tools && npm install && node data/prep.mjs --src ../../chinese-poetry-src
  ```
  `--include-song-shi` is a stub flag to also import 宋诗 (~255k, off by default).

- **Fetch annotations** (optional, only when expanding 注释/译文/赏析/创作背景 coverage):
  `cd tools && node annotations/annotate-scrape.mjs <backfill|expand|id|authors …>` scrapes 古诗文网;
  `node annotations/crawl-all-authors.mjs [--pause 30] [--workers N]` is the long-running driver that
  crawls every eligible author with a pause between each — `--workers` runs N authors concurrently
  (child processes off one shared queue, each keeping its own 2.5s throttle, per-worker
  `scrape-report-w<k>.json`; a block on any worker pauses all of them for 60 min; keep N ≤ 3)
  (resumable; `touch tools/.cache/annotate/STOP` to stop gracefully after the current author)
  (see the web-scraped-annotations note under Conventions). Long, polite (2.5s/request), and
  fully resumable via `tools/.cache/`. Start with `--dry-run`/`--limit`.

## Architecture

**Three-layer static data model** (all produced by `tools/data/prep.mjs`, committed under `data/`):
1. `data/index/page-*.json` — lightweight paginated browse index (500/page): id, title,
   author, dynasty, kind, excerpt. Also `data/search.json` (compact `[id,title,author]` for
   global search) and `data/manifest.json` (counts/pagination).
2. `data/poems/<chunk>-<sub>.json` — **read-only** full 原文 detail, **100 poems/file**
   (each 1000-poem id-block is split into ten 100-poem sub-files so one poem view fetches ~40KB,
   not a ~470KB whole chunk). See `tools/data/reshard-poems.mjs`.
3. `data/annotations/<id>.json` — **hand-editable** overlay carrying 注释/译文/赏析/创作背景.
   Plus `data/authors/bucket-<000..255>.json` (author records `{slug: {bio, up to 50 works, …}}`,
   bundled into 256 hash-shards — `loadAuthor` resolves `slug`→bucket; see `tools/data/bundle-authors.mjs`),
   `data/authors-index.json`
   (all poets sorted by output, for the 诗人 browse page), `data/about.json` (关于 page copy),
   and `data/featured.json` (home-page pool: index rows of the ~3,200 poems whose annotation has
   赏析 + 注释/译文 — regenerate with `node tools/data/build-featured.mjs` after coverage changes).

**Poem IDs encode storage location:** `t<chunk>-<i>` (唐) / `c<chunk>-<i>` (宋词), where `i` is the
0–999 position within the id-block, resolves to `data/poems/<chunk>-<⌊i/100⌋>.json[i%100]` — no
lookup table. Ids are unchanged by the sub-file split, so annotations/index/search still key off them.
See `parseId()`/`loadPoem()` in `assets/js/app.js`. The flagship 水调歌头 is `c59-66`.

**`assets/js/app.js`** is an IIFE hash router (extends the original 3-page toggle):
routes `#/home | #/list/:page | #/poem/:id | #/author/:slug | #/authors/:page | #/about` →
`RENDERERS` map → `renderHome/renderList/renderPoem/renderAuthor/renderAuthors/renderAbout`.
Home picks a **random annotated** poem each render from `data/featured.json`
(换一首 re-invokes it via `data-nav="home"`); 诗集
paginates 25/page (`DISPLAY`) over the 500-row index files; 诗人 lists all poets from
`authors-index.json`. Both pagers come from `pagerHTML()` — prev/next buttons plus a
page-number input + 跳转 button, wired by `wirePager()` (Enter or click, clamped to range).
There are **two separate searches**: the global one on 诗集 (debounced, scans
`data/search.json` by title/author) and a name-only one on 诗人 (`wireAuthorSearch()` over
`authors-index.json`); both cap at 120 hits and hide the pager while active. Each renderer
builds HTML strings **reusing the existing CSS classes**
and injects into `#page-<name>`; `fetchJSON()` memoizes via a `Map`. `data-nav="poem/<id>"`-style
attributes drive navigation through one delegated click handler.

**Detail-page invariant:** all five section headings (原文/注释/译文/赏析/创作背景) always
render. Only 原文 + author bio come from source data; the other four come from the annotation
overlay (`loadAnnotation()` merges it over the read-only poem) and show a
"尚未收录，敬请期待。" faint placeholder when absent.

## Conventions & gotchas

- **Project layout:** root keeps site entry/docs/deploy config (`index.html`, `README.md`,
  `.nojekyll`); `assets/css/` and `assets/js/` hold browser-loaded front-end assets; `data/`
  holds committed static content; `tools/server/`, `tools/data/`, and `tools/annotations/`
  hold local preview, data generation, and annotation-import tooling respectively.
- **Design system** lives in `assets/css/styles.css` `:root` (`--paper` #F5F1E8 米纸, `--ink` #221F1A,
  `--accent` #9A3B2E 朱砂, `--serif` Noto Serif SC, `--latin` Cormorant Garamond; plus muted-ink
  tiers `--body`/`--muted`/`--muted-2`/`--muted-3` and hairlines `--line`/`--line-strong`).
  Preserve it exactly; build any new UI from these tokens (that's how search/pagination were added).
- **`tools/data/prep.mjs`**: converts 全唐诗 繁→简 via `opencc-js` (宋词 is already simplified); strips
  lone UTF-16 surrogates; synthesizes ci titles/ids. On re-run it **preserves
  `data/annotations/`** (your hand-written overlays), only regenerating index/poems/authors +
  top-level JSON + the seed `c59-66.json`.
- **To annotate a poem:** create `data/annotations/<id>.json` (id is in the URL `#/poem/<id>`);
  fill `notes:[{term,def}]`, `translation:[…]`, `appreciation:[…]`, `background:[…]`,
  optional `preface`/`prefaceTranslation`. Save + reload; no rebuild. See
  `data/annotations/README.md`. (Detail pages need no rebuild; only the home-page featured pool
  does — run `node tools/data/build-featured.mjs` when coverage changes so new poems join it.)
- **Bulk-imported annotations:** ~1,045 famous 唐诗/宋词 have 译文/注释/赏析 imported from the
  chinese-gushiwen dataset via `node tools/annotations/annotate-import.mjs` (fuzzy-matches by author +
  body-text Dice similarity; caches downloads in gitignored `tools/.cache/`). Imported files
  carry `"source": "gushiwen"` and `background: []` (dataset has no 创作背景). The script skips
  existing files; `--force` only overwrites `source:"gushiwen"` files — hand-written annotations
  (e.g. the c59-66 seed) are never clobbered. To hand-improve an imported poem, edit its JSON and
  drop the `source` field.
- **Web-scraped annotations:** `node tools/annotations/annotate-scrape.mjs <backfill|expand|id|authors …>`
  pulls fuller 注释/译文/赏析/**创作背景** live from 古诗文网 (gushiwen.cn), tagged
  `"source": "gushiwen-web"`. `backfill` refreshes the dataset-imported files section-by-section;
  `expand` crawls 唐/宋 catalog listings to annotate new poems (only writes ids with no existing
  file, unless `--force`); `authors [作者名…] [--top N]` crawls each poet's `astr=` listing (same
  `default.aspx` endpoint/parser as `expand`, per-author resumable `catalog-author-<name>.json`) to
  reach the long tail beyond the featured catalog — author names are explicit and/or the top-N most
  prolific from `authors-index.json` (unioned, deduped by `normAuthor`; skips 无名氏/不详); `id
  <poemId>` does one. Shares the corpus matcher / field transforms
  with the importer (both in `annotate-lib.mjs`). Three collaborating files under
  `tools/annotations/`: `gushiwen-client.mjs` (polite cached HTTP: 2.5s throttle, retries,
  `BlockedError` on login-wall/403, disk cache = resume), `gushiwen-parse.mjs` (pure HTML→struct
  parser), `annotate-scrape.mjs` (CLI orchestration). Zero third-party deps. Caches pages +
  `resolved.json` (poemId→hexid) under gitignored `tools/.cache/gushiwen-web/`; report at
  `.cache/annotate/scrape-report.json`. Requests carry a `gsw2017user=1` cookie — the site's own
  boolean presence-flag (not a credential; no login/account) that its JS sets to unlock search and
  serve un-scrambled text. **赏析投毒:** the site scrambles some 赏析 AJAX full-text via
  character substitution (的→屈, 一→楼, 情→隋); the scraper detects this by diffing each AJAX
  fragment against the always-inline preview and **drops any diverging section**, so 赏析 is either
  complete-and-clean or absent — never garbled. 译文/注释/创作背景 are unaffected. Precedence:
  the importer's `--force` only overwrites `source:"gushiwen"`, so `gushiwen-web` files are never
  back-filled by the (thinner) dataset version. **Current coverage:** 4,120 poems annotated
  (`data/annotations/`): 4,079 `gushiwen-web`, 40 residual `gushiwen` (乐府/歌辞 titles search
  can't resolve), 1 hand-written seed; **2,740 carry 创作背景** (the dataset had none). The full
  by-author crawl (all 5,053 eligible authors, `crawl-all-authors.mjs --workers 3 --pause 1`,
  2026-07) is **complete** — gushiwen's annotated stock for this corpus is essentially exhausted;
  re-running the driver is cheap (done authors skip instantly) and only picks up site additions.
  **Duplicate annotations are intentional:** 148 id-groups share one gushiwen page because 全唐诗
  re-collects 乐府 poems under both category juan (t0/t1/t2) and per-poet juan; the scraper's
  fanout writes all sibling ids so every poem page renders annotations. Before hand-editing any
  annotation, run `node annotations/check-dups.mjs` (read-only) — it lists sibling groups and
  flags content divergence (exit 1) so hand edits can be applied to all siblings together.
- `data/**` (~67MB) is committed and is what the site serves; `tools/node_modules` and the
  external `../chinese-poetry-src` clone are gitignored.
- **Deploy** is GitHub Pages "Deploy from a branch" (`main` / root — no workflow; `.github/`
  was intentionally removed), live at https://mjliiii.github.io/QingXin/. The root `.nojekyll`
  is required so Pages serves `data/**` as-is (thousands of JSON files, Chinese filenames).
  All paths are relative and routing is hash-based, so the site works under the `/QingXin/`
  subpath with no 404 fallback.
- This repo sits under iCloud-synced `~/Documents`: re-running `tools/data/prep.mjs` can spawn conflict
  copies like `data/poems 2/`. Clean with `find data -name '* [0-9]*' -exec rm -rf {} +`.
