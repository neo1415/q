"""Re-cast repeated presenters under the owner's caps (15 Oct, option A):
each replica id on at most 2 companies, each person on at most 4.
Writes jobs-recast.json (same script, new stock presenter) and prints the census.
    python3 recast.py <seed-v dir> <repo root>
"""
import collections, json, re, sys
S, ROOT = sys.argv[1], sys.argv[2]
names = {x["id"]: x["name"] for x in json.load(open(f"{S}/replicas.json"))["key#1"]}
person = lambda r: re.sub(r"\s+\d$", "", names[r].split(" - ")[0].strip())
L = json.load(open(f"{S}/ledger.json"))["videos"]
jobs = {j["slug"]: j for f in ("jobs-fw.json", "jobs-fw2.json", "jobs-nf.json") for j in json.load(open(f"{S}/{f}"))}
nf_gender = {}
sys.path.insert(0, f"{ROOT}/docs/seed/lane-v/generator")
from founders import F
for c in F: nf_gender[c["company"]] = c["founder"][1]
fw_gender = {"Tarmacly": "M", "Yamfield Agro": "M", "Tallyloom": "M", "Nsuo Labs": "M", "Kazikit": "M", "Brightkloof Energy": "F",
             "Ledgerfold": "F", "Ajopot": "F", "Clinicrest": "F", "Marketlight Grids": "F", "Maji Loop": "F", "Souqsheet": "F"}
# company -> replica, for every live or planned video (tavus-20 from its plan).
cast = {}
t20 = json.load(open(f"{ROOT}/docs/seed/tavus-20/plan.json"))
for c in (t20["companies"] if isinstance(t20, dict) else t20):
    rid = re.search(r'"replicaId": "(r[0-9a-f]{11})"', json.dumps(c))
    if rid: cast["t20:" + c["company"]] = rid.group(1)
cast["Capital Q"] = "rccbeedfc684"
for slug, v in L.items():
    if slug in ("00-capital-q", "fw-souqsheet"): continue
    cast[jobs[slug]["company"]] = v["replica"]
REDO = ["Tarmacly", "Yamfield Agro", "Tallyloom", "Nsuo Labs", "Kazikit", "Xam Xam Learn", "Karoo Gridworks", "Kliniqa",
        "Umoja Cover", "Plumbline Assure", "Landfall Credit", "Brightkloof Energy", "Laterra Bricks", "Mavuno Cold",
        "Clausekind", "Kinkora", "Bursary Bridge", "Sahel Pumps", "Kivu Traceworks", "Kefet Rx", "Aïna Care",
        "Shambasense", "Studio Ekun"]
HEALTH = {"Kliniqa", "Kefet Rx"}
MEN = ["r340d93adc9b", "rfb0463909e3", "rbf278df2604", "r2a31940a5f0", "r2d564127497", "r2a1cea82862",
       "r3f4182ef554", "rbb3ca3630f7", "r1a4e22fa0d9", "r5fb46c843a8", "r90a0339d496", "r1d7cf9edbb4",
       "r72f7f7f7c8b", "rcea962f9f9b", "rdd4c86e5e1a"]
WOMEN = ["rc6fedbe63ea", "rf1bd7e252de", "r9fa0878977a", "rd27826c12a6", "rf4e9d9790f0", "r213e42b45b3", "rd9b169b334e",
         "r37a25df750d", "r9ed2c6769d0", "rc0d9e7a3385", "rf90eb925bd8", "r5ad3b1690f0", "r99d2b9af9a0", "ra60269d91d3",
         "r042bf0ddb46", "r862e3a3c5e0", "r78c9b897fbc", "r90e7a409fac", "rc4492899eda"]
for c in REDO: cast.pop(c)
ids = collections.Counter(cast.values()); ppl = collections.Counter(person(r) for r in cast.values())
out = []
for c in REDO:
    g = nf_gender.get(c) or fw_gender[c]
    pool = (["r340d93adc9b"] if g == "M" else ["rc6fedbe63ea"]) if c in HEALTH else []
    pool += [r for r in (MEN if g == "M" else WOMEN) if r not in ("r340d93adc9b", "rc6fedbe63ea")]
    pick = min((r for r in pool if ids[r] < 2 and ppl[person(r)] < 4), key=lambda r: (ppl[person(r)], ids[r]))
    ids[pick] += 1; ppl[person(pick)] += 1; cast[c] = pick
    j = next(j for j in jobs.values() if j["company"] == c and not j["slug"].endswith("fw-souqsheet"))
    out.append({**{k: j[k] for k in ("company", "founder", "script")}, "slug": re.sub(r"(-v\d)?$", "", j["slug"]) + "-v2",
                "replica_id": pick, "was": j.get("replica_id")})
    print(f"{c:20s} -> {names[pick]}")
json.dump(out, open(f"{S}/jobs-recast.json", "w"), ensure_ascii=False, indent=1)
print("companies", len(cast), "distinct ids", len(ids), "distinct people", len(ppl),
      "max id reuse", max(ids.values()), "max person reuse", ppl.most_common(4))
black = {"Darius", "Destiny", "Celine", "Mary"}
print("Black-presented", sum(n for p, n in ppl.items() if p in black))
