# Investor-startup matching research (B1-B4)

Research agent M1, 2026-10-06. Feeds the multi-parameter fit score (B1), "top three" side-by-side (B2, C1), scores on cards (B3) and "Company requests" (B4).

## 1. Summary for builders

- The market splits into three kinds of matching: **declared-criteria filters** (Visible Connect, Gust, Crunchbase, Dealroom: stage, sector, geography, cheque size), **network / social proof** (Signal by NFX ranks investors by community votes and Gmail-graph relationship strength; Affinity scores relationship strength 10-100 from email and calendar recency and frequency, not content; Fundingstack "Get Intro" finds warm paths), and **signal-based discovery for investors** (Harmonic: headcount by department, web traffic, saved searches and alerts over 35M companies). Sources in section 2.
- None of them publish an explainable multi-parameter fit for a specific pair. That is Capital Q's opening: **a fit profile with one row per parameter, each with a plain reason, a confidence, and "unknown" as a first-class state**.
- Capital Q already has the right base: `packages/discovery/src/ranking/config.ts` holds `ranking-config.v1..v3`, a frozen, versioned config with stage, geography, taxonomy and semantic similarity, equally weighted, **missing factors do not contribute and are not zero**, cheque inactive while not computable, eligibility gate never weighted. The recommendation below extends this; it does not replace it.
- Keep three things separate (CLAUDE.md): **Fit ≠ Readiness ≠ Business quality ≠ Interest ≠ Match**. The fit profile answers "how well does this company match what this investor declared". Q's view (go / maybe / pass) is a separate, labelled Q_INFERENCE component and never changes the deterministic score.

## 2. How others do it

