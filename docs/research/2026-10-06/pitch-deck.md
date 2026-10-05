# Pitch deck research (A4, A5, A6)

Research agent M1, 2026-10-06. Feeds the Pitch deck tab, the standard sub-tabs Q extracts (A5), deck coaching (A6) and Q tools (A8).

## 1. Summary for builders

- Investors read fast. DocSend: average seed deck review is about 3-4 minutes; successful pre-seed decks got 4+ minutes, unsuccessful about 1.5 minutes; the first page gets over twice the attention of any later page, later pages about 15 seconds each; many investors stop before the last slide ([DocSend research](https://www.dropbox.com/resources/docsend-pitch-deck-research), [TechCrunch on 320 decks](https://techcrunch.com/2022/09/22/science-of-pitch-decks/amp)).
- Successful decks are about 20 pages at about 50 words per slide, skip a table of contents, put product and "why now" early, and include a competition slide ([DocSend research](https://www.dropbox.com/resources/docsend-pitch-deck-research)).
- Three canonical structures agree on the core: Sequoia (purpose, problem, solution, why now, market, competition, product, business model, team, financials) ([Sequoia template summary](https://www.alexanderjarvis.com/sequoia-capital-business-plan-template/)); YC (title with one-line description, problem, solution, traction, insight, business model, market, team, ask; slides legible, simple, obvious) ([Kevin Hale, YC](https://www.ycombinator.com/blog/how-to-design-a-better-pitch-deck), [Aaron Harris, YC seed deck](https://blog.ycombinator.com/intro-to-the-yc-seed-deck)); Guy Kawasaki 10/20/30 (10 slides, 20 minutes, 30-point minimum font).
- African investors add: FX exposure and USD-linked revenue, regulatory licences, unit economics under inflation, and route to scale beyond one country ([TechCabal 2025](https://techcabal.com/2025/10/10/pitch-deck-2025/)).
- Capital Q's A5 order (fixed for every founder): **Problem · Solution · Value proposition · Market · Go-to-market · Business model · Traction · Competition · Financials · The ask and use of funds · Founders · Team**. This maps cleanly onto all three canons; "Why now" and "Product" fold into Problem/Solution as fields (see 3).

## 2. What each canon says (condensed)

| Section | Sequoia | YC | Kawasaki | DocSend data | Capital Q sub-tab |
|---|---|---|---|---|---|
| Purpose / one-liner | Company purpose: one declarative sentence | Title slide: name + one line | Title | First slide gets 2x attention | Header of every sub-tab (not a tab) |
| Problem | Customer pain; how it is solved today | Problem | Problem/opportunity | | **Problem** |
| Solution / product | Solution, use cases; Product (form factor, roadmap) | Solution; demo | Value proposition; underlying magic | Product early in funded decks | **Solution** |
| Value proposition | inside Solution | inside Solution | Value proposition | | **Value proposition** |
| Why now | Why now | Insight | | Critical at pre-seed | field in Problem |
| Market | Market size (TAM/SAM/SOM, bottom-up) | Market | | Heavily scrutinised for underrepresented founders | **Market** |
| GTM | | | Marketing and sales | | **Go-to-market** |
| Business model | Revenue model, pricing, ACV | Business model | Business model | Most time spent in some cohorts | **Business model** |
| Traction | | Traction (as early as possible) | | Top-viewed | **Traction** |
| Competition | Competitors, plan to win | | Competitive analysis | Funded decks include it | **Competition** |
| Financials | P&L, balance sheet, cash flow, cap table, the deal | | Projections and milestones | Top-viewed | **Financials** |
| Ask | the deal | Ask: how much and what it gets you | | | **The ask and use of funds** |
| Team | Founders and management, board | Team: why you | Management team | Team gets the most time in funded decks | **Founders** (one card per founder) and **Team** |

## 3. Canonical extraction schema (A5)

Principles:
- Every field carries the CLAUDE.md axes: `truth_class` (USER_CLAIM for anything read from the deck; Q_INFERENCE for anything Q derives; VERIFIED only from verification), `evidence_status` (SELF_REPORTED for deck claims; DOCUMENT_SUPPORTED when matched to a data-room document), `lifecycle_status`, plus `source` = {document version id, page number(s), quote span}.
- **Every field allows `unknown`** with a reason: `not_in_deck`, `unclear`, `contradictory`. Unknown is never shown as zero or "weak".
- Numbers: `{ value: decimal string, unit, currency (ISO 4217), period, as_of_date }`. Never floats. Ranges allowed (`min`, `max`).
- Material extracted facts need founder confirmation before they become authoritative company facts (CLAUDE.md onboarding). Until confirmed, label "From the deck, not yet confirmed".
- Contradictions (deck says ARR $1.2M, financial model says $0.9M) are stored side by side and shown; never pick the favourable one.

Header (shown on every sub-tab): company name, one-line description (≤ 20 words), stage, sector(s) (taxonomy ids), HQ country, operating countries, deck version and date, downloadable (bool, founder-set), extraction status.

| Sub-tab | Field | Type | Notes |
|---|---|---|---|
| **1 Problem** | problem_statement | text ≤ 60 words | |
| | who_has_it (customer segment) | text + taxonomy | |
| | current_alternatives | list of text | how solved today |
| | pain_evidence | list of {claim, source} | quotes, surveys, data |
| | why_now | text | trends, regulation, tech shifts |
| **2 Solution** | solution_summary | text ≤ 60 words | |
| | product_form | enum-like reference (app, API, hardware, marketplace, service...) | reference data |
| | key_features | list ≤ 5 | |
| | product_stage | idea / prototype / MVP / live / scaling | |
| | demo_link | url | |
| | moat / unfair advantage | text | proprietary data, licence, network effects |
| **3 Value proposition** | value_statement | text | outcome for the customer |
| | quantified_benefit | number + unit | "cuts reconciliation time 80%" |
| | target_buyer vs user | text | |
| **4 Market** | tam / sam / som | money + method (top-down / bottom-up) + source | |
| | market_definition | text | |
| | geography_focus | list of countries | |
| | market_growth | percent + source | |
| **5 Go-to-market** | channels | list | direct sales, partners, agents, PLG |
| | sales_motion | text | |
| | cac (stated) | money | |
| | expansion_plan | list of {country, timing} | |
| | partnerships | list | |
| **6 Business model** | revenue_model | reference (subscription, take rate, transaction fee, licence, hardware...) | |
| | pricing | text + money | |
| | gross_margin | percent | |
| | unit_economics | {ltv, cac, payback_months, contribution_margin} | each unknown-allowed |
| | revenue_currency_mix | list of {currency, share} | FX exposure, Africa |
| **7 Traction** | revenue_metric | {type: MRR/ARR/GMV/TPV/revenue, value, period, as_of} | |
| | growth_rate | percent + period | |
| | customers / users | count + definition (active how?) | |
| | retention | percent + cohort definition | |
| | notable_customers / LOIs / pilots | list | |
| | milestones achieved | list with dates | |
| **8 Competition** | competitors | list of {name, type: direct/indirect/status quo} | link to canonical companies where possible |
| | positioning | text or 2x2 axes | |
| | differentiation | list | |
| **9 Financials** | historical | list of {period, revenue, burn, gross_margin} | |
| | projections | list of {year, revenue, ebitda} | labelled ESTIMATE |
| | burn_monthly, runway_months | money / number | founder-private by default; Context Firewall combination risk |
| | breakeven_target | date | |
| **10 The ask** | amount | money | |
| | instrument | SAFE / equity / note / debt / grant | reference data |
| | valuation_or_cap | money | often confidential; founder decides |
| | use_of_funds | list of {category, percent} | must sum ≤ 100 |
| | milestones_funded | list | what the money gets |
| | runway_from_round | months | |
| | committed_so_far / lead | money / text | |
| **11 Founders** (one card each) | name, role, photo, linkedin | | links to Person (Person ≠ Organisation) |
| | background | list of prior roles, education | |
| | founder_market_fit | text | why this person |
| | full_time | bool | |
| | equity_held | percent | founder-private by default |
| **12 Team** | headcount | number + as_of | |
| | key_hires | list | |
| | advisors / board | list | |
| | hiring_plan | list | |
| | gaps | list | Q_INFERENCE, labelled |

Display rule (A5): all twelve sub-tabs always appear in this order for every founder. A missing section shows "Not in the deck yet" with a single neutral line, not an empty card, and (founder view only) a "How to add this" coaching link. Swipe sideways on phone, arrows and left/right keys on desktop, with a dot or "4 / 12" indicator.

## 4. Scoring rubric (0-5 per section)

Scale (same for all sections):
- **0 Missing**: section absent. (Shown as "Not covered", not a red zero; overall score confidence drops instead.)
- **1 Mentioned**: a heading or vague sentence, no specifics.
- **2 Basic**: stated, but generic or unsupported.
- **3 Clear**: specific, understandable at a glance, at least one concrete number or example.
- **4 Strong**: specific, quantified, sourced, consistent with the rest of the deck.
- **5 Exceptional**: everything in 4, plus evidence that is hard to fake (third-party data, named customers, cohort data) and a clear insight.

Section-specific criteria for 3 / 4 / 5:

| Section | 3 Clear | 4 Strong | 5 Exceptional |
|---|---|---|---|
| Problem | Named customer, named pain | Pain quantified (time, money, frequency); current alternatives named | Evidence from customers (quotes, survey n, data) plus a credible why now |
| Solution | One-sentence explanation; product visible (screenshot) | Shows how it removes the stated pain; product stage stated | Live demo or usage proof; clear unfair advantage |
| Value proposition | Benefit stated in customer terms | Benefit quantified | Benefit proven by customer result |
| Market | TAM stated with source | Bottom-up SAM/SOM with method | Bottom-up with real pricing x reachable customers, plus a sensible beachhead |
| Go-to-market | Channels listed | Motion explained with costs (CAC) | CAC and conversion from real data; repeatable channel shown |
| Business model | Who pays, how | Pricing and gross margin stated | Unit economics (LTV/CAC, payback) from real data, FX mix explained |
| Traction | One concrete metric with date | Trend over time (chart, 6+ months), defined metric | Retention or cohorts, named customers, growth rate consistent with financials |
| Competition | Competitors named | Honest positioning including status quo | Clear, defensible reason to win, with evidence |
| Financials | Current revenue and burn | Historical plus 3-yr projection with key assumptions | Assumptions tied to traction; consistent with ask and use of funds |
| The ask | Amount stated | Instrument and use of funds | Milestones the round reaches, runway, who is committed |
| Founders | Names and roles | Relevant background for each | Founder-market fit evidenced (domain years, prior exits, unique access) |
| Team | Headcount | Key roles and gaps acknowledged | Hiring plan tied to use of funds; strong advisors with real roles |

Cross-cutting checks (each a pass / flag, not a score): consistency (numbers agree across slides and with data room), legibility (YC: one idea per slide, readable; ≤ about 50 words), length (10-20 slides typical), dates on metrics, currency stated, no unsupported superlatives ("the only", "first in Africa") without evidence.

Output: a **section profile** (12 bars), not a single number. If an overall figure is needed it is "Sections at standard: 8 of 12", which is more honest than a weighted average. No invented confidence percentages (CLAUDE.md).

Important separation (CLAUDE.md invariants): **deck quality ≠ business quality ≠ fit**. A weak deck from a good company is a presentation gap. The deck rubric must never feed investor ranking directly; at most it can feed the founder's "readiness" view.

## 5. Coaching playbook (A6)

Common gaps (from DocSend data, YC guidance and African VC commentary), and the fix Q proposes:

| Gap | How Q detects it | What Q says (plain words) | Fix Q can do |
|---|---|---|---|
| No one-line description on slide 1 | First page lacks a sentence that says what the company does | "Investors spend the most time on your first slide. Say what you do in one line." | Draft three one-liners from the deck |
| Table of contents / agenda slide | Slide titled "Agenda" | "Remove the agenda; successful decks skip it." | Delete slide |
| Problem without evidence | No numbers or quotes in problem | "Show how big the pain is: time, money or how often." | Ask the founder 2 questions, draft the slide |
| Top-down TAM only ("1% of Africa's $X bn") | Market slide with single big number | "Build it bottom-up: customers you can reach × price." | Compute bottom-up from stated price and segment counts, labelled ESTIMATE |
| Vanity traction (downloads, sign-ups) | Metrics lack activity or revenue definition | "Show active users or revenue, with a date and trend." | Suggest a chart format |
| Missing competition / "no competitors" | No competitor names | "Every company has competition, even the status quo. Name it." | List likely competitors from network (Q_INFERENCE, labelled) |
| Ask without use of funds | Amount only | "Say what the money gets you: milestones and months of runway." | Draft use-of-funds split for founder to edit |
| Numbers inconsistent | Same metric differs across slides or data room | "Slide 6 says 4,000 customers; slide 11 says 3,200. Which is current?" | Contradiction stays visible until the founder confirms |
| FX risk ignored (Africa) | Local-currency revenue, USD costs, no mention | "Investors will ask about currency risk. Show your revenue currency mix and how you protect margin." | Add a line to business model |
| Regulatory status unclear (fintech, lending, health) | Sector needs licence, none stated | "Say which licences you hold or are applying for." | Link licence document from data room |
| Team slide without why-you | Names and titles only | "Say why your team wins this market." | Draft founder-market-fit lines from profiles |
| Too dense | > ~80 words on a slide | "One idea per slide." | Suggest a split |
| Undated metrics | No as-of dates | "Add the month to every number." | |

Coaching flow:
1. Founder uploads deck → Q extracts (A5) → shows "Here is what investors will see" (the 12 sub-tabs) and "What is missing or weak" (gap list ordered by impact).
2. Each gap has: why it matters (one sentence), how to fix (one sentence), and actions: **Answer a question** (Q asks for the missing fact), **Let Q draft** (Prepare → Recommend → founder approves the exact text), **Upload a new version**.
3. Q never silently edits the deck file; an edited deck is a new version the founder approves (approval binds to the exact payload).
4. The extracted sub-tabs come from the latest **approved** version; investors never see coaching notes.

## 6. Minimum quality bar (A6: "until the deck reaches a minimum standard")

A deck is **at standard** when:
- All of Problem, Solution, Market, Business model, Traction (or "pre-traction" stated explicitly), Founders and The ask score at least **3**;
- No unresolved contradiction on a headline number (revenue, customers, ask);
- Every metric shown has a date;
- Ask states amount and use of funds.

Below the bar: the deck still shows to investors if the founder chooses (founder has commercial authority), but Q marks sub-tabs "Not in the deck yet" honestly, and Q keeps prompting the founder. "Keeps the data consistent for everyone" (A6) means investors see the same 12 sub-tabs in the same order for every company, so comparing companies is fair.

## 7. Gaps and recommendations

1. **Never score the person.** DocSend's own data shows investors spend more time scrutinising decks from all-female and minority-led teams ([DocSend](https://www.dropbox.com/resources/docsend-pitch-deck-research)). Q's rubric must be identical for everyone and must not use names, gender, photos or age as features; add a bias eval to the Q eval suite.
2. **Page-level citations.** Every extracted field links to "slide 7"; tapping opens the deck at that page. This is what makes the sub-tabs trustworthy.
3. **Deck versions** are append-only; show "Updated 2 Oct" and keep history; investors can see that the deck changed, not the coaching.
4. **Download control (A4)**: "View only" renders pages as images in the viewer (no PDF bytes delivered); "Downloadable" delivers a watermarked PDF. Disabling download in a PDF viewer alone is not real protection.
5. **Non-PDF decks**: accept PPTX, Keynote (convert server-side), Google Slides / Pitch / Canva links (snapshot into PDF at upload and on refresh). Store the snapshot so investors see a stable version.
6. **Scanned or image-only decks**: OCR before extraction; if confidence is low, show "Q could not read slide 9 clearly".
7. **Founder profile (A7)**: age is sensitive and often irrelevant; recommend "years of experience" and background, with age optional and founder-controlled visibility, never used in matching.
8. **Metric definitions**: a16z's guide shows the standard pitfalls (bookings counted as revenue, one-off fees in ARR, blended vs paid CAC) ([a16z 16 metrics](https://a16z.com/16-startup-metrics/)). Q should ask "Is this recurring?" before it labels anything ARR.
9. **Stage-aware expectations**: pre-seed decks without revenue are normal; Traction at pre-seed is scored on signals (waitlist, pilots, LOIs). Why-now matters most at pre-seed ([DocSend](https://www.dropbox.com/resources/docsend-pitch-deck-research)).
11. **Founder profile fields (A7)**, from what investors assess (experience: domain knowledge, prior ventures including failures, leadership growth; skills: technical, market, fundraising; commitment: full-time, resilience; personal connection to the problem) ([Allied VC](https://www.allied.vc/guides/how-to-assess-founders-during-due-diligence), [BetaKit](https://betakit.com/ask-an-investor-what-do-investors-look-for-in-a-founding-team/)): photo, name, role, location; **one-line why-me** ("8 years running SME lending at a Lagos bank"); experience timeline (roles, companies, years); prior ventures with outcome (exit / shut down / ongoing; failures are allowed and normal); education (optional); domain years; full-time since (date); links (LinkedIn, GitHub, X); languages; founder video (Elevator tab A2). Visibility per field chosen by the founder (age, nationality and education off by default). Q may draft the why-me from the CV; founder confirms. Never used as ranking features beyond declared experience (matching.md, bias rule).
12. **Prior verification**: offer LinkedIn import (founder-initiated) to prefill experience; label imported items "From LinkedIn, not checked" (USER_CLAIM, SELF_REPORTED).
10. **Investor-facing view never shows the rubric score** unless the founder opts in; investors make their own judgement. Q's view for investors (matching.md) is a separate component.
