"""Hand-built geometric brand marks, one per company, drawn in a 100x100 box.

Each mark takes a palette dict P with keys: main, acc, soft (and optional extras)
and a uid used to namespace <mask> ids. Cut-outs use masks, never a painted
background colour, so marks stay correct on transparent backgrounds.
"""
import math

from common import GF, text_path


def _mask(uid, body):
    return f'<mask id="m{uid}" maskUnits="userSpaceOnUse" x="-10" y="-10" width="120" height="120">' \
           f'<rect x="-10" y="-10" width="120" height="120" fill="#fff"/>{body}</mask>'


def m01(P, u):  # Ledgerline: lowercase l (serif-cut top) resting on one ledger rule
    return (f'<path d="M40 17 A9 9 0 0 1 58 17 L58 64 Q58 71 65 71 L74 71 L74 79 L56 79 Q40 79 40 63 Z" fill="{P["main"]}"/>'
            f'<rect x="10" y="82" width="80" height="8" rx="4" fill="{P["acc"]}"/>')


def m02(P, u):  # Termly: calendar block split into three term bars
    m = P["main"]
    return (f'<rect x="28" y="8" width="9" height="16" rx="4.5" fill="{m}"/>'
            f'<rect x="63" y="8" width="9" height="16" rx="4.5" fill="{m}"/>'
            f'<path d="M14 30 Q14 18 26 18 L74 18 Q86 18 86 30 L86 36 L14 36 Z" fill="{m}"/>'
            f'<rect x="14" y="42" width="72" height="12" fill="{P["acc"]}"/>'
            f'<rect x="14" y="58" width="72" height="12" fill="{m}"/>'
            f'<path d="M14 74 L86 74 L86 80 Q86 92 74 92 L26 92 Q14 92 14 80 Z" fill="{m}"/>')


def m03(P, u):  # Clearwater: droplet cut by one level line
    d = "M50 6 C50 6 19 42 19 63 A31 31 0 0 0 81 63 C81 42 50 6 50 6 Z"
    return (_mask(u, '<rect x="0" y="55" width="100" height="6" fill="#000"/>') +
            f'<path d="{d}" fill="{P["main"]}" mask="url(#m{u})"/>'
            f'<path d="{d}" fill="{P["soft"]}" mask="url(#m{u}b)"/>'
            f'<mask id="m{u}b"><rect x="0" y="0" width="100" height="55" fill="#fff"/></mask>'
            f'<rect x="2" y="56.5" width="13" height="3" rx="1.5" fill="{P["main"]}"/>'
            f'<rect x="85" y="56.5" width="13" height="3" rx="1.5" fill="{P["main"]}"/>')


def m04(P, u):  # Tensorgate: square gate, keyhole notch in top edge
    m = P["main"]
    return (f'<path d="M43 16 L16 16 L16 88 L84 88 L84 16 L57 16" fill="none" stroke="{m}" stroke-width="11" stroke-linejoin="miter"/>'
            f'<circle cx="50" cy="44" r="9" fill="{P["acc"]}"/>'
            f'<path d="M45.5 49 L54.5 49 L58 70 L42 70 Z" fill="{P["acc"]}"/>')


def m05(P, u):  # Drishti: outer iris ring + aperture inner ring
    lines = []
    for i in range(6):
        a = math.radians(60 * i + 15)
        b = math.radians(60 * (i + 1) + 15)
        vx, vy = 50 + 11 * math.cos(a), 50 + 11 * math.sin(a)
        wx, wy = 50 + 11 * math.cos(b), 50 + 11 * math.sin(b)
        dx, dy = wx - vx, wy - vy
        L = math.hypot(dx, dy)
        ex, ey = vx + dx / L * 40, vy + dy / L * 40
        lines.append(f'<line x1="{vx - dx / L * 2:.2f}" y1="{vy - dy / L * 2:.2f}" x2="{ex:.2f}" y2="{ey:.2f}" stroke="#000" stroke-width="3.2"/>')
    hexagon = " ".join(f"{50 + 11 * math.cos(math.radians(60 * i + 15)):.2f},{50 + 11 * math.sin(math.radians(60 * i + 15)):.2f}" for i in range(6))
    return (_mask(u, "".join(lines) + f'<polygon points="{hexagon}" fill="#000"/>') +
            f'<circle cx="50" cy="50" r="41" fill="none" stroke="{P["main"]}" stroke-width="8"/>'
            f'<circle cx="50" cy="50" r="29" fill="{P["acc"]}" mask="url(#m{u})"/>')


