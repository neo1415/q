"""Logo lockups, marks, avatars and covers for the 20 seed companies.

python3 brand.py  -> writes SVG sources + _work/jobs-brand.json for render.mjs
"""
import json
import math
import random

from common import BRAND, WORK, cdir, companies, esc, metrics, mix, text_path
from marks import PALETTES, mark_svg

INLINE_SUB = {5, 15}  # sub word sits on the baseline after the main word


def logo_parts(c, reverse=False, mark_h=100.0, word_override=None):
    """Return (inner svg, width, height) of the horizontal lockup at mark height mark_h."""
    n = c["n"]
    b = c["brand"]
    cfg = BRAND[n]
    fpath, var, track, word = cfg["word"]
    cap, xh = metrics(fpath)
    lower = word == word.lower()
    # Size the wordmark so lowercase x-height or caps sit comfortably against the mark.
    size = mark_h * (0.62 / xh * 0.5 if lower else 0.46 / cap)
    if n in (1, 2, 9, 14, 19):
        size = mark_h * 0.31 / xh
    gap = mark_h * 0.26
    has_sub = "sub" in cfg
    below = has_sub and n not in INLINE_SUB
    word_col = "#FFFFFF" if reverse else b["ink"]
    sub_col = PALETTES[n][1]["acc"] if reverse else b["primary"]
    if n == 19:
        word_col = b["accent"] if reverse else b["ink"]
    if word_override:
        word_col = sub_col = word_override
    if reverse and n in (3, 14, 6, 10, 12, 15):
        sub_col = "#FFFFFF"
    # vertical placement
    h = mark_h
    if below:
        base = mark_h * 0.60
    else:
        base = mark_h * 0.5 + (cap if not lower else xh) * size * 0.5
        if lower:  # optical: centre between x-height and cap for lowercase words
            base = mark_h * 0.5 + (xh * size) * 0.5 + (cap - xh) * size * 0.18
    x0 = mark_h + gap
    d, w = text_path(fpath, var, word, size, track, x0, base)
    parts = [f'<path d="{d}" fill="{word_col}"/>']
    width = x0 + w
    if has_sub:
        sp, sv, st, sw = cfg["sub"]
        if below:
            ssize = size * (0.34 if sw.isupper() else 0.42)
            sd, sww = text_path(sp, sv, sw, ssize, st, x0 + size * 0.03, base + size * 0.27 + ssize * metrics(sp)[0])
            h = max(h, base + size * 0.27 + ssize * metrics(sp)[0] + 4)
            width = max(width, x0 + sww)
        else:
            sd, sww = text_path(sp, sv, sw, size, st, x0 + w + size * 0.18, base)
            width = x0 + w + size * 0.18 + sww
        parts.append(f'<path d="{sd}" fill="{sub_col}"/>')
    inner = f'<g>{mark_svg(n, reverse, f"L{n}{int(reverse)}")}</g>' + "".join(parts)
    # keep mark in its own 100-box; scale if mark_h != 100
    if mark_h != 100:
        inner = inner.replace("<g>", f'<g transform="scale({mark_h / 100})">', 1)
    return inner, width, h


def logo_svg(c, reverse=False, pad=8, word_override=None):
    inner, w, h = logo_parts(c, reverse, word_override=word_override)
    W, H = w + 2 * pad, h + 2 * pad
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.1f} {H:.1f}" width="{W:.0f}" height="{H:.0f}">'
            f'<title>{esc(c["company"])}</title><g transform="translate({pad} {pad})">{inner}</g></svg>'), W, H


def mark_only(c, reverse=False, pad=6):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{-pad} {-pad} {100 + 2 * pad} {100 + 2 * pad}" width="1024" height="1024">'
            + mark_svg(c["n"], reverse, "M%d%d" % (c["n"], int(reverse))) + '</svg>')


def avatar(c):
    p = c["brand"]["primary"]
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">'
            f'<rect width="1024" height="1024" fill="{p}"/>'
            '<g transform="translate(512 512) scale(6.1) translate(-50 -50)">' + mark_svg(c["n"], True, "A%d" % c["n"]) + '</g></svg>')


