# Seed-VC 批量音色转换（在 Seed-VC 仓库目录里运行），用 44.1 kHz 音高条件模型（不微调）：
#   python batch_vc.py <源 wav 目录> <输出目录> <参考音频> <升降半音> <句子 id,… | all> [随机种子]
# 音高条件模型沿用原始配音的语调，只换音色；输出时长与源一致，Edge TTS 的逐词时间戳可以直接沿用。
# 在 MV 歌声上微调过（150–600 步）：音色没有更像，中文吐字反而明显变糊，所以不用。
import sys, glob, os, argparse, shutil, torch
sys.path.insert(0, '.')
import inference as I
_c = None; _o = I.load_models
def lm(a):                      # 模型只加载一次
    global _c
    if _c is None: _c = _o(a)
    return _c
I.load_models = lm
src_dir, out, ref, shift, ids = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), sys.argv[5]
seed = int(sys.argv[6]) if len(sys.argv) > 6 else 1234
srcs = sorted(glob.glob(os.path.join(src_dir, 'l*.wav'))) if ids == 'all' else [os.path.join(src_dir, f'{i}.wav') for i in ids.split(',')]
os.makedirs(out, exist_ok=True); rn = os.path.splitext(os.path.basename(ref))[0]
for src in srcs:
    sid = os.path.splitext(os.path.basename(src))[0]
    torch.manual_seed(seed)
    a = argparse.Namespace(source=src, target=ref, output=out, diffusion_steps=50, length_adjust=1.0, inference_cfg_rate=0.7,
                           f0_condition=True, auto_f0_adjust=False, semi_tone_shift=shift, checkpoint=None, config=None, fp16=True)
    I.main(a)
    shutil.move(os.path.join(out, f'vc_{sid}_{rn}_1.0_50_0.7.wav'), os.path.join(out, f'{sid}.wav')); print('done', sid, flush=True)
