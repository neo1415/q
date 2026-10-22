"""Write the HTML sources for Capital Q's demonstration PDFs.

Every page carries the demonstration footer; legal documents are
summaries, never facsimiles (no seals, signatures, stamps or registry
marks). Figures match supabase/seed-assets/demo-companies/companies.json
and the financial model built by build_xlsx.py.
Run: python3 scripts/seed/capital-q-documents/build_html.py <html_dir>
"""

import sys
from html import escape
from pathlib import Path

WATERMARK = (
    "DEMONSTRATION DOCUMENT — illustrative, prepared for the Capital Q product "
    "demo. Not a legal or financial record."
)
INK, GOLD, CHAMPAGNE, IVORY, BRONZE = "#16140f", "#c9a227", "#e2b858", "#f4efe2", "#8a6a12"

BASE_CSS = f"""
@page {{ margin: 0; }}
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
html, body {{ font-family: 'Inter', sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
.page {{ position: relative; overflow: hidden; page-break-after: always; break-after: page; }}
.page:last-child {{ page-break-after: auto; break-after: auto; }}
.wm-foot {{ position: absolute; left: 0; right: 0; bottom: 0; text-align: center; font-weight: 600; letter-spacing: .01em; }}
.wm-diag {{ position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; }}
.wm-diag span {{ transform: rotate(-24deg); font-family: 'Inter Display'; font-weight: 800; white-space: nowrap; }}
"""

# ------------------------------------------------------------------ deck
DECK_CSS = BASE_CSS + f"""
.page {{ width: 1280px; height: 720px; background: {INK}; color: {IVORY}; padding: 64px 80px 0; }}
.wm-foot {{ background: #0c0b08; color: {CHAMPAGNE}; font-size: 12px; padding: 9px 0; border-top: 1px solid {GOLD}55; }}
.wm-diag span {{ font-size: 150px; color: #ffffff07; }}
.kicker {{ color: {GOLD}; font-size: 15px; font-weight: 600; letter-spacing: .02em; margin-bottom: 14px; }}
h1 {{ font-family: 'Inter Display'; font-weight: 300; font-size: 50px; line-height: 1.08; letter-spacing: -.015em; max-width: 1020px; }}
h1 em {{ font-style: normal; color: {CHAMPAGNE}; font-weight: 400; }}
.lede {{ font-size: 19px; line-height: 1.5; color: #d8d1bf; max-width: 900px; margin-top: 18px; }}
.rule {{ width: 72px; height: 2px; background: {GOLD}; margin: 26px 0; }}
.grid {{ display: grid; gap: 22px; margin-top: 34px; }}
.g2 {{ grid-template-columns: 1fr 1fr; }} .g3 {{ grid-template-columns: repeat(3, 1fr); }} .g4 {{ grid-template-columns: repeat(4, 1fr); }} .g5 {{ grid-template-columns: repeat(5, 1fr); }}
.cell {{ border-top: 1px solid {GOLD}88; padding-top: 14px; }}
.cell h3 {{ font-size: 19px; font-weight: 600; color: #fff; margin-bottom: 8px; }}
.cell p, .cell li {{ font-size: 15px; line-height: 1.5; color: #cfc8b6; }}
.cell ul {{ list-style: none; }} .cell li {{ padding-left: 14px; position: relative; margin-bottom: 4px; }}
.cell li::before {{ content: ''; position: absolute; left: 0; top: 9px; width: 5px; height: 5px; background: {GOLD}; }}
.metric .v {{ font-family: 'Inter Display'; font-weight: 300; font-size: 44px; color: {CHAMPAGNE}; line-height: 1; }}
.metric .l {{ font-size: 14px; color: #cfc8b6; margin-top: 8px; line-height: 1.4; }}
.note {{ position: absolute; left: 80px; right: 80px; bottom: 50px; font-size: 12.5px; color: #a49c88; line-height: 1.45; }}
table {{ border-collapse: collapse; width: 100%; margin-top: 30px; font-size: 15px; }}
th, td {{ text-align: left; padding: 10px 12px; border-bottom: 1px solid #3a352a; }}
th {{ color: {GOLD}; font-weight: 600; font-size: 13.5px; }}
td {{ color: #d8d1bf; }} td.num, th.num {{ text-align: right; font-variant-numeric: tabular-nums; }}
tr.cq td {{ color: #fff; font-weight: 600; background: #ffffff08; }}
.step {{ display: flex; gap: 16px; margin-bottom: 15px; }}
.step b {{ font-family: 'Inter Display'; color: {GOLD}; font-size: 22px; font-weight: 400; width: 30px; flex: none; }}
.step div {{ font-size: 15.5px; line-height: 1.45; color: #d8d1bf; }} .step strong {{ color: #fff; }}
.bar {{ height: 12px; background: {GOLD}; margin: 8px 0 4px; }}
.cover {{ display: flex; flex-direction: column; justify-content: center; padding-bottom: 40px; }}
.wordmark {{ font-family: 'Inter Display'; font-weight: 600; font-size: 30px; letter-spacing: -.01em; }}
.wordmark i {{ font-style: normal; color: {GOLD}; }}
.big {{ font-family: 'Inter Display'; font-weight: 200; font-size: 92px; line-height: 1; letter-spacing: -.02em; margin-top: 30px; }}
.big em {{ font-style: normal; color: {CHAMPAGNE}; }}
.meta {{ font-size: 16px; color: #a49c88; margin-top: 30px; }}
.pg {{ position: absolute; right: 80px; top: 30px; font-size: 12px; color: #6f6857; }}
.tag {{ position: absolute; left: 80px; top: 30px; font-size: 12px; color: #6f6857; }}
"""


