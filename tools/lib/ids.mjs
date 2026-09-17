/* 诗词 id / 作者 slug 的编码约定：与前端共用同一份实现（assets/js/data.js、utils.js 在 Node 下可 import，
   import 期不碰 window）。分片公式 poemShardFile 是 data.js loadPoem 的工具侧对应（前端不能 import tools/），
   tools/tests/ids.test.mjs 把两者钉在一起。 */
export { parseId, authorBucket, SUB_CHUNK, LIST_PAGE_SIZE } from '../../assets/js/data.js';
export { pad3, pad4 } from '../../assets/js/utils.js';
import { pad4 } from '../../assets/js/utils.js';

export const ANN_FILE_RE = /^[tc]\d+-\d+\.json$/; // 排除 README 与 iCloud 冲突副本

/* id 所在的原文子文件与其中的下标。subChunkSize 由调用方从 manifest.subChunkSize 取（validate 靠它核对
   manifest 与磁盘布局一致），前端固定为 data.js 的 SUB_CHUNK。 */
export function poemShardFile(loc, subChunkSize) {
  if (!Number.isInteger(subChunkSize) || subChunkSize <= 0) throw new TypeError('poemShardFile: subChunkSize 必须是正整数');
  return { file: `${pad4(loc.chunk)}-${Math.floor(loc.i / subChunkSize)}.json`, index: loc.i % subChunkSize };
}
