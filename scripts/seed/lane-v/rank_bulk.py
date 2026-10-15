"""Rank lane D's fictional bulk companies for presenter videos (owner, 15 Oct):
clear problem, credible traction and team, plausible sector-region fit, and
variety of sectors and regions. Writes the ranked jobs with ~35 s scripts built
only from each company's own story fields, and a stock presenter under the caps
(replica id <= 2 companies, person <= 4).

    python3 rank_bulk.py <seed-v dir> <repo root> [top_n]
"""
import collections
import json
import re
import sys

S, ROOT = sys.argv[1], sys.argv[2]
TOP = int(sys.argv[3]) if len(sys.argv) > 3 else 60
world = json.load(open(f"{S}/bulk/world.json"))
db = {r["canonical_name"]: r for r in json.load(open(f"{S}/bulk/db.json"))}

F = set("Abena Achieng Adaeze Aditi Aisha Ama Amani Amelia Ananya Anika Ayanda Chioma Chloe Claire Dina Efua Emma Fatima "
        "Grace Halima Hannah Huda Hui Ifeoma Inès Karabo Kavya Layla Leah Lerato Mariam Maryam Maya Mei Naledi Nasra Ngozi "
        "Njeri Nour Noura Olivia Priya Salma Sophie Thandiwe Wanjiru Zainab Zanele Zawadi".split())
IMPLAUSIBLE = {("energy", c) for c in ("CA", "GB", "US")} | {("agri", "GB"), ("agri", "SG"), ("retail", "US")}
TRACTION = {"recurring": 3, "paying": 2, "recurring_flat": 2, "partnerships": 1, "pilots": 1, "lois": 1,
            "project": 1, "users": 1, "early": 1, "waitlist": 0, "none": -1}
CCY = {"USD": "dollars", "EUR": "euros", "GBP": "pounds", "NGN": "naira", "KES": "Kenyan shillings", "ZAR": "rand",
       "INR": "rupees", "EGP": "Egyptian pounds", "AED": "dirhams", "SGD": "Singapore dollars", "BRL": "reais",
       "CAD": "Canadian dollars", "GHS": "cedis"}


def spoken_money(m):
    ccy, n = m.group(1), float(m.group(2).replace(",", ""))
    if n >= 1e9:
        v = f"{n / 1e9:.1f}".rstrip("0").rstrip(".") + " billion"
    elif n >= 1e6:
        v = f"{n / 1e6:.1f}".rstrip("0").rstrip(".") + " million"
    elif n >= 1e3:
        v = f"{round(n / 1e3):,} thousand"
    else:
        v = f"{n:,.0f}"
    return f"{v} {CCY.get(ccy, ccy)}"


def speak(t):
    t = re.sub(r"\b([A-Z]{3}) ([\d,]+(?:\.\d+)?)", spoken_money, t)
    t = t.replace(" (company-reported)", ", as the company reports").replace("(company estimate, not independently checked)", "")
    t = re.sub(r"\s*\(([^)]*)\)", r", \1,", t)
    return re.sub(r"\s+", " ", re.sub(r",\s*([.,])", r"\1", t)).strip()


def score(c):
    t = c["traction"]
    sig = t.get("signal") or t.get("revenueStatus") or "none"
    s = {"strong": 3, "medium": 1, "thin": 0}[c["evidence"]] + TRACTION.get(sig, 0)
    s += 1 if c["stageOption"] in ("seed", "series_a", "series_b") else 0
    s -= 5 if (c["archetype"], c["country"]) in IMPLAUSIBLE else 0
    return s


eligible = [c for c in world if (r := db.get(c["name"])) and r["r"] == "marketplace_ready" and r["p"] == 0]
eligible.sort(key=lambda c: (-score(c), c["key"]))
by_arch, by_country, ranked = collections.Counter(), collections.Counter(), []
for c in eligible:
    if by_arch[c["archetype"]] >= 3 or by_country[c["country"]] >= 5 or score(c) < 3:
        continue
    by_arch[c["archetype"]] += 1
    by_country[c["country"]] += 1
    ranked.append(c)
    if len(ranked) == TOP:
        break