# ---------------------------------------------------------------- covers
def _cover(n, b):
    P, A, I = b["primary"], b["accent"], b["ink"]
    rnd = random.Random(n * 7919)
    s = []
    if n == 1:
        bg = "#F5F1E6"
        for y in range(90, 900, 44):
            s.append(f'<rect x="0" y="{y}" width="1600" height="1.5" fill="{P}" opacity="0.18"/>')
        s.append(f'<rect x="0" y="712" width="1600" height="10" fill="{A}"/>')
        s.append('<rect x="120" y="0" width="1.5" height="900" fill="#B5452B" opacity="0.25"/>')
        for i, hgt in enumerate([150, 200, 180, 240, 280, 260, 330, 380, 420, 470, 530, 590]):
            x = 760 + i * 66
            s.append(f'<path d="M{x} {712 - hgt + 14} L{x + 28} {712 - hgt} L{x + 28} 712 L{x} 712 Z" fill="{P}" opacity="{0.35 + i * 0.055:.2f}"/>')
    elif n == 2:
        bg = P
        for r in range(4):
            for col in range(13):
                x, y = 90 + col * 112, 150 + r * 160
                s.append(f'<rect x="{x}" y="{y}" width="92" height="92" rx="16" fill="#FFFFFF" opacity="0.12"/>')
        for r, (c0, c1) in enumerate(((0, 4), (4, 8), (8, 13))):
            y = 150 + (r + 1) * 160 - 34
            s.append(f'<rect x="{90 + c0 * 112}" y="{y}" width="{(c1 - c0) * 112 - 20}" height="22" rx="11" fill="{A}"/>')
        s.append(f'<rect x="90" y="96" width="{3 * 112 + 92}" height="22" rx="11" fill="#FFFFFF"/>')
    elif n == 3:
        bg = I
        for k, y in enumerate(range(470, 900, 34)):
            s.append(f'<rect x="0" y="{y}" width="1600" height="{2 + k * 0.6:.1f}" fill="{P}" opacity="{0.9 - k * 0.05:.2f}"/>')
        s.append(f'<g transform="translate(980 -40) scale(9)"><path d="M50 6 C50 6 19 42 19 63 A31 31 0 0 0 81 63 C81 42 50 6 50 6 Z" fill="{A}" opacity="0.92"/></g>')
        s.append(f'<rect x="0" y="526" width="1600" height="40" fill="{I}"/>')
    elif n == 4:
        bg = "#0A0C10"
        for r in range(9):
            for col in range(16):
                x, y = 40 + col * 98, 22 + r * 98
                sel = (r, col) == (4, 11)
                op = 0.32 + 0.6 * math.exp(-((col - 11) ** 2 + (r - 4) ** 2) / 18)
                stroke = A if sel else "#B8C7CE"
                s.append(f'<path d="M{x + 30} {y + 8} L{x + 8} {y + 8} L{x + 8} {y + 70} L{x + 70} {y + 70} L{x + 70} {y + 8} L{x + 48} {y + 8}" fill="none" stroke="{stroke}" stroke-width="{6 if sel else 3}" opacity="{1 if sel else op:.2f}"/>')
                if sel:
                    s.append(f'<circle cx="{x + 39}" cy="{y + 32}" r="8" fill="{A}"/><path d="M{x + 35} {y + 36} L{x + 43} {y + 36} L{x + 46} {y + 54} L{x + 32} {y + 54} Z" fill="{A}"/>')
    elif n == 5:
        bg = P
        for k in range(14):
            r = 60 + k * 58
            s.append(f'<circle cx="1180" cy="450" r="{r}" fill="none" stroke="#FFFFFF" stroke-width="{2 + (k % 3 == 0) * 4}" opacity="{0.55 - k * 0.03:.2f}"/>')
        s.append(f'<g transform="translate(1180 450) scale(5) translate(-50 -50)">{mark_svg(5, True, "C5")}</g>')
    elif n == 6:
        bg = "#F3EBDD"
        x = 40
        for i in range(24):
            h = 60 + i * 26 + rnd.randint(-14, 14)
            w = 52
            col = A if i >= 20 else P
            op = 0.25 + i * 0.03
            s.append(f'<path d="M{x} 860 L{x} {860 - h + 16} Q{x} {860 - h} {x + 14} {860 - h} L{x + w - 14} {860 - h} Q{x + w} {860 - h} {x + w} {860 - h + 16} L{x + w} 860 Z" fill="{col}" opacity="{min(op, 1):.2f}"/>')
            s.append(f'<path d="M{x + 16} {860 - h - 14} L{x + w - 16} {860 - h - 14} L{x + w - 21} {860 - h} L{x + 21} {860 - h} Z" fill="{col}" opacity="{min(op, 1):.2f}"/>')
            x += 64
        s.append(f'<rect x="0" y="860" width="1600" height="40" fill="{I}"/>')
    elif n == 7:
        bg = I
        cols = [P, A, "#E9E4DA", "#6F8796", P, "#2F4A60"]
        for r in range(7):
            x = -60 + (r % 2) * 70
            while x < 1640:
                w = rnd.choice([150, 150, 300])
                c = rnd.choice(cols)
                y = 60 + r * 118
                s.append(f'<rect x="{x}" y="{y}" width="{w - 10}" height="104" rx="3" fill="{c}" opacity="0.92"/>')
                for k in range(x + 16, x + w - 20, 16):
                    s.append(f'<rect x="{k}" y="{y + 12}" width="3" height="80" fill="#000" opacity="0.14"/>')
                x += w
    elif n == 8:
        bg = P
        pts = []
        for i in range(60):
            t = i / 59
            x = 80 + t * 1180
            y = 760 - 520 * t + 140 * math.sin(t * math.pi * 2.2)
            pts.append((x, y))
        for i, (x, y) in enumerate(pts[:-3]):
            s.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{3 + i * 0.12:.1f}" fill="#FFFFFF" opacity="{0.25 + i * 0.012:.2f}"/>')
        s.append(f'<g transform="translate(1180 70) scale(5)">{mark_svg(8, True, "C8")}</g>')
    elif n == 9:
        bg = P
        s.append(f'<circle cx="800" cy="560" r="300" fill="{A}"/>')
        s.append(f'<rect x="0" y="560" width="1600" height="340" fill="{I}"/>')
        for r in range(2):
            for k in range(9):
                x = 40 + k * 176 + r * 88
                y = 600 + r * 130
                s.append(f'<rect x="{x}" y="{y}" width="150" height="104" rx="6" fill="none" stroke="#FFFFFF" stroke-width="6" opacity="{0.9 - r * 0.4:.2f}"/>'
                         f'<line x1="{x + 8}" y1="{y + 52}" x2="{x + 142}" y2="{y + 52}" stroke="#FFFFFF" stroke-width="3" opacity="{0.6 - r * 0.25:.2f}"/>')
    elif n == 10:
        bg = "#ECE7E1"
        s.append(f'<rect x="0" y="60" width="1600" height="8" fill="{A}"/>')
        for k in range(18):
            x = 70 + k * 86
            L = 140 + int(260 * abs(math.sin(k * 0.9))) + rnd.randint(0, 120)
            col = P if k == 11 else A
            op = 1 if k == 11 else 0.55
            s.append(f'<rect x="{x - 1.5}" y="68" width="3" height="{L}" fill="{col}" opacity="{op}"/>'
                     f'<g transform="translate({x} {68 + L}) scale(1.6)"><rect x="-6" y="-2" width="12" height="6" rx="1.5" fill="{col}" opacity="{op}"/><path d="M0 56 L-16.5 24 A17 17 0 0 1 16.5 24 Z" fill="{col}" opacity="{op}"/></g>')
        s.append(f'<rect x="0" y="840" width="1600" height="60" fill="{A}" opacity="0.15"/>')
    elif n == 11:
        bg = I
        y = 40
        k = 0
        while y < 880:
            h = [44, 18, 70, 12, 30][k % 5]
            col = A if k % 5 == 1 else ["#5B6770", "#3A434A", "#77838C"][k % 3]
            s.append(f'<rect x="-20" y="{y}" width="1640" height="{h}" rx="4" fill="{col}" opacity="{0.95 if col == A else 0.75}"/>')
            y += h + 10
            k += 1
    elif n == 12:
        bg = P
        for r in range(4):
            for col in range(9):
                x, y = 70 + col * 166, 90 + r * 186
                on = rnd.random() < 0.55
                s.append(f'<rect x="{x}" y="{y}" width="132" height="132" rx="48" fill="none" stroke="#FFFFFF" stroke-width="7" opacity="0.25"/>')
                if on:
                    s.append(f'<path d="M{x + 38} {y + 68} L{x + 58} {y + 88} L{x + 96} {y + 42}" fill="none" stroke="{A}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>')
    elif n == 13:
        bg = P
        s.append(f'<path d="M-20 820 L1620 140" stroke="#FFFFFF" stroke-width="4" opacity="0.8"/>')
        for k in range(11):
            t = 0.06 + k * 0.085
            x = -20 + 1640 * t
            y = 820 - 680 * t
            col = A if k % 3 == 1 else "#FFFFFF"
            op = 1 if col == A else 0.35
            s.append(f'<path d="M{x:.0f} {y:.0f} L{x + 34:.0f} {y + 84:.0f} L{x + 110:.0f} {y + 22:.0f} Z" fill="{col}" opacity="{op}"/>')
    elif n == 14:
        bg = P
        for (cx, cy, R, rr) in ((1150, 520, 250, 28), (380, 330, 140, 15), (640, 720, 100, 11), (170, 690, 70, 8), (1460, 190, 70, 8)):
            for i in range(10):
                a = math.radians(-90 + 36 * i)
                rad = R * (1.5 if i == 0 else 1)
                col = A if i == 0 else "#FFFFFF"
                op = 1 if i == 0 else 0.85
                s.append(f'<circle cx="{cx + rad * math.cos(a):.1f}" cy="{cy + rad * math.sin(a):.1f}" r="{rr}" fill="{col}" opacity="{op}"/>')
    elif n == 15:
        bg = P
        for k in range(16):
            y0 = 340 + k * 40
            s.append(f'<path d="M-40 {y0 + k * 12} Q 800 {y0 - 220 + k * 6} 1640 {y0 + k * 12}" fill="none" stroke="#FFFFFF" stroke-width="{3 + k * 0.6:.1f}" opacity="{0.12 + k * 0.035:.2f}"/>')
        for (x, y, sc) in ((1260, 140, 2.4), (1380, 250, 1.4), (1160, 300, 1.0)):
            s.append(f'<g transform="translate({x} {y}) scale({sc})"><path d="M0 -40 C0 -40 -30 0 -30 18 A30 30 0 0 0 30 18 C30 0 0 -40 0 -40 Z" fill="{A}"/></g>')
    elif n == 16:
        bg = P
        unit = 120
        for r in range(9):
            for col in range(15):
                cx, cy = col * unit + (r % 2) * 60, r * 104
                pts = []
                for i in range(16):
                    rad = 46 if i % 2 == 0 else 26
                    a = math.radians(i * 22.5)
                    pts.append(f"{cx + rad * math.cos(a):.1f},{cy + rad * math.sin(a):.1f}")
                s.append(f'<polygon points="{" ".join(pts)}" fill="none" stroke="{A}" stroke-width="1.6" opacity="0.28"/>')
        s.append(f'<rect x="0" y="560" width="1600" height="340" fill="{P}" opacity="0.0"/>')
        s.append(f'<circle cx="1180" cy="450" r="290" fill="{P}"/>')
        s.append(f'<g transform="translate(1180 450) scale(4.4) translate(-50 -50)">{mark_svg(16, True, "C16")}</g>')
    elif n == 17:
        bg = P
        for k in range(12):
            y0 = 120 + k * 58
            amp = 260 - k * 14
            col = A if k == 5 else "#FFFFFF"
            op = 1 if k == 5 else 0.12 + k * 0.02
            s.append(f'<path d="M-40 {y0 - amp * 0.0:.0f} C 420 {y0:.0f} 520 {y0 + amp:.0f} 900 {y0 + amp:.0f} L1640 {y0 + amp:.0f}" fill="none" stroke="{col}" stroke-width="{14 if k == 5 else 6}" opacity="{op:.2f}"/>')
    elif n == 18:
        bg = P
        for row, (yc, amp, sc) in enumerate(((300, 70, 1.0), (640, 46, 0.7))):
            pts1, pts2, rungs = [], [], []
            for i in range(161):
                x = -20 + i * 10.25
                ph = x / 1640 * 2 * math.pi * (4.5 if row == 0 else 6)
                pts1.append(f"{x:.1f},{yc + amp * math.sin(ph):.1f}")
                pts2.append(f"{x:.1f},{yc - amp * math.sin(ph):.1f}")
                if i % 4 == 2 and abs(math.sin(ph)) > 0.2:
                    rungs.append(f'<line x1="{x:.1f}" y1="{yc - amp * math.sin(ph):.1f}" x2="{x:.1f}" y2="{yc + amp * math.sin(ph):.1f}" stroke="{A}" stroke-width="{6 * sc:.1f}" stroke-linecap="round" opacity="{1 - row * 0.45}"/>')
            s += rungs
            for pts in (pts1, pts2):
                s.append(f'<polyline points="{" ".join(pts)}" fill="none" stroke="#FFFFFF" stroke-width="{8 * sc:.1f}" opacity="{0.95 - row * 0.5}"/>')
    elif n == 19:
        bg = P
        letters = "ಅಆಇಈಉಊಋಎಏಐಒಓಔಕಖಗಘಙಚಛಜಝಞಟ"
        from common import GF as _GF
        k = 0
        for r in range(4):
            for col in range(10):
                ch = letters[k % len(letters)]
                k += 1
                x, y = 60 + col * 156, 200 + r * 200
                if (r, col) == (1, 6):
                    s.append(f'<g transform="translate({x - 30} {y - 150}) scale(2.0)">{mark_svg(19, True, "C19")}</g>')
                    continue
                d, w = text_path(f"{_GF}/NotoSansKannada.ttf", {"wght": 500}, ch, 80, 0, 0, 0)
                if w > 100:
                    d, w = text_path(f"{_GF}/NotoSansKannada.ttf", {"wght": 500}, ch, 80 * 100 / w, 0, 0, 0)
                s.append(f'<path d="{d}" transform="translate({x + 60 - w / 2:.1f} {y})" fill="{A}" opacity="{0.16 if (r + col) % 3 else 0.32}"/>')
    elif n == 20:
        bg = I
        vx, vy = 800, 170
        s.append(f'<circle cx="{vx}" cy="{vy - 70}" r="22" fill="{A}"/>')
        for k in range(14):
            t = (k / 13) ** 1.9
            y = vy + 30 + t * 760
            half = 40 + t * 820
            s.append(f'<rect x="{vx - half:.0f}" y="{y:.0f}" width="{2 * half:.0f}" height="{4 + t * 30:.0f}" fill="{P}" opacity="{0.35 + 0.6 * t:.2f}"/>')
        for side in (-1, 1):
            s.append(f'<path d="M{vx + side * 26} {vy + 20} L{vx + side * 520} 920" stroke="#E8E8E8" stroke-width="16"/>')
            s.append(f'<path d="M{vx + side * 26} {vy + 20} L{vx + side * 520} 920" stroke="#E8E8E8" stroke-width="16" opacity="0"/>')
    return bg, "".join(s)


