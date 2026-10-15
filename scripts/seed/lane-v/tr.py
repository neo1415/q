import sys,json,subprocess,numpy as np
from faster_whisper import WhisperModel
src,out=sys.argv[1],sys.argv[2]
raw=subprocess.run(["ffmpeg","-v","error","-i",src,"-f","s16le","-ac","1","-ar","16000","-"],capture_output=True,check=True).stdout
a=np.frombuffer(raw,np.int16).astype(np.float32)/32768
m=WhisperModel("base.en",device="cpu",compute_type="int8",cpu_threads=4)
segs,info=m.transcribe(a,word_timestamps=True,beam_size=5)
words=[{"w":w.word.strip(),"s":round(w.start,2),"e":round(w.end,2)} for s in segs for w in s.words]
json.dump({"duration":len(a)/16000,"words":words},open(out,'w'))
print(len(words),'words;',' '.join(x['w'] for x in words))
