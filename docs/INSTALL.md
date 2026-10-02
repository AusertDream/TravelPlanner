# 安装指南

- [0. 先准备好这些](#0-先准备好这些)
- [1. 装数据源 CLI](#1-装数据源-cli)
- [2. 克隆并运行安装脚本](#2-克隆并运行安装脚本)
- [3. 填 Key](#3-填-key)
- [4. 重启 DSH，选「旅行规划师」](#4-重启-dsh选旅行规划师)
- [安装脚本做了什么](#安装脚本做了什么) · [选项](#选项) · [升级](#升级) · [卸载](#卸载)
- [只装技能（给别的 agent 用）](#只装技能给别的-agent-用)
- [不用脚本，手动安装](#不用脚本手动安装)
- [排障](#排障)

---

## 0. 先准备好这些

| 东西 | 要求 | 用来干什么 | 检查 |
|---|---|---|---|
| **DSH** | 桌面版，或 `npm install -g @deepseek-ai/dsh` 的命令行版 | agent 的运行环境 | 至少打开过一次（会初始化 `~/.dsh/profiles/desktop`） |
| **Node.js** | ≥ 22 | 安装脚本、地图真实路线、交付检查 | `node -v` |
| **Python 3** | ≥ 3.9，带 Pillow | 出地图底图、静态检查 | `python -c "import PIL; print(PIL.__version__)"` |
| **Git** | Windows 装 [Git for Windows](https://git-scm.com/download/win) | 拉代码、拉 12306 MCP；DSH 在 Windows 上用 Git Bash 执行命令 | `git --version` |
| **Chrome 或 Edge** | 任意较新版本 | 无头浏览器：高德真实路线、截图、布局检查 | 装在默认位置即可，别处见 [KEYS.md §6](KEYS.md#6-其他可选设置) |

> Windows 上 `python` 如果弹出应用商店，说明装的是占位程序：去 <https://www.python.org/downloads/> 装正式版，安装时勾选 **Add python.exe to PATH**。

## 1. 装数据源 CLI

```bash
npm install -g @fly-ai/flyai-cli @amap-lbs/amap-gui tuniu-cli
python -m pip install pillow
```

| CLI | 数据 | 必需？ |
|---|---|---|
| `flyai` | 飞猪：机票、酒店、门票、火车票 | 必需 |
| `amap-gui` | 高德：POI、路线规划 | 必需 |
| `tuniu` | 途牛：机票、酒店、门票（第二数据源） | 推荐 |

## 2. 克隆并运行安装脚本

```bash
git clone https://github.com/AusertDream/TravelPlanner.git
cd TravelPlanner
node scripts/install.mjs
```

**仓库目录就是 agent 本体**（DSH 通过链接直接读它），装完别删、别挪。想换位置就挪完后重跑一次安装脚本。

建议先**完全退出 DSH** 再运行，否则 Windows 上可能因为文件被占用而注册失败。

正常的输出大致是这样：

```
[1] 工具脚本 → C:\Users\you\.dsh\preset-assets\travel-planner
  新增 16，更新 0，未变 0
  已从模板生成 .env：C:\Users\you\.dsh\preset-assets\travel-planner\.env
[2] 技能
  C:\Users\you\.dsh\skills：9 个技能，新增 9，更新 0，未变 0
[3] 12306 MCP → C:\Users\you\.dsh\tools\12306-mcp
  · 拉取上游源码 … · 打预售期补丁 … ✅ 编译完成
[4] 注册 DSH bundle（profile：desktop）
  ✅ 已登记为 DSH bundle
[5] 环境自检
  ……（列出还缺的 Key 和申请方法）
```

## 3. 填 Key

打开 `~/.dsh/preset-assets/travel-planner/.env`，至少填**高德**（`AMAP_KEY` + `AMAP_SECURITY_KEY`）和**飞猪**（`FLYAI_API_KEY`）。每个 Key 去哪申请、怎么填，见 **[KEYS.md](KEYS.md)**。

填完检查一下：

```bash
node ~/.dsh/preset-assets/travel-planner/doctor.mjs
```

最后一行是「✅ 必需项齐全」就好了。

## 4. 重启 DSH，选「旅行规划师」

1. **完全退出** DSH：桌面版要在托盘图标上右键「退出」，只关窗口的话后台进程还在，新配置不会加载。
2. 重新打开，新建会话，在模式里选「**旅行规划师**」。
3. 说一句试试：「十一从上海去成都 3 天，2 个人，预算 6000」。

agent 开工前会自己跑一次自检；缺 Key 它会直接告诉你。

---

## 安装脚本做了什么

| 装到哪 | 内容 | 重跑时 |
|---|---|---|
| `~/.dsh/preset-assets/travel-planner/` | 工具脚本（`assets/`）、`.env`、地图瓦片缓存 | 只替换有变化的脚本；`.env` 和缓存永远不动 |
| `~/.dsh/skills/<技能名>/` | 9 个技能，外加从 `tuniu-cli` npm 包复制的途牛技能 | 只替换有变化的技能 |
| `~/.dsh/tools/12306-mcp/` | 12306 MCP：上游源码 + 预售期补丁，已编译 | 已装好就跳过 |
| `~/.dsh/profiles/desktop/package.json` | 依赖 `dsh-travel-planner: link:<仓库路径>`，并登记进 `dsh.profile.bundles` | 已登记就跳过 |

被替换的旧文件不会直接删掉，而是挪到 `~/.dsh/_trash/travel-planner-<时间>/`，确认没问题后可以自己删。

注册 bundle 时，脚本优先用 `dsh plugin --profile desktop add link:<仓库>`（DSH 官方的插件管理命令）；找不到 `dsh` 时依次尝试 PATH 里的 `pnpm`、DSH 桌面版自带的 pnpm、`npx pnpm@11`。之后它只在 `dsh.profile.bundles` 里增删本项目这一条：`dsh plugin` 自己会把 profile 里所有带 bundle 的依赖都启用，脚本会把其他插件的启用状态恢复成原样。

## 选项

```bash
node scripts/install.mjs --help
```

| 选项 | 作用 |
|---|---|
| `--profile <名字>` | 装进哪个 DSH profile。默认 `desktop`（桌面版）；用 `dsh web` 的填 `web` |
| `--skills-only` | 只装技能 + 工具脚本，不改 DSH 配置、不装 12306 MCP |
| `--skills-dir <目录>` | 技能装到哪，可写多次。默认 `~/.dsh/skills` |
| `--no-12306` | 跳过 12306 MCP |
| `--no-bundle` | 不注册 DSH bundle |
| `--pnpm <路径>` | 指定 pnpm。DSH 桌面版自带一个：`<DSH 安装目录>/resources/runtime/pnpm/bin/pnpm.cjs` |
| `--dry-run` | 只列出要做的事，不改文件 |
| `--uninstall` | 卸载 |

设置了 `DSH_HOME` 环境变量时，上面所有 `~/.dsh` 都换成它。

## 升级

```bash
cd TravelPlanner
git pull
node scripts/install.mjs
```

然后完全退出并重开 DSH。只改了技能或工具脚本的话不用重启，下次调用就是新的；改了 persona 或插件组合才需要重启。

## 卸载

```bash
node scripts/install.mjs --uninstall
```

从 DSH 注销 bundle，把技能、工具脚本、12306 MCP 挪进 `~/.dsh/_trash/travel-planner-<时间>/`。**你的 `.env` 会保留**，不需要的话自己删。之后可以删掉仓库目录。

---

## 只装技能（给别的 agent 用）

技能是标准的 `SKILL.md` 格式（frontmatter 里有 `name` / `description`），能被多种 agent 读取。

```bash
# DSH 里的其他 agent（所有 preset 共用 ~/.dsh/skills）
node scripts/install.mjs --skills-only

# 多种 agent 共用的目录（DSH 也会扫描它）
node scripts/install.mjs --skills-only --skills-dir ~/.agents/skills

# Claude Code
node scripts/install.mjs --skills-only --skills-dir ~/.claude/skills
```

`--skills-only` 也会把工具脚本装到 `~/.dsh/preset-assets/travel-planner/`（技能里的命令都指向这里），并生成 `.env`。Key 照样按 [KEYS.md](KEYS.md) 填。

**想在别的 agent 里查火车票**：先把 12306 MCP 也装上，再把它接进那个 agent：

```bash
node scripts/install.mjs --no-bundle --skills-dir ~/.claude/skills   # 装技能 + 工具脚本 + 12306 MCP，不碰 DSH
claude mcp add 12306-mcp -- node <DSH 目录>/tools/12306-mcp/build/index.js   # Claude Code 示例
```

MCP 服务名要叫 `12306-mcp`，`train-booking` 技能里写的工具名是 `mcp__12306-mcp__*`。

在别的 agent 里用时要注意：

- 技能和 persona 是配套写的。只装技能时没有 persona，请在对话开头说一句「用 travel-planning 技能」，agent 才会按流程加载其他模块。
- 技能里提到的 DSH 内置工具（`read_image`、`ask_user_question`、`env_reload` 等），在其他 agent 里换成对应的工具即可。`env_reload` 可以忽略，`run.sh` 每次都现读 `.env`。

## 不用脚本，手动安装

```bash
D=~/.dsh   # 或你的 DSH_HOME

# 1. 工具脚本 + .env
mkdir -p $D/preset-assets/travel-planner
cp assets/* assets/.env.example $D/preset-assets/travel-planner/
cp -n assets/.env.example $D/preset-assets/travel-planner/.env

# 2. 技能
cp -r skills/* $D/skills/

# 3. 12306 MCP：见 vendor/12306-mcp/README.md

# 4. 注册 bundle：在 profile 目录里用 pnpm 加一个指向仓库的链接
cd ~/.dsh/profiles/desktop
pnpm add "link:<仓库绝对路径>"
```

然后编辑同目录的 `package.json`，把 `"dsh-travel-planner"` 加进 `dsh.profile.bundles` 数组末尾。

> 也可以用 `dsh plugin --profile desktop add "link:<仓库绝对路径>"` 代替 `pnpm add`，它会自动登记 bundle；但它会把 profile 里**所有**带 bundle 的依赖都启用，包括你特意关掉的插件，用完记得检查 `dsh.profile.bundles`。

---

## 排障

**模式列表里没有「旅行规划师」**

1. 确认是完全退出后重开的（托盘右键退出）。
2. 看 `~/.dsh/profiles/desktop/package.json`：`dependencies` 里要有 `"dsh-travel-planner": "link:…"`，`dsh.profile.bundles` 里要有 `"dsh-travel-planner"`。
3. 看 `~/.dsh/profiles/desktop/node_modules/dsh-travel-planner` 是不是指向仓库目录。
4. 仓库被挪走或删了会导致链接失效：重跑安装脚本。

**装过旧版（包名 `@local/dsh-travel-planner-preset`）**：安装脚本会自动先移除旧版。两个同时启用会因为 agent id 重复而冲突。

**注册 bundle 时报 `EBUSY` / `EPERM`**：DSH 还在运行，占着文件。完全退出后重跑。

**找不到 dsh / pnpm**：用 DSH 桌面版自带的 pnpm：

```bash
node scripts/install.mjs --pnpm "<DSH 安装目录>/resources/runtime/pnpm/bin/pnpm.cjs"
```

**拉取 12306 MCP 失败**：多半是访问 GitHub 不通。给 git 配上代理再重跑：

```bash
git config --global http.proxy http://127.0.0.1:<端口>
node scripts/install.mjs
```

不装 12306 MCP 也能用，查火车票会改走飞猪的 `flyai search-train`。

**agent 说「当前为体验模式」**：`FLYAI_API_KEY` 没填，或者填的是占位值。运行 `doctor.mjs` 看看。

**高德容器起不来（一直 `mapReady: false`）**：让 agent 用 `amap-start.sh` 启动，它会清掉残留进程再起。手动排查看 `~/.amap-gui/logs/`。

**路书里地图灰框、不出图**：网络连不上 Google 时会自动换成高德瓦片；还是不行就是高德 Key 的服务平台不是「Web端(JS API)」，见 [KEYS.md](KEYS.md#1-高德地图-amap_key--amap_security_key必需)。

**跑着跑着停住不动**：多半在等你审批某条命令（DSH 的权限设置），切到 DSH 窗口看一眼。
