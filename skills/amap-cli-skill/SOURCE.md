# 来源

本技能改编自 [`@amap-lbs/amap-gui`](https://www.npmjs.com/package/@amap-lbs/amap-gui)（MIT）自带的 `SKILL.md`：

- 去掉了 OpenClaw 专用的 Key 读取方式，改成从本项目的 `.env` 读取（经 `run.sh`）；
- 补充了在 DSH 里实测踩过的坑（`ELECTRON_RUN_AS_NODE`、残留进程抢单实例锁、启动轮询超时误报）。

命令与参数以 `amap-gui` CLI 为准；上游更新后请对照 `npm root -g`/@amap-lbs/amap-gui/SKILL.md 同步。
