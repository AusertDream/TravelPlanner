---
name: flyai-cli
description: 飞猪旅行 AI 开放平台 CLI（`flyai`）。查询机票（国内+国际）、酒店、景点门票/POI、火车票，并支持 AI 语义搜索与关键词搜索。用于查航班价格与时刻、找酒店并比价、找景点、查火车票，或用户提出"帮我搜一下/找找看"类模糊旅行需求时。价格为人民币，查询类能力，不做下单。
whenToUse: 用户需要查机票/航班、酒店/住宿、景点/门票、火车票，或需要按自然语言语义搜索旅行商品时。作为机票与酒店的首选数据源（国内+国际、无频率限制）。
---

# 飞猪旅行 AI CLI（`flyai`）

飞猪（Fliggy）官方旅行查询 CLI，覆盖机票、酒店、景点、火车票，并提供 AI 语义搜索。

## 鉴权（Key 从环境变量读取）

⚠️ **DSH 的 shell 子进程拿不到 Host 注入的环境变量**：实测在会话里 `FLYAI_API_KEY` 是空的（虽然同一个会话的 `env_status` 显示已注入 Host）。因此**不要直接跑 `flyai`**，否则会静默退回「体验模式」。

```bash
# 正确方式：经 run.sh 调用（它先从 .env 读出密钥注入当前 shell，再 exec 目标命令）
bash ~/.dsh/preset-assets/travel-planner/run.sh flyai search-flight --origin "上海" --destination "北京" --dep-date 2026-10-20

# 自查密钥是否已就绪（输出 0 = 没填；完整体检用 node ~/.dsh/preset-assets/travel-planner/doctor.mjs）
bash ~/.dsh/preset-assets/travel-planner/run.sh bash -c 'echo ${#FLYAI_API_KEY}'
```

- **Key 只在 `.env` 里**（`~/.dsh/preset-assets/travel-planner/.env`，模板 `.env.example`）。**不要**把 Key 写进任何文件，也**不要**用 `flyai config set` 落盘（那会写到 CLI 自己的配置文件，违背统一管理约定）。
- **申请地址**：<https://flyai.open.fliggy.com/> —— 注册并完成平台实名认证后领取 API Key。
- **未生效 / 留空 = 体验模式**：CLI 仍可查询但结果受限——**酒店价格会被遮蔽**成 `¥5xxx`、`¥1xx` 这类形式，部分结果缺失（机票价格通常仍然准确，所以**不能拿机票价格判断 Key 是否生效**）。看到「当前为体验模式」时：先检查是不是忘了用 `run.sh`；确认无误后须明确告知用户结果受限，**不要猜测或还原具体价格**。

## 命令总览

| 命令 | 用途 |
|---|---|
| `search-flight` | 机票（国内 + 国际） |
| `search-hotel`（别名 `search-hotels`） | 酒店 / 民宿 / 客栈 |
| `search-poi` | 景点 / 门票 |
| `search-train` | 火车票 |
| `ai-search` | AI 语义搜索（自然语言复杂需求） |
| `keyword-search`（别名 `fliggy-fast-search`） | 关键词搜索（酒店/机票/度假等） |
| `search-marriott-hotel` / `search-marriott-package` | 万豪集团酒店 / 酒店套餐 |

> 执行任何子命令前可先 `flyai <子命令> --help` 查看最新参数。

## 机票 `search-flight`

```bash
flyai search-flight --origin "上海" --destination "北京" --dep-date 2026-10-20
```

| 参数 | 说明 |
|---|---|
| `--origin` / `--destination` | 出发地/目的地：城市名、城市 ID 或机场 |
| `--dep-date` | 出发日期 `YYYY-MM-DD`；也可用 `--dep-date-start` / `--dep-date-end` 表示日期区间 |
| `--back-date` | 回程日期（往返）；区间式 `--back-date-start` / `--back-date-end` |
| `--journey-type` | `1`=直达，`2`=中转 |
| `--seat-class-name` | 舱位：`economy` / `business` / `first`（逗号分隔可多选） |
| `--transport-no` | 指定航班号（逗号分隔） |
| `--transfer-city` | 指定中转城市（逗号分隔） |
| `--dep-hour-start` / `--dep-hour-end` | 出发时段（24 小时制） |
| `--arr-hour-start` / `--arr-hour-end` | 到达时段 |
| `--total-duration-hour` | 总时长上限（小时） |
| `--max-price` | 最高价（人民币） |
| `--sort-type` | `1`价格降序 `2`推荐 `3`价格升序 `4`时长升序 `5`时长降序 `6`早出发 `7`晚出发 `8`直达优先 |

常用组合：

```bash
# 上午出发的直飞，按价格升序
flyai search-flight --origin "上海" --destination "北京" --dep-date 2026-10-20 \
  --journey-type 1 --dep-hour-start 6 --dep-hour-end 12 --sort-type 3

# 往返
flyai search-flight --origin "上海" --destination "东京" --dep-date 2026-10-20 --back-date 2026-10-27
```

## 酒店 `search-hotel`

```bash
flyai search-hotel --dest-name "上海" --check-in-date 2026-10-20 --check-out-date 2026-10-21
```

