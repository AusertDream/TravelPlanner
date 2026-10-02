# TravelPlanner · 旅行规划师

你专属的旅行规划师：一个跑在 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) 里的中文旅行规划 agent。

说一句「国庆从上海去成都玩 3 天，2 个人，预算 6000」，它会**实时查** 12306 余票、机票和酒店价格、高德真实路线，核实闭馆日、预约放票和天气，最后交给你一份**可以离线打开的单文件 HTML 路书**：逐日时间轴、可拖动地图、三档酒店、分项预算、每站导航链接都在里面。

> 它只做规划和查询，**绝不代订、代付**。所有价格都是查询时的参考价。

<p align="center"><img src="docs/images/hero.png" width="780" alt="路书首屏"></p>

## 它和「问一句 AI 给个攻略」有什么不同

| | 普通对话 | 旅行规划师 |
|---|---|---|
| 车次、票价、房价 | 凭记忆，常常过时或编造 | 当场查 12306 / 飞猪 / 途牛，标注来源和查询日期 |
| 市内怎么走 | 「坐地铁大概 30 分钟」 | 高德真实路线：几号线换几号线、多少分钟、票价几块 |
| 闭馆、预约、末班车 | 经常漏 | 先盘硬约束（闭馆日、放票时间、实名限量、末班缆车），再排行程 |
| 住哪 | 一个笼统的区域 | 按动线重心选址，三档价格（必有 < ¥200 和 < ¥400 的整间房），附房型实拍 |
| 交付 | 一大段聊天文字 | 一个 HTML 文件：图片内联、手机也能看、转发给同行的人直接打开 |

<p align="center"><img src="docs/images/map.jpg" width="780" alt="路书里的地图：高德底图 + 真实路线 + 每站导航"></p>

完整示例：[`examples/成都3天2晚路书.html`](examples/成都3天2晚路书.html)（下载后用浏览器打开）。

## 快速开始

