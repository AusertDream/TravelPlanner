# 开发与测试

这份文档写给想改这个 agent 的人：它由哪几块拼成、改了哪块怎么生效、怎么跑端到端验收，以及踩过的坑。

## 1. 它由什么拼成

旅行规划师不是一个独立程序，而是 DSH 里的一个 **agent preset**，由五块拼起来：

```
persona        人格与硬规矩，每轮都在上下文里                 preset/persona.txt
  + 插件组合   用哪些 DSH 插件、MCP 怎么接                    preset/cordis.patch.yml
  + 本地插件   读 .env（env_status / env_reload）、汇率        plugins/
  + 工具脚本   出图、真实路线、各类检查、自检                  assets/  → ~/.dsh/preset-assets/travel-planner/
  + 技能       方法论与交付规范，按步骤按需加载                skills/  → ~/.dsh/skills/
```

整个仓库是一个 DSH **bundle 包**：`package.json` 的 `dsh.bundle.patch` 指向 `preset/cordis.patch.yml`，它往配置树里插入一行 `@deepseek-ai/dsh-agent-preset`（id `preset-travel-planner`，agent id `travel-planner`）。本地插件通过包的子路径导出引用（`dsh-travel-planner/travel-env`），所以不需要写本机绝对路径；12306 MCP 的路径用 DSH 提供的 `!!js dshHomePath(...)` 表达式。

安装后 profile 里是一个**链接**：`~/.dsh/profiles/desktop/node_modules/dsh-travel-planner → <仓库>`。所以 persona 和插件组合改仓库就是改 agent 本身；技能和工具脚本是**复制**过去的，改完要重跑安装脚本。

从「添加插件」/ 插件市场装时只有 bundle 本身，工具脚本和技能靠**自举**补齐：`travel-env` 插件启动时比对 `~/.dsh/preset-assets/travel-planner/.install.json` 里的版本和 `package.json` 的版本，不一致就同步（逻辑在 `scripts/lib/sync.mjs`，和安装脚本共用）。所以**发版一定要改 `version`**，否则已装用户重开 DSH 也拿不到新的工具脚本和技能。

12306 MCP 那一行带 `disabled: !!js …existsSync(dshHomePath('tools', '12306-mcp', …))`：没编译好就自动停用，免得一个 MCP 起不来拖垮整个 DSH 的启动。

## 2. 改了之后怎么生效

| 改了什么 | 怎么生效 |
|---|---|
| `skills/*`、`assets/*` | `node scripts/install.mjs`（只复制有变化的文件，几秒钟）。不用重启 DSH，下次加载技能、下次调用脚本就是新的 |
| `preset/persona.txt` | `node scripts/build-persona.mjs`（写进 `cordis.patch.yml`），然后**重启 DSH** |
| `preset/cordis.patch.yml`、`plugins/*` | **重启 DSH** |
| `vendor/12306-mcp/*` | 删掉（或挪走）`~/.dsh/tools/12306-mcp` 后重跑安装脚本，再重启 DSH |

**重启要真的重启**：Windows 桌面版只关窗口、或 `taskkill /IM "DeepSeek Harness.exe"`（不带 `/F`）只会把窗口收起，后台 host 进程还活着，再打开只是把旧实例叫回前台。要托盘右键退出，或 `taskkill /F /T /PID <主进程>`。

> ⚠️ 别在插件管理器里反复开关这个 bundle：实测每开关一次就多一份 `12306-mcp` 的 node 进程（单进程能涨到 2.4 GB）。要改多处就攒一起改完再重启。

> ⚠️ `persona.txt` 是唯一真相。`cordis.patch.yml` 里那份是生成物，别手改。

提交前跑一遍仓库自检（CI 也跑这个）：

```bash
node scripts/check.mjs
```

它检查：JS / Python / Shell 语法、换行符、persona 是否已同步、技能 frontmatter（`name` 必须是 kebab-case 且等于目录名）、bundle 清单、**密钥与本机路径泄漏**。

## 3. 工具脚本（`assets/`）

