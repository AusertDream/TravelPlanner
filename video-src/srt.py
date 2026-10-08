# timeline.json → 字幕.srt（与画面里烧录的字幕同一套断句和时间）
import json, sys
TL = json.load(open('timeline.json'))
subs = sorted((s for l in TL['lines'].values() for s in l['subs']), key=lambda s: s['s'])
def ts(t): ms = round(t * 1000); return f'{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}'
out = []
for i, s in enumerate(subs):
    e = s['e'] + 0.15
    if i + 1 < len(subs): e = min(e, subs[i + 1]['s'] - 0.05)
    out.append(f"{i + 1}\n{ts(max(0, s['s'] - 0.05))} --> {ts(e)}\n{s['text']}\n")
open(sys.argv[1] if len(sys.argv) > 1 else '字幕.srt', 'w', encoding='utf-8').write('\n'.join(out))
print(len(subs), 'subs')