| Product | Who it serves | Parameters | Method | Explainability | Source |
|---|---|---|---|---|---|
| Signal (NFX) | Founders finding investors | Sector, stage, geography, cheque, quality | Lists per sector x stage (~350 lists); rank by community votes and relationship graph strength | List membership only | [Signal methodology](https://signal.nfx.com/investor-lists/methodology), [Signal FAQ](https://signal.nfx.com/faq) |
| Visible Connect | Founders | Check size (min, max, sweet spot), stage, focus, geography, board seat, traction metrics the firm wants | Filters into a fundraising pipeline (CRM) | Filter match | [Visible Connect](https://visible.vc/connect/), [blog](https://visible.vc/blog/visible-connect-investor-database/) |
| Gust | Both | Location, industry, keywords; investor criteria | Filter search; startups submit to groups | Filter match | [Gust help](https://gust.helpscoutdocs.com/article/210-submitting-to-investors) |
| Harmonic | Investors | Headcount growth by department, web traffic, funding, founders' backgrounds, custom lists | Saved searches, alerts, AI agent explains why numbers move | Signal-level | [Harmonic growth](https://harmonic.ai/solutions/growth), [Harmonic blog](https://harmonic.ai/blog/best-tools-for-tracking-startup-growth-signals) |
| Affinity | Investors (CRM) | Relationship strength from email/calendar metadata | Recency and frequency score 10-100, coloured bars | Bar + who knows whom | [Affinity support](https://support.affinity.co/s/article/Leveraging-your-Connections-and-Relationship-Strengths) |
| Fundingstack | Bankers, advisors, emerging managers | LP and VC database (~227k), intro paths via Google contacts, LinkedIn degrees | Warm-path analytics | Path shown | [GTM directory](https://thegtmdirectory.com/tools/fundingstack), [press release](https://www.24-7pressrelease.com/press-release/517690/fundingstack-accelerates-fundraising-with-the-new-get-intro-feature) |
| AngelList | Angels, syndicates | Syndicate lead's focus, deal flow | Lead-curated deals, backers follow leads | Lead reputation | [AngelList syndicates](https://www.angellist.com/investors/syndicates) |
| Crunchbase / Dealroom | Both | Funding rounds, investors, sector, location, growth signals | Database search, "similar companies", signals | Filter match | product sites |

Lessons:
1. Declared criteria (stage, sector, geography, cheque) are table stakes and everyone treats them as filters.
2. Relationship and warm-path data is the main differentiator elsewhere. In Capital Q this belongs to the **relationship** (Relationship State), not to fit. Do not mix it into the fit score.
3. Signal platforms (Harmonic) reward activity metrics like headcount growth and web traffic. For Capital Q those are **evidence** of traction, weighted by evidence status, never by engagement on Capital Q itself.

## 3. Recommended Capital Q fit model (B1)

### 3.1 Pipeline (unchanged order from CLAUDE.md)

hard eligibility → candidate generation → explicit fit → semantic / taxonomy fit → evidence / freshness → exploration / diversity → rank. No LLM in this path.

### 3.2 Hard rules (gate, never weighted)

Only from **declared** mandate rules (never inferred from browsing):
- Excluded sectors (declared exclusion list, e.g. tobacco, weapons, gambling, DFI exclusion lists).
- Excluded geographies / jurisdictions (sanctions, declared "never").
- Stage outside a declared hard range (only if the investor marked it "strict").
- Instrument the investor declared it never uses (e.g. no debt).
- Context Firewall: the company must be discoverable to this investor (visibility scope).
- Founder has opted the company out of discovery or out of this investor type.

A company failing a hard rule is not shown in Discover. In GateQ it lands in a "Outside your mandate" view with the rule named (the founder chose to apply; the investor still decides). Never silent.

### 3.3 Soft parameters (the fit profile)

Each parameter returns one of: **Strong match · Partial match · Mismatch · Unknown**, a 0-1 value for ordering, a reason code, and a plain sentence. Unknown contributes nothing and lowers confidence; it is never 0.

| # | Parameter | Inputs (company side ↔ investor side) | Strong | Partial | Mismatch | Unknown when | Default weight (v4 proposal) |
|---|---|---|---|---|---|---|---|
| 1 | Stage | company stage ↔ mandate stages | stage in declared stages | adjacent stage | far outside (soft) | company stage not set | 0.18 |
| 2 | Sector | taxonomy nodes ↔ mandate sectors | exact node | parent or sibling node | unrelated | no taxonomy | 0.18 |
| 3 | Geography | HQ + operating countries ↔ mandate countries / regions | country listed | region listed | outside | no country | 0.14 |
| 4 | Cheque size | round size, remaining allocation, typical first cheque ↔ cheque min-max, typical | typical cheque fits allocation and lead/follow role | within min-max but off typical | outside min-max | round size unknown | 0.12 |
| 5 | Business model | revenue model ↔ preferred models (B2B SaaS, marketplace, fintech take-rate, hardware) | preferred | neutral | declared dislike (soft) | not extracted | 0.06 |
| 6 | Traction vs thesis | stage-appropriate traction ↔ investor's declared minimums (e.g. "$10k MRR at seed") | meets minimum | some signals | below declared minimum | no traction data | 0.10 |
| 7 | Team | founder-market fit evidence, full-time founders, team completeness ↔ declared preferences (e.g. technical co-founder) | meets preferences | partially | conflicts with declared must-have | team not filled | 0.08 |
| 8 | Thesis similarity (semantic) | company description and deck embeddings ↔ mandate thesis text | high similarity | medium | low (never negative) | no embedding | 0.08 |
| 9 | Round logistics | lead needed vs investor leads; instrument (SAFE, equity); closing date ↔ investor's speed, lead preference | aligned | one mismatch | investor never leads and round needs a lead | not stated | 0.06 |

Weights sum to 1.0 and live in a new frozen config version (e.g. `ranking-config.v4`, status `INITIAL_HEURISTIC_UNCALIBRATED`). They are deliberately a proposal: doc 19 §53 leaves exact match scoring open until outcome data exists. **Investors may adjust their own weights** (e.g. "geography matters most to me") as a declared preference stored with the mandate, versioned; the system default stays the config.

### 3.4 Evidence and freshness (modifies confidence, not fit)

Evidence quality is a separate axis shown next to fit, not multiplied into it:
- **Confidence** for the profile = share of total weight whose parameters are known, adjusted by evidence status of the inputs (SELF_REPORTED < DOCUMENT_SUPPORTED < MULTI_SOURCE < VERIFIED). Display as words: **High · Medium · Low confidence**, never a percentage (CLAUDE.md: no invented confidence percentages).
- **Freshness**: traction older than 6 months marks the traction parameter STALE and lowers confidence.
- Evidence can be an ordering tie-breaker inside a fit band (doc 19 order), but "insufficient evidence lowers confidence; it never means poor company".

### 3.5 Computation (deterministic)

- `fit_value = Σ(w_i × v_i) / Σ(w_i)` over **known** parameters only (as v1-v3 already do).
- `coverage = Σ(w_known) / Σ(w_all)`.
- Band for display: **Strong fit** (≥ 0.75 and coverage ≥ 0.6), **Good fit** (≥ 0.55), **Partial fit** (≥ 0.35), **Weak fit** (< 0.35), **Not enough information** (coverage < 0.4, regardless of value). Bands, thresholds and labels in the same versioned config.
- Persist `config_version`, inputs' versions and the per-parameter results with every slate and every card so a score is reproducible and explainable later.
- A numeric display (e.g. "82") is optional. If shown, show it with the band and confidence, and never as "82% likely". Recommendation: show the band and the 9 parameter chips; show a number only in the side-by-side (B2) where it helps ordering.

### 3.6 Explanation text per parameter (templates, not LLM)

Rendered from reason codes so they are reproducible and translatable. Q may narrate them in voice, but the text on the card comes from templates.

| Parameter | Strong | Partial | Mismatch | Unknown |
|---|---|---|---|---|
| Stage | "Raising a Seed round; you invest at Seed." | "Raising Series A; you mostly invest at Seed." | "Raising Series B; your mandate is Pre-seed to Seed." | "The company has not said its stage yet." |
| Sector | "Payments infrastructure, one of your sectors." | "Fintech, close to your focus on payments." | "Agritech, not in your sectors." | "Sector not set." |
| Geography | "Based in Lagos; you invest in Nigeria." | "Based in Ghana; you invest in West Africa." | "Based in Egypt; outside your regions." | "Location not set." |
| Cheque | "Raising $1.5M; your typical cheque of $250k fits." | "Your cheque fits, but they need a lead and you follow." | "Raising $8M; your range is $50k-$500k." | "Round size not shared." |
| Business model | "B2B subscription, a model you prefer." | "Marketplace, neutral for you." | "Hardware, which you said you avoid." | "Business model not clear from the deck." |
| Traction | "$45k monthly revenue, above your $10k minimum for Seed." | "Pilots with 3 banks, no revenue yet." | "Below the $10k monthly revenue you ask for at Seed." | "No traction data shared yet." |
| Team | "Technical co-founder with 8 years in payments." | "Strong commercial founder; no technical co-founder yet." | "Part-time founders; you require full-time." | "Team details not added." |
| Thesis | "Close to your thesis on SME credit infrastructure." | "Some overlap with your thesis." | "Little overlap with your thesis." (never "bad") | "Not enough text to compare." |
| Round | "SAFE round led by a known fund; you co-invest." | "Needs a lead; you sometimes lead." | "Needs a lead; you never lead." | "Round terms not shared." |

### 3.7 Q's view (separate component, B4)

- Label: **"Q's view"** with a small Q mark; content: a recommendation in one of **Worth a look · Maybe · Probably not**, two to three reasons, the main risk, and what is unknown ("Ask about churn; no retention data").
- Produced by the Q recommendation specialist (already present: `packages/q-specialists/src/recommendation/narrator.ts`) through the Model Gateway, from **only** context the investor may see (Context Firewall), truth class Q_INFERENCE, cached per (company version, mandate version).
- **Never changes the fit score or the ranking.** It is shown beside it. If Q disagrees with the fit ("Strong fit on paper, but the cap table looks crowded"), both show.
- Off the swipe path: computed asynchronously and shown when ready; the card renders without it.
- Humans retain commercial authority: Q's view never triggers Express Interest by itself (mandate watcher agent in J1 must still go Prepare → Recommend → Approve unless the investor has explicitly delegated).

## 4. "Q, give me the top three" (B2, C1)

Selection: deterministic. Take the investor's current eligible slate, order by fit value within coverage ≥ 0.4, tie-break by evidence then freshness, apply diversity (no two from the same sub-sector if a close third exists, configurable). Q explains; Q does not choose.

Layout (desktop: three columns; phone: three stacked cards that expand one at a time, or a horizontal swipe with a "1 of 3" indicator; follow C2: the card Q is talking about expands, the others shrink to a header row):

```
┌─ 1  Paystack-like Co. ─────┐┌─ 2  AgroLedger ─────────┐┌─ 3  MedRoute ───────────┐
│ Seed · Fintech · Lagos      ││ Seed · Agritech · Nairobi││ Pre-seed · Health · Accra│
│ STRONG FIT   High confidence││ GOOD FIT  Medium conf.   ││ GOOD FIT  Low confidence │
│ Stage        ● strong       ││ Stage      ● strong      ││ Stage     ◐ partial      │
│ Sector       ● strong       ││ Sector     ◐ partial     ││ Sector    ● strong       │
│ Geography    ● strong       ││ Geography  ● strong      ││ Geography ◐ partial      │
│ Cheque       ● strong       ││ Cheque     ○ unknown     ││ Cheque    ● strong       │
│ Traction     ◐ partial      ││ Traction   ● strong      ││ Traction  ○ unknown      │
│ ...                         ││ ...                      ││ ...                      │
│ Q's view: Worth a look      ││ Q's view: Maybe          ││ Q's view: Worth a look   │
│ "Fastest growth of the three"││"Ask for round size"     ││ "Early; strong team"     │
│ [Open profile] [Save] [Pass]││ ...                      ││ ...                      │
└─────────────────────────────┘└──────────────────────────┘└──────────────────────────┘
```

Rules:
- Rows aligned across columns (same parameter order) so the eye compares horizontally. Highlight per row the best value (with a shape or text, never colour alone).
- Unknown is a hollow marker with the word "Unknown", visually neutral (grey), never red.
- Each column ends with actions; Express Interest only inside the profile (server-confirmed).
- "Why these three?" link opens the slate explanation: config version, how many were eligible, what was excluded and why (hard rules).
- Card must also work for any N (C1): 1 → full width; 2 → two columns; 3 → three; > 3 → horizontal scroll with fixed parameter labels column.

## 5. Where scores appear (B3, B4)

- **Relationship cards**: band + confidence + three strongest parameter chips + one unknown chip if any ("Cheque unknown").
- **Company requests** (renamed from "Founder's request"): card shows company name, one-liner, stage/sector/country, fit band, the top 3 reasons (templates), the main mismatch if any, Q's view (when ready), and "Open profile" (A1). Sorting: newest, best fit, waiting longest (SLA; see gateq-inbox.md).
- **Profiles**: a "Fit with your mandate" panel with all nine parameters, expandable to the explanation and the source of each input (deck slide, data-room doc, founder-declared).
- Founders see fit from their side only where permitted: "How you match Sahel Capital's public mandate" uses the investor's **public** mandate only. Investor-private mandate notes never leak to founders (Context Firewall works both ways).

## 6. Gaps and recommendations

1. **Mutual fit.** Founders also have preferences (lead vs follow, board seat, value-add, sector expertise, time to close). Add a founder-side "investor fit" later using the same model mirrored; display it only to the founder.
2. **Calibrate with outcomes, not engagement.** When outcome data exists (meetings held, term sheets, investments), fit weights can be calibrated (`CALIBRATED` status already reserved). Never calibrate against clicks, saves or views (viewing is not interest).
3. **Portfolio conflict.** Investors avoid funding direct competitors of portfolio companies. Add a "Portfolio conflict" parameter (soft, explained: "You back X, a direct competitor") once portfolio data exists. This is a high-value, low-effort parameter.
4. **Fund timing.** Investors late in a fund deploy less to new companies; a declared "actively deploying" flag on the mandate is enough for V1 (declared, not inferred).
5. **Ownership target.** Many funds target 10-20% at entry; with cheque and pre-money this gives a soft "ownership fit". Only when valuation is shared by the founder.
6. **Do not double count**: sector and thesis similarity overlap; keep thesis weight low (0.08) and show it as "Thesis overlap".
7. **Diversity and exploration** belong in the slate, not in the fit score: keep the fit honest and let the slate add a small, labelled share of "Outside your usual focus" items, which the investor can switch off.
8. **Reason text is versioned with the config** so an old card still explains itself exactly as it did when shown.
9. **Unknown handling check** (test): a company with only stage and sector known and both strong must show "Strong on what we know, low confidence", never a high-confidence Strong fit. Add a Vitest assertion.
10. **Bias**: no parameter may use founder age, gender, ethnicity, nationality or photos. Team parameter uses declared experience only.
