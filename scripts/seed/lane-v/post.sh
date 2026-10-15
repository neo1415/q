#!/usr/bin/env bash
# 9:16 cut with a permanent "AI presenter" disclosure and a lower third.
# post.sh <in.mp4> <out.mp4> "<Company>" "<line 2>" [crop-x-offset 0..1, default .5] [grade]
set -euo pipefail
in=$1 out=$2 co=$3 l2=$4 ox=${5:-0.5} grade=${6:-eq=contrast=1.02:saturation=1.0}
F=/usr/share/fonts/opentype/inter
esc() { printf '%s' "$1" | sed "s/[\\:']/\\\\&/g"; }
ffmpeg -v error -y -i "$in" -filter_complex "
[0:v]crop=ih*9/16:ih:(iw-ih*9/16)*$ox:0,scale=1080:1920,$grade,
drawbox=x=48:y=1490:w=420:h=64:color=black@0.55:t=fill,
drawtext=fontfile=$F/Inter-SemiBold.otf:text='AI presenter · AI-generated':fontsize=30:fontcolor=white:x=72:y=1508,
drawbox=x=0:y=1580:w=1080:h=220:color=black@0.45:t=fill,
drawtext=fontfile=$F/Inter-SemiBold.otf:text='$(esc "$co")':fontsize=54:fontcolor=white:x=64:y=1615,
drawtext=fontfile=$F/Inter-Regular.otf:text='$(esc "$l2")':fontsize=32:fontcolor=white@0.9:x=64:y=1695[v]" \
  -map "[v]" -map 0:a -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart "$out"
