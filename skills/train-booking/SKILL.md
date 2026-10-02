---
name: train-booking
description: 12306 铁路查询技能（mcp__12306-mcp__*）。查直达/中转余票、车次经停站、站名↔车站代码转换；掌握车次过滤、时间窗口、排序与精简输出的技巧，节省 Token 并快速给出可执行的高铁/动车方案。
whenToUse: 用户需要查火车票、高铁动车班次、余票、中转方案、车站代码或车次经停信息时。
---

# 12306 火车票查询（mcp__12306-mcp__*）

工具通过 `mcp__12306-mcp__*` 前缀暴露（例如 `mcp__12306-mcp__get-tickets`）。实际工具名与参数名以工具目录为准；**所有参数名均为 camelCase**（`fromStation`/`toStation`/`trainFilterFlags`），已按实测列在下方。

> **数据来源**：本 MCP 为**本地自托管**（stdio，源码 Joooook/12306-mcp），直连 12306 官网后端接口（kyfw.12306.cn 余票查询、search.12306.cn 车次搜索），匿名 cookie 即可查询、无需登录。本地运行**不会过期**（替代了原先会 410 的 ModelScope 托管版）。查询异常多为 12306 官网临时不可达，稍等重试即可。

## 工具清单

| 工具 | 用途 |
|---|---|
| `get-current-date` | 取当前日期（上海时区 UTC+8，`yyyy-MM-dd`），用于解析「明天/下周」等相对日期 |
| `get-stations-code-in-city` | 城市 → 该市所有火车站及 station_code，如 `北京` |
| `get-station-code-of-citys` | 城市 → 代表站 station_code，多城市用 `\|` 分隔（`北京\|上海`） |
| `get-station-code-by-names` | 具体站名 → station_code，多站用 `\|` 分隔（`北京南\|上海虹桥`），参数 `stationNames` |
| `get-station-by-telecode` | 电报码 → 车站详情（补充/调试用） |
| `get-tickets` | 直达余票查询（核心） |
| `get-interline-tickets` | 中转余票查询（直达无票时用） |
| `get-train-route-stations` | 指定车次在指定日期的经停站、到发时间 |

## 查直达余票（get-tickets）

- `date`（必填）：`YYYY-MM-DD`，不能早于当天
- `fromStation` / `toStation`（必填）：中文站名（`上海`、`北京南`）或电报码（`VNP`）均可
- `trainFilterFlags`：车次过滤，可组合，**建议必填**以省 Token：
  - `G` 高铁/城际、`D` 动车、`Z` 直达、`T` 特快、`K` 快速、`O` 其他、`F` 复兴号、`S` 智能动车组
  - 例：只要高铁动车 → `"GD"`；只要复兴号 → `"F"`
- `earliestStartTime` / `latestStartTime`：发车小时窗口（如 7–21 点 → `7` / `22`）
- `sortFlag`：`startTime`（出发）/ `arriveTime`（到达）/ `duration`（时长）；`sortReverse` 倒序
- `limitedNum`：返回数量上限，0 不限制
- `format`：`text` / `csv` / `json`，默认 `text`

## 查中转（get-interline-tickets）

- 直达无票或用户要中转方案时使用；参数同上
- `middleStation` 可指定中转站，留空由接口推荐
- `showWZ` 是否显示无座方案（默认 false）
- 用 `limitedNum`（默认 10）控制返回量

## 查经停（get-train-route-stations）

- `trainCode`：如 `G1033`；`departDate`：`YYYY-MM-DD`
- 用于回答「这趟车经过哪些站」「几点到某站」

## 使用技巧

1. **先换车站代码再查询**：不确定站名时先 `get-station-code-of-citys` 或 `get-stations-code-in-city`，避免查空。
2. **必填过滤参数**：`trainFilterFlags="G"` 或 `"GD"`，否则结果里混入普速列车，浪费 Token。
3. **设时间窗口**：用户说「上午出发」→ `earliestStartTime=6, latestStartTime=13`。
4. **控制数量**：默认列 5-10 班即可，除非用户要求全部；排序用 `sortFlag=duration` 优先短途。
5. **相对日期**：先 `get-current-date` 确认「今天」再推算。
6. **站点别写错**：上海有 `上海`、`上海南`、`上海虹桥`、`上海西`；北京有 `北京`、`北京南`、`北京西`、`北京朝阳`、`北京丰台`。查空时换站名重试。
7. **结果呈现**：给出行程对比表（车次/出发-到达/历时/座位与票价），推荐 1-2 个方案 + 购票入口（12306.cn / 铁路12306 App），不要罗列全部。

## 超出预售期（12306 只放 15 天内的票，含今天）

出行日在 15 天窗口外时，**不要说"查不到票"就了事，也不要反复重试**：

1. **说清为什么**：告知"该日期尚未开售"并给出预计开售日（MCP 会直接返回，例如"约在 2026-10-03 开售"）。
2. **退到窗口内最接近的日期取参考样本**：查相邻日期或同星期几的班次，用来判断班次密度、历时、票价档位（高铁票价与时段结构常年稳定，样本有参考价值）。回程超窗口时，也可以查反方向已开售日期的同线路作样本。
3. **⚠️ 必须显式标注**：网页里写成"**参考样本（X 月 X 日实测），非出行日实际票价/余票**"，数据说明里写清样本日期与真实开售日。**绝不把样本价当作出行日票价呈现。**
4. 在行动清单里加一条"X 月 X 日开售当天去 12306 查/抢"。

## 不可用时

`mcp__12306-mcp__*` 不可用（本地服务器启动时官网暂不可达、查询超时等）→ 稍等片刻重试 1-2 次；仍失败则如实告知用户 12306 官网可能临时不可达，**不要编造车次与余票**。服务器进程退出后 mcp-client 会自动重连重启。
