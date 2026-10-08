import json, base64, subprocess, sys, os, time, concurrent.futures as cf
TOK = open('.key').read().strip()
BASE = 'https://api.camel-hub.com/v1/images'
CHAR = ("参考图1是角色「大肥鱼」原版三视图，参考图2是她换上旅行装的新造型。请画同一个角色，脸、发型、画风与参考图严格一致："
  "深蓝色长卷发（发梢渐变为亮蓝）、头顶一根卷曲呆毛、耳朵位置是深蓝色鲸鱼鳍（内侧白色）并系着亮蓝色蝴蝶结、蓝色大眼睛、身后一条蓝色渐变鲸鱼尾巴、Q版二头身比例。"
  "服装与参考图2一致：系蓝丝带和蝴蝶结的米白色草编遮阳帽、白衬衫配蓝色小领带、深蓝色多口袋旅行马甲、胸前小鲸鱼徽章、白色百褶短裙、白色荷叶边袜子配深蓝色玛丽珍鞋、斜挎鲸鱼造型小圆包。"
  "日系Q版插画，干净线稿，柔和赛璐璐上色。")
TAIL = "透明背景，画面里不要出现任何文字、字母、数字或水印，角色全身完整、不要裁切。"
def job(name, prompt, size, transparent=True, refs=('ref/threeview.png','ref/design.png'), quality='high'):
    out = f'gen/{name}.png'
    if os.path.exists(out): return name, 'exists'
    args = ['curl','-s','-m','900',f'{BASE}/edits' if refs else f'{BASE}/generations','-H',f'Authorization: Bearer {TOK}',
            '-F','model=gpt-image-2.5','-F',f'size={size}','-F',f'quality={quality}','-F','output_format=png','-F','n=1',
            '-F',f'prompt={prompt}']
    for r in refs: args += ['-F', f'image[]=@{r}']
    if transparent: args += ['-F','background=transparent']
    if not refs:
        body = {'model':'gpt-image-2.5','size':size,'quality':quality,'output_format':'png','n':1,'prompt':prompt}
        if transparent: body['background']='transparent'
        open(f'gen/{name}.req.json','w').write(json.dumps(body, ensure_ascii=False))
        args = ['curl','-s','-m','900',f'{BASE}/generations','-H',f'Authorization: Bearer {TOK}','-H','Content-Type: application/json','--data-binary',f'@gen/{name}.req.json']
    for attempt in range(3):
        try:
            r = subprocess.run(args, capture_output=True, timeout=960)
            d = json.loads(r.stdout)
            b = d['data'][0]['b64_json']
            open(out,'wb').write(base64.b64decode(b))
            return name, f"ok {d.get('size')}"
        except Exception as e:
            err = (r.stdout[:300] if 'r' in dir() else b'') 
            time.sleep(5)
    return name, f'FAIL {err}'
jobs = json.load(open(sys.argv[1]))
with cf.ThreadPoolExecutor(int(sys.argv[2]) if len(sys.argv)>2 else 5) as ex:
    futs = []
    for j in jobs:
        p = j['prompt']
        if j.get('char', True): p = CHAR + p
        if j.get('tail', True): p = p + (TAIL if j.get('transparent', True) else "画面里不要出现任何文字、字母、数字或水印。")
        futs.append(ex.submit(job, j['name'], p, j.get('size','1024x1536'), j.get('transparent', True), tuple(j.get('refs',('ref/threeview.png','ref/design.png')))))
    for f in cf.as_completed(futs): print(*f.result(), flush=True)