def deck_page(n, body, extra_cls=""):
    return (
        f'<section class="page {extra_cls}">'
        f'<div class="wm-diag"><span>DEMONSTRATION</span></div>'
        f'<div class="tag">Capital Q · Pre-seed · Q3 2026</div><div class="pg">{n:02d}</div>'
        f"{body}"
        f'<div class="wm-foot">{escape(WATERMARK)}</div></section>'
    )


def cells(items, cols):
    out = []
    for title, text in items:
        if isinstance(text, list):
            inner = "<ul>" + "".join(f"<li>{t}</li>" for t in text) + "</ul>"
        else:
            inner = f"<p>{text}</p>"
        out.append(f'<div class="cell"><h3>{title}</h3>{inner}</div>')
    return f'<div class="grid {cols}">' + "".join(out) + "</div>"


def metrics(items, cols):
    return (
        f'<div class="grid {cols}">'
        + "".join(f'<div class="cell metric"><div class="v">{v}</div><div class="l">{l}</div></div>' for v, l in items)
        + "</div>"
    )


SELF = "All figures are demonstration data, self-reported by the company, as of 30 September 2026. None is verified."


def deck():
    p = []
    p.append(
        deck_page(
            1,
            '<div class="cover" style="height:620px">'
            '<div class="wordmark">Capital <i>Q</i></div>'
            '<div class="big">Home of<br><em>Private Capital.</em></div>'
            '<p class="lede">Founders and investors meet on evidence, with Q, an AI investment analyst, doing the work in between.</p>'
            '<div class="meta">Pre-seed investor presentation · Q3 2026 · Lagos, Nigeria · capital-qweb-production.up.railway.app</div>'
            "</div>",
        )
    )
    p.append(
        deck_page(
            2,
            '<div class="kicker">The problem · both sides of the table</div>'
            "<h1>Private capital still runs on <em>inboxes, decks and silence.</em></h1>"
            + cells(
                [
                    (
                        "If you invest",
                        [
                            "Decks, introductions, referrals and applications pile up; the right deal does not announce itself.",
                            "Every meeting starts from scratch, while capital sits waiting.",
                            "Every bad investment costs you. So does every great one you never discover.",
                        ],
                    ),
                    (
                        "If you are raising",
                        [
                            "Search, pitch, fly, rewrite, follow up — then silence.",
                            "Wrong stage, geography, cheque size or thesis, discovered too late.",
                            "Or not ready: weak governance, unclear numbers, strong traction told badly.",
                        ],
                    ),
                ],
                "g2",
            )
            + '<p class="note">Finding the right capital, from the right investor, at the right time is painfully inefficient — at first raise, Series B, a down round, or growth capital for an established business.</p>',
        )
    )
    p.append(
        deck_page(
            3,
            '<div class="kicker">The solution</div>'
            "<h1>One platform. Both sides. <em>One Q</em> doing the analyst work.</h1>"
            + cells(
                [
                    ("Q", "An AI investment analyst. Ask anything, compare businesses, interrogate assumptions, prepare for meetings — answered from evidence, with sources."),
                    ("Discover", "Investors set a mandate once and swipe a personalised, explainable feed of companies that fit."),
                    ("GateQ", "Inbound on autopilot: Q interviews, scores and ranks applications against the investor's thesis and criteria."),
                    ("Investability IQ", "What is ready, what is weak, why it matters, and what could be blocking the raise."),
                    ("Q Card", "One living private-capital identity: story, numbers, raise, intelligence and relationships."),
                ],
                "g5",
            )
            + '<p class="note">Every fact carries its source and how it is supported, so trust is earned before the first meeting.</p>',
        )
    )
    steps_inv = [
        ("Set the mandate", "thesis, stage, sectors, geography, cheque size, minimum criteria."),
        ("Discover", "an aligned feed, ranked deterministically and explained; swipe to match."),
        ("Ask Q", "interrogate the business; run the Interview Before the Interview."),
        ("Decide", "meetings become decisions, not introductions."),
    ]
    steps_fdr = [
        ("Upload what you have", "deck, model, data room; Q works first."),
        ("See what investors will see", "Investability IQ names gaps and blockers."),
        ("Fill the gaps", "confirm facts; unknown stays unknown, never guessed."),
        ("Match", "with investors you genuinely suit — not who could invest, who should."),
    ]

    def steps(items):
        return "".join(f'<div class="step"><b>{i + 1}</b><div><strong>{t}</strong> — {d}</div></div>' for i, (t, d) in enumerate(items))

    p.append(
        deck_page(
            4,
            '<div class="kicker">How it works</div><h1>Minutes, not months.</h1>'
            '<div class="grid g2" style="margin-top:40px">'
            f'<div class="cell"><h3>Investors</h3><div style="margin-top:14px">{steps(steps_inv)}</div></div>'
            f'<div class="cell"><h3>Businesses raising</h3><div style="margin-top:14px">{steps(steps_fdr)}</div></div>'
            "</div>",
        )
    )
    p.append(
        deck_page(
            5,
            '<div class="kicker">The behaviour change</div>'
            "<h1>Tomorrow, instead of “Send me your deck,” investors ask: <em>“What’s your Q Card?”</em></h1>"
            + cells(
                [
                    ("Discovery", "Better opportunities reach investors faster."),
                    ("Inbound", "GateQ plugs into a website, application page, accelerator or programme; every opportunity lands in one place."),
                    ("Readiness", "Businesses become more investment-ready before the first meeting."),
                    ("Relationships", "Bad fits disappear earlier; founders spend less time chasing, investors more time investing."),
                ],
                "g4",
            ),
        )
    )
    p.append(
        deck_page(
            6,
            '<div class="kicker">Market</div>'
            "<h1>Private capital has trillions of dollars. <em>What it does not have is a home.</em></h1>"
            + metrics(
                [
                    ("USD 1.2B", "Estimated annual spend on deal sourcing and diligence tools by African and emerging-market private capital (company ESTIMATE)."),
                    ("Both sides", "Investors pay for Discover, Q and GateQ; businesses raise better prepared."),
                    ("Every stage", "First raise, Series A to C, down rounds and growth capital for established businesses."),
                ],
                "g3",
            )
            + '<p class="note">Market size is the company’s own estimate (truth class ESTIMATE, self-reported), captured 30 September 2026. Beachhead: West and East Africa.</p>',
        )
    )
    p.append(
        deck_page(
            7,
            '<div class="kicker">Business model</div><h1>B2B SaaS for the people who allocate capital.</h1>'
            + cells(
                [
                    ("Investor-firm subscriptions", "Funds, angel syndicates and family offices subscribe to Discover and Q. Pilot ARPA USD 400 per firm per month (September 2026)."),
                    ("GateQ for inbound", "Funds, accelerators and investment programmes route applications through GateQ; expansion within accounts drives net revenue retention."),
                    ("Founders start with Q", "Upload what you already have and get useful intelligence first; no 17-page questionnaire."),
                    ("No pay-to-rank, ever", "Ranking is deterministic, explainable and never for sale. Trust is the product."),
                ],
                "g4",
            )
            + metrics([("78%", "Gross margin, Q3 2026"), ("61%", "Contribution margin, Q3 2026"), ("112%", "Net revenue retention, Q3 2026")], "g3")
            + f'<p class="note">{SELF}</p>',
        )
    )
    p.append(
        deck_page(
            8,
            '<div class="kicker">Traction</div><h1>Paid pilots, growing <em>60% in a quarter.</em></h1>'
            + metrics(
                [
                    ("USD 4,800", "Monthly recurring revenue, September 2026 (pilot subscriptions)"),
                    ("USD 57,600", "ARR run-rate, end of September 2026"),
                    ("12", "Investor firms paying for pilot subscriptions, September 2026"),
                    ("1,240", "Founders and investors active in September 2026"),
                ],
                "g4",
            )
            + metrics(
                [
                    ("+60%", "MRR growth June → September 2026 (USD 3,000 → USD 4,800)"),
                    ("78%", "Gross margin, Q3 2026"),
                    ("112%", "Net revenue retention across pilot accounts, Q3 2026"),
                    ("61%", "Contribution margin, Q3 2026"),
                ],
                "g4",
            )
            + f'<p class="note">{SELF}</p>',
        )
    )
    yes, part, no = "Yes", "Partial", "No"
    comp = [
        ("Capital Q", yes, yes, yes, yes, yes),
        ("Deal databases and directories", part, no, no, no, no),
        ("CRMs and spreadsheets", no, no, no, part, no),
        ("Fundraising marketplaces", part, part, no, no, part),
        ("Advisers and analysts (human)", yes, part, no, part, part),
    ]
    rows = "".join(
        f'<tr class="{"cq" if i == 0 else ""}"><td>{r[0]}</td>' + "".join(f"<td>{c}</td>" for c in r[1:]) + "</tr>"
        for i, r in enumerate(comp)
    )
    p.append(
        deck_page(
            9,
            '<div class="kicker">Competition</div><h1>Others hold lists. <em>Capital Q holds the evidence.</em></h1>'
            "<table><tr><th>Alternative</th><th>Serves both sides</th><th>Evidence with sources</th><th>Inbound triage (GateQ)</th>"
            "<th>Explainable matching</th><th>Readiness (Investability IQ)</th></tr>"
            f"{rows}</table>"
            '<p class="note">Category comparison is Capital Q’s own assessment, for illustration. “Partial” means the capability exists without evidence, explanation or both sides.</p>',
        )
    )
    p.append(
        deck_page(
            10,
            '<div class="kicker">Team</div><h1>Six people, building in Lagos.</h1>'
            + cells(
                [
                    ("David Nwankwo", "Founder &amp; CEO"),
                    ("Captain Zino Mario", "Co-founder"),
                    ("Daniel Oyeniyi", "Engineering"),
                    ("Adeyemi Odunyugbo", "Engineering"),
                ],
                "g4",
            )
            + '<p class="lede" style="margin-top:40px">Plus two colleagues across go-to-market and operations. Board: the two founders until the seed round; an advisory board is being formed.</p>'
            '<p class="note">Roles and titles only. Background lines are supplied by each person.</p>',
        )
    )
    fin = [
        ("Revenue", "37,916", "201,032", "617,302"),
        ("Gross margin", "78%", "78%", "78%"),
        ("Net burn", "121,201", "372,431", "425,346"),
        ("Exit ARR run-rate (December)", "85,944", "330,060", "865,724"),
        ("Paying investor firms (December)", "17", "59", "138"),
        ("Headcount (December)", "6", "12", "16"),
        ("Closing cash (December)", "98,799", "1,226,368", "801,022"),
    ]
    frows = "".join(f"<tr><td>{a}</td><td class='num'>{b}</td><td class='num'>{c}</td><td class='num'>{d}</td></tr>" for a, b, c, d in fin)
    p.append(
        deck_page(
            11,
            '<div class="kicker">Financial outlook · USD</div><h1>From pilots to <em>~USD 0.87M ARR</em> by end of 2028.</h1>'
            "<table><tr><th>Illustrative model</th><th class='num'>FY2026</th><th class='num'>FY2027</th><th class='num'>FY2028</th></tr>"
            f"{frows}</table>"
            '<p class="note">From the Capital Q financial model 2026–2028 (demonstration). Jan–Sep 2026 self-reported actuals; forecast thereafter. Assumes the SAFE is received in March 2027. September 2026: net burn USD 9,512 a month, cash USD 124,458, runway about 13 months.</p>',
        )
    )
    p.append(
        deck_page(
            12,
            '<div class="kicker">The raise</div><h1>Raising <em>USD 1,500,000</em> at pre-seed.</h1>'
            + metrics(
                [
                    ("USD 1.5M", "Target amount"),
                    ("SAFE", "Instrument (post-money valuation cap; terms on request)"),
                    ("Pre-seed", "Stage"),
                    ("31 Mar 2027", "Target close"),
                ],
                "g4",
            )
            + '<p class="lede" style="margin-top:40px">Runway beyond the end of 2028 on plan: about 27 months at Q4 2028 burn.</p>',
        )
    )
    uof = [
        ("Engineering", 45, "675,000", "Hire four engineers; Q, Discover and GateQ."),
        ("Investor network", 25, "375,000", "Grow the investor network across West and East Africa."),
        ("Verification and data rooms", 15, "225,000", "Complete Capital Q’s own verification and data-room partnerships."),
        ("Operations and reserve", 15, "225,000", "Legal, finance and runway reserve."),
    ]
    ubody = "".join(
        f'<div class="cell"><h3>{t}</h3><div class="bar" style="width:{pct * 2}%"></div>'
        f'<p><strong style="color:{CHAMPAGNE}">{pct}% · USD {amt}</strong><br>{d}</p></div>'
        for t, pct, amt, d in uof
    )
    p.append(
        deck_page(
            13,
            '<div class="kicker">Use of funds</div><h1>Where USD 1.5M goes.</h1>'
            f'<div class="grid g4">{ubody}</div>'
            '<p class="note">Allocation is illustrative and matches the stated use of funds: grow the investor network across West and East Africa, hire four engineers, and complete Capital Q’s own verification and data-room partnerships.</p>',
        )
    )
    p.append(
        deck_page(
            14,
            '<div class="cover" style="height:620px"><div class="kicker">Vision</div>'
            '<div class="big" style="font-size:80px">The <em>Home of</em><br><em>Private Capital.</em></div>'
            '<p class="lede">Discovery, inbound, intelligence, readiness, matching, data, relationships and execution — one platform, both sides. '
            "When the old way finally disappears, you will wonder how private capital ever did it without Q.</p></div>",
        )
    )
    p.append(
        deck_page(
            15,
            '<div class="cover" style="height:620px">'
            '<div class="wordmark">Capital <i>Q</i></div>'
            '<div class="big" style="font-size:64px">What’s your <em>Q Card?</em></div>'
            '<p class="lede">Capital Q’s own Q Card: capital-q-hq · capital-qweb-production.up.railway.app</p>'
            '<div class="meta">Data room: this deck, and the financial model 2026–2028 on request.</div>'
            "</div>",
        )
    )
    return f"<!doctype html><html><head><meta charset='utf-8'><title>Capital Q — Pitch deck Q3 2026 (DEMONSTRATION)</title><style>{DECK_CSS}</style></head><body>{''.join(p)}</body></html>"


