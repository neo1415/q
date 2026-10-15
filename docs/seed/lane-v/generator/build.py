"""Build the lane-V founders dataset and its local assets (no network, no paid providers).

    python3 build.py <assets_dir>        -> ../companies-full.json (Capital Q kept as n=0),
                                            ../jobs-nf.json (Tavus jobs), HTML for decks and
                                            data-room documents, logos, covers, monograms
    node render.mjs <assets_dir>/_work/jobs.json   -> PDFs

Everything is fictional and derived only from founders.py, so the dataset, the
documents and the presenter script agree.
"""
import hashlib
import html
import json
import os
import re
import subprocess
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from founders import F  # noqa: E402

ASSETS = sys.argv[1]
WORK = f"{ASSETS}/_work"
os.makedirs(WORK, exist_ok=True)
FONT = "/usr/share/fonts/opentype/inter"
WATERMARK = "FICTIONAL COMPANY · CAPITAL Q DEMO DOCUMENT"
STAGE = {"pre_seed": "Pre-seed", "seed": "Seed", "series_a": "Series A"}
MONTHS = ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]
PALETTE = ["#1F5C4A", "#7A2E2E", "#1E3A5F", "#5B3A7A", "#2F5D2B", "#8A5A12", "#0F5257", "#6B2D4F",
           "#3D4A1E", "#28406B", "#7B3F00", "#1B4D3E"]


def ascii_slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"^(dr|mr|mrs|ms)\.?\s+", "", s.strip(), flags=re.I)
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def h(key, mod):
    return int(hashlib.sha256(key.encode()).hexdigest(), 16) % mod


def email(name, key):
    return f"{ascii_slug(name).split('-')[0]}.{key}@fictional.capitalq.local"


def fmt_money(n, ccy):
    return f"{ccy} {n:,.0f}"


def series(a, b, n=8, dec=0):
    out = []
    for i in range(n):
        v = a * (b / a) ** (i / (n - 1)) if a > 0 and b > 0 else a + (b - a) * i / (n - 1)
        out.append(round(v, dec) if dec else int(round(v)))
    return out


def headcount(c):
    lo, hi = {"pre_seed": (5, 9), "seed": (12, 32), "series_a": (38, 95)}[c["stage"]]
    return lo + h(c["key"], hi - lo + 1)


def final_script(c):
    """About 35 s: one sourced fact is added when the script is short."""
    s = c["script"].strip()
    if len(s.split()) >= 88:
        return s
    line, pct = c["uof"][0]
    add = f" {pct} percent of the new money goes to {line[0].lower() + line[1:]}."
    t = c["team"][0]
    if len(s.split()) + len(add.split()) < 86:
        add += f" {t[0]} is {t[1].replace('Co-founder & ', 'co-founder and ')}."
    parts = re.split(r"(?<=\.)\s+(?=I'm an AI presenter|This pitch is presented|This summary is presented)", s)
    if len(parts) == 2:
        return parts[0] + add + " " + parts[1]
    return s + add


