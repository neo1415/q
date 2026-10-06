"""Founder + team portraits (800x800, face-centred) and people/manifest.json.

Casting rules: founders use their own Tavus replica (plan.json). Team members use a
different stock actor whose apparent gender/age/heritage plausibly fits. An "actor" is
a PERSON, not a replica: several Tavus replicas show the same person (e.g. "Gloria",
"Gloria - Studio"), so a cluster is used at most once, and every cluster that shares a
name with a founder replica is excluded. Where no unused, plausible actor exists the
member gets a monogram portrait (replicaId null) instead of a miscast face.
"""
import json
import os

from PIL import Image, ImageDraw, ImageFont

from common import GF, SCRATCH, cdir, companies, plan, slugify
from faces import crop

INDEX = json.load(open(f"{SCRATCH}/tavus/index.json"))
BY_I = {r["i"]: r for r in INDEX}

# team member name -> Tavus index (from the contact sheets; one person per cluster)
CAST = {
    "Siobhan Gallagher": 8,      # Jackie - Office (red hair)
    "Tom Ashworth": 6,           # Benjamin
    "Laura Bennett": 4,          # Anna
    "Marcus Delgado": 28,        # Nathan - Bookshelf
    "Jordan Whitfield": 40,      # Owen - Home Office
    "Sneha Deshpande": 47,       # Gabby
    "Juliana Tavares": 85,       # Brooke
    "Camila Rocha": 12,          # Rose
    "Dr Anna Weber": 95,         # Dr. Carol
    "Lukas Hoffmann": 22,        # James
    "Sabine Richter": 96,        # Deborah
    "Danielle Ortiz": 26,        # Beth
    "Brian Kowalski": 33,        # Liam
    "Eilidh MacLeod": 52,        # Helen - Casual
    "Jamie Fraser": 89,          # Charlie
    "Nguyễn Thu Hà": 137,        # Maya
    "Lê Quốc Bảo": 35,           # Kai
    "Phạm Ngọc Lan": 54,         # Lucy - Studio
    "Valeria Castañeda": 5,      # Steph - Office V1
    "Diego Herrera": 34,         # Jakey
    "Nour El-Sayed": 0,          # Luna
    "Mariam Hassan": 13,         # Olivia - Doctor
    "Pieter Botha": 81,          # Mark - Casual
    "Dr Julien Moreau": 59,      # Steve - Professional
    "Inès Benali": 3,            # Gloria
    "Ananya Hegde": 134,         # Dr. Adams
    "Sarah Lindqvist": 46,       # Katya
    "Emily Chen": 44,            # Ivy
}


def monogram(name, bg, fg, size=800):
    im = Image.new("RGB", (size, size), bg)
    d = ImageDraw.Draw(im)
    parts = [p for p in name.replace("Dr ", "").split() if p[:1].isalpha()]
    ini = (parts[0][0] + parts[-1][0]).upper() if len(parts) > 1 else parts[0][:2].upper()
    f = ImageFont.truetype(f"{GF}/Inter.ttf", 230)
    try:
        f.set_variation_by_axes([24, 560])
    except Exception:
        pass
    bb = d.textbbox((0, 0), ini, font=f)
    d.text(((size - (bb[2] - bb[0])) / 2 - bb[0], (size - (bb[3] - bb[1])) / 2 - bb[1]), ini, fill=fg, font=f)
    return im


def build():
    pl = plan()
    used = {}
    for c in companies():
        d = cdir(c) + "/people"
        os.makedirs(d, exist_ok=True)
        b = c["brand"]
        rid = pl[c["n"]]["face"]["replicaId"]
        if c["n"] == 13:
            rid = "r3f4182ef554"
        people = []
        fp = c["founderPerson"]
        f = slugify(fp["name"]) + ".jpg"
        crop(rid, 800).save(f"{d}/{f}", quality=90)
        people.append(dict(name=fp["name"], role=fp["role"], kind="founder", file=f, replicaId=rid,
                           replicaName=next(r["name"] for r in INDEX if r["id"] == rid)))
        for t in c["team"]:
            f = slugify(t["name"]) + ".jpg"
            i = CAST.get(t["name"])
            if i is not None:
                r = BY_I[i]
                assert r["id"] not in used, (t["name"], used.get(r["id"]))
                used[r["id"]] = t["name"]
                crop(r["id"], 800).save(f"{d}/{f}", quality=90)
                people.append(dict(name=t["name"], role=t["title"], kind="team", file=f, replicaId=r["id"], replicaName=r["name"]))
            else:
                fg = b["ink"] if c["n"] == 19 else "#FFFFFF"
                monogram(t["name"], b["primary"], fg).save(f"{d}/{f}", quality=92)
                people.append(dict(name=t["name"], role=t["title"], kind="team", file=f, replicaId=None, replicaName=None,
                                   placeholder="monogram",
                                   reason="No unused Tavus stock actor plausibly fits this person's stated heritage/gender."))
        json.dump(dict(company=c["company"], note="Founder face = the founder's own Tavus replica (same as the video). "
                       "Team faces are Tavus stock actors standing in for fictional people.", people=people),
                  open(f"{d}/manifest.json", "w"), ensure_ascii=False, indent=1)
    founders = {pl[n]["face"]["replicaId"] for n in pl} | {"r3f4182ef554"}
    assert not (founders & set(used)), "team actor reused from a founder"
    print("cast", len(used), "team actors")


if __name__ == "__main__":
    build()