| 脚本 | 干什么 | 关键点 |
|---|---|---|
| `doctor.mjs` | **环境自检**：必需 Key、可选 Key、CLI、Python + Pillow、浏览器、12306 MCP | persona 和 `travel-planning` 技能要求每个新会话开工前跑一次；`--quiet` / `--json` |
| `run.sh` | 读 `.env` 后执行命令 | 所有要 Key 的 CLI 都要经它跑（见 §4.1） |
| `amap-start.sh` | 启动高德 amap-gui 容器 | 清残留进程、清 `ELECTRON_RUN_AS_NODE`、自己轮询到就绪 |
| `map-widget.py` | **路书地图组件**：一条命令出一个 `<figure>`，静态底图 + HTML 中文标注 + 可拖动在线地图 + 每站高德/Google 导航链接 | 降级链 Google JS（有 Key）→ Google 无 Key 嵌入 → Leaflet + 高德瓦片 → 静态图；逐日动线写 `"real_route"` |
| `amap-route.mjs` | **高德真实路线**：无头浏览器里调高德 JSAPI，拿折线 + 里程/耗时/票价/换乘线路 | `amap-gui route` 的 CLI 不返回坐标，所以另起；有 QPS 退避 |
| `map-render2.py` | 出静态底图（高德瓦片拼图 + 中文标注） | `width` 填**显示宽度**（通栏 1040），文件自动 2×；瓦片缓存在 `.mapcache/` |
| `photo-fetch.py` | 抓配图（Unsplash / Wikimedia） | Unsplash 是氛围图库：搜题材词有效、搜地名无效 |
| `deliver-check.sh` | **交付门禁**：静态检查 + 桌面 1371 / 手机 390 两种宽度布局检查 + 内容检查 + 首屏截图 | 返回 ✅ 才交付；persona 里写死了 |
| `validate-html.py` | 静态检查：标签配对、内联 JS 语法、CSS 括号、悬空锚点、图被放大、章节写死高度 | |
| `check-layout.mjs` | 布局检查：遮挡、溢出、零尺寸容器、横向溢出 | 逐屏滚动扫描；第三方地图内部元素不算 |
| `shot.mjs` / `shot-inview.mjs` | 截图（按元素裁切 / 滚到元素再截并报告是否被盖住） | 截完**自己看一眼** |
| `click-test.mjs` | 模拟真实点击，验证按钮是否生效 | |
| `read-session.mjs` | 解码 DSH 会话日志，判断一次运行跑完没有 | `--latest` |
| `fix-roadbook.py` | 收尾修补（全局 `img` 护栏、清理不想要的地图组件） | |

本地插件（`plugins/`）：

| 插件 | 干什么 |
|---|---|
| `travel-env.mjs` | 会话启动时把 `.env` 注入 Host 进程环境；注册 `env_status`（脱敏查看，标出缺的必需 Key）和 `env_reload`（热重载）。占位值不注入 |
| `travel-finance.mjs` | `convert_to_cny`：外币换人民币（open.er-api.com → Frankfurter，10 分钟缓存） |

## 4. DSH 里几个必须知道的机制

### 4.1 shell 拿不到 Host 的环境变量

DSH 的 shell 执行器**不会**把 Host 进程的环境变量传给命令行进程：`env_status` 显示 Key 已注入，同一个会话的 shell 里却是空的；`.bashrc` 也不加载。所以：

```bash
bash ~/.dsh/preset-assets/travel-planner/run.sh flyai search-hotel ...   # 对
flyai search-hotel ...                                                    # 错：飞猪会退回体验模式
```

`run.sh` 每次现读 `.env`，所以用户改了 Key 保存即生效。

### 4.2 国内域名必须直连

系统里设了 `HTTP(S)_PROXY` 而 `NO_PROXY` 只有 `localhost` 时，12306 / 高德 / 飞猪 / 途牛会全被塞进境外代理（12306 直接 `ECONNRESET`）。`run.sh`、`amap-start.sh` 和 `cordis.patch.yml` 里 12306 MCP 的 `env` 都显式写了国内域名白名单。

### 4.3 结果摘要插件会吃掉技能原文