def record(i, c):
    n = 101 + i
    amt, ccy, instrument, cap, close, minc = c["raise_"]
    k1, k2 = c["kpi"], c["kpi2"]
    p1 = series(k1[3], k1[4], dec=k1[5] if len(k1) > 5 else 0)
    p2 = series(k2[3], k2[4])
    kpis = [{"code": k1[0], "label": k1[1], "unit": k1[2], **({"currency": ccy} if k1[2] == "money" else {})},
            {"code": k2[0], "label": k2[1], "unit": k2[2], **({"currency": ccy} if k2[2] == "money" else {})}]
    points = [{"period": m, "asOf": f"{m}-28", "values": {k1[0]: p1[j], k2[0]: p2[j]}} for j, m in enumerate(MONTHS)]
    fname, gender, nat, role, bio = c["founder"]
    team = [{"name": t[0], "title": t[1], "appRole": t[2], "bio": t[3], "email": email(t[0], c["key"])} for t in c["team"]]
    hc = headcount(c)
    reg = f"{c['country']}-{100000 + h(c['key'] + 'reg', 899999)}"
    uof = [{"line": l, "percent": p, "amount": round(amt * p / 100), "currency": ccy} for l, p in c["uof"]]
    founders = 1 + sum(1 for t in team if re.search(r"co-?founder", t["title"], re.I))
    esop = 10
    founder_pct = 62 if founders == 1 else 44
    co_pct = 0 if founders == 1 else 24
    angels = 100 - esop - founder_pct - co_pct
    data_room = [
        {"title": "Certificate of Incorporation", "folder": "incorporation", "visibility": "ON_REQUEST",
         "summary": [f"Legal name: {c['legal']}", f"Registration number {reg}; incorporated {c['founded']}",
                     f"Registered office: {c['city']}"]},
        {"title": f"Cap table summary ({MONTHS[-1][:4]})", "folder": "cap_table", "visibility": "SHARED_ONLY",
         "summary": [f"{fname}: {founder_pct}%"] + ([f"{t['name']}: {co_pct}%" for t in team if re.search('co-?founder', t['title'], re.I)]) +
                    [f"Employee option pool: {esop}%", f"Angel investors: {angels}%", "Fully diluted, before this round"]},
        {"title": "Management accounts summary (Sep 2026)", "folder": "financials", "visibility": "ON_REQUEST",
         "summary": [f"{k1[1]}: {p1[0]:,} (Feb 2026) to {p1[-1]:,} (Sep 2026)",
                     f"{k2[1]}: {p2[0]:,} (Feb 2026) to {p2[-1]:,} (Sep 2026)",
                     f"Business model: {c['model']}", "Unaudited; prepared by management"]},
        {"title": "Team and advisers", "folder": "team", "visibility": "PUBLIC",
         "summary": [f"{fname}, {role}: {bio}"] + [f"{t['name']}, {t['title']}: {t['bio']}" for t in team] + [f"Headcount: {hc} full-time"]},
        {"title": "Customers and pipeline summary", "folder": "contracts", "visibility": "ON_REQUEST",
         "summary": [f"Market: {c['market']}", f"{k2[1]}: {p2[-1]:,} at September 2026",
                     f"Model: {c['model']}", "Named customers are listed in the full data room on request"]},
    ]
    deck = [
        {"section": "problem", "content": [c["problem"]]},
        {"section": "solution", "content": [c["solution"]]},
        {"section": "market", "content": [c["market"]]},
        {"section": "business_model", "content": [c["model"]]},
        {"section": "traction", "content": [f"{k1[1]}: {p1[-1]:,} (Sep 2026), from {p1[0]:,} in Feb 2026",
                                             f"{k2[1]}: {p2[-1]:,}"]},
        {"section": "team", "content": [f"{fname}, {role}: {bio}"] + [f"{t['name']}, {t['title']}" for t in team] + [f"{hc} people"]},
        {"section": "raise", "content": [f"Raising {fmt_money(amt, ccy)} ({instrument}{', cap ' + fmt_money(cap, ccy) if cap else ''})",
                                         f"Target close {close}; minimum cheque {fmt_money(minc, ccy)}"]},
        {"section": "use_of_funds", "content": [f"{u['line']}: {u['percent']}%" for u in uof]},
    ]
    guide = [
        f"Lead with the problem: {c['problem']}",
        "Quote figures exactly as reported and give the month they refer to.",
        "Say clearly what is early or self-reported; never round up.",
        f"The raise is {fmt_money(amt, ccy)} ({instrument}).",
        "Offer a call with the founder for anything not in the data room.",
    ]
    return {
        "n": n, "key": c["key"], "company": c["company"], "legalName": c["legal"],
        "websiteUrl": f"https://{c['key']}.example", "foundedDate": c["founded"],
        "headquarters": {"city": c["city"], "country": c["country"]},
        "currentStageCode": c["stage"], "headcount": hc,
        "shortDescription": c["one"][:160],
        "primaryDescription": f"{c['one']} {c['problem']} {c['solution']} {c['company']} serves {c['market'][0].lower() + c['market'][1:]}",
        "tags": {"industry": c["tags"]},
        "founderPerson": {"name": fname, "email": email(fname, c["key"]), "role": role, "appRole": "OWNER",
                          "gender": gender, "nationality": nat,
                          "headline": f"{role}, {c['company']}",
                          "professionalSummary": bio, "backgroundSummary": f"Based in {c['city']}. {bio}"},
        "team": team, "inviteTeam": True,
        "metrics": {"kpis": kpis, "points": points},
        "capital": {"targetRaise": {"amount": amt, "currency": ccy}, "instrument": instrument,
                    **({"valuationCap": {"amount": cap, "currency": ccy}} if cap else {}),
                    "targetCloseDate": close, "minimumCheque": {"amount": minc, "currency": ccy},
                    "useOfFunds": uof},
        **({"signal": c["signal"]} if c.get("signal") else {}),
        "deck": deck, "dataRoom": data_room, "qGuide": guide, "qPersonality": c["personality"],
        "pitchTitle": f"{c['company']}: pitch summary (AI presenter, AI-generated)",
        "presenter": {"replicaId": c["replica"], "label": "AI presenter (stock Tavus replica), not the founder"},
        "fictional": True,
    }


