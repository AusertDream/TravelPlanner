/**
 * 模拟真实点击，验证交互是否生效（不是看代码，是看点击后的状态变化）。
 * 用法：node click-test.mjs <url>
 */
import { spawn } from 'node:child_process';
import net from 'node:net'; import http from 'node:http';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';

const URL_ARG = process.argv[2];
const PORT = Number(process.env.CDP_PORT || 9421);
const CHROME = [
  process.env.CHROME_PATH, // 浏览器装在别处时，在 .env 里写 CHROME_PATH=完整路径（经 run.sh 调用时生效）
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge',
].find(p => p && fs.existsSync(p));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ct-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--no-default-browser-check', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile, '--window-size=1371,900', 'about:blank'], { stdio: 'ignore' });
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
  let id = 0; const pend = new Map(); const consoleMsgs = [];
  const send = (m, p) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown')
      consoleMsgs.push('页面异常: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
      consoleMsgs.push('console.error: ' + m.params.args.map(a => a.value).join(' '));
  });
  await new Promise(r => ws.addEventListener('open', r));
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: URL_ARG });
  await sleep(6000);

  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.value;

  console.log('=== 页面错误 ===');
  console.log(consoleMsgs.length ? consoleMsgs.join('\n') : '（无）');

  // 1. 酒店档位按钮
  console.log('\n=== 酒店档位按钮 ===');
  const info = await ev(`JSON.stringify({
    btns: [...document.querySelectorAll('#hsel button')].map(b => ({
      text: b.textContent.trim(), t: b.getAttribute('data-t'), pressed: b.getAttribute('aria-pressed') })),
    panes: [...document.querySelectorAll('.hpane')].map(p => ({ id: p.id, on: p.classList.contains('on') }))
  })`);
  const d = JSON.parse(info || '{}');
  (d.btns || []).forEach((b, i) => console.log(`  按钮${i}: 「${b.text}」 data-t=${b.t} pressed=${b.pressed}`));
  (d.panes || []).forEach(p => console.log(`  面板: #${p.id} on=${p.on}` +
    (d.btns || []).some(b => b.t === p.id) ? '' : '   ← 没有按钮指向它！'));

  // 真点第 2、3、4 个按钮，看面板切换
  for (const i of [1, 2, 3]) {
    await ev(`(() => { const b=[...document.querySelectorAll('#hsel button')][${i}]; if(b) b.click(); })()`);
    await sleep(300);
    const st = await ev(`JSON.stringify([...document.querySelectorAll('.hpane')].map(p=>p.id+':'+p.classList.contains('on')).join(' '))`);
    console.log(`  点第${i + 1}个按钮后 → ${st}`);
  }

  // 2. 导航锚点
  console.log('\n=== 导航锚点 ===');
  const beforeY = await ev('window.scrollY');
  await ev(`document.querySelector('nav.sticky a[href="#budget"]').click()`);
  await sleep(1500);
  const afterY = await ev('window.scrollY');
  const targetY = await ev(`Math.round(document.getElementById('budget').getBoundingClientRect().top + window.scrollY)`);
  console.log(`  点「花多少」前 scrollY=${beforeY}，点后 scrollY=${Math.round(afterY)}，目标 #budget 在 y=${targetY}`);
  console.log('  锚点是否生效: ' + (Math.abs(afterY - targetY) < 200 ? '✅ 生效' : '❌ 没跳过去'));

  // 3. 主题按钮
  console.log('\n=== 深色按钮 ===');
  const t0 = await ev(`document.documentElement.getAttribute('data-theme')`);
  await ev(`document.getElementById('tg').click()`);
  await sleep(300);
  const t1 = await ev(`document.documentElement.getAttribute('data-theme')`);
  console.log(`  点击前 data-theme=${t0}，点击后=${t1}  ` + (t0 !== t1 ? '✅ 生效' : '❌ 没变化'));
} finally {
  try { chrome.kill(); } catch {}
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
