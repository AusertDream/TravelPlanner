# -*- coding: utf-8 -*-
"""
修补路书 HTML：移除 Leaflet 在线交互地图 + 补全局 img 护栏。

背景（实测证据，不是推测）：
  1) CSS 里只有 `#map{height:460px}`，而 HTML 容器 id 是 `#map2` —— 零高度、
     无裁切，Leaflet 的 panes 整块溢出。
  2) 即使补上 `#map2{height:460px;overflow:hidden}`，用 CDP 量出来 Leaflet
     认到的容器是 1234x550，实际是 1030x460 —— 它按**错误尺寸**铺瓦片，
     仍然溢出 70px 压住后面的章节。靠 CSS 救不回来，错的是它内部 pane 几何。
  3) 另有 15 个 permanent:true 的 tooltip 堆在同一位置。

结论：在线交互地图这个方案在「本地 HTML 文件 + 内联大图」的形态下不稳，
      静态瓦片图（map-render.py 出的）已经够直观且零依赖，故整体移除。

用法：python fix-roadbook.py <in.html> <out.html>
"""
import io, re, sys


def strip_leaflet(html, log):
    n0 = len(html)

    # 1. leaflet 外链（CSS + JS）
    for pat in (r'[ \t]*<link[^>]*leaflet[^>]*>\s*\n?',
                r'[ \t]*<script[^>]*leaflet[^>]*>\s*</script>\s*\n?'):
        html, k = re.subn(pat, '', html)
        if k:
            log.append("OK  移除 Leaflet 外链 %d 处" % k)

    # 2. 交互地图区块（标题 + 说明 + 容器），到下一个 <h3 或 <div class="two" 为止
    html, k = re.subn(r'[ \t]*<div id="map2-wrap".*?</div>[ \t]*\n[ \t]*\n?(?=[ \t]*<h3|[ \t]*<div class="two")',
                      '', html, flags=re.S)
    if k:
        log.append("OK  移除在线交互地图区块（含 15 个永久 tooltip）")

    # 3. Leaflet 初始化脚本：从「// 地图」注释到该 IIFE 收尾
    html, k = re.subn(r'\n[ \t]*//[ \t]*地图[ \t]*\n[ \t]*if\(!window\.L\)\{return;\}.*?\n\}\)\(\);\n',
                      '\n', html, flags=re.S)
    if k:
        log.append("OK  移除 Leaflet 初始化脚本")

    # 4. 残留的 leaflet 样式（若脚本在别处也写过）
    html = re.sub(r'\n#map2[^\n]*', '', html)

    # 5. 兜底：还有没有活着的 leaflet 引用？
    left = len(re.findall(r'leaflet|L\.map\(|map2', html, re.I))
    if left:
        log.append("WARN 还剩 %d 处 leaflet/map2 引用，需人工确认" % left)
    else:
        log.append("OK  leaflet 引用已清零")

    return html


def add_img_guard(html, log):
    anchor = "*{box-sizing:border-box}"
    guard = (anchor + "\n"
             "img{max-width:100%;height:auto}   /* 兜底：漏 class 的图不许横撑出屏 */")
    if "img{max-width:100%;height:auto}" in html:
        log.append("SKIP 全局 img 护栏已在")
    elif anchor in html:
        html = html.replace(anchor, guard, 1)
        log.append("OK  补全局 img 护栏")
    else:
        log.append("WARN 找不到 *{box-sizing} 锚点")
    return html


def main():
    src, dst = sys.argv[1], sys.argv[2]
    html = io.open(src, encoding="utf-8").read()
    log = []
    html = add_img_guard(html, log)
    html = strip_leaflet(html, log)
    io.open(dst, "w", encoding="utf-8", newline="").write(html)
    print("字节 %d -> %d" % (len(io.open(src, 'rb').read()), len(html.encode('utf-8'))))
    for l in log:
        print("  " + l)


if __name__ == "__main__":
    main()
