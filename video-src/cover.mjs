import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({executablePath: process.env.CHROME_BIN, headless: 'shell', args: ['--no-sandbox', '--allow-file-access-from-files', '--force-color-profile=srgb']});
for (const [w, name] of [[1920, 'cover_16x9'], [1440, 'cover_4x3']]) {
  const p = await b.newPage(); await p.setViewport({width: w, height: 1080});
  await p.goto(`file://${process.cwd()}/comp/cover.html?w=${w}`, {waitUntil: 'load'}); await p.evaluate(() => document.fonts.ready);
  await new Promise(r => setTimeout(r, 300));
  await p.screenshot({path: `out_${name}.jpg`, type: 'jpeg', quality: 95}); await p.close();
}
await b.close();