def page(title, body, brand, company):
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
@page {{ size: A4; margin: 22mm 18mm; }}
body {{ font-family: Inter, sans-serif; color: #1a1a1a; font-size: 11pt; line-height: 1.5; }}
h1 {{ color: {brand}; font-size: 20pt; margin: 0 0 4mm; }} h2 {{ color: {brand}; font-size: 13pt; margin: 7mm 0 2mm; }}
.wm {{ position: fixed; top: 45%; left: -10%; width: 120%; text-align: center; transform: rotate(-30deg);
       font-size: 30pt; color: rgba(0,0,0,0.06); font-weight: 700; }}
.foot {{ position: fixed; bottom: -12mm; left: 0; right: 0; font-size: 8pt; color: #666; }}
li {{ margin: 1.5mm 0; }}
</style></head><body><div class="wm">{WATERMARK}</div><div class="foot">{html.escape(company)} · fictional company · Capital Q demo</div>
<h1>{html.escape(title)}</h1>{body}</body></html>"""


def deck_html(r, brand):
    slides = [f'<section class="s t"><h1>{html.escape(r["company"])}</h1><p>{html.escape(r["shortDescription"])}</p>'
              f'<p class="m">{html.escape(r["headquarters"]["city"])} · {STAGE[r["currentStageCode"]]} · October 2026</p></section>']
    for s in r["deck"]:
        items = "".join(f"<li>{html.escape(x)}</li>" for x in s["content"])
        slides.append(f'<section class="s"><h2>{s["section"].replace("_", " ").title()}</h2><ul>{items}</ul></section>')
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
@page {{ size: 297mm 167mm; margin: 0; }}
body {{ margin: 0; font-family: Inter, sans-serif; }}
.s {{ width: 297mm; height: 167mm; box-sizing: border-box; padding: 18mm 22mm; page-break-after: always; position: relative;
      border-top: 6mm solid {brand}; }}
.t {{ background: {brand}; color: white; border: 0; }} .t h1 {{ font-size: 34pt; margin-top: 30mm; }} .t p {{ font-size: 15pt; max-width: 200mm; }}
.m {{ opacity: .8; font-size: 11pt !important; }}
h2 {{ color: {brand}; font-size: 24pt; margin: 0 0 8mm; }} li {{ font-size: 15pt; margin: 4mm 0; max-width: 240mm; }}
.s::after {{ content: "Fictional company · Capital Q demo"; position: absolute; bottom: 8mm; right: 12mm; font-size: 8pt; opacity: .55; }}
</style></head><body>{''.join(slides)}</body></html>"""


def run(cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def esc(t):
    return t.replace("\\", "\\\\").replace(":", "\\:").replace("'", "’")


def images(r, brand, d):
    initials = "".join(w[0] for w in r["company"].split()[:2]).upper()
    hexc = brand.lstrip("#")
    if not os.path.exists(f"{d}/logo.png"):
        run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c=0x{hexc}:s=800x800", "-frames:v", "1", "-vf",
             f"drawtext=fontfile={FONT}/Inter-SemiBold.otf:text='{esc(initials)}':fontsize=330:fontcolor=white:x=(w-tw)/2:y=(h-th)/2", f"{d}/logo.png"])
    if not os.path.exists(f"{d}/cover.png"):
        run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c=0x{hexc}:s=1800x600", "-frames:v", "1", "-vf",
             f"drawtext=fontfile={FONT}/Inter-SemiBold.otf:text='{esc(r['company'])}':fontsize=100:fontcolor=white:x=120:y=210,"
             f"drawtext=fontfile={FONT}/Inter-Regular.otf:text='{esc(r['headquarters']['city'])}':fontsize=46:fontcolor=white@0.85:x=124:y=350", f"{d}/cover.png"])
    os.makedirs(f"{d}/people", exist_ok=True)
    for p in [r["founderPerson"], *r["team"]]:
        out = f"{d}/people/{ascii_slug(p['name'])}.jpg"
        if os.path.exists(out):
            continue
        ini = "".join(w[0] for w in re.sub(r"^(Dr|Prof)\.?\s+", "", p["name"]).split()[:2]).upper()
        run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0xE9E6DF:s=800x800", "-frames:v", "1", "-vf",
             f"drawtext=fontfile={FONT}/Inter-SemiBold.otf:text='{esc(ini)}':fontsize=300:fontcolor=0x{hexc}:x=(w-tw)/2:y=(h-th)/2", out])


