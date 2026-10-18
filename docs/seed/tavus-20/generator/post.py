"""Vertical 9:16 founder edit for one Tavus video: crop or frame, light grade,
script-accurate captions timed by a local transcript, lower third, and the
AI-actor disclosure. Usage: post.py <n>"""
import difflib, json, re, subprocess, sys

ROOT = "/tmp/claude-0/-home-user-q/5e7a5c77-f947-52b0-88c5-5afccae36a31/scratchpad/tavus"
PLAN = "/home/user/q/docs/seed/tavus-20/plan.json"
FONTS = f"{ROOT}/fonts"

# One look per video. layout: crop (full-bleed 9:16), tight (closer crop),
# framed (16:9 picture inside a 9:16 card with a title above).
STYLES = {
 1: dict(layout="crop", zoom=1.0, font="Inter", bold=1, size=58, col="FFFFFF", out="000000", outw=3, upper=False, chunk=5, y=1460, grade="eq=contrast=1.03:saturation=1.02", lt="bar", ltfont="Inter", accent="E8B44A"),
 2: dict(layout="tight", zoom=1.22, font="Poppins ExtraBold", bold=0, size=76, col="FFFFFF", out="000000", outw=5, upper=True, chunk=2, y=1420, grade="eq=contrast=1.08:saturation=1.18:brightness=0.02", lt="pill", ltfont="Poppins ExtraBold", accent="FF4FA3", pop=True),
 3: dict(layout="framed", bg="0E1116", font="Playfair Display", bold=0, size=54, col="F2EDE3", out="0E1116", outw=0, upper=False, chunk=6, y=1500, grade="eq=contrast=1.04:saturation=0.92", lt="serif", ltfont="Playfair Display", accent="C9A227"),
 4: dict(layout="crop", zoom=1.0, font="IBM Plex Mono Medium", bold=0, size=48, col="D7F7E4", out="05140D", outw=3, upper=False, chunk=6, y=1480, grade="eq=contrast=1.06:saturation=0.85,colorbalance=bs=0.04", lt="mono", ltfont="IBM Plex Mono Medium", accent="3DDC97"),
 5: dict(layout="framed", bg="F4EFE6", font="Libre Baskerville", bold=0, size=48, col="2B2620", out="F4EFE6", outw=0, upper=False, chunk=7, y=1500, grade="eq=contrast=0.98:saturation=0.95:brightness=0.02", lt="serif", ltfont="Libre Baskerville", accent="B5651D", ltdelay=24),
 6: dict(layout="crop", zoom=1.0, font="Manrope", bold=1, size=52, col="F5F0E6", out="2A2116", outw=3, upper=False, chunk=6, y=1480, grade="eq=contrast=0.97:saturation=0.88,colorbalance=rs=0.03:bs=-0.03", lt="bar", ltfont="Manrope", accent="D9A441"),
 7: dict(layout="tight", zoom=1.12, font="Archivo Black", bold=0, size=64, col="FFFFFF", out="101010", outw=4, upper=True, chunk=3, y=1440, grade="eq=contrast=1.1:saturation=1.1", lt="block", ltfont="Archivo Black", accent="FFC400"),
 8: dict(layout="crop", zoom=1.0, font="IBM Plex Sans", bold=1, size=52, col="FFFFFF", out="0B1B2B", outw=3, upper=False, chunk=6, y=1490, grade="eq=contrast=1.02:saturation=0.95", lt="bar", ltfont="IBM Plex Sans", accent="4A90D9"),
 9: dict(layout="crop", zoom=1.05, font="Nunito", bold=0, size=62, col="FFFFFF", out="0D3B2E", outw=4, upper=False, chunk=4, y=1420, grade="eq=contrast=1.04:saturation=1.15:brightness=0.03", lt="pill", ltfont="Nunito", accent="2FBF71"),
 10: dict(layout="tight", zoom=1.1, font="Oswald", bold=0, size=70, col="FFFFFF", out="1A1200", outw=4, upper=True, chunk=4, y=1440, grade="eq=contrast=1.12:saturation=1.12,colorbalance=rs=0.04:bs=-0.04", lt="block", ltfont="Oswald", accent="FFB800"),
 11: dict(layout="framed", bg="0B1014", font="Space Grotesk", bold=1, size=50, col="E6EEF2", out="0B1014", outw=0, upper=False, chunk=6, y=1500, grade="eq=contrast=1.05:saturation=0.8,colorbalance=bs=0.05", lt="mono", ltfont="Space Grotesk", accent="7FD1FF"),
 12: dict(layout="crop", zoom=1.0, font="Inter", bold=1, size=56, col="FFFFFF", out="1F2933", outw=3, upper=False, chunk=5, y=1470, grade="eq=contrast=1.03:saturation=1.0", lt="pill", ltfont="Inter", accent="5B8DEF"),
 13: dict(layout="crop", zoom=1.0, font="IBM Plex Mono Medium", bold=0, size=48, col="FFFFFF", out="000000", outw=3, upper=False, chunk=5, y=1480, grade="eq=contrast=1.08:saturation=0.75:brightness=-0.03,colorbalance=bs=0.06", lt="mono", ltfont="IBM Plex Mono Medium", accent="FF5A5F"),
 14: dict(layout="tight", zoom=1.25, font="Be Vietnam Pro", bold=1, size=70, col="FFFFFF", out="000000", outw=5, upper=False, chunk=3, y=1440, grade="eq=contrast=1.06:saturation=1.25:brightness=0.03", lt="pill", ltfont="Be Vietnam Pro", accent="FF7A00", pop=True),
 15: dict(layout="crop", zoom=1.05, font="Manrope", bold=1, size=56, col="FFFFFF", out="1E3A1E", outw=4, upper=False, chunk=5, y=1460, grade="eq=contrast=1.02:saturation=1.08,colorbalance=gs=0.03", lt="bar", ltfont="Manrope", accent="7CB342"),
 16: dict(layout="framed", bg="1C1712", font="DM Serif Display", bold=0, size=56, col="F3E7D3", out="1C1712", outw=0, upper=False, chunk=6, y=1500, grade="eq=contrast=1.02:saturation=0.95,colorbalance=rs=0.04", lt="serif", ltfont="DM Serif Display", accent="C79A5B"),
 17: dict(layout="crop", zoom=1.0, font="IBM Plex Sans", bold=1, size=52, col="FFFFFF", out="0A1F3D", outw=3, upper=False, chunk=6, y=1490, grade="eq=contrast=1.04:saturation=0.9", lt="block", ltfont="IBM Plex Sans", accent="1F4E9C"),
 18: dict(layout="framed", bg="FAF8F5", font="Fraunces", bold=1, size=50, col="2A2A2A", out="FAF8F5", outw=0, upper=False, chunk=7, y=1500, grade="eq=contrast=0.97:saturation=0.9:brightness=0.03", lt="serif", ltfont="Fraunces", accent="8E6CB0"),
 19: dict(layout="tight", zoom=1.12, font="Caveat", bold=1, size=84, col="FFFFFF", out="3A2A10", outw=5, upper=False, chunk=4, y=1420, grade="eq=contrast=1.03:saturation=1.12:brightness=0.04", lt="pill", ltfont="Nunito", accent="F2A93B"),
 20: dict(layout="crop", zoom=1.0, font="Barlow Condensed", bold=1, size=74, col="FFFFFF", out="06111F", outw=4, upper=True, chunk=4, y=1430, grade="eq=contrast=1.08:saturation=0.8:brightness=-0.03,colorbalance=bs=0.07", lt="block", ltfont="Barlow Condensed", accent="F5A623"),
}

