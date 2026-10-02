#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
路书 HTML 静态验证器（validate-html.py）
=============================================================
为什么需要它：实测交付里出现过「删代码块时正则把 IIFE 结尾一起吃掉」，
导致整个 <script> 语法错误、页面所有按钮全部失灵——而 grep 数图片/数 class
完全查不出来。**HTML 能渲染 ≠ JS 能跑。**

检查项：
  1. 标签配对（div/section/nav/main/script/style/ul/li/table…）
  2. <script> 的 JS 语法（调 node --check）
  3. <style> 里 CSS 花括号配对、以及"写死的固定高度"
  4. 悬空引用：href="#x" 有没有对应 id；JS 里 getElementById('x') 的 id 存不存在；
     querySelector('.x') 的 class 在 HTML 里有没有出现
  5. JS 里引用的 class 是否存在（.hpane / .on 这类动态切换的会误报，列为提示）

用法：python validate-html.py <file.html>
退出码：0 = 通过，1 = 有错误
"""
import io, os, re, subprocess, sys, tempfile, json
from collections import Counter

VOID = {'area','base','br','col','embed','hr','img','input','link','meta',
        'param','source','track','wbr','!doctype'}
PAIRED = ['div','section','nav','main','script','style','ul','ol','li','table',
          'tr','td','th','thead','tbody','p','span','figure','figcaption','a',
          'button','label','h1','h2','h3','h4','header','footer','article','aside']

errs, warns = [], []


def strip_script_style(html, keep=None):
    """把 script/style 内容挖掉，避免里面的字符串干扰标签扫描。"""
    out = html
    for tag in ('script', 'style'):
        if keep and tag in keep:
            continue
        out = re.sub(r'<%s\b[^>]*>.*?</%s>' % (tag, tag), '<%s></%s>' % (tag, tag),
                     out, flags=re.S | re.I)
    return out


def iter_tags(body):
    """手写扫描器：逐个产出 (closing, name, selfclose, 起始下标)。
    为什么不用正则：属性值里可能有几十万字符的内联 base64，正则的
    `(?:...)*?` 会灾难性回溯（实测在 1MB 的页面上卡死十几分钟）。
    手写扫描是线性、无回溯的，这类活本来就不该交给正则。

    规则：从 '<' 往后找 '>'，途中跳过引号内的内容；
    **标签长度超过 500 字符就判定不是标签**（真实 HTML 不会那么长），
    这样即使遇到畸形的长属性也不会拖慢。"""
    i, n = 0, len(body)
    while True:
        i = body.find('<', i)
        if i < 0:
            return
        # <!-- 注释、<!DOCTYPE 等：注释另行剥除，这里只识别常规标签
        j, quote, limit = i + 1, '', min(i + 500, n)
        while j < limit and j < n:
            ch = body[j]
            if quote:
                if ch == quote:
                    quote = ''
            elif ch in '"\'':
                quote = ch
            elif ch == '>':
                break
            j += 1
        if j >= n or body[j] != '>':
            i += 1                      # 不是标签，往后挪一格继续找
            continue
        inner = body[i + 1:j]
        closing = inner.startswith('/')
        if closing:
            inner = inner[1:]
        name = re.match(r'[a-zA-Z!][a-zA-Z0-9-]*', inner)
        if not name:
            i += 1
            continue
        rest = inner[name.end():].rstrip()
        yield closing, name.group(0).lower(), rest.endswith('/'), i
        i = j + 1


def check_tags(html):
    body = strip_script_style(html)
    # 先挖掉 HTML 注释，否则 <!-- ... --> 会被当成标签
    body = re.sub(r'<!--.*?-->', '', body, flags=re.S)
    stack = []
    for closing, name, selfclose, pos in iter_tags(body):
        if name in VOID or selfclose:
            continue
        line = body.count('\n', 0, pos) + 1
        if closing:
            if not stack:
                errs.append('第 %d 行：多出一个 </%s>' % (line, name))
            elif stack[-1][0] != name:
                errs.append('第 %d 行：</%s> 与未闭合的 <%s>（第 %d 行）不匹配'
                            % (line, name, stack[-1][0], stack[-1][1]))
                stack.pop()
            else:
                stack.pop()
        else:
            stack.append((name, line))
    for name, line in stack:
        errs.append('第 %d 行：<%s> 没有闭合' % (line, name))


def check_js(html):
    scripts = re.findall(r'<script\b(?![^>]*\bsrc=)[^>]*>(.*?)</script>', html, re.S | re.I)
    if not scripts:
        return []
    node = None
    for cand in ('node', 'node.exe'):
        try:
            subprocess.run([cand, '--version'], capture_output=True, check=True)
            node = cand
            break
        except Exception:
            pass
    if not node:
        warns.append('本机没有 node，跳过 JS 语法检查（强烈建议装上）')
        return []
    for i, js in enumerate(scripts):
        if not js.strip():
            continue
        with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f:
            f.write(js)
            path = f.name
        try:
            r = subprocess.run([node, '--check', path], capture_output=True, text=True, encoding='utf-8', errors='replace')
            if r.returncode != 0:
                msg = (r.stderr or '').strip().split('\n')
                errs.append('第 %d 个内联 <script> **语法错误**（浏览器会整段不执行，所有按钮失效）：' % (i + 1))
                for line in msg[:6]:
                    errs.append('    ' + line)
        finally:
            try: os.unlink(path)
            except Exception: pass
    return scripts


def css_rules(html):
    """只在 <style> 块里找 CSS 规则。
    不要在**整个 HTML** 上跑 CSS 正则 —— 那会让选择器部分横跨正文，
    配上 `([^{}]*…[^{}]*)\\{` 这种双贪婪写法就是灾难性回溯
    （实测在 1MB 页面上卡死 90 秒以上、CPU 几乎为 0 地空转）。
    返回 (选择器, 规则体) 列表。"""
    out = []
    for block in re.findall(r'<style\b[^>]*>(.*?)</style>', html, re.S | re.I):
        for m in re.finditer(r'([^{}]{0,400}?)\{([^{}]{0,800}?)\}', block):
            sel = m.group(1).strip()
            sel = re.split(r'[;}]', sel)[-1].strip()      # 去掉上一条规则的尾巴
            if sel:
                out.append((sel, m.group(2)))
    return out


def check_css(html):
    for i, css in enumerate(re.findall(r'<style\b[^>]*>(.*?)</style>', html, re.S | re.I)):
        if css.count('{') != css.count('}'):
            errs.append('第 %d 个 <style>：花括号不配对（{ %d 个，} %d 个）'
                        % (i + 1, css.count('{'), css.count('}')))
    # 固定高度：章节类容器写死高度是"整章溢出"事故的根源。
    # ⚠️ 光看选择器里有没有 'section' 是不够的 —— 最典型的翻车形态是
    #    `#map{height:460px}` 配 `<section id="map">`：选择器里一个 'section' 都没有，
    #    命中的却是整个章节。所以还要把选择器里的 id/class 反查回 HTML 元素。
    def hits_section(sel):
        # 只认选择器**头部**指向的那个元素（.topbar .wrap 命中的是 .wrap，不是 .topbar）
        first = re.split(r'[\s>+~]+', sel.strip())[0] if sel.strip() else ''
        if re.match(r'^(?:section|main|article|body|html)\b', first):
            return '选择器直接写了章节标签'
        # id 是唯一的：id 落在哪个元素上，规则就命中哪个元素 —— 这个判据最可靠
        for i in re.findall(r'#([A-Za-z_][\w-]*)', first):
            if re.search(r'<(?:section|main|article)\b[^>]*\bid\s*=\s*["\']%s["\']' % re.escape(i), html):
                return 'id="%s" 落在 <section>/<main>/<article> 上' % i
        # 类名是复用的，不能只看"某处有个 section 用了这个类" —— 会误报
        # （实测 .topbar .wrap{height:60px} 命中的是顶栏里的 div，不是章节）
        return None

    for sel, rule in css_rules(html):
        hm = re.search(r'(?<!max-)(?<!min-)\bheight\s*:\s*(\d+)px', rule)
        if not hm:
            continue
        why = hits_section(sel)
        if why:
            errs.append('CSS 给章节类容器写死高度：%s { height:%spx }（%s）'
                        '→ 内容一多就会整块溢出、盖住后面所有章节'
                        % (sel[:60], hm.group(1), why))


def check_refs(html):
    ids = set(re.findall(r'\bid\s*=\s*"([^"]+)"', html))
    classes = set()
    for v in re.findall(r'\bclass\s*=\s*"([^"]+)"', html):
        classes.update(v.split())

    # href="#x"
    for h in set(re.findall(r'href\s*=\s*"#([^"]+)"', html)):
        if h and h not in ids:
            errs.append('导航链接 href="#%s" 找不到对应的 id（点了不会有反应）' % h)

    # getElementById('x')
    for g in set(re.findall(r'getElementById\(\s*[\'"]([^\'"]+)[\'"]\s*\)', html)):
        if g not in ids:
            errs.append("JS 里 getElementById('%s')，但 HTML 没有这个 id（会报错或静默失效）" % g)

    # querySelectorAll('.x') / querySelector('#x')
    for q in set(re.findall(r'querySelectorAll?\(\s*[\'"]([^\'"]+)[\'"]\s*\)', html)):
        for part in re.findall(r'\.([A-Za-z_][\w-]*)', q):
            if part not in classes:
                warns.append("JS 选择器 %s 里的 .%s 在 HTML 里没出现（动态添加的 class 属正常）" % (q, part))
        for part in re.findall(r'#([A-Za-z_][\w-]*)', q):
            if part not in ids:
                errs.append('JS 选择器 %s 里的 #%s 在 HTML 里没有对应 id' % (q, part))


def check_btns(html):
    """带 class 的按钮数 vs JS 里挂监听的选择器覆盖数，提醒漏挂的。"""
    sel = re.findall(r'querySelectorAll\(\s*[\'"]([^\'"]+)[\'"]\s*\)', html)
    n_btn = len(re.findall(r'<button\b', html))
    if n_btn:
        print('  页面共 %d 个 <button>；JS 里挂了 %d 个 querySelectorAll' % (n_btn, len(sel)))


def check_img_resolution(html):
    """内联图的**真实像素宽度**必须 ≥ 它在页面上的显示宽度。
    小于就是被浏览器放大——中文小字立刻糊，超采样救不回来。
    实测踩过：出图 900x576、页面单栏 1032px → 放大 1.15 倍 → 用户直接说"好糊"。"""
    import base64 as _b64, struct as _st
    full_w = 1032           # 实测：.wrap max-width 1080 − 左右 padding
    grid2 = bool(re.search(r'grid-template-columns\s*:\s*1fr\s+1fr', html))

    def jpeg_size(raw):
        i = 2
        while i < len(raw) - 9:
            if raw[i] != 0xFF:
                i += 1
                continue
            mk = raw[i + 1]
            if mk in (0xC0, 0xC1, 0xC2, 0xC3):
                h, w = _st.unpack('>HH', raw[i + 5:i + 9])
                return w, h
            if mk in (0xD8, 0xD9) or 0xD0 <= mk <= 0xD7:
                i += 2
                continue
            try:
                i += 2 + _st.unpack('>H', raw[i + 2:i + 4])[0]
            except Exception:
                break
        return None, None

    small = []
    for m in re.finditer(r'<img([^>]*?)src="data:image/(jpeg|png);base64,([A-Za-z0-9+/=]{500,})"', html):
        attrs, fmt, b64 = m.group(1), m.group(2), m.group(3)
        try:
            raw = _b64.b64decode(b64)
            if fmt == 'png':
                w, h = _st.unpack('>II', raw[16:24])
            else:
                w, h = jpeg_size(raw)
        except Exception:
            continue
        if not w:
            continue
        ctx = html[max(0, m.start() - 400):m.start()]
        # 只看**这张图自己的父容器**：父容器是多列 grid/flex 才算"双栏"。
        # ⚠️ 必须整词匹配 class 值 —— 写成 [^"]*shots[^"]* 会把 `shotlabel`（图注）也算进去，
        #    于是小缩略图被误报成"通栏被放大"。
        in_grid = bool(re.search(
            r'class="(?=[^"]*(?:^|\s)(?:shots|grid2|grid3|two|thumbs|fat)(?:\s|$))[^"]*"[^>]*>'
            r'(?:(?!<(?:/div|/figure|section)\b).){0,300}$', ctx, re.S))
        shown = full_w // 2 if in_grid else full_w
        if w < shown:
            alt = re.search(r'alt="([^"]*)"', attrs)
            small.append('%dx%d 的图会被放大到约 %dpx 显示（%.2f 倍），中文标注会糊：%s'
                         % (w, h, shown, shown / w, (alt.group(1) if alt else '(无 alt)')[:34]))
    for s in small:
        warns.append(s)
    if small:
        warns.append('↑ 以上是**估算上限**（按通栏宽度算的）。图若实际放在窄栏/缩略图里就不会被放大——'
                     '要确认请跑 shot.mjs 截图看，或依"最长边 >= 最终显示宽度的 2 倍"来定出图尺寸，'
                     '那样任何布局都不会糊。map-render2.py / map-widget.py 默认 hd=2（文件像素 = 显示宽 × 2），按显示宽给 width 就不会触发这条。')


def check_fixed_img_height(html):
    """img 写死 height 会把地图/照片压扁裁切。只在 <style> 里找，理由见 css_rules()。"""
    for sel, rule in css_rules(html):
        if re.search(r'(?<!max-)(?<!min-)\bheight\s*:\s*\d+px', rule) and 'object-fit' not in rule \
                and re.search(r'\bimg\b', sel):
            warns.append('%s { %s } —— 给图片写死 height 会把图压扁；'
                         '要 height:auto，确需裁切则配 object-fit:cover'
                         % (sel[:46], re.sub(r'\s+', ' ', rule).strip()[:52]))


def main():
    # Windows 控制台默认 GBK，打印 ✅ 会直接崩（实测）；强制 UTF-8
    for _s in (sys.stdout, sys.stderr):
        try:
            _s.reconfigure(encoding='utf-8')
        except Exception:
            pass
    if len(sys.argv) < 2:
        print('用法: python validate-html.py <file.html>'); sys.exit(2)
    path = sys.argv[1]
    html = io.open(path, encoding='utf-8').read()
    print('检查 %s  (%d 字节)' % (os.path.basename(path), len(html.encode('utf-8'))))

    import time as _t
    steps = [
        ('标签配对',        lambda: check_tags(html)),
        ('CSS 括号/固定高度', lambda: check_css(html)),
        ('JS 语法',         lambda: check_js(html)),
        ('锚点与 id 引用',   lambda: check_refs(html)),
        ('图像分辨率',       lambda: check_img_resolution(html)),
        ('图片固定高度',     lambda: check_fixed_img_height(html)),
    ]
    for name, fn in steps:
        t0 = _t.time()
        fn()
        dt = _t.time() - t0
        if dt > 1.0 or os.environ.get('VALIDATE_VERBOSE'):
            print('   · %s  %.1fs' % (name, dt))

    if errs:
        print('\n❌ 发现 %d 个错误：' % len(errs))
        for e in errs:
            print('   ' + e)
    if warns:
        print('\n⚠️  %d 条提示（不一定是错）：' % len(warns))
        for w in warns[:15]:
            print('   ' + w)
    if not errs:
        print('\n✅ 静态检查通过：标签配对、JS 语法、CSS 括号、锚点与 id 引用都没问题')
        check_btns(html)
        sys.exit(0)
    sys.exit(1)


if __name__ == '__main__':
    main()
