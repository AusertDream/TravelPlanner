# -*- coding: utf-8 -*-
"""
地图出图器 v2（map-render2）
=============================================================
用法：python map-render2.py --spec spec.json --out map.jpg

spec 关键字段
  width / height   **页面上的显示宽高（CSS px）**。通栏约 1040、双栏约 500。
                   不是文件像素——文件像素 = width × hd。
  hd               输出像素倍率，默认 2（Retina 下锐利；validate-html 也就不报"被放大"）。
  zoom             可选，强制缩放级；默认按点位自动挑。
  zoom_bias        可选，在自动缩放级上 +1/−1（想让底图字更多/范围更大时用）。
  pins             默认 true：点位/标签/图例烤进图里。
                   false：只出底图 + 路线（交互叠加层 map-widget.py 用 HTML 画点和字）。
  print_bounds     true 时多打一行 BOUNDS（叠加层做经纬度→像素映射必须用它，别手推）。
  其余字段（title/style/label/points/route/label_size/legend）与旧版一致。

2026-10-02 修正「底图字小如芝麻粒」的根因
-----------------------------------------
旧版 SS=4：按 4 倍画布**挑缩放级**（等于 zoom 高两级），拼完瓦片再整张**缩小 4 倍**。
高德瓦片里的地名是按 1:1 像素画死的（约 11–12px），缩 4 倍就只剩 3px——这才是
「除了自己标的，底图上的字啥都看不清」的原因；而且标注是在缩小之后才画的，
根本没有享受到超采样。
现在：缩放级按**显示尺寸**挑，瓦片 1:1 拼出显示区域（底图字 = 高德网页上的原始字号），
再整体放大 hd 倍，所有标注按 hd 倍字号/线宽在大图上画 → 文件是 2× 像素，显示是 1×。
"""
import argparse, io, json, math, os, sys, time, urllib.request
for _s in (sys.stdout, sys.stderr):   # Windows 控制台默认 GBK，打印 ⚠ 会崩
    try:
        _s.reconfigure(encoding='utf-8')
    except Exception:
        pass
from PIL import Image, ImageDraw, ImageFont

TILE = 256
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120 Safari/537.36")
CACHE = os.path.join(os.path.expanduser("~"), ".dsh", "preset-assets",
                     "travel-planner", ".mapcache")

STYLES = {
    "road": "https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}",
    "satellite": "https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}",
}
COLORS = {
    "hub": (240, 138, 20), "charge": (16, 160, 80), "park": (40, 110, 220),
    "hotel": (140, 70, 200), "poi": (220, 50, 50), "food": (150, 100, 40),
    "start": (0, 120, 80), "end": (170, 30, 40), "other": (90, 95, 105),
}
TYPE_CN = {
    "hub": "换乘枢纽", "charge": "充电桩", "park": "停车场", "hotel": "住宿",
    "poi": "景点", "food": "餐饮", "start": "起点", "end": "终点", "other": "其他",
}
FONT_CANDIDATES = [
    "C:/Windows/Fonts/msyhbd.ttc", "C:/Windows/Fonts/msyh.ttc",
    "C:/Windows/Fonts/simhei.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
    "/System/Library/Fonts/PingFang.ttc",
]


def font(size):
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def lng2px(lng, z):
    return (lng + 180.0) / 360.0 * TILE * (2 ** z)


def lat2px(lat, z):
    lat = max(min(lat, 85.05112878), -85.05112878)
    s = math.sin(math.radians(lat))
    return (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * TILE * (2 ** z)


def px2lng(px, z):
    return px / (TILE * (2 ** z)) * 360.0 - 180.0


def px2lat(py, z):
    n = math.pi - 2.0 * math.pi * py / (TILE * (2 ** z))
    return math.degrees(math.atan(math.sinh(n)))


def fetch_tile(style, z, x, y):
    d = os.path.join(CACHE, style, str(z), str(x))
    p = os.path.join(d, "%d.png" % y)
    if os.path.exists(p):
        try:
            return Image.open(p).convert("RGB")
        except Exception:
            os.remove(p)
    os.makedirs(d, exist_ok=True)
    url = STYLES[style].format(s=1 + ((x + y) % 4), x=x, y=y, z=z)
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA, "Referer": "https://www.amap.com/"})
            raw = urllib.request.urlopen(req, timeout=25).read()
            im = Image.open(io.BytesIO(raw)).convert("RGB")
            if im.size != (TILE, TILE):
                im = im.resize((TILE, TILE))
            with open(p, "wb") as f:
                f.write(raw)
            return im
        except Exception as e:
            if attempt == 2:
                sys.stderr.write("瓦片失败 z=%d x=%d y=%d: %s\n" % (z, x, y, e))
                return Image.new("RGB", (TILE, TILE), (232, 232, 228))
            time.sleep(0.6)


