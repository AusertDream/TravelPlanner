import json, subprocess, re
script = json.load(open('script.json'))
PUNCT = re.compile(r'[\s，。！？、：；——「」…,.!?:;"\'()（）|·¥]')
def norm(s): return PUNCT.sub('', s)
def dur(f): return float(subprocess.check_output(['bin/ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f]))
# scene pacing: (lead-in before first line, gap between lines, tail after last line)
PACE = {'hook':(1.55,0.3,0.55),'intro':(0.6,0.4,0.75),'query':(0.6,0.4,0.8),
        'transport':(0.6,0.38,1.1),'constraints':(0.6,0.38,0.75),'route':(0.6,0.38,0.8),'hotel':(0.6,0.38,0.8),
        'budget':(0.6,0.38,0.8),'roadbook':(0.6,0.38,1.0),'rules':(0.6,0.38,0.8),'install':(0.6,0.38,0.8),'outro':(0.6,0.45,4.0)}
t = 0.0; out = {'scenes':[], 'lines':{}}
for s in script:
    lead, gap, tail = PACE[s['scene']]
    sc = {'name':s['scene'], 'start':round(t,3), 'lines':[]}
    t += lead
    for k, l in enumerate(s['lines']):
        f = f"audio/{l['id']}/audio.mp3"; D = dur(f)
        meta = json.load(open(f"audio/{l['id']}/metadata.json"))['Metadata']
        words = [{'w':m['Data']['text']['Text'], 's':m['Data']['Offset']/1e7, 'e':(m['Data']['Offset']+m['Data']['Duration'])/1e7} for m in meta if m['Type']=='WordBoundary']
        speech_end = words[-1]['e'] if words else D
        # char index -> time map over normalized tts text
        tts = l.get('tts', l['sub'].replace('|','，'))
        ntts = norm(tts.replace('TravelPlanner','Travel Planner'))
        cmap = []  # (char_index_start, time)
        pos = 0
        for w in words:
            nw = norm(w['w'])
            if not nw: continue
            i = ntts.find(nw, pos)
            if i < 0: i = pos
            cmap.append((i, w['s'], w['e'])); pos = i + len(nw)
        def time_at(ci):
            best = None
            for (i, s0, e0) in cmap:
                if i <= ci: best = (i, s0, e0)
            return best[1] if best else 0.0
        chunks = l['sub'].split('|')
        bounds = [0.0]
        if len(chunks) > 1:
            npos = 0
            for c in chunks[:-1]:
                nc = norm(c)
                tail2 = nc[-2:]
                i = ntts.find(tail2, npos)
                if i < 0:  # numbers differ: proportional fallback
                    frac = (len(norm(''.join(chunks[:chunks.index(c)+1])))) / max(1, len(norm(l['sub'])))
                    ci = int(frac * len(ntts))
                else:
                    ci = i + len(tail2)
                npos = ci
                # start of next chunk = time of first word at/after ci
                nxt = [s0 for (j, s0, e0) in cmap if j >= ci]
                bounds.append(nxt[0] - 0.08 if nxt else time_at(ci))
        subs = []
        for ci, c in enumerate(chunks):
            st = bounds[ci]; en = bounds[ci+1] if ci+1 < len(bounds) else speech_end + 0.25
            subs.append({'text':c.strip(), 's':round(t+max(0,st),3), 'e':round(t+en,3)})
        line = {'id':l['id'], 'start':round(t,3), 'dur':round(D,3), 'speech_end':round(t+speech_end,3),
                'words':[{'w':w['w'],'s':round(t+w['s'],3),'e':round(t+w['e'],3)} for w in words], 'subs':subs}
        out['lines'][l['id']] = line; sc['lines'].append(l['id'])
        t += speech_end + (gap if k < len(s['lines'])-1 else 0)
    t += tail
    sc['end'] = round(t,3); out['scenes'].append(sc)
out['total'] = round(t,3)
json.dump(out, open('timeline.json','w'), ensure_ascii=False, indent=1)
for sc in out['scenes']: print(f"{sc['name']:12s} {sc['start']:7.2f} -> {sc['end']:7.2f}  ({sc['end']-sc['start']:.1f}s)")
print('TOTAL', out['total'])
for lid, l in out['lines'].items():
    for s in l['subs']: print(lid, f"{s['s']:.2f}-{s['e']:.2f}", s['text'])
