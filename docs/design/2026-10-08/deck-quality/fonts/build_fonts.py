"""Instance the variable OFL faces and subset them for deck-render.

Run with python3 -I. Inputs: fontsrc dir; output: target fonts dir.
"""
import os, sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)

UNICODES = (
    list(range(0x20, 0x7F)) + list(range(0xA0, 0x250)) + list(range(0x300, 0x370))
    + list(range(0x1E00, 0x1F00)) + list(range(0x2000, 0x2070))
    + list(range(0x20A0, 0x20C1)) + list(range(0x2100, 0x2190))
    + list(range(0x2190, 0x2200)) + list(range(0x2200, 0x2300))
)

FACES = [
    ("Inter-Regular.ttf", "Inter.ttf", {"wght": 400, "opsz": 14}),
    ("Inter-SemiBold.ttf", "Inter.ttf", {"wght": 600, "opsz": 14}),
    ("InterDisplay-SemiBold.ttf", "Inter.ttf", {"wght": 600, "opsz": 32}),
    ("SourceSerif4Display-SemiBold.ttf", "SourceSerif4.ttf", {"wght": 600, "opsz": 48}),
    ("Fraunces-SemiBold.ttf", "Fraunces.ttf", {"wght": 600, "opsz": 72, "SOFT": 0, "WONK": 0}),
    ("SourceSans3-Regular.ttf", "SourceSans3.ttf", {"wght": 400}),
    ("SourceSans3-SemiBold.ttf", "SourceSans3.ttf", {"wght": 600}),
    ("IBMPlexSans-Regular.ttf", "IBMPlexSans.ttf", {"wght": 400, "wdth": 100}),
    ("IBMPlexSans-SemiBold.ttf", "IBMPlexSans.ttf", {"wght": 600, "wdth": 100}),
    ("IBMPlexSerif-SemiBold.ttf", "IBMPlexSerif-SemiBold.ttf", None),
]

for name, source, axes in FACES:
    font = TTFont(os.path.join(src, source))
    if axes is not None:
        present = {a.axisTag for a in font["fvar"].axes}
        font = instancer.instantiateVariableFont(
            font, {k: v for k, v in axes.items() if k in present}, updateFontNames=False
        )
    options = subset.Options()
    options.layout_features = []
    options.hinting = False
    options.drop_tables += ["GSUB", "GPOS", "GDEF", "STAT", "DSIG", "meta"]
    options.name_IDs = ["*"]
    options.notdef_outline = True
    sub = subset.Subsetter(options)
    sub.populate(unicodes=UNICODES)
    sub.subset(font)
    path = os.path.join(out, name)
    font.save(path)
    cmap = font.getBestCmap()
    print(name, os.path.getsize(path), "naira" if 0x20A6 in cmap else "NO-NAIRA", "cedi" if 0x20B5 in cmap else "no-cedi")
