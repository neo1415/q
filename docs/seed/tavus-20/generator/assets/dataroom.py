"""Data room PDFs: one plausible 1-3 page document per dataRoom entry, built only
from that entry's summary (plus company profile facts and metrics). Every page
carries the FICTIONAL watermark (position:fixed repeats on each printed page)."""
import json
import re

from brand import logo_svg
from common import BRAND, FOOTER, WATERMARK, WORK, cdir, companies, esc, font_css, mix
from deck import fmt, plabel

COUNTRY = {"NG": "Nigeria", "GB": "United Kingdom", "US": "United States", "IN": "India", "KE": "Kenya", "BR": "Brazil",
           "DE": "Germany", "VN": "Vietnam", "MX": "Mexico", "EG": "Egypt", "ZA": "South Africa", "FR": "France"}
FOLDER = {"incorporation": "Corporate", "legal_ip": "Legal & IP", "financials": "Financials", "contracts": "Contracts",
          "cap_table": "Cap table", "tax": "Tax", "team": "Team", "kyc_kyb": "KYC / KYB"}
VIS = {"PUBLIC": "Public", "SHARED_ONLY": "Shared with approved investors", "PRIVATE": "Private", "ON_REQUEST": "On request"}


def css(c):
    b = c["brand"]
    cfg = BRAND[c["n"]]
    P, I = b["primary"], b["ink"]
    return f"""{font_css(sorted({cfg['display'], cfg['body'], 'Inter', 'IBMPlexMono'}))}
@page {{ size: A4; margin: 22mm 20mm 24mm }}
* {{ box-sizing: border-box }}
body {{ font-family: '{cfg['body']}', Inter, sans-serif; color: #1d1d1f; font-size: 10.5pt; line-height: 1.5; margin: 0;
  -webkit-print-color-adjust: exact; print-color-adjust: exact }}
.wm {{ position: fixed; top: 40%; left: -10%; width: 120%; text-align: center; transform: rotate(-32deg);
  font: 700 34pt Inter, sans-serif; white-space: nowrap; color: rgba(200, 30, 30, 0.13); letter-spacing: 0.06em; z-index: 10; pointer-events: none }}
.ft {{ position: fixed; bottom: -14mm; left: 0; right: 0; font-size: 7.5pt; color: #888; display: flex; justify-content: space-between;
  border-top: 0.5pt solid #ddd; padding-top: 2mm }}
.lh {{ display: flex; justify-content: space-between; align-items: center; border-bottom: 2pt solid {P}; padding-bottom: 4mm; margin-bottom: 8mm }}
.lh svg {{ height: 13mm; width: auto }}
.lh .addr {{ text-align: right; font-size: 8pt; color: #555; line-height: 1.45 }}
h1 {{ font-family: '{cfg['display']}', serif; font-weight: 600; font-size: 20pt; line-height: 1.15; margin: 0 0 3mm; color: {I} }}
h3 {{ font-size: 10.5pt; margin: 7mm 0 2mm; color: {P}; font-weight: 700 }}
.meta {{ display: grid; grid-template-columns: 34mm 1fr; gap: 1mm 4mm; font-size: 9pt; color: #444; margin-bottom: 7mm }}
.meta b {{ color: #111; font-weight: 600 }}
ol.cl {{ padding-left: 6mm }} ol.cl li {{ margin: 0 0 2.5mm; padding-left: 1mm }}
table {{ border-collapse: collapse; width: 100%; font-size: 9.5pt; margin: 2mm 0 4mm; font-variant-numeric: tabular-nums }}
th {{ text-align: left; font-weight: 600; border-bottom: 1pt solid {I}; padding: 2mm 2mm 1.5mm; background: {mix(P, '#FFFFFF', 0.92)} }}
td {{ border-bottom: 0.5pt solid #ddd; padding: 1.8mm 2mm }}
td.r, th.r {{ text-align: right }}
.cert {{ border: 1.4pt solid {P}; outline: 0.5pt solid {P}; outline-offset: 2.2mm; padding: 14mm 14mm 12mm; margin: 6mm 3mm; text-align: center; min-height: 180mm }}
.cert .auth {{ font-size: 9pt; letter-spacing: 0.04em; color: #555 }}
.cert h1 {{ font-size: 24pt; margin: 6mm 0 8mm }}
.cert .co {{ font-family: '{cfg['display']}', serif; font-size: 18pt; margin: 4mm 0 8mm; color: {I} }}
.cert p {{ max-width: 135mm; margin: 0 auto 3.5mm }}
.seal {{ width: 30mm; height: 30mm; border-radius: 50%; border: 1.2pt dashed {P}; margin: 10mm auto 0; display: flex; align-items: center;
  justify-content: center; font-size: 7pt; color: {P}; text-align: center; line-height: 1.3; padding: 3mm }}
.bar {{ display: flex; height: 6mm; border-radius: 1mm; overflow: hidden; margin: 2mm 0 5mm }}
.note {{ font-size: 8.5pt; color: #666 }}
.sig {{ margin-top: 14mm; display: flex; gap: 20mm; font-size: 9pt }}
.sig div {{ border-top: 0.6pt solid #999; padding-top: 2mm; width: 60mm }}
"""


