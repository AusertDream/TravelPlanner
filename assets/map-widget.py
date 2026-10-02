# -*- coding: utf-8 -*-
"""
交互地图组件（map-widget）—— 一条命令出一个可直接粘进路书的 <figure>
=============================================================
用法：
  bash ~/.dsh/preset-assets/travel-planner/run.sh python map-widget.py --spec spec.json --out map.frag.html
  # 想单独看效果：再加 --demo demo.html（输出一个能直接打开的完整页面）

spec 与 map-render2.py 相同（points / route / width / height / title / style / zoom …），另加：
  id        组件 id（同页多张图时必须不同），默认 tm-<随机>
  mode      全程默认交通方式，用于导航链接：drive | transit | walk | ride（默认 transit）
  caption   图注（可选）
  autoload  true 时页面打开就尝试交互地图（有 Google key 时默认 true，否则 false）
  points[i].leg   这一站「从上一站过来」的方式，覆盖 mode
  points[i].key   label 为 "key" 时只给 key:true 的点常显名字
  focus     "auto"（默认）：离群点（如 70 km 外的机场）不参与框选，在图边放「↘ 名字 · 距离」指示牌；"all" 全部框进来
  real_route  transit | drive | walk | ride：按 points 顺序逐段向高德要**真实路线**（amap-route.mjs），
              画真实折线，清单里写每段的里程/耗时/票价/线路；points[i].leg 覆盖该段方式，city 指定公交城市
              （必须经 run.sh 调用，要 AMAP_KEY）。不写则 route 画直线示意。

页面上呈现成什么样（降级链，任何一层失败都**保留静态图**，绝不白屏）：
  0. 静态底图（map-render2，hd=2）+ HTML 点位与中文名（永远锐利、可点）+ SVG 路线
  1. 有 GOOGLE_MAPS_API_KEY 且连得上 Google → Google Maps JavaScript API：
     编号点 + 中文名标签 + 路线 + 自动适配视野（language=zh-CN）
  2. 无 key、连得上 Google → Google 无 key 嵌入（output=embed），点下方清单切换中心点
  3. 连不上 Google（境内常态）→ Leaflet + 高德瓦片（免 key、GCJ-02 原生对齐）
  4. 连 CDN 都不行 → 停在第 0 层，提示一句
  另外每一站都给「高德打开 / Google 打开 / 从上一站导航」链接（手机上会唤起 App）。

坐标：一律 GCJ-02（高德 searchPOI 原样）。Google 在中国大陆的道路图本身就是 GCJ-02
底图，所以直接用不偏；境外点高德返回的就是 WGS-84，同样直接用。只有切卫星图才会偏——
本组件只用道路图。

⚠️ Key 会写进 HTML：Maps JavaScript API 的 key 本来就是前端可见的，但路书会被转发，
所以 key 必须在 Google Cloud 控制台里「API 限制」只勾 Maps JavaScript API，并设好用量上限。
file:// 打开的页面没有 Referer，「网站限制」会让地图报错——本地看就别加网站限制。
"""
import argparse, datetime, html, importlib.util, json, os, random, string, subprocess, sys, tempfile, urllib.parse
for _s in (sys.stdout, sys.stderr):   # Windows 控制台默认 GBK，打印 ⚠ 会崩
    try:
        _s.reconfigure(encoding='utf-8')
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("map_render2", os.path.join(HERE, "map-render2.py"))
mr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mr)

MODES = {  # 高德 uri mode / Google travelmode / 中文
    "drive": ("car", "driving", "驾车"),
    "transit": ("bus", "transit", "公交地铁"),
    "walk": ("walk", "walking", "步行"),
    "ride": ("ride", "bicycling", "骑行"),
}
HEX = {k: "#%02x%02x%02x" % v for k, v in mr.COLORS.items()}


def amap_marker(p):
    return "https://uri.amap.com/marker?" + urllib.parse.urlencode({
        "position": "%.6f,%.6f" % (p["lng"], p["lat"]), "name": p["name"],
        "coordinate": "gaode", "callnative": "1"})


def amap_nav(a, b, mode):
    return "https://uri.amap.com/navigation?" + urllib.parse.urlencode({
        "from": "%.6f,%.6f,%s" % (a["lng"], a["lat"], a["name"]),
        "to": "%.6f,%.6f,%s" % (b["lng"], b["lat"], b["name"]),
        "mode": MODES[mode][0], "coordinate": "gaode", "callnative": "1"})


def google_place(p):
    return "https://www.google.com/maps/search/?api=1&query=%.6f,%.6f" % (p["lat"], p["lng"])


def google_dir(a, b, mode):
    return ("https://www.google.com/maps/dir/?api=1&origin=%.6f,%.6f&destination=%.6f,%.6f&travelmode=%s"
            % (a["lat"], a["lng"], b["lat"], b["lng"], MODES[mode][1]))


AMODE = {"drive": "driving", "walk": "walking", "ride": "riding", "transit": "transit",
         "driving": "driving", "walking": "walking", "riding": "riding"}
WMODE = {"driving": "drive", "walking": "walk", "riding": "ride", "transit": "transit"}
SEGC = {"WALK": "#6b7280", "SUBWAY": "#2563eb", "METRO_RAIL": "#2563eb", "BUS": "#059669",
        "RAILWAY": "#7c3aed", "TAXI": "#e08a00"}