def norm(w):
    return re.sub(r"[^a-z0-9]", "", w.lower())

def align(script, words):
    sw = script.split()
    a = [norm(w) for w in sw]
    b = [norm(w["w"]) for w in words]
    times = [None] * len(sw)
    for blk in difflib.SequenceMatcher(None, a, b, autojunk=False).get_matching_blocks():
        for k in range(blk.size):
            w = words[blk.b + k]
            times[blk.a + k] = (w["s"], w["e"])
    # Fill gaps (numbers spoken as words, names) by interpolating between anchors.
    known = [i for i, t in enumerate(times) if t]
    if not known:
        raise SystemExit("no alignment")
    end = words[-1]["e"]
    for i in range(len(sw)):
        if times[i]:
            continue
        prev = max([k for k in known if k < i], default=None)
        nxt = min([k for k in known if k > i], default=None)
        t0 = times[prev][1] if prev is not None else 0.0
        t1 = times[nxt][0] if nxt is not None else end
        lo = prev if prev is not None else -1
        hi = nxt if nxt is not None else len(sw)
        span = (t1 - t0) / (hi - lo)
        s = t0 + span * (i - lo - 1)
        times[i] = (s, s + span)
    return list(zip(sw, times))

def ts(t):
    t = max(0, t)
    return f"{int(t // 3600)}:{int(t % 3600 // 60):02d}:{t % 60:05.2f}"