def letterhead(c):
    hq = c["headquarters"]
    lg = logo_svg(c)[0]
    return (f'<div class="lh">{lg}<div class="addr"><b>{esc(c["legalName"])}</b><br>{esc(hq["city"])}, {esc(COUNTRY.get(hq["country"], hq["country"]))}'
            f'<br>{esc(c["websiteUrl"].replace("https://", ""))}</div></div>')


def meta(c, doc):
    return (f'<div class="meta"><span>Data room folder</span><b>{esc(FOLDER.get(doc["folder"], doc["folder"]))}</b>'
            f'<span>Visibility</span><b>{esc(VIS.get(doc["visibility"], doc["visibility"]))}</b>'
            f'<span>Company</span><b>{esc(c["legalName"])}</b></div>')


def clauses(items):
    return '<ol class="cl">' + "".join(f"<li>{esc(x)}</li>" for x in items) + "</ol>"


def body_for(c, doc):
    t, f, s = doc["title"], doc["folder"], doc["summary"]
    tl = t.lower()
    if "certificate" in tl and f in ("incorporation", "tax"):
        auth = s[0].split(" to ")[0].replace("Issued by ", "") if s[0].startswith("Issued by") else ""
        auth = auth[:1].upper() + auth[1:]
        return (f'<div class="cert"><div class="auth">{esc(auth) if auth else "Certified copy"}</div><h1>{esc(t)}</h1>'
                f'<div>This is to certify that</div><div class="co">{esc(c["legalName"])}</div>' +
                "".join(f"<p>{esc(x)}</p>" for x in s) +
                '<div class="seal">Certified true copy<br>(specimen)</div></div>')
    if f == "cap_table":
        rows, notes = [], []
        for x in s:
            m = re.match(r"^(.*?):\s*([\d.]+)%(.*)$", x)
            if m:
                rows.append((m.group(1).strip(), float(m.group(2)), m.group(3).strip()))
            else:
                notes.append(x)
        b = c["brand"]
        cols = [b["primary"], b["accent"], mix(b["primary"], "#FFFFFF", 0.45), b["ink"], mix(b["accent"], "#FFFFFF", 0.45), "#9AA0A6", "#C9CCD1", "#6B7075"]
        bar = '<div class="bar">' + "".join(f'<i style="width:{p}%;background:{cols[k % len(cols)]}"></i>' for k, (_, p, _) in enumerate(rows)) + "</div>"
        tbl = "<table><tr><th></th><th>Holder</th><th class='r'>Fully diluted</th><th>Note</th></tr>" + "".join(
            f"<tr><td style='width:6mm'><span style='display:inline-block;width:3mm;height:3mm;background:{cols[k % len(cols)]}'></span></td>"
            f"<td>{esc(n)}</td><td class='r'>{p:g}%</td><td>{esc(nt)}</td></tr>" for k, (n, p, nt) in enumerate(rows))
        tot = sum(p for _, p, _ in rows)
        tbl += f"<tr><td></td><td><b>Total</b></td><td class='r'><b>{tot:g}%</b></td><td></td></tr></table>"
        return "<h3>Summary of holdings</h3>" + bar + tbl + (("<h3>Notes</h3>" + clauses(notes)) if notes else "")
    if f == "financials" and "management accounts" in tl:
        m = c["metrics"]
        ks = m["kpis"]
        head = "<tr><th>Period end</th>" + "".join(f"<th class='r'>{esc(k['label'])}</th>" for k in ks) + "</tr>"
        rows = "".join("<tr><td>" + plabel(p["period"]) + "</td>" + "".join(f"<td class='r'>{esc(fmt(p['values'].get(k['code']), k))}</td>" for k in ks) + "</tr>" for p in m["points"])
        return ("<h3>Summary</h3>" + clauses(s) +
                "<h3>Schedule A — operating metrics by period (company-reported)</h3>"
                f"<table>{head}{rows}</table><p class='note'>{esc(m.get('note', ''))}</p>"
                "<p class='note'>Full monthly P&amp;L, balance sheet and cash-flow statements are held in the source workbook; this cover summary reproduces only the headline figures.</p>")
    if "minutes" in tl:
        return ("<h3>Minutes of a meeting of the board of directors</h3>"
                f"<p>Meeting of the board of {esc(c['legalName'])}. The following matters were approved or noted:</p>" + clauses(s) +
                '<div class="sig"><div>Chair</div><div>Company secretary</div></div>')
    if f == "kyc_kyb":
        return ("<h3>Contents of this pack</h3><table><tr><th>#</th><th>Document</th><th>Status</th></tr>" +
                "".join(f"<tr><td>{k + 1}</td><td>{esc(x)}</td><td>Included</td></tr>" for k, x in enumerate(s)) + "</table>"
                "<p class='note'>Copies of identity documents are redacted in this demo data room.</p>")
    if f == "contracts":
        return ("<h3>Key terms</h3><table><tr><th style='width:12mm'>Item</th><th>Term</th></tr>" +
                "".join(f"<tr><td>{k + 1}</td><td>{esc(x)}</td></tr>" for k, x in enumerate(s)) + "</table>"
                "<p class='note'>Summary prepared by the company for investor review. The signed agreement governs in case of any difference.</p>")
    if f == "team" and ("option" in tl or "esop" in tl):
        return ("<h3>Plan summary</h3>" + clauses(s) + '<div class="sig"><div>Approved by the board</div><div>Plan administrator</div></div>')
    if f == "legal_ip" and ("assignment" in tl or "deed" in tl):
        return ("<h3>Recitals and schedule</h3>" + clauses(s) + '<div class="sig"><div>Assignor</div><div>For and on behalf of the company</div></div>')
    return "<h3>Summary</h3>" + clauses(s)


