#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
景点配图抓取（photo-fetch）
=============================================================
从 Wikipedia / Wikimedia Commons 抓**可自由使用（CC 协议）**的景点实景图，
并**连版权信息一起带回来**——CC 协议要求署名，不能只拿图不署名。

为什么用维基而不是搜索引擎：
  · 免 key、免登录、稳定；
  · 许可清晰（extmetadata 里直接给 Author / LicenseShortName / LicenseUrl）；
  · 搜来的图往往来源不明，做进交付物里有版权风险。

用法
-------------------------------------------------------------
  # 直接给名字
  python photo-fetch.py --outdir photos --names "莫干山" "西湖" "拙政园"

  # 或给一个 spec（可为每个点指定更精确的维基条目名 / 英文名）
  python photo-fetch.py --outdir photos --spec photos.json

photos.json：
[
  {"name": "莫干山", "wiki": "莫干山"},
  {"name": "大峡谷", "wiki": "Grand Canyon", "lang": "en"},
  {"name": "平江路", "commons": "Pingjiang Road Suzhou"}   // 维基没图时改走 Commons 搜索
]

输出：
  photos/01-莫干山.jpg …            图片（长边已压到 --max-width，便于内联）
  photos/credits.json              每张图的 作者 / 许可 / 许可链接 / 来源页

抓完要把署名写进 HTML（页脚 + 每张图的图注），格式例如：
  照片：Wikimedia Commons — 莫干山 © Mushero（CC BY 3.0）
