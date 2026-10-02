/**
 * 把元素滚到视口内，然后按**视口坐标**截图（captureBeyondViewport=false）。
 * 用于回答"这个元素此刻在屏幕上到底长什么样、有没有被盖住"。
 * 用法：node shot-inview.mjs <url> <选择器> <out.png> [pad] [索引]
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const [URL_ARG, SEL, OUT] = process.argv.slice(2);
const PAD = Number(process.argv[5] || 120);
const IDX = Number(process.argv[6] || 0);
const VW = Number(process.env.VW || 1371), VH = Number(process.env.VH || 900);
const PORT = Number(process.env.CDP_PORT || 9361);
const CHROME = [
  process.env.CHROME_PATH, // 浏览器装在别处时，在 .env 里写 CHROME_PATH=完整路径（经 run.sh 调用时生效）
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge',
].find(p => p && fs.existsSync(p));
if (!CHROME) { console.error('没有浏览器'); process.exit(1); }
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-iv-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--no-default-browser-check', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile, `--window-size=${VW},${VH}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitPort(port, tries = 80) {
  for (let i = 0; i < tries; i++) {
    const ok = await new Promise(res => { const s = net.connect(port, '127.0.0.1');
      s.on('connect', () => { s.destroy(); res(true); }); s.on('error', () => res(false)); });
    if (ok) return true; await sleep(250);
  } return false;
}
const getJSON = u => new Promise((res, rej) => { http.get(u, r => { let d = '';
  r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej); });

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
  await sleep(6000);

  const q = `(() => { try {
    document.documentElement.style.scrollBehavior='auto'; document.body.style.scrollBehavior='auto';
    const list = document.querySelectorAll(${JSON.stringify(SEL)});
    if (!list.length) return 'NOTFOUND';
    const e = list[${IDX}];
    const r0 = e.getBoundingClientRect();
    window.scrollTo(0, Math.max(0, r0.top + window.scrollY - ${PAD}));
    const r = e.getBoundingClientRect();
    let topmost = null, isSelf = false;
    const px = Math.max(1, Math.min(${VW}-2, r.left + r.width/2));
    const py = Math.max(1, Math.min(${VH}-2, r.top + r.height/2));
    const mid = document.elementFromPoint(px, py);
    if (mid) {
      topmost = mid.tagName + (mid.id ? '#'+mid.id : '') +
        (typeof mid.className === 'string' && mid.className ? '.'+mid.className.trim().split(/\\s+/)[0] : '');
      isSelf = (mid === e) || e.contains(mid);
    }
    return JSON.stringify({ vy: Math.round(r.top), vh: Math.round(r.height),
      vx: Math.round(r.left), vw: Math.round(r.width), scrollY: Math.round(window.scrollY),
      topmost: topmost, isSelf: isSelf });
  } catch (err) { return 'ERR: ' + (err && err.message ? err.message : String(err)); } })()`;
  const rr = await send('Runtime.evaluate', { expression: q, returnByValue: true });
  if (!rr || !rr.result || rr.result.value === undefined) {
    console.error('页面里报错了：' + JSON.stringify(rr && rr.exceptionDetails ? rr.exceptionDetails.text : rr));
    process.exit(1);
  }
  if (rr.result.value === 'NOTFOUND') { console.error('找不到 ' + SEL); process.exit(1); }
  const b = JSON.parse(rr.result.value);
  await sleep(400);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log(`已截图 ${OUT}`);
  console.log(`  元素在视口 y=${b.vy} h=${b.vh} x=${b.vx} w=${b.vw}  scrollY=${b.scrollY}`);
  console.log(`  该点最上层元素 = ${b.topmost}   是自己吗 = ${b.isSelf ? '是 ✅' : '不是 ❌ 被盖住了'}`);
} finally {
  try { chrome.kill(); } catch {}
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
