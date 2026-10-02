#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
#  交付门禁（deliver-check）—— 一条命令跑完所有交付前检查，没过就别交付
#
#  用法：bash ~/.dsh/preset-assets/travel-planner/deliver-check.sh "D:/path/路书.html"
#  返回码：0 = 可以交付；1 = 有必须修的问题（逐条列出）
#
#  依次做：
#   1. validate-html.py   标签/JS 语法/CSS 括号/锚点/图被放大/章节写死高度
#   2. check-layout.mjs   桌面 1371×900 与手机 390×844 两种宽度的遮挡/溢出/零尺寸/横向溢出
#   3. 内容检查           地图是否用了 map-widget、路线是否是真实路线、体积、残留占位词
#   4. 截一张首屏图       out: <路书名>.check.png —— 交付前用 read_image 自己看一眼
# ──────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
F="${1:?用法: deliver-check.sh <路书.html>}"
[ -f "$F" ] || { echo "❌ 找不到文件：$F"; exit 2; }
export PYTHONIOENCODING=utf-8
# .env 里可能有 CHROME_PATH / PYTHON（浏览器、Python 装在非常规位置时）
if [ -f "$HERE/.env" ]; then set -a; . "$HERE/.env"; set +a; fi
PY="${PYTHON:-}"
if [ -z "$PY" ]; then
  for c in python python3; do
    if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info[0] == 3 else 1)' >/dev/null 2>&1; then PY="$c"; break; fi
  done
fi
[ -n "$PY" ] || { echo "❌ 找不到 Python 3（node \"$HERE/doctor.mjs\" 看怎么装）"; exit 2; }
ABS="$(cd "$(dirname "$F")" && pwd -W 2>/dev/null || pwd)/$(basename "$F")"
URL="file:///${ABS#/}"
FAIL=0; WARN=0
hr(){ echo; echo "── $1 ──────────────────────────────"; }

hr "1/4 静态检查"
"$PY" "$HERE/validate-html.py" "$F" || FAIL=1

hr "2/4 布局检查（桌面 1371×900）"
timeout 120 node "$HERE/check-layout.mjs" "$URL" 1371 900 || FAIL=1
hr "2/4 布局检查（手机 390×844）"
CDP_PORT=9334 timeout 120 node "$HERE/check-layout.mjs" "$URL" 390 844 || { echo "（手机宽度有问题：至少要保证没有横向溢出、文字没被盖住）"; FAIL=1; }

hr "3/4 内容检查"
"$PY" - "$F" <<'PY' || FAIL=1
import re, sys, os
p = sys.argv[1]; s = open(p, encoding='utf-8').read(); bad = 0
txt = re.sub(r'<script\b.*?</script>|<style\b.*?</style>|data:[\w/+.-]+;base64,[A-Za-z0-9+/=]+', ' ', s, flags=re.S)   # 只在可见文字里找占位词
mb = os.path.getsize(p) / 1048576
print(f"  体积 {mb:.1f} MB" + ("  ⚠ 超过 8 MB，手机打开会慢：照片 --max-width 降到 1000 或减少张数" if mb > 8 else ""))
maps = s.count('class="tmap"')
print(f"  map-widget 地图 {maps} 张")
if maps == 0:
    print("  ❌ 没有用 map-widget.py 出地图（travel-maps 技能）：静态图字小、不能拖、没导航链接"); bad = 1
if maps and 'stroke-dasharray="5 5"' not in s and '高德实时规划' not in s:
    print("  ⚠ 地图里没有真实路线：逐日动线的 spec 要写 \"real_route\"（travel-maps 技能）")
for w in ['TODO', 'TBD', 'lorem', '待补充', '示例数据', 'XXX', '某某']:
    if w in txt:
        print(f"  ❌ 页面里残留占位词「{w}」"); bad = 1
if '"gkey": "AIza' in s:
    print("  ℹ 页面内嵌了 Google Maps key（转发前确认 key 已在控制台限制 API 与配额）")
dead = [m for m in re.findall(r'<button\b[^>]*>', s) if 'onclick' not in m and 'class=' not in m and 'id=' not in m]
if dead:
    print(f"  ⚠ {len(dead)} 个 <button> 没有 class/id/onclick，可能是按了没反应的假按钮")
sys.exit(bad)
PY

hr "4/4 首屏截图"
OUT="${F%.html}.check.png"
timeout 90 node "$HERE/shot.mjs" "$URL" "body" "$OUT" 0 0 >/dev/null 2>&1 && echo "  已截图：$OUT（用 read_image 看一眼）" || echo "  截图失败（不阻断，但请人工打开看）"

echo
if [ $FAIL -eq 0 ]; then echo "✅ 交付门禁通过"; exit 0; else echo "❌ 交付门禁没过：按上面列出的问题修完再跑一次"; exit 1; fi
