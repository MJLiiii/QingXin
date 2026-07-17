# 剩余 74,540 首诗词的注释补充:Claude 批量生成方案

## Context

全量爬取后注释覆盖 4,120 首;剩余 74,540 首(唐 54,662 + 宋词 19,878)在人工注释源上已无路可走
——其中 10,442 首已确认古诗文网有页面但无注释内容,其余站点对长尾覆盖近零。唯一可规模化的路径
是用 Claude API 批量生成,并明确标注 AI 来源与人工内容区隔。

**用户已定**:① 生成 注释+译文+赏析,创作背景一律留空(史实杜撰风险,沿用占位);
② 混合模型——头部作者用 Sonnet 4.6、长尾用 Haiku 4.5(预算 ≈ US$300);③ AI 注释不进入首页
精选池(保持 3,195 首纯人工源)。

**技术要点**(已按 claude-api 参考核实):Message Batches API 全token五折、单批 ≤10 万请求/256MB、
多数 1 小时内完成;共享系统提示加 `cache_control` 走 prompt cache;
`output_config.format`(json_schema, `additionalProperties:false`)保证严格 JSON;
结果乱序、按 `custom_id` 对账;Haiku 4.5 不支持 `effort` 参数(勿传);模型 id 用
`claude-sonnet-4-6` / `claude-haiku-4-5`;需 `ANTHROPIC_API_KEY` 环境变量。

## 任务 1:新工具 `tools/annotations/annotate-llm.mjs`

零第三方依赖(Node 原生 `fetch` 直连 `api.anthropic.com`,与 gushiwen-client 同风格;
headers: `x-api-key` + `anthropic-version: 2023-06-01`)。

**工作清单构建**:
- 复用 `annotate-lib.mjs` 的 `loadQingxinIndex`(byId 含题/作者/朝代/正文);
- 剩余 id = 语料 − `data/annotations/` 已有文件;
- **按正文归一化去重**(normText 后 hash):语料重收的同体诗(乐府卷/本集卷)一组只生成一次,
  写入时 fanout 到全部兄弟 id(同爬虫行为,省 3-5% 且内容一致);
- 排序按 `authors-index.json` 作者名次(读者最可能访问的先做);
- **模型路由**:作者名次 ≤ `--sonnet-top N`(默认 80,约 1.8–2 万首)→ `claude-sonnet-4-6`,
  其余 → `claude-haiku-4-5`。

**请求形态**(每首一条,`custom_id` = 主 id):
- `system`:固定注释专家提示(要求:注释词条必须取自原文原词、译文逐句白话、赏析 2-3 段,
  不得编造史实/背景),末块 `cache_control: {type:"ephemeral"}`;
- `output_config.format`:json_schema `{notes:[{term,def}], translation:[string], appreciation:[string]}`;
- user 内容:题目/作者/朝代/原文;`max_tokens: 8000`(长诗如《长恨歌》留量);不传 thinking/effort。

**模式**(断点状态存 gitignored `tools/.cache/llm/state.json`:已提交批次 id、已完成 id):
- `pilot` — 同一 100 首分层抽样(头部+长尾),Haiku 与 Sonnet 各生成一份,写到
  `tools/.cache/llm/pilot/<model>/<id>.json` 供人工评审,**不落 data/**;
- `submit [--limit N] [--dry-run]` — 组批(默认 1 万请求/批)提交;dry-run 只打印条数与 token 估算;
- `poll` — 轮询 `processing_status`,`ended` 后拉取 results(.jsonl),校验并落盘;
- `run` — submit+poll 循环直至清空(可 nohup,风格同 crawl-all)。

**结果校验与落盘**:
- 每条 `notes[].term` 必须是原文/题目的子串(天然幻觉检测)——不合格词条剔除;剔除超半数则整首
  重排队;translation/appreciation 非空、长度下限;`stop_reason: max_tokens` → 提高上限重排;
  errored/expired/refusal → 记入重试队列;
- 文件格式:`{id, notes, translation, appreciation, background: [], source: "ai", model: "<model-id>"}`
  (background 留空 → 详情页照常显示「尚未收录」占位);
- 写主 id + 全部正文相同的兄弟 id。

## 任务 2:三处小改动(与生成并行)

1. **`assets/js/app.js` `renderPoem`**:注释 `source === "ai"` 时在注释区块前/后渲染一行
   faint 小字「本篇注释・译文・赏析由 AI 生成,仅供参考。」(用现有 `--muted-2` 类风格,零新 CSS);
2. **`tools/data/build-featured.mjs`**:合格条件加 `a.source !== "ai"`(首页池保持纯人工源,
   预期数量仍为 3,195);
3. **`tools/annotations/annotate-scrape.mjs`**:expand/authors 的「跳过已存在文件」及 commit 写入
   判定中,`source:"ai"` 视同不存在(人工爬取内容永远可覆盖 AI 版;backfill 的 gushiwen* 匹配
   不含 ai,天然不受影响)。

## 任务 3:执行流程

1. **代码落地 + 试点**:实现工具 → `pilot` 生成 2×100 首(成本几美元)→ **用户评审两模型质量**,
   确认/调整 `--sonnet-top`(此处为检查点,不满意可全 Sonnet 或调提示词重试点);
2. **全量运行**:`run` 模式跑完约 8 个批次(预计 1-2 天,视账户层级的批量队列限额;命中限额则
   脚本等待重试);每完成一批 `git add data/annotations && git commit` 一次(约 1 万文件/批);
3. **收尾**:统计(总覆盖、模型分布、剔除率/重试率)→ CLAUDE.md 更新(annotations 约定新增
   AI 来源条目:precedence 人工>AI、首页池排除、免责声明;coverage 段更新为 ~78,660 全覆盖)
   → JSON 全量校验 → 本地/线上抽查 → push。

**体量提示**:约 7.4 万新文件 × ~4KB ≈ **250-300MB**,仓库总量 ~350MB——GitHub Pages 限额(1GB)
内没问题,但 clone/push 变重;按批分次 commit 减少单次压力。

## 验证

1. **试点评审**(人工):两模型各 100 首对比——注释准确性、译文通顺度、赏析是否空洞;
2. **自动校验**:term-in-body 通过率(预期 >95%)、JSON 全量 parse、每字段非空率;
3. **前端**:本地 serve → AI 注释诗页渲染五节 + 免责声明;人工注释页无免责声明;
   首页「精选」仍 3,195 池(`featured.json` 重新生成后 diff 为零);
4. **回归**:`check-dups.mjs` 正常(AI 文件不在 resolved.json,不影响分组);诗集/搜索/诗人页照常;
5. **线上**:push 后抽查 1 首 AI 注释诗 + 1 首人工注释诗。
