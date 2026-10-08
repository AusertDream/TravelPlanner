import json, subprocess, array, math, sys, os
SR = 48000
TL = json.load(open('timeline.json')); CUES = json.load(open('cues.json'))
TOTAL = TL['total']; N = int(math.ceil(TOTAL * SR)) + SR
def dec(path, ch=1, filt=None):
    cmd = ['bin/ffmpeg', '-v', 'error', '-i', path] + (['-af', filt] if filt else []) + ['-f', 'f32le', '-ac', str(ch), '-ar', str(SR), '-']
    a = array.array('f'); a.frombytes(subprocess.check_output(cmd)); return a
voice = array.array('f', bytes(4 * N)); sfx = array.array('f', bytes(4 * N))
VF = 'highpass=f=75,acompressor=threshold=-20dB:ratio=2.5:attack=8:release=120:makeup=2,equalizer=f=3200:t=q:w=1.2:g=2'
for lid, l in TL['lines'].items():
    src = f'audio/{lid}/voice.wav' if os.path.exists(f'audio/{lid}/voice.wav') else f'audio/{lid}/audio.mp3'
    a = dec(src, 1, VF); o = int(l['start'] * SR)
    for i in range(min(len(a), N - o)): voice[o + i] += a[i]
cache = {}
for c in CUES:
    if c['name'] not in cache: cache[c['name']] = dec(f"sfx/{c['name']}.wav")
    a = cache[c['name']]; o = int(c['t'] * SR); g = c['gain'] * 0.42
    if o < 0: continue
    for i in range(min(len(a), N - o)): sfx[o + i] += a[i] * g
bgm = dec('bgm/riley.mp3', 2)
# ducking envelope (per 10 ms block): music lower while narration is speaking
B = SR // 100; nb = N // B + 1
target = [0.0] * nb
spans = [(l['start'] - 0.15, l['speech_end'] + 0.2) for l in TL['lines'].values()]
for k in range(nb):
    t = k * B / SR
    target[k] = 0.31 if any(s <= t < e for s, e in spans) else 0.62
env = [0.0] * nb; g = target[0]
for k in range(nb):  # attack 120 ms down, release 450 ms up
    tau = 0.12 if target[k] < g else 0.45
    g += (target[k] - g) * (1 - math.exp(-0.01 / tau)); env[k] = g
fade_in, fade_out = 0.6, 4.0
outa = array.array('f', bytes(4 * 2 * N))
for i in range(N):
    t = i / SR; k = i // B
    m = env[k] * min(1.0, t / fade_in) * max(0.0, min(1.0, (TOTAL - t) / fade_out))
    bl = bgm[2 * i] if 2 * i + 1 < len(bgm) else 0.0; br = bgm[2 * i + 1] if 2 * i + 1 < len(bgm) else 0.0
    v = voice[i] * 1.0 + sfx[i]
    outa[2 * i] = bl * m + v; outa[2 * i + 1] = br * m + v
open('mix_raw.f32', 'wb').write(outa.tobytes())
if len(sys.argv) > 1:
    vs = array.array('f', bytes(4 * 2 * N)); ms = array.array('f', bytes(4 * 2 * N)); ss = array.array('f', bytes(4 * 2 * N))
    for i in range(N):
        t = i / SR; m = env[i // B] * min(1.0, t / fade_in) * max(0.0, min(1.0, (TOTAL - t) / fade_out))
        vs[2*i] = vs[2*i+1] = voice[i]; ss[2*i] = ss[2*i+1] = sfx[i]
        if 2 * i + 1 < len(bgm): ms[2*i] = bgm[2*i] * m; ms[2*i+1] = bgm[2*i+1] * m
    open('stem_v.f32','wb').write(vs.tobytes()); open('stem_m.f32','wb').write(ms.tobytes()); open('stem_s.f32','wb').write(ss.tobytes())
print('mixed', N / SR, 's')
