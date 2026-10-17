# Workstream B (Claude) — investor journey, GateQ depth, UX consolidation

Branch: `claude/investor-journey-oct17` (from `build/int-rc` @ 995b716a). Workstream A (Codex: Unicorn Predictor, Home Q file intelligence) is not touched here.

## A. Demonstration investor accounts (live, read-only, 2026-10-17)

Evidence: hosted read-only SQL through `scripts/handoff/live/hosted-read.mjs` (owner-supplied disposable management token, never stored in Git) and signed-in browser reads. Nothing was modified.

### Test – Partech Africa (the account the owner identified; "Pantech" in the brief)

- Organisation `8aeb3529…` / investor organisation `0970cc1a…`, created 2026-10-08. Type VC, actively investing, inbound QUALIFIED, `organisation_private`.
- Sign-in: `adedaniel502+cq-investor-partech@gmail.com` (the owner's own Gmail alias; confirmed; last sign-in 2026-10-17 16:17 UTC). One active membership holding `organisation_owner` + `organisation_admin`. Access/reset: the normal `/auth/forgot-password` flow sends a reset link to that alias's inbox; no password is held by agents.
- **Mandate: present and ACTIVE** ("Primary mandate"): Seed–Series B; USD 500k–15m (typical 3m); lead or co-invest (STRONG); taxonomy STRONG: Fintech, Payments, Enterprise Software, Commerce & Retail, B2B SaaS, Transaction Fee, Financial Institution, Business Customer, Africa, Egypt; founder: technical founding capability (NICE); green flags: strong revenue growth, enterprise customers (STRONG); hard exclusions: gambling, tobacco, weapons, adult content. Own words: "Test account. Seed to Series B across Africa: fintech, B2B software and commerce."
- **GateQ: gateway `gq_5vgzm4gd9x0z8whe55pr6nka50` v1 PUBLISHED 2026-10-17 15:30 UTC, inbound OPEN, 0 criteria.** The interviewer reads only the published policy, so the detailed mandate never informed the interview.
- Applications: FDN Advisory, SUBMITTED 16:08 (13 turns), and a second FDN Advisory attempt IN_PROGRESS (21 turns).
- Interview evidence (Q turns only): the same opening question asked 4× (turns 1/3/5/7), "who do you serve" 2×; the second attempt repeated one solution question 5× and then idled in SMALL_TALK. Only description, customers, business model and solution were covered; no market, traction, revenue, team or round questions. Turn latency 1.8–5.1 s (not the problem).

### Atlas Health Partners (fictional)

- Only "Atlas" investor organisation (`1944505c…`), created 2026-10-15 by the fictional bulk seed. Owner `investor.atlas-health.grace-okonkwo@fictional.capitalq.local` (seed password `CQ_SEED_ACCOUNT_PASSWORD`), admin Andre Reyes.
- Mandate ACTIVE: Seed–Series B, USD 400k–6m, global (must match), Digital Health/Healthcare/Medical Devices/Insurtech, regulated markets a plus, deep domain expertise, regulatory moat + high retention, exclusions tobacco / Media & Entertainment / Proptech; strict discovery. Raw text present in the mandate, but the review page's "In your own words" reads onboarding answers and shows it as not stated (display inconsistency).
- GateQ published with 6 rules (QUALIFIED). Application Nixo (Fintech/Software, US) 2026-10-17 15:42: 9 turns, same "who brings you in" question repeated; dossier "Not provided" for customers, model, traction, team.

## Findings carried into implementation

1. GateQ interview repeats questions and fixes on one dimension (both investors, two founders).
2. A detailed private mandate does not shape the interview when the published gate has no criteria (Partech).
3. Mandate review page omits the stored mandate text (Atlas).
