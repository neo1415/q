import json, sys
sys.path.insert(0, sys.path[0])
import c01_05, c06_10, c11_15, c16_20

plan_path, out_path = sys.argv[1], sys.argv[2]
plan = {c["n"]: c for c in json.load(open(plan_path))["companies"]}
fns = c01_05.COMPANIES + c06_10.COMPANIES + c11_15.COMPANIES + c16_20.COMPANIES
ORDER = ["n", "company", "planFacts", "legalName", "websiteUrl", "foundedDate", "headquarters", "currentStageCode",
         "headcount", "shortDescription", "primaryDescription", "tags", "keywords", "brand", "founderPerson", "team",
         "capital", "metrics", "deck", "deckGaps", "dataRoom", "qGuide", "qPersonality", "gateqAnswers"]
out, errs = [], []
for n, fn in enumerate(fns, 1):
    p = plan[n]
    d = fn()
    d["n"] = n
    d["company"] = p["company"]
    d["planFacts"] = {k: p[k] for k in ("oneLiner", "sector", "geography", "stage", "model", "traction", "raise", "zinoFit")}
    d = {k: d[k] for k in ORDER}
    # invariants
    if d["currentStageCode"] != p["stage"]: errs.append((n, "stage"))
    if d["founderPerson"]["name"] != p["founder"]["name"]: errs.append((n, "founder"))
    if d["founderPerson"]["age"] != p["founder"]["age"]: errs.append((n, "age"))
    if d["founderPerson"]["role"] != p["founder"]["role"]: errs.append((n, "role"))
    if len(d["shortDescription"]) > 160: errs.append((n, "short", len(d["shortDescription"])))
    if not 10 <= len(d["keywords"]) <= 15: errs.append((n, "keywords", len(d["keywords"])))
    if not 2 <= len(d["team"]) <= 4: errs.append((n, "team"))
    if not 8 <= len(d["qGuide"]) <= 12: errs.append((n, "qGuide", len(d["qGuide"])))
    if not 8 <= len(d["dataRoom"]) <= 12: errs.append((n, "dataRoom"))
    if not d["websiteUrl"].endswith(".example"): errs.append((n, "url"))
    if not "2026-12-01" <= d["capital"]["targetCloseDate"] <= "2027-03-31": errs.append((n, "close"))
    for s in d["deck"]:
        gap = s["section"] in {g["section"] for g in d["deckGaps"]}
        if not ((1 if gap else 2) <= len(s["content"]) <= 4): errs.append((n, "deck", s["section"], len(s["content"])))
    out.append(d)
brands = [tuple(sorted((c["brand"]["primary"], c["brand"]["accent"], c["brand"]["ink"]))) for c in out]
if len(set(c["brand"]["primary"] for c in out)) != 20: errs.append("dup primary")
if sum(1 for c in out if c["deckGaps"]) != 6: errs.append("thin count")
print("ERRORS:", errs)
json.dump(out, open(out_path, "w"), ensure_ascii=False, indent=2)
print("wrote", len(out))
