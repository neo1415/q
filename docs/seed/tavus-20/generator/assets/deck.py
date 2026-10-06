"""12-section pitch decks (title + sections in companies-full order) -> deck.pdf.

Facts come only from companies-full.json. Sections listed in deckGaps are rendered
with their own (thin) text and nothing else: no charts or tiles are added to them.
"""
import json
import os

from common import (BRAND, FOOTER, WORK, cdir, companies, contrast, esc, font_css, mix, money)
from brand import logo_svg

TITLES = {
    "problem": "The problem", "solution": "Our solution", "value_proposition": "Why it matters",
    "market": "Market", "go_to_market": "Go-to-market", "business_model": "Business model",
    "traction": "Traction", "competition": "Competition", "financials": "Financials",
    "the_ask": "The ask", "founders": "Founders", "team": "Team",
}
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def plabel(p):
    y, m = p.split("-")
    return f"{MONTHS[int(m) - 1]} {y[2:]}"


def fmt(v, k):
    u, cur = k["unit"], k.get("currency", "USD")
    if v is None:
        return "—"
    if u == "money":
        return money(v, cur)
    if u == "money_billions":
        return money(v * 1e9, cur)
    if u == "money_millions":
        return money(v * 1e6, cur)
    if u == "count_millions":
        return f"{v:g}m"
    if u == "percent":
        return f"{v:g}%"
    if u == "count":
        return f"{v:,.0f}" if v >= 1000 or float(v).is_integer() else f"{v:g}"
    suffix = {"milliseconds": " ms", "tonnes": " t", "days": " days", "MWh_per_year": " MWh/yr", "GWh": " GWh",
              "cycles": " cycles", "hectares": " ha"}.get(u, "")
    return f"{v:,.0f}{suffix}" if float(v).is_integer() or v >= 100 else f"{v:g}{suffix}"


def bar_chart(points, k, col, acc, w=700, h=330):
    vals = [p["values"].get(k["code"]) for p in points]
    vmax = max(v for v in vals if v is not None) or 1
    n = len(vals)
    bw = (w - 20) / n
    out = [f'<svg width="{w}" height="{h + 40}" viewBox="0 0 {w} {h + 40}" xmlns="http://www.w3.org/2000/svg">']
    out.append(f'<line x1="0" y1="{h}" x2="{w}" y2="{h}" stroke="#00000033" stroke-width="1"/>')
    for i, (p, v) in enumerate(zip(points, vals)):
        x = 10 + i * bw + bw * 0.18
        if v is None:
            continue
        bh = (h - 44) * v / vmax
        c = acc if i == n - 1 else col
        out.append(f'<rect x="{x:.1f}" y="{h - bh:.1f}" width="{bw * 0.64:.1f}" height="{bh:.1f}" rx="3" fill="{c}"/>')
        out.append(f'<text x="{x + bw * 0.32:.1f}" y="{h - bh - 10:.1f}" text-anchor="middle" class="cv">{esc(fmt(v, k))}</text>')
        out.append(f'<text x="{x + bw * 0.32:.1f}" y="{h + 26}" text-anchor="middle" class="cl">{plabel(p["period"])}</text>')
    out.append("</svg>")
    return "".join(out)


def spark(points, k, col, w=150, h=40):
    vals = [p["values"].get(k["code"]) for p in points]
    vs = [v for v in vals if v is not None]
    lo, hi = min(vs), max(vs)
    rng = (hi - lo) or 1
    pts = " ".join(f"{i * w / (len(vals) - 1):.1f},{h - 4 - (v - lo) / rng * (h - 8):.1f}" for i, v in enumerate(vals) if v is not None)
    return f'<svg width="{w}" height="{h}"><polyline points="{pts}" fill="none" stroke="{col}" stroke-width="2.5" stroke-linejoin="round"/></svg>'


