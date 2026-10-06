"""Shared paths, data loading, brand typography and text-to-outline helpers for the
seed asset generator. Everything is local: no network, no paid providers."""
import json
import os
import re
import unicodedata
from functools import lru_cache

import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.normpath(os.path.join(HERE, "..", ".."))
SCRATCH = "/tmp/claude-0/-home-user-q/5e7a5c77-f947-52b0-88c5-5afccae36a31/scratchpad"
OUT = f"{SCRATCH}/seed-assets"
WORK = f"{OUT}/_work"
TF = f"{SCRATCH}/tavus/fonts"   # static TTFs supplied with the brief
GF = f"{SCRATCH}/fonts2"        # OFL Google Fonts (variable) fetched from google/fonts
FOOTER = "Fictional company — Capital Q demo"
WATERMARK = "FICTIONAL — DEMO DOCUMENT"


def companies():
    return json.load(open(os.path.join(DATA, "companies-full.json")))


def plan():
    return {c["n"]: c for c in json.load(open(os.path.join(DATA, "plan.json")))["companies"]}


def slugify(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"^(dr|mr|mrs|ms)\s+", "", s.strip(), flags=re.I)
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def cdir(c):
    d = f"{OUT}/{c['n']:02d}-{slugify(c['company'])}"
    os.makedirs(d, exist_ok=True)
    return d


# Per-brand typography. word: (font file, variation, tracking em, text, case)
# display/body: CSS families for decks and documents (loaded from local files).
BRAND = {
    1: dict(word=(f"{GF}/SourceSerif4.ttf", {"wght": 620, "opsz": 60}, -0.01, "ledgerline"), display="SourceSerif4", body="Inter"),
    2: dict(word=(f"{GF}/Nunito.ttf", {"wght": 850}, -0.01, "termly"), display="Nunito", body="NunitoSans"),
    3: dict(word=(f"{TF}/DMSerifDisplay.ttf", {}, 0.0, "Clearwater"), sub=(f"{GF}/Inter.ttf", {"wght": 500, "opsz": 14}, 0.02, "Assurance"), display="DMSerifDisplay", body="Inter"),
    4: dict(word=(f"{GF}/SpaceGrotesk.ttf", {"wght": 620}, -0.02, "tensorgate"), display="SpaceGrotesk", body="Inter"),
    5: dict(word=(f"{TF}/Poppins-ExtraBold.ttf", {}, -0.01, "drishti"), sub=(f"{GF}/Poppins-Regular.ttf", {}, 0.0, "health"), display="PoppinsSemi", body="DMSans"),
    6: dict(word=(f"{GF}/Archivo.ttf", {"wght": 760, "wdth": 100}, -0.01, "Silo Credit"), display="Archivo", body="Archivo"),
    7: dict(word=(f"{TF}/BarlowCondensed-Bold.ttf", {}, 0.02, "PORTSIDE"), display="BarlowCondensed", body="Barlow"),
    8: dict(word=(f"{GF}/Manrope.ttf", {"wght": 760}, -0.02, "MedTrail"), display="Manrope", body="Manrope"),
    9: dict(word=(f"{GF}/Outfit.ttf", {"wght": 640}, -0.01, "baridi"), display="Outfit", body="Outfit"),
    10: dict(word=(f"{GF}/Sora.ttf", {"wght": 640}, -0.02, "Prumo"), display="Sora", body="Inter"),
    11: dict(word=(f"{GF}/IBMPlexSans.ttf", {"wght": 600, "wdth": 100}, 0.12, "FERROLITH"), display="IBMPlexSans", body="IBMPlexSans"),
    12: dict(word=(f"{GF}/DMSans.ttf", {"wght": 760, "opsz": 40}, -0.03, "shiftwell"), display="DMSans", body="DMSans"),
    13: dict(word=(f"{TF}/LibreBaskerville.ttf", {}, 0.10, "HALYARD"), sub=(f"{GF}/WorkSans.ttf", {"wght": 560}, 0.32, "SECURITY"), display="LibreBaskerville", body="WorkSans"),
    14: dict(word=(f"{TF}/BeVietnamPro-Bold.ttf", {}, -0.02, "hui"), display="BeVietnamProBold", body="BeVietnamPro"),
    15: dict(word=(f"{GF}/Fraunces.ttf", {"wght": 640, "opsz": 96, "SOFT": 100, "WONK": 0}, -0.01, "Cosecha"), sub=(f"{GF}/Fraunces.ttf", {"wght": 380, "opsz": 24, "SOFT": 100, "WONK": 0}, 0.0, "Labs"), display="Fraunces", body="LibreFranklin"),
    16: dict(word=(f"{GF}/PlayfairDisplay.ttf", {"wght": 560}, 0.06, "Mizan"), display="PlayfairDisplay", body="Lora"),
    17: dict(word=(f"{GF}/WorkSans.ttf", {"wght": 640}, -0.02, "Rand Treasury"), display="WorkSans", body="WorkSans"),
    18: dict(word=(f"{GF}/Fraunces.ttf", {"wght": 420, "opsz": 120, "SOFT": 0, "WONK": 0}, -0.01, "Orphéa"), sub=(f"{GF}/Inter.ttf", {"wght": 500, "opsz": 14}, 0.04, "Genomics"), display="Fraunces", body="Inter"),
    19: dict(word=(f"{GF}/Jost.ttf", {"wght": 600}, 0.0, "akshar"), display="Jost", body="Jost"),
    20: dict(word=(f"{GF}/Oswald.ttf", {"wght": 560}, 0.02, "RAILHEAD"), sub=(f"{GF}/Barlow-Regular.ttf", {}, 0.18, "ROBOTICS"), display="Oswald", body="Barlow"),
}

