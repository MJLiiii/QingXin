# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

情心 (QingXin) — a static, **no-backend** classical-Chinese poetry reading site. Vanilla
HTML/CSS/JS: no framework, no bundler, no npm dependencies at runtime. The site is fully
data-driven from the [chinese-poetry](https://github.com/chinese-poetry/chinese-poetry)
dataset (~78,660 poems: 全唐诗 + 宋词). **No poem text is hardcoded in HTML** — `index.html`
is only header/footer + empty page containers; everything else is `fetch`ed from `data/`.

## Commands

There is no build or bundling step. Things you actually run:

- **Preview locally** (required — `fetch()` blocks `file://`):
  `node tools/server/serve.mjs` → http://localhost:8080  (cwd-independent static server; `PORT=…` to change).
  Do NOT use `python -m http.server` — it crashes under the preview launcher (`os.getcwd`).

- **Check** (the closest thing to lint+tests — run after touching `assets/js/**`, `sw.js`, or `data/**`):
  `cd tools && npm run check` — `node --check` syntax-checks every frontend/tool script, runs the unit
  tests (`node --test tests/*.test.mjs`: search ranking + line search in `search-core.test.mjs`, HTML
  builders + utils in `templates.test.mjs`), then runs `node data/validate.mjs`, a read-only
  data-consistency audit (manifest counts vs search/index rows, id→shard round-trip for every poem,
  author slug→bucket hits, annotation shape + `source` rules, `lines.json` rows vs annotations and
  poem text; exits 1 on any error, only warns about annotated poems not yet in `lines.json`).

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
   `data/featured.json` (home-page pool: index rows of the ~3,200 poems whose annotation has
   赏析 + 注释/译文) and `data/lines.json` (`[[id, text]]` body text of every non-AI annotated poem,
   identical (author, text) siblings collapsed — the corpus for 名句 line search). Both derived files
   come from `node tools/data/build-featured.mjs`; rerun it after coverage changes.

**Poem IDs encode storage location:** `t<chunk>-<i>` (唐) / `c<chunk>-<i>` (宋词), where `i` is the
0–999 position within the id-block, resolves to `data/poems/<chunk>-<⌊i/100⌋>.json[i%100]` — no
lookup table. Ids are unchanged by the sub-file split, so annotations/index/search still key off them.
See `parseId()`/`loadPoem()` in `assets/js/data.js`. The flagship 水调歌头 is `c59-66`.

**Front end** (`assets/js/`, native ES modules — `app.js` is a 3-line entry calling `startRouter()`):
- `router.js` — hash router: `#/home | #/list/:page | #/poem/:id | #/author/:slug | #/authors/:page
  | #/about`, plus an optional `?q=` live-search query → `RENDERERS` map (unknown routes fall back to
  home). Navigation uses real `<a href="#/…" data-nav="…">` links (hrefs from `hashPath()`/`hrefFor()`
  in `utils.js`); one delegated click handler intercepts plain left clicks and lets modifier/middle
  clicks through (new tab). The same handler dispatches `data-toggle` (collapsible sections),
  `data-action` (`shuffle` re-renders home at random; `copy/share/vertical/scale-up/scale-down/theme/
  gloss-all` go to `reader.js`) and `data-gloss` (note popover; Enter/Space/Escape via delegated keydown).
  **Render cache:** the six `#page-<name>` containers stay in the DOM and `rendered[name]` holds the
  canonical route key each one shows, so Back to the same key only re-shows it (search box, results
  and DOM survive). A render is cached only on success; renderers call `ctx.noCache()` when they had
  to degrade (e.g. an annotation fetch failed with a non-404). **Stale renders:** every navigation
  bumps a sequence number — renderers must check `ctx.isCurrent()` right before writing `innerHTML`.
  **Scroll:** `history.scrollRestoration='manual'`; each history entry gets an id in `history.state.qx`
  — new entries scroll to top, Back/Forward restore the saved offset instantly (explicitly overriding
  the CSS `scroll-behavior: smooth`, which would otherwise drag the restored position). Renderers set
  titles with `ctx.setTitle(...)`; `show()` applies `document.title`, `hidden` and `aria-current`, so
  cached re-shows are correct too. After each render it idle-preloads the JSON the next click will
  likely need.
- `pages.js` — the six renderers, all `(param, ctx)` (`renderHome/renderList/renderPoem/renderAuthor/
  renderAuthors/renderAbout`), plus pager/search wiring. Each builds HTML strings **reusing the
  existing CSS classes** and injects into `#page-<name>`. Home is 今日一诗: `data/featured.json`
  shuffled with `seededRandom('qingxin:' + localDateKey())` (local date, so hero + 5-row 精选 list are
  stable for the day); 换一首 shuffles with `Math.random`. 诗集 paginates 25/page (`DISPLAY`) over the
  500-row index files; 诗人 lists all poets from `authors-index.json`. Both pagers come from
  `pagerHTML()` — prev/next links plus a page-number input + 跳转 button, wired by `wirePager()`
  (Enter or click, clamped to range). **Two separate searches** (both via `wireLiveSearch()`:
  debounced, capped at 120 hits, stale responses ignored, pager hidden while active, query written to
  `?q=` from the debounce — never per keystroke or during IME composition — and restored via
  `start(q)`): global title/author/line search on 诗集 and name-only search on 诗人. Both show
  loading/result status and highlight only real exact substrings. The poem page's 原文 heading
  carries the reading toolbar (复制/分享/竖排/A−/A+; 竖排 is omitted above 60 lines) and note terms are
  linked inside 词序 + 原文 via `glossLines()`.
- `reader.js` — browser-only reading layer: preferences in localStorage `qingxin:prefs`
  (`theme`, `scale`, `vertical`, `open` section ids), toolbar actions, and the single note popover
  (`openGloss`/`closeGloss`; the k-th `.gloss` term maps to the k-th `.notes__row`). The inline
  `<head>` script in `index.html` applies theme/scale/vertical before first paint — keep its key and
  fields in sync with `reader.js`.
- `data.js` — `fetchJSON()` (memoized via a `Map`; errors carry `status`), `parseId()`/`loadPoem()`,
  `loadAnnotation()`/`loadAuthor()` (slug→bucket hash) — both return `null` only on 404 and rethrow
  other failures.
- `search-core.js` + `search.js` + `search-worker.js` — shared ranked exact/fuzzy matching for
  poems and authors, with punctuation and Traditional→Simplified query normalization via the local
  OpenCC browser module. Poem search also scans `data/lines.json`: exact substring for queries of 2+
  characters, one substituted character for 5+ (全唐诗 texts differ from popular versions, e.g.
  静夜思 reads 床前看月光); body hits rank below every title/author direct match, and their excerpt
  offsets are mapped per line (OpenCC phrase conversion makes whole-body offsets unreliable). If
  `lines.json` fails to load, search degrades to title/author. The 诗集 scan runs inside a module Web
  Worker (keeping the multi-MB index off the main thread) and transparently uses the same core on the
  main thread if Workers fail.
- `templates.js` — shared HTML builders (`poemRow`/`authorRow`/`searchRow`, `entryShell`, `proseEntry`,
  `glossLines`, `pagerHTML`, `searchBoxHTML`, `navHref`); `utils.js` — `esc()`, `hashPath()`/`hrefFor()`,
  `groupStanzas()`, `idle()`, `localDateKey()`, `seededRandom()`. Both are imported by the Node unit
  tests, so they must not touch `window`/`document`/`localStorage` at import time.

**`sw.js` service worker** (registered from `index.html` with a relative path, so it works under the
`/QingXin/` Pages subpath): stale-while-revalidate on every same-origin GET — cached copy returns
instantly, the network refresh lands by the next reload, so content updates lag at most one refresh
(remember this when previewing changes locally). It pre-caches the app shell (`index.html`, CSS,
every `assets/js/*.js`) with `cache: 'reload'`, bypassing the HTTP cache so a new worker never mixes
old and new modules. **Adding/renaming a frontend module means updating its `SHELL` list;
changing any cached format means bumping `CACHE_NAME`** (currently `qingxin-v5`; old caches are
purged on activate).

**Detail-page invariant:** all five section headings (原文/注释/译文/赏析/创作背景) always
render. Only 原文 + author bio come from source data; the other four come from the annotation
overlay (`loadAnnotation()` merges it over the read-only poem) and show a
"尚未收录，敬请期待。" faint placeholder when absent, with a faint 「未收录」 marker in the heading.
原文 is always open; the four overlay sections are collapsible entries, collapsed by default unless the
reader has expanded that section type before (`entryShell(…, collapsible, { section, open, empty })` +
`data-toggle`; empty sections never auto-open, and the popover's 查看全部注释 does not count as a
preference). Annotations with `source:"ai"` additionally get a faint AI disclaimer line (`aiNotice()`
in `pages.js`).

## Conventions & gotchas

- **Project layout:** root keeps site entry/docs/deploy config (`index.html`, `sw.js`, `README.md`,
  `.nojekyll`); `assets/css/` and `assets/js/` hold browser-loaded front-end assets; `data/`
  holds committed static content; `tools/server/`, `tools/data/`, and `tools/annotations/`
  hold local preview, data generation, and annotation-import tooling respectively.
- **Design system** lives in `assets/css/styles.css` `:root` — editorial monochrome (after the Kyne
  redesign): `--paper` #F6F6F6, `--surface` #FCFCFC, `--ink` #2B2B2B, muted-ink tiers
  `--body`/`--muted`/`--muted-2`/`--muted-3` (`--muted` #6B6B6B is the lightest grey allowed for text,
  ~4.9:1 on paper), 1px hairlines `--line`/`--line-strong`, inverted footer `--invert-bg`/`--invert-fg`
  (+`--invert-fg-rgb`), `--mark-bg` (search hits, gloss hover), RGB channels `--ink-rgb`/`--paper-rgb`,
  `--shadow`, `--selection-alpha`, `--reading-scale`, and layout `--max`/`--gutter`/`--measure`/`--header-h`.
  Three font roles: `--serif` Noto Serif SC for anything containing Chinese (display sizes included),
  `--latin` Fraunces for Latin letters and digits only (its Google subset covers `·` and `—…“”`, so a
  Chinese-first stack must come first, or that punctuation switches to Western glyphs), `--sans`
  Noto Sans SC for labels, nav and buttons. **There is no accent hue** — never signal state by colour
  alone: the current page and pressed toggles get an underline, search hits get `--mark-bg` + underline.
  Build any new UI from these tokens (that's how search/pagination were added).
  **夜读 (dark theme)** only redefines tokens, in two identical blocks —
  `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {…} }` and
  `:root[data-theme="dark"] {…}` — so never hard-code a color: add a token to `:root` and to both dark
  blocks. Reading text sizes are `calc(<px> * var(--reading-scale))` (including the mobile media
  query). Vertical 原文 is `:root[data-vertical="1"] .original__body` — the scroll container itself is
  `vertical-rl`, so it opens on the first column (left-aligned, `margin: 0`).
- **Display headings** use `.display[data-size]`, the tier coming from `displaySize()` in
  `templates.js`; the home hero sizes itself from `--hero-chars` + `cqi` (its lines come from
  `heroLines()`). CJK needs `line-height ≥ 1.05` and tracking no tighter than `-0.03em`, so Kyne's
  0.9/-0.06em are not copied verbatim. Breakpoints are `(max-width: 1199px)` and `(max-width: 809px)`;
  at ≥1200 entry bodies and the author bio indent by 33% for the case-study look.
- **`templates.js` markup is frozen by `tools/tests/templates.test.mjs`** — restyle it from CSS instead.
  Row numbers, brackets `[…]`, parens `(…)`, arrows and +/− are pseudo-elements written as
  `content: "x" / ""` so screen readers skip them. Structural changes belong in `pages.js`/`index.html`,
  which have no markup tests.
- **`tools/data/prep.mjs`**: converts 全唐诗 繁→简 via `opencc-js` (宋词 is already simplified); strips
  lone UTF-16 surrogates; synthesizes ci titles/ids. On re-run it **preserves
  `data/annotations/`** (your hand-written overlays), only regenerating index/poems/authors +
  top-level JSON + the seed `c59-66.json`. `data/annotations/README.md` is hand-maintained docs —
  prep writes its built-in starter copy only when the file is missing, so edit the README itself.
- **To annotate a poem:** create `data/annotations/<id>.json` (id is in the URL `#/poem/<id>`);
  fill `notes:[{term,def}]`, `translation:[…]`, `appreciation:[…]`, `background:[…]`,
  optional `preface`/`prefaceTranslation`. Save + reload; no rebuild. See
  `data/annotations/README.md`. (Detail pages need no rebuild; only the home-page featured pool and
  the line-search corpus do — run `node tools/data/build-featured.mjs` when coverage changes so the
  poem joins `featured.json` and `lines.json`; until then `validate.mjs` just warns.) Note terms are
  linked in 原文 when they occur verbatim in 词序/正文 after stripping （pinyin） parentheticals, so keep
  `term` as the original wording.
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
- **Annotation `source` precedence** (see `data/annotations/README.md`; enforced by the tools and
  `validate.mjs`): hand-written (no `source` field) > `gushiwen-web` > `gushiwen` > `ai`. Nothing may
  overwrite a hand-written file. The `"ai"` tier (LLM-generated annotations) is plumbed end-to-end
  but so far unused — no generator tool or `ai` files exist yet: `renderPoem` shows an AI disclaimer,
  `build-featured.mjs` excludes them from the home pool and from `lines.json` (keeping both
  human-sourced), `validate.mjs` requires their `background` to stay `[]`, and both import/scrape
  scripts treat existing `ai` files as freely overwritable (human sources always win).
- `data/**` (~67MB) is committed and is what the site serves; `tools/node_modules` and the
  external `../chinese-poetry-src` clone are gitignored.
- **Deploy** is GitHub Pages "Deploy from a branch" (`main` / root — no workflow; `.github/`
  was intentionally removed), live at https://mjliiii.github.io/QingXin/. The root `.nojekyll`
  is required so Pages serves `data/**` as-is (thousands of JSON files, Chinese filenames).
  All paths are relative and routing is hash-based, so the site works under the `/QingXin/`
  subpath with no 404 fallback.
- This repo sits under iCloud-synced `~/Documents`: re-running `tools/data/prep.mjs` can spawn conflict
  copies like `data/poems 2/`. Clean with `find data -name '* [0-9]*' -exec rm -rf {} +`.