def cover(c):
    bg, body = _cover(c["n"], c["brand"])
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" width="1600" height="900">'
            f'<rect width="1600" height="900" fill="{bg}"/>{body}</svg>')


def build():
    jobs = []
    for c in companies():
        d = cdir(c)
        svg, W, H = logo_svg(c)
        open(f"{d}/logo.svg", "w").write(svg)
        rsvg, RW, RH = logo_svg(c, reverse=True)
        open(f"{WORK}/logo-rev-{c['n']:02d}.svg", "w").write(rsvg)
        open(f"{WORK}/mark-{c['n']:02d}.svg", "w").write(mark_only(c))
        open(f"{WORK}/avatar-{c['n']:02d}.svg", "w").write(avatar(c))
        open(f"{WORK}/cover-{c['n']:02d}.svg", "w").write(cover(c))
        # logo.png: 1024 wide, transparent; the HTML wrapper scales the SVG to width.
        lh = round(1024 * H / W)
        open(f"{WORK}/logo-{c['n']:02d}.html", "w").write(
            f'<html><body style="margin:0;background:transparent"><img src="file://{d}/logo.svg" style="width:1024px;height:{lh}px;display:block"></body></html>')
        jobs += [
            dict(src=f"{WORK}/logo-{c['n']:02d}.html", out=f"{d}/logo.png", w=1024, h=lh, kind="png", transparent=True),
            dict(src=f"{WORK}/mark-{c['n']:02d}.svg", out=f"{d}/mark.png", w=1024, h=1024, kind="png", transparent=True),
            dict(src=f"{WORK}/avatar-{c['n']:02d}.svg", out=f"{d}/avatar.png", w=1024, h=1024, kind="png"),
            dict(src=f"{WORK}/cover-{c['n']:02d}.svg", out=f"{d}/cover.png", w=1600, h=900, kind="png"),
        ]
    json.dump(jobs, open(f"{WORK}/jobs-brand.json", "w"), indent=0)
    print(len(jobs), "brand jobs")


if __name__ == "__main__":
    build()
