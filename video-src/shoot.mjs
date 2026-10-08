import puppeteer from 'puppeteer-core';
const url = 'file:///mnt/d/FastIn/travel/TravelPlanner/examples/' + encodeURIComponent('成都3天2晚路书.html');
const b = await puppeteer.launch({executablePath: process.env.CHROME_BIN, headless: 'shell', args: ['--no-sandbox', '--allow-file-access-from-files']});
async function open(w, dpr, hideSticky) {
  const p = await b.newPage();
  await p.setViewport({width: w, height: 900, deviceScaleFactor: dpr, isMobile: w < 500, hasTouch: w < 500});
  await p.goto(url, {waitUntil: 'networkidle2', timeout: 90000}).catch(e => console.log('goto', e.message));
  await new Promise(r => setTimeout(r, 2500));
  await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { scrollTo(0, y); await new Promise(r => setTimeout(r, 50)); } scrollTo(0, 0); });
  await new Promise(r => setTimeout(r, 1500));
  if (hideSticky) await p.evaluate(() => { for (const el of document.querySelectorAll('*')) { const cs = getComputedStyle(el); if (cs.position === 'sticky' || cs.position === 'fixed') el.style.display = 'none'; } });
  return p;
}
let p = await open(1280, 1.5, false);
await p.screenshot({path: 'shots/desk_full.jpg', fullPage: true, type: 'jpeg', quality: 88});
await (await p.$('header')).screenshot({path: 'shots/desk_header.png'});
await p.close();
p = await open(1280, 1.5, true);
for (const s of ['map', 'transport']) await (await p.$('#' + s)).screenshot({path: `shots/sec_${s}.png`});
await p.close();
p = await open(390, 2, false);
await p.screenshot({path: 'shots/mob_full.jpg', fullPage: true, type: 'jpeg', quality: 88});
await p.close(); await b.close(); console.log('shot ok');