def main():
    out_json = os.path.join(HERE, "..", "companies-full.json")
    existing = json.load(open(out_json))
    keep = [c for c in existing if c["n"] < 100]  # Capital Q (n=0)
    recs, jobs, render = [], [], []
    for i, c in enumerate(F):
        r = record(i, c)
        brand = PALETTE[i % len(PALETTE)]
        d = f"{ASSETS}/{r['n']:02d}-{ascii_slug(r['company'])}"
        os.makedirs(f"{d}/dataroom", exist_ok=True)
        with open(f"{WORK}/{r['n']}-deck.html", "w") as f:
            f.write(deck_html(r, brand))
        render.append({"html": f"{WORK}/{r['n']}-deck.html", "pdf": f"{d}/deck.pdf", "deck": True})
        for j, doc in enumerate(r["dataRoom"], 1):
            body = "<ul>" + "".join(f"<li>{html.escape(x)}</li>" for x in doc["summary"]) + "</ul>"
            body += f"<h2>About this document</h2><p>Prepared by {html.escape(r['legalName'])} for the Capital Q data room. The company and every figure are fictional.</p>"
            with open(f"{WORK}/{r['n']}-dr{j}.html", "w") as f:
                f.write(page(doc["title"], body, brand, r["company"]))
            render.append({"html": f"{WORK}/{r['n']}-dr{j}.html", "pdf": f"{d}/dataroom/{j:02d}.pdf"})
        with open(f"{d}/q-guide.md", "w") as f:
            f.write(f"# How Q speaks for {r['company']}\n\n" + "\n".join(f"- {g}" for g in r["qGuide"]) + "\n")
        images(r, brand, d)
        script = final_script(c)
        jobs.append({"slug": f"nf-{r['n']}-{c['key']}", "n": r["n"], "company": r["company"],
                     "founder": r["founderPerson"]["name"], "replica_id": c["replica"], "script": script})
        recs.append(r)
    json.dump(keep + recs, open(out_json, "w"), ensure_ascii=False, indent=2)
    json.dump(jobs, open(os.path.join(HERE, "..", "jobs-nf.json"), "w"), ensure_ascii=False, indent=1)
    json.dump(render, open(f"{WORK}/jobs.json", "w"), indent=1)
    print("records", len(recs), "jobs", len(jobs), "pdfs", len(render))
    print("words", sorted(len(j["script"].split()) for j in jobs))


main()
