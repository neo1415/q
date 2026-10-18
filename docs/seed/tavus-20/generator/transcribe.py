import sys,json
from faster_whisper import WhisperModel
m=WhisperModel("small.en",device="cpu",compute_type="int8",cpu_threads=4)
src,out=sys.argv[1],sys.argv[2]
segs,info=m.transcribe(src,word_timestamps=True,vad_filter=False,beam_size=5)
words=[{"w":w.word.strip(),"s":round(w.start,2),"e":round(w.end,2)} for s in segs for w in s.words]
json.dump({"duration":info.duration,"words":words},open(out,'w'))
print(len(words),'words;',' '.join(x['w'] for x in words))