def css(c):
    b = c["brand"]
    cfg = BRAND[c["n"]]
    P, A, I = b["primary"], b["accent"], b["ink"]
    acc_txt = tprim(b) if contrast(P, "#FFFFFF") < 3 else (A if contrast(A, "#FFFFFF") >= 3 else P)
    chart_acc = A if contrast(A, "#FFFFFF") >= 1.6 else mix(A, I, 0.35)
    # dark slide accent must be legible on the ink background
    acc_dark = A if contrast(A, I) >= 3 else mix(A, "#FFFFFF", 0.5)
    tint = mix(P, "#FFFFFF", 0.94)
    fams = sorted({cfg["display"], cfg["body"], "Inter"})
    return f"""{font_css(fams)}
@page {{ size: 1280px 720px; margin: 0 }}
* {{ box-sizing: border-box; margin: 0; padding: 0 }}
html, body {{ background: #fff }}
body {{ font-family: '{cfg['body']}', 'Inter', sans-serif; color: {I}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
.slide {{ width: 1280px; height: 720px; position: relative; overflow: hidden; page-break-after: always; background: #fff; padding: 64px 80px 80px; }}
.slide.tint {{ background: {tint} }}
.slide.dark {{ background: {I}; color: #fff }}
.slide.brand {{ background: {P}; color: {'#fff' if contrast('#FFFFFF', P) >= 2 else I} }}
.disp {{ font-family: '{cfg['display']}', serif; font-weight: 600; letter-spacing: -0.01em }}
.kicker {{ font-size: 15px; font-weight: 600; color: {acc_txt}; margin-bottom: 14px; font-variant-numeric: tabular-nums }}
.dark .kicker {{ color: {acc_dark} }}
h2 {{ font-family: '{cfg['display']}', serif; font-weight: 600; font-size: 50px; line-height: 1.05; letter-spacing: -0.015em; margin-bottom: 34px }}
.lead {{ font-family: '{cfg['display']}', serif; font-size: 40px; line-height: 1.18; font-weight: 500; max-width: 1020px; letter-spacing: -0.01em }}
ul.b {{ list-style: none; max-width: 1000px }}
ul.b li {{ font-size: 25px; line-height: 1.38; padding: 12px 0 12px 30px; position: relative; border-top: 1px solid {mix(I, '#FFFFFF', 0.86)} }}
ul.b li:first-child {{ border-top: 0 }}
ul.b li::before {{ content: ''; position: absolute; left: 0; top: 26px; width: 12px; height: 4px; background: {P} }}
.dark ul.b li {{ border-color: #ffffff22 }}
.dark ul.b li::before {{ background: {acc_dark} }}
ul.b.sm li {{ font-size: 21px; padding: 9px 0 9px 26px }}
ul.b.sm li::before {{ top: 21px }}
.foot {{ position: absolute; left: 80px; right: 80px; bottom: 30px; display: flex; justify-content: space-between; font-size: 13px; color: {mix(I, '#FFFFFF', 0.45)} }}
.dark .foot, .brand .foot {{ color: #ffffffaa }}
.logo {{ position: absolute; right: 80px; top: 58px; height: 34px }}
.logo svg {{ height: 34px; width: auto }}
.row {{ display: flex; gap: 48px }}
.cols3 {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 44px; margin-top: 18px }}
.cols3 .c {{ border-top: 4px solid {P}; padding-top: 22px; font-size: 24px; line-height: 1.38 }}
.cols3 .c .n {{ font-family: '{cfg['display']}'; font-size: 44px; color: {acc_txt}; margin-bottom: 10px }}
.tiles {{ display: grid; gap: 18px }}
.tile {{ border-left: 4px solid {P}; padding: 6px 0 6px 18px }}
.tile .v {{ font-family: '{cfg['display']}'; font-size: 36px; font-weight: 600; line-height: 1.1; font-variant-numeric: tabular-nums }}
.tile .l {{ font-size: 15px; color: {mix(I, '#FFFFFF', 0.35)}; margin-top: 4px; line-height: 1.3 }}
.cv {{ font: 600 14px '{cfg['body']}', Inter; fill: {I} }}
.cl {{ font: 400 13px '{cfg['body']}', Inter; fill: {mix(I, '#FFFFFF', 0.4)} }}
.note {{ font-size: 13px; color: {mix(I, '#FFFFFF', 0.4)}; line-height: 1.4; max-width: 1000px }}
.mkt {{ display: flex; flex-direction: column; gap: 14px; max-width: 1040px }}
.mkt .m {{ display: grid; grid-template-columns: 120px 1fr; align-items: baseline; padding: 14px 0; border-top: 1px solid {mix(I, '#FFFFFF', 0.86)} }}
.mkt .m .t {{ font-family: '{cfg['display']}'; font-size: 34px; color: {acc_txt}; font-weight: 600 }}
.mkt .m .x {{ font-size: 23px; line-height: 1.38 }}
.uof .u {{ display: grid; grid-template-columns: 1fr 70px; gap: 12px; align-items: center; margin-bottom: 14px }}
.uof .lbl {{ font-size: 17px; margin-bottom: 6px; line-height: 1.3 }}
.uof .bar {{ height: 12px; background: {mix(P, '#FFFFFF', 0.85)}; border-radius: 6px }}
.uof .bar i {{ display: block; height: 12px; border-radius: 6px; background: {P} }}
.uof .pc {{ font-family: '{cfg['display']}'; font-size: 24px; text-align: right; font-variant-numeric: tabular-nums }}
.ppl {{ display: grid; gap: 30px }}
.ppl img {{ width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 6px; display: block; margin-bottom: 14px }}
.ppl .nm {{ font-weight: 600; font-size: 20px }}
.ppl .rl {{ font-size: 16px; color: {mix(I, '#FFFFFF', 0.35)}; margin-top: 2px }}
.ppl .bio {{ font-size: 15px; line-height: 1.4; margin-top: 8px; color: {mix(I, '#FFFFFF', 0.2)} }}
.chartacc {{ color: {chart_acc} }}
"""


