# Build labelled 9:16 finals for ready fictional-world videos (varied crop and grade).
import json,os,subprocess,sys
S=os.path.dirname(os.path.abspath(__file__)); post="/home/user/q-v/scripts/seed/lane-v/post.sh"
jobs=json.load(open(f"{S}/jobs-fw.json"))
grades=["eq=contrast=1.02:saturation=1.0","eq=contrast=1.05:saturation=1.08:gamma=0.98","colorbalance=rs=0.04:bs=-0.03,eq=saturation=1.03","colorbalance=rs=-0.02:bs=0.04,eq=contrast=1.03","eq=brightness=0.02:saturation=0.95"]
offs=[0.5,0.42,0.58,0.46,0.54]
for i,j in enumerate(jobs):
  src=f"{S}/videos/{j['slug']}.mp4"; out=f"{S}/final/{j['slug']}-9x16.mp4"
  if not os.path.exists(src) or os.path.exists(out): continue
  subprocess.run([post,src,out,j['company'],f"Pitch summary for founder {j['founder']}",str(offs[i%5]),grades[i%5]],check=True)
  print("final",j['slug'])