def m06(P, u):  # Silo Credit: three grain sacks stacked as rising bars
    out = []
    for i, (x, h) in enumerate(((12, 34), (39, 52), (66, 72))):
        top = 90 - h
        col = P["acc"] if i == 2 else P["main"]
        out.append(f'<path d="M{x} 90 L{x} {top + 12} Q{x} {top + 4} {x + 6} {top + 2} L{x + 16} {top + 2} Q{x + 22} {top + 4} {x + 22} {top + 12} L{x + 22} 90 Z" fill="{col}"/>'
                   f'<path d="M{x + 6} {top - 6} L{x + 16} {top - 6} L{x + 13} {top} L{x + 9} {top} Z" fill="{col}"/>')
    return "".join(out)


def m07(P, u):  # Portside: four container blocks forming a P
    ribs = []
    blocks = [(14, 12, 40, 22, P["main"]), (14, 38, 40, 22, P["main"]), (14, 64, 40, 22, P["main"]), (58, 12, 26, 48, P["acc"])]
    for (x, y, w, h, _) in blocks:
        if w > h:
            ribs += [f'<rect x="{x + k}" y="{y + 5}" width="2.4" height="{h - 10}" fill="#000"/>' for k in range(8, w - 4, 7)]
        else:
            ribs += [f'<rect x="{x + 5}" y="{y + k}" width="{w - 10}" height="2.4" fill="#000"/>' for k in range(8, h - 4, 7)]
    body = "".join(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="2" fill="{c}"/>' for x, y, w, h, c in blocks)
    return _mask(u, "".join(ribs)) + f'<g mask="url(#m{u})">{body}</g>'


def m08(P, u):  # MedTrail: capsule leaving a dotted trail
    cap = (f'<g transform="rotate(-38 63 38)">'
           f'<path d="M63 27 L45 27 A11 11 0 0 0 45 49 L63 49 Z" fill="{P["main"]}"/>'
           f'<path d="M63 27 L81 27 A11 11 0 0 1 81 49 L63 49 Z" fill="{P["acc"]}"/></g>')
    dots = "".join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{P["main"]}"/>' for x, y, r in ((34, 66, 5), (22, 77, 4), (12, 86, 3)))
    return cap + dots


def m09(P, u):  # Baridi: a low sun over a single crate outline
    return (f'<path d="M30 48 A20 20 0 0 1 70 48 Z" fill="{P["acc"]}"/>'
            f'<rect x="18.5" y="52.5" width="63" height="35" rx="3" fill="none" stroke="{P["main"]}" stroke-width="7"/>'
            f'<line x1="22" y1="70" x2="78" y2="70" stroke="{P["main"]}" stroke-width="4"/>')


def m10(P, u):  # Prumo: a plumb bob hanging from a straight line
    return (f'<rect x="14" y="10" width="72" height="7" rx="3.5" fill="{P["acc"]}"/>'
            f'<rect x="48.5" y="16" width="3" height="28" fill="{P["acc"]}"/>'
            f'<rect x="44" y="42" width="12" height="6" rx="1.5" fill="{P["main"]}"/>'
            f'<path d="M50 94 L33.5 62 A17 17 0 0 1 66.5 62 Z" fill="{P["main"]}"/>')


def m11(P, u):  # Ferrolith: cell cross-section as three flat layers
    return (f'<rect x="12" y="20" width="76" height="16" rx="3" fill="{P["main"]}"/>'
            f'<rect x="12" y="42" width="76" height="16" rx="3" fill="{P["acc"]}"/>'
            f'<rect x="12" y="64" width="76" height="16" rx="3" fill="{P["main"]}"/>'
            f'<rect x="24" y="14" width="10" height="6" fill="{P["main"]}"/>'
            f'<rect x="66" y="80" width="10" height="6" fill="{P["main"]}"/>')


def m12(P, u):  # Shiftwell: rounded clock whose hands form a check mark
    return (f'<rect x="10" y="10" width="80" height="80" rx="30" fill="none" stroke="{P["soft"]}" stroke-width="8"/>'
            f'<path d="M31 51 L45 65 L70 33" fill="none" stroke="{P["main"]}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<circle cx="45" cy="65" r="3" fill="{P["acc"]}"/>')


def m13(P, u):  # Halyard: a single rope line running up to a pennant flag
    return (f'<path d="M30 94 L30 8" stroke="{P["main"]}" stroke-width="7" stroke-linecap="round"/>'
            f'<path d="M40 92 L40 40" stroke="{P["main"]}" stroke-width="3" stroke-linecap="round"/>'
            f'<path d="M37 10 L37 6 Q40 4 43 6 L43 10" fill="none" stroke="{P["main"]}" stroke-width="2.4"/>'
            f'<path d="M37 12 L86 26 L37 40 Z" fill="{P["acc"]}"/>')


def m14(P, u):  # Hui: circle of ten dots with one dot lifted out
    out = []
    for i in range(10):
        a = math.radians(-90 + 36 * i)
        if i == 0:
            out.append(f'<circle cx="{50 + 46 * math.cos(a):.2f}" cy="{56 + 46 * math.sin(a):.2f}" r="7" fill="{P["acc"]}"/>')
        else:
            out.append(f'<circle cx="{50 + 30 * math.cos(a):.2f}" cy="{56 + 30 * math.sin(a):.2f}" r="7" fill="{P["main"]}"/>')
    return "".join(out)


def m15(P, u):  # Cosecha: avocado half whose stone is a water drop
    av = "M50 6 C63 6 69 22 73 36 C78 54 86 62 86 75 C86 91 70 96 50 96 C30 96 14 91 14 75 C14 62 22 54 27 36 C31 22 37 6 50 6 Z"
    return (f'<path d="{av}" fill="{P["main"]}"/>'
            f'<path d="{av}" fill="{P["soft"]}" transform="translate(50 62) scale(0.8) translate(-50 -62)"/>'
            f'<path d="M50 48 C50 48 37 62 37 71 A13 13 0 0 0 63 71 C63 62 50 48 50 48 Z" fill="{P["acc"]}"/>')


def m16(P, u):  # Mizan: level balance beam with two equal pans
    m, a = P["main"], P["acc"]
    pans = ""
    for cx in (20, 80):
        pans += (f'<path d="M{cx} 26 L{cx - 13} 60 M{cx} 26 L{cx + 13} 60" stroke="{m}" stroke-width="2"/>'
                 f'<path d="M{cx - 16} 60 L{cx + 16} 60 A16 10 0 0 1 {cx - 16} 60 Z" fill="{a}"/>')
    return (f'<circle cx="50" cy="15" r="5" fill="{m}"/>'
            f'<rect x="47" y="20" width="6" height="64" fill="{m}"/>'
            f'<rect x="14" y="23.5" width="72" height="5" rx="2.5" fill="{m}"/>'
            f'<path d="M32 92 L68 92 L62 84 L38 84 Z" fill="{m}"/>' + pans)


def m17(P, u):  # Rand Treasury: R whose leg is a hedged, flattened curve
    m = P["main"]
    return (f'<rect x="16" y="10" width="15" height="82" fill="{m}"/>'
            f'<path d="M31 17.5 L53 17.5 A17.5 17.5 0 0 1 53 52.5 L31 52.5" fill="none" stroke="{m}" stroke-width="15"/>'
            f'<path d="M46 52 C64 52 62 84.5 88 84.5" fill="none" stroke="{P["acc"]}" stroke-width="15"/>')


def m18(P, u):  # Orphéa: open lyre whose strings are a DNA ladder
    m = P["main"]
    s1, s2, rungs = [], [], []
    for k in range(0, 41):
        t = k / 40
        y = 30 + t * 44
        dx = 9 * math.sin(t * 2 * math.pi * 1.25)
        s1.append(f"{50 + dx:.2f},{y:.2f}")
        s2.append(f"{50 - dx:.2f},{y:.2f}")
    for k in range(1, 10):
        t = k / 10
        y = 30 + t * 44
        dx = 9 * math.sin(t * 2 * math.pi * 1.25)
        if abs(dx) > 2.5:
            rungs.append(f'<line x1="{50 - dx:.2f}" y1="{y:.2f}" x2="{50 + dx:.2f}" y2="{y:.2f}" stroke="{P["acc"]}" stroke-width="3" stroke-linecap="round"/>')
    return (f'<path d="M24 10 C14 20 16 34 22 46 C28 60 30 72 50 84 C70 72 72 60 78 46 C84 34 86 20 76 10" fill="none" stroke="{m}" stroke-width="7" stroke-linecap="round"/>'
            f'<line x1="22" y1="24" x2="78" y2="24" stroke="{m}" stroke-width="6" stroke-linecap="round"/>'
            f'<rect x="38" y="88" width="24" height="6" rx="3" fill="{m}"/>'
            + "".join(rungs) +
            f'<polyline points="{" ".join(s1)}" fill="none" stroke="{m}" stroke-width="3"/>'
            f'<polyline points="{" ".join(s2)}" fill="none" stroke="{m}" stroke-width="3"/>')


def m19(P, u):  # Akshar: speech bubble carrying the first letter of the Kannada chart (ಅ)
    d, w = text_path(f"{GF}/NotoSansKannada.ttf", {"wght": 640}, "ಅ", 56, 0, 0, 0)
    return (f'<path d="M30 10 L70 10 Q92 10 92 32 L92 54 Q92 76 70 76 L40 76 L20 93 L23 76 Q8 72 8 54 L8 32 Q8 10 30 10 Z" fill="{P["main"]}"/>'
            f'<path d="{d}" fill="{P["acc"]}" transform="translate({50 - w / 2:.2f} 59)"/>')


def m20(P, u):  # Railhead: two rails converging to a small dot overhead
    m = P["main"]
    ties = ""
    for y, w, h in ((84, 74, 6), (69, 58, 5), (57, 46, 4)):
        ties += f'<rect x="{50 - w / 2}" y="{y - h / 2}" width="{w}" height="{h}" rx="1" fill="{m}"/>'
    return (f'<path d="M14 94 L40 44" stroke="{m}" stroke-width="7" stroke-linecap="butt"/>'
            f'<path d="M86 94 L60 44" stroke="{m}" stroke-width="7" stroke-linecap="butt"/>' + ties +
            f'<circle cx="50" cy="22" r="8" fill="{P["acc"]}"/>')


MARKS = {i: globals()[f"m{i:02d}"] for i in range(1, 21)}

W = "#FFFFFF"
# Light = on white/transparent. Reverse = on the brand primary (avatar, dark slides).
PALETTES = {
    1: (dict(main="#1F5C4A", acc="#E3B23C", soft="#1F5C4A"), dict(main=W, acc="#E3B23C", soft=W)),
    2: (dict(main="#E2563B", acc="#2B4C7E", soft="#E2563B"), dict(main=W, acc="#2B4C7E", soft=W)),
    3: (dict(main="#1E6E7A", acc="#1E6E7A", soft="#7FB9C1"), dict(main=W, acc=W, soft="#CDE6E8")),
    4: (dict(main="#263238", acc="#39D98A", soft="#263238"), dict(main=W, acc="#39D98A", soft=W)),
    5: (dict(main="#E89B1C", acc="#0F5E6B", soft="#E89B1C"), dict(main=W, acc="#0F5E6B", soft=W)),
    6: (dict(main="#9C6B2F", acc="#2E5E3A", soft="#9C6B2F"), dict(main=W, acc="#D9E6C9", soft=W)),
    7: (dict(main="#B5452B", acc="#F2C14E", soft="#B5452B"), dict(main=W, acc="#F2C14E", soft=W)),
    8: (dict(main="#0067A5", acc="#7AC943", soft="#0067A5"), dict(main=W, acc="#7AC943", soft=W)),
    9: (dict(main="#2A9DD6", acc="#F7931E", soft="#2A9DD6"), dict(main=W, acc="#F7931E", soft=W)),
    10: (dict(main="#D95F18", acc="#4A4E54", soft="#D95F18"), dict(main=W, acc="#1C1C1C", soft=W)),
    11: (dict(main="#5B6770", acc="#D4A017", soft="#5B6770"), dict(main=W, acc="#D4A017", soft=W)),
    12: (dict(main="#7B2D8E", acc="#7B2D8E", soft="#D9B9E1"), dict(main=W, acc="#F6C9A8", soft="#F6C9A8")),
    13: (dict(main="#1D3557", acc="#E63946", soft="#1D3557"), dict(main=W, acc="#E63946", soft=W)),
    14: (dict(main="#D9467A", acc="#2BA37A", soft="#D9467A"), dict(main="#F4C3D4", acc=W, soft=W)),
    15: (dict(main="#6A8D2F", acc="#3FA7D6", soft="#DDE8C6"), dict(main=W, acc="#3FA7D6", soft="#A9C17A")),
    16: (dict(main="#7A1F2B", acc="#D8B26E", soft="#7A1F2B"), dict(main=W, acc="#D8B26E", soft=W)),
    17: (dict(main="#3D348B", acc="#F7B801", soft="#3D348B"), dict(main=W, acc="#F7B801", soft=W)),
    18: (dict(main="#3E5C76", acc="#F0A6CA", soft="#3E5C76"), dict(main=W, acc="#F0A6CA", soft=W)),
    19: (dict(main="#F2D03B", acc="#2F4858", soft="#F2D03B"), dict(main="#2F4858", acc="#F2D03B", soft=W)),
    20: (dict(main="#B23A48", acc="#FFD23F", soft="#B23A48"), dict(main=W, acc="#FFD23F", soft=W)),
}


def mark_svg(n, reverse=False, uid=None):
    P = PALETTES[n][1 if reverse else 0]
    return MARKS[n](P, uid or f"{n}{'r' if reverse else 'l'}")
