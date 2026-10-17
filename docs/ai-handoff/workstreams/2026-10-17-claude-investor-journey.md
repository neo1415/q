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

## Product audit (production, 2026-10-17, fictional Savanna Seed Partners, desktop 1280 + mobile 390)

Screenshots are private receipts under the session scratchpad (not committed): Discover, Ledgerfold profile (full page), CRM overview, pipeline desktop/mobile.

| Executive concern                             | Evidence                                                                                                                                                            | Class                                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Too many tabs                                 | Primary nav is already Discover · Explore · Q · CRM with Workspace and You groups (desktop sidebar and mobile bottom bar)                                           | 1 — working and discoverable (shipped before this stream)                                               |
| Scores visible                                | Company profile shows Investability (FDN InvestIQ v1) and Suitability separately with factor coverage and confidence; pipeline rows repeat both                     | 1                                                                                                       |
| In-app brief                                  | Q's view card (verdict, main qualification, three open questions) plus Full assessment / Risks and gaps asks; section-by-section deck reading with claim provenance | 2 — present, but ended without an action                                                                |
| Next logical step after analysis              | Header offered only Pass and Your relationship; open questions only asked Q                                                                                         | 4 — **fixed**: Next step row chosen from relationship state (`apps/web/src/features/fit/next-steps.ts`) |
| CRM shows what needs action / awaiting / next | Pipeline: filters All / Needs you / Awaiting reply / Connected / In diligence; List / Table / Board; per-row scores, fit words and Next step; search                | 1                                                                                                       |
| CRM "Needs you"                               | Folded by owner decision 2026-10-16 (`components/panel.tsx`); left as decided                                                                                       | 1 (owner choice)                                                                                        |
| CRM "advanced" / "new evidence" views         | No filter for recently advanced or newly evidenced relationships                                                                                                    | 5 — not implemented (next)                                                                              |
| Mobile                                        | Bottom bar with Q centred; large Book a call targets; Q greeting card covers about a third of the pipeline on 390px                                                 | 2 — friction noted                                                                                      |
| Speed                                         | Ready main content: pipeline 1.3–1.5 s, CRM 1.15 s, Discover 1.25 s, company 1.7 s (commit→main, warm); "network idle" 10.7 s is streaming, not user wait           | 1                                                                                                       |
| GateQ interview depth                         | Repeated questions; mandate unused when the gate has no criteria                                                                                                    | 4 — **fixed** (see commits)                                                                             |

## Changes on this branch

- `56528969a` handoff evidence (this file).
- `10250157c` GateQ question needs park a dimension after two asks; solution/problem cover the description; general assessment ordered through business model, market, traction, revenue (`packages/gateq-intake/src/application/question-needs.ts`, interviewer, conversation service).
- `4ee3b12c5` GateQ mandate emphasis: dimensions (never values) from the owner's automation-eligible mandate shape the interview (`apps/api/src/gateq/mandate-emphasis.ts`, `main.ts` wiring, `INVESTOR_EMPHASIS` need reason; applicant coverage maps it to UNDERSTANDING).
- `674505a28` Next step row on Q's view (`apps/web/src/features/fit/{next-steps.ts,fit-panel.tsx}`, slot + profile view pass relationship state). Every consequential step asks Q to prepare the existing action for approval.

Tests: gateq-intake 201+ (park, cover, emphasis), API emphasis 3, web next steps 5; root tsc, web/api tsc, eslint, prettier clean on changed files. No migrations, no contract change, no flag.

## Next

1. Release this branch (int-rc → CI → production) and re-run a live GateQ interview against Partech's gate and Atlas's gate with two different founders; record that questions differ and none repeat a third time.
2. Partech's gate has 0 criteria: the owner may draft rules from the mandate (Your gate → Draft rules with Q), a policy decision for the account owner, not changed here.
3. CRM: add "Advanced recently" / "New evidence" pipeline filters over existing relationship events.
4. Investor follow-up about one exact GateQ application through Q (inbox has no "Ask Q about this application" entry point yet).
