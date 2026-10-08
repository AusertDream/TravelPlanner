# Key 申请指南

所有 Key 只放在一个地方：

```
~/.dsh/preset-assets/travel-planner/.env
```

Windows 上是 `C:\Users\<你的用户名>\.dsh\preset-assets\travel-planner\.env`。安装脚本会从模板生成这个文件；用记事本或任意编辑器打开，在等号后面填值：

```ini
AMAP_KEY=粘贴高德的 Key
AMAP_SECURITY_KEY=粘贴高德的安全密钥
FLYAI_API_KEY=粘贴飞猪的 API Key
```

- 等号两边不要留空格；值里有空格（比如路径）就用双引号括起来。
- **保存即生效**：工具每次调用都现读 `.env`，不用重启 DSH。在对话里告诉 agent「填好了」，它会再自检一次。
- 填完自己检查：`node ~/.dsh/preset-assets/travel-planner/doctor.mjs`
- `.env` 已在 `.gitignore` 里，别把它发给别人、别贴进聊天。

---

## 1. 高德地图 `AMAP_KEY` + `AMAP_SECURITY_KEY`（必需）

**管什么**：景点/餐厅/酒店的坐标与地址、市内路线规划（地铁/公交/步行/驾车）、路书地图上的真实路线和票价。

**申请**（个人开发者免费，额度够个人用）：

1. 打开 <https://console.amap.com/dev/key/app>，注册并登录，完成个人开发者认证。
2. 「应用管理 → 我的应用」→「创建新应用」，名字随便填（如 `travel-planner`）。
3. 在这个应用下点「添加 Key」，**服务平台选「Web端(JS API)」**，提交。
4. 列表里出现两串 32 位字符：
   - **Key** → 填 `AMAP_KEY`
   - **安全密钥** → 填 `AMAP_SECURITY_KEY`

> 服务平台选错（比如选了「Web服务」）时，地图容器和真实路线会报 `USERKEY_PLAT_NOMATCH` / `INVALID_USER_KEY` 一类的错误，重新添加一个「Web端(JS API)」的 Key 即可。

## 2. 飞猪 `FLYAI_API_KEY`（必需）

**管什么**：机票、酒店、景点门票的实时价格，是机票和酒店的首选数据源（国内 + 国际，没有频率限制）。

**申请**：

1. 打开 <https://flyai.open.fliggy.com/>，注册并登录。
2. 按页面提示完成平台实名认证。
3. 在控制台领取 API Key，填 `FLYAI_API_KEY`。

**不填会怎样**：`flyai` 退回「体验模式」。机票价格基本还准，但**酒店价格会被遮蔽**成 `¥3xx` 这种，agent 没法给出可靠的三档酒店推荐（它会如实告诉你结果受限）。

## 3. Google Maps `GOOGLE_MAPS_API_KEY`（可选增强）

**管什么**：路书打开时，地图直接加载可拖动缩放的 Google 地图（编号点 + 中文名 + 路线）。

**不填会怎样**：一切照常。地图组件按「Google 无 Key 嵌入 → 高德瓦片可拖动地图 → 静态图」自动降级，不会白屏。在国内网络下高德瓦片反而更稳。

**申请**：

1. 打开 <https://console.cloud.google.com/google/maps-apis/credentials>，新建一个项目。
2. 启用 **Maps JavaScript API**。Google 要求绑定结算账号，但每月有免费额度，个人看路书用不完。
3. 「创建凭据 → API 密钥」，复制填 `GOOGLE_MAPS_API_KEY`。
4. **一定要做的限制**（这个 Key 会明文写进路书 HTML，路书会被转发）：
   - 「API 限制」只勾 **Maps JavaScript API**；
   - 在配额页给 Maps JavaScript API 设**每日上限**；
   - **不要**加「网站（HTTP referrer）」限制：路书用 `file://` 打开没有 Referer，加了会直接报错。

某份路书不想带 Key（比如要公开发出去）：让 agent 生成地图时加 `--no-google-key`。

GitHub Pages 上的在线示例只放静态地图，不用 Key。

Key 填错时，地图会显示「Google key 无效，请检查 .env 里的 GOOGLE_MAPS_API_KEY」并自动换成高德底图。

## 4. Unsplash `UNSPLASH_ACCESS_KEY`（可选）

**管什么**：路书配图（氛围图）。不填就用 Wikimedia（免 Key）。

1. 打开 <https://unsplash.com/developers>，注册登录。
2. 「Your apps → New Application」，同意使用条款。
3. 复制 **Access Key**（不是 Secret Key），填 `UNSPLASH_ACCESS_KEY`。

## 5. 途牛 `TUNIU_API_KEY`（可选，一般不用填）

途牛走网页授权。在终端运行：

```bash
tuniu auth login --daemon
```

打开它输出的链接，登录授权即可。agent 也可能在需要时把这个链接发给你，登录和扫码都由你自己完成。

需要 API Key 兜底时去 <https://open.tuniu.com> 申请。途牛有配额：每分钟 5 次、每天 50 次，agent 会自己控制节奏。

## 6. 其他可选设置

```ini
# 访问境外资源（Wikimedia 配图、境外网页）需要代理时；国内站点会自动直连
HTTPS_PROXY=http://127.0.0.1:7890

# Chrome / Edge 不在默认位置时（真实路线、截图、交付检查要用无头浏览器）
CHROME_PATH="D:/Apps/Chrome/chrome.exe"

# 指定 Python 解释器
PYTHON=python3
```

联网搜索（DSH 内置 web 工具、agent-reach、Exa、Jina）**不需要任何 Key**。