**前提**：装好 [DSH 桌面版](https://github.com/deepseek-ai/deepseek-harness)并至少打开过一次；Node.js ≥ 22、Python 3、Git、Chrome 或 Edge。

```bash
# 1. 装三个数据源 CLI（飞猪 / 高德 / 途牛）
npm install -g @fly-ai/flyai-cli @amap-lbs/amap-gui tuniu-cli
python -m pip install pillow

# 2. 拉代码并安装（Windows 用 Git Bash 或 PowerShell 都行）
git clone https://github.com/AusertDream/TravelPlanner.git
cd TravelPlanner
node scripts/install.mjs
```

安装脚本会：复制工具脚本和技能 → 拉取并编译 12306 MCP → 把仓库注册成 DSH 的 bundle → 跑一遍环境自检，列出还缺哪些 Key。

**3. 填 Key**：打开自检报告里给出的 `.env`（默认 `~/.dsh/preset-assets/travel-planner/.env`），至少填上高德和飞猪。申请步骤见 [docs/KEYS.md](docs/KEYS.md)，都免费。

**4. 完全退出 DSH 再打开**（桌面版要在托盘图标上右键退出，只关窗口不算），新建会话，模式选「**旅行规划师**」。

详细步骤、选项和排障见 **[docs/INSTALL.md](docs/INSTALL.md)**。

## 需要哪些 Key

| Key | 必需？ | 管什么 | 没有会怎样 |
|---|---|---|---|
| `AMAP_KEY` + `AMAP_SECURITY_KEY` | **必需** | 高德 POI、市内路线、路书里的真实路线 | 查不了景点坐标和市内交通 |
| `FLYAI_API_KEY` | **必需** | 飞猪机票、酒店、门票实时价 | 进「体验模式」，酒店价格被遮蔽，三档酒店做不出来 |
| `GOOGLE_MAPS_API_KEY` | 可选增强 | 路书里直接加载可拖动的 Google 地图 | 自动降级到 Google 无 Key 嵌入 / 高德瓦片地图 / 静态图 |
| `UNSPLASH_ACCESS_KEY` | 可选 | 路书配图 | 改用 Wikimedia（免 Key） |
| `TUNIU_API_KEY` | 可选 | 途牛（第二数据源） | 一般走 `tuniu auth login` 网页授权，不用填 |

**不用记这张表**：agent 每个新会话开工前会自己跑一遍 `doctor.mjs` 自检。缺必需的 Key，它会停下来告诉你缺哪个、去哪申请、填到哪个文件；只是没配 Google Maps 的话，它不打断你，交付时顺带提一句。你也可以随时手动跑：

```bash
node ~/.dsh/preset-assets/travel-planner/doctor.mjs
```

## 只装技能（给别的 agent 用）

规划方法论、交通、住宿、地图、路书这些都写成了独立的技能（`skills/*/SKILL.md`，标准 Agent Skills 格式），可以单独装给 DSH 里的其他 agent，或 Claude Code 等其他支持技能的 agent：

```bash
node scripts/install.mjs --skills-only                                # 装到 ~/.dsh/skills（DSH 所有 agent 可用）
node scripts/install.mjs --skills-only --skills-dir ~/.agents/skills  # 多种 agent 共用的目录
node scripts/install.mjs --skills-only --skills-dir ~/.claude/skills  # Claude Code
```

`--skills-only` 会同时装上技能要调用的工具脚本（`~/.dsh/preset-assets/travel-planner/`），但不改 DSH 配置。

| 技能 | 内容 |
|---|---|
| `travel-planning` | **总控**：规划信条、需求访谈、行程骨架、逐日编排、自检；告诉 agent 每一步加载哪个模块 |
| `travel-constraints` | 硬约束：闭馆日、预约放票、实名限量、时段票、末班车、天气窗口、高原 |
| `travel-transport` | 大交通取舍（门到门时间比较飞机和高铁）、市内每段怎么走 |
| `travel-hotels` | 选址、三档价格梯度、途牛低配额下怎么挑、房型实拍图 |
| `travel-maps` | `map-widget.py` 地图组件、高德真实路线、出图尺寸 |
| `travel-roadbook` | 路书网页骨架、来源标注、天气与预算图表、交付门禁 |
| `train-booking` · `flyai-cli` · `amap-cli-skill` | 12306 / 飞猪 / 高德 工具用法与实测坑 |

## 怎么用

在「旅行规划师」模式里正常说话就行：

- 「十一从杭州去西安 4 天，两个大人一个 6 岁小孩，预算一万，想看兵马俑」
- 「帮我看看这份行程有没有问题」+ 贴上行程或截图
- 「第二天太赶了，换个轻松点的」——它会改网页，并告诉你改了什么

它只问必要的几件事：从哪出发（**绝不默认**）、日期、人数、预算、硬要求。偏好和节奏先按常理假设，直接出方案让你改。

一次完整规划大约 20–30 分钟（要查的东西多），产出一个 HTML 文件，放在会话的工作目录里。

## 它会守的规矩

- **不代订代付**：不下单、不提交证件信息、不确认价格。预订入口给你，你自己在官方渠道完成。
- **数据不编**：时刻、价格、开放时间都来自当次查询并标注来源；查不到就写「未查到，需自行核实」。
- **不爬小红书**：要参考某篇笔记，请把正文或截图发给它。
- **Key 只在 `.env` 一处**：技能、persona、脚本里都不写明文 Key；Google Maps Key 例外地会写进路书 HTML（浏览器要用），所以请务必按 [docs/KEYS.md](docs/KEYS.md) 设置 API 限制和配额。

## 仓库结构

```
TravelPlanner/
├── package.json          DSH bundle 清单（dsh.bundle.patch → preset/cordis.patch.yml）
├── preset/
│   ├── persona.txt       人格（唯一真相）
│   └── cordis.patch.yml  agent 的插件组合；persona 由 scripts/build-persona.mjs 写入
├── plugins/              DSH 插件：travel-env（读 .env、env_status / env_reload）、travel-finance（汇率）
├── assets/               工具脚本 → 安装到 ~/.dsh/preset-assets/travel-planner/
│   ├── doctor.mjs          环境自检
│   ├── run.sh              带 Key 执行 CLI（DSH 的 shell 拿不到 Host 注入的环境变量）
│   ├── map-widget.py       路书地图组件（静态底图 + 可拖动地图 + 真实路线 + 导航链接）
│   ├── amap-route.mjs      高德真实路线（无头浏览器里调 JSAPI）
│   ├── deliver-check.sh    交付门禁：静态检查 + 双宽度布局检查 + 内容检查 + 截图
│   └── …
├── skills/               技能 → 安装到 ~/.dsh/skills/
├── vendor/12306-mcp/     12306 MCP 的上游版本号 + 预售期补丁
├── scripts/              install.mjs（安装/升级/卸载）、build-persona.mjs、check.mjs
├── examples/             示例路书
└── docs/                 INSTALL · KEYS · DEVELOPMENT
```

改 agent、跑端到端测试、已知的坑：见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

## 兼容性

- 实测环境：Windows + DSH 桌面版 0.2.0-rc.2 + Node 24 + Python 3.13。
- macOS / Linux：脚本做了跨平台处理（浏览器路径、字体、进程清理），但没有完整跑过端到端，欢迎反馈。
- 面向中国大陆的行程（12306、高德、飞猪、途牛）；时间一律按北京时间。

## 许可证

[MIT](LICENSE)。第三方组件与在线服务见 [NOTICE.md](NOTICE.md)。