# ------------------------------------------------------------- A4 docs
DOC_CSS = BASE_CSS + f"""
.page {{ background: #fbfaf7; color: {INK}; padding: 0 22mm; overflow: visible; }}
html, body {{ background: #fbfaf7; }}
/* Fixed elements repeat on every printed page; the footer watermark is
   also printed by the PDF footer template (print_pdfs.mjs). */
.wm-diag {{ position: fixed; }}
.wm-diag span {{ font-size: 72pt; color: #16140f08; }}
table, tr, h2, .keep {{ break-inside: avoid; }} h2 {{ break-after: avoid; }}
.banner {{ border: 1.2pt solid {BRONZE}; background: #f3ead2; padding: 3.5mm 5mm; font-size: 9.5pt; line-height: 1.45; margin-bottom: 9mm; }}
.banner b {{ color: {BRONZE}; }}
.brand {{ font-family: 'Inter Display'; font-weight: 600; font-size: 13pt; margin-bottom: 7mm; }}
.brand i {{ font-style: normal; color: {BRONZE}; }}
h1 {{ font-family: 'Inter Display'; font-weight: 400; font-size: 22pt; line-height: 1.15; }}
.sub {{ color: #6b6457; font-size: 10.5pt; margin: 2.5mm 0 8mm; }}
h2 {{ font-size: 11.5pt; font-weight: 600; margin: 5.5mm 0 2mm; color: {INK}; border-bottom: 0.8pt solid {GOLD}; padding-bottom: 1.5mm; }}
p, li {{ font-size: 10pt; line-height: 1.55; color: #2c2920; }}
ul {{ padding-left: 5mm; }} li {{ margin-bottom: 1.2mm; }}
table {{ border-collapse: collapse; width: 100%; font-size: 10pt; }}
td, th {{ padding: 1.7mm 2.5mm; border-bottom: 0.6pt solid #d9d1c1; text-align: left; vertical-align: top; }}
th {{ background: #f1ede4; font-weight: 600; }}
td:first-child {{ width: 38%; color: #4f4a40; }}
.ph {{ font-family: 'JetBrains Mono'; font-size: 9.2pt; background: #efebe2; padding: 0 1.2mm; }}
"""


