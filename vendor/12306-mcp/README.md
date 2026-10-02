# 12306 MCP（上游 + 一个本地补丁）

本项目查火车票用的是 [Joooook/12306-mcp](https://github.com/Joooook/12306-mcp)（MIT），本地自托管、直连 12306 官网接口、无需登录。
仓库里**不包含上游源码**，只有：

| 文件 | 内容 |
|---|---|
| `UPSTREAM_COMMIT` | 验证过的上游提交（v0.3.10） |
| `presale-guard.patch` | 补丁：查询超出 15 天预售期的日期时，返回「尚未开售，约在 X 日开售」，而不是抛 `Cannot read properties of undefined (reading 'result')` |

`node scripts/install.mjs` 会自动：克隆上游 → 切到 `UPSTREAM_COMMIT` → `git apply presale-guard.patch` → `npm ci`（自动编译）→ 放到 `~/.dsh/tools/12306-mcp`。

## 为什么要这个补丁

12306 对预售期外的日期返回空响应体，上游代码直接读 `queryResponse.data.result` 就崩了。报错看起来像「12306 服务故障」，agent 会误判为接口挂了并反复重试，其实只是还没开售。补丁在 `get-tickets` 和 `get-interline-tickets` 两处加了空值守卫。

## 手动安装

```bash
git clone https://github.com/Joooook/12306-mcp.git ~/.dsh/tools/12306-mcp
cd ~/.dsh/tools/12306-mcp
git checkout "$(cat <本仓库>/vendor/12306-mcp/UPSTREAM_COMMIT)"
git apply <本仓库>/vendor/12306-mcp/presale-guard.patch
npm ci
```

## 升级上游

换成新的上游提交后，重新生成补丁并确认能干净地打上：

```bash
cd ~/.dsh/tools/12306-mcp && git diff -- src/index.ts > <本仓库>/vendor/12306-mcp/presale-guard.patch
```