如果你的 DSH 装了把长工具结果交给小模型摘要的插件（例如 `tool-result-summarizer`），它会把 `skill` 加载出来的技能原文也压成几千字的读后感，agent 就不守技能里的规矩了。解决办法：让这类插件豁免 `skill` 和 `read` 工具。这也是为什么最要紧的几条规矩写在 persona 里（常驻上下文，不会被摘要），技能拆成了按步骤加载的小模块。

## 5. 端到端测试

### 5.1 两条路

**A. 手动对话**（测「对话手感」：会不会问对问题、回复像不像人）：在 DSH 里选「旅行规划师」直接聊。

**B. 任务看板无人值守**（测「能不能一路跑到交付」）：用 `task_board_create` + `task_board_run`：

| 字段 | 怎么填 |
|---|---|
| `mode` | `travel-planner` |
| `workspaceId` | **留空**（走默认工作区）。填路径会被当成 id 去查，直接 `workspace not found` |
| `goalRun` | `true`（自动续跑到交付） |
| `prompt` | **必须信息给全**：出发地、日期、人数、预算、硬要求 |

无人值守的两条硬约束（都踩过）：

1. **提示词必须给全**。缺参数时 agent 会用 `ask_user_question` 问，无人值守没人答 → 挂住 → 整轮超时。要测「会不会问对问题」请走 A。
2. **产物落在默认 profile 目录**（`~/.dsh/profiles/desktop/`），不是你的工作目录。

### 5.2 怎么知道它跑完了

别只看任务卡状态：产物做完了、会话卡在收尾，任务卡会一直停在 `running`。看会话日志有没有在写：

```bash
node ~/.dsh/preset-assets/travel-planner/read-session.mjs --latest
```

它会打出尾部事件，并检查 `turn/end` 在不在、结束原因、有没有卡在 `ask_user_question` 等人回答。日志是多帧 zstd（按魔数 `28 B5 2F FD` 切帧）。判据：日志空闲 7 分钟 ≈ 跑完；超过 10 分钟 ≈ 疑似卡死。

### 5.3 一次合格的运行

- 用时 20–30 分钟；`bash` 调用一百次左右、`read_image` 十几次、`present` 1 次
- 任务卡 `result: succeeded`，会话日志有 `turn/end {reason:{kind:"completed"}}`
- 只交付**一个** HTML；酒店三档里有 < ¥200 和 < ¥400 的；地图用 `map-widget.py` 且带真实路线

### 5.4 验收产物（必做）

```bash
bash ~/.dsh/preset-assets/travel-planner/deliver-check.sh "路径/路书.html"
```

返回 ✅ 再谈交付。它截的首屏图 `<路书>.check.png` **一定要自己看一眼**——grep 查不出「图盖住了字」。

### 5.5 从外部脚本驱动 DSH 桌面版

带调试端口启动，然后用 Chrome DevTools Protocol 点界面（新会话 → 选模式 → 粘提示词 → 发送）：

```powershell
Start-Process '<DSH 安装目录>\DeepSeek Harness.exe' -ArgumentList '--remote-debugging-port=9555'
```

改了 persona / 插件后要真的重启（见 §2），再用 `Get-CimInstance Win32_Process | ? CommandLine -match dsh-desktop-host` 确认 host 进程的启动时间是新的。

## 6. 已知的坑

按发现顺序，每条都真实发生过：

