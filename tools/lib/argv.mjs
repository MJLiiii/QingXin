/* annotate-scrape.mjs 与 crawl-all-authors.mjs 共用的命令行解析。
   （annotate-import.mjs 的 --src 多值、--limit 无守卫等语义不同，自带解析，不并入。） */
export function flag(argv, name) {
  return argv.includes(name);
}

/* 取值型开关：其后紧跟的、不以 -- 开头的 token 是它的值。 */
export function opt(argv, name, dflt) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
}

/* 位置参数：跳过所有 --flag 与取值型开关吞掉的值。from = 首个位置参数的下标
   （annotate-scrape 的 argv[0] 是模式名，传 1；crawl-all 没有模式名，传 0）。 */
export function positionals(argv, valueFlags, from = 0) {
  const out = [];
  for (let i = from; i < argv.length; i++) {
    const tok = argv[i];
    if (tok.startsWith('--')) {
      if (valueFlags.has(tok) && argv[i + 1] && !argv[i + 1].startsWith('--')) i++;
      continue;
    }
    out.push(tok);
  }
  return out;
}