def script(i, c):
    st, name, city = c["story"], c["name"], c["city"]
    who = c["founder"]["displayName"]
    title = c["founder"]["businessTitle"].replace("Co-founder and ", "co-founder and ")
    prob, sol, trac, raise_ = (speak(st[k]) for k in ("problem", "solution", "traction", "raise"))
    trac = "It is early: there is nothing measurable yet." if trac.startswith("Nothing measurable") else trac
    raise_ = raise_.replace("Raising", f"{name} is raising", 1)
    ai = ["I'm an AI presenter, sharing this pitch.", "This summary is presented by an AI presenter.",
          f"I'm an AI presenter, and this is {name}'s pitch."]
    forms = [
        f"{prob} {who}, {title}, started {name} to change that. {sol} {trac} {raise_} {ai[i % 3]}",
        f"I'm an AI presenter, with {name}'s pitch, from {city}. {prob} {sol} {trac} {who} leads the company as {title}. {raise_}",
        f"{trac} That is where {name} stands today. The problem it works on: {prob[0].lower() + prob[1:]} {sol} {raise_} {ai[(i + 1) % 3]}",
        f"{who} leads {name}, in {city}. {prob} {sol} {trac} {raise_} {ai[(i + 2) % 3]}",
    ]
    out = re.sub(r"\s+", " ", forms[i % 4]).strip()
    # About 35 s: add the company's own market, then team, sentence when short.
    for extra in (speak(st.get("market", "")), speak(st.get("team", ""))):
        if len(out.split()) >= 80 or not extra:
            break
        cut = out.rfind(raise_)
        out = out[:cut] + extra.rstrip(".") + ". " + out[cut:]
    return re.sub(r"\s+", " ", out).strip()


# presenter census from everything already cast
names = {x["id"]: x["name"] for x in json.load(open(f"{S}/replicas.json"))["key#1"]}
person = lambda r: re.sub(r"\s+\d$", "", names[r].split(" - ")[0].strip())
cast = [r for r in re.findall(r'"replicaId": "(r[0-9a-f]{11})"', open(f"{ROOT}/docs/seed/tavus-20/plan.json").read())]
L = json.load(open(f"{S}/ledger.json"))["videos"]
recast = {j["slug"][:-3] for j in json.load(open(f"{S}/jobs-recast.json"))}
for slug, v in L.items():
    if slug == "fw-souqsheet" or slug in recast:
        continue
    cast.append(v["replica"])
ids = collections.Counter(cast)
ppl = collections.Counter(person(r) for r in cast)
SKIP = {"Santa", "Dr. Paws", "Mr. Edward", "Evan", "Gloria", "Dominic"}  # costume, animal, stylised, green-screen
pool = [r for r in names if person(r) not in SKIP and "Greenscreen" not in names[r] and "Vertical" not in names[r]]
MEN = set("Benjamin Carter Charlie Daniel Darius Diego Dr. Adams Dr. Lee James Jakey Jamie Kai Lee Liam Lucas Mark "
          "Mateo Nathan Owen Raj Steve Thomas Victor Zane".split())
male = lambda r: person(r) in MEN or person(r) in ("Dr. Adams", "Dr. Lee")
jobs = []
for i, c in enumerate(ranked):
    female = c["founder"]["displayName"].split()[0] in F
    health = c["archetype"] in ("telehealth", "records", "claims")
    choices = [r for r in pool if (not male(r)) == female and ids[r] < 2 and ppl[person(r)] < 4
               and (health or not (person(r).startswith("Dr.") or "Doctor" in names[r]))]
    pick = min(choices, key=lambda r: (ppl[person(r)], ids[r], r))
    ids[pick] += 1
    ppl[person(pick)] += 1
    jobs.append({"slug": f"fb-{c['key']}", "rank": i + 1, "company": c["name"], "founder": c["founder"]["displayName"],
                 "email": c["founder"]["email"], "companyId": db[c["name"]]["id"], "replica_id": pick,
                 "presenter": names[pick], "score": score(c), "script": script(i, c)})
json.dump(jobs, open(f"{S}/jobs-fb.json", "w"), ensure_ascii=False, indent=1)
w = sorted(len(j["script"].split()) for j in jobs)
print("ranked", len(jobs), "words", w[0], w[len(w) // 2], w[-1])
print("distinct people now", len(ppl), "max id", max(ids.values()), "max person", ppl.most_common(3))
for j in jobs[:6]:
    print(j["rank"], j["company"], "|", j["presenter"], "|", j["script"][:160])
