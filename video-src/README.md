# 宣传片构建源码

成片就是用这些脚本做出来的，留着方便以后改词、改画面后重新渲染。用到的素材（角色图、背景图、走路动画帧）在 `art/`。

成片、封面、字幕和发布文案放在仓库根目录的 `video/`，不入库（成片 170 MB，音视频文件都不进 git）。

| 文件 | 作用 |
|---|---|
| `script.json` | 旁白脚本：`sub` 是字幕文本，里面的竖线表示字幕在这里断开；`tts` 是给语音合成读的文本（数字写成汉字）；`rate` 是这一场的语速 |
| `tts.mjs` | 用 Edge TTS（zh-CN-XiaoyiNeural）逐句生成配音，并导出逐词时间戳 |
| `sep_vocals.py` | 从参考 MV 里取干净人声：MelBand RoFormer 分离 + 非平稳降噪 |
| `batch_vc.py` | 用 Seed-VC 44.1 kHz 音高条件模型把每句配音转换成参考音色（沿用原始语调、时长不变，逐词时间戳继续可用）；也能指定随机种子重转个别句子 |
| `voice_prep.py` | 转换后的配音按原始配音的停顿做门限（去掉停顿里的底噪和拖尾气声）、统一响度、转 48 kHz，写成 `audio/<id>/voice.wav`（混音时优先用它） |
| `timeline.py` | 根据配音时长和逐词时间戳排出场景、台词、字幕的时间轴 |
| `prep.mjs` | 把时间轴写成 `timeline.js`，把用到的 lucide 图标打包成 `icons.js` |
| `index.html` + `main.js` | 合成页面（GSAP）：12 个场景的版式和动画，动画按逐词时间对齐；`window.seek(t)` 渲染任意时刻 |
| `frames.mjs` | 按给定时刻截帧拼成一张预览图，用来检查版式 |
| `render.mjs` / `render_all.sh` | 无头 Chrome 逐帧截图，经管道交给 ffmpeg，以 60fps 分段并行编码 |
| `cues.mjs` + `sfx.mjs` + `mix.py` | 导出画面音效触发点、程序合成音效，再混音：旁白 + 音效 + 自动压低的 BGM |
| `srt.py` | 从时间轴导出 `字幕.srt` |
| `cover.html` / `cover.mjs` | 封面（16:9 / 4:3） |
| `gen.py` + `jobs*.json` | gpt-image-2.5 的生图提示词与批量脚本（读取同目录 `.key`，密钥不在仓库里） |
| `shoot.mjs` | 截取示例路书的桌面版、手机版长图和局部 |

## 顺序

```
node tts.mjs                      # audio/<id>/audio.mp3 + metadata.json
python sep_vocals.py ref.wav vocals_clean.wav <模型目录> <ZFTurbo 仓库>   # 截 0.3–15.8 秒作参考 refI2.wav
python batch_vc.py <src> <out> refI2.wav 3 all   # 在 Seed-VC 仓库目录里运行；吐字含糊的句子换种子重转
python voice_prep.py <out>
python timeline.py && node prep.mjs
node cues.mjs && node sfx.mjs
bash render_all.sh                # seg/video.mp4
python mix.py                     # mix_raw.f32 → ffmpeg 响度归一到 -14 LUFS 后与画面合并
python srt.py
```

## 配音音色

参考音频取自 B 站【大肥鱼Let me go 首支mv！出道进度（1/10）】（BV1pueU6cEfg），无登录能拿到的最高音质是 192k 档 AAC。几个关键点：

- **参考段**：用 MV 开头那段说唱（0.3–15.8 秒，"Making the call, let me write the JSON…"），角色说话的音高中位数约 392 Hz，又亮又有精神。结尾 "Good morning" 那句是轻声气声，拿它当参考会把转换结果带得有气无力，不要用。
- **去底噪**：AI 歌曲本身高频很满，htdemucs 分出来的人声还带着大量镲片串音和 5–15 kHz 的沙沙声，转换结果会一起"滋滋"响。改用 MelBand RoFormer 分离再降噪，停顿处的 4–12 kHz 底噪低了约 15 dB。
- **模型**：Seed-VC 44.1 kHz 音高条件模型、不微调、升 3 个半音。它沿用 Edge TTS 的语调（音高起伏 11–13 个半音），不像不带音高条件的模型那样把语调压平。在 MV 歌声上微调过（150–600 步），音色相似度没有提升，中文吐字反而明显变糊。
- **检查**：每句都用 gpt-4o-transcribe 转写，与脚本比对；吐字含糊的句子换随机种子重转、挑最清楚的一版。英文词组 "DeepSeek Harness" 怎么转都会糊，旁白改成说 "DSH"。

外部依赖：ffmpeg、Node ≥ 22（需要 puppeteer-core、gsap、lucide-static、msedge-tts）、字体（Noto Sans SC、站酷快乐体、站酷庆科黄油体）、BGM「Life of Riley」（Kevin MacLeod，CC BY 4.0）、Seed-VC（PyTorch + CUDA）、MelBand RoFormer 人声模型（Kim）与 noisereduce。
