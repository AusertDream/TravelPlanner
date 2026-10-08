// node frames.mjs out.jpg cols t1 t2 ... → 帧拼图（每帧 640x360，左上角标时间）
import puppeteer from 'puppeteer-core'; import { execFileSync } from 'child_process'; import fs from 'fs';
const [out, cols, ...ts] = process.argv.slice(2);
const b = await puppeteer.launch({executablePath: process.env.CHROME_BIN, headless: 'shell', args: ['--no-sandbox', '--allow-file-access-from-files', '--force-color-profile=srgb', '--hide-scrollbars']});
const p = await b.newPage(); p.on('pageerror', e => console.log('[pageerror]', e.message)); p.on('console', m => m.type() === 'warn' && console.log('[warn]', m.text()));
await p.setViewport({width: 1920, height: 1080});
await p.goto('file://' + process.cwd() + '/comp/index.html', {waitUntil: 'load'}); await p.evaluate(() => window.ready);
fs.mkdirSync('qa', {recursive: true}); const files = [];
for (const [i, t] of ts.entries()) {
  await p.evaluate(t => { window.seek(t); let e = document.getElementById('qat'); if (!e) { e = document.createElement('div'); e.id = 'qat'; e.style.cssText = 'position:fixed;left:0;top:0;z-index:9999;background:#000c;color:#ff0;font:700 52px monospace;padding:4px 14px'; document.body.appendChild(e); } e.textContent = t.toFixed(2); }, +t);
  const f = `qa/f${String(i).padStart(3, '0')}.png`; await p.screenshot({path: f}); files.push(f);
}
await b.close();
const inputs = files.flatMap(f => ['-i', f]);
const lab = ts.map((t, i) => `[${i}]scale=640:360[v${i}]`).join(';');
const C = +cols, R = Math.ceil(ts.length / C), layout = ts.map((_, i) => `${(i % C) * 640}_${Math.floor(i / C) * 360}`).join('|');
execFileSync('bin/ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', `${lab};${ts.map((_, i) => `[v${i}]`).join('')}xstack=inputs=${ts.length}:layout=${layout}:fill=black`, '-frames:v', '1', out]);
console.log('ok', out);