| # | 现象 | 根因 | 现在怎么防 |
|---|---|---|---|
| 1 | 地图压住「逐日行程」标题和时间轴 | CSS `#map{height:460px}` 而 `<section id="map">` 的 id 也叫 `map` → 整章被钉死在 460px，内容整块溢出 | `validate-html.py` 报「章节类容器写死高度」；每个 HTML 加 `section{height:auto}` |
| 2 | 所有按钮按了没反应 | 删代码块时正则把 `})();` 一起吃掉 → `<script>` 语法错误 → 整段 JS 不执行 | `validate-html.py` 用 `node --check` 查内联 JS；动过结构必须重跑 |
| 3 | 页面各处文字被图片穿过 | 同 #1 的溢出表现 | 同上 |
| 4 | 导航点了没反应 | `href="#tip"` 指向不存在的 id | `validate-html.py` 查悬空锚点 |
| 5 | 网格分隔线「乱飞」 | `flex-wrap` 用 `border-right` 当分隔线，换行时右边框成孤儿 | 改用 `border-left`（除首项） |
| 6 | 地图字小如芝麻粒 | 高德瓦片字号固定约 11px，范围铺太宽（z14 覆盖 30 km）就必然看不清 | 拆成「总览 + 局部（z16–17）」；放大图片没用 |
| 7 | 图片糊 | 出图尺寸小于显示尺寸，被浏览器放大 | `map-render2.py` 按显示宽度出 2× 图，小于 800px 告警 |
| 8 | 房型图被压扁 | `.shots img{height:132px}` + `object-fit` | 图片永不写死 `height` |
| 9 | 跑完不结束 / 卡死 | ① `rm -rf` 被安全策略拦下、挂在等批准 ② 无头 Chrome 截图重试循环 | persona 禁 `rm -r`；截图统一用 `shot.mjs`（带超时、只跑一次） |
| 10 | 无人值守运行挂死 | 提示词没给全 → `ask_user_question` 没人答 | 见 §5.1 |
| 11 | 任务卡秒挂 | `workspaceId` 填了路径 | 留空 |
| 12 | 自检工具自己卡死 | CSS 正则在 1 MB 文档上灾难性回溯 | 只在 `<style>` 块里跑 CSS 正则；标签扫描改手写扫描器 |
| 13 | 进程越来越多 | 每开关一次 bundle 多一份 `12306-mcp` 进程 | 攒一起改，重启生效 |
| 14 | 底图上的字小如芝麻粒（自己标的字清楚） | `map-render2.py` 旧版按 4 倍画布挑缩放级再整张缩小 | 重写：缩放级按显示尺寸挑、瓦片 1:1、整体 2× 再画标注 |
| 15 | 以为参考页「内嵌了 Google 地图」 | 参考页其实是静态底图 + SVG/HTML 叠加 + 每站 Google 导航链接 | `map-widget.py` 两者都做 |
| 16 | Google Key 无效时整块显示「糟糕！出了点问题」 | Key 被拒后同页的无 Key 嵌入也会报错 | 监听 `gm_authFailure`，直接跳到高德瓦片层并提示检查 Key |
| 17 | 脚本最后一行崩溃 `UnicodeEncodeError: 'gbk'` | Windows 控制台 GBK 打不出 ✅ | 所有脚本强制 stdout/stderr 为 UTF-8 |
| 18 | agent 不守技能里的规矩 | 结果摘要插件把技能原文压成读后感（见 §4.3） | 摘要插件豁免 `skill`/`read`；最要紧的 5 条写进 persona；技能拆模块 |
| 19 | 一页三张地图只有一张出得来 | 每个组件各自加载一遍 Google Maps JS API | 整页共用一次加载；`tilesloaded` 之后才切换；10 秒没出来回静态图 |
| 20 | 含机场的那天，市区几个点挤成一团 | 机场离市区 70 km，框选缩到城市级以外 | 自动识别离群点，不参与框选，在图边放「↘ 机场 · 直线 51 km」 |
| 21 | 12306 查询报 `Cannot read properties of undefined (reading 'result')` | 超出 15 天预售期时 12306 返回空体 | `vendor/12306-mcp/presale-guard.patch` |
| 22 | 临时目录越积越多（几个 GB） | 无头浏览器的配置目录用完没删 | `amap-route.mjs`、`map-widget.py` 用完自己清理 |

### 其他边界

- 只做规划与查询，**绝不代订代付**，不收集确认号 / PIN。
- **不抓小红书**（封号风险）；需要时请用户粘贴正文或发截图。
- 删东西别用 `rm -r` / `rm -rf`（会被拦），逐个 `rm -f`。
- 途牛配额：每分钟 5 次、每天 50 次，调用间隔 `sleep 13`，一轮 ≤ 4 次。
- 天气：国内目的地优先中国天气网 / 中央气象台；境外用 Open-Meteo；都要加不确定性提示。

## 7. 发版

1. 改 `package.json` 的 `version`（自举靠它判断要不要同步，别忘）。
2. `node scripts/check.mjs` 全绿。
3. 用户侧升级就是 `git pull && node scripts/install.mjs`，然后重启 DSH。