# CSS @font-face declarations for HTML rendering (decks, data room, covers).
FONT_FACES = {
    "Inter": (f"{GF}/Inter.ttf", "100 900"),
    "NunitoSans": (f"{GF}/NunitoSans.ttf", "200 1000"),
    "Nunito": (f"{GF}/Nunito.ttf", "200 1000"),
    "SourceSerif4": (f"{GF}/SourceSerif4.ttf", "200 900"),
    "DMSerifDisplay": (f"{TF}/DMSerifDisplay.ttf", "400"),
    "SpaceGrotesk": (f"{GF}/SpaceGrotesk.ttf", "300 700"),
    "PoppinsSemi": (f"{GF}/Poppins-SemiBold.ttf", "600"),
    "DMSans": (f"{GF}/DMSans.ttf", "100 1000"),
    "Archivo": (f"{GF}/Archivo.ttf", "100 900"),
    "BarlowCondensed": (f"{TF}/BarlowCondensed-Bold.ttf", "700"),
    "Barlow": (f"{GF}/Barlow-Regular.ttf", "400"),
    "Manrope": (f"{GF}/Manrope.ttf", "200 800"),
    "Outfit": (f"{GF}/Outfit.ttf", "100 900"),
    "Sora": (f"{GF}/Sora.ttf", "100 800"),
    "IBMPlexSans": (f"{GF}/IBMPlexSans.ttf", "100 700"),
    "LibreBaskerville": (f"{TF}/LibreBaskerville.ttf", "400"),
    "WorkSans": (f"{GF}/WorkSans.ttf", "100 900"),
    "BeVietnamProBold": (f"{TF}/BeVietnamPro-Bold.ttf", "700"),
    "BeVietnamPro": (f"{GF}/BeVietnamPro-Regular.ttf", "400"),
    "Fraunces": (f"{GF}/Fraunces.ttf", "100 900"),
    "LibreFranklin": (f"{GF}/LibreFranklin.ttf", "100 900"),
    "PlayfairDisplay": (f"{GF}/PlayfairDisplay.ttf", "400 900"),
    "Lora": (f"{GF}/Lora.ttf", "400 700"),
    "Jost": (f"{GF}/Jost.ttf", "100 900"),
    "Oswald": (f"{GF}/Oswald.ttf", "200 700"),
    "IBMPlexMono": (f"{GF}/IBMPlexMono-Regular.ttf", "400"),
    "Kannada": (f"{GF}/NotoSansKannada.ttf", "100 900"),
}


def font_css(families):
    out = []
    for f in families:
        path, w = FONT_FACES[f]
        out.append(f"@font-face{{font-family:'{f}';src:url('file://{path}');font-weight:{w};}}")
    return "\n".join(out)


@lru_cache(maxsize=None)
def _font(path):
    return TTFont(path)


@lru_cache(maxsize=None)
def _hbfont(path):
    blob = hb.Blob.from_file_path(path)
    return hb.Face(blob)


def text_path(font_path, var, text, size, tracking=0.0, x=0.0, y=0.0):
    """Shape `text` with HarfBuzz (kerning + ligatures) and return (svg path d, width).
    (x, y) is the left baseline origin. tracking is in em."""
    tt = _font(font_path)
    upm = tt["head"].unitsPerEm
    f = hb.Font(_hbfont(font_path))
    if var:
        f.set_variations(var)
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(f, buf, {"kern": True, "liga": True})
    gs = tt.getGlyphSet(location=var) if var else tt.getGlyphSet()
    order = tt.getGlyphOrder()
    s = size / upm
    pen = SVGPathPen(gs, ntos=lambda v: f"{v:.2f}")
    cx = 0.0
    n = len(buf.glyph_infos)
    for k, (info, pos) in enumerate(zip(buf.glyph_infos, buf.glyph_positions)):
        name = order[info.codepoint]
        tp = TransformPen(pen, (s, 0, 0, -s, x + (cx + pos.x_offset) * s, y - pos.y_offset * s))
        gs[name].draw(tp)
        cx += pos.x_advance + (tracking * upm if k < n - 1 else 0)
    return pen.getCommands(), cx * s


def metrics(font_path):
    tt = _font(font_path)
    upm = tt["head"].unitsPerEm
    os2 = tt["OS/2"]
    cap = getattr(os2, "sCapHeight", 0) or int(upm * 0.7)
    xh = getattr(os2, "sxHeight", 0) or int(upm * 0.5)
    return cap / upm, xh / upm


def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;"))


def hex2rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def lum(h):
    def ch(c):
        c = c / 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (ch(v) for v in hex2rgb(h))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def mix(a, b, t):
    ra, rb = hex2rgb(a), hex2rgb(b)
    return "#" + "".join(f"{round(x + (y - x) * t):02x}" for x, y in zip(ra, rb))


def money(amount, cur, short=True):
    sym = {"USD": "$", "NGN": "₦", "GBP": "£", "EUR": "€", "INR": "₹", "KES": "KSh ", "BRL": "R$", "ZAR": "R", "EGP": "E£", "MXN": "MX$", "VND": "₫"}.get(cur, cur + " ")
    a = float(amount)
    if short:
        for div, suf in ((1e12, "tn"), (1e9, "bn"), (1e6, "m"), (1e3, "k")):
            if abs(a) >= div:
                v = a / div
                txt = f"{v:.1f}".rstrip("0").rstrip(".") if v < 100 else f"{v:.0f}"
                return f"{sym}{txt}{suf}"
    return f"{sym}{a:,.0f}"
