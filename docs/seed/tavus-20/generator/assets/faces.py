"""Face detection + face-centred square crops from Tavus stock stills (local only).

Usage:
  python3 faces.py detect            -> writes faces.json (bbox per replicaId) into SCRATCH
  python3 faces.py sheet             -> writes labelled face contact sheets for casting
"""
import json
import os
import sys

import cv2
from PIL import Image, ImageDraw, ImageFont

SCRATCH = "/tmp/claude-0/-home-user-q/5e7a5c77-f947-52b0-88c5-5afccae36a31/scratchpad"
THUMBS = f"{SCRATCH}/tavus/thumbs"
INDEX = f"{SCRATCH}/tavus/index.json"
HAAR = f"{SCRATCH}/models/haar.xml"
FACES = f"{SCRATCH}/seed-assets/_work/faces.json"


def valid_ids():
    out = []
    for r in json.load(open(INDEX)):
        p = f"{THUMBS}/{r['id']}.jpg"
        if os.path.exists(p) and open(p, "rb").read(5) != b"<?xml":
            out.append(r)
    return out


def detect():
    casc = cv2.CascadeClassifier(HAAR)
    res = {}
    for r in valid_ids():
        img = cv2.imread(f"{THUMBS}/{r['id']}.jpg")
        h, w = img.shape[:2]
        s = 960 / max(h, w)
        small = cv2.resize(img, (int(w * s), int(h * s)))
        g = cv2.equalizeHist(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY))
        f = casc.detectMultiScale(g, 1.1, 6, minSize=(50, 50))
        if len(f):
            x, y, fw, fh = max(f, key=lambda b: b[2] * b[3])
            box = [int(x / s), int(y / s), int(fw / s), int(fh / s)]
        else:  # fall back to upper-centre, typical talking-head framing
            box = [int(w * 0.4), int(h * 0.18), int(w * 0.2), int(w * 0.2)]
        res[r["id"]] = {"name": r["name"], "i": r["i"], "box": box, "size": [w, h], "detected": bool(len(f))}
    os.makedirs(os.path.dirname(FACES), exist_ok=True)
    json.dump(res, open(FACES, "w"), indent=1)
    print(len(res), "faces;", sum(not v["detected"] for v in res.values()), "fallbacks")


def crop(rid, size=800, scale=2.3):
    """Square crop centred on the face, face height ~ 1/scale of the frame."""
    info = json.load(open(FACES))[rid]
    im = Image.open(f"{THUMBS}/{rid}.jpg").convert("RGB")
    W, H = im.size
    x, y, w, h = info["box"]
    cx, cy = x + w / 2, y + h / 2 + h * 0.12  # nudge down to include shoulders
    side = min(w * scale, W, H)
    l = min(max(cx - side / 2, 0), W - side)
    t = min(max(cy - side / 2, 0), H - side)
    return im.crop((int(l), int(t), int(l + side), int(t + side))).resize((size, size), Image.LANCZOS)


def sheet():
    faces = json.load(open(FACES))
    items = sorted(faces.items(), key=lambda kv: kv[1]["i"])
    font = ImageFont.truetype(f"{SCRATCH}/tavus/fonts/Inter-SemiBold.ttf", 15)
    per, cols, cell = 48, 8, 190
    for s in range(0, len(items), per):
        chunk = items[s:s + per]
        rows = (len(chunk) + cols - 1) // cols
        sh = Image.new("RGB", (cols * cell, rows * (cell + 22)), "white")
        d = ImageDraw.Draw(sh)
        for k, (rid, v) in enumerate(chunk):
            c = crop(rid, cell, 2.0)
            X, Y = (k % cols) * cell, (k // cols) * (cell + 22)
            sh.paste(c, (X, Y))
            d.text((X + 3, Y + cell + 2), f"{v['i']} {v['name']}"[:24], fill="black", font=font)
        sh.save(f"{SCRATCH}/seed-assets/_work/faces{s // per}.png")


if __name__ == "__main__":
    {"detect": detect, "sheet": sheet}[sys.argv[1]]()