def doc(title, sub, body):
    banner = (
        "<div class='banner'><b>SUMMARY FOR DEMONSTRATION ONLY.</b> This is an illustrative summary prepared for the "
        "Capital Q product demo. It is not the official instrument, not a certified copy, and not issued by or on behalf of "
        "any registry or authority. Placeholders such as <span class='ph'>RC-DEMO-000000</span> stand in for real identifiers. "
        "Nothing here is verification.</div>"
    )
    page = (
        "<section class='page'><div class='wm-diag'><span>DEMONSTRATION</span></div>"
        "<div class='brand'>Capital <i>Q</i></div>"
        f"<h1>{title}</h1><div class='sub'>{sub}</div>{banner}{body}</section>"
    )
    return f"<!doctype html><html><head><meta charset='utf-8'><title>{escape(title)} (DEMONSTRATION)</title><style>{DOC_CSS}</style></head><body>{page}</body></html>"


def table(rows):
    return "<table>" + "".join(f"<tr><td>{a}</td><td>{b}</td></tr>" for a, b in rows) + "</table>"


UNK = "Not stated — unknown (owner to supply)"


def incorporation():
    return doc(
        "Certificate of Incorporation — Summary",
        "Capital Q · illustrative summary of incorporation particulars · as of 30 September 2026",
        "<h2>Particulars (summary)</h2>"
        + table(
            [
                ("Company name", "Capital Q (registered legal name to be confirmed by the owner)"),
                ("Registration number", "<span class='ph'>RC-DEMO-000000</span> (placeholder)"),
                ("Company type", "Private company limited by shares (illustrative)"),
                ("Country of incorporation", "Nigeria"),
                ("Date of incorporation", UNK),
                ("Registered office", "Lagos, Nigeria (full address withheld in this summary)"),
                ("Principal activity", "AI-native investment intelligence platform for private capital (B2B SaaS)"),
                ("Website", "capital-qweb-production.up.railway.app"),
            ]
        )
        + "<h2>Share capital (summary, illustrative)</h2>"
        + table(
            [
                ("Issued ordinary shares", "9,000,000 (founders)"),
                ("Reserved for ESOP (unissued)", "1,000,000"),
                ("Instruments outstanding", "None. A pre-seed SAFE of USD 1,500,000 is proposed, not issued."),
            ]
        )
        + "<h2>Directors and founders (roles only)</h2>"
        + table([("David Nwankwo", "Founder &amp; CEO; director"), ("Captain Zino Mario", "Co-founder; director")])
        + "<div class='keep'><h2>What this summary is not</h2><ul>"
        "<li>It reproduces no seal, signature, stamp, registry mark or official layout.</li>"
        "<li>It does not evidence incorporation; the official certificate is available to an authorised investor on request in the data room.</li>"
        "<li>Unknown particulars stay unknown; none has been guessed.</li></ul></div>",
    )


