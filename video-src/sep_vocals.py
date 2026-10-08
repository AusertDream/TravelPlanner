# 从参考 MV 音频里取干净人声：MelBand RoFormer（Kim 的人声模型）分离 → noisereduce 非平稳降噪 → 15.5 kHz 低通
#   python sep_vocals.py <混音 wav> <输出 wav> <模型目录（vocals_mel_band_roformer.ckpt + .yaml）> <ZFTurbo 仓库目录>
# 模型代码用 ZFTurbo/Music-Source-Separation-Training 的原版实现（flash_attn 关掉）；
# audio-separator 0.47 自带的实现对这个权重会输出全静音，别用
import sys, inspect, torch, yaml, numpy as np, soundfile as sf, librosa, noisereduce as nr
from scipy.signal import butter, sosfiltfilt
mix, out, M, ZFT = sys.argv[1:5]
sys.path.insert(0, ZFT)
from models.bs_roformer.mel_band_roformer import MelBandRoformer
cfg = yaml.load(open(f'{M}/vocals_mel_band_roformer.yaml'), Loader=yaml.UnsafeLoader)
mc = dict(cfg['model'], flash_attn=False); ok = set(inspect.signature(MelBandRoformer.__init__).parameters)
m = MelBandRoformer(**{k: v for k, v in mc.items() if k in ok})
m.load_state_dict(torch.load(f'{M}/vocals_mel_band_roformer.ckpt', map_location='cpu')); m = m.cuda().eval()
y, sr = librosa.load(mix, sr=44100, mono=False)
C = cfg['audio']['chunk_size']; H = C // 2; win = torch.hann_window(C, periodic=False).cuda()   # 8 秒一块、半块重叠
x = torch.tensor(y, dtype=torch.float32).cuda(); N = x.shape[1]
pad = torch.nn.functional.pad(x, (H, H + C)); acc = torch.zeros_like(pad); wsum = torch.zeros(pad.shape[1], device='cuda')
with torch.no_grad():
    for s in range(0, pad.shape[1] - C + 1, H):
        o = m(pad[:, s:s + C][None]).float().reshape(-1, 2, C)[0]
        acc[:, s:s + C] += o * win; wsum[s:s + C] += win
voc = (acc / wsum.clamp(min=1e-4))[:, H:H + N].cpu().numpy().mean(0)
voc = nr.reduce_noise(y=voc, sr=sr, stationary=False, prop_decrease=0.7, n_fft=2048, time_constant_s=1.5, freq_mask_smooth_hz=300)
voc = sosfiltfilt(butter(8, 15500, 'low', fs=sr, output='sos'), voc)
sf.write(out, voc.astype(np.float32), sr); print('ok', out)