"""
import argparse, io, json, os, re, sys, time, urllib.parse, urllib.request
from PIL import Image

# Windows 控制台默认 GBK，直接 print 中文/符号会崩
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except Exception:
        pass

UA = "dsh-travel-planner/1.0 (personal trip planning; contact: local)"

# 为什么脚本自己读 .env：DSH 的 shell 拿不到 Host 注入的环境变量（实测），
# 所以不能指望 UNSPLASH_ACCESS_KEY 已经在 os.environ 里。.env 就在脚本同目录。
ENV_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")


def load_key(name):
    v = (os.environ.get(name) or "").strip()
    if v:
        return v
    try:
        for line in open(ENV_FILE, encoding="utf-8"):
            line = line.strip()
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass
    return ""


# 维基与 Unsplash 在境外：在国内需要代理时，在 .env 里设 DSH_PHOTO_PROXY 或 HTTPS_PROXY
# （如 http://127.0.0.1:7890）；都没设就直连。
PROXY = load_key("DSH_PHOTO_PROXY") or load_key("HTTPS_PROXY") or load_key("HTTP_PROXY")
OPENER = urllib.request.build_opener(
    urllib.request.ProxyHandler({"http": PROXY, "https": PROXY} if PROXY else {})
)
# ⚠️ Wikimedia 有速率限制，请求太密会返回 429（Too Many Requests）。
#    实测连续请求十几次就会被打回，所以每次请求之间强制间隔。
THROTTLE = float(os.environ.get("DSH_PHOTO_THROTTLE", "0.7"))
_last = [0.0]


def _wait():
    dt = time.time() - _last[0]
    if dt < THROTTLE:
        time.sleep(THROTTLE - dt)
    _last[0] = time.time()


def get_json(url, tries=3, headers=None):
    for i in range(tries):
        _wait()
        try:
            h = {"User-Agent": UA}
            h.update(headers or {})
            req = urllib.request.Request(url, headers=h)
            return json.loads(OPENER.open(req, timeout=30).read().decode("utf-8"))
        except Exception as e:
            if i == tries - 1:
                sys.stderr.write("  请求失败: %s (%s)\n" % (url[:70], e))
                return None
            time.sleep(1.5 * (i + 1))      # 429 之后退避更久


def fetch_bytes(url, tries=3, headers=None):
    for i in range(tries):
        _wait()
        try:
            h = {"User-Agent": UA}
            h.update(headers or {})
            req = urllib.request.Request(url, headers=h)
            return OPENER.open(req, timeout=60).read()
        except Exception as e:
            if i == tries - 1:
                sys.stderr.write("  下载失败: %s (%s)\n" % (url[:70], e))
                return None
            time.sleep(1.5 * (i + 1))


# ---------------------------------------------------------------- Unsplash
def unsplash_search(query, key, per_page=6):
    """返回候选列表。有 key 走官方 API；无 key 退回网页端（可能被机房 IP 拦）。
    用法参考 TREK（liketrek/TREK, AGPL-3.0）server/src/nest/unsplash/unsplash.service.ts。
    """
    params = urllib.parse.urlencode({"page": "1", "query": query, "per_page": str(per_page)})
    if key:
        url = "https://api.unsplash.com/search/photos?" + params
        hdrs = {"Authorization": "Client-ID " + key, "Accept-Version": "v1"}
    else:
        url = "https://unsplash.com/napi/search/photos?" + params
        hdrs = {
            "Accept": "*/*", "Accept-Language": "en-US",
            "Referer": "https://unsplash.com/s/photos/" + urllib.parse.quote(query),
            "client-geo-region": "global",
        }
    d = get_json(url, headers=hdrs) or {}
    out = []
    for p in (d.get("results") or [])[:per_page]:
        u = (p.get("urls") or {})
        if not (u.get("regular") or u.get("small")):
            continue
        out.append({
            "file": "unsplash:%s" % p.get("id"),
            "url": u.get("regular") or u.get("small"),
            "artist": ((p.get("user") or {}).get("name") or "未署名"),
            "license": "Unsplash License",
            "licenseUrl": "https://unsplash.com/license",
            "page": (p.get("links") or {}).get("html"),
            "desc": p.get("description") or p.get("alt_description") or "",
            "width": None, "height": None,
        })
    return out


def wiki_summary(title, lang="zh"):
    """维基条目摘要 → 主图 URL。"""
    u = "https://%s.wikipedia.org/api/rest_v1/page/summary/%s" % (lang, urllib.parse.quote(title))
    d = get_json(u)
    if not d or d.get("type", "").endswith("not_found"):
        return None
    img = (d.get("originalimage") or {}).get("source") or (d.get("thumbnail") or {}).get("source")
    return {"title": d.get("title") or title, "img": img, "page": (d.get("content_urls", {}).get("desktop", {}) or {}).get("page")}


def commons_search(query, limit=6):
    """Commons 文件搜索 → 候选文件名列表。"""
    u = ("https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=%s"
         "&srnamespace=6&srlimit=%d&format=json" % (urllib.parse.quote(query), limit))
    d = get_json(u)
    return [x["title"] for x in ((d or {}).get("query", {}).get("search") or [])]


def commons_meta(file_title, thumb_w=1400):
    """取文件信息 + 许可元数据。
    ⚠️ 优先用 thumburl（缩略图）而不是原图 url：Wikimedia 明确要求
    "use thumbnail images in sizes listed"，直接抓原图既慢又容易被限流。
    """
    u = ("https://commons.wikimedia.org/w/api.php?action=query&titles=%s"
         "&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=%d&format=json"
         % (urllib.parse.quote(file_title), thumb_w))
    d = get_json(u)
    pages = ((d or {}).get("query", {}) or {}).get("pages") or {}
    for _, v in pages.items():
        ii = (v.get("imageinfo") or [{}])[0]
        em = ii.get("extmetadata", {}) or {}

        def g(k):
            return re.sub(r"<[^>]+>", "", str((em.get(k, {}) or {}).get("value", ""))).strip()
        return {
            "file": v.get("title", file_title),
            "url": ii.get("thumburl") or ii.get("url"),
            "width": ii.get("width"), "height": ii.get("height"),
            "artist": g("Artist") or "未署名", "license": g("LicenseShortName") or "见来源",
            "licenseUrl": g("LicenseUrl"), "credit": g("Credit"),
        }
    return None


def file_title_from_url(url):
    """从 upload.wikimedia.org 的 URL 反推 Commons 文件名。
    要处理两种形态：
      /commons/8/80/Morganshan_side.JPG            （原图）
      /commons/thumb/1/17/West_Lake.jpg/1200px-…   （缩略图）
    并去掉 ?utm_… 之类的查询串，否则文件名会带尾巴导致查不到元数据。
    """
    if not url:
        return None
    u = url.split("?")[0].split("#")[0]
    m = re.search(r"/commons/([0-9a-f])/([0-9a-f]{2})/([^/]+)$", u)
    if not m:
        m = re.search(r"/commons/thumb/([0-9a-f])/([0-9a-f]{2})/([^/]+)/", u)
    return "File:" + urllib.parse.unquote(m.group(3)) if m else None


def save_img(raw, out_path, max_w, quality=84):
    im = Image.open(io.BytesIO(raw)).convert("RGB")
    if im.width > max_w:
        im = im.resize((max_w, int(im.height * max_w / im.width)), Image.LANCZOS)
    im.save(out_path, "JPEG", quality=quality, optimize=True)
    return im.size


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--names", nargs="*")
    ap.add_argument("--spec")
    ap.add_argument("--max-width", type=int, default=1400)
    ap.add_argument("--candidates", type=int, default=3,
                    help="每个点抓几个候选图（默认 3）。>1 时会存到 <outdir>/<名字>/cN.jpg，"
                         "必须用 read_image 看过再挑——自动抓图常常对得上名字却不是你要的画面。")
    ap.add_argument("--source", choices=["unsplash", "wiki"], default="unsplash",
                    help="配图来源，默认 unsplash（需要 UNSPLASH_ACCESS_KEY）")
    a = ap.parse_args()

    items = []
    if a.spec:
        with open(a.spec, encoding="utf-8") as f:
            items = json.load(f)
    for n in (a.names or []):
        items.append({"name": n})
    if not items:
        raise SystemExit("需要 --names 或 --spec")

    os.makedirs(a.outdir, exist_ok=True)
    credits = []
    for i, it in enumerate(items, 1):
        name = it.get("name") or it.get("wiki") or "未命名"
        lang = it.get("lang", "zh")

        # ── 收集候选 ──
        cands = []
        key = load_key("UNSPLASH_ACCESS_KEY")
        if a.source == "unsplash" and not key:
            sys.stderr.write(
                "  ⚠️ Unsplash 现在必须配 key：免 key 的网页端已返回 401（TREK 那套兜底也已失效）。\n"
                "     请到 https://unsplash.com/developers 申请 Access Key，填进\n"
                "     ~/.dsh/preset-assets/travel-planner/.env 的 UNSPLASH_ACCESS_KEY；\n"
                "     或改用 --source wiki（免 key，许可信息完整）。\n")
        want_unsplash = a.source == "unsplash" and bool(key)
        if want_unsplash:
            q = it.get("unsplash") or it.get("en") or it.get("name") or ""
            for m in unsplash_search(q, key, per_page=max(4, a.candidates * 2)):
                m["_src"] = "Unsplash 搜索「%s」" % q
                cands.append(m)
        if a.source == "wiki" and len(cands) < a.candidates:
            if it.get("wiki") or not it.get("commons"):
                s = wiki_summary(it.get("wiki") or name, lang)
                if s and s.get("img"):
                    ft = file_title_from_url(s["img"])
                    meta = commons_meta(ft) if ft else None
                    if meta:
                        meta["_src"] = "维基百科「%s」条目主图" % s["title"]
                        cands.append(meta)
            q = it.get("commons") or it.get("wiki") or name
            for ft in commons_search(q, limit=max(6, a.candidates * 3)):
                if len(cands) >= a.candidates:
                    break
                meta = commons_meta(ft)
                if meta and meta.get("url") and (meta.get("width") or 0) >= 900:
                    if any(c.get("file") == meta.get("file") for c in cands):
                        continue
                    meta["_src"] = "Commons 搜索「%s」" % q
                    cands.append(meta)

        if not cands:
            print("  %-10s X 没找到可用图片" % name)
            credits.append({"name": name, "found": False})
            continue

        safe = re.sub(r'[\\/:*?"<>|]', "_", name)
        saved = []
        for j, cand in enumerate(cands[: a.candidates], 1):
            raw = fetch_bytes(cand["url"])
            if not raw:
                continue
            if a.candidates == 1:
                fn = "%02d-%s.jpg" % (i, safe)
            else:
                os.makedirs(os.path.join(a.outdir, safe), exist_ok=True)
                fn = os.path.join(safe, "c%d.jpg" % j)
            path = os.path.join(a.outdir, fn)
            try:
                size = save_img(raw, path, a.max_width)
            except Exception as e:
                # 少数文件是 SVG / 不可解码格式，跳过即可，不要让整个任务挂掉
                sys.stderr.write("  跳过不可用文件 %s (%s)\n" % (cand.get("file"), str(e)[:60]))
                continue
            print("  %-10s %s  %dx%d" % (name, fn, size[0], size[1]))
            saved.append({
                "name": name, "found": True, "file": fn, "chosen": a.candidates == 1,
                "source": cand.get("_src"), "file_title": cand.get("file"),
                "artist": cand.get("artist"), "license": cand.get("license"),
                "licenseUrl": cand.get("licenseUrl"),
            })
        if not saved:
            credits.append({"name": name, "found": False})
        else:
            credits.extend(saved)
        if a.candidates > 1:
            print("       ↑ %d 个候选已下载，**必须用 read_image 逐个看过再挑**（自动抓图常对得上名字却不是你想要的画面，比如把路牌当成街景）" % len(saved))

    with open(os.path.join(a.outdir, "credits.json"), "w", encoding="utf-8") as f:
        json.dump(credits, f, ensure_ascii=False, indent=1)
    print("\n完成。图片在 %s/ ，清单见 credits.json（仅作内部记录，不必展示到页面上）" % a.outdir)


if __name__ == "__main__":
    main()