def sha():
    return doc(
        "Shareholder Agreement — Summary",
        "Capital Q · illustrative summary of principal founder terms · as of 30 September 2026",
        "<h2>Parties</h2>"
        + table(
            [
                ("Founder", "David Nwankwo — Founder &amp; CEO"),
                ("Co-founder", "Captain Zino Mario — Co-founder"),
                ("Company", "Capital Q (<span class='ph'>RC-DEMO-000000</span>)"),
            ]
        )
        + "<h2>Principal terms (illustrative)</h2>"
        + table(
            [
                ("Shareholding", "Ordinary shares and a 1,000,000-share ESOP reserve, as in the Capital Q cap table (illustrative, owner to confirm)."),
                ("Founder vesting", "Illustrative: four years with a one-year cliff, monthly thereafter."),
                ("Board", "Both founders sit on the board until the seed round. See the board composition note."),
                ("Reserved matters", "Illustrative: new share issues, changes to share rights, sale of the company, annual budget and borrowing above an agreed limit require both founders’ consent."),
                ("Transfers", "Illustrative: pre-emption on transfer; drag-along and tag-along at a majority threshold to be agreed."),
                ("Leaver provisions", "Illustrative good-leaver / bad-leaver treatment of unvested shares."),
                ("Confidentiality and IP", "Founders assign product IP to the company and keep company information confidential."),
                ("Pre-seed SAFE", "Proposed USD 1,500,000 SAFE converts at the next priced round; investor rights then follow that round’s documents."),
                ("Governing law", "Nigeria (illustrative)"),
                ("Date of agreement", UNK),
            ]
        )
        + "<div class='keep'><h2>What this summary is not</h2><ul>"
        "<li>Not the executed agreement and not a substitute for it; no signature, seal or execution block is reproduced.</li>"
        "<li>Terms marked illustrative are placeholders for the product demo; the owner confirms the real terms.</li></ul></div>",
    )


