/**
 * 高德真实路线（amap-route）—— 拿到**真实路径折线**，不再是途经点连线示意
 * ============================================================
 * 为什么不用 `amap-gui route`：它在容器里画得出路线，但 CLI 只返回文字步骤，不返回坐标。
 * 这里在无头 Chrome 里直接调用**同一个高德 JSAPI 2.0**（同一把 AMAP_KEY + 安全密钥），
 * 拿 Driving / Walking / Riding / Transfer 的完整 path。Key 运行时注入，不落盘。
 *
 * 用法（必须经 run.sh，才拿得到 AMAP_KEY / AMAP_SECURITY_KEY）：
 *   bash ~/.dsh/preset-assets/travel-planner/run.sh node ~/.dsh/preset-assets/travel-planner/amap-route.mjs \
 *        --legs legs.json --out routes.json
 *   # 单段快速试：
 *   bash .../run.sh node .../amap-route.mjs --from 108.9423,34.2610 --to 109.2785,34.3841 --mode transit --city 西安
 *
 * legs.json：[{ "from":[lng,lat], "to":[lng,lat], "mode":"driving|walking|riding|transit",
 *              "city":"西安"(transit 必填), "waypoints":[[lng,lat],...](仅 driving),
 *              "policy":"fastest|shortest|no_highway|least_fee"(driving) | "fastest|least_walk|least_transfer|no_subway"(transit) }]
 * 输出：{ legs:[{ mode, distance(米), time(秒), tolls?, cost?(公交票价), path:[[lng,lat],...],
 *                segments?:[{ mode:"WALK|BUS|SUBWAY|RAILWAY|TAXI", line?, from?, to?, stops?, distance, time }],
 *                error? }] }
 * 坐标全是 GCJ-02。path 已按视野做过抽稀（默认保留约 1/3000 跨度的细节）。
 * map-widget.py 的 spec 写 "real_route": "transit" 等，会自动调用本脚本。
 */
import { spawn } from 'node:child_process';
import net from 'node:net'; import http from 'node:http';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';

const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : undefined; };
const KEY = (process.env.AMAP_KEY || '').trim(), SEC = (process.env.AMAP_SECURITY_KEY || '').trim();
if (!KEY) { console.error('❌ 没有 AMAP_KEY：请经 run.sh 调用（bash ~/.dsh/preset-assets/travel-planner/run.sh node amap-route.mjs ...）'); process.exit(2); }

const ll = s => s.split(',').map(Number);
let legs;
if (opt('legs')) legs = JSON.parse(fs.readFileSync(opt('legs'), 'utf8'));
else if (opt('from') && opt('to')) legs = [{ from: ll(opt('from')), to: ll(opt('to')), mode: opt('mode') || 'driving', city: opt('city') }];
else { console.error('用法见文件头注释：--legs legs.json 或 --from lng,lat --to lng,lat --mode transit --city 西安'); process.exit(2); }

const CHROME = [
  process.env.CHROME_PATH, // 浏览器装在别处时，在 .env 里写 CHROME_PATH=完整路径（经 run.sh 调用时生效）
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge',
].find(p => p && fs.existsSync(p));
if (!CHROME) { console.error('❌ 找不到 Chrome/Edge'); process.exit(2); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9300 + Math.floor(Math.random() * 90);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'amap-route-'));
// 高德是国内站点：不走代理（走代理反而常失败）
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-proxy-server',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
const killer = setTimeout(() => { console.error('❌ 超时（90s）'); chrome.kill(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(3); }, 90000);
const getJSON = u => new Promise((res, rej) => http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));

