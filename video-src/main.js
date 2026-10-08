// ===== core =====
const TL = window.TLD, stage = document.getElementById('stage');
const tl = gsap.timeline({paused: true});
const dyn = [];            // per-frame functions f(t)
window.CUES = [];          // sfx cues for the mixer
const sfx = (name, t, gain = 1) => window.CUES.push({name, t: +t.toFixed(3), gain});
const L = id => TL.lines[id];
const S = name => TL.scenes.find(s => s.name === name);
function W(id, text, occ = 0) {           // absolute start time of the word containing `text`
  const l = L(id); let s = '', idx = [];
  l.words.forEach((w, i) => { for (const ch of w.w) { s += ch; idx.push(i); } });
  let p = -1; for (let k = 0; k <= occ; k++) { p = s.indexOf(text, p + 1); if (p < 0) break; }
  if (p < 0) { console.warn('W miss', id, text); return l.start; }
  return l.words[idx[p]].s;
}
function WE(id, text) {                   // end time of the word containing the last char of `text`
  const l = L(id); let s = '', idx = [];
  l.words.forEach((w, i) => { for (const ch of w.w) { s += ch; idx.push(i); } });
  const p = s.indexOf(text); if (p < 0) { console.warn('WE miss', id, text); return l.speech_end; }
  return l.words[idx[p + text.length - 1]].e;
}
const chunk = (id, k) => L(id).subs[k].s;
function h(tag, attrs = {}, html = '') {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k === 'parent') continue;
    else e.setAttribute(k, v);
  }
  if (html) e.innerHTML = html;
  (attrs.parent || stage).appendChild(e);
  return e;
}
const icon = (name, size = 40, color = 'currentColor', sw = 2.4) =>
  `<span class="ic" style="width:${size}px;height:${size}px;color:${color}">${(ICONS[name] || '').replace('stroke-width="2"', `stroke-width="${sw}"`)}</span>`;
const px = v => typeof v === 'number' ? v + 'px' : v;
function box(parent, cls, x, y, w, hgt, html = '', style = {}) {
  return h('div', {parent, class: cls, style: {position: 'absolute', left: px(x), top: px(y), width: w == null ? 'auto' : px(w), height: hgt == null ? 'auto' : px(hgt), ...style}}, html);
}
// tween helpers (immediateRender:false so later tweens never clobber earlier state)
function to(el, t, from, toV, dur = 0.5, ease = 'power3.out') { tl.fromTo(el, from, {...toV, duration: dur, ease, immediateRender: false}, t); }
function popIn(el, t, o = {}) {
  const from = o.from || {scale: 0.2, opacity: 0, rotation: o.rot0 || 0};
  to(el, t, from, {scale: 1, opacity: 1, rotation: o.rot || 0, x: 0, y: 0}, o.dur || 0.55, o.ease || 'back.out(1.9)');
  if (o.sfx !== null) sfx(o.sfx || 'pop', t, o.gain ?? 0.55);
}
function slideIn(el, t, dx = 0, dy = 60, o = {}) {
  to(el, t, {x: dx, y: dy, opacity: 0}, {x: 0, y: 0, opacity: 1}, o.dur || 0.6, o.ease || 'power3.out');
  if (o.sfx) sfx(o.sfx, t, o.gain ?? 0.5);
}
function out(el, t, o = {}) { to(el, t, {opacity: 1, scale: 1}, {opacity: 0, scale: o.scale ?? 0.9, x: o.x || 0, y: o.y || 0}, o.dur || 0.35, 'power2.in'); }
function bob(el, t0, t1, amp = 12, per = 1.25) {
  const n = Math.max(1, Math.floor((t1 - t0) / per));
  tl.fromTo(el, {y: 0}, {y: -amp, duration: per, ease: 'sine.inOut', yoyo: true, repeat: n, immediateRender: false}, t0);
}
function kenburns(el, sc, s0 = 1.04, s1 = 1.14, x0 = 0, x1 = 0) {
  tl.fromTo(el, {scale: s0, x: x0}, {scale: s1, x: x1, duration: sc.end - Math.max(0, sc.start - 0.6) + 0.6, ease: 'none', immediateRender: false}, Math.max(0, sc.start - 0.6));
}
function charIn(sc, src, x, y, hgt, t, o = {}) {      // character with wrapper (entrance) + inner (bob)
  const w = hgt * 2 / 3;
  const wrap = box(sc.el, 'cw', x, y, w, hgt, `<img src="img/${src}.png">`, {opacity: 0, zIndex: o.z || 5});
  const inner = wrap.firstChild;
  if (o.flip) inner.style.transform = 'scaleX(-1)';
  to(wrap, t, {scale: 0.5, opacity: 0, y: 60}, {scale: 1, opacity: 1, y: 0}, 0.6, 'back.out(1.6)');
  if (o.sfx !== null) sfx(o.sfx || 'swish', t, o.gain ?? 0.45);
  const tEnd = o.until ?? sc.end;
  bob(wrap.firstChild, t + 0.6, tEnd, o.amp ?? 10, o.per ?? 1.3);
  return wrap;
}
function swapChar(a, b, t) {   // b is created hidden at same place
  to(a, t, {opacity: 1, scale: 1}, {opacity: 0, scale: 0.85}, 0.18, 'power2.in');
  to(b, t + 0.1, {opacity: 0, scale: 0.7, y: 20}, {opacity: 1, scale: 1, y: 0}, 0.5, 'back.out(2)');
}
function typeText(el, text, t0, t1, keys = true) {
  const chars = [...text];
  dyn.push(t => { const n = t < t0 ? 0 : t >= t1 ? chars.length : Math.floor((t - t0) / (t1 - t0) * chars.length); el.textContent = chars.slice(0, n).join(''); });
  if (keys) { let last = -1; chars.forEach((c, i) => { const t = t0 + (i / chars.length) * (t1 - t0); if (c !== ' ' && t - last > 0.075) { sfx('key' + (i % 4), t, 0.32); last = t; } }); }
}
function counter(el, v0, v1, t0, dur, fmt = v => Math.round(v).toLocaleString('en-US')) {
  dyn.push(t => { const k = Math.min(1, Math.max(0, (t - t0) / dur)); const e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(v0 + (v1 - v0) * e); });
}
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

// ===== scenes =====
const scenes = {};
for (const sc of TL.scenes) {
  sc.el = h('section', {class: 'scene', id: 's-' + sc.name});
  if (sc.start === 0) sc.el.style.visibility = 'visible';
  scenes[sc.name] = sc;
  tl.set(sc.el, {visibility: 'visible'}, Math.max(0, sc.start));
  tl.set(sc.el, {visibility: 'hidden'}, sc.end);
}
function bgImg(sc, src, o = {}) {
  const e = h('img', {parent: sc.el, class: 'bg', src: 'img/' + src + '.jpg'});
  if (o.filter) e.style.filter = o.filter;
  kenburns(e, sc, o.s0 ?? 1.03, o.s1 ?? 1.12, o.x0 || 0, o.x1 || 0);
  return e;
}
const shade = (sc, bg) => h('div', {parent: sc.el, class: 'fill', style: {background: bg}});