LEGC = {"driving": "#e63c3c", "riding": "#0f9d8a", "walking": "#6b7280", "transit": "#2563eb"}


def fetch_real_routes(spec, pts):
    """spec["real_route"] = 默认方式（transit/drive/walk/ride）；按 points 顺序逐段向高德要真实路线。
    每个点的 leg 覆盖「从上一站到这里」的方式，city 覆盖公交城市。失败的段退回直线示意。"""
    rr = spec.get("real_route")
    if not rr or len(pts) < 2:
        return None
    if not os.environ.get("AMAP_KEY"):
        sys.stderr.write("⚠ real_route 需要 AMAP_KEY：请经 run.sh 调用 map-widget.py；本次退回直线示意。\n")
        return None
    legs = []
    for a, b in zip(pts, pts[1:]):
        m = AMODE.get(b.get("leg") or rr, "transit")
        legs.append({"from": [a["lng"], a["lat"]], "to": [b["lng"], b["lat"]], "mode": m,
                     "city": b.get("city") or spec.get("city"), "policy": b.get("policy")})
    d = tempfile.mkdtemp(prefix="tm-route-")
    lf, of = os.path.join(d, "legs.json"), os.path.join(d, "routes.json")
    with open(lf, "w", encoding="utf-8") as f:
        json.dump(legs, f, ensure_ascii=False)
    try:
        r = subprocess.run(["node", os.path.join(HERE, "amap-route.mjs"), "--legs", lf, "--out", of],
                           capture_output=True, text=True, encoding="utf-8", timeout=180)
        sys.stderr.write(r.stderr)
        with open(of, encoding="utf-8") as f:
            return json.load(f)["legs"]
    except Exception as e:
        sys.stderr.write("⚠ 真实路线获取失败（%s），退回直线示意。\n" % e)
        return None
    finally:
        import shutil
        shutil.rmtree(d, ignore_errors=True)   # 临时目录用完即删


def leg_summary(L):
    if L.get("error"):
        return "路线没查到（%s），图上是直线示意" % L["error"]
    t = "%s %.1f km · %d 分钟" % (MODES[WMODE.get(L["mode"], "transit")][2], L["distance"] / 1000.0, round(L["time"] / 60.0))
    if L.get("tolls"):
        t += " · 过路费 ¥%s" % L["tolls"]
    if L.get("cost"):
        t += " · 票价 ¥%s" % L["cost"]
    lines = ["%s（%s→%s）" % (sg["line"].split("(")[0], sg.get("from") or "", sg.get("to") or "")
             for sg in L.get("segments") or [] if sg.get("line")]
    if lines:
        t += " · " + " → ".join(lines)
    return t


def km(a, b):
    import math
    R = 6371.0
    p1, p2 = math.radians(a["lat"]), math.radians(b["lat"])
    dp, dl = p2 - p1, math.radians(b["lng"] - a["lng"])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def find_outliers(pts):
    """离群点（典型：机场离市区 70 km）：别让它决定缩放，否则市内几个点挤成一团。
    规则：去掉它以后，它到其余点中心的距离 > 其余点自身半径的 4 倍且 > 8 km。最多剔 2 个。"""
    if len(pts) < 3:
        return set()
    out = set()
    for _ in range(2):
        rest = [i for i in range(len(pts)) if i not in out]
        best, bd = None, 0
        for i in rest:
            others = [pts[j] for j in rest if j != i]
            if len(others) < 2:
                return out
            c = {"lat": sum(o["lat"] for o in others) / len(others), "lng": sum(o["lng"] for o in others) / len(others)}
            spread = max(km(c, o) for o in others) or 0.3
            d = km(c, pts[i])
            if d > max(4 * spread, 8) and d > bd:
                best, bd = i, d
        if best is None:
            break
        out.add(best)
    return out


ARROWS = ["→", "↘", "↓", "↙", "←", "↖", "↑", "↗"]


def text_w(s, size=13):
    return sum(size if ord(c) > 0x2E80 else size * 0.58 for c in s) + 12


def place_labels(stops, W, H, label_mode):
    """贪心避让：右 → 左 → 上 → 下，放不下就只留编号（名字在下方清单里）。"""
    lh, r = 20, 11
    taken = [(s["x"] - r, s["y"] - r, s["x"] + r, s["y"] + r) for s in stops]

    def ok(b):
        if b[0] < 2 or b[1] < 2 or b[2] > W - 2 or b[3] > H - 2:
            return False
        return all(b[2] < q[0] or b[0] > q[2] or b[3] < q[1] or b[1] > q[3] for q in taken)

    for s in stops:
        s["lab"] = None
        if label_mode is False or (label_mode == "key" and not s.get("key")):
            continue
        w = text_w(s["name"])
        x, y = s["x"], s["y"]
        for gap in (r + 3, r + 14):
            for b in ((x + gap, y - lh / 2, x + gap + w, y + lh / 2),
                      (x - gap - w, y - lh / 2, x - gap, y + lh / 2),
                      (x - w / 2, y - gap - lh, x + w / 2, y - gap),
                      (x - w / 2, y + gap, x + w / 2, y + gap + lh)):
                if ok(b):
                    s["lab"] = b
                    taken.append(b)
                    break
            if s["lab"]:
                break