def pick_zoom(pts, w, h, pad=0.86):
    """选缩放级（w/h 是显示尺寸）。pad 0.86：宁可外围留白，也别把点挤成一坨。"""
    lngs = [p["lng"] for p in pts]
    lats = [p["lat"] for p in pts]
    for z in range(18, 2, -1):
        px = lng2px(max(lngs), z) - lng2px(min(lngs), z)
        py = lat2px(min(lats), z) - lat2px(max(lats), z)
        if px <= w * pad and py <= h * pad:
            return z
    return 3


def frame(spec):
    """算视野：返回 (z, x0, y0, x1, y1)，单位是 z 级世界像素，且 x1-x0 == 显示宽。"""
    pts = spec.get("points") or []
    route = spec.get("route") or []
    allpts = pts + route
    W = int(spec.get("width", 1000))
    H = int(spec.get("height", 640))
    if spec.get("zoom"):
        z = int(spec["zoom"])
    else:
        z = pick_zoom(allpts, W, H) + int(spec.get("zoom_bias", 0))
    z = max(3, min(18, z))
    xs = [lng2px(p["lng"], z) for p in allpts]
    ys = [lat2px(p["lat"], z) for p in allpts]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    # 视野 = 显示尺寸，1 世界像素 = 1 CSS 像素 → 瓦片里的地名保持高德原始字号
    return z, cx - W / 2.0, cy - H / 2.0, cx + W / 2.0, cy + H / 2.0


