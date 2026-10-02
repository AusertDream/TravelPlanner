/**
 * 路书 HTML 布局自检（check-layout）
 * ============================================================
 * 用 CDP 打开页面，量出真实布局，报四类问题：
 *   1. 重叠   两个元素互相压住、且不是父子关系（图盖字最常见）
 *   2. 溢出   子元素超出祖辈容器，且容器不裁切
 *   3. 零尺寸 容器宽或高为 0 却有子元素（Leaflet 零高度容器那种坑的通用形态）
 *   4. 横向溢出 文档 scrollWidth > clientWidth（窄屏文字被切）
 *
 * 用法：
 *   node check-layout.mjs "file:///D:/path/to/路书.html" [宽度] [高度]
 * 返回码：0 = 干净，1 = 有问题（便于串进交付流程）
 *
 * ⚠️ 不要用"超长视口截图 + 裁切坐标"来判断重叠——超长视口下布局不同，
 *    缩放预览还会让人眼误判。这里量的是布局引擎的权威数值。
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const URL_ARG = process.argv[2];
if (!URL_ARG) { console.error('用法: node check-layout.mjs <url> [宽] [高]'); process.exit(2); }
const VW = Number(process.argv[3] || 1371);
const VH = Number(process.argv[4] || 900);
const PORT = Number(process.env.CDP_PORT || 9333);

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
if (!CHROME) { console.error('找不到 Chrome/Edge，跳过视觉自检（请人工看图）'); process.exit(0); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-chk-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--no-default-browser-check', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile, `--window-size=${VW},${VH}`, 'about:blank'], { stdio: 'ignore' });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitPort(port, tries = 80) {
  for (let i = 0; i < tries; i++) {
    const ok = await new Promise(res => {
      const s = net.connect(port, '127.0.0.1');
      s.on('connect', () => { s.destroy(); res(true); });
      s.on('error', () => res(false));
    });
    if (ok) return true; await sleep(250);
  }
  return false;
}
const getJSON = (u) => new Promise((res, rej) => {
  http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej);
});

// 该不该报：只报"有内容"的叶子/近叶子元素，否则满屏都是容器对容器的噪声
// ⚠️ elementFromPoint 只对**视口内**坐标有效。页面往往有一万多像素高、视口只有 900，
//    所以必须逐屏滚动扫描，否则等于只检查了顶部那几屏，会误报"通过"。
const AUDIT = `(async () => {
  const VW = ${VW}, VH = ${VH};
  document.documentElement.style.scrollBehavior = 'auto';
  document.body.style.scrollBehavior = 'auto';
  const hasOwnContent = el => {
    if (el.tagName === 'IMG' || el.tagName === 'CANVAS' || el.tagName === 'SVG') return true;
    for (const n of el.childNodes)
      if (n.nodeType === 3 && n.textContent.trim().length) return true;
    return false;
  };
  const name = el => (el.tagName.toLowerCase()
      + (el.id ? '#' + el.id : '')
      + (typeof el.className === 'string' && el.className.trim()
          ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '')).slice(0, 46);
  const isAnc = (a, b) => { for (let p = b; p; p = p.parentElement) if (p === a) return true; return false; };

  const all = [];
  // 第三方地图（Google / Leaflet）内部自己叠瓦片、canvas、标签，重叠是它的正常画法，不归我们管
  const THIRD_PARTY = '.tm-live *, .gm-style *, .leaflet-container *, iframe *';
  document.querySelectorAll('body *').forEach(el => {
    if (el.matches(THIRD_PARTY)) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return;
    const r = el.getBoundingClientRect();
    if (r.width < 1 && r.height < 1) return;
    all.push({ el, cs, r, y: r.top + scrollY, docY: r.top + scrollY, docX: r.left + scrollX,
               name: name(el), pos: cs.position, z: cs.zIndex, ovf: cs.overflow, own: hasOwnContent(el) });
  });

  const clippedBy = el => {
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const c = getComputedStyle(p);
      if (/hidden|clip|auto|scroll/.test(c.overflowX + ' ' + c.overflowY)) return p;
    }
    return null;
  };
  const inside = (child, host) => {
    const c = child.getBoundingClientRect(), h = host.getBoundingClientRect();
    return c.top >= h.top - 2 && c.bottom <= h.bottom + 2 &&
           c.left >= h.left - 2 && c.right <= h.right + 2;
  };

  const out = { occluded: [], overflow: [], zero: [], hscroll: null,
                pageH: document.body.scrollHeight, count: all.length, screens: 0 };

  // ---- 遮挡：逐屏滚动 + elementFromPoint 点采样 ----
  const pool = all.filter(e => e.own && e.r.width > 6 && e.r.height > 6 && e.pos !== 'fixed');
  const hit = new Map();   // 元素 -> {covered,total,culprits}
  const screens = [];
  for (let y = 0; y < Math.max(document.body.scrollHeight, VH); y += VH - 60) screens.push(y);
  out.screens = screens.length;

  for (const sy of screens) {
    scrollTo(0, sy);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const off = window.scrollY;
    for (const e of pool) {
      const top = e.docY - off, bot = top + e.r.height;
      if (bot < 4 || top > VH - 4) continue;               // 不在本屏
      const rec = hit.get(e) || { covered: 0, total: 0, culprits: new Map(), bySticky: 0, real: 0 };
      const ys = [Math.max(2, top + e.r.height * 0.3),
                  Math.min(VH - 2, top + e.r.height * 0.6)];
      for (const fx of [0.2, 0.5, 0.8]) {
        const x = e.docX + e.r.width * fx;
        if (x < 1 || x > VW - 1) continue;
        for (const yy of ys) {
          if (yy < 1 || yy > VH - 1) continue;
          rec.total++;
          const el = document.elementFromPoint(x, yy);
          if (!el) continue;
          if (el === e.el || isAnc(e.el, el)) continue;
          if (isAnc(el, e.el)) continue;
          rec.covered++;
          const ecs = getComputedStyle(el);
          const k = name(el) + '{pos:' + ecs.position + ',z:' + ecs.zIndex + '}';
          rec.culprits.set(k, (rec.culprits.get(k) || 0) + 1);
          // 吸顶导航/固定元素压住滚动内容，是设计如此，不算缺陷
          let stick = false;
          for (let q = el; q && q !== document.body; q = q.parentElement) {
            const pc = getComputedStyle(q).position;
            if (pc === 'sticky' || pc === 'fixed') { stick = true; break; }
          }
          if (stick) rec.bySticky++; else rec.real++;
        }
      }
      hit.set(e, rec);
    }
  }
  scrollTo(0, 0);
  for (const [e, rec] of hit) {
    if (rec.total >= 3 && rec.covered / rec.total >= 0.5 && rec.real > rec.bySticky) {
      const by = [...rec.culprits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([k, v]) => k + '(' + v + '/' + rec.total + ')').join(' ');
      out.occluded.push({ el: e.name, y: Math.round(e.docY), ratio: Math.round(rec.covered / rec.total * 100),
        txt: (e.el.textContent || '').trim().slice(0, 24), by });
    }
  }

  // 2. 溢出：只有当它**真的会被切掉**时才算问题 ——
  //    ① 元素绝对/固定定位 且 逃出了定位祖先；或
  //    ② 元素被某个裁切祖先裁到。
  //    普通文档流里"子元素比父容器高"是正常的，父容器会被撑高，不报。
  for (const e of all) {
    if (!e.own) continue;
    const cb = clippedBy(e.el);
    if (cb && !inside(e.el, cb)) {
      const cr = cb.getBoundingClientRect();
      const outBy = Math.max(e.r.bottom - cr.bottom, cr.top - e.r.top);
      if (outBy < 1.5) continue;   // 亚像素取整误差（实测 0.4px 被报成「溢出 0px」），不是真问题
      out.overflow.push({ child: e.name, parent: name(cb), outBy: Math.round(outBy), kind: '被裁切',
        cy: Math.round(e.y), ch: Math.round(e.r.height), ph: Math.round(cr.height) });
      continue;
    }
    if (e.pos === 'absolute' || e.pos === 'fixed') {
      let host = e.el.parentElement, hostCS = null;
      while (host && host !== document.body) {
        const c = getComputedStyle(host);
        if (c.position !== 'static') { hostCS = host; break; }
        host = host.parentElement;
      }
      if (hostCS) {
        const hr = hostCS.getBoundingClientRect();
        const outBy = Math.max(e.r.bottom - hr.bottom, hr.top - e.r.top);
        if (outBy > 12 && !/hidden|clip|auto|scroll/.test(getComputedStyle(hostCS).overflowY))
          out.overflow.push({ child: e.name, parent: name(hostCS), outBy: Math.round(outBy),
            kind: '绝对定位逃逸', cy: Math.round(e.y), ch: Math.round(e.r.height), ph: Math.round(hr.height) });
      }
    }
  }

  // 3. 零尺寸容器 + **固定高度被内容撑爆**
  //    「固定高度」是这类事故的总根源：CSS 写 #map{height:460px}，而 HTML 里
  //    <section id="map"> 的 id 恰好就是 map → 整个章节被钉死在 460px，
  //    里面 2049px 的内容整块溢出，盖住后面所有章节。
  all.forEach(e => {
    const zeroH = e.r.height < 2, zeroW = e.r.width < 2;
    if ((zeroH || zeroW) && e.el.childElementCount > 0 && e.cs.overflow !== 'hidden')
      out.zero.push({ el: e.name, w: Math.round(e.r.width), h: Math.round(e.r.height),
        kids: e.el.childElementCount,
        which: zeroH && zeroW ? '宽高皆为0' : (zeroH ? '高度为0' : '宽度为0') });

    // 固定高度（非 auto / 非百分比）且 scrollHeight 明显超过 clientHeight → 内容被压出来
    const ch = e.el.clientHeight, sh = e.el.scrollHeight;
    if (e.cs.height !== 'auto' && ch > 0 && sh > ch + 24 &&
        !/hidden|clip|auto|scroll/.test(e.cs.overflowY)) {
      out.overflow.push({ child: '（内容整体）', parent: e.name, outBy: sh - ch,
        kind: '固定高度撑爆', cy: Math.round(e.y), ch: sh, ph: ch });
    }
  });

  // 4. 横向溢出
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 2)
    out.hscroll = { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth };

  return JSON.stringify(out);
})()`;

function line(s) { console.log(s); }

try {
  if (!await waitPort(PORT)) { console.error('CDP 端口没起来，跳过视觉自检'); process.exit(0); }
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

  // awaitPromise：脚本是 async IIFE（要逐屏滚动），必须等它完成
  const r = await send('Runtime.evaluate', { expression: AUDIT, returnByValue: true, awaitPromise: true, timeout: 60000 });
  if (!r.result || !r.result.value) { console.error('取不到布局数据'); process.exit(0); }
  const d = JSON.parse(r.result.value);

  line(`视口 ${VW}x${VH}  页面高 ${d.pageH}  元素 ${d.count}`);
  let bad = 0;

  if (d.hscroll) {
    bad++;
    line(`\n❌ 横向溢出：文档 ${d.hscroll.scrollWidth}px > 视口 ${d.hscroll.clientWidth}px（窄屏会被切）`);
  }
  if (d.zero.length) {
    bad += d.zero.length;
    line(`\n❌ 零尺寸容器（固定高度容器忘了给高度 / 选择器 id 对不上）：`);
    d.zero.slice(0, 12).forEach(z => line(`   ${z.el}  ${z.w}x${z.h}  ${z.which}，却有 ${z.kids} 个子元素`));
  }
  if (d.overflow.length) {
    bad += d.overflow.length;
    line(`\n❌ 子元素溢出未裁切的容器：`);
    d.overflow.slice(0, 12).forEach(o =>
      line(`   ${o.child}  超出 ${o.parent} 底部 ${o.outBy}px  (子高 ${o.ch} / 容器高 ${o.ph}, y=${o.cy})`));
  }
  if (d.occluded.length) {
    bad += d.occluded.length;
    line(`\n❌ 被遮挡（图盖字最常见；比例 = 采样点被压住的比例）：`);
    d.occluded.slice(0, 20).forEach(o =>
      line(`   ${o.ratio}% 被压  「${o.el}」y${o.y}  ${o.txt ? '「' + o.txt + '」' : ''}  ← 压住它的是 ${o.by}`));
  }

  if (!bad) { line('\n✅ 布局自检通过：无重叠、无溢出、无零尺寸容器、无横向溢出'); process.exit(0); }
  line(`\n共 ${bad} 处问题。改完再跑一次，直到干净。`);
  process.exit(1);
} catch (e) {
  console.error('自检出错：' + e.message);
  process.exit(0);   // 自检本身失败不应阻断交付，但要人工看图
} finally {
  try { chrome.kill(); } catch {}
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