CSS = """
.tmap{margin:0 0 18px;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
.tmap .tm-stage{position:relative;width:100%;height:auto;overflow:hidden;border-radius:10px;background:#eceae4;line-height:0}
.tmap .tm-base{display:block;width:100%;height:auto;max-width:none}
.tmap .tm-route{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.tmap .tm-pin{position:absolute;min-width:20px;height:20px;padding:0 3px;transform:translate(-50%,-50%);border-radius:10px;border:2px solid #fff;box-sizing:border-box;white-space:nowrap;
  color:#fff;font:700 11px/16px system-ui,sans-serif;text-align:center;text-decoration:none;box-shadow:0 1px 3px rgba(0,0,0,.35);z-index:2}
.tmap .tm-lab{position:absolute;white-space:nowrap;font:600 13px/20px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
  color:#15171b;background:rgba(255,255,255,.94);padding:0 6px;border-radius:4px;box-shadow:0 1px 2px rgba(0,0,0,.18);z-index:1;text-decoration:none}
.tmap .tm-far{position:absolute;transform:translate(-50%,-50%);display:flex;align-items:center;gap:6px;white-space:nowrap;font:600 12.5px/22px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#15171b;background:rgba(255,255,255,.95);border:1.5px solid;border-radius:12px;padding:0 9px 0 3px;text-decoration:none;box-shadow:0 1px 3px rgba(0,0,0,.2);z-index:3}
.tmap .tm-far i{width:16px;height:16px;border-radius:50%;color:#fff;font:700 10px/16px system-ui,sans-serif;text-align:center;font-style:normal}
.tmap.tm-on .tm-far{visibility:hidden}
.tmap .tm-live{position:absolute;inset:0;background:#eceae4;z-index:5;line-height:normal}
.tmap .tm-live.tm-loading{opacity:0;pointer-events:none}
.tmap.tm-on .tm-base,.tmap.tm-on .tm-pin,.tmap.tm-on .tm-lab,.tmap.tm-on .tm-route{visibility:hidden}
.tmap .tm-live iframe{width:100%;height:100%;border:0;display:block}
.tmap .tm-live .leaflet-container{width:100%;height:100%}
.tmap .tm-tip{font:600 12px/1.3 system-ui,"PingFang SC","Microsoft YaHei",sans-serif;padding:1px 6px}
.tmap .tm-glab{background:rgba(255,255,255,.94);padding:1px 6px;border-radius:4px;box-shadow:0 1px 2px rgba(0,0,0,.2)}
.tmap .tm-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:10px 0 6px;font-size:13px;color:#5a5e66}
.tmap .tm-bar button{font:600 13px system-ui,sans-serif;padding:6px 12px;border-radius:999px;border:1px solid #c9ccd2;background:#fff;color:#1b1d22;cursor:pointer}
.tmap .tm-bar button[hidden]{display:none}
.tmap .tm-list{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:6px 18px;font-size:14px}
.tmap .tm-list li{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px;padding:4px 0;border-bottom:1px solid rgba(0,0,0,.07);min-width:0}
.tmap .tm-list i{flex:none;width:20px;height:20px;border-radius:50%;color:#fff;font:700 11px/20px system-ui,sans-serif;text-align:center;font-style:normal}
.tmap .tm-list b{font-weight:600;cursor:pointer}
.tmap .tm-list a{font-size:12.5px;white-space:nowrap}
.tmap .tm-list .tm-leg{flex-basis:100%;font-size:12.5px;color:#5a5e66;line-height:1.5;padding-left:28px}
.tmap figcaption{font-size:13px;color:#5a5e66;margin-top:8px;line-height:1.6}
@media (max-width:700px){.tmap .tm-lab{font-size:11px;line-height:17px;padding:0 4px}}
@media (prefers-color-scheme:dark){.tmap .tm-bar,.tmap figcaption{color:#a9adb5}.tmap .tm-list li{border-color:rgba(255,255,255,.1)}}
"""

