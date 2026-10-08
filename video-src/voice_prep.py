# 转换后的配音 → audio/<id>/voice.wav
#   · 门限：原始 Edge 配音静音的地方，转换结果也压成静音（去掉停顿里的底噪、嗡声和拖尾的气声），起落有 15/60 ms 平滑
#   · 统一响度（对齐 Edge 原声的中位响度）、48 kHz、首尾 10 ms 淡入淡出
# python voice_prep.py <转换结果目录（里面是 l01.wav … 或 vc_l01_*.wav）> [只处理的句子 id,…] [--out 输出文件名]
import json, subprocess, re, statistics, sys, os
import numpy as np, soundfile as sf, librosa
args = [a for a in sys.argv[1:] if not a.startswith('--')]
VC = args[0]; only = args[1].split(',') if len(args) > 1 else None
OUT = next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--out=')), 'voice.wav')
SR = 48000
def lufs(path):
    err = subprocess.run(['bin/ffmpeg', '-hide_banner', '-nostats', '-i', path, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'], capture_output=True, text=True).stderr
    return float(re.findall(r'I:\s+(-?[\d.]+) LUFS', err)[-1])
def gate(y, src, hop=480):
    e = librosa.feature.rms(y=src, frame_length=hop * 2, hop_length=hop, center=True)[0]
    on = 20 * np.log10(e + 1e-9) > 20 * np.log10(e.max() + 1e-9) - 42
    on = np.convolve(on.astype(float), np.ones(7), 'same') > 0          # 前后各放宽 30 ms
    g = np.zeros(len(on)); v = 0.0
    for k, o in enumerate(on):                                          # 起 15 ms、落 60 ms
        v += ((1.0 if o else 0.0) - v) * (1 - np.exp(-(hop / SR) / (0.015 if o else 0.06))); g[k] = v
    g = np.interp(np.arange(len(y)), np.arange(len(g)) * hop, g)
    return y * g
ids = [l['id'] for s in json.load(open('script.json')) for l in s['lines']]
target = statistics.median(lufs(f'audio/{i}/audio.mp3') for i in ids)
print('target LUFS', round(target, 2))
for i in (only or ids):
    cand = [f for f in os.listdir(VC) if f == f'{i}.wav' or f.startswith(f'vc_{i}_') or f.startswith(f'vc_v2_{i}_')]
    y, _ = librosa.load(os.path.join(VC, cand[0]), sr=SR, mono=True)
    src, _ = librosa.load(f'audio/{i}/audio.mp3', sr=SR, mono=True)
    y = gate(y[:len(src)] if len(y) >= len(src) else np.pad(y, (0, len(src) - len(y))), src)
    tmp = f'audio/{i}/_g.wav'; sf.write(tmp, y, SR)
    g = target - lufs(tmp); D = len(y) / SR
    subprocess.check_call(['bin/ffmpeg', '-v', 'error', '-y', '-i', tmp, '-af', f'volume={g:.2f}dB,afade=t=in:d=0.01,afade=t=out:st={D - 0.012:.3f}:d=0.012', '-ar', str(SR), '-ac', '1', f'audio/{i}/{OUT}'])
    os.remove(tmp); print(i, f'gain {g:+.1f} dB')