def board():
    return doc(
        "Board Composition Note",
        "Capital Q · board and governance summary · as of 30 September 2026",
        "<h2>Current board</h2>"
        + table(
            [
                ("David Nwankwo", "Founder &amp; CEO · director"),
                ("Captain Zino Mario", "Co-founder · director"),
            ]
        )
        + "<p style='margin-top:4mm'>Two founders; board of two founders until the seed round; advisory board being formed.</p>"
        "<h2>Planned changes (illustrative)</h2><ul>"
        "<li><b>Pre-seed SAFE (USD 1,500,000):</b> no board seat; SAFE holders receive regular investor updates.</li>"
        "<li><b>Seed round:</b> board expected to expand to include an investor director and, later, an independent director.</li>"
        "<li><b>Advisory board:</b> being formed; members will be listed once they confirm.</li></ul>"
        "<h2>Governance practice (illustrative)</h2>"
        + table(
            [
                ("Board meetings", "Quarterly, with minutes kept"),
                ("Investor reporting", "Monthly KPI update: MRR, paying firms, burn, runway"),
                ("Financial controls", "Dual approval for payments above an agreed limit"),
                ("Company secretary", UNK),
            ]
        )
        + "<h2>Team (roles only)</h2>"
        + table(
            [
                ("Daniel Oyeniyi", "Engineering"),
                ("Adeyemi Odunyugbo", "Engineering"),
            ]
        ),
    )


if __name__ == "__main__":
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    (out / "pitch-deck.html").write_text(deck(), encoding="utf-8")
    (out / "capital-q-certificate-of-incorporation-summary.html").write_text(incorporation(), encoding="utf-8")
    (out / "capital-q-shareholder-agreement-summary.html").write_text(sha(), encoding="utf-8")
    (out / "capital-q-board-composition-note.html").write_text(board(), encoding="utf-8")
