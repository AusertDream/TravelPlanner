# 第三方说明

本项目本身以 MIT 许可证发布（见 [LICENSE](LICENSE)）。以下内容来自第三方或依赖第三方服务：

## 随仓库分发（改编）

| 内容 | 来源 | 许可证 | 改动 |
|---|---|---|---|
| `skills/amap-cli-skill/SKILL.md` | [`@amap-lbs/amap-gui`](https://www.npmjs.com/package/@amap-lbs/amap-gui) 自带的 SKILL.md | MIT | Key 读取方式改为本项目的 `.env` + `run.sh`；补充 DSH 下的实测坑 |
| `vendor/12306-mcp/presale-guard.patch` | 针对 [Joooook/12306-mcp](https://github.com/Joooook/12306-mcp) 的补丁（不含上游源码） | MIT | 预售期外的日期不再抛异常 |

## 安装时从官方渠道获取（不随仓库分发）

| 依赖 | 获取方式 | 许可证 |
|---|---|---|
| 12306 MCP | 安装脚本从 GitHub 克隆 | MIT |
| `flyai` CLI（飞猪） | `npm install -g @fly-ai/flyai-cli` | MIT |
| `amap-gui` CLI（高德） | `npm install -g @amap-lbs/amap-gui` | MIT |
| `tuniu` CLI 与 `tuniu-cli` 技能（途牛） | `npm install -g tuniu-cli`，技能从该包复制 | MIT |
| `agent-reach`（可选） | [Panniantong/Agent-Reach](https://github.com/Panniantong/Agent-Reach) | 见上游 |
| `design-taste-frontend`（可选） | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) | MIT |

## 运行时调用的在线服务

高德开放平台、飞猪旅行 AI 开放平台、途牛开放平台、12306、Google Maps Platform、Unsplash、Wikimedia Commons、open.er-api.com / Frankfurter（汇率）。
使用这些服务须遵守各自的服务条款；Key 由使用者自行申请，本项目不提供任何 Key。

地图瓦片与路线数据 © 高德地图（GCJ-02 坐标）；Google 地图 © Google。
