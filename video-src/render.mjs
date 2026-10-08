// render frames [f0, f1) to an mp4 segment by piping JPEG frames into ffmpeg
import puppeteer from 'puppeteer-core'; import { spawn } from 'child_process';
const [f0, f1, out, fps = '30'] = process.argv.slice(2).map((v, i) => i < 2 ? +v : v);
const FPS = +fps;
const b = await puppeteer.launch({executablePath: process.env.CHROME_BIN, headless: 'shell', args: ['--no-sandbox', '--allow-file-access-from-files', '--force-color-profile=srgb', '--disable-gpu-vsync', '--hide-scrollbars']});
const p = await b.newPage();
p.on('pageerror', e => console.log('[pageerror]', e.message));
await p.setViewport({width: 1920, height: 1080, deviceScaleFactor: 1});
await p.goto('file://' + process.cwd() + '/comp/index.html', {waitUntil: 'load'});
await p.evaluate(() => window.ready);
const cdp = await p.createCDPSession();
const ff = spawn('bin/ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', out], {stdio: ['pipe', 'inherit', 'inherit']});
const t0 = Date.now();
for (let f = f0; f < f1; f++) {
  await p.evaluate(t => window.seek(t), f / FPS);
  const {data} = await cdp.send('Page.captureScreenshot', {format: 'jpeg', quality: 94, fromSurface: true});
  const buf = Buffer.from(data, 'base64');
  if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
  if ((f - f0) % 300 === 0) console.log(out, f, ((Date.now() - t0) / 1000).toFixed(1) + 's');
}
ff.stdin.end();
await new Promise(r => ff.on('close', r));
await b.close();
console.log('done', out, ((Date.now() - t0) / 1000).toFixed(1) + 's');
