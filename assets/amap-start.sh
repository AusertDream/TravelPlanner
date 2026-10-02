#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
#  旅行规划师 preset — amap-gui 一键启动脚本
#
#  同时解决三个反复踩到的坑：
#   1) AMAP_KEY 不在环境里 → 从 preset 的 .env 读取（唯一密钥存放处）
#   2) DSH 桌面端注入 ELECTRON_RUN_AS_NODE=1 → Electron 退化成纯 Node，
#      窗口起来但永远 "未配置 AMAP_KEY" / Stop timeout
#   3) `amap-gui start` 自带轮询只有 25 秒，而 Map ready 实际要 30–60 秒
#      → 经常误报 "Start timeout"，其实进程已经好了（看日志有 Map ready）
#
#  用法：bash ~/.dsh/preset-assets/travel-planner/amap-start.sh
# ──────────────────────────────────────────────────────────────────────
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$HERE/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ 找不到 .env：$ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

# ── 国内站点必须直连（同 run.sh）────────────────────────────────
# 设了 HTTP(S)_PROXY 而 NO_PROXY 只有 localhost 时，restapi.amap.com 也会被塞进
# 境外代理。显式排除国内域名。
export NO_PROXY="localhost,127.0.0.1,::1,12306.cn,.12306.cn,amap.com,.amap.com,gaode.com,.gaode.com,autonavi.com,.autonavi.com,tuniu.com,.tuniu.com,tuniucdn.com,.tuniucdn.com,fliggy.com,.fliggy.com,feizhu.com,.feizhu.com,alicdn.com,.alicdn.com,taobao.com,.taobao.com,tmall.com,.tmall.com"
export no_proxy="$NO_PROXY"

if [ -z "${AMAP_KEY:-}" ]; then
  echo "❌ .env 里 AMAP_KEY 为空，请先填写（申请：https://console.amap.com/dev/key/app）" >&2
  exit 1
fi
echo "✅ KEY 已加载：AMAP_KEY=${AMAP_KEY:0:6}…（${#AMAP_KEY} 位）"

# 1) 已在运行且地图就绪 → 直接复用
STATUS="$(env -u ELECTRON_RUN_AS_NODE amap-gui status 2>/dev/null || true)"
if printf '%s' "$STATUS" | grep -q '"mapReady": true'; then
  echo "✅ amap-gui 已在运行、地图就绪，直接复用"
  printf '%s\n' "$STATUS"
  exit 0
fi

# 2) 彻底清理残留进程 —— 这一步是关键
#    `amap-gui stop` 只 kill pid 文件里记录的那一个主进程，GPU/renderer/utility
#    子进程会残留并占着 Electron 用户目录（AppData\Roaming\Electron）的单实例锁，
#    导致下一次 start 的进程虽然活着、端口文件也写了，却永远不 ready
#    （表现为 Start timeout + mapReady:false，并且端口号会 +1）。
#    注意按命令行精确匹配 amap-gui，避免误杀其他 Electron 应用。
echo "· 清理 amap-gui 残留进程（含 GPU/renderer 子进程）…"
if command -v powershell.exe >/dev/null 2>&1; then
  powershell.exe -NoProfile -Command \
    "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | Where-Object { \$_.CommandLine -like '*amap-gui*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }" \
    >/dev/null 2>&1 || true
else
  pkill -f 'electron.*amap-gui' >/dev/null 2>&1 || true
fi
env -u ELECTRON_RUN_AS_NODE amap-gui stop >/dev/null 2>&1 || true
rm -f "${HOME}/.amap-gui/pid" "${HOME}/.amap-gui/port"
sleep 2

# 3) 启动（必须清除 ELECTRON_RUN_AS_NODE）
echo "· 启动中（Map ready 通常需要 30–60 秒，请稍候）…"
env -u ELECTRON_RUN_AS_NODE amap-gui start >/dev/null 2>&1 || true

# 4) 自己轮询，最多 120 秒 —— 忽略 CLI 那个 25 秒的误报
for i in $(seq 1 40); do
  sleep 3
  S="$(env -u ELECTRON_RUN_AS_NODE amap-gui status 2>/dev/null || true)"
  if printf '%s' "$S" | grep -q '"mapReady": true'; then
    echo "✅ 地图就绪（等待约 $((i * 3)) 秒）"
    printf '%s\n' "$S"
    exit 0
  fi
done

echo "❌ 120 秒内仍未就绪。最后状态：" >&2
env -u ELECTRON_RUN_AS_NODE amap-gui status >&2 2>&1 || true
echo "   排查日志：~/.amap-gui/logs/session-$(date +%Y-%m-%d).log（找 'Map ready'）" >&2
exit 1