def ass_color(hex6, alpha="00"):
    return f"&H{alpha}{hex6[4:6]}{hex6[2:4]}{hex6[0:2]}"

def chunks(aligned, size):
    out, cur = [], []
    for w, t in aligned:
        cur.append((w, t))
        if len(cur) >= size or re.search(r"[.?!]$", w) or (re.search(r",$", w) and len(cur) >= max(2, size - 2)):
            out.append(cur); cur = []
    if cur:
        out.append(cur)
    return out

def build(n):
    plan = json.load(open(PLAN))
    c = next(x for x in plan["companies"] if x["n"] == n)
    st = STYLES[n]
    raw = f"{ROOT}/videos/{n:02d}-raw.mp4"
    words = json.load(open(f"{ROOT}/videos/{n:02d}.words.json"))
    aligned = align(c["script"], words["words"])
    dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", raw]).decode())

    W, H = 1080, 1920
    acc = st["accent"]
    styles = [
        (f"Style: Cap,{st['font']},{st['size']},{ass_color(st['col'])},{ass_color(acc)},&H5A000000,&H5A000000,{st['bold']},0,0,0,100,100,0,0,3,14,0,2,80,80,0,1"
         if st["layout"] != "framed" and not st.get("pop") else
         f"Style: Cap,{st['font']},{st['size']},{ass_color(st['col'])},{ass_color(acc)},{ass_color(st['out'])},&H64000000,{st['bold']},0,0,0,100,100,0,0,1,{st['outw']},0,2,80,80,0,1"),
        f"Style: Name,{st['ltfont']},56,{ass_color('FFFFFF')},&H000000FF,{ass_color('000000')},&H00000000,1,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1",
        f"Style: Role,{st['ltfont']},38,{ass_color('FFFFFF','10')},&H000000FF,{ass_color('000000')},&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1",
        f"Style: Disc,Inter,26,{ass_color('FFFFFF','40')},&H000000FF,{ass_color('000000','80')},&H00000000,0,0,0,0,100,100,0,0,1,1,0,9,0,0,0,1",
        f"Style: Title,{st['font']},60,{ass_color(st['col'])},&H000000FF,{ass_color(st['out'])},&H00000000,0,0,0,0,100,100,0,0,1,0,0,8,80,80,0,1",
    ]
    ev = []
    framed = st["layout"] == "framed"
    if framed:
        # Company name and one-liner sit above the picture for the whole video.
        ev.append(f"Dialogue: 0,{ts(0)},{ts(dur)},Title,,0,0,0,,{{\\pos(540,250)\\an8\\fs64}}{c['company']}")
        ev.append(f"Dialogue: 0,{ts(0)},{ts(dur)},Title,,0,0,0,,{{\\pos(540,350)\\an8\\fs34\\alpha&H40&}}{c['oneLiner']}")
    # Lower third: name, role and company, early (or after the story beat).
    f = c["founder"]
    t0 = st.get("ltdelay", 0.6); t1 = t0 + 4.2
    ltx, lty = (80, 1440) if framed else (70, 1180 if st["layout"] != "tight" else 1600)
    bar = f"{{\\pos({ltx-20},{lty-6})\\an7\\p1\\1c{ass_color(acc)}\\bord0\\fad(250,250)}}m 0 0 l 8 0 8 108 0 108{{\\p0}}"
    if st["lt"] in ("bar", "serif", "mono"):
        ev.append(f"Dialogue: 2,{ts(t0)},{ts(t1)},Name,,0,0,0,,{bar}")
    if True:
        box = f"{{\\pos({ltx-24},{lty-14})\\an7\\p1\\1c{ass_color('000000')}\\1a&H50&\\bord0\\fad(200,200)}}m 0 0 l 780 0 780 140 0 140{{\\p0}}"
        ev.append(f"Dialogue: 1,{ts(t0)},{ts(t1)},Name,,0,0,0,,{box}")
    ev.append(f"Dialogue: 3,{ts(t0)},{ts(t1)},Name,,0,0,0,,{{\\pos({ltx},{lty})\\fad(250,250)}}{f['name']}")
    ev.append(f"Dialogue: 3,{ts(t0)},{ts(t1)},Role,,0,0,0,,{{\\pos({ltx},{lty+62})\\fad(250,250)\\1c{ass_color(acc)}}}{f['role']}, {c['company']}")
    # Disclosure, always on screen.
    ev.append(f"Dialogue: 4,{ts(0)},{ts(dur)},Disc,,0,0,0,,{{\\pos(1040,60)\\an9}}AI actor · fictional company")
    # Captions.
    capy = 1770 if framed else st["y"]
    groups = chunks(aligned, st["chunk"])
    for gi, grp in enumerate(groups):
        s = grp[0][1][0]; e = grp[-1][1][1] + 0.08
        if gi + 1 < len(groups):
            # Never let two captions share the screen.
            e = min(e, groups[gi + 1][0][1][0] - 0.02)
        text = " ".join(w for w, _ in grp)
        if st["upper"]:
            text = text.upper()
        pop = "{\\fscx92\\fscy92\\t(0,90,\\fscx100\\fscy100)}" if st.get("pop") else ""
        if st.get("pop"):
            # Word-by-word highlight for the social looks.
            parts = []
            for w, (ws, we) in grp:
                k = max(1, int(round((we - ws) * 100)))
                parts.append(f"{{\\kf{k}}}{w.upper() if st['upper'] else w}")
            text = " ".join(parts)
            stylecol = f"{{\\1c{ass_color(st['col'])}\\2c{ass_color(acc)}}}"
            ev.append(f"Dialogue: 5,{ts(s)},{ts(e)},Cap,,0,0,0,,{{\\pos(540,{capy})\\an5}}{pop}{text}")
        else:
            ev.append(f"Dialogue: 5,{ts(s)},{ts(e)},Cap,,0,0,0,,{{\\pos(540,{capy})\\an5\\fad(40,0)}}{text}")
    ass = "[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n" + "\n".join(styles) + "\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n" + "\n".join(ev) + "\n"
    assf = f"{ROOT}/videos/{n:02d}.ass"
    open(assf, "w").write(ass)

    if framed:
        # A 4:5 portrait of the founder inside the card: the face reads at phone size.
        vf = (f"[0:v]crop=trunc(ih*4/5/2)*2:ih:(iw-ow)/2:0,{st['grade']},scale=960:1200[pic];color=c=0x{st['bg']}:s={W}x{H}:d={dur}[bg];"
              f"[bg][pic]overlay=(W-w)/2:440,ass={assf}:fontsdir={FONTS}[v]")
    else:
        z = st.get("zoom", 1.0)
        vf = (f"[0:v]crop=trunc(ih/{z}*9/16/2)*2:trunc(ih/{z}/2)*2:(iw-ow)/2:(ih-oh)/2*0.6,scale={W}:{H}:flags=lanczos,{st['grade']},"
              f"ass={assf}:fontsdir={FONTS}[v]")
    out = f"{ROOT}/videos/{n:02d}-{re.sub('[^a-z0-9]+','-',c['company'].lower()).strip('-')}-9x16.mp4"
    subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", raw, "-filter_complex", vf, "-map", "[v]", "-map", "0:a",
                    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", "-profile:v", "high", "-level", "4.1",
                    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-movflags", "+faststart", out], check=True)
    print(out, round(dur, 1))

if __name__ == "__main__":
    for a in sys.argv[1:]:
        build(int(a))