JS = r"""
(function(){
var C=__CFG__;
var root=document.getElementById(C.id); if(!root) return;
var live=root.querySelector('.tm-live'), st=root.querySelector('.tm-status');
var goBtn=root.querySelector('.tm-go'), backBtn=root.querySelector('.tm-back');
var active=null, busy=false, at=0;
var G=window.__tmShared||(window.__tmShared={gBad:false,authFail:[],g:null,leaf:null});
// 静态层按**实际显示宽度**去重叠：标签是按 1040px 排的，手机上会挤成一团。
// 相撞的点合并成「1·2」，会撞的名字先藏起来（下方清单里都有）。
function declutter(){
  var stage=root.querySelector('.tm-stage'); if(!stage.clientWidth) return;
  var pins=[].slice.call(root.querySelectorAll('.tm-pin')), labs=[].slice.call(root.querySelectorAll('.tm-lab'));
  pins.forEach(function(p){ p.style.display=''; p.textContent=p.getAttribute('data-n'); });
  labs.forEach(function(l){ l.style.display=''; });
  var sr=stage.getBoundingClientRect();
  function rect(e){ var r=e.getBoundingClientRect(); return [r.left-1,r.top-1,r.right+1,r.bottom+1]; }
  function hit(a,b){ return !(a[2]<=b[0]||a[0]>=b[2]||a[3]<=b[1]||a[1]>=b[3]); }
  var kept=[];
  pins.forEach(function(p){ var r=rect(p), host=null;
    for(var k=0;k<kept.length;k++){ if(hit(kept[k].r,r)){ host=kept[k]; break; } }
    if(host){ p.style.display='none'; host.el.textContent+='·'+p.getAttribute('data-n'); host.r=rect(host.el);
      var lab=root.querySelector('.tm-lab[data-i="'+p.getAttribute('data-i')+'"]'); if(lab) lab.style.display='none'; }
    else kept.push({el:p,r:r}); });
  var boxes=kept.map(function(k){ return rect(k.el); });
  labs.forEach(function(l){ if(l.style.display==='none') return; var r=rect(l);
    if(r[0]<sr.left||r[2]>sr.right||r[1]<sr.top||r[3]>sr.bottom||boxes.some(function(b){ return hit(b,r); })) l.style.display='none';
    else boxes.push(r); });
}
var base=root.querySelector('.tm-base'), rz=null;
if(base.complete) declutter(); else base.addEventListener('load',declutter);
window.addEventListener('resize',function(){ clearTimeout(rz); rz=setTimeout(declutter,120); });

function say(t){ st.textContent=t; }
function tw(t){ var w=12; for(var i=0;i<t.length;i++) w+=t.charCodeAt(i)>0x2E80?13:7.5; return w; }
function hit(a,b){ return !(a[2]<=b[0]||a[0]>=b[2]||a[3]<=b[1]||a[1]>=b[3]); }
// 在线层的名字标签也要避让：xy(s) 给出当前缩放下的像素坐标；撞了就只显示编号，名字在下方清单里
function labelPlan(xy){ var dots=C.stops.map(function(s){ var p=xy(s); return [p[0]-10,p[1]-10,p[0]+10,p[1]+10]; }), kept=[];
  return C.stops.map(function(s,i){ if(!(C.labels&&s.showLab)) return 'none'; var p=xy(s), w=tw(s.name), b=[p[0]-w/2,p[1]+11,p[0]+w/2,p[1]+31];
    var clash=dots.some(function(q,j){ return j!==i&&hit(q,b); })||kept.some(function(q){ return hit(q,b); });
    if(clash) return 'num'; kept.push(b); return 'name'; }); }
function once(fn){ var d=false; return function(v){ if(!d){ d=true; fn(v); } }; }
function probe(url,ms){ return new Promise(function(res){ res=once(res); var im=new Image();
  setTimeout(function(){res(false);},ms); im.onload=function(){res(true);}; im.onerror=function(){res(false);};
  im.src=url+'?_='+Date.now(); }); }
function script(src,ms){ return new Promise(function(res){ res=once(res); var s=document.createElement('script');
  setTimeout(function(){res(false);},ms); s.src=src; s.async=true; s.onload=function(){res(true);}; s.onerror=function(){res(false);};
  document.head.appendChild(s); }); }
function css(href){ if(document.querySelector('link[href="'+href+'"]')) return; var l=document.createElement('link');
  l.rel='stylesheet'; l.href=href; document.head.appendChild(l); }
// 在线层先「透明地」画在静态图上面，等瓦片真的出来了才切过去；超时就丢掉，静态图一直在
function stageLive(){ live.innerHTML=''; live.hidden=false; live.classList.add('tm-loading'); }
function show(){ live.classList.remove('tm-loading'); root.classList.add('tm-on'); goBtn.hidden=true; backBtn.hidden=false; }
function drop(){ live.innerHTML=''; live.hidden=true; live.classList.remove('tm-loading'); root.classList.remove('tm-on'); active=null; }
function reset(msg){ drop(); goBtn.hidden=false; backBtn.hidden=true; if(msg) say(msg); }
function ready(onReady,ms){ return new Promise(function(res){ res=once(res);
  var t=setTimeout(function(){ res(false); },ms); onReady(function(){ clearTimeout(t); res(true); }); }); }

// ── 1. Google Maps JS API（有 key）——整页只加载一次 API，多张图共用
function loadGoogle(){
  if(G.g) return G.g;
  G.g=new Promise(function(res){ res=once(res);
    if(window.google&&google.maps&&google.maps.Map){ res(true); return; }
    window.__tmGoogleReady=function(){ res(true); };
    window.gm_authFailure=function(){ G.gBad=true; res(false); G.authFail.forEach(function(f){ try{ f(); }catch(e){} }); };
    setTimeout(function(){ res(false); },9000);
    var s=document.createElement('script'); s.async=true; s.onerror=function(){ res(false); };
    s.src='https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(C.gkey)+'&language=zh-CN&region=CN&callback=__tmGoogleReady';
    document.head.appendChild(s);
  });
  return G.g;
}
function viaGoogleJs(){
  if(G.gBad) return Promise.resolve(false);
  return loadGoogle().then(function(ok){
    if(!ok||G.gBad) return false;
    stageLive(); var div=document.createElement('div'); div.style.cssText='width:100%;height:100%'; live.appendChild(div);
    var g=google.maps, map=new g.Map(div,{mapTypeControl:false,streetViewControl:false,fullscreenControl:true,gestureHandling:'cooperative'});
    var b=new g.LatLngBounds(), iw=new g.InfoWindow(), marks=[];
    C.stops.forEach(function(s){ var pos={lat:s.lat,lng:s.lng}; b.extend(pos);
      var m=new g.Marker({position:pos,map:map,title:s.name,zIndex:2,
        icon:{path:g.SymbolPath.CIRCLE,scale:9,fillColor:s.color,fillOpacity:1,strokeColor:'#fff',strokeWeight:2,labelOrigin:new g.Point(0,2.7)},
        label:(C.labels&&s.showLab)?{text:s.name,color:'#15171b',fontSize:'13px',fontWeight:'600',className:'tm-glab'}:undefined});
      m.addListener('click',function(){ iw.setContent('<b>'+s.n+'. '+s.esc+'</b><br><a target="_blank" rel="noopener" href="'+s.gurl+'">在 Google 地图打开</a>'); iw.open({map:map,anchor:m}); });
      marks.push(m);
    });
    g.event.addListener(map,'idle',function(){ var pr=map.getProjection(); if(!pr) return; var k=Math.pow(2,map.getZoom());
      labelPlan(function(s){ var p=pr.fromLatLngToPoint(new g.LatLng(s.lat,s.lng)); return [p.x*k,p.y*k]; }).forEach(function(mode,i){
        var s=C.stops[i]; marks[i].setLabel(mode==='none'?null:{text:mode==='name'?s.name:s.n,color:'#15171b',fontSize:mode==='name'?'13px':'11px',fontWeight:'600',className:'tm-glab'}); }); });
    C.paths.forEach(function(P){ P.pts.forEach(function(p){ b.extend(p); });
      new g.Polyline({path:P.pts,map:map,strokeColor:P.c,strokeWeight:P.dash?3:5,strokeOpacity:P.dash?0:.9,
        icons:P.dash?[{icon:{path:'M 0,-1 0,1',strokeOpacity:.9,strokeColor:P.c,scale:3},offset:'0',repeat:'12px'}]:null}); });
    if(C.fit){ b=new g.LatLngBounds(); C.fit.forEach(function(p){ b.extend(p); }); }   // 离群点（机场等）不参与框选
    if(C.stops.length>1||C.paths.length) map.fitBounds(b,40); else { map.setCenter(b.getCenter()); map.setZoom(15); }
    // key 被拒：Google 会先画出「出了点问题」再调 gm_authFailure —— 撤掉这层，接着降级
    G.authFail.push(function(){ if(active&&active.kind==='gjs'){ drop(); busy=true; at=Math.max(at,2); say('Google key 无效，正在换高德底图…'); next(); } });
    return ready(function(done){ g.event.addListenerOnce(map,'tilesloaded',done); },10000).then(function(ok){
      if(!ok||G.gBad){ drop(); return false; }
      active={kind:'gjs',focus:function(s){ map.panTo({lat:s.lat,lng:s.lng}); map.setZoom(Math.max(map.getZoom(),16)); }};
      show(); say('Google 地图（可拖动缩放）'); return true;
    });
  });
}
// ── 2. Google 无 key 嵌入
function ll(p){ return p.lat+','+p.lng; }
function embedUrl(lat,lng,z){ return 'https://maps.google.com/maps?q='+lat+','+lng+'&z='+z+'&hl=zh-CN&output=embed'; }
function dirUrl(seq){ return 'https://maps.google.com/maps?saddr='+ll(seq[0])+'&daddr='+seq.slice(1).map(ll).join('+to:')+'&dirflg=d&hl=zh-CN&output=embed'; }
function viaGoogleEmbed(){
  if(G.gBad) return Promise.resolve(false);   // 实测：同页 key 被拒后，无 key 嵌入也只会显示「出了点问题」
  return probe('https://www.google.com/favicon.ico',3500).then(function(ok){
    if(!ok) return false;
    // ≥2 个点：路线嵌入（saddr/daddr+to:）按游览顺序串站，Google 按驾车规划，仅示意；1 个点：地点嵌入
    var seq=(C.route.length>1?C.route:C.stops).slice(0,10);
    stageLive(); var f=document.createElement('iframe'); f.referrerPolicy='no-referrer-when-downgrade'; f.title='Google 地图';
    var p=ready(function(done){ f.onload=done; },10000);
    f.src=seq.length>1?dirUrl(seq):embedUrl(seq[0].lat,seq[0].lng,C.zoom); live.appendChild(f);
    return p.then(function(ok){
      if(!ok){ drop(); return false; }
      active={kind:'gembed',focus:function(s){ f.src=embedUrl(s.lat,s.lng,16); say('Google 地图 · 已定位到「'+s.name+'」，点「回到静态图」再进来可看全程'); }};
      show(); say(seq.length>1?'Google 地图 · 全程 '+seq.length+' 站（路线由 Google 按驾车规划，仅示意；点下方地点名可定位）':'Google 地图（无 key 嵌入）');
      return true;
    });
  });
}
// ── 3. Leaflet + 高德瓦片（境内常态）——整页只加载一次 Leaflet
function loadLeaflet(){
  if(G.leaf) return G.leaf;
  var srcs=['https://unpkg.com/leaflet@1.9.4/dist/','https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/'];
  function tryAt(i){ if(window.L&&L.map) return Promise.resolve(true); if(i>=srcs.length) return Promise.resolve(false);
    css(srcs[i]+'leaflet.css'); return script(srcs[i]+'leaflet.js',9000).then(function(ok){ return (ok&&window.L)||tryAt(i+1); }); }
  G.leaf=tryAt(0); return G.leaf;
}
function viaLeaflet(){
  return loadLeaflet().then(function(ok){
    if(!ok||!window.L) return false;
    stageLive(); var div=document.createElement('div'); div.style.cssText='width:100%;height:100%'; live.appendChild(div);
    var map=L.map(div,{scrollWheelZoom:false,zoomSnap:0.25});
    var tiles=L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
      {subdomains:'1234',maxZoom:18,attribution:'&copy; 高德地图'});
    var p=ready(function(done){ tiles.once('load',done); },10000);
    tiles.addTo(map);
    var pts=[];
    C.paths.forEach(function(P){ var q=P.pts.map(function(p){return [p.lat,p.lng];}); q.forEach(function(x){ pts.push(x); });
      L.polyline(q,{color:P.c,weight:P.dash?3:5,opacity:.9,dashArray:P.dash?'6 6':null}).addTo(map); });
    var lm=[];
    C.stops.forEach(function(s){ pts.push([s.lat,s.lng]);
      var m=L.circleMarker([s.lat,s.lng],{radius:8,color:'#fff',weight:2,fillColor:s.color,fillOpacity:1}).addTo(map);
      m.bindTooltip(s.esc,{permanent:true,direction:'bottom',offset:[0,6],className:'tm-tip'}); lm.push(m);
    });
    function ldec(){ labelPlan(function(s){ var p=map.latLngToContainerPoint([s.lat,s.lng]); return [p.x,p.y]; }).forEach(function(mode,i){
      var m=lm[i]; if(mode==='none'){ m.closeTooltip(); return; } m.setTooltipContent(mode==='name'?C.stops[i].esc:C.stops[i].n); m.openTooltip(); }); }
    map.on('zoomend moveend',ldec);
    if(C.fit) pts=C.fit.map(function(p){ return [p.lat,p.lng]; });
    function refit(){ if(pts.length>1) map.fitBounds(pts,{padding:[44,44]}); else map.setView(pts[0],15); }
    refit();
    return p.then(function(ok){
      if(!ok){ drop(); return false; }
      active={kind:'leaflet',focus:function(s){ map.setView([s.lat,s.lng],Math.max(map.getZoom(),16)); }};
      show(); setTimeout(function(){ map.invalidateSize(); refit(); ldec(); },60);
      say('高德底图（可拖动缩放）'+(G.gBad?' · Google key 无效，请检查 .env 里的 GOOGLE_MAPS_API_KEY':(C.gkey?' · Google 连不上，已自动换成高德':'')));
      return true;
    });
  });
}
var chain=[]; if(C.gkey) chain.push(viaGoogleJs); chain.push(viaGoogleEmbed, viaLeaflet);
function next(){
  if(at>=chain.length){ busy=false; reset('网络连不上在线地图，已保留上面的静态图（它本身就是完整的）'); return; }
  var f=chain[at++]; f().then(function(ok){ if(ok){ busy=false; } else next(); }, function(){ drop(); next(); });
}
function start(){ if(busy||active) return; busy=true; at=0; say('正在连接在线地图…（静态图先看着）'); next(); }
goBtn.addEventListener('click',start);
backBtn.addEventListener('click',function(){ reset('已切回静态图'); });
root.querySelectorAll('.tm-list b').forEach(function(el){
  el.addEventListener('click',function(){ var s=C.stops[+el.getAttribute('data-i')]; if(active) active.focus(s); else start(); });
});
// 自动加载：滚到附近才连（一页好几张图时不一起抢网络）
if(C.autoload){
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(es){ if(es.some(function(x){ return x.isIntersecting; })){ io.disconnect(); start(); } },{rootMargin:'300px'});
    io.observe(root);
  } else start();
}
})();
"""