def build():
    jobs = []
    for c in companies():
        d = cdir(c) + "/dataroom"
        import os
        os.makedirs(d, exist_ok=True)
        for k, doc in enumerate(c["dataRoom"], 1):
            slug = re.sub(r"[^a-z0-9]+", "-", doc["title"].lower()).strip("-")[:60].strip("-")
            cert = "certificate" in doc["title"].lower() and doc["folder"] in ("incorporation", "tax")
            html = (f'<!doctype html><html><head><meta charset="utf-8"><title>{esc(doc["title"])}</title><style>{css(c)}</style></head><body>'
                    f'<div class="wm">{esc(WATERMARK)}</div>'
                    f'{letterhead(c)}' + ("" if cert else f'<h1>{esc(doc["title"])}</h1>{meta(c, doc)}') +
                    f'{body_for(c, doc)}</body></html>')
            src = f"{WORK}/dr-{c['n']:02d}-{k:02d}.html"
            open(src, "w").write(html)
            jobs.append(dict(src=src, out=f"{d}/{k:02d}-{slug}.pdf", w=794, h=1123, kind="pdf", pw="210mm", ph="297mm", css=True,
                             footer=('<div style="font-family:sans-serif;font-size:7px;color:#888;width:100%;padding:0 20mm;display:flex;justify-content:space-between">'
                                     f'<span>{esc(c["legalName"])} · {esc(doc["title"])} · {esc(FOOTER)}</span>'
                                     '<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>')))
    json.dump(jobs, open(f"{WORK}/jobs-dr.json", "w"))
    print(len(jobs), "data room jobs")


if __name__ == "__main__":
    build()