def foot(c, i):
    return f'<div class="foot"><span>{esc(FOOTER)}</span><span>{esc(c["company"])} · {i:02d}</span></div>'


def tprim(b):
    """Brand colour that is legible as text on white."""
    for col in (b["primary"], b["accent"]):
        if contrast(col, "#FFFFFF") >= 3:
            return col
    return b["ink"]


def slide(c, i, sec, content, gap, logo, people):
    b = c["brand"]
    P, A, I = b["primary"], b["accent"], b["ink"]
    TP = tprim(b)
    chart_acc = A if contrast(A, "#FFFFFF") >= 1.6 else mix(A, I, 0.35)
    title = TITLES[sec]
    kick = f'<div class="kicker">{i:02d} — {esc(title)}</div>'
    cls = "slide"
    lst = lambda items, sm=False: f'<ul class="b{" sm" if sm else ""}">' + "".join(f"<li>{esc(x)}</li>" for x in items) + "</ul>"
    body = ""
    if gap:
        body = kick + f"<h2>{esc(title)}</h2>" + lst(content)
    elif sec == "problem":
        cls += " dark"
        body = kick + f'<p class="lead" style="margin:26px 0 40px">{esc(content[0])}</p>' + lst(content[1:])
    elif sec == "solution":
        body = kick + f'<p class="lead" style="margin:26px 0 40px;color:{TP}">{esc(content[0])}</p>' + lst(content[1:])
    elif sec == "value_proposition" and len(content) == 3:
        body = kick + f"<h2>{esc(title)}</h2>" + '<div class="cols3">' + "".join(
            f'<div class="c"><div class="n">{k + 1:02d}</div>{esc(x)}</div>' for k, x in enumerate(content)) + "</div>"
    elif sec == "market" and any(x.split(":")[0] in ("TAM", "SAM", "SOM") for x in content):
        rows, rest = [], []
        for x in content:
            for seg in [s.strip() for s in x.replace(". SOM:", ".|SOM:").replace(". SAM:", ".|SAM:").split("|")]:
                h = seg.split(":")[0]
                if h in ("TAM", "SAM", "SOM"):
                    rows.append((h, seg.split(":", 1)[1].strip()))
                else:
                    rest.append(seg)
        body = kick + f"<h2>{esc(title)}</h2>" + '<div class="mkt">' + "".join(
            f'<div class="m"><div class="t">{h}</div><div class="x">{esc(t)}</div></div>' for h, t in rows) + "</div>"
        if rest:
            body += f'<p class="note" style="margin-top:22px;font-size:17px">{esc(" ".join(rest))}</p>'
    elif sec == "traction":
        cls += " tint"
        m = c["metrics"]
        k0 = m["kpis"][0]
        tiles = ""
        for k in m["kpis"][1:4]:
            v = m["points"][-1]["values"].get(k["code"])
            tiles += f'<div class="tile"><div class="v">{esc(fmt(v, k))}</div><div class="l">{esc(k["label"])}</div>{spark(m["points"], k, P)}</div>'
        body = (kick + f"<h2 style='margin-bottom:18px'>{esc(title)}</h2>" + '<div class="row">'
                f'<div style="width:560px">{lst(content, True)}</div>'
                f'<div><div style="font-weight:600;font-size:16px;margin-bottom:8px">{esc(k0["label"])}</div>'
                f'{bar_chart(m["points"], k0, P, chart_acc, 520, 200)}<div class="tiles" style="grid-template-columns:repeat(3,1fr);margin-top:6px">{tiles}</div></div></div>'
                f'<p class="note" style="position:absolute;bottom:58px;left:80px;right:80px">Source: company-reported metrics, Oct 2025 to Sep 2026. {esc(m.get("note", ""))}</p>')
    elif sec == "financials":
        cap = c["capital"]
        t = []
        if cap.get("cashPosition"):
            t.append((money(cap["cashPosition"]["amount"], cap["cashPosition"]["currency"]), f"Cash at {cap['cashPosition']['asOf']}"))
        if cap.get("monthlyNetBurn"):
            t.append((money(cap["monthlyNetBurn"]["amount"], cap["monthlyNetBurn"]["currency"]), "Monthly net burn, now"))
        if cap.get("runwayMonthsCurrent") is not None:
            t.append((f"{cap['runwayMonthsCurrent']:g} months", "Runway at current burn"))
        if cap.get("plannedMonthlyNetBurnPostRaise"):
            t.append((money(cap["plannedMonthlyNetBurnPostRaise"]["amount"], cap["plannedMonthlyNetBurnPostRaise"]["currency"]), "Planned monthly net burn after the raise"))
        if cap.get("runwayMonthsPostRaise") is not None:
            t.append((f"{cap['runwayMonthsPostRaise']:g} months", "Runway after the raise"))
        tiles = "".join(f'<div class="tile"><div class="v">{esc(v)}</div><div class="l">{esc(l)}</div></div>' for v, l in t)
        body = kick + f"<h2>{esc(title)}</h2>" + f'<div class="row"><div style="flex:1">{lst(content, True)}</div>' \
                      f'<div class="tiles" style="width:330px;align-content:start">{tiles}</div></div>'
    elif sec == "the_ask":
        cap = c["capital"]
        tr = cap["targetRaise"]
        facts = [cap.get("instrument")]
        if cap.get("valuationCap"):
            facts.append(f"Valuation cap {money(cap['valuationCap']['amount'], cap['valuationCap']['currency'])}")
        if cap.get("preMoneyValuation"):
            facts.append(f"Pre-money {money(cap['preMoneyValuation']['amount'], cap['preMoneyValuation']['currency'])}")
        if cap.get("minimumCheque"):
            facts.append(f"Minimum cheque {money(cap['minimumCheque']['amount'], cap['minimumCheque']['currency'])}")
        if cap.get("targetCloseDate"):
            facts.append(f"Target close {cap['targetCloseDate']}")
        uof = "".join(f'<div class="u"><div><div class="lbl">{esc(u["line"])}</div><div class="bar"><i style="width:{u["percent"]}%"></i></div></div><div class="pc">{u["percent"]}%</div></div>'
                      for u in cap.get("useOfFunds", []))
        cls += " tint"
        body = (kick + '<div class="row" style="gap:70px">'
                f'<div style="width:470px"><div class="disp" style="font-size:96px;line-height:1;color:{TP};margin:10px 0 18px">{esc(money(tr["amount"], tr["currency"]))}</div>'
                f'<div style="font-size:20px;line-height:1.6">{"<br>".join(esc(f) for f in facts if f)}</div>'
                f'<div style="margin-top:26px">{lst(content, True)}</div></div>'
                f'<div class="uof" style="flex:1;padding-top:20px"><div style="font-weight:600;font-size:16px;margin-bottom:18px">Use of funds</div>{uof}</div></div>')
    elif sec == "founders":
        fp = people[0]
        body = kick + f"<h2>{esc(title)}</h2>" + f'<div class="row"><div style="width:250px" class="ppl"><div><img src="file://{fp["path"]}">' \
                      f'<div class="nm">{esc(fp["name"])}</div><div class="rl">{esc(fp["role"])}</div></div></div>' \
                      f'<div style="flex:1">{lst(content)}</div></div>'
    elif sec == "team":
        team = people[1:]
        n = len(team)
        grid = "".join(f'<div><img src="file://{p["path"]}"><div class="nm">{esc(p["name"])}</div><div class="rl">{esc(p["role"])}</div></div>' for p in team)
        body = kick + f"<h2 style='margin-bottom:22px'>{esc(title)}</h2>" + f'<div class="row"><div style="flex:1">{lst(content, True)}</div>' \
                      f'<div class="ppl" style="width:{170 * n + 30 * (n - 1)}px;grid-template-columns:repeat({n},1fr)">{grid}</div></div>'
    else:
        body = kick + f"<h2>{esc(title)}</h2>" + lst(content)
    lg = logo[1] if "dark" in cls else logo[0]
    return f'<section class="{cls}"><div class="logo">{lg}</div>{body}{foot(c, i)}</section>'