def compose_base(style, z, x0, y0, x1, y1):
    tx0, tx1 = int(x0 // TILE), int((x1 - 1e-6) // TILE)
    ty0, ty1 = int(y0 // TILE), int((y1 - 1e-6) // TILE)
    n = 2 ** z
    canvas = Image.new("RGB", ((tx1 - tx0 + 1) * TILE, (ty1 - ty0 + 1) * TILE), (235, 235, 230))
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            if 0 <= ty < n:
                canvas.paste(fetch_tile(style, z, tx % n, ty), ((tx - tx0) * TILE, (ty - ty0) * TILE))
    ox, oy = tx0 * TILE, ty0 * TILE
    l, t = int(round(x0 - ox)), int(round(y0 - oy))
    return canvas.crop((l, t, l + int(round(x1 - x0)), t + int(round(y1 - y0))))


def render(spec, out_path):
    pts = spec.get("points") or []
    route = spec.get("route") or []
    if not pts and not route:
        raise SystemExit("spec 里 points 和 route 至少要有一样")
    style = spec.get("style", "road")
    if style not in STYLES:
        style = "road"
    W = int(spec.get("width", 1000))
    H = int(spec.get("height", 640))
    K = max(1, int(spec.get("hd", 2)))          # 输出像素倍率
    if W > 1100:
        sys.stderr.write(
            "⚠ width=%d 大于页面栏宽（通栏约 1040）。width 现在表示**显示宽度**，"
            "图被页面缩小后底图地名会跟着变小。通栏请给 1040 左右。\n" % W)
    if W * K < 800:
        sys.stderr.write("⚠ 输出像素 %dpx 偏小，建议 width×hd ≥ 800。\n" % (W * K))

    z, x0, y0, x1, y1 = frame(spec)
    base = compose_base(style, z, x0, y0, x1, y1)
    img = base.resize((W * K, H * K), Image.LANCZOS) if K > 1 else base

    d = ImageDraw.Draw(img, "RGBA")
    f_lab = font(int(spec.get("label_size", 15)) * K)
    f_num = font(13 * K)
    f_leg, f_legt = font(14 * K), font(13 * K)
    f_ttl = font(17 * K)
    r = 10 * K
    IW, IH = W * K, H * K

    def to_xy(p):
        return ((lng2px(p["lng"], z) - x0) * K, (lat2px(p["lat"], z) - y0) * K)

    reserved = []
    draw_pins = spec.get("pins", True) is not False
    if spec.get("title"):
        tw = d.textlength(spec["title"], font=f_ttl)
        reserved.append((5 * K, 3 * K, 19 * K + tw, 36 * K))

    PLATE = (255, 255, 255, 238)   # 不透明底板：区分「我的标注」和底图地名

    used = []
    for p in pts:
        t = p.get("type", "other")
        if t not in used:
            used.append(t)
    legend_box = None
    if draw_pins and used and spec.get("legend", True) is not False:
        lh, lw = 21 * K, 104 * K
        bx, by = 11 * K, IH - 11 * K - lh * len(used) - 26 * K
        legend_box = (bx - 4 * K, by - 4 * K, bx + lw + 4 * K, by + lh * len(used) + 10 * K)
        reserved.append(legend_box)

    if len(route) >= 2:
        seq = [to_xy(p) for p in route]
        d.line(seq, fill=(255, 255, 255, 235), width=8 * K, joint="curve")
        d.line(seq, fill=(230, 60, 60, 240), width=4 * K, joint="curve")

    label_boxes = []

    def free(b):
        if b[0] < 3 * K or b[1] < 3 * K or b[2] > IW - 3 * K or b[3] > IH - 3 * K:
            return False
        for q in reserved + label_boxes:
            if not (b[2] < q[0] or b[0] > q[2] or b[3] < q[1] or b[1] > q[3]):
                return False
        return True

    marks = []
    if draw_pins:
        seen_xy = []
        for p in pts:
            x, y = to_xy(p)
            if any(abs(x - sx) < 6 * K and abs(y - sy) < 6 * K for sx, sy in seen_xy):
                continue   # 去重：同一坐标附近只画一个点
            seen_xy.append((x, y))
            col = COLORS.get(p.get("type", "other"), COLORS["other"])
            d.ellipse([x - r - 2 * K, y - r - 2 * K, x + r + 2 * K, y + r + 2 * K], fill=(255, 255, 255, 240))
            d.ellipse([x - r, y - r, x + r, y + r], fill=col + (255,))
            num = str(p.get("n", ""))
            if num and len(num) <= 3:
                bb = d.textbbox((0, 0), num, font=f_num)
                d.text((x - (bb[2] - bb[0]) / 2, y - (bb[3] - bb[1]) / 2 - K), num,
                       font=f_num, fill=(255, 255, 255))
            marks.append((p, x, y))

    DIRS = [(1, 0, "l"), (-1, 0, "r"), (0, -1, "c"), (0, 1, "c"),
            (1, -1, "l"), (-1, -1, "r"), (1, 1, "l"), (-1, 1, "r")]
    for p, x, y in marks:
        name = p.get("name")
        if not name or spec.get("label", True) is False:
            continue
        if spec.get("label") == "key" and not p.get("key"):
            continue
        tw = d.textlength(name, font=f_lab)
        bb = d.textbbox((0, 0), name, font=f_lab)
        lw, lh2 = tw, bb[3] - bb[1]
        pad_x, pad_y = 5 * K, 3 * K
        done = False
        for dist in (r + 5 * K, r + 20 * K, r + 40 * K, r + 64 * K, r + 92 * K):
            for ux, uy, al in DIRS:
                if al == "l":
                    tx, ty = x + ux * dist, y + uy * dist - lh2 / 2
                elif al == "r":
                    tx, ty = x + ux * dist - lw, y + uy * dist - lh2 / 2
                else:
                    tx = x - lw / 2
                    ty = y + uy * dist - (lh2 if uy < 0 else 0)
                b = (tx - pad_x, ty - pad_y, tx + lw + pad_x, ty + lh2 + pad_y)
                if not free(b):
                    continue
                if dist > r + 26 * K:      # 放远了补引线
                    ax = x + (ux * r if ux else 0)
                    ay = y + (uy * r if uy else 0)
                    cx = min(max(tx, b[0]), b[2])
                    cy = min(max(ty, b[1]), b[3])
                    d.line([(ax, ay), (cx, cy)], fill=(50, 52, 56, 190), width=K)
                d.rectangle(b, fill=PLATE)
                d.text((tx, ty - bb[1]), name, font=f_lab, fill=(16, 18, 22))
                label_boxes.append(b)
                done = True
                break
            if done:
                break

    if legend_box:
        bx, by = legend_box[0] + 4 * K, legend_box[1] + 4 * K
        lh = 21 * K
        d.rectangle([bx, by, bx + 104 * K, by + lh * len(used) + 18 * K],
                    fill=(255, 255, 255, 240), outline=(190, 190, 190), width=K)
        d.text((bx + 8 * K, by + 5 * K), "本图标注", font=f_legt, fill=(110, 112, 118))
        for k, t in enumerate(used):
            cy = by + 22 * K + lh * k + lh // 2
            d.ellipse([bx + 8 * K, cy - 5 * K, bx + 18 * K, cy + 5 * K], fill=COLORS.get(t, COLORS["other"]))
            d.text((bx + 24 * K, cy - 8 * K), TYPE_CN.get(t, t), font=f_leg, fill=(26, 28, 32))

    if spec.get("title"):
        d.text((13 * K, 9 * K), spec["title"], font=f_ttl, fill=(20, 22, 26),
               stroke_width=3 * K, stroke_fill=(255, 255, 255, 246))

    img.save(out_path, "JPEG", quality=85, optimize=True, progressive=True)
    print("已生成 %s  显示 %dx%d / 文件 %dx%d  zoom=%d  %dKB  标注 %d 个"
          % (out_path, W, H, IW, IH, z, os.path.getsize(out_path) // 1024, len(marks)))
    bounds = {
        "cssW": W, "cssH": H, "imgW": IW, "imgH": IH, "hd": K, "zoom": z,
        "x0": x0, "y0": y0,
        "lng0": px2lng(x0, z), "lng1": px2lng(x1, z),
        "lat0": px2lat(y1, z), "lat1": px2lat(y0, z),
    }
    # 叠加层做经纬度↔像素映射必须用这组值，手推一定会错位（实测纵向偏了 40px）。
    if spec.get("print_bounds"):
        print("BOUNDS " + json.dumps(bounds, ensure_ascii=False))
    return bounds


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    with open(a.spec, encoding="utf-8") as f:
        render(json.load(f), a.out)