| 参数 | 说明 |
|---|---|
| `--dest-name` | 目的地：国家/省/市/区 |
| `--poi-name` | 按附近景点搜索（如 `"外滩"`、`"迪士尼"`） |
| `--key-words` | 关键词（如品牌、商圈） |
| `--hotel-types` | `hotel` 酒店 / `homestay` 民宿 / `inn` 客栈 |
| `--hotel-stars` | 星级 1-5（逗号分隔，如 `"4,5"`） |
| `--hotel-bed-types` | 床型：`king` 大床 / `twin` 双床 / `multi` 多床 |
| `--max-price` | 每晚最高价（人民币） |
| `--sort` | `distance_asc` 距离 / `rate_desc` 评分 / `price_asc` 低价 / `price_desc` 高价 / `no_rank` 默认 |
| `--check-in-date` / `--check-out-date` | 入住 / 退房日期 |

常用组合：

```bash
# 外滩附近四五星，每晚 800 以内，按价格升序
flyai search-hotel --dest-name "上海" --poi-name "外滩" --hotel-stars "4,5" \
  --max-price 800 --sort price_asc --check-in-date 2026-10-20 --check-out-date 2026-10-22
```

返回字段：`name` 酒店名、`address` 地址、`star` 星级、`price` 价格、`brandName` 品牌、`interestsPoi` 周边（如"近南京路步行街"）、`latitude`/`longitude` 坐标、`detailUrl` 详情/预订链接、`mainPic` 图片。

⚠️ 酒店的两个实测坑：

- **`mainPic` 是酒店门面/外景照，不是房型图**——不要拿它当"房间长什么样"展示。房型实拍图从途牛 `tuniuHotelDetail` 拿（见 `travel-hotels`）。
- **`--sort price_asc` 找便宜房会被青旅床位淹没**：实测苏州平江路按价格升序，前 10 全是 ¥24–56 的青旅/公寓床位，`--hotel-types hotel` 也过滤不掉。要找便宜的整间房，把 `--max-price` 放宽到 400 左右，再自己挑可识别的经济连锁（如家/汉庭/7天/锦江之星/尚客优/白玉兰）；或用途牛带价带搜索。

## 景点 `search-poi`

```bash
flyai search-poi --city-name "上海" --keyword "外滩"
```

| 参数 | 说明 |
|---|---|
| `--city-name` | 所在城市 |
| `--keyword` | 景点名称关键词 |
| `--poi-level` | 景点等级 1-5 |
| `--category` | 类别：`nature` `lake` `forest` `canyon` `beach` `island` `desert` `grassland` `historic site` `ancient town` `garden` `temple` `theme park` `water park` `zoo` `aquarium` `museum` `memorial` `landmark` `market` `outdoor` `skiing` `rafting` `surfing` `diving` `camping` `hot spring` |

## 火车票 `search-train`

```bash
flyai search-train --origin "上海" --destination "北京" --dep-date 2026-10-20
```

参数与 `search-flight` 基本一致；`--seat-class-name` 取值为 `second class` / `first class` / `business class` / `hard sleeper` / `soft sleeper`。

> 火车票的**权威数据源仍是 12306**（`mcp__12306-mcp__*`，见 `train-booking` 技能）：查余票、经停站、中转请优先用 12306；飞猪火车票可作为交叉参考。

## AI 语义搜索 `ai-search`

适合把用户一句自然语言需求直接交给平台理解：

```bash
flyai ai-search --query "国庆从上海出发，3天亲子游，预算5000，要带泳池的酒店"
```

## 关键词搜索 `keyword-search`

```bash
flyai keyword-search --query "杭州3日游"
flyai keyword-search --query "香港电话卡"
```

## 输出与呈现

- 输出为 JSON（`{"data":{"itemList":[...]},"message":"success","status":0,...}`）；解析 `data.itemList` 后**转成中文表格/卡片**再给用户，不要直接贴原始 JSON。
- 价格一律标注「参考价」，人民币；最终以用户下单时为准。
- 航班信息给：航司+航班号、起降机场与时刻、时长、是否直达/中转、参考价、购票入口。
- 酒店信息给：名称、星级/品牌、位置（`interestsPoi`/地址）、参考价、预订链接；按区域分档推荐 2-3 家即可，不必罗列全部。
- 若 `systemMessage` 提示体验模式，必须转达「价格不完整」这一限制。

## 注意事项

1. **只查不订**：本 CLI 提供查询能力；本 Agent 严禁代替用户下单/支付（详见 preset 硬性禁令）。需要预订时给出 `detailUrl` 等入口，由用户自行完成。
2. **Windows 退出断言**：命令执行后会打印 `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94`——这是 CLI 退出时的 libuv 无害断言，**结果已正常输出，忽略即可**。
3. **日期**：相对日期（"明天"）先换算成 `YYYY-MM-DD` 再传入；上海时区（UTC+8）。
4. **分工**：机票与酒店首选飞猪（无频率限制）；火车余票优先 12306；途牛（`tuniu-cli`）作为补充（有 5 次/分钟、50 次/天配额限制）。
5. **与其他数据源交叉验证**：飞猪价格与外呼渠道可能有差异，涉及重要决策时可与途牛/12306 结果对照，并如实说明来源。