// ---------- 1. HOOK (fast montage) ----------
{
  const sc = scenes.hook;
  h('div', {parent: sc.el, class: 'fill', style: {background: 'radial-gradient(circle at 70% 30%, #33449C 0%, #1E2A78 40%, #0E1438 100%)'}});
  const grid = box(sc.el, 'fill', 0, 0, 1920, 1200, '', {background: 'linear-gradient(rgba(123,147,255,.10) 2px, transparent 2px) 0 0/80px 80px, linear-gradient(90deg, rgba(123,147,255,.10) 2px, transparent 2px) 0 0/80px 80px'});
  tl.fromTo(grid, {y: -80}, {y: 0, duration: 0.8, ease: 'none', repeat: Math.ceil((sc.end - sc.start) / 0.8), immediateRender: false}, 0);
  const streaks = box(sc.el, 'fill', 0, 0, 1920, 1080, `<svg width="3840" height="1080">${Array.from({length: 26}, () => { const y = rnd() * 1080, x = rnd() * 3840, w = 120 + rnd() * 380; return `<rect x="${x}" y="${y}" width="${w}" height="${2 + rnd() * 3}" rx="2" fill="rgba(255,255,255,${0.06 + rnd() * 0.12})"/>`; }).join('')}</svg>`);
  tl.fromTo(streaks.firstChild, {x: 0}, {x: -1920, duration: 1.6, ease: 'none', repeat: Math.ceil((sc.end - sc.start) / 1.6), immediateRender: false}, 0);
  const flash = box(sc.el, 'fill', 0, 0, 1920, 1080, '', {background: '#fff', opacity: 0, zIndex: 30});
  const flashAt = t => { to(flash, t, {opacity: 0.85}, {opacity: 0}, 0.28, 'power2.out'); sfx('swish', t - 0.05, 0.5); };
  // request bar
  const req = box(sc.el, 'abs', 960, 470, null, null, `<div class="row" style="gap:18px;background:#fff;border:6px solid #4D6BFE;border-radius:999px;padding:22px 26px 22px 40px;box-shadow:0 0 0 10px rgba(77,107,254,.25)">${icon('message-circle', 52, '#4D6BFE')}<span data-ty style="font-weight:900;font-size:50px;color:#1B2240;white-space:nowrap"></span><span style="width:84px;height:84px;border-radius:50%;background:#4D6BFE;display:flex;align-items:center;justify-content:center;margin-left:14px">${icon('navigation', 44, '#fff', 2.8)}</span></div>`, {zIndex: 20, opacity: 0});
  gsap.set(req, {xPercent: -50, yPercent: -50});
  popIn(req, 0.08, {from: {scale: 0.6, opacity: 0}, sfx: 'pop2'});
  typeText(req.querySelector('[data-ty]'), '国庆从上海去成都玩 3 天，2 个人，预算 6000', 0.3, 1.25);
  const tSend = 1.38;
  sfx('whoosh', tSend, 0.6);
  to(req, tSend, {y: 0, scale: 1}, {y: -425, scale: 0.55}, 0.45, 'power3.inOut');
  const L1 = L('l01'), L2 = L('l02'), L3 = L('l03'), L4 = L('l04'), L5 = L('l05');
  // beat 1: price race
  const fl = [['春秋 9C8819', '07:50→10:55', '3h05m', 579, 1], ['吉祥 HO1039', '07:20→12:10', '4h50m', 491], ['南航 CZ5151', '07:25→10:30', '3h05m', 660], ['国航 CA8541', '07:35→10:40', '3h05m', 700], ['春秋 9C7685', '09:20→12:25', '3h05m', 720]];
  const tr = [['G237', '09:04→19:35', '10h31m', 1074], ['G1974', '07:16→18:26', '11h10m', 1040], ['G3390', '07:04→19:01', '11h57m', 999], ['G3292', '08:24→20:33', '12h09m', 975], ['G3288', '07:46→19:55', '12h09m', 1003], ['G3284', '10:37→23:17', '12h40m', 935]];
  const mkPanel = (x, title, ic, col, rows) => {
    const pnl = box(sc.el, 'card', x, 200, 800, 560, `<div class="row" style="gap:14px;padding:22px 30px;background:${col};color:#fff;border-radius:24px 24px 0 0;font-family:KL;font-size:44px">${icon(ic, 46, '#fff')}${title}</div><div data-rows style="position:relative;padding:8px 22px"></div>`, {opacity: 0, overflow: 'hidden'});
    const rs = pnl.querySelector('[data-rows]');
    const rEls = rows.map(([a, b, c, p]) => h('div', {parent: rs, class: 'row', style: {gap: '16px', padding: '14px 12px', borderBottom: '3px dashed #E1E5F4', fontWeight: 800, fontSize: '30px', color: '#1B2240', opacity: 0, borderRadius: '14px'}}, `<span style="width:200px">${a}</span><span class="mono" style="width:220px;font-size:26px;color:#59607E">${b}</span><span class="mono" style="width:120px;font-size:26px;color:#59607E">${c}</span><span class="hy" data-p style="margin-left:auto;font-size:44px;color:${col}">¥0</span>`));
    return [pnl, rEls];
  };
  const [pF, rF] = mkPanel(130, '航班 · 上海 → 成都 · 10/16', 'plane', '#4D6BFE', fl);
  const [pT, rT] = mkPanel(990, '高铁 · 二等座', 'train-front', '#FF6B5A', tr);
  const b1 = L1.start - 0.05;
  to(pF, b1, {x: -200, opacity: 0}, {x: 0, opacity: 1}, 0.35, 'power3.out'); to(pT, b1 + 0.08, {x: 200, opacity: 0}, {x: 0, opacity: 1}, 0.35, 'power3.out');
  [...rF.map((e, i) => [e, fl[i][3], b1 + 0.25 + i * 0.11]), ...rT.map((e, i) => [e, tr[i][3], b1 + 0.3 + i * 0.1])].forEach(([e, p, t], k) => {
    slideIn(e, t, 40, 0, {dur: 0.22}); counter(e.querySelector('[data-p]'), 0, p, t, 0.45, v => '¥' + Math.round(v)); if (k % 2 === 0) sfx('tick', t, 0.45);
  });
  const best = rF[0], tBest = Math.max(b1 + 1.3, W('l01', '比价') - 0.1);
  to(best, tBest, {backgroundColor: 'rgba(33,185,138,0)', scale: 1}, {backgroundColor: 'rgba(33,185,138,.18)', scale: 1.04}, 0.25, 'back.out(3)');
  const bb = box(sc.el, 'tag', 150, 782, null, null, icon('badge-check', 40, '#fff') + '最优：直飞 · 省 7 小时', {background: '#21B98A', color: '#fff', border: '5px solid #1E2A78', fontSize: '40px', padding: '10px 28px', opacity: 0, zIndex: 5});
  popIn(bb, tBest + 0.05, {sfx: 'ding', gain: 0.45});
  to(pT, tBest, {opacity: 1}, {opacity: 0.55}, 0.3);
  flashAt(L2.start - 0.08);
  [pF, pT, bb].forEach(e => tl.set(e, {opacity: 0}, L2.start - 0.05));
  // beat 2: hotels
  const hs = [['省钱档', '#7A9A3A', '安逸·锦著', 184, 'hotel0'], ['舒适档', '#21915F', '美豪 · 含双早', 231, 'hotel1'], ['品质档', '#A33A2E', '亚朵 X', 354, 'hotel2']];
  const hEls = hs.map(([tier, col, name, price, img], i) => {
    const c = box(sc.el, 'card', 150 + i * 560, 210, 500, 600, `<div style="height:330px;overflow:hidden;border-radius:24px 24px 0 0;position:relative"><img src="img/${img}.jpg" style="width:100%;height:100%;object-fit:cover"><div data-fl style="position:absolute;inset:0;background:#fff;opacity:0"></div><div data-real class="tag" style="left:16px;bottom:16px;background:rgba(20,30,90,.85);color:#fff;font-size:24px;padding:4px 14px;opacity:0">${icon('search', 24, '#fff')}房型实拍</div></div><div style="padding:22px 28px"><span class="tag" style="position:static;background:${col};color:#fff;font-size:26px;padding:4px 16px">${tier}</span><div style="font-weight:900;font-size:40px;margin-top:12px;color:#1B2240">${name}</div><div class="row" style="align-items:baseline;gap:8px"><span class="hy" data-p style="font-size:104px;color:${col}">¥0</span><span style="font-weight:800;font-size:30px;color:#59607E">/ 晚</span></div></div>`, {opacity: 0, overflow: 'hidden', transformPerspective: 1200});
    const t = L2.start + 0.05 + i * 0.16;
    to(c, t, {rotationY: 90, opacity: 0, scale: 0.9}, {rotationY: 0, opacity: 1, scale: 1}, 0.4, 'back.out(1.6)'); sfx('pop', t, 0.5);
    counter(c.querySelector('[data-p]'), 0, price, t + 0.15, 0.5, v => '¥' + Math.round(v));
    const tf = W('l02', '实拍') + i * 0.12;
    to(c.querySelector('[data-fl]'), tf, {opacity: 0.9}, {opacity: 0}, 0.35); popIn(c.querySelector('[data-real]'), tf + 0.05, {sfx: 'tick', gain: 0.5});
    return c;
  });
  flashAt(L3.start - 0.08);
  hEls.forEach(e => tl.set(e, {opacity: 0}, L3.start - 0.05));
  // beat 3: route drawing
  const mp = box(sc.el, 'card', 160, 130, 1600, 740, `<img src="img/sec_map.png" style="position:absolute;left:0;top:-200px;width:1600px;opacity:.28;filter:saturate(.6)"><svg data-svg width="1590" height="750" viewBox="0 0 1590 750" style="position:absolute;left:0;top:0"></svg>`, {opacity: 0, overflow: 'hidden', background: '#F7F5F0'});
  const svg = mp.querySelector('[data-svg]');
  const P = {air: [1360, 600], south: [690, 470], sq: [670, 230], cx: [900, 215]};
  const seg = [['18', '#00A6A0', [P.air, [1180, 560], [930, 520], P.south], W('l03', '地铁')], ['1', '#2F62B5', [P.south, [685, 360], P.sq], W('l03', '换乘')], ['2', '#F08A00', [P.sq, [790, 222], P.cx], W('l03', '几分钟') - 0.15]];
  let svgHtml = '';
  seg.forEach(([n, c, pts], i) => { const d = 'M' + pts.map(p => p.join(' ')).join(' L'); svgHtml += `<path d="${d}" stroke="rgba(30,42,120,.15)" stroke-width="30" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path data-seg="${i}" d="${d}" stroke="${c}" stroke-width="18" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`; });
  svg.innerHTML = svgHtml;
  const lens = [];
  seg.forEach(([n, c, pts, t], i) => {
    const pathEl = svg.querySelector(`[data-seg="${i}"]`); let len = 0; for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); lens.push(len);
    pathEl.setAttribute('stroke-dasharray', `${len} ${len}`);
    const dur = i === 0 ? 1.0 : 0.55;
    dyn.push(tt => { const k = Math.min(1, Math.max(0, (tt - t) / dur)); const e = 1 - Math.pow(1 - k, 2); pathEl.setAttribute('stroke-dashoffset', String(len * (1 - e))); });
    sfx('swish', t, 0.35);
    const mid = pts[Math.floor(pts.length / 2)];
    const chip = box(mp, 'tag', mid[0] + (i === 2 ? -30 : 26), mid[1] + (i === 0 ? 22 : i === 2 ? -78 : -20), null, null, `<b style="background:${c};color:#fff;border-radius:8px;padding:0 10px">${n}</b> 号线`, {background: '#fff', color: '#1B2240', border: '4px solid #1E2A78', fontSize: '28px', opacity: 0});
    popIn(chip, t + dur * 0.6, {sfx: null});
  });
  const stn = [[P.air, '天府机场 T2', 0, 1, 26], [P.south, '火车南站', 1, -1, 26], [P.sq, '天府广场', 2, -1, -60], [P.cx, '春熙路（酒店）', 2.0, 1, -66]];
  stn.forEach(([p, name, si, dir, dy]) => {
    const t = si === 0 ? seg[0][3] - 0.1 : (si === 2.0 && name.startsWith('春') ? seg[2][3] + 0.5 : seg[si][3] - 0.05);
    const dot = box(mp, 'abs', p[0] - 20, p[1] - 20, 40, 40, '', {background: '#fff', border: '8px solid #1E2A78', borderRadius: '50%', opacity: 0, zIndex: 3});
    popIn(dot, t, {sfx: 'pop2', gain: 0.4});
    const lb = box(mp, 'abs', p[0] + (dir > 0 ? 30 : -30), p[1] + dy, null, null, name, {fontWeight: 900, fontSize: '34px', color: '#1B2240', whiteSpace: 'nowrap', opacity: 0, background: 'rgba(255,255,255,.85)', padding: '2px 12px', borderRadius: '10px'});
    if (dir < 0) gsap.set(lb, {xPercent: -100});
    popIn(lb, t + 0.05, {sfx: null});
  });
  const sum = box(mp, 'card', 60, 560, 500, 150, `<div class="row" style="justify-content:space-around;padding:22px 10px;color:#1E2A78"><div style="text-align:center"><div class="hy" style="font-size:60px" data-m>0</div><div style="font-size:22px;font-weight:800;color:#59607E">分钟</div></div><div style="text-align:center"><div class="hy" style="font-size:60px">73.3</div><div style="font-size:22px;font-weight:800;color:#59607E">公里</div></div><div style="text-align:center"><div class="hy" style="font-size:60px;color:#E8453C" data-y>¥0</div><div style="font-size:22px;font-weight:800;color:#59607E">票价</div></div></div>`, {opacity: 0, background: '#FFF8EC'});
  popIn(sum, W('l03', '几分钟'), {sfx: 'pop'}); counter(sum.querySelector('[data-m]'), 0, 84, W('l03', '几分钟'), 0.6); counter(sum.querySelector('[data-y]'), 0, 11, W('l03', '几块'), 0.4, v => '¥' + Math.round(v)); sfx('coin', W('l03', '几块') + 0.3, 0.35);
  const train = box(mp, 'abs', 0, 0, 56, 56, `<div style="width:56px;height:56px;border-radius:50%;background:#FFC94A;border:5px solid #1E2A78;display:flex;align-items:center;justify-content:center">${icon('train-front', 30, '#1E2A78', 2.6)}</div>`, {opacity: 0, zIndex: 4});
  const allPts = [...seg[0][2], ...seg[1][2].slice(1), ...seg[2][2].slice(1)];
  const segLen = []; let totL = 0; for (let k = 1; k < allPts.length; k++) { const d = Math.hypot(allPts[k][0] - allPts[k - 1][0], allPts[k][1] - allPts[k - 1][1]); segLen.push(d); totL += d; }
  const tTr0 = seg[0][3], tTr1 = seg[2][3] + 0.6;
  dyn.push(tt => { if (tt < tTr0 || tt > L3.speech_end + 0.5) { train.style.opacity = 0; return; } train.style.opacity = 1; const k = Math.min(1, (tt - tTr0) / (tTr1 - tTr0)); let d = totL * (1 - Math.pow(1 - k, 1.6)); let i = 0; while (i < segLen.length - 1 && d > segLen[i]) { d -= segLen[i]; i++; } const f = Math.min(1, d / segLen[i]); const x = allPts[i][0] + (allPts[i + 1][0] - allPts[i][0]) * f, y = allPts[i][1] + (allPts[i + 1][1] - allPts[i][1]) * f; train.style.transform = `translate(${x - 28}px, ${y - 28}px)`; });
  to(mp, L3.start - 0.05, {scale: 0.92, opacity: 0}, {scale: 1, opacity: 1}, 0.35, 'power3.out');
  const glow = W('l03', '画出来');
  seg.forEach((s, i) => { const pe = svg.querySelector(`[data-seg="${i}"]`); to(pe, glow + i * 0.08, {attr: {'stroke-width': 18}}, {attr: {'stroke-width': 28}}, 0.2, 'power2.out'); to(pe, glow + 0.2 + i * 0.08, {attr: {'stroke-width': 28}}, {attr: {'stroke-width': 18}}, 0.3, 'power2.in'); });
  sfx('chime', glow, 0.35);
  flashAt(L4.start - 0.08);
  tl.set(mp, {opacity: 0}, L4.start - 0.05);
  // beat 4: checks
  const ck = [['闭馆日', 'calendar', '闭馆'], ['预约放票', 'ticket', '放票'], ['末班车', 'train-front', '末班'], ['天气', 'cloud-rain', '天气']];
  const cEls = ck.map(([n, ic, wd], i) => {
    const c = box(sc.el, 'card', 330 + (i % 2) * 650, 190 + Math.floor(i / 2) * 330, 600, 280, `<div class="row" style="gap:30px;padding:46px 46px"><div style="width:140px;height:140px;border-radius:36px;background:#4D6BFE;border:5px solid #1E2A78;display:flex;align-items:center;justify-content:center">${icon(ic, 80, '#fff')}</div><div style="font-weight:900;font-size:62px;color:#1B2240">${n}</div></div><div data-ok style="position:absolute;right:30px;top:-30px;width:120px;height:120px;border-radius:50%;background:#21B98A;border:6px solid #1E2A78;display:flex;align-items:center;justify-content:center;opacity:0">${icon('check', 80, '#fff', 4)}</div>`, {opacity: 0});
    const t = W('l04', wd);
    popIn(c, t - 0.12, {from: {scale: 0.5, opacity: 0}, sfx: null, dur: 0.35});
    popIn(c.querySelector('[data-ok]'), t + 0.12, {from: {scale: 2.2, opacity: 0, rotation: -30}, ease: 'back.out(3)', dur: 0.3, sfx: 'stamp', gain: 0.45});
    return c;
  });
  const tAll = W('l04', '核对');
  cEls.forEach((c, i) => to(c, tAll + i * 0.05, {scale: 1}, {scale: 1.05}, 0.15, 'power2.out'));
  flashAt(L5.start - 0.08);
  cEls.forEach(e => tl.set(e, {opacity: 0}, L5.start - 0.05));
  // beat 5: roadbook reveal
  const lap = box(sc.el, 'laptop', 110, 170, 1040, 720, `<div style="position:absolute;left:0;top:0;width:1040px;height:640px;background:#1B2240;border-radius:30px;border:5px solid #0E1438"></div><div class="scr" style="left:26px;top:26px;width:988px;height:588px;border-radius:10px"><img src="img/desk_full.jpg" data-li></div><div style="position:absolute;left:-60px;top:640px;width:1160px;height:40px;background:linear-gradient(#D9DEEF,#AEB6D2);border-radius:0 0 36px 36px;border:4px solid #1E2A78"></div>`, {opacity: 0, zIndex: 4});
  to(lap, L5.start - 0.02, {scale: 1.4, opacity: 0, y: 40}, {scale: 1, opacity: 1, y: 0}, 0.4, 'power4.out'); sfx('stamp', L5.start + 0.3, 0.5);
  tl.fromTo(lap.querySelector('[data-li]'), {y: 0}, {y: -1400, duration: 2.6, ease: 'power1.inOut', immediateRender: false}, L5.start + 0.3);
  const ph = charIn(sc, 'p_phone', 1240, 300, 760, L5.start + 0.15, {z: 6, sfx: null, until: sc.end});
  const done = box(sc.el, 'hy wstroke', 1160, 34, null, null, '路书生成！', {fontSize: '120px', color: '#FFC94A', textShadow: '10px 10px 0 #4D6BFE', opacity: 0, zIndex: 8, whiteSpace: 'nowrap'});
  popIn(done, W('l05', '路书'), {rot0: -20, rot: -6, sfx: 'sparkle', gain: 0.6});
  to(req, L5.start, {opacity: 1}, {opacity: 0}, 0.2);
  // 最下面：DeepSeek 边看地图边沿路线走，每到一个里程碑就点亮一个——暗示她在后台一步步干活
  const trackY = 1044, mx = [330, 670, 1010, 1350, 1690];
  const ms = [['plane', '比价', tBest], ['hotel', '酒店', W('l02', '实拍')], ['route', '路线', glow], ['list-checks', '核对', tAll], ['book-open', '路书', L5.start - 0.12]];
  const strip = box(sc.el, 'abs', 0, 0, 1920, 1080, `<svg width="1920" height="1080" style="position:absolute;left:0;top:0"><line x1="70" y1="${trackY}" x2="1850" y2="${trackY}" stroke="rgba(255,255,255,.3)" stroke-width="5" stroke-dasharray="3 15" stroke-linecap="round"/><line data-prog x1="70" y1="${trackY}" x2="70" y2="${trackY}" stroke="#FFC94A" stroke-width="6" stroke-linecap="round"/></svg>`, {zIndex: 40, opacity: 0});
  const prog = strip.querySelector('[data-prog]');
  ms.forEach(([ic, name, t], i) => {
    const nd = box(strip, 'abs', mx[i] - 25, trackY - 25, 50, 50, icon(ic, 26, 'rgba(255,255,255,.75)', 2.6), {borderRadius: '50%', background: '#1E2A78', border: '4px solid rgba(255,255,255,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center'});
    const on = box(strip, 'abs', mx[i] - 25, trackY - 25, 50, 50, icon(ic, 26, '#1E2A78', 2.8), {borderRadius: '50%', background: '#FFC94A', border: '4px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, boxShadow: '0 0 18px rgba(255,201,74,.8)'});
    const lb = box(strip, 'abs', mx[i] + 30, trackY - 18, null, null, name, {fontWeight: 900, fontSize: '24px', lineHeight: '36px', padding: '0 10px', borderRadius: '10px', background: '#131B52', color: '#fff', opacity: 0.5, whiteSpace: 'nowrap'});
    popIn(on, t, {from: {scale: 0.3, opacity: 0}, ease: 'back.out(3)', dur: 0.35, sfx: 'pop2', gain: 0.22});
    to(lb, t, {opacity: 0.5, color: '#fff'}, {opacity: 1, color: '#FFC94A'}, 0.25);
  });
  const wk = box(strip, 'abs', 0, trackY + 8 - 110, 81, 110, [0, 1, 2, 3].map(k => `<img src="img/walk${k}.png" style="position:absolute;left:0;top:0;width:81px;height:110px;opacity:${k === 1 ? 1 : 0}">`).join(''), {zIndex: 2, filter: 'drop-shadow(0 0 2px #fff) drop-shadow(0 0 7px rgba(255,255,255,.55))'});
  const wImgs = [...wk.children], key = [[0.3, 90], ...ms.map(([, , t], i) => [t, mx[i]])];
  const posAt = t => { if (t <= key[0][0]) return key[0][1]; for (let k = 1; k < key.length; k++) if (t <= key[k][0]) { const [t0, x0] = key[k - 1], [t1, x1] = key[k]; return x0 + (x1 - x0) * (t - t0) / (t1 - t0); } return key[key.length - 1][1]; };
  dyn.push(t => {
    const x = posAt(t), moving = t > key[0][0] && t < key[key.length - 1][0];
    const f = moving ? Math.floor((x - key[0][1]) / 24) % 4 : 1;
    wImgs.forEach((im, k) => { im.style.opacity = k === f ? 1 : 0; });
    let hop = 0; for (const [, , tn] of ms) { const d = t - tn; if (d > 0 && d < 0.32) hop += Math.sin(Math.PI * d / 0.32) * 16; }
    wk.style.transform = `translate(${x - 40}px, ${-(f % 2 ? 3 : 0) - hop}px)`;
    prog.setAttribute('x2', String(Math.max(70, x)));
  });
  to(strip, 0.2, {opacity: 0}, {opacity: 1}, 0.4, 'power2.out');
  to(strip, L5.start + 0.35, {opacity: 1}, {opacity: 0}, 0.35, 'power2.in');
}

// ---------- 2. INTRO ----------
{
  const sc = scenes.intro;
  bgImg(sc, 'kv', {s0: 1.06, s1: 1.11, x0: 90, x1: 60});
  shade(sc, 'linear-gradient(90deg, rgba(255,255,255,.66) 0%, rgba(255,255,255,.38) 38%, rgba(255,255,255,0) 60%)');
  const blk = box(sc.el, 'col', 120, 150, 1000, null, '', {transformOrigin: '0 0', gap: '6px'});
  const chip = h('div', {parent: blk, class: 'chip', style: {alignSelf: 'flex-start', opacity: 0}}, icon('sparkles', 30, '#fff') + 'DeepSeek Harness · DSH Agent');
  const t1 = h('div', {parent: blk, class: 'hy wstroke', style: {fontSize: '190px', lineHeight: '1.05', color: '#4D6BFE', textShadow: '12px 12px 0 #1E2A78', marginTop: '20px', opacity: 0, alignSelf: 'flex-start', transformOrigin: '10% 70%'}}, 'TravelPlanner');
  const t2 = h('div', {parent: blk, class: 'kl', style: {fontSize: '110px', lineHeight: '1.2', color: '#1E2A78', marginTop: '8px'}});
  [...'旅行规划助手'].forEach(c => h('span', {parent: t2, class: 'wstroke', style: {display: 'inline-block', opacity: 0}}, c));
  popIn(chip, sc.start + 0.35, {sfx: 'pop2'});
  popIn(t1, W('l06', '嗨'), {rot0: -10, rot: -2, sfx: 'stamp', gain: 0.55, dur: 0.6});
  const bub = box(sc.el, 'bubble', 1060, 150, null, null, '我是 DeepSeek！', {background: '#fff', border: '5px solid #1E2A78', fontFamily: 'KL', fontSize: '52px', color: '#4D6BFE', opacity: 0, whiteSpace: 'nowrap', boxShadow: '7px 7px 0 #1E2A78', zIndex: 5});
  popIn(bub, W('l06', '我是'), {sfx: 'pop', from: {scale: 0.3, opacity: 0, rotation: 8}, rot: -3});
  const tA = W('l06', '旅行规划');
  [...t2.children].forEach((c, i) => popIn(c, tA + i * 0.07, {sfx: i ? null : 'sparkle', gain: 0.45, from: {y: 50, scale: 0.4, opacity: 0}}));
  out(bub, L('l07').start - 0.1);
  const tS = L('l07').start;
  to(blk, tS, {scale: 1, y: 0}, {scale: 0.66, y: -40}, 0.6, 'power3.inOut');
  const flow = box(sc.el, 'abs', 120, 575, 980, 300);
  const nodes = [
    {x: 0, w: 300, html: `<div style="font-family:KL;font-size:38px;color:#4D6BFE">${icon('message-circle', 40, '#4D6BFE')} 你说一句</div><div style="font-size:26px;line-height:1.5;margin-top:10px;color:#333">“国庆从上海去成都玩 3 天，2 个人，预算 6000”</div>`, t: W('l07', '你只管')},
    {x: 360, w: 230, html: `<div style="font-family:KL;font-size:38px;color:#4D6BFE">${icon('search', 40, '#4D6BFE')} 我去查</div><div style="font-size:26px;line-height:1.55;margin-top:10px;color:#333">车票 · 机票<br>酒店 · 路线<br>天气 · 闭馆</div>`, t: W('l07', '剩下')},
    {x: 650, w: 330, html: `<div style="font-family:KL;font-size:38px;color:#4D6BFE">${icon('file-code-2', 40, '#4D6BFE')} 一份路书</div><div style="margin-top:12px;border-radius:12px;overflow:hidden;border:3px solid #e5e2da;height:170px"><img src="img/desk_header.png" style="width:100%;display:block"></div>`, t: W('l07', '我来查')}];
  nodes.forEach((n, i) => {
    const c = box(flow, 'card', n.x, 0, n.w, 290, n.html, {padding: '22px 24px', opacity: 0});
    popIn(c, n.t);
    if (i < 2) { const ar = box(flow, 'abs', n.x + n.w + 8, 117, 46, 56, '<svg viewBox="0 0 46 56" width="46" height="56"><path d="M4 18 H24 V6 L42 28 L24 50 V38 H4 Z" fill="#4D6BFE" stroke="#1E2A78" stroke-width="4" stroke-linejoin="round"/></svg>', {opacity: 0}); to(ar, nodes[i + 1].t - 0.2, {opacity: 0, x: -20}, {opacity: 1, x: 0}, 0.25); }
  });
}

// ---------- brand tag (scenes after intro) ----------
const brand = h('div', {id: 'brand', style: {opacity: 0}}, `<div class="b1"><div class="dot">${icon('map-pin', 22, '#fff', 3)}</div>TravelPlanner</div><div class="b2" id="chap"></div>`);
const chapNames = {query: '实时查询', transport: '大交通', constraints: '硬约束', route: '市内路线', hotel: '住哪', budget: '花多少钱', roadbook: '交付路书', rules: '三条规矩', install: '三步上手'};
to(brand, scenes.query.start + 0.2, {opacity: 0, x: -30}, {opacity: 1, x: 0}, 0.5);
to(brand, scenes.outro.start - 0.1, {opacity: 1}, {opacity: 0}, 0.2);
dyn.push(t => { const sc = TL.scenes.find(s => t >= s.start && t < s.end); const n = sc && chapNames[sc.name] || ''; const c = document.getElementById('chap'); if (c.textContent !== n) c.textContent = n; });

// ---------- 3. QUERY ----------
{
  const sc = scenes.query;
  const dive = h('img', {parent: sc.el, class: 'bg', src: 'img/kv_dive.jpg'});
  kenburns(dive, sc, 1.04, 1.12, 0, -40);
  const ttl = box(sc.el, 'kl stroke', 1420, 470, null, null, '全部当场查！', {fontSize: '150px', color: '#fff', opacity: 0, whiteSpace: 'nowrap', zIndex: 9});
  gsap.set(ttl, {xPercent: -50});
  popIn(ttl, L('l08').start + 0.1, {sfx: 'stamp', gain: 0.5, rot0: -10, rot: -3});
  out(ttl, L('l09').start - 0.1, {y: -60});
  const srcs = [['12306', '火车余票 · 时刻', 'train-front', 90, 130, W('l09', '一二三')], ['飞猪', '机票 · 酒店 · 门票', 'plane', 90, 420, W('l09', '飞猪')],
                ['途牛', '酒店房型 · 第二数据源', 'hotel', 1440, 130, W('l09', '途牛')], ['高德', '真实路线 · 换乘票价', 'route', 1440, 420, W('l09', '高德')]];
  srcs.forEach(([n, d, ic, x, y, t]) => {
    const c = box(sc.el, 'card', x, y, 390, 170, `<div class="row" style="gap:18px;padding:24px 26px"><div style="width:86px;height:86px;border-radius:22px;background:#4D6BFE;display:flex;align-items:center;justify-content:center;border:4px solid #1E2A78">${icon(ic, 50, '#fff')}</div><div><div style="font-family:KL;font-size:48px;color:#1E2A78;line-height:1.1">${n}</div><div style="font-size:24px;color:#4A5275;font-weight:700;margin-top:6px">${d}</div></div><div style="position:absolute;right:16px;top:14px;background:#21B98A;color:#fff;border-radius:10px;padding:0 10px;font-size:20px;font-weight:800">实时</div></div>`, {opacity: 0, zIndex: 8});
    popIn(c, t, {sfx: 'pop'});
    tl.fromTo(c, {y: 0}, {y: -8, duration: 1.1, ease: 'sine.inOut', yoyo: true, repeat: 5, immediateRender: false}, t + 0.6);
  });
  const term = box(sc.el, 'term', 470, 680, 980, 215, `<div class="body" style="padding:20px 30px;font-size:24px;line-height:1.6" id="q-log"></div>`, {opacity: 0, zIndex: 8, background: 'rgba(15,21,48,.9)'});
  slideIn(term, srcs[0][5] - 0.1, 0, 40);
  const logs = [['12306 query  上海 → 成都  2026-10-16', '余票 ✓', srcs[0][5]], ['flyai search-flight --origin 上海 --destination 成都', '✓', srcs[1][5]], ['tuniu hotelSearch 成都·春熙路 10/16–10/18', '✓', srcs[2][5]], ['amap route 天府机场T2 → 春熙路 (地铁)', '84 分钟 ✓', srcs[3][5]]];
  const logEl = term.querySelector('#q-log');
  logs.map(([c, r]) => h('div', {parent: logEl, style: {opacity: 0}}, `<span class="dim">$</span> ${c}  <span class="ok">${r}</span>`)).forEach((e, i) => slideIn(e, logs[i][2] + 0.15, -20, 0, {dur: 0.3}));
}

// ---------- 5. TRANSPORT ----------
{
  const sc = scenes.transport;
  bgImg(sc, 'bg_airport', {s0: 1.04, s1: 1.12});
  shade(sc, 'linear-gradient(180deg, rgba(20,30,90,.15), rgba(20,30,90,.5))');
  const mk = (x, ic, title, sub, price, timeTxt, barW, color) => box(sc.el, 'card', x, 170, 640, 440, `
    <div class="row" style="gap:20px;padding:30px 34px 10px"><div style="width:96px;height:96px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;border:4px solid #1E2A78">${icon(ic, 54, '#fff')}</div><div><div style="font-family:KL;font-size:52px;color:#1E2A78">${title}</div><div style="font-size:24px;color:#59607E;font-weight:700">${sub}</div></div></div>
    <div style="padding:6px 36px"><div class="row" style="align-items:baseline;gap:10px"><span class="hy" style="font-size:150px;color:${color};line-height:1.1;opacity:0" data-price>¥0</span><span style="font-size:34px;font-weight:800;color:#1E2A78">起 / 人</span></div>
    <div class="row" style="gap:12px;font-size:34px;font-weight:800;color:#1E2A78;margin-top:6px">${icon('clock', 38, '#1E2A78')}<span data-time style="opacity:0">${timeTxt}</span></div>
    <div style="margin-top:16px;height:34px;border-radius:17px;background:#EEF1FA;border:3px solid #1E2A78;overflow:hidden"><div data-bar style="height:100%;width:${barW}px;background:${color};transform-origin:0 50%;transform:scaleX(0)"></div></div></div>`, {opacity: 0});
  const plane = mk(500, 'plane', '飞机 · 直飞', '春秋 9C8819 · 虹桥 T1 07:50 → 天府 T2 10:55', 579, '3 小时 05 分', 165, '#4D6BFE');
  const train = mk(1200, 'train-front', '高铁 · 二等座', '上海虹桥 → 成都东 · 最快 G237', 935, '最快 10 小时 31 分', 562, '#FF6B5A');
  charIn(sc, 'p_point', 20, 320, 690, sc.start + 0.3);
  const t9 = L('l10').start, t10 = L('l11').start;
  popIn(plane, t9 + 0.1, {from: {y: 80, opacity: 0, scale: 0.9}, ease: 'back.out(1.4)', sfx: 'swish'});
  counter(plane.querySelector('[data-price]'), 0, 579, W('l10', '五百'), 0.9, v => '¥' + Math.round(v)); to(plane.querySelector('[data-price]'), W('l10', '五百'), {opacity: 0}, {opacity: 1}, 0.15);
  const tp = W('l10', '三小时');
  to(plane.querySelector('[data-time]'), tp, {opacity: 0}, {opacity: 1}, 0.3); to(plane.querySelector('[data-bar]'), tp, {scaleX: 0}, {scaleX: 1}, 0.8, 'power2.out');
  popIn(train, t10 + 0.05, {from: {y: 80, opacity: 0, scale: 0.9}, ease: 'back.out(1.4)', sfx: 'swish'});
  counter(train.querySelector('[data-price]'), 0, 935, W('l11', '九百'), 0.9, v => '¥' + Math.round(v)); to(train.querySelector('[data-price]'), W('l11', '九百'), {opacity: 0}, {opacity: 1}, 0.15);
  const tt = W('l11', '十小时');
  to(train.querySelector('[data-time]'), tt, {opacity: 0}, {opacity: 1}, 0.3); to(train.querySelector('[data-bar]'), tt, {scaleX: 0}, {scaleX: 1}, 1.6, 'power1.inOut');
  const b1 = box(sc.el, 'tag', 860, 136, null, null, icon('wallet', 30, '#fff') + '每人便宜 ¥356', {background: '#21B98A', color: '#fff', border: '4px solid #1E2A78', opacity: 0, zIndex: 4});
  const b2 = box(sc.el, 'tag', 860, 632, null, null, icon('clock', 30, '#fff') + '路上省 7 小时+', {background: '#21B98A', color: '#fff', border: '4px solid #1E2A78', opacity: 0, zIndex: 4});
  popIn(b1, W('l12', '钱更少'), {sfx: 'coin', gain: 0.45}); popIn(b2, W('l12', '七个'), {sfx: 'pop'});
  const tc = W('l12', '坐飞机');
  to(train, tc, {opacity: 1, filter: 'grayscale(0)'}, {opacity: 0.55, filter: 'grayscale(1)', scale: 0.95}, 0.4);
  const st = box(sc.el, 'stamp', 700, 470, null, null, '就坐飞机！', {opacity: 0, zIndex: 5, fontSize: '76px', color: '#E8453C', borderColor: '#E8453C'});
  popIn(st, tc, {from: {scale: 3, opacity: 0, rotation: -14}, rot: -10, ease: 'power4.out', dur: 0.3, sfx: 'stamp', gain: 0.75});
  sfx('chime', tc + 0.25, 0.4);
  to(plane, tc, {scale: 1}, {scale: 1.04}, 0.3, 'back.out(3)');
}

// ---------- 6. CONSTRAINTS ----------
{
  const sc = scenes.constraints;
  bgImg(sc, 'bg_panda', {s0: 1.03, s1: 1.1, x0: 0, x1: -30});
  shade(sc, 'linear-gradient(90deg, rgba(255,255,255,.25), rgba(255,255,255,0) 70%)');
  const card = box(sc.el, 'card', 560, 120, 720, 720, '', {opacity: 0, padding: '34px 44px'});
  const items = [['闭馆日', '周几闭馆，提前避开', '闭馆'], ['预约放票', '几点放票、提前几天', '预约'], ['实名限量', '每天限量，先抢先得', '实名'], ['末班车', '末班地铁 · 末班缆车', '末班'], ['天气窗口', '下雨就换室内动线', '天气']];
  card.innerHTML = `<div class="row" style="gap:14px;font-family:KL;font-size:50px;color:#1E2A78;margin-bottom:18px">${icon('list-checks', 52, '#4D6BFE')}排行程前，先盘硬约束</div>` +
    items.map(([a, b]) => `<div class="row" style="gap:24px;padding:16px 0;border-top:3px dashed #D5DBEF"><div data-box style="width:66px;height:66px;border-radius:16px;border:5px solid #1E2A78;display:flex;align-items:center;justify-content:center;background:#fff"><span data-chk style="opacity:0">${icon('check', 46, '#21B98A', 4)}</span></div><div><div style="font-weight:900;font-size:40px;color:#1B2240">${a}</div><div style="font-size:26px;color:#59607E;font-weight:600">${b}</div></div></div>`).join('');
  const t12 = L('l13').start;
  popIn(card, t12, {from: {x: 60, opacity: 0, scale: 0.95}, ease: 'power3.out', sfx: 'swish'});
  card.querySelectorAll('[data-chk]').forEach((c, i) => { const t = W('l13', items[i][2]); popIn(c, t, {from: {scale: 0, opacity: 0, rotation: -40}, ease: 'back.out(3)', sfx: 'tick', gain: 0.7}); to(c.parentElement, t, {backgroundColor: '#fff'}, {backgroundColor: '#DDF7EC'}, 0.3); });
  const clip = charIn(sc, 'p_clipboard', 40, 330, 700, sc.start + 0.4, {until: L('l15').start});
  const t13 = L('l14').start;
  out(card, t13 - 0.05, {x: -80, scale: 0.95});
  const c1 = box(sc.el, 'card', 560, 140, 760, 300, `<div class="row" style="gap:26px;padding:30px 38px"><div style="width:120px;height:120px;border-radius:50%;background:#1E2A78;display:flex;align-items:center;justify-content:center">${icon('clock', 74, '#FFC94A')}</div><div><div class="row" style="gap:14px"><span class="tag" style="position:static;background:#4D6BFE;color:#fff;font-size:24px;padding:4px 14px">DAY 2</span><span style="font-weight:800;font-size:30px;color:#59607E">熊猫基地开园</span></div><div class="hy" style="font-size:120px;color:#1E2A78;line-height:1.05">07:30</div></div></div><div style="padding:0 40px;font-size:30px;font-weight:700;color:#1B2240">熊猫上午最活跃 · 过了 11 点基本都在睡</div>`, {opacity: 0});
  popIn(c1, W('l14', '熊猫'), {from: {y: 60, opacity: 0, scale: 0.9}, ease: 'back.out(1.5)', sfx: 'ding', gain: 0.4});
  const c2 = box(sc.el, 'card', 560, 480, 760, 330, `<div class="row" style="gap:26px;padding:28px 38px 14px"><div style="width:120px;height:120px;border-radius:50%;background:#6E86B8;display:flex;align-items:center;justify-content:center">${icon('cloud-rain', 72, '#fff')}</div><div><div style="font-weight:800;font-size:30px;color:#59607E">10/16 周五 · 中国天气网预报</div><div style="font-family:KL;font-size:66px;color:#1E2A78">阴转雨 17° / 14°</div></div></div><div data-pb style="margin:0 38px;padding:14px 22px;background:#FFF4D6;border:4px solid #E3A72F;border-radius:18px;font-size:30px;font-weight:800;color:#7A4E00;opacity:0">Plan B：下雨就把宽窄巷子挪到第三天，室内先行</div>`, {opacity: 0});
  const t14 = L('l15').start;
  popIn(c2, W('l15', '预报'), {from: {y: 60, opacity: 0, scale: 0.9}, ease: 'back.out(1.5)', sfx: 'swish'});
  const pb = c2.querySelector('[data-pb]'); popIn(pb, W('l15', 'Plan'), {from: {scale: 0.6, opacity: 0}, sfx: 'chime', gain: 0.4});
  const umb = box(sc.el, 'cw', 40, 330, 466, 700, `<img src="img/p_umbrella.png">`, {opacity: 0, zIndex: 5});
  swapChar(clip, umb, t14); bob(umb.firstChild, t14 + 0.6, sc.end, 10, 1.3);
  const rain = box(sc.el, 'fill', 0, 0, 1920, 1080, '', {opacity: 0, zIndex: 2, pointerEvents: 'none'});
  const drops = Array.from({length: 90}, () => [rnd() * 2100, rnd() * 1080]);
  rain.innerHTML = `<svg width="1920" height="2160" style="position:absolute;left:0;top:0">${[0, 1080].map(o => drops.map(([x, y]) => `<line x1="${x}" y1="${y + o}" x2="${x - 14}" y2="${y + o + 46}" stroke="rgba(255,255,255,.75)" stroke-width="3" stroke-linecap="round"/>`).join('')).join('')}</svg>`;
  to(rain, t14, {opacity: 0}, {opacity: 1}, 0.6);
  tl.fromTo(rain.firstChild, {y: -1080}, {y: 0, duration: 0.9, ease: 'none', repeat: 8, immediateRender: false}, t14);
}

// ---------- 7. ROUTE ----------
{
  const sc = scenes.route;
  h('div', {parent: sc.el, class: 'fill', style: {background: 'linear-gradient(rgba(30,42,120,.06) 2px, transparent 2px) 0 0/60px 60px, linear-gradient(90deg, rgba(30,42,120,.06) 2px, transparent 2px) 0 0/60px 60px, #F7F5F0'}});
  const q = box(sc.el, 'kl stroke', 960, 230, null, null, '市内怎么走？', {fontSize: '130px', color: '#fff', opacity: 0, whiteSpace: 'nowrap'}); gsap.set(q, {xPercent: -50});
  const t15 = L('l16').start;
  popIn(q, t15, {from: {y: 50, opacity: 0, scale: 0.8}, sfx: 'pop'});
  const vb = box(sc.el, 'bubble', 960, 480, null, null, '“坐地铁大概半小时”', {background: '#fff', border: '5px dashed #9AA0B5', color: '#7A8099', fontSize: '64px', fontFamily: 'KL', opacity: 0, whiteSpace: 'nowrap'}); gsap.set(vb, {xPercent: -50});
  popIn(vb, W('l16', '坐地铁'), {sfx: 'pop2'});
  const strike = box(sc.el, 'abs', 960, 545, 760, 14, '', {background: '#E8453C', borderRadius: '7px', transformOrigin: '0 50%', opacity: 0}); gsap.set(strike, {xPercent: -50, rotation: -4});
  const tS = W('l16', '半小时') + 0.05;
  to(strike, tS, {scaleX: 0, opacity: 1}, {scaleX: 1, opacity: 1}, 0.3, 'power2.out'); sfx('swish', tS, 0.4);
  const st = box(sc.el, 'stamp', 1240, 600, null, null, '太模糊！', {opacity: 0});
  popIn(st, tS + 0.25, {from: {scale: 2.5, opacity: 0, rotation: 12}, rot: 8, ease: 'power4.out', dur: 0.3, sfx: 'stamp', gain: 0.6});
  const t16 = L('l17').start;
  [q, vb, strike, st].forEach(e => out(e, t16 + 0.25, {y: -40}));
  // map frame
  const fr = box(sc.el, 'card', 110, 110, 1150, 780, `<div style="height:56px;background:#F2F5FF;border-bottom:4px solid #1E2A78;display:flex;align-items:center;padding:0 22px;gap:10px"><i style="width:16px;height:16px;border-radius:50%;background:#FF6B5A"></i><i style="width:16px;height:16px;border-radius:50%;background:#FFC94A"></i><i style="width:16px;height:16px;border-radius:50%;background:#21B98A"></i><span style="margin-left:14px;font-size:22px;font-weight:700;color:#59607E">成都3天2晚路书.html · 都去哪儿，离得多远</span></div><div class="scr" style="left:0;top:56px;right:0;bottom:0"><img src="img/sec_map.png" data-map></div>`, {overflow: 'hidden', opacity: 0});
  popIn(fr, t16 + 0.45, {from: {y: 60, opacity: 0, scale: 0.95}, ease: 'power3.out', sfx: 'whoosh', gain: 0.5});
  const mimg = fr.querySelector('[data-map]'); mimg.style.width = '1140px'; mimg.style.transformOrigin = '45% 30%';
  tl.fromTo(mimg, {y: -40, scale: 1.0}, {y: -60, scale: 1.12, duration: chunk('l17', 1) - t16, ease: 'sine.inOut', immediateRender: false}, t16);
  tl.fromTo(mimg, {y: -60, scale: 1.12}, {y: -233, scale: 1.0, duration: 1.0, ease: 'power3.inOut', immediateRender: false}, chunk('l17', 1));
  const steps = [['18', '#00A6A0', '天府机场 → 火车南站', W('l17', '几号线')], ['1', '#2F62B5', '换乘 → 天府广场', W('l17', '换几')], ['2', '#F08A00', '换乘 → 春熙路', W('l17', '换几') + 0.45]];
  const pan = box(sc.el, 'abs', 1300, 120, 540, 700, '', {});
  steps.forEach(([n, c, txt, t], i) => {
    const e = box(pan, 'card', 0, i * 132, 540, 112, `<div class="row" style="gap:18px;padding:16px 22px"><div style="min-width:74px;height:74px;border-radius:18px;background:${c};color:#fff;font-weight:900;font-size:34px;display:flex;align-items:center;justify-content:center;border:4px solid #1E2A78">${n}</div><div><div style="font-weight:900;font-size:30px;color:#1B2240">地铁 ${n} 号线</div><div style="font-size:24px;color:#59607E;font-weight:700">${txt}</div></div></div>`, {opacity: 0, boxShadow: '7px 7px 0 #1E2A78'});
    popIn(e, t, {from: {x: 60, opacity: 0, scale: 0.9}, ease: 'back.out(1.6)', sfx: 'pop'});
  });
  const sum = box(pan, 'card', 0, 410, 540, 120, `<div class="row" style="justify-content:space-around;padding:18px 10px;font-weight:900;color:#1E2A78"><div style="text-align:center"><div class="hy" style="font-size:52px" data-min>0</div><div style="font-size:22px;color:#59607E">分钟</div></div><div style="text-align:center"><div class="hy" style="font-size:52px">73.3</div><div style="font-size:22px;color:#59607E">公里</div></div><div style="text-align:center"><div class="hy" style="font-size:52px;color:#E8453C" data-yuan>¥0</div><div style="font-size:22px;color:#59607E">票价</div></div></div>`, {opacity: 0, background: '#FFF8EC'});
  popIn(sum, W('l17', '多少分钟'), {from: {y: 30, opacity: 0, scale: 0.9}, sfx: 'pop2'});
  counter(sum.querySelector('[data-min]'), 0, 84, W('l17', '多少分钟'), 0.8);
  counter(sum.querySelector('[data-yuan]'), 0, 11, W('l17', '票价'), 0.6, v => '¥' + Math.round(v)); sfx('coin', W('l17', '票价') + 0.5, 0.35);
  const nav = box(pan, 'chip', 0, 560, null, null, icon('navigation', 30, '#fff', 2.8) + '每一站 · 一键导航', {opacity: 0, fontSize: '32px', background: '#21B98A'});
  popIn(nav, W('l17', '一键'), {sfx: 'ding', gain: 0.4});
  tl.fromTo(nav, {scale: 1}, {scale: 1.06, duration: 0.35, yoyo: true, repeat: 5, ease: 'sine.inOut', immediateRender: false}, W('l17', '一键') + 0.6);
  charIn(sc, 'p_teacher', -20, 610, 470, t16 + 0.3, {z: 6});
}

// ---------- 8. HOTEL ----------
{
  const sc = scenes.hotel;
  bgImg(sc, 'bg_night', {s0: 1.04, s1: 1.1});
  shade(sc, 'rgba(14,20,60,.5)');
  const t17 = L('l18').start;
  const ttl = box(sc.el, 'card', 110, 150, 520, 230, `<div style="padding:30px 36px"><div style="font-family:KL;font-size:64px;color:#1E2A78">住哪？</div><div style="font-weight:900;font-size:40px;color:#4D6BFE;margin-top:6px">按动线重心选址</div><div style="font-size:26px;color:#59607E;font-weight:700;margin-top:8px">必去的点都在地铁 3 号线上</div></div>`, {opacity: 0});
  popIn(ttl, t17, {from: {x: -60, opacity: 0, scale: 0.95}, ease: 'power3.out', sfx: 'swish'});
  const LX = 900;
  const line = box(sc.el, 'abs', LX - 14, 170, 28, 640, '', {background: '#E4007F', borderRadius: '14px', border: '4px solid #fff', transformOrigin: '50% 0', opacity: 0});
  const tl3 = W('l18', '动线');
  to(line, tl3, {scaleY: 0, opacity: 1}, {scaleY: 1, opacity: 1}, 0.9, 'power2.inOut'); sfx('swish', tl3, 0.4);
  const l3chip = box(sc.el, 'tag', LX - 120, 108, null, null, '地铁 3 号线', {background: '#E4007F', color: '#fff', border: '4px solid #fff', opacity: 0}); popIn(l3chip, tl3, {sfx: null});
  const stn = (y, name, sub, t, big) => { const d = box(sc.el, 'abs', LX - 30, y - 30, 60, 60, '', {background: '#fff', border: '9px solid #E4007F', borderRadius: '50%', opacity: 0, zIndex: 3}); popIn(d, t, {sfx: 'pop2', gain: 0.4}); const lb = box(sc.el, 'abs', LX + 60, y - 42, null, null, `<div style="font-weight:900;font-size:${big ? 46 : 38}px;color:#fff">${name}</div><div style="font-size:26px;color:#C9D3FF;font-weight:700">${sub}</div>`, {opacity: 0, whiteSpace: 'nowrap'}); slideIn(lb, t + 0.05, -30, 0, {dur: 0.4}); return d; };
  const tSt = W('l18', '选址') + 0.25;
  stn(200, '熊猫大道', '大熊猫繁育研究基地', tSt); stn(780, '高升桥 → 武侯祠', '换 10 号线一站 · 锦里', tSt + 0.2);
  const tC = W('l18', '春熙路');
  stn(490, '春熙路', '太古里 · IFS', tC, true);
  const pin = box(sc.el, 'abs', LX - 230, 400, 150, 150, `<div style="width:130px;height:130px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#FFC94A;border:6px solid #1E2A78;display:flex;align-items:center;justify-content:center"><span style="transform:rotate(45deg)">${icon('bed-double', 64, '#1E2A78', 2.6)}</span></div>`, {opacity: 0, zIndex: 4});
  popIn(pin, tC + 0.1, {from: {y: -200, opacity: 0, scale: 1}, ease: 'bounce.out', dur: 0.7, sfx: 'pop'});
  const nl = box(sc.el, 'tag', LX + 60, 300, null, null, icon('navigation', 28, '#1E2A78', 2.8) + '往北 24 分钟 · 看熊猫', {background: '#fff', color: '#1E2A78', border: '4px solid #1E2A78', opacity: 0, fontSize: '30px'});
  const sl = box(sc.el, 'tag', LX + 60, 625, null, null, icon('navigation', 28, '#1E2A78', 2.8) + '往南 25 分钟 · 逛武侯祠', {background: '#fff', color: '#1E2A78', border: '4px solid #1E2A78', opacity: 0, fontSize: '30px'});
  nl.firstChild.style.transform = 'rotate(-45deg)'; sl.firstChild.style.transform = 'rotate(135deg)';
  popIn(nl, W('l18', '往北'), {sfx: 'pop'}); popIn(sl, W('l18', '往南'), {sfx: 'pop'});
  const mainc = charIn(sc, 'p_main', 1380, 300, 720, t17 + 0.2, {until: L('l19').start});
  // hotels
  const t18 = L('l19').start;
  [ttl, l3chip, nl, sl].forEach(e => out(e, t18 - 0.1));
  const stationEls = [...sc.el.children].filter(e => e.classList.contains('abs') && !e.classList.contains('cw'));
  stationEls.forEach(e => out(e, t18 - 0.1));
  const hs = [['省钱档', '#7A9A3A', '安逸·锦著酒店', '天府广场武侯祠大街店', '雅致大床房 · 23㎡', 184, 'hotel0', '一百'], ['舒适档 · 推荐', '#21915F', '美豪酒店', '成都春熙路太古里店', '精致大床房 · 含双早', 231, 'hotel1', '二百'], ['品质档', '#A33A2E', '亚朵 X 酒店', '太古里 IFS 国金中心', '高级大床房 · 24㎡', 354, 'hotel2', '三百']];
  hs.forEach(([tier, col, name, br, room, price, img, wd], i) => {
    const c = box(sc.el, 'card', 70 + i * 452, 130, 420, 700, `<div style="height:270px;overflow:hidden;border-radius:24px 24px 0 0;position:relative"><img src="img/${img}.jpg" style="width:100%;height:100%;object-fit:cover"><div data-flash style="position:absolute;inset:0;background:#fff;opacity:0"></div><div data-real class="tag" style="left:14px;bottom:14px;background:rgba(20,30,90,.85);color:#fff;font-size:22px;padding:4px 12px;opacity:0">${icon('search', 22, '#fff')}房型实拍</div></div>
      <div style="padding:22px 26px"><span class="tag" style="position:static;background:${col};color:#fff;font-size:24px;padding:4px 14px">${tier}</span><div style="font-weight:900;font-size:38px;color:#1B2240;margin-top:14px">${name}</div><div style="font-size:23px;color:#59607E;font-weight:700">${br}</div><div style="font-size:25px;color:#1E2A78;font-weight:800;margin-top:12px">${room}</div><div class="row" style="align-items:baseline;gap:8px;margin-top:10px"><span class="hy" style="font-size:96px;color:${col}" data-p>¥0</span><span style="font-size:28px;font-weight:800;color:#59607E">/ 晚</span></div></div>`, {opacity: 0, overflow: 'hidden'});
    const t = W('l19', wd);
    popIn(c, t, {from: {y: 100, opacity: 0, scale: 0.85}, ease: 'back.out(1.5)', sfx: 'pop'});
    counter(c.querySelector('[data-p]'), 0, price, t + 0.1, 0.6, v => '¥' + Math.round(v));
    const tr = chunk('l19', 1) + i * 0.2;
    to(c.querySelector('[data-flash]'), tr, {opacity: 0.9}, {opacity: 0}, 0.45, 'power2.out'); sfx('tick', tr, 0.6);
    popIn(c.querySelector('[data-real]'), tr + 0.05, {sfx: null});
  });
  const keys = box(sc.el, 'cw', 1430, 330, 466, 700, `<img src="img/p_keys.png">`, {opacity: 0, zIndex: 5});
  swapChar(mainc, keys, t18); bob(keys.firstChild, t18 + 0.6, sc.end, 10, 1.3);
}

// ---------- 9. BUDGET ----------
{
  const sc = scenes.budget;
  bgImg(sc, 'bg_alley', {s0: 1.04, s1: 1.1});
  shade(sc, 'rgba(25,18,40,.55)');
  const t19 = L('l20').start;
  charIn(sc, 'p_calc', 30, 330, 700, t19 - 0.4);
  const segs = [['往返机票', 2316, '#4D6BFE', 0], ['住宿 2 晚（舒适档）', 462, '#7B93FF', 0], ['门票', 270, '#B4C2FF', 0], ['餐饮（估算）', 900, '#FFC94A', 1], ['市内交通（估算）', 150, '#FFE08A', 1], ['手信杂项（估算）', 300, '#FFF0C2', 1]];
  const tot = 4398, R = 210, C = 2 * Math.PI * R;
  const dn = box(sc.el, 'abs', 520, 150, 560, 560, '', {opacity: 0});
  let acc = 0;
  dn.innerHTML = `<svg width="560" height="560" viewBox="-280 -280 560 560"><circle r="${R}" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="96"/>${segs.map(([n, v, c], i) => { const len = v / tot * C; const s = `<circle data-seg="${i}" r="${R}" fill="none" stroke="${c}" stroke-width="96" stroke-dasharray="0 ${C}" stroke-dashoffset="${-acc}" transform="rotate(-90)"/>`; acc += len; return s; }).join('')}<circle r="150" fill="#fff" stroke="#1E2A78" stroke-width="8"/></svg>
   <div style="position:absolute;left:0;right:0;top:205px;text-align:center"><div class="hy" style="font-size:96px;color:#1E2A78;line-height:1;opacity:0" data-tot>¥0</div><div style="font-size:26px;font-weight:800;color:#59607E;margin-top:8px">两人合计 · 舒适档</div></div>`;
  popIn(dn, t19 + 0.1, {from: {scale: 0.6, opacity: 0, rotation: -30}, ease: 'back.out(1.4)', sfx: 'swish'});
  const tReal = W('l20', '实价'), tEst = W('l20', '估算');
  acc = 0;
  segs.forEach(([n, v, c, est], i) => {
    const len = v / tot * C, el = dn.querySelector(`[data-seg="${i}"]`);
    const t = (est ? tEst : tReal) + (est ? i - 3 : i) * 0.18;
    dyn.push(tt => { const k = Math.min(1, Math.max(0, (tt - t) / 0.5)); const e = 1 - Math.pow(1 - k, 3); el.setAttribute('stroke-dasharray', `${len * e} ${C}`); });
    sfx('pop2', t, 0.35);
  });
  counter(dn.querySelector('[data-tot]'), 0, 4398, W('l20', '四千'), 1.1, v => '¥' + Math.round(v).toLocaleString('en-US')); to(dn.querySelector('[data-tot]'), W('l20', '四千'), {opacity: 0, scale: 0.6}, {opacity: 1, scale: 1}, 0.3, 'back.out(2)');
  const leg = box(sc.el, 'card', 1130, 150, 700, 530, '', {opacity: 0, padding: '28px 34px'});
  leg.innerHTML = `<div class="row" style="gap:18px;margin-bottom:12px"><span class="tag" style="position:static;background:#4D6BFE;color:#fff;font-size:24px">查询实价</span><span class="tag" style="position:static;background:#FFC94A;color:#5A3E00;font-size:24px">参考估算</span></div>` +
    segs.map(([n, v, c, est]) => `<div class="row" data-r style="gap:16px;padding:12px 0;border-top:3px dashed #E4E7F2;opacity:0"><i style="width:30px;height:30px;border-radius:8px;background:${c};border:3px solid #1E2A78;display:block"></i><span style="font-weight:800;font-size:31px;color:#1B2240">${n}</span><span class="mono" style="margin-left:auto;font-weight:700;font-size:31px;color:#1E2A78">¥${v.toLocaleString('en-US')}</span></div>`).join('');
  popIn(leg, tReal - 0.2, {from: {x: 60, opacity: 0, scale: 0.95}, ease: 'power3.out', sfx: null});
  leg.querySelectorAll('[data-r]').forEach((r, i) => slideIn(r, (segs[i][3] ? tEst : tReal) + (segs[i][3] ? i - 3 : i) * 0.18, 30, 0, {dur: 0.35}));
  const per = box(sc.el, 'tag', 640, 735, null, null, icon('wallet', 34, '#1E2A78') + '人均 ≈ ¥2,200', {background: '#FFC94A', color: '#1E2A78', border: '5px solid #1E2A78', fontSize: '40px', padding: '10px 26px', opacity: 0, boxShadow: '6px 6px 0 #1E2A78'});
  popIn(per, W('l20', '两千二'), {sfx: 'coin', gain: 0.5});
  // l20 : budget headroom
  const t20 = L('l21').start;
  out(leg, t20 - 0.1, {x: 60});
  const cmp = box(sc.el, 'card', 1130, 150, 700, 540, `<div style="padding:30px 36px"><div style="font-family:KL;font-size:46px;color:#1E2A78">人均对比</div>
    <div style="margin-top:18px;font-weight:800;font-size:28px;color:#59607E">你的预算</div><div style="height:48px;border-radius:24px;background:#E8ECFA;border:4px solid #1E2A78;overflow:hidden;position:relative"><div data-b1 style="height:100%;width:100%;background:#7B93FF;transform-origin:0 50%"></div><span class="mono" style="position:absolute;right:16px;top:2px;font-weight:900;font-size:30px;color:#1E2A78">¥3,000</span></div>
    <div style="margin-top:16px;font-weight:800;font-size:28px;color:#59607E">这份路书</div><div style="height:48px;border-radius:24px;background:#E8ECFA;border:4px solid #1E2A78;overflow:hidden;position:relative"><div data-b2 style="height:100%;width:73%;background:#21B98A;transform-origin:0 50%"></div><span class="mono" style="position:absolute;left:16px;top:2px;font-weight:900;font-size:30px;color:#fff">≈ ¥2,200</span></div>
    <div data-o1 class="row" style="gap:16px;margin-top:24px;background:#EAF2FF;border:4px solid #1E2A78;border-radius:20px;padding:12px 20px;opacity:0">${icon('hotel', 46, '#4D6BFE')}<span style="font-weight:900;font-size:34px">升级酒店</span><span style="margin-left:auto;font-weight:800;font-size:26px;color:#59607E">品质档 ¥354/晚</span></div>
    <div data-o2 class="row" style="gap:16px;margin-top:14px;background:#FFF1E6;border:4px solid #1E2A78;border-radius:20px;padding:10px 20px;opacity:0"><img src="img/eat0.jpg" style="width:74px;height:54px;object-fit:cover;border-radius:10px"><span style="font-weight:900;font-size:34px">多吃两顿火锅</span><span style="margin-left:auto;font-weight:800;font-size:26px;color:#59607E">人均 ¥90 起</span></div></div>`, {opacity: 0});
  popIn(cmp, t20, {from: {x: 60, opacity: 0, scale: 0.95}, ease: 'power3.out', sfx: 'swish'});
  to(cmp.querySelector('[data-b1]'), t20 + 0.3, {scaleX: 0}, {scaleX: 1}, 0.6); to(cmp.querySelector('[data-b2]'), t20 + 0.6, {scaleX: 0}, {scaleX: 1}, 0.7);
  popIn(cmp.querySelector('[data-o1]'), W('l21', '升级'), {sfx: 'pop'}); popIn(cmp.querySelector('[data-o2]'), W('l21', '火锅'), {sfx: 'pop'});
  const ok = box(sc.el, 'stamp', 1480, 640, null, null, '你说了算', {opacity: 0, color: '#21B98A', borderColor: '#21B98A'});
  popIn(ok, W('l21', '你说'), {from: {scale: 2.5, opacity: 0, rotation: -12}, rot: -6, ease: 'power4.out', dur: 0.3, sfx: 'stamp', gain: 0.6});
}

// ---------- 10. ROADBOOK ----------
{
  const sc = scenes.roadbook;
  bgImg(sc, 'bg_sky', {s0: 1.03, s1: 1.1});
  shade(sc, 'linear-gradient(180deg, rgba(255,255,255,0) 40%, rgba(234,242,255,.6))');
  const t21 = L('l22').start;
  const file = box(sc.el, 'card', 960, 300, 560, 330, `<div style="padding:34px;text-align:center">${icon('file-code-2', 120, '#4D6BFE', 2)}<div style="font-weight:900;font-size:40px;color:#1B2240;margin-top:14px">成都3天2晚路书.html</div><div style="font-size:28px;font-weight:700;color:#59607E;margin-top:6px">单文件 · 3.3 MB · 双击就能开</div></div>`, {opacity: 0, zIndex: 7});
  gsap.set(file, {xPercent: -50});
  popIn(file, sc.start + 0.45, {from: {scale: 0.3, opacity: 0, rotation: -10}, ease: 'back.out(2)', sfx: 'pop'});
  tl.fromTo(file, {y: 0}, {y: -14, duration: 1.0, ease: 'sine.inOut', yoyo: true, repeat: 3, immediateRender: false}, sc.start + 1.0);
  to(file, W('l22', 'HTML'), {scale: 1}, {scale: 1.12}, 0.18, 'power2.out'); to(file, W('l22', 'HTML') + 0.18, {scale: 1.12}, {scale: 1}, 0.4, 'back.out(3)'); sfx('ding', W('l22', 'HTML'), 0.35);
  const tOpen = W('l22', '交给');
  to(file, tOpen, {opacity: 1, scale: 1}, {opacity: 0, scale: 1.6}, 0.45, 'power2.in');
  // laptop
  const lap = box(sc.el, 'laptop', 150, 105, 1140, 800, `<div style="position:absolute;left:0;top:0;width:1140px;height:700px;background:#1B2240;border-radius:34px;border:5px solid #0E1438;box-shadow:0 30px 60px rgba(20,30,90,.35)"></div><div class="scr" style="left:30px;top:30px;width:1080px;height:640px;border-radius:10px"><img src="img/desk_full.jpg" data-lap></div><div style="position:absolute;left:-70px;top:700px;width:1280px;height:44px;background:linear-gradient(#D9DEEF,#AEB6D2);border-radius:0 0 40px 40px;border:4px solid #1E2A78"></div>`, {opacity: 0, zIndex: 4});
  popIn(lap, tOpen + 0.15, {from: {scale: 0.7, opacity: 0, y: 80}, ease: 'back.out(1.3)', dur: 0.7, sfx: 'whoosh', gain: 0.45});
  const lapImg = lap.querySelector('[data-lap]');
  const k = 1080 / 1280;     // css px of roadbook layout -> screen px
  const secY = {top: 0, stay: 2511, map: 3941, d1: 5016, eat: 12209, money: 14579};
  const scrollTo = (t, key, dur = 0.8) => tl.to(lapImg, {y: -secY[key] * k + (key === 'top' ? 0 : 10), duration: dur, ease: 'power3.inOut', immediateRender: false}, t);
  gsap.set(lapImg, {y: 0});
  const feats = [['逐日时间轴', 'calendar', '逐日', 'd1'], ['可拖动地图', 'map', '地图', 'map'], ['三档酒店', 'hotel', '三档', 'stay'], ['分项预算', 'wallet', '预算', 'money'], ['图片内联·离线可开', 'download-cloud', '图片', 'eat']];
  const fc = box(sc.el, 'abs', 1340, 130, 520, 700, '', {zIndex: 5});
  feats.forEach(([n, ic, wd, key], i) => {
    const t = i < 4 ? W('l23', wd) : chunk('l23', 1);
    const c = box(fc, 'card', 0, i * 126, 500, 104, `<div class="row" style="gap:18px;padding:16px 22px"><div style="width:66px;height:66px;border-radius:18px;background:#4D6BFE;border:4px solid #1E2A78;display:flex;align-items:center;justify-content:center">${icon(ic, 38, '#fff')}</div><span style="font-weight:900;font-size:36px;color:#1B2240">${n}</span><span style="margin-left:auto">${icon('circle-check-big', 40, '#21B98A', 3)}</span></div>`, {opacity: 0, boxShadow: '7px 7px 0 #1E2A78'});
    popIn(c, t, {from: {x: 80, opacity: 0, scale: 0.9}, ease: 'back.out(1.6)', sfx: 'pop'});
    scrollTo(t - 0.1, key);
  });
  // l23: phone
  const t23 = L('l24').start;
  out(fc, t23 - 0.15, {x: 60, scale: 1});
  to(lap, t23, {x: 0, scale: 1}, {x: -90, scale: 0.86}, 0.7, 'power3.inOut');
  scrollTo(t23, 'top', 0.9);
  const ph = box(sc.el, 'abs', 1080, 150, 380, 780, `<div style="position:absolute;inset:0;background:#1B2240;border-radius:56px;border:5px solid #0E1438;box-shadow:0 30px 60px rgba(20,30,90,.35)"></div><div class="scr" style="left:18px;top:18px;width:334px;height:734px;border-radius:40px"><img src="img/mob_full.jpg" data-ph></div><div style="position:absolute;left:135px;top:30px;width:110px;height:28px;border-radius:14px;background:#1B2240"></div>`, {opacity: 0, zIndex: 6});
  popIn(ph, t23 + 0.1, {from: {x: 300, opacity: 0, rotation: 8}, rot: 0, ease: 'power3.out', dur: 0.7, sfx: 'swish'});
  const phImg = ph.querySelector('[data-ph]');
  tl.fromTo(phImg, {y: 0}, {y: -2900, duration: sc.end - t23, ease: 'sine.inOut', immediateRender: false}, t23 + 0.6);
  charIn(sc, 'p_phone', 1470, 380, 660, t23 + 0.3, {z: 7});
  const share = box(sc.el, 'abs', 1360, 170, 90, 90, `<div style="width:90px;height:90px;border-radius:50%;background:#21B98A;border:5px solid #1E2A78;display:flex;align-items:center;justify-content:center">${icon('share-2', 46, '#fff', 2.8)}</div>`, {opacity: 0, zIndex: 8});
  popIn(share, W('l24', '转发'), {sfx: 'pop'});
  const bubs = [['收到！', 1500, 210], ['这路书也太细了吧', 1530, 300]];
  bubs.forEach(([txt, x, y], i) => { const b = box(sc.el, 'bubble', x, y, null, null, txt, {background: '#fff', border: '4px solid #1E2A78', fontWeight: 900, color: '#1E2A78', opacity: 0, zIndex: 8, whiteSpace: 'nowrap', padding: '12px 24px', fontSize: '32px'}); popIn(b, W('l24', '一起') + i * 0.45, {sfx: 'pop2'}); });
}

// ---------- 11. RULES ----------
{
  const sc = scenes.rules;
  h('div', {parent: sc.el, class: 'fill', style: {background: 'radial-gradient(circle at 30% 20%, #33449C 0%, #1E2A78 45%, #121A52 100%)'}});
  const dots = box(sc.el, 'fill', 0, 0, 1920, 1080, `<svg width="1920" height="1080">${Array.from({length: 70}, () => `<circle cx="${rnd() * 1920}" cy="${rnd() * 1080}" r="${1 + rnd() * 3}" fill="rgba(255,255,255,${0.15 + rnd() * 0.4})"/>`).join('')}</svg>`);
  tl.fromTo(dots, {y: 0}, {y: -40, duration: sc.end - sc.start, ease: 'none', immediateRender: false}, sc.start);
  const t24 = L('l25').start;
  const ttl = box(sc.el, 'kl', 560, 110, null, null, '三条规矩，说到做到', {fontSize: '84px', color: '#fff', opacity: 0, whiteSpace: 'nowrap'});
  popIn(ttl, t24, {from: {y: 40, opacity: 0, scale: 0.9}, sfx: 'pop'});
  charIn(sc, 'p_promise', 40, 330, 700, t24 + 0.1);
  const rules = [['ban', '#FF6B5A', '只规划，不代订、不代付', '不下单、不提交证件信息 · 预订入口给你，自己在官方渠道完成'], ['badge-check', '#21B98A', '数据不编，查不到就直说', '时刻、价格、开放时间都标来源和查询日期 · 查不到就写「需自行核实」'], ['key-round', '#FFC94A', '所有 Key 只放在本地 .env', '技能、persona、脚本里都不写明文 Key']];
  rules.forEach(([ic, col, a, b], i) => {
    const c = box(sc.el, 'card', 560, 250 + i * 205, 1260, 180, `<div class="row" style="gap:30px;padding:24px 34px"><div style="min-width:120px;height:120px;border-radius:30px;background:${col};border:5px solid #1E2A78;display:flex;align-items:center;justify-content:center">${icon(ic, 70, '#fff', 2.6)}</div><div><div style="font-weight:900;font-size:48px;color:#1B2240">${a}</div><div style="font-size:27px;font-weight:700;color:#59607E;margin-top:6px">${b}</div></div><div class="hy" style="margin-left:auto;font-size:90px;color:#E4E8F7">0${i + 1}</div></div>`, {opacity: 0});
    popIn(c, chunk('l26', i), {from: {x: 120, opacity: 0, scale: 0.95}, ease: 'back.out(1.4)', sfx: 'ding', gain: 0.35});
  });
}

// ---------- 12. INSTALL ----------
{
  const sc = scenes.install;
  bgImg(sc, 'bg_desk', {s0: 1.05, s1: 1.1, filter: 'blur(4px)'});
  shade(sc, 'rgba(18,24,64,.62)');
  const t26 = L('l27').start;
  const term = box(sc.el, 'term', 100, 130, 1240, 660, `<div class="bar"><i style="background:#FF6B5A"></i><i style="background:#FFC94A"></i><i style="background:#21B98A"></i><span style="margin-left:16px;color:#AFC0FF;font-weight:700;font-size:24px">Terminal — TravelPlanner</span></div><div class="body" id="i-body"></div>`, {opacity: 0});
  popIn(term, t26, {from: {y: 60, opacity: 0, scale: 0.95}, ease: 'power3.out', sfx: 'swish'});
  const body = term.querySelector('#i-body');
  const ln = (html) => h('div', {parent: body, style: {opacity: 0}}, html);
  const c0 = ln('<span class="dim" data-ty></span>');
  to(c0, t26 + 0.4, {opacity: 0}, {opacity: 1}, 0.1); typeText(c0.querySelector('[data-ty]'), '# 先装好 DSH 桌面版，并至少打开过一次', t26 + 0.5, t26 + 1.7, false);
  const c1 = ln('<span class="hl">$</span> <span data-ty></span>'), c2 = ln('<span class="hl">$</span> <span data-ty></span>');
  const tC1 = W('l27', '拉下'), tC2 = W('l27', '运行');
  to(c1, tC1 - 0.1, {opacity: 0}, {opacity: 1}, 0.1); typeText(c1.querySelector('[data-ty]'), 'git clone https://github.com/AusertDream/TravelPlanner.git', tC1, tC1 + 1.4);
  to(c2, tC2 - 0.1, {opacity: 0}, {opacity: 1}, 0.1); typeText(c2.querySelector('[data-ty]'), 'cd TravelPlanner && node scripts/install.mjs', tC2, tC2 + 1.1);
  const outs = [['<span class="ok">✓</span> 复制工具脚本和技能', W('l28', '装好')], ['<span class="ok">✓</span> 拉取并编译 12306 MCP', W('l28', '编译')], ['<span class="ok">✓</span> 注册为 DSH bundle', W('l28', '工具') + 0.25], ['<span class="hl">◎</span> 环境自检 doctor.mjs', W('l28', '环境')],
    ['   <span class="bad">✗</span> 缺 AMAP_KEY     <span class="dim">→ 申请方法见 docs/KEYS.md</span>', W('l28', '缺哪')], ['   <span class="bad">✗</span> 缺 FLYAI_API_KEY <span class="dim">→ 申请方法见 docs/KEYS.md</span>', W('l28', '缺哪') + 0.35], ['   <span class="dim">密钥文件：~/.dsh/preset-assets/travel-planner/.env</span>', W('l28', '申请')]];
  outs.forEach(([html, t]) => { const e = ln(html); slideIn(e, t, -20, 0, {dur: 0.25}); sfx('tick', t, 0.45); });
  const stp = box(sc.el, 'abs', 1390, 140, 460, 420, '', {zIndex: 4});
  [['装好 DSH 桌面版', 'download-cloud', W('l27', 'DSH')], ['拉下仓库', 'folder-git-2', tC1], ['运行安装脚本', 'terminal', tC2]].forEach(([n, ic, t], i) => {
    const c = box(stp, 'card', 0, i * 130, 460, 108, `<div class="row" style="gap:18px;padding:16px 22px"><div class="hy" style="min-width:66px;height:66px;border-radius:50%;background:#4D6BFE;color:#fff;font-size:40px;display:flex;align-items:center;justify-content:center;border:4px solid #1E2A78">${i + 1}</div><span style="font-weight:900;font-size:34px;color:#1B2240">${n}</span><span style="margin-left:auto">${icon(ic, 40, '#4D6BFE')}</span></div>`, {opacity: 0, boxShadow: '7px 7px 0 #1E2A78'});
    popIn(c, t, {from: {x: 60, opacity: 0, scale: 0.9}, sfx: 'pop'});
  });
  const lapc = charIn(sc, 'p_laptop', 1450, 560, 500, t26 + 0.4, {z: 5, until: L('l29').start});
  // l28: app mock
  const t28 = L('l29').start;
  out(term, t28 - 0.1, {y: -40}); out(stp, t28 - 0.1, {x: 60});
  const app = box(sc.el, 'card', 230, 150, 1180, 640, `<div style="height:70px;background:#F2F5FF;border-bottom:4px solid #1E2A78;display:flex;align-items:center;padding:0 26px;gap:12px"><i style="width:18px;height:18px;border-radius:50%;background:#FF6B5A"></i><i style="width:18px;height:18px;border-radius:50%;background:#FFC94A"></i><i style="width:18px;height:18px;border-radius:50%;background:#21B98A"></i><span style="margin-left:16px;font-weight:900;font-size:28px;color:#1E2A78">DSH</span><span data-rs style="margin-left:auto;opacity:0">${icon('refresh-cw', 40, '#4D6BFE', 2.8)}</span></div>
   <div class="row" style="height:566px;align-items:stretch"><div style="width:330px;background:#F7F8FD;border-right:4px solid #E1E5F4;padding:26px"><div data-new class="chip" style="font-size:28px;opacity:0">＋ 新建会话</div></div>
   <div style="flex:1;padding:40px 50px"><div style="font-weight:800;font-size:30px;color:#59607E">模式</div><div data-dd style="margin-top:14px;border:4px solid #1E2A78;border-radius:22px;overflow:hidden;opacity:0">${['通用助手', '旅行规划助手'].map((m, i) => `<div data-opt="${i}" class="row" style="gap:14px;padding:22px 26px;font-weight:900;font-size:36px;color:#1B2240;${i ? '' : 'border-bottom:3px solid #E1E5F4'}">${i ? icon('map-pin', 38, '#4D6BFE') : icon('message-circle', 38, '#9AA0B5')}${m}<span data-ck style="margin-left:auto;opacity:0">${i ? icon('circle-check-big', 42, '#21B98A', 3) : ''}</span></div>`).join('')}</div></div></div>`, {opacity: 0});
  popIn(app, t28, {from: {y: 60, opacity: 0, scale: 0.95}, ease: 'power3.out', sfx: 'swish'});
  const rs = app.querySelector('[data-rs]'); to(rs, W('l29', '重启'), {opacity: 0, rotation: 0}, {opacity: 1, rotation: 360}, 0.9, 'power2.out');
  popIn(app.querySelector('[data-new]'), W('l29', '新建'), {sfx: 'tick'});
  popIn(app.querySelector('[data-dd]'), W('l29', '模式') - 0.1, {from: {y: -20, opacity: 0, scale: 0.95}, sfx: 'pop2'});
  const opt = app.querySelector('[data-opt="1"]'), tSel = W('l29', '旅行');
  to(opt, tSel, {backgroundColor: 'rgba(77,107,254,0)'}, {backgroundColor: 'rgba(77,107,254,.16)'}, 0.3); popIn(opt.querySelector('[data-ck]'), tSel + 0.1, {sfx: 'ding', gain: 0.45});
  const sur = box(sc.el, 'cw', 1430, 380, 466, 700, `<img src="img/p_surprise.png">`, {opacity: 0, zIndex: 5});
  swapChar(lapc, sur, t28 + 0.05); bob(sur.firstChild, t28 + 0.6, sc.end, 10, 1.1);
  const go = box(sc.el, 'hy wstroke', 1180, 700, null, null, '出发！', {fontSize: '150px', color: '#FFC94A', textShadow: '10px 10px 0 #1E2A78', opacity: 0, zIndex: 7});
  popIn(go, W('l29', '出发'), {rot0: -25, rot: -8, sfx: 'stamp', gain: 0.6}); sfx('sparkle', W('l29', '出发') + 0.1, 0.5);
}

// ---------- 13. OUTRO ----------
{
  const sc = scenes.outro;
  bgImg(sc, 'bg_sky', {s0: 1.08, s1: 1.02});
  shade(sc, 'linear-gradient(90deg, rgba(255,255,255,.55), rgba(255,255,255,0) 60%)');
  const t29 = L('l30').start;
  charIn(sc, 'p_wave', 1250, 200, 860, sc.start + 0.3, {amp: 12});
  const blk = box(sc.el, 'col', 120, 120, 1100, null, '', {gap: '10px'});
  const a = h('div', {parent: blk, class: 'hy wstroke', style: {fontSize: '150px', color: '#1E2A78', opacity: 0, lineHeight: '1.1'}}, 'TravelPlanner');
  const b = h('div', {parent: blk, class: 'kl wstroke', style: {fontSize: '66px', letterSpacing: '4px', color: '#2F4BD8', opacity: 0}}, 'DeepSeek 的旅行规划助手');
  popIn(a, sc.start + 0.5, {from: {y: 40, opacity: 0, scale: 0.9}, sfx: 'pop'}); popIn(b, sc.start + 0.75, {from: {y: 30, opacity: 0}, sfx: null});
  const gh = box(sc.el, 'card', 120, 450, 1000, 150, `<div class="row" style="gap:24px;padding:26px 34px"><div style="width:92px;height:92px;border-radius:24px;background:#1B2240;display:flex;align-items:center;justify-content:center">${icon('folder-git-2', 54, '#fff')}</div><div><div class="mono" style="font-weight:700;font-size:40px;color:#1B2240">github.com/AusertDream/TravelPlanner</div><div style="font-size:26px;font-weight:800;color:#59607E;margin-top:4px">MIT 开源 · DSH agent preset · 9 个技能</div></div></div>`, {opacity: 0});
  popIn(gh, W('l30', 'GitHub'), {from: {y: 60, opacity: 0, scale: 0.9}, ease: 'back.out(1.6)', sfx: 'ding', gain: 0.45});
  const tri = box(sc.el, 'row', 120, 650, null, null, '', {gap: '30px'});
  const tl30 = W('l31', '一键');
  [['thumbs-up', '点赞', '#FF6B9A'], ['coins', '投币', '#4D6BFE'], ['star', '收藏', '#FFB020']].forEach(([ic, n, c], i) => {
    const e = h('div', {parent: tri, class: 'col', style: {alignItems: 'center', gap: '8px', opacity: 0}}, `<div style="width:130px;height:130px;border-radius:50%;background:${c};border:6px solid #1E2A78;box-shadow:6px 6px 0 #1E2A78;display:flex;align-items:center;justify-content:center">${icon(ic, 68, '#fff', 2.6)}</div><div style="font-weight:900;font-size:32px;color:#1E2A78">${n}</div>`);
    popIn(e, tl30 + i * 0.28, {sfx: 'ding_hi', gain: 0.4});
  });
  const slog = box(sc.el, 'kl wstroke', 640, 670, null, null, '下一次旅行<br>就交给我吧！', {fontSize: '76px', color: '#4D6BFE', lineHeight: '1.25', opacity: 0, whiteSpace: 'nowrap'});
  popIn(slog, chunk('l31', 1), {from: {x: 40, opacity: 0, scale: 0.8}, sfx: 'sparkle', gain: 0.5});
  const cr = box(sc.el, 'abs', 120, 958, 1100, null, '音乐：Life of Riley — Kevin MacLeod (incompetech.com) · CC BY 4.0<br>角色：DeepSeek 旅行装二创', {fontSize: '22px', lineHeight: '1.6', fontWeight: 700, color: '#1E2A78', opacity: 0});
  to(cr, L('l31').speech_end + 0.3, {opacity: 0}, {opacity: 0.85}, 0.6);
  const fade = box(sc.el, 'fill', 0, 0, 1920, 1080, '', {background: '#0E1438', opacity: 0, zIndex: 70});
  to(fade, TL.total - 0.9, {opacity: 0}, {opacity: 1}, 0.9, 'power1.in');
}

// ---------- subtitles ----------
const subEl = h('div', {id: 'subs'}, '<span></span>'); const subSpan = subEl.firstChild;
const allSubs = Object.values(TL.lines).flatMap(l => l.subs).sort((a, b) => a.s - b.s);
allSubs.forEach((s, i) => { const n = allSubs[i + 1]; s.de = n ? Math.min(s.e + 0.15, n.s - 0.05) : s.e + 0.15; s.fo = !n || n.s - s.e > 0.25; s.fi = i === 0 || s.s - allSubs[i - 1].e > 0.25; });
dyn.push(t => {
  const s = allSubs.find(s => t >= s.s - 0.05 && t < s.de);
  subEl.style.bottom = t < S('hook').end ? '140px' : '46px';   // 开头最下面留给走路的 DeepSeek
  if (!s) { subEl.style.opacity = 0; return; }
  if (subSpan.textContent !== s.text) subSpan.textContent = s.text;
  const fin = s.fi ? Math.min(1, (t - s.s + 0.05) / 0.12) : 1, fout = s.fo ? Math.min(1, (s.de - t) / 0.12) : 1;
  subEl.style.opacity = Math.max(0, Math.min(fin, fout));
  subEl.style.transform = `translateY(${(1 - fin) * 10}px)`;
});

// ---------- wipe transitions ----------
const wipe = h('div', {id: 'wipe'});
const wave = (fill, amp) => { let d = `M300 0 `; for (let y = 0; y <= 1080; y += 60) d += `Q ${300 + (y / 60 % 2 ? amp : -amp)} ${y + 30} 300 ${y + 60} `; d += `L 3700 1140 `; for (let y = 1080; y >= 0; y -= 60) d += `Q ${3700 + (y / 60 % 2 ? amp : -amp)} ${y - 30} 3700 ${y - 60} `; return `<path d="${d}Z" fill="${fill}"/>`; };
wipe.innerHTML = `<svg width="4000" height="1080" style="position:absolute;left:0;top:0" data-w1>${wave('#7B93FF', 70)}</svg><svg width="4000" height="1080" style="position:absolute;left:0;top:0" data-w2>${wave('#4D6BFE', 60)}<g fill="rgba(255,255,255,.18)">${Array.from({length: 26}, () => `<circle cx="${400 + rnd() * 3200}" cy="${rnd() * 1080}" r="${8 + rnd() * 30}"/>`).join('')}</g></svg>`;
const w1 = wipe.querySelector('[data-w1]'), w2 = wipe.querySelector('[data-w2]');
gsap.set([w1, w2], {x: 2200});
TL.scenes.slice(1).forEach(sc => {
  const b = sc.start, D = 1.0;
  tl.fromTo(w1, {x: 2000}, {x: -4300, duration: D, ease: 'power2.inOut', immediateRender: false}, b - D / 2 - 0.05);
  tl.fromTo(w2, {x: 2000}, {x: -4300, duration: D, ease: 'power2.inOut', immediateRender: false}, b - D / 2 + 0.03);
  sfx('whoosh', b - 0.42, 0.55);
});

// ---------- seek API ----------
window.TOTAL = TL.total;
window.seek = t => { tl.seek(t, false); for (const f of dyn) f(t); };
window.ready = (async () => {
  await document.fonts.ready;
  const imgs = [...document.images];
  await Promise.all(imgs.map(i => i.decode().catch(() => console.warn('img fail', i.src))));
  window.seek(0);
  return true;
})();
