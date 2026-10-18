"""Contact sheets for visual QA.
python3 preview.py          -> seed-assets/preview.png (20 avatars + covers)
python3 preview.py logos    -> _work/logos.png (logo lockups on white + reversed)
python3 preview.py people   -> _work/people.png (all people crops, labelled)
"""
import glob
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

from common import OUT, TF, WORK, cdir, companies


def font(sz):
    return ImageFont.truetype(f"{TF}/Inter-SemiBold.ttf", sz)


def main():
    cs = companies()
    cols, cw, ch, av = 4, 480, 270, 96
    rows = (len(cs) + cols - 1) // cols
    cellh = ch + 40
    im = Image.new("RGB", (cols * (cw + 20) + 20, rows * (cellh + 20) + 20), "#F2F2F0")
    d = ImageDraw.Draw(im)
    for k, c in enumerate(cs):
        dd = cdir(c)
        x, y = 20 + (k % cols) * (cw + 20), 20 + (k // cols) * (cellh + 20)
        im.paste(Image.open(f"{dd}/cover.png").convert("RGB").resize((cw, ch), Image.LANCZOS), (x, y))
        a = Image.open(f"{dd}/avatar.png").convert("RGB").resize((av, av), Image.LANCZOS)
        m = Image.new("L", (av, av), 0)
        ImageDraw.Draw(m).ellipse((0, 0, av - 1, av - 1), fill=255)
        d.ellipse((x + 14, y + ch - av // 2 - 4, x + 14 + av + 8, y + ch + av // 2 + 4), fill="white")
        im.paste(a, (x + 18, y + ch - av // 2), m)
        d.text((x + av + 34, y + ch + 8), f"{c['n']:02d}  {c['company']}", fill="#111", font=font(18))
    im.save(f"{OUT}/preview.png")
    print("preview", im.size)


def logos():
    cs = companies()
    cw, chh = 560, 170
    im = Image.new("RGB", (4 * cw, 10 * chh), "white")
    d = ImageDraw.Draw(im)
    for k, c in enumerate(cs):
        dd = cdir(c)
        x, y = (k % 2) * 2 * cw, (k // 2) * chh
        lg = Image.open(f"{dd}/logo.png").convert("RGBA")
        lg.thumbnail((cw - 60, chh - 40))
        im.paste(lg, (x + 30, y + 20), lg)
        d.rectangle((x + cw, y, x + 2 * cw, y + chh), fill=c["brand"]["primary"])
        mk = Image.open(f"{dd}/avatar.png").convert("RGB").resize((chh - 30, chh - 30))
        im.paste(mk, (x + cw + 20, y + 15))
        mp = Image.open(f"{dd}/mark.png").convert("RGBA").resize((chh - 30, chh - 30))
        bg = Image.new("RGBA", mp.size, "white")
        bg.alpha_composite(mp)
        im.paste(bg.convert("RGB"), (x + cw + chh + 10, y + 15))
    im.save(f"{WORK}/logos.png")


def people():
    files = []
    for c in companies():
        dd = cdir(c)
        man = json.load(open(f"{dd}/people/manifest.json"))
        for p in man["people"]:
            files.append((f"{dd}/people/{p['file']}", f"{c['n']:02d} {p['name']}"[:22], p.get("replicaName") or "monogram"))
    cols, cell = 10, 150
    rows = (len(files) + cols - 1) // cols
    im = Image.new("RGB", (cols * cell, rows * (cell + 34)), "white")
    d = ImageDraw.Draw(im)
    for k, (f, label, rep) in enumerate(files):
        x, y = (k % cols) * cell, (k // cols) * (cell + 34)
        im.paste(Image.open(f).convert("RGB").resize((cell, cell)), (x, y))
        d.text((x + 2, y + cell + 1), label, fill="black", font=font(12))
        d.text((x + 2, y + cell + 16), rep[:22], fill="#666", font=font(11))
    im.save(f"{WORK}/people.png")


if __name__ == "__main__":
    {"logos": logos, "people": people}.get(sys.argv[1] if len(sys.argv) > 1 else "", main)()
