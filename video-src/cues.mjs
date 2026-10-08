import puppeteer from 'puppeteer-core'; import fs from 'fs';
const b = await puppeteer.launch({executablePath: process.env.CHROME_BIN, headless: 'shell', args: ['--no-sandbox', '--allow-file-access-from-files']});
const p = await b.newPage(); await p.setViewport({width: 1920, height: 1080});
p.on('console', m => { if (/warn|error/.test(m.type())) console.log('[page]', m.text()); });
await p.goto('file://' + process.cwd() + '/comp/index.html', {waitUntil: 'load'}); await p.evaluate(() => window.ready);
const cues = await p.evaluate(() => window.CUES);
fs.writeFileSync('cues.json', JSON.stringify(cues.sort((a, b) => a.t - b.t)));
console.log(cues.length, 'cues'); await b.close();