def build(spec, img_path, gkey):
    pts = [p for p in (spec.get("points") or []) if p.get("name")]
    route = spec.get("route") or []
    W, H = int(spec.get("width", 1040)), int(spec.get("height", 640))
    real = fetch_real_routes(spec, pts)
    paths = []      # [{"c": 颜色, "dash": 步行虚线, "pts": [[lng, lat], ...]}]
    if real:
        route = [{"lng": p["lng"], "lat": p["lat"]} for p in pts]   # Google 嵌入层按游览顺序串站
        for L in real:
            segs = [sg for sg in (L.get("segments") or []) if len(sg.get("path") or []) >= 2]
            if segs and not L.get("error"):
                for sg in segs:
                    paths.append({"c": SEGC.get(sg["mode"], "#e63c3c"), "dash": sg["mode"] == "WALK", "pts": sg["path"]})
            else:
                paths.append({"c": "#9aa0a6" if L.get("error") else LEGC.get(L["mode"], "#e63c3c"),
                              "dash": bool(L.get("error")) or L["mode"] == "walking", "pts": L["path"]})
    elif len(route) >= 2:
        paths.append({"c": "#e63c3c", "dash": False, "pts": [[p["lng"], p["lat"]] for p in route]})
    # 点、名字、标题都由 HTML 画（永远锐利、可点）；底图只要瓦片。视野要把真实路线也框进去，
    # 但离群点（机场等）不参与框选——它在图边上放一个「↘ 名字 · 73 km」的指示牌
    far = find_outliers(pts) if spec.get("focus", "auto") == "auto" else set()
    core = [p for i, p in enumerate(pts) if i not in far] or pts
    if far:
        la0, la1 = min(p["lat"] for p in core), max(p["lat"] for p in core)
        lo0, lo1 = min(p["lng"] for p in core), max(p["lng"] for p in core)
        pad_la, pad_lo = max((la1 - la0) * 0.25, 0.004), max((lo1 - lo0) * 0.25, 0.004)
        inside = lambda q: la0 - pad_la <= q[1] <= la1 + pad_la and lo0 - pad_lo <= q[0] <= lo1 + pad_lo
        frame_pts = core + [{"lng": q[0], "lat": q[1]} for P in paths for q in P["pts"] if inside(q)]
    else:
        frame_pts = (spec.get("points") or []) + route + [{"lng": q[0], "lat": q[1]} for P in paths for q in P["pts"]]
    sp = dict(spec, pins=False, print_bounds=False, title=None, route=[], hd=int(spec.get("hd", 2)),
              points=frame_pts)
    bnd = mr.render(sp, img_path)
    z = bnd["zoom"]

    def xy(p):
        return mr.lng2px(p["lng"], z) - bnd["x0"], mr.lat2px(p["lat"], z) - bnd["y0"]

    mode0 = spec.get("mode", "transit")
    stops = []
    for i, p in enumerate(pts):
        x, y = xy(p)
        s = {"name": p["name"], "lng": p["lng"], "lat": p["lat"], "x": x, "y": y,
             "n": str(p.get("n") or i + 1), "type": p.get("type", "other"), "key": p.get("key")}
        s["color"] = HEX.get(s["type"], HEX["other"])
        leg = WMODE.get(AMODE.get(p.get("leg") or spec.get("real_route") or mode0, ""), "transit")
        s["leg"] = leg
        s["legsum"] = leg_summary(real[i - 1]) if real and i > 0 else None
        s["far"] = i in far
        stops.append(s)
    place_labels([t for t in stops if not t["far"]], W, H, spec.get("label", True))
    for t in stops:
        if t["far"]:
            t["lab"] = None

    uid = spec.get("id") or "tm-" + "".join(random.choice(string.ascii_lowercase) for _ in range(6))
    with open(img_path, "rb") as f:
        import base64
        data = base64.b64encode(f.read()).decode()

    E = html.escape
    out = ['<figure class="tmap" id="%s">' % E(uid)]
    alt = spec.get("alt") or (spec.get("title") or "行程地图") + "：" + "、".join(s["name"] for s in stops[:8])
    out.append('<div class="tm-stage"><img class="tm-base" src="data:image/jpeg;base64,%s" width="%d" height="%d" alt="%s">'
               % (data, W, H, E(alt)))
    if paths:
        svg = ['<svg class="tm-route" viewBox="0 0 %d %d" preserveAspectRatio="none" aria-hidden="true">' % (W, H)]
        polys = [(" ".join("%.1f,%.1f" % xy({"lng": q[0], "lat": q[1]}) for q in P["pts"]), P) for P in paths]
        for poly, P in polys:   # 先整体画白色描边，再画彩色线，交叉处不会互相压断
            svg.append('<polyline points="%s" fill="none" stroke="#fff" stroke-width="%s" stroke-linejoin="round" stroke-linecap="round" opacity=".92"/>'
                       % (poly, 5 if P["dash"] else 7.5))
        for poly, P in polys:
            svg.append('<polyline points="%s" fill="none" stroke="%s" stroke-width="%s" stroke-linejoin="round" stroke-linecap="round"%s/>'
                       % (poly, P["c"], 2.6 if P["dash"] else 4, ' stroke-dasharray="5 5"' if P["dash"] else ""))
        svg.append('</svg>')
        out.append("".join(svg))
    import math
    cxy = (W / 2.0, H / 2.0)
    for s in stops:
        if s["far"]:
            ang = math.atan2(s["y"] - cxy[1], s["x"] - cxy[0])
            arrow = ARROWS[int(round(ang / (math.pi / 4))) % 8]
            k = min((W / 2.0 - 70) / max(abs(math.cos(ang)), 1e-6), (H / 2.0 - 24) / max(abs(math.sin(ang)), 1e-6))
            bx, by = cxy[0] + k * math.cos(ang), cxy[1] + k * math.sin(ang)
            near = min((km(s, t) for t in stops if not t["far"]), default=0)
            out.append('<a class="tm-far" href="%s" target="_blank" rel="noopener" style="left:%.3f%%;top:%.3f%%;border-color:%s">'
                       '<i style="background:%s">%s</i>%s %s · 直线 %.0f km</a>'
                       % (E(amap_marker(s)), bx / W * 100, by / H * 100, s["color"], s["color"], E(s["n"]), arrow, E(s["name"]), near))
            continue
        pos = "left:%.3f%%;top:%.3f%%" % (s["x"] / W * 100, s["y"] / H * 100)
        out.append('<a class="tm-pin" data-i="%d" data-n="%s" href="%s" target="_blank" rel="noopener" title="%s · 在高德地图打开" style="%s;background:%s">%s</a>'
                   % (stops.index(s), E(s["n"]), E(amap_marker(s)), E(s["name"]), pos, s["color"], E(s["n"])))
        if s["lab"]:
            b = s["lab"]
            out.append('<a class="tm-lab" data-i="%d" href="%s" target="_blank" rel="noopener" style="left:%.3f%%;top:%.3f%%">%s</a>'
                       % (stops.index(s), E(amap_marker(s)), b[0] / W * 100, b[1] / H * 100, E(s["name"])))
    out.append('<div class="tm-live" hidden></div></div>')
    out.append('<div class="tm-bar"><button type="button" class="tm-go">切换到可拖动地图</button>'
               '<button type="button" class="tm-back" hidden>回到静态图</button><span class="tm-status">'
               '静态图已含全部点位；在线地图可拖动缩放、看清任意街道</span></div>')
    out.append('<ol class="tm-list">')
    for i, s in enumerate(stops):
        links = ['<a href="%s" target="_blank" rel="noopener">高德</a>' % E(amap_marker(s)),
                 '<a href="%s" target="_blank" rel="noopener">Google</a>' % E(google_place(s))]
        if i:
            prev = stops[i - 1]
            links.append('<a href="%s" target="_blank" rel="noopener">从上一站%s导航</a>'
                         % (E(amap_nav(prev, s, s["leg"])), MODES[s["leg"]][2]))
        leg_html = '<small class="tm-leg">↳ %s</small>' % E(s["legsum"]) if s.get("legsum") else ""
        out.append('<li><i style="background:%s">%s</i><b data-i="%d" title="在地图上定位">%s</b>%s%s</li>'
                   % (s["color"], E(s["n"]), i, E(s["name"]), " · ".join(links), leg_html))
    out.append('</ol>')
    cap = spec.get("caption")
    if real:
        note = ("路线为高德实时规划（%s 查询）：实线是乘车/驾车，虚线是步行；蓝=地铁、绿=公交、紫=铁路。底图与坐标：高德地图（GCJ-02）。"
                % datetime.date.today().isoformat())
    elif paths:
        note = "红线是途经点连线示意，不是导航轨迹。底图与坐标：高德地图（GCJ-02）。"
    else:
        note = "底图与坐标：高德地图（GCJ-02）。"
    out.append('<figcaption>%s%s</figcaption>' % (E(cap) + " " if cap else "", note))
    out.append('</figure>')

    lats = [p["lat"] for p in stops + route] or [p["lat"] for p in pts]
    lngs = [p["lng"] for p in stops + route] or [p["lng"] for p in pts]
    cfg = {
        "id": uid, "gkey": gkey or "", "zoom": z,
        "autoload": bool(spec.get("autoload", bool(gkey))),
        "labels": spec.get("label", True) is not False,
        "center": {"lat": (min(lats) + max(lats)) / 2, "lng": (min(lngs) + max(lngs)) / 2},
        "stops": [{"name": s["name"], "esc": E(s["name"]), "lat": s["lat"], "lng": s["lng"], "n": s["n"],
                   "color": s["color"], "showLab": s["lab"] is not None or spec.get("label") != "key",
                   "gurl": google_place(s)} for s in stops],
        "route": [{"lat": p["lat"], "lng": p["lng"]} for p in route],
        "fit": [{"lat": p["lat"], "lng": p["lng"]} for p in frame_pts] if far else None,
        "paths": [{"c": P["c"], "dash": P["dash"], "pts": [{"lat": q[1], "lng": q[0]} for q in P["pts"]]} for P in paths],
    }
    js = JS.replace("__CFG__", json.dumps(cfg, ensure_ascii=False).replace("</", "<\\/"))
    frag = "<style>%s</style>\n%s\n<script>%s</script>\n" % (CSS.strip(), "\n".join(out), js.strip())
    return frag, uid


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", required=True)
    ap.add_argument("--out", required=True, help="输出 HTML 片段")
    ap.add_argument("--img", help="底图临时文件（默认 <out>.jpg）")
    ap.add_argument("--demo", help="另存一个可直接打开的演示页")
    ap.add_argument("--no-google-key", action="store_true", help="即使环境里有 key 也不写进页面")
    a = ap.parse_args()
    with open(a.spec, encoding="utf-8") as f:
        spec = json.load(f)
    gkey = "" if a.no_google_key else os.environ.get("GOOGLE_MAPS_API_KEY", "").strip()
    frag, uid = build(spec, a.img or a.out + ".jpg", gkey)
    with open(a.out, "w", encoding="utf-8") as f:
        f.write(frag)
    print("已生成组件 %s → %s（%d KB）  在线层：%s"
          % (uid, a.out, len(frag.encode()) // 1024,
             "Google JS API（key 已写入页面，务必在控制台限制 API 与用量）" if gkey
             else "Google 无 key 嵌入 → 高德 Leaflet → 静态图"))
    if a.demo:
        with open(a.demo, "w", encoding="utf-8") as f:
            f.write('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
                    '<meta name="viewport" content="width=device-width,initial-scale=1"><title>%s</title>'
                    '<style>body{margin:0;background:#f6f5f1;color:#1b1d22}main{max-width:1040px;margin:24px auto;padding:0 16px}</style>'
                    '</head><body><main><h2>%s</h2>%s</main></body></html>'
                    % (html.escape(spec.get("title", "地图")), html.escape(spec.get("title", "地图")), frag))
        print("演示页 → %s" % a.demo)


if __name__ == "__main__":
    main()
