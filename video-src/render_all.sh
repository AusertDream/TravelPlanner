#!/bin/bash
[ -f ../env.sh ] && source ../env.sh   # 本机的 ffmpeg / Chrome / 字体路径
FPS=60
TOTAL=$(python3 -c "import json,math;print(math.ceil(json.load(open('timeline.json'))['total']*$FPS))")
W=5; STEP=$(( (TOTAL + W - 1) / W ))
pids=()
for i in $(seq 0 $((W-1))); do
  a=$((i*STEP)); b=$(( (i+1)*STEP )); [ $b -gt $TOTAL ] && b=$TOTAL
  node render.mjs $a $b seg/part$i.mp4 $FPS > seg/log$i.txt 2>&1 &
  pids+=($!)
done
for p in "${pids[@]}"; do wait $p; done
: > seg/list.txt; for i in $(seq 0 $((W-1))); do echo "file 'part$i.mp4'" >> seg/list.txt; done
bin/ffmpeg -v error -y -f concat -safe 0 -i seg/list.txt -c copy seg/video.mp4
echo RENDER_DONE $TOTAL
