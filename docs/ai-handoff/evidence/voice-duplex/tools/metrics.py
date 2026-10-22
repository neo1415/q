import json, re, sys, glob, os
base = sys.argv[1]
USER = {
 "02": ["Q, my co-founder just told an investor that our burn rate is aggressive but spiritual. Should I be worried?", "Haha, okay okay. So how do I explain burn properly next time?"],
 "03": ["So, em... I was wondering, like... if we raise a small bridge round now, before the Series A... does that, you know, send the wrong signal to investors?"],
 "04": ["Can you explain what a SAFE is, and how it's different from a convertible note?", "Sorry, sorry, wait. Just the short version. One sentence."],
 "07": ["Can you check which companies fit my mandate best right now?", "And while you're at it, remind me, what does pro rata actually mean?"],
}
TAGWORDS = {"warmly","direct","practical","chuckles","laughs","sighs","softly","whispers","curious","excited"}
k = lambda w: re.sub(r"[^a-z0-9']", "", w.lower())
rows = []
for f in sorted(glob.glob(f"{base}/stt/*.json")):
    name = os.path.basename(f)[:-5]; sc = name[:2]
    words = [w for w in json.load(open(f))["words"] if w["type"] == "word"]
    events = [w for w in json.load(open(f))["words"] if w["type"] == "audio_event"]
    uset = {k(x) for line in USER[sc] for x in line.split()}
    spk = {}
    for w in words:
        s = spk.setdefault(w["speaker_id"], [0, 0]); s[1] += 1; s[0] += k(w["text"]) in uset
    user_id = max(spk, key=lambda s: spk[s][0] / spk[s][1])
    U = [w for w in words if w["speaker_id"] == user_id]; Q = [w for w in words if w["speaker_id"] != user_id]
    # user steps: split user words where the gap exceeds 3 s (pauses within a step are <= 2.2 s)
    steps = []
    for w in U:
        if steps and w["start"] - steps[-1][-1]["end"] < 3.0: steps[-1].append(w)
        else: steps.append([w])
    over = [ (round(w["start"],2), w["text"]) for w in Q for st in steps if st[0]["start"] < w["start"] < st[-1]["end"] ]
    leaks = [w["text"] for w in Q if k(w["text"]) in TAGWORDS]
    r = {"clip": name, "q_words_during_user_speech": over, "tag_words_spoken": leaks, "audio_events": [(round(e["start"],2), e["text"]) for e in events]}
    if sc == "04" and len(steps) >= 2:
        onset = steps[1][0]["start"]; uend = steps[1][-1]["end"]
        cont = [w for w in Q if w["start"] < onset]
        last_before = max((w["end"] for w in Q if w["start"] < uend and w["end"] <= uend + 0.01 and w["start"] >= (cont[-1]["start"] if cont else 0) and w["start"] < onset + 0.0) , default=None)
        # Q words still running after the user's onset that belong to the interrupted reply (started before onset or within 1 s after, before any pause > 0.6 s)
        talk = sorted([w for w in Q if onset - 0.01 <= w["end"] and w["start"] < uend], key=lambda w: w["start"])
        stop = None; prev = cont[-1]["end"] if cont else onset
        for w in talk:
            if w["start"] - prev > 0.6: break
            prev = w["end"]
        stop = round(max(prev, onset) - onset, 2)
        r["barge_in_onset_s"] = round(onset, 2); r["q_kept_talking_after_onset_s"] = stop
        r["q_words_while_user_interrupts"] = [(round(w["start"],2), w["text"]) for w in Q if onset <= w["start"] <= uend]
    if sc == "07":
        last_user = steps[-1][-1]["end"]; qafter = sorted([w for w in Q if w["start"] > last_user], key=lambda w: w["start"])
        gaps = [round(b["start"] - a["end"], 2) for a, b in zip(qafter, qafter[1:])]
        r["first_q_word_after_user_s"] = round(qafter[0]["start"] - last_user, 2) if qafter else None
        r["longest_gap_inside_q_reply_s"] = max(gaps) if gaps else None
        r["q_reply_span_s"] = round(qafter[-1]["end"] - qafter[0]["start"], 2) if qafter else None
    rows.append(r)
print(json.dumps(rows, indent=1))