def title_slide(c, logo_rev):
    b = c["brand"]
    cap = c["capital"]
    tr = cap["targetRaise"]
    stage = c["currentStageCode"].replace("_", " ").capitalize()
    if stage.startswith("Series "):
        stage = stage[:-1] + stage[-1].upper()
    return (f'<section class="slide brand" style="padding:80px">'
            f'<div style="height:120px">{logo_rev}</div>'
            f'<p class="disp" style="font-size:54px;line-height:1.1;max-width:980px;margin-top:150px;letter-spacing:-0.02em">{esc(c["planFacts"]["oneLiner"])}</p>'
            f'<p style="font-size:22px;margin-top:30px;opacity:.85">{esc(c["headquarters"]["city"])} · {esc(stage)} · Raising {esc(money(tr["amount"], tr["currency"]))} · Investor presentation, October 2026</p>'
            f'<div class="foot"><span>{esc(FOOTER)}</span><span>{esc(c["legalName"])}</span></div></section>')


def build():
    jobs = []
    for c in companies():
        d = cdir(c)
        man = json.load(open(f"{d}/people/manifest.json"))
        people = [dict(p, path=f"{d}/people/{p['file']}") for p in man["people"]]
        lsvg = logo_svg(c)[0].replace("<svg ", '<svg style="height:34px;width:auto" ', 1)
        lrev = logo_svg(c, True)[0].replace("<svg ", '<svg style="height:34px;width:auto" ', 1)
        trev = logo_svg(c, True)[0].replace("<svg ", '<svg style="height:96px;width:auto" ', 1)
        if c["n"] == 19:  # slate bubble vanishes on the ink slide: yellow bubble, white word
            lrev = logo_svg(c, False, word_override="#FFFFFF")[0].replace("<svg ", '<svg style="height:34px;width:auto" ', 1)
        gaps = {g["section"] for g in c["deckGaps"]}
        slides = [title_slide(c, trev)]
        for i, s in enumerate(c["deck"], 1):
            slides.append(slide(c, i, s["section"], s["content"], s["section"] in gaps, (lsvg, lrev), people))
        html = f'<!doctype html><html><head><meta charset="utf-8"><title>{esc(c["company"])} deck</title><style>{css(c)}</style></head><body>{"".join(slides)}</body></html>'
        src = f"{WORK}/deck-{c['n']:02d}.html"
        open(src, "w").write(html)
        jobs.append(dict(src=src, out=f"{d}/deck.pdf", w=1280, h=720, kind="pdf", pw="1280px", ph="720px"))
        jobs.append(dict(src=src, out=f"{WORK}/deckshot-{c['n']:02d}.png", w=1280, h=720 * 13, kind="png"))
    json.dump(jobs, open(f"{WORK}/jobs-deck.json", "w"))
    print(len(jobs), "deck jobs")


if __name__ == "__main__":
    build()
