/**
 * 解码 DSH v4 会话日志（多帧 zstd），打印尾部事件的可读摘要。
 * ============================================================
 * 用途：判断一次运行**到底有没有跑完**，而不是只看任务卡状态。
 *   实测教训：产物做完了、会话卡在收尾时，任务卡会一直停在 running 像没事一样；
 *   而会话日志会立刻停止增长。所以"日志空闲 ≥7 分钟"才是可靠的完成判据。
 *
 * 用法：
 *   node read-session.mjs <session.v4.jsonl.zstd> [尾部条数]
 *   node read-session.mjs --latest [尾部条数]      # 自动找最近被写过的会话
 *
 * 关注这几类事件：
 *   turn/end   {reason:{kind:"completed"}}  → 正常跑完
 *   assistant/message                       → 它的最终回复
 *   tool/call  name=ask_user_question       → 卡死前兆（无人值守环境没人应答）
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';

const SESS = path.join(os.homedir(), '.dsh', 'sessions');

function latestSession() {
  let best = null;
  const walk = (dir, depth) => {
    if (depth > 3) return;
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p, depth + 1); continue; }
      if (!/^session\.v4\.jsonl/.test(e.name)) continue;
      const st = fs.statSync(p);
      if (!best || st.mtimeMs > best.mtimeMs) best = { p, mtimeMs: st.mtimeMs, size: st.size };
    }
  };
  walk(SESS, 0);
  return best;
}

function decode(file) {
  const buf = fs.readFileSync(file);
  const M = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  const starts = [];
  for (let i = 0; i + 4 <= buf.length; i++)
    if (buf[i] === M[0] && buf[i + 1] === M[1] && buf[i + 2] === M[2] && buf[i + 3] === M[3]) starts.push(i);
  let text = '';
  if (starts.length <= 1) {
    text = zlib.zstdDecompressSync(buf).toString('utf8');
  } else {
    for (let k = 0; k < starts.length; k++) {
      const a = starts[k], b = k + 1 < starts.length ? starts[k + 1] : buf.length;
      try { text += zlib.zstdDecompressSync(buf.subarray(a, b)).toString('utf8'); } catch { /* 坏帧跳过 */ }
    }
  }
  return { text, frames: starts.length };
}

const brief = (o, depth = 0) => {
  if (o == null) return '';
  if (typeof o === 'string') return o.length > 300 ? o.slice(0, 300) + '…' : o;
  if (Array.isArray(o)) return o.map(x => brief(x, depth + 1)).join(' | ');
  if (typeof o === 'object') {
    for (const k of ['text', 'content', 'message', 'error', 'reason', 'name', 'type', 'kind'])
      if (o[k] !== undefined) return k + '=' + brief(o[k], depth + 1);
    return JSON.stringify(o).slice(0, 300);
  }
  return String(o);
};

let args = process.argv.slice(2);
let file, tail = 20;
if (args[0] === '--latest') {
  const s = latestSession();
  if (!s) { console.error('没找到任何会话日志'); process.exit(1); }
  file = s.p;
  const ageMin = ((Date.now() - s.mtimeMs) / 60000).toFixed(1);
  console.log(`最近写入的会话: ${path.basename(path.dirname(file))}`);
  console.log(`  ${(s.size / 1024).toFixed(0)} KB，最后写入 ${ageMin} 分钟前`);
  console.log(`  ${ageMin > 7 ? '→ 空闲超过 7 分钟，判定已结束' : '→ 仍在写入（可能还在跑）'}\n`);
  if (args[1]) tail = Number(args[1]);
} else {
  file = args[0];
  if (args[1]) tail = Number(args[1]);
}
if (!file) { console.error('用法: node read-session.mjs <session.v4.jsonl.zstd> [条数] | --latest [条数]'); process.exit(2); }

const { text, frames } = decode(file);
const lines = text.split('\n').filter(l => l.trim());
console.log(`共 ${frames} 个 zstd 帧，解出 ${lines.length} 行事件\n`);

let sawEnd = false;
lines.slice(-tail).forEach((l, i) => {
  const n = lines.length - Math.min(tail, lines.length) + i + 1;
  let e;
  try { e = JSON.parse(l); } catch { return; }
  const type = e.type || e.kind || e.event || '?';
  if (type === 'turn/end') sawEnd = true;
  console.log(`[${n}] <${type}>`);
  for (const k of Object.keys(e).filter(k => !['type', 'kind', 'event'].includes(k)).slice(0, 5)) {
    const v = brief(e[k]);
    if (v && v !== '{}') console.log('      ' + k + ': ' + v);
  }
});

// 全局体检
const hasAsk = text.includes('ask_user_question');
const lastEnd = text.lastIndexOf('"turn/end"');
console.log('\n=== 体检 ===');
console.log('  出现 turn/end: ' + (lastEnd >= 0 ? '是' : '否'));
if (lastEnd >= 0) {
  const after = text.slice(lastEnd, lastEnd + 200);
  console.log('  最后一次 turn/end: ' + after.slice(0, 120).replace(/\s+/g, ' '));
}
if (hasAsk && lastEnd < text.indexOf('ask_user_question')) {
  console.log('  ⚠ 有 ask_user_question 且发生在最后一次 turn/end 之后 → 很可能卡在等人回答');
}
