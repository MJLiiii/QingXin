# AGENTS.md

This file provides guidance to coding agents (Claude Code and others) when working with code in this repository.

## What this is

情心 (QingXin) — a static, **no-backend** classical-Chinese poetry reading site. Vanilla
HTML/CSS/JS: no framework, no bundler, no npm dependencies at runtime. The site is fully
data-driven from the [chinese-poetry](https://github.com/chinese-poetry/chinese-poetry)
dataset (~78,660 poems: 全唐诗 + 宋词). **No poem text is hardcoded in HTML** — the app pages are
only header/footer + empty page containers; everything else is `fetch`ed from `data/`.

**One design: app-style liquid glass.** The root `index.html` is the app shell (`assets/css/glass.css`,
entry `assets/js/glass-app.js` → renderers in `glass-pages.js` + behaviour in `glass-ui.js`). The site once
served two designs side by side (Kyne at `kyne/`, liquid glass at `liquidglass/`, a chooser at the root);
Kyne was removed and liquid glass moved to the root. `kyne/index.html` and `liquidglass/index.html` are now
identical `noindex` redirect stubs that `location.replace('../' + location.hash)`, so old shared links
(including `#/…` routes and `?q=`) land on the same page at the root — keep them. When a stub was reached
from the site root itself (same-origin referrer `…/` or `…/index.html`), the root is an old worker's cached
chooser forwarding `#/…` back, so the stub goes to `'../?'` instead (a URL no old cache holds); the root's
`<head>` script strips that empty `?` again. Keep both halves, or the two pages can bounce.

## Commands

There is no build or bundling step. Things you actually run:

- **Preview locally** (required — `fetch()` blocks `file://`):
  `node tools/server/serve.mjs` → http://localhost:8080
  (cwd-independent static server; `PORT=…` to change; like Pages it 301s `/kyne` → `/kyne/` and serves a
  directory's `index.html`, which is how the old-path redirect stubs are reached).
  Do NOT use `python -m http.server` — it crashes under the preview launcher (`os.getcwd`).

- **Check** (the closest thing to lint+tests — run after touching `assets/js/**`, `sw.js`, `tools/**` or `data/**`):
  `cd tools && npm run check` = `node check.mjs` (needs Node ≥ 22.7: the tests and tools import the
  package.json-less `assets/js/*.js` modules and rely on module-syntax detection). It walks the tree and
  `node --check`s every `assets/js/**/*.js`, `sw.js` and `tools/**/*.mjs` (new or deleted files are picked up
  automatically; `node_modules/`, `.cache/` and iCloud conflict copies with a space+digit in the name are skipped),
  runs the unit tests (`node --test tests/`: search ranking + line search in `search-core.test.mjs`, shared
  HTML helpers + utils in `templates.test.mjs`, page fragments in `glass-templates.test.mjs`, the `sw.js` SHELL
  list, cache-name scheme and redirect-stub parity in `shell.test.mjs`, the two 夜读 token blocks in
  `glass-css.test.mjs`, the annotation matcher/parsers in `annotate-lib.test.mjs` + `gushiwen-parse.test.mjs`,
  the poem-page parts and 今日一诗 pick in `pages.test.mjs`, the route keys in `router.test.mjs`, the id/bucket/shard
  formulas against `data/manifest.json` plus the argv/readJson helpers in `ids.test.mjs`), then
  runs `node data/validate.mjs`, a read-only data-consistency audit (manifest counts vs search/index
  rows, id→shard round-trip for every poem, author slug→bucket hits, annotation shape + `source` rules,
  `featured.json` rows vs search/index (missing or empty = error, the home page fetches it directly),
  `lines.json` rows vs annotations and poem text, `manifest.subChunkSize`/`pageSize` vs the `data.js` constants;
  exits 1 on any error; warnings only for annotated poems not yet in `lines.json`, a missing `lines.json`, and the
  poem-shard coverage estimate). `npm run validate` / `npm run featured` run the validator / `build-featured.mjs` alone.

- **Regenerate the data** (only when refreshing/rebuilding `data/**`):
  ```bash
  git clone --depth 1 https://github.com/chinese-poetry/chinese-poetry ../chinese-poetry-src
  cd tools && npm install && node data/prep.mjs --src ../../chinese-poetry-src && node data/build-featured.mjs
  ```
  `prep.mjs` deletes `featured.json` and `lines.json` (they are derived by `build-featured.mjs` and would
  otherwise keep stale position-based ids) and does **not** rebuild them, so `build-featured.mjs` must follow —
  until it does the home page 404s and `npm run check` errors. `--include-song-shi` is not implemented:
  passing it exits 1 (宋诗 ~255k was never wired up).

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
   not a ~470KB whole chunk; `flushChunk()` in `tools/data/prep.mjs` writes them).
3. `data/annotations/<id>.json` — **hand-editable** overlay carrying 注释/译文/赏析/创作背景.
   Plus `data/authors/bucket-<000..255>.json` (author records `{slug: {bio, up to 50 works, …}}`,
   bundled into 256 hash-shards by `prep.mjs` — `loadAuthor` resolves `slug`→bucket with the same `authorBucket()`),
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

**Front end** (`assets/js/`, native ES modules — the entry `glass-app.js` calls `startRouter(RENDERERS)` with
`glass-pages.js`'s map, then `initGlassUI()`):
- `router.js` — hash router: `#/home | #/list/:page | #/poem/:id | #/author/:slug | #/authors/:page
  | #/about`, plus an optional `?q=` live-search query → the renderer map passed to `startRouter(renderers)`
  (unknown routes fall back to home). `parseHash(hash, now)` is exported (no arguments = the current hash and
  today) so `tools/tests/router.test.mjs` can pin the render-cache keys. Navigation uses real
  `<a href="#/…" data-nav="…">` links (hrefs from `hashPath()`/`hrefFor()` in `utils.js`); one delegated
  click handler intercepts plain left clicks and lets modifier/middle clicks through (new tab). The same
  handler dispatches
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
  titles with `ctx.setTitle(...)`; `show()` applies `document.title`, `hidden` and `aria-current` (on every
  `.site-nav__link[data-nav]`, via `NAV_OF`: home/list/authors/about, poem → list, author → authors), so
  cached re-shows are correct too. After each render it idle-preloads the JSON the next click will likely need.
- `pages.js` — data and wiring helpers the renderers share (no page layout): `wirePager()` (page-number
  input + 跳转 button: Enter or click, clamped to range); `wireLiveSearch()` — debounced,
  stale responses ignored, pager hidden while active, query written to `?q=` from the debounce (never per
  keystroke or during IME composition) and restored via `start(q)`, with loading/result status — and
  `wireSearch(host, entries, onQuery, { entry, hit })`, the 诗集 title/author/line search on top of it (诗人
  runs a name-only search through `wireLiveSearch` directly; both cap results at `SEARCH_LIMIT`, 120, exported by
  `search-core.js`); `pickFeatured()` — 今日一诗 is
  `data/featured.json` shuffled with `seededRandom('qingxin:' + localDateKey())` (stable for the local day;
  换一首 shuffles with `Math.random`); `loadPoemData()`; `poemParts()` (the reading toolbar 复制/分享/竖排/
  A−/A+ — 竖排 omitted above 60 lines — and the 原文 with note terms linked inside 词序 + 原文 via
  `glossLines()`, each line wrapped in a block `.original__line`); `notesHTML(notes)`; `aiNotice()`.
- `glass-pages.js` — the six renderers, all `(param, ctx)` (`renderHome/renderList/renderPoem/renderAuthor/
  renderAuthors/renderAbout`), building HTML strings and injecting them into `#page-<name>`. 诗集 paginates
  `LIST_PAGE_SIZE` (25, exported by `data.js` and shared with `preloadListPage()`; `manifest.pageSize` must be
  divisible by it) over the 500-row index files; 诗人 lists all poets from `authors-index.json`.
  Home is just two centred, stacked cards — the 今日一诗 hero (only `featured.json` + that poem are
  loaded) and the 寻章摘句 search form (→ `#/list?q=`, plus hint links); 诗集/诗人 are card grids with the same
  search/pager wiring; the poem page is a two-column layout (`.poem-aside[data-pin]` with title, fact chips,
  the toolbar in a glass `.tools-dock` and the 原文 card; `.poem-main` with the AI note, segmented tabs and the
  author card; poems over 60 lines get `.poem-layout--long` and no `data-pin`; each 原文 line arrives from
  `poemParts()` wrapped in a block `.original__line` (hanging indent when it wraps) and the card gets `--line-chars`, the longest line's
  length, which sizes the stanza text to fit the card); the author page is a pinned
  profile card + bio + works grid; about is a card grid. `glass-templates.js` holds its pure HTML fragments
  (cards, `seal()` glyph avatars — first code point of the name, never the data's `seal` field, which is a
  lone surrogate for astral names — `pagerDock` (keeps `#pager`/`#pager-input[data-route]`/`#pager-go`),
  `poemTabs`/`pickTab`, `findForm`, `GLASS` layers, `ICONS`). **Tabs:** `role=tablist/tab/tabpanel`, roving
  tabindex, ←/→/Home/End; panels keep `class="tab-panel entry" data-section` (hidden panels stay in the DOM,
  so `openGloss` and `expandNotes` work unchanged). The initial tab is `prefs.tab` if that section has
  content, else the first non-empty one, else 注释; fallbacks never overwrite the pref. The chosen tab is also
  stored on the history entry (`history.state.qxTab`, via `rememberTab`), and a Back/Forward re-render prefers it
  so the restored scroll offset matches the panel. Not-found poem/author pages use `errorCard()` (an h1 plus
  links to 诗集/诗人 and 首页).
- `glass-ui.js` — liquid-glass behaviour, all delegated: tab clicks/keys (`selectTab` writes `prefs.tab`
  on user choice and, when the tab bar is stuck, scrolls the new panel under it), the `qx:expand-notes`
  event (switches to 注释 without persisting), the home search submit (ignores the IME-confirm Enter), and
  pinning — `initPin(host)` watches the page's `[data-pin]` column (ResizeObserver + `(min-width: 1200px)` +
  resize) and sets `data-pinned` (CSS makes it sticky) only when the whole column fits the viewport; a rAF
  scroll handler keeps an open popover on a pinned term (`repositionGloss()`, closes it if the term leaves
  the viewport) and toggles `.site-header[data-scrolled]`.
- `reader.js` — browser-only reading layer: preferences in localStorage `qingxin:prefs`
  (`theme`, `scale`, `vertical`, `tab`; `readPrefs`/`writePrefs` merge; an `open` key left by Kyne is
  ignored), toolbar actions, and the single note popover (`openGloss`/`closeGloss`/`repositionGloss`; the k-th
  `.gloss` term maps to the k-th `.notes__row`; the popover is absolute in document coordinates, or `fixed`
  when its term sits inside a `[data-pinned]` column; it keeps clear of `--pop-inset-top/-bottom`, lengths
  `glass.css` registers with `@property` for the floating header and tab bar). `expandNotes` (查看全部注释)
  dispatches a bubbling `qx:expand-notes` event on the notes section before scrolling to it. The inline
  `<head>` script in `index.html` applies theme/scale/vertical before first paint (the redirect stubs apply
  only the theme) — keep its key and fields in sync with `reader.js`.
- `data.js` — `fetchJSON()` (memoized via a `Map`; errors carry `status`; `data/…` paths resolve against
  the site root via `import.meta.url`, not the page),
  `parseId()`/`loadPoem()` (`SUB_CHUNK` = poems per sub-file, must equal `manifest.subChunkSize`),
  `loadAnnotation()`/`loadAuthor()` (slug→bucket hash) — both return `null` only on 404 and rethrow
  other failures. `parseId()`, `authorBucket()` and `SUB_CHUNK` are re-exported by `tools/lib/ids.mjs` so the
  tool scripts share the browser's formulas; `tools/tests/ids.test.mjs` pins them.
- `search-core.js` + `search.js` + `search-worker.js` — shared ranked exact/fuzzy matching for
  poems and authors, with punctuation and Traditional→Simplified query normalization via the local
  OpenCC browser module. Poem search also scans `data/lines.json`: exact substring for queries of 2+
  characters, one substituted character for 5+ (全唐诗 texts differ from popular versions, e.g.
  静夜思 reads 床前看月光); body hits rank below every title/author direct match, and their excerpt
  offsets are mapped per line (OpenCC phrase conversion makes whole-body offsets unreliable). If
  `lines.json` fails to load, search degrades to title/author. The 诗集 scan runs inside a module Web
  Worker (keeping the multi-MB index off the main thread) and transparently uses the same core on the
  main thread if Workers fail.
- `templates.js` — low-level HTML helpers (`navHref`, `displaySize`, `heroLines`, `highlighted`,
  `emptyState`, `glossTerm`/`glossLines`, `errorSection` (the router's render-failure fallback),
  `searchBoxHTML`); `utils.js` — `esc()`,
  `hashPath()`/`hrefFor()`,
  `groupStanzas()`, `idle()`, `localDateKey()`, `seededRandom()`. These, `glass-templates.js`, `pages.js` and
  `router.js` (and therefore everything they import: `data.js`, `search.js`, `search-core.js`, `reader.js`) are
  imported by the Node unit tests, so they must not touch `window`/`document`/`localStorage` at import time —
  browser globals may only be read inside functions.

**`sw.js` service worker** lives at the site root and `index.html` registers it as `sw.js` (relative, so it
works under the `/QingXin/` Pages subpath; the scope covers the whole site).
Stale-while-revalidate on every same-origin GET — cached copy returns instantly, the network refresh lands
by the next reload, so content updates lag at most one refresh (remember this when previewing changes
locally). The background refresh is `fetch(req, { cache: 'no-cache' })` (a conditional request), so a stale
HTTP-cache copy of a module can never be written back next to newer ones. It pre-caches the app shell
(root, the `kyne/` + `liquidglass/` redirect stubs, `glass.css`, every `assets/js/*.js`) with `cache: 'reload'`, bypassing
the HTTP cache so a new worker never mixes old and new modules; one missing entry fails the whole install.
**Adding/renaming a frontend module or shell means updating its `SHELL` list** (`tools/tests/shell.test.mjs`
asserts SHELL equals the four shell pages + `assets/css/*.css` + every `assets/js/**/*.js`)**; changing any cached format
means bumping `CACHE_NAME`** (currently `qingxin-v11`; old caches are purged on activate). Also bump it when a
module drops an export another module used to import, so the new set is precached in one step.
`index.html` reloads the page once when an old worker hands over (it checks for `qingxin-v1…v9` caches,
whose modules don't match this shell — e.g. a v9 `router.js` still imports the removed Kyne renderers from
`pages.js`). An old worker may also serve the old chooser, glass or Kyne page once more; the next load is
current. `startRouter()` called without a renderer map (only the removed Kyne `app.js` does that — in
`kyne/` and in pre-v7 root pages) redirects to the site root, resolved from `import.meta.url`. Drop the
reload block, that router fallback and the stubs' `'../?'` branch (with the root's `?` strip) once those
workers have aged out — `shell.test.mjs` pins the `'../?'` branch and the `?` strip as a pair, so update that test
in the same commit.

**Detail-page invariant:** all five sections (原文/注释/译文/赏析/创作背景) always
render. Only 原文 + author bio come from source data; the other four come from the annotation
overlay (`loadAnnotation()` merges it over the read-only poem) and show a
"尚未收录，敬请期待。" faint placeholder when absent.
原文 is a card with its own heading; the four overlay sections are always-present segmented tabs (one panel
visible, see `glass-pages.js`); an empty tab gets a faded label, a dashed outline and a screen-reader-only
（未收录）. Annotations with `source:"ai"` additionally get a
faint AI disclaimer line (`aiNotice()` in `pages.js`).

## Conventions & gotchas

- **Project layout:** root keeps the app shell, docs and deploy config (`index.html`, `sw.js`, `README.md`,
  `.nojekyll`); `kyne/` and `liquidglass/` only hold the old-path redirect stubs; `assets/css/` and
  `assets/js/` hold browser-loaded front-end assets; `data/` holds committed static content; `tools/server/`,
  `tools/data/`, and `tools/annotations/` hold local preview, data generation, and annotation-import tooling
  respectively; `tools/lib/` holds the helpers those scripts share (paths, id/bucket/shard formulas re-exported from
  `assets/js`, argv parsing) and `tools/tests/` the node:test suites; `tools/check.mjs` is `npm run check`.
- **App shell** (`index.html`): the `<head>` prefs script, `viewport-fit=cover`, the `#qx-glass` SVG filter,
  the `.ambient` backdrop, a header of three `.capsule`s (brand, `.site-nav` with 首页/诗集/诗人/关于, icon
  `.theme-btn`) each with `.glass` span layers, the six `#page-*` containers, `#boot`, a compact footer card
  (no nav), the phone `.tabbar` and the service-worker block. Links that should get `aria-current` must be
  `.site-nav__link[data-nav]` (used by both the header nav and the tab bar; only one of the two is displayed
  at any width). If you edit the stubs, keep `kyne/index.html` and `liquidglass/index.html` identical
(`shell.test.mjs` asserts they are byte-equal).
- **Liquid-glass design system** lives in `assets/css/glass.css` `:root` — app-style liquid glass (Apple
  Liquid Glass + the [svg-glass-navbar-effect](https://svg-glass-navbar-effect.webflow.io/) Webflow template),
  light by default. **Layers:** a fixed `.ambient` backdrop (three blurred radial blobs `--blob-violet/cyan/
  peach`, drifting via transform-only keyframes; static under reduced motion) → translucent content cards
  (`.gcard`, `.pcard`, `.ptile`, `.tab-panel`, footer card: `--card-bg`/`--card-strong`, no
  backdrop-filter — the backdrop is already soft) → floating glass controls. **Real glass** (`.glass` span
  layers: `__effect` = backdrop-filter + `filter: url(#qx-glass)`, then `__tint`, `__shine`) is used only on
  floating controls: the three header `.capsule`s, the phone `.tabbar`, the sticky `.tabs`, the `.tools-dock`
  and the `.pager` dock; `.search` (sticky) and `.gloss-pop` blur without the SVG filter. They never stack by
  construction (z-index: header/tab bar 30, tabs/pager/search 20, popover 40).
  Token groups: ground/ink `--paper` #F4F4F6, `--surface` #FFF (opaque fallback), `--ink` #1C1C1E
  (+`--ink-rgb`), `--body`, `--muted` #636368 (text on cards/chips/glass only, ≥4.9:1 there),
  `--muted-ambient` #4A4A4F (small text sitting directly on the backdrop, ≥4.8:1 even where all three blobs
  overlap), `--muted-3`, `--line`, `--mark-bg`, `--selection`; violet `--accent`/`--accent-rgb`/
  `--accent-text`/`--accent-halo` (#6A3FD6 light; #996AFF dark with `--accent-text` #AB87FF — accent text
  only on cards); `--blob-*`; glass `--glass-*` (incl. `--glass-tint-strong` for the scrolled header),
  `--pop-*`, `--seg-selected-*`; surfaces `--card-*` (dark cards are a dark tint, `rgba(18,18,22,.55)`),
  `--row-hover-bg`, `--chip-*`, `--tile-bg`, `--input-bg`, `--nav-hover-bg`; seals `--seal-*`,
  `--tang-*`, `--song-*`; buttons `--btn-*`/`--btn2-*`; radii `--r-*`; motion `--ease`/`--dur`; layout
  `--max` 1360, `--gutter`, `--measure`, `--capsule-h`, `--header-h/gap/space`, `--sticky-top` (sticky
  controls and pinned columns), `--tabs-h`, `--tabbar-h/gap/space` (`--tabbar-space` is 0 on desktop; body
  bottom padding, pager offset and scroll padding use it), `--bento-gap`, `--content-w` (safe-area aware).
  Three font roles: `--serif` Noto Serif SC for anything containing Chinese (display 600, reading text 400),
  `--latin` Inter, upright, for Latin letters and digits only, and `--sans` Noto Sans SC for labels, nav and
  buttons — keep `--sans` Chinese-first: Inter's Google subset covers `·` and `—…“”`. Only the loaded
  weights exist (Inter 400–600, Sans 400/500/600, Serif 400/500/600/700).
  **Violet is an accent, never the only signal:** current nav/tab-bar item = raised pill + underline (tab
  bar: filled icon), selected tab = raised pill + underlined label, pressed 夜读 = filled capsule + flipped
  icon, pressed toolbar buttons = fill + underline, empty tabs = dashed outline, 唐/宋 swatches differ in
  shape (circle/square), search hits = tint + underline, open note terms = dotted → solid underline.
  **Root rules:** keep `html` background-less and `body` `position: static` with no transform/filter/
  backdrop-filter/contain/will-change (the `.ambient` layer sits at z-index −1 over body's canvas
  background, and `reader.js positionGloss()` uses document coordinates). `body` is a column flex container
  with `padding-bottom: var(--tabbar-space)`. Fallbacks live in `@supports not (backdrop-filter…)`,
  `prefers-reduced-transparency` (no backdrop, opaque `--surface` cards and controls) and `forced-colors`
  (Canvas + CanvasText borders, Highlight outline on current/selected items). Build new UI from these tokens.
  **夜读 (dark theme)** only redefines tokens, in two identical blocks —
  `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {…} }` and
  `:root[data-theme="dark"] {…}` — so never hard-code a color: add a token to `:root` and to both dark
  blocks (`tools/tests/glass-css.test.mjs` asserts the two blocks declare the same tokens with the same values).
  Reading text sizes are `calc(<px> * var(--reading-scale))` (including the mobile media
  queries). Vertical 原文 is `:root[data-vertical="1"] .original__body` — the scroll container itself is
  `vertical-rl`, so it opens on the first column (left-aligned, `margin: 0`), and a left-edge shadow
  hints at columns still hidden inside the card.
- **Display headings** use `.display[data-size]`, the tier coming from `displaySize()` in
  `templates.js`; sizes use `cqi`, so the heading's parent sets `container-type` (glass: `.poem-head`,
  `.gpage-head`, `.profile-card__id`, `.about-hero`); the home hero sizes itself from `--hero-chars` + `cqi`
  (its lines come from `heroLines()`). CJK needs `line-height ≥ 1.05` and tracking no tighter than `-0.03em`.
  Glass breakpoints: `(min-width: 1200px)` (two-column poem/author pages, 5-column grids), 810–1199 (single
  centred column, 3-column grids), `(max-width: 809px)` (tab bar replaces the header nav, the home search card
  stacks, 1-column grids; 600–809 gets 2-column grids), `(max-width: 389px)` (no «/» pager edges, notes stack,
  创作背景 tab shows 背景 with the full name kept for screen readers) and `(max-width: 359px)` (tighter search
  card, toolbar and tabs; the 试试 hint label is visually hidden). The home hero's `min-height` and, on short
  viewports, its line size (`(100svh - …) / 2.3`) subtract the header, search card (and tab bar on phones), so
  both home cards fit the first screen from about 630px (desktop) / 610px (phones) of height; on phones
  `#page-home` also fills the screen so the footer starts below the fold instead of under the tab bar.
- **`glass-templates.js` markup is frozen by `tools/tests/glass-templates.test.mjs`** (and the
  `templates.js` helpers by `templates.test.mjs`) — restyle from CSS or add a new builder instead. Decorative
  pseudo-content is written as `content: "x" / ""` so screen readers skip it. Page structure belongs in
  `glass-pages.js` and `index.html`, which have no markup tests (only `index.html`'s `?` strip and the stubs are
  pinned by `shell.test.mjs`) — verify those in a browser.
- **`tools/data/prep.mjs`**: converts 全唐诗 繁→简 via `opencc-js` (宋词 is already simplified); strips
  lone UTF-16 surrogates; synthesizes ci titles/ids. On re-run it **preserves
  `data/annotations/`** (your hand-written overlays) and `data/about.json`; it regenerates `index/`, `poems/`,
  `authors/`, `manifest.json`, `search.json`, `authors-index.json` and the seed `c59-66.json`; it deletes but does
  **not** regenerate `featured.json` and `lines.json` (run `node tools/data/build-featured.mjs` next).
  `data/annotations/README.md` is hand-maintained docs —
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
  was intentionally removed), live at https://mjliiii.github.io/QingXin/ (the old `/kyne/` and
  `/liquidglass/` URLs redirect there). The root
  `.nojekyll` is required so Pages serves `data/**` as-is (thousands of JSON files, Chinese filenames).
  All paths are relative and routing is hash-based, so the site works under the `/QingXin/`
  subpath with no 404 fallback.
- This repo sits under iCloud-synced `~/Documents`: re-running `tools/data/prep.mjs` can spawn conflict
  copies like `data/poems 2/`. Clean with `find data -name '* [0-9]*' -exec rm -rf {} +`.
