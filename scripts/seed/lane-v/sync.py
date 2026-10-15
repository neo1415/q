# Lip-sync check: correlate mouth-region frame-to-frame change with audio RMS
# over a lag scan; a real sync peaks near lag 0 (within about ±120 ms).
import sys,subprocess,numpy as np
src=sys.argv[1]
W,H=180,320
fr=subprocess.run(["ffmpeg","-v","error","-i",src,"-vf",f"fps=25,scale={W}:{H}","-f","rawvideo","-pix_fmt","gray","-"],capture_output=True,check=True).stdout
v=np.frombuffer(fr,np.uint8).reshape(-1,H,W).astype(np.float32)
# mouth box: located where frame-diff energy concentrates in the face's lower half
d=np.abs(np.diff(v,axis=0)).mean(0)
ys,xs=np.unravel_index(np.argsort(d.ravel())[-400:],d.shape)
cy,cx=int(np.median(ys)),int(np.median(xs))
m=np.abs(np.diff(v[:,max(cy-12,0):cy+12,max(cx-20,0):cx+20],axis=0)).mean((1,2))
au=subprocess.run(["ffmpeg","-v","error","-i",src,"-f","s16le","-ac","1","-ar","16000","-"],capture_output=True,check=True).stdout
a=np.frombuffer(au,np.int16).astype(np.float32)
n=len(a)//640; rms=np.sqrt((a[:n*640].reshape(n,640)**2).mean(1))
e=np.abs(np.diff(rms))[:len(m)]; m=m[:len(e)]
def z(x): return (x-x.mean())/(x.std()+1e-9)
best=[(lag,float(np.mean(z(m[max(lag,0):len(m)+min(lag,0)])*z(e[max(-lag,0):len(e)-max(lag,0)])))) for lag in range(-12,13)]
lag,r=max(best,key=lambda t:t[1])
r0=dict(best)[0]
print(f"{src.split('/')[-1]}: box=({cy},{cx}) peak r={r:.2f} at lag {lag*40} ms; r@0={r0:.2f}")
