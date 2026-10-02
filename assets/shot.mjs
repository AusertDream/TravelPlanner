/**
 * 路书 HTML 截图（shot）——正常视口下按元素裁切
 * ============================================================
 * 用法：
 *   node shot.mjs <url> [选择器] [输出png] [索引] [上下留白px]
 *   node shot.mjs "file:///D:/x.html" "#days" days.png 0 80
 *   node shot.mjs "file:///D:/x.html" ""           全页（out.png）
 *
 * ⚠️ 不要用 `chrome --screenshot --window-size=1371,12000` 那种超长视口：
 *    超长视口下布局与正常视口不同，且缩放预览会让人眼把"行距紧"误判成"压字"。
 *    这里用正常视口 + CDP 按元素的**文档绝对坐标**裁切。
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const [URL_ARG, SEL = '', OUT = 'out.png', IDX = '0', PAD = '80'] = process.argv.slice(2);
if (!URL_ARG) { console.error('用法: node shot.mjs <url> [选择器] [out.png] [索引] [留白px]'); process.exit(2); }
const VW = Number(process.env.VW || 1371), VH = Number(process.env.VH || 900);
const PORT = Number(process.env.CDP_PORT || 9334);
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH, // 浏览器装在别处时，在 .env 里写 CHROME_PATH=完整路径（经 run.sh 调用时生效）
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge',
];
const CHROME = CHROME_CANDIDATES.find(p => p && fs.existsSync(p));
if (!CHROME) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-shot-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--no-default-browser-check', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile, `--window-size=${VW},${VH}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitPort(port, tries = 80) {
  for (let i = 0; i < tries; i++) {
    const ok = await new Promise(res => {
      const s = net.connect(port, '127.0.0.1');
      s.on('connect', () => { s.destroy(); res(true); }); s.on('error', () => res(false));
    });
    if (ok) return true; await sleep(250);
  }
  return false;
}
const getJSON = (u) => new Promise((res, rej) => {
  http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej);
});

try {
  if (!await waitPort(PORT)) { console.error('CDP 没起来'); process.exit(1); }
  const list = await getJSON(`http://127.0.0.1:${PORT}/json/list`);
  const t = list.find(x => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const send = (m, p) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } });
  await new Promise(r => ws.addEventListener('open', r));
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL_ARG });
  await sleep(7000);

  let clip = { x: 0, y: 0, width: VW, height: VH, scale: 1 };
  if (SEL) {
    const q = `(() => { const e=document.querySelectorAll(${JSON.stringify(SEL)})[${Number(IDX)}];
      if(!e) return 'NOTFOUND';
      const r=e.getBoundingClientRect();
      return JSON.stringify({x:r.left, y:r.top+scrollY, w:r.width, h:r.height}); })()`;
    const rr = await send('Runtime.evaluate', { expression: q, returnByValue: true });
    if (rr.result.value === 'NOTFOUND') { console.error('找不到选择器 ' + SEL); process.exit(1); }
    const b = JSON.parse(rr.result.value);
    clip = { x: 0, y: Math.max(0, Math.round(b.y) - Number(PAD)), width: VW,
             height: Math.round(b.h) + Number(PAD) * 2, scale: 1 };
  }
  const shot = await send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true });
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log(`已截图 ${OUT}  裁切 ${JSON.stringify(clip)}`);
  console.log('→ 请用 read_image 真的看一眼，别只看 grep 结果。');
} finally {
  try { chrome.kill(); } catch {}
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