// 在页面里跑的部分：加载 JSAPI，逐段规划
const PAGE_FN = async (KEY, SEC, LEGS) => {
  window._AMapSecurityConfig = { securityJsCode: SEC };
  await new Promise((res, rej) => { const s = document.createElement('script');
    s.src = 'https://webapi.amap.com/maps?v=2.0&key=' + KEY + '&plugin=AMap.Driving,AMap.Walking,AMap.Riding,AMap.Transfer';
    s.onload = res; s.onerror = () => rej(new Error('JSAPI 加载失败')); document.head.appendChild(s); });
  const P = p => [+p.lng.toFixed(6), +p.lat.toFixed(6)];
  const LL = a => new AMap.LngLat(a[0], a[1]);
  const call = (svc, ...a) => new Promise(res => svc.search(...a, (status, result) => res({ status, result })));
  const DP = { fastest: AMap.DrivingPolicy.LEAST_TIME, shortest: AMap.DrivingPolicy.LEAST_DISTANCE,
    no_highway: AMap.DrivingPolicy.REAL_TRAFFIC, least_fee: AMap.DrivingPolicy.LEAST_FEE };
  const TP = { fastest: AMap.TransferPolicy.LEAST_TIME, least_walk: AMap.TransferPolicy.LEAST_WALK,
    least_transfer: AMap.TransferPolicy.LEAST_TRANSFER, no_subway: AMap.TransferPolicy.NO_SUBWAY };
  const out = [];
  const nap = ms => new Promise(r => setTimeout(r, ms));
  // 高德 JSAPI 服务有 QPS 上限（实测连发 5 段会报 CUQPS_HAS_EXCEEDED_THE_LIMIT）：段间歇一下，超限就退避重试
  const isQps = e => /QPS|EXCEEDED|LIMIT/i.test(String(e && e.message || e));
  for (const [li, L] of LEGS.entries()) {
    const mode = L.mode || 'driving';
    if (li) await nap(400);
    for (let attempt = 0; ; attempt++) {
    const before = out.length;
    try {
      if (mode === 'driving') {
        const svc = new AMap.Driving({ policy: DP[L.policy] ?? AMap.DrivingPolicy.LEAST_TIME });
        const { status, result } = await call(svc, LL(L.from), LL(L.to), { waypoints: (L.waypoints || []).map(LL) });
        if (status !== 'complete') throw new Error(typeof result === 'string' ? result : status);
        const r = result.routes[0];
        out.push({ mode, distance: r.distance, time: r.time, tolls: r.tolls,
          path: r.steps.flatMap(s => s.path.map(P)) });
      } else if (mode === 'walking' || mode === 'riding') {
        const svc = mode === 'walking' ? new AMap.Walking() : new AMap.Riding();
        const { status, result } = await call(svc, LL(L.from), LL(L.to));
        if (status !== 'complete') throw new Error(typeof result === 'string' ? result : status);
        const r = result.routes[0];
        const steps = r.steps || r.rides || [];
        out.push({ mode, distance: r.distance, time: r.time, path: steps.flatMap(s => (s.path || []).map(P)) });
      } else if (mode === 'transit') {
        if (!L.city) throw new Error('transit 必须给 city');
        const svc = new AMap.Transfer({ city: L.city, cityd: L.cityd || L.city, policy: TP[L.policy] ?? AMap.TransferPolicy.LEAST_TIME });
        const { status, result } = await call(svc, LL(L.from), LL(L.to));
        if (status !== 'complete' || !result.plans?.length) throw new Error(typeof result === 'string' ? result : (status === 'no_data' ? '没有公交方案（可能太近，改步行）' : status));
        const plan = result.plans[0];
        const segments = plan.segments.map(s => {
          const t = s.transit || {}, line = t.lines && t.lines[0];
          return { mode: s.transit_mode, distance: s.distance, time: s.time,
            line: line ? line.name : undefined,
            from: t.on_station ? t.on_station.name : undefined, to: t.off_station ? t.off_station.name : undefined,
            stops: t.via_num !== undefined ? t.via_num + 1 : undefined,
            path: (t.path || (t.steps || []).flatMap(x => x.path || [])).map(P) };
        });
        out.push({ mode, distance: plan.distance, time: plan.time, cost: plan.cost,
          path: plan.path ? plan.path.map(P) : segments.flatMap(s => s.path), segments });
      } else throw new Error('未知 mode：' + mode);
    } catch (e) {
      if (isQps(e) && attempt < 4) { out.length = before; await nap(800 * (attempt + 1)); continue; }
      out.push({ mode, error: String(e && e.message || e), path: [L.from, L.to] });
    }
    break;
    }
  }
  return JSON.stringify(out);
};

// Douglas–Peucker 抽稀
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let md = 0, mi = -1;
    const [x1, y1] = pts[a], [x2, y2] = pts[b], dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy || 1e-18;
    for (let i = a + 1; i < b; i++) {
      const t = Math.max(0, Math.min(1, ((pts[i][0] - x1) * dx + (pts[i][1] - y1) * dy) / L2));
      const ex = x1 + t * dx - pts[i][0], ey = y1 + t * dy - pts[i][1], d = ex * ex + ey * ey;
      if (d > md) { md = d; mi = i; }
    }
    if (mi > 0 && md > tol * tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

try {
  for (let i = 0; i < 80; i++) { const ok = await new Promise(r => { const s = net.connect(PORT, '127.0.0.1');
    s.on('connect', () => { s.destroy(); r(true); }); s.on('error', () => r(false)); }); if (ok) break; await sleep(250); }
  const page = (await getJSON(`http://127.0.0.1:${PORT}/json/list`)).find(x => x.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const expr = `(${PAGE_FN.toString()})(${JSON.stringify(KEY)}, ${JSON.stringify(SEC)}, ${JSON.stringify(legs)})`;
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
  const res = JSON.parse(r.result.result.value);
  for (const L of res) {
    const xs = L.path.map(p => p[0]), ys = L.path.map(p => p[1]);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const tol = span / Number(opt('detail') || 3000);
    L.points_raw = L.path.length; L.path = simplify(L.path, tol);
    for (const s of L.segments || []) s.path = simplify(s.path, tol);
  }
  const out = JSON.stringify({ legs: res }, null, 0);
  if (opt('out')) fs.writeFileSync(opt('out'), out);
  for (const [i, L] of res.entries())
    console.error(L.error ? `段 ${i + 1} ${L.mode}: ❌ ${L.error}（已退回直线示意）`
      : `段 ${i + 1} ${L.mode}: ${(L.distance / 1000).toFixed(1)} km / ${Math.round(L.time / 60)} 分钟` +
        (L.tolls ? ` / 过路费 ¥${L.tolls}` : '') + (L.cost ? ` / 票价 ¥${L.cost}` : '') +
        (L.segments ? ' / ' + L.segments.filter(s => s.line).map(s => `${s.line}(${s.from}→${s.to})`).join(' → ') : '') +
        `  折线 ${L.points_raw}→${L.path.length} 点`);
  if (!opt('out')) process.stdout.write(out + '\n');
} catch (e) { console.error('❌', e.message); process.exitCode = 1; }
finally {
  clearTimeout(killer); chrome.kill();
  // 临时 Chrome 配置目录用完就删（每次约 8 MB，不删会在 %TEMP% 里越积越多）；Chrome 退出要一点时间，稍等再删
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {}
}
