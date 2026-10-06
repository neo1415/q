"""Helpers for building the tavus-20 seed dataset. Numbers are computed here so
that MRR/ARR, cumulative counters, use-of-funds and runway always reconcile."""
import calendar

PERIOD_IDX = [0, 2, 4, 6, 8, 9, 10, 11]  # months since 2025-10
MONTHS = ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03",
          "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]


def month_end(p):
    y, m = map(int, p.split("-"))
    return f"{p}-{calendar.monthrange(y, m)[1]:02d}"


def rnd(x, dec):
    return int(round(x)) if dec == 0 else round(x, dec)


def geo12(start, end):
    return [start * (end / start) ** (i / 11) for i in range(12)]


def geo(start, end, dec=0):
    s = geo12(start, end)
    return [rnd(s[i], dec) for i in PERIOD_IDX]


def cum_from_monthly(m_start, m_end, cum_end):
    """Monthly flow series plus a cumulative series that lands exactly on cum_end."""
    m = [round(v) for v in geo12(m_start, m_end)]
    cum = []
    for i in range(12):
        cum.append(cum_end - sum(m[i + 1:]))
    return [m[i] for i in PERIOD_IDX], [cum[i] for i in PERIOD_IDX]


def metrics(kpis, values, note=None):
    """kpis: list of (code, label, unit, currency|None). values: {code: [8 values]}."""
    pts = []
    for j, i in enumerate(PERIOD_IDX):
        p = MONTHS[i]
        pts.append({"period": p, "asOf": month_end(p),
                    "values": {k[0]: values[k[0]][j] for k in kpis}})
    out = {"kpis": [dict(code=c, label=l, unit=u, **({"currency": cur} if cur else {}))
                    for c, l, u, cur in kpis],
           "points": pts}
    if note:
        out["note"] = note
    return out


def use_of_funds(total, ccy, lines):
    assert sum(p for _, p in lines) == 100, lines
    return [{"line": t, "percent": p, "amount": round(total * p / 100), "currency": ccy}
            for t, p in lines]


def capital(raise_amt, ccy, instrument, valuation_kind, valuation, close, min_cheque,
            uof, prev_rounds, investors, cash, burn_now, burn_post, extra=None):
    runway_now = round(cash / burn_now, 1)
    runway_post = round((cash + raise_amt) / burn_post, 1)
    c = {
        "targetRaise": {"amount": raise_amt, "currency": ccy},
        "instrument": instrument,
        valuation_kind: {"amount": valuation, "currency": ccy},
        "targetCloseDate": close,
        "minimumCheque": {"amount": min_cheque, "currency": ccy},
        "useOfFunds": use_of_funds(raise_amt, ccy, uof),
        "previousRounds": prev_rounds,
        "existingInvestors": investors,
        "cashPosition": {"amount": cash, "currency": ccy, "asOf": "2026-09-30"},
        "monthlyNetBurn": {"amount": burn_now, "currency": ccy, "asOf": "2026-09-30"},
        "runwayMonthsCurrent": runway_now,
        "plannedMonthlyNetBurnPostRaise": {"amount": burn_post, "currency": ccy},
        "runwayMonthsPostRaise": runway_post,
    }
    if extra:
        c.update(extra)
    return c


def rounds(*rs):
    return [dict(round=r, date=d, amount=a, currency=c, instrument=i, lead=l)
            for r, d, a, c, i, l in rs]


def person(name, title, role, bio, nationality, gender):
    return dict(name=name, title=title, appRole=role, bio=bio,
                nationality=nationality, gender=gender)


def doc(title, folder, vis, lines):
    assert folder in {"incorporation", "kyc_kyb", "cap_table", "financials", "tax",
                      "legal_ip", "contracts", "team"}
    assert vis in {"PUBLIC", "ON_REQUEST", "SHARED_ONLY", "PRIVATE"}
    assert 3 <= len(lines) <= 6, title
    return dict(title=title, folder=folder, visibility=vis, summary=lines)


def standard_room(legal, reg_body, reg_no, inc_date, cap, esop_pct, esop_vest,
                  mgmt_lines, tax_title, tax_lines, ip_lines, contract, minutes,
                  kyc, extras):
    """Builds the eight required documents plus KYB and company-specific extras."""
    assert abs(sum(p for _, p in cap) - 100) < 0.01, cap
    room = [
        doc("Certificate of Incorporation", "incorporation", "PUBLIC", [
            f"Issued by {reg_body} to {legal}.",
            f"Registration number {reg_no}; date of incorporation {inc_date}.",
            "Registered office address matches the headquarters on the profile.",
            "Certified true copy, stamped and dated.",
        ]),
        doc("Cap table (fully diluted, 30 Sep 2026)", "cap_table", "SHARED_ONLY",
            [f"{h}: {p:g}%" for h, p in cap][:5]
            + ([f"Remaining holders: {sum(p for _, p in cap[5:]):g}% combined"] if len(cap) > 5 else [])),
        doc("Management accounts, Oct 2025 to Sep 2026", "financials", "SHARED_ONLY", mgmt_lines),
        doc(tax_title, "tax", "ON_REQUEST", tax_lines),
        doc("IP assignment deeds (founders and staff)", "legal_ip", "ON_REQUEST", ip_lines),
        doc(contract[0], "contracts", "PRIVATE", contract[1]),
        doc(minutes[0], "incorporation", "PRIVATE", minutes[1]),
        doc("Employee share option plan", "team", "SHARED_ONLY", [
            f"Option pool of {esop_pct:g}% of fully diluted share capital.",
            esop_vest,
            "Good-leaver and bad-leaver provisions; board approves every grant.",
            "Grant register attached; individual allocations are not shown to investors before term sheet.",
        ]),
        doc(kyc[0], "kyc_kyb", "PRIVATE", kyc[1]),
    ]
    room.extend(doc(*e) for e in extras)
    assert 8 <= len(room) <= 12, legal
    return room
