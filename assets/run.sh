#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
#  旅行规划助手 — 带密钥执行器（run.sh）
#
#  为什么需要它：
#    DSH 的 shell 执行器**不会**把 Host 进程注入的环境变量传给命令行进程，
#    实测在旅行规划助手会话里 `FLYAI=0 AMAP=0 TUNIU=0`（连 Windows 用户级变量
#    也拿不到）。因此 flyai / tuniu / amap-gui 直接调用会缺 Key：
#      · flyai  → 退回「体验模式」（酒店价格被遮蔽）
#      · amap-gui → 窗口报「未配置 AMAP_KEY」
#    本脚本先从 .env 读出密钥注入当前 shell，再 exec 目标命令。
#
#  顺带处理 ELECTRON_RUN_AS_NODE：
#    DSH 桌面端会注入 `ELECTRON_RUN_AS_NODE=1`，会让 amap-gui 的 Electron
#    退化成纯 Node 模式（永远起不来），所以这里一并清除。
#
#  用法：
#    bash ~/.dsh/preset-assets/travel-planner/run.sh <命令> [参数...]
#
#  例子：
#    bash ~/.dsh/preset-assets/travel-planner/run.sh flyai search-flight \
#         --origin "上海" --destination "北京" --dep-date 2026-10-20
#    bash ~/.dsh/preset-assets/travel-planner/run.sh amap-gui status
# ──────────────────────────────────────────────────────────────────────
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$HERE/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ 找不到密钥文件：$ENV_FILE" >&2
  echo "   先复制模板再填 Key：cp \"$HERE/.env.example\" \"$ENV_FILE\"" >&2
  echo "   缺哪些、去哪申请：node \"$HERE/doctor.mjs\"" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

# amap-gui（Electron）必须清除该变量，否则退化成纯 Node
unset ELECTRON_RUN_AS_NODE

# ── 国内站点必须直连 ──────────────────────────────────────────────
# 如果系统或 .env 里设了 HTTP(S)_PROXY（翻墙代理）而 NO_PROXY 只写了 localhost，
# 12306 / 高德 / 途牛 / 飞猪 会全被塞进境外代理（实测 12306 因此 TLS 被重置：ECONNRESET）。
# 这里显式补上国内域名白名单。
export NO_PROXY="localhost,127.0.0.1,::1,12306.cn,.12306.cn,amap.com,.amap.com,gaode.com,.gaode.com,autonavi.com,.autonavi.com,tuniu.com,.tuniu.com,tuniucdn.com,.tuniucdn.com,fliggy.com,.fliggy.com,feizhu.com,.feizhu.com,alicdn.com,.alicdn.com,taobao.com,.taobao.com,tmall.com,.tmall.com"
export no_proxy="$NO_PROXY"

if [ "$#" -eq 0 ]; then
  echo "已加载 .env：AMAP_KEY=${#AMAP_KEY} 位、AMAP_SECURITY_KEY=${#AMAP_SECURITY_KEY} 位、FLYAI_API_KEY=${#FLYAI_API_KEY} 位、TUNIU_API_KEY=${#TUNIU_API_KEY} 位" >&2
  echo "用法：bash $0 <命令> [参数...]" >&2
  exit 2
fi

exec "$@"
