# Capital Q: flagship research dossier

- **Prepared:** 2026-10-18, on research branch `claude/flagship-research-b-oct18`, from `origin/build/int-rc` at `cb7b20969`.
- **Sources:**
  - the product sources in this repository (`docs/product-sources/`);
  - the shared handoff (`docs/ai-handoff/`);
  - ADRs (`docs/adr/`);
  - the implemented code (`apps/`, `packages/`);
  - public web pages fetched 2026-10-18.
- **Not used:** production systems and provider APIs.
- **Status vocabulary:** as in `facts.json`. Repository facts are graded by evidence stage:
  - **CODE OBSERVED:** the route or package exists in the repository.
  - **DEPLOYED:** the handoff records it as deployed.
  - **LIVE VERIFIED:** the handoff records it as exercised on production, with evidence.
  - A surface that exists is not proof that a journey works end to end.

## 1. Proposition

Capital Q is described in its locked sources as "an AI-native Investment Intelligence Operating System designed to reduce information asymmetry within private capital markets" (Product Specification, Ch. 1 §3.1).

- **For founders:** it helps them become more investable.
- **For investors:** it helps them find and evaluate relevant opportunities.
- **For both:** it manages the capital relationship from preparation to investment.
- **Q:** one institutional investment analyst throughout, holding intelligence authority while humans keep commercial authority (Final System Review §2).

The public marketing line is "Discovering the right investment opportunity shouldn't take months. It should take minutes … Think TikTok for investment discovery + Jarvis from Iron Man" (https://www.fdncapitalpartners.com/capitalq/; marketing copy, SELF_REPORTED).

**What it is not.** Root `CLAUDE.md` and the PADL say Capital Q is not:

- a marketplace;
- a CRM;
- a chatbot;
- a document store;
- a fundraising directory.

## 2. Description and history

| Date                  | Event                                                                                                                                      | Evidence                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Undated (pre-2026-09) | Product Architecture Decision Log (PADL, 155 locked decisions), Product Specification and Final System Review were authored.               | `docs/product-sources/*.docx` and `text/*.txt`                               |
| Undated               | GateQ Product Feature Specification: GateQ is the "inbound layer" and Capital Q the "outbound and investment-relationship layer".          | `docs/product-sources/text/CapitalQ_GateQ_Product_Feature_Specification.txt` |
| Sep 2026              | Monorepo build: Next.js 16 web, Fastify API, Q API and workers. The original target was "done … by Monday 2026-09-28" (superseded).        | Root `CLAUDE.md`                                                             |
| 2026-10-11            | Hosting is Railway for all four services (ADR 0014; the handoff supersedes Vercel). Landing page captured from FDN Capital Partners' site. | `docs/ai-handoff/STATE.md`, `LANDING-PROMISES.md`                            |
| 2026-10-15            | Owner decision: InvestIQ is "FDN Capital Partners' proprietary methodology and the canonical name"; the Capital Q engine implements it.    | ADR 0068 §8; `docs/ai-handoff/DECISIONS.md` item 24                          |
| 2026-10-16            | Investability and Suitability scores become visible to investors, each with coverage gates.                                                | ADR 0074                                                                     |
| 2026-10-17/18         | Unicorn Potential provisional indicator deployed. Of 461 companies assessed, 0 have a numeric score, because evidence is insufficient.     | ADR 0076; `STATE.md`; `audits/UNICORN-COVERAGE-2026-10-18.md`                |

## 3. Headquarters

- **Capital Q's own HQ: UNKNOWN.** No address or legal entity for Capital Q appears in the repository or on the public page.
- **FDN Capital Partners** hosts the public CapitalQ™ page. Its contact page lists offices in **Doha, Qatar** and **Lagos, Nigeria**, with no street addresses and no registration numbers (https://www.fdncapitalpartners.com/contact/; SELF_REPORTED).
- **Demo market.** The prepared demo journeys centre on Qatar (the "Qatar Five" entities in `docs/ai-handoff/DECISIONS.md`) and on an Africa → Arabia corridor (FDN navigation).
- **Data residency.** Web services run in Railway europe-west4 (Netherlands); the database is hosted Supabase in eu-central-1. ADR 0014 calls EU data residency "a requirement, not a preference".

## 4. Legal and trading names

| Name                                 | Status                                                                                                                                                                                                           |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Capital Q" / "CapitalQ™"            | Product name. The repository uses "Capital Q"; the FDN page uses "CapitalQ™". The ™ sign is a claim; trademark registration is UNKNOWN.                                                                          |
| FDN Capital Partners                 | Publishes and markets CapitalQ™, and owns the InvestIQ methodology (owner decision, ADR 0068). Footer: "© 2026 FDN Capital Partners Capital." Registered entity: UNKNOWN.                                        |
| Legal owner of the Capital Q product | **UNKNOWN.** Whether Capital Q is an FDN product, a separate company or a joint venture with the cofounders is not established publicly.                                                                         |
| Naming conflict                      | The landing page says "Investability IQ"; GateQ says "Q Score"; the PADL and the code say InvestIQ, Investability and Suitability (`PROMISE-COVERAGE.md`). Use the PADL and ADR 0074 names in investor material. |

## 5. Public URL verdict

- **Approved public URL:** **https://www.fdncapitalpartners.com/capitalq/**. It is the only public, marketing-designated page for the product.
  - Fetched 2026-10-18: HTTP 200. The bare-domain `https://fdncapitalpartners.com/capitalq/` returns 301 to the `www` form.
  - `docs/ai-handoff/LANDING-PROMISES.md` designates `https://www.fdncapitalpartners.com/capitalq.html` as the landing page. That path now **returns 404**; the page moved to `/capitalq/`. The handoff should be updated by its owner.
- **App host.** `STATE.md` lists `https://capital-qweb-production.up.railway.app` under "Public URLs" for the deployed web service. That is the platform's default hostname for the deployed app, not a brand domain.
  - `docs/handoff/setup-email-and-meetings.md` recommends buying a custom domain (for example `capitalq.app`) so the app can move off "the Railway address".
  - **Do not present the Railway host as the official site.**
- **No custom app domain is designated.** The web origin is deployment configuration (`CQ_WEB_ORIGIN`, read in `apps/web/app/layout.tsx`). `NEXT_PUBLIC_SITE_URL` does not exist in the repository.
- **Do not use these domains:**
  - `capitalq.ai` appears only in a crawler user-agent string (`packages/q-daily/src/rss.ts`) and in test fixtures. capq.ai is unrelated.
  - `capitalq.com` appears only as a code-comment example.
  - `mail.capitalq.app` is a Message-ID suffix only.

## 6. Sector

- **Segment:** private-capital technology, combining AI investment intelligence, deal sourcing and discovery, inbound deal-flow management, and investment-relationship workflow.
- **Users:** founders (companies raising capital) and investors (VCs, angels, family offices, corporate and government investors, accelerators).

## 7. Business model

- **Locked commercial architecture.** PADL Ch. 5 Decision #85 (LOCKED) sets a three-layer intelligence model:
  - Layer 1 **Diagnosis** is free.
  - Layer 2 **Strategic Intelligence** is "Pro" (the Capital Readiness Blueprint, investor-specific recommendations).
  - Layer 3 is optional **Human Execution** by specialist teams (FDN advisory).

  The principle: "Revenue is generated through proprietary strategic value and optional execution services, not by restricting access to knowledge."

- **Neutrality.** No pay-to-rank, ever. Payment never influences ranking (root `CLAUDE.md`; ADR 0034).
- **Billing implementation.** ADR 0034 is PROPOSED. Plans, entitlements and metering are versioned data. The gated features are:
  - rehearsals;
  - "Q handles it" delegations;
  - AI images in documents;
  - web research;
  - Q Daily editions;
  - the GateQ gateway count;
  - premium scores and filters (ADR 0076).

  Every account is currently on a generous launch default plan.

- **Prices: none published.** "No source sets prices." A facilitation fee on capital raised is a founder direction (2026-09-29), not a locked source.
- **Revenue: UNKNOWN.** There are no paying-customer figures in the repository, and none are claimed here.

## 8. Features and implementation status

The repository's evidence stages are combined with the handoff. "Fictional" means seeded `*@fictional.capitalq.local` demo data.

| Feature                                            | What it does                                                                                                                                                                                                                                                                                           | Evidence and status                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Q Intelligence** (one Q)                         | An institutional analyst that orchestrates internal specialists. All model calls go through the Q Model Gateway. The Context Firewall filters by scope before the model is called. Voice (GPT-Live / speech engine), "Hey Q" wake word, memory, Q Daily news. Prepare → Recommend → Approve → Execute. | DEPLOYED. The packages exist: `q-core`, `q-orchestrator`, `q-firewall`, `q-runtime`, `q-specialists`, `q-tools`, `q-knowledge`, `model-gateway`, plus `apps/q-api`. Parts are LIVE VERIFIED, for example the deck-open summary (`PROMISE-COVERAGE.md` LP-11). Q acceptance for Unicorn EXPAND/DONE is **not** complete (`STATE.md`). |
| **Onboarding** (founder and investor)              | Founder: "upload what you already have, Q works first, then fill gaps", through a conversational interview that is a tool-calling Q run (ADR 0016). Investor: capture the mandate quickly, then show a personalised feed.                                                                              | Routes exist: `/onboarding/founder`, `/onboarding/investor` and `/welcome`. Packages: `founder-onboarding`, `investor-onboarding`. LP-15 SURFACE EXISTS. Time-to-first-feed has not been measured.                                                                                                                                   |
| **Canonical company profiles**                     | One canonical company, one investor organisation and one company–investor relationship (UNIQUE). Profile tabs cover overview, elevator pitch, data room, pitch deck, team and diligence. Evidence carries separate truth, evidence-status and lifecycle axes.                                          | `/company/[companyId]`. Package `companies`. A 14-section Overview and a Diligence tab were added (`STATE.md` row AF). DEPLOYED.                                                                                                                                                                                                     |
| **InvestIQ / Investability**                       | The FDN InvestIQ methodology, nine dimensions (ADR 0068). Investability = InvestIQ overall × 25 (0–100), computed from investor-eligible evidence only and identical for every investor. Below the coverage gates it reads "not enough shared evidence yet".                                           | `packages/readiness/src/investiq/`. ADR 0074 accepted, DEPLOYED (InvestIQ v2). Constants are "hypotheses" pending calibration on 3–5 real FDN companies (`DECISIONS.md` item 24).                                                                                                                                                    |
| **Suitability**                                    | Fit to this investor's mandate, out of 10 × 10. It is never blended with Investability on display. Ranking uses `fit-order.v2` (Suitability 0.75, Investability 0.25), after hard eligibility.                                                                                                         | ADR 0074 and ADR 0059, `packages/discovery`. DEPLOYED.                                                                                                                                                                                                                                                                               |
| **Unicorn Potential** (brief: "Unicorn Predictor") | A deterministic, versioned 0–100 indicator of present evidence against a 12-pillar, 24-criterion owner-approved method. "Not a probability or validated forecast of a billion-dollar outcome." Premium only. Unknown is never zero.                                                                    | `packages/readiness/src/unicorn-potential/` (method `unicorn-potential.v1.0.0`, inputs v4 local). ADR 0076. DEPLOYED, but production holds **0 numeric scores out of 461** because coverage is below the 60% gate. **Do not market it as a "predictor".**                                                                            |
| **Discover**                                       | A precomputed, mandate-ranked vertical video feed of pitches. Save and Pass are optimistic; Express Interest is server-confirmed. Saved, passed and compare views. No LLM in ranking. Never optimises for watch time.                                                                                  | `/discover`, `/discover/saved`, `/discover/saved/compare`, `/discover/passed`, `/discover/yours`, `/pitch`. DEPLOYED. Premium Unicorn filters were LIVE VERIFIED on 2026-10-18 for authorization behaviour only.                                                                                                                     |
| **Explore**                                        | A masonry grid of network-visible pitches, broader than Discover. Closed-vocabulary reasons for each tile, a finite slate, and deterministic search chips.                                                                                                                                             | `/explore`, `/find`, `/search`. ADR 0055 accepted. CODE OBSERVED / DEPLOYED.                                                                                                                                                                                                                                                         |
| **GateQ**                                          | An investor's embeddable, branded inbound gateway: intake → standardise → Q interview → evaluate → rank → route. It resolves to the same canonical relationship row.                                                                                                                                   | `/gateq`, `/gateway`, public `/g/[publicId]` and `/embed`, `public/gateq.js`, packages `gateq` and `gateq-intake`. The GateQ text journey is LIVE VERIFIED with fictional accounts (handoff, 13–14 Oct).                                                                                                                             |
| **Investor CRM / pipeline** (Relationship Hub)     | A relationship entity plus append-only `relationship_events`, with state computed by a deterministic projector (Discovered → Interest → Match → Meeting → Diligence → Commitment → Investment/Pass). Calls, messages and per-relationship diligence.                                                   | `/relationships/...`, `/crm`. Hub H1 LIVE VERIFIED (fictional accounts, desktop and mobile, 14 Oct). H2 list, filter and export are owned by a separate lane.                                                                                                                                                                        |
| **Document intelligence**                          | Deck and document reading in an isolated parser (ADR 0008). Pitch-section readings that founders confirm or correct. Data room. Document Studio with brand kit (ADR 0031). Unscanned-document interim rules (ADR 0042).                                                                                | `/documents`, `/company/data-room`. Packages `deck-render` and `q-artifacts`. DEPLOYED. The founder document path was reported "real, end to end" in commit `b539180c7`.                                                                                                                                                             |
| **Diligence workflow**                             | A diligence tab for each relationship, data-room disclosure ownership (ADR 0004), and diligence-readiness criteria under InvestIQ governance.                                                                                                                                                          | `/relationships/*/[id]/diligence`. DEPLOYED. An end-to-end diligence journey is NOT VERIFIED.                                                                                                                                                                                                                                        |
| **Contextual Q actions**                           | Q acts through the app's own action and read registry (ADR 0040). It sees the screen but not unsaved typing (ADR 0069), and can operate disclosures on screen (EXPAND/DONE). Scoped delegations ("Q handles it", ADR 0028) and standing instructions (ADR 0043).                                       | Packages `q-actions` and `app-actions`; `/work`. DEPLOYED. A live Q exact-target DONE receipt is still pending (`STATE.md` 2026-10-18).                                                                                                                                                                                              |
| Also built                                         | Rehearsals with investor personas (ADR 0029/0066); Q-hosted meetings (ADR 0027/0037/0039); Q Daily (ADR 0032); Q Pitch scripted investor tour (`docs/specs/q-pitch/`); admin, verification and break-glass (ADR 0033).                                                                                 | Q Pitch status is governed by `docs/specs/q-pitch/IMPLEMENTATION_STATUS.md`. Do not claim Q Pitch features beyond its CERTIFICATION_MANIFEST.                                                                                                                                                                                        |

## 9. Customers and buying process

- **Target users:** founders raising capital; investors with a mandate; and organisations running inbound deal flow through GateQ (funds, accelerators, investment-promotion agencies).
- **Intended motion:** the FDN page's "Join the Waitlist" and "Book a Demo" CTAs; free diagnosis, then Pro, then optional FDN human execution.
- **Paying customers: UNKNOWN.** The handoff mentions "43 explicit existing-organisation feature ACCESS grants" and real founder demo accounts (`STATE.md`). These are access grants, not evidence of revenue or contracts. The companies in production scoring audits (for example "Shiftwell", "Tensorgate") include seeded demo data; do not cite them as customers.

## 10. Founders and team

| Person          | Role                                                   | Status and source                                                                                                                                                                                                                                                                                                                                                              |
| --------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Zino Mario      | Cofounder                                              | OWNER_PROVIDED. Publicly: Partner (Vision, Growth & Governance) at FDN Capital Partners (https://www.fdncapitalpartners.com/team/); founder and CEO of Zino Aviation (see `../zino-aviation/research.md`). His personal site does not list Capital Q (https://www.zinomario.com/).                                                                                             |
| David Okonkwo   | Cofounder                                              | OWNER_PROVIDED. **Name discrepancy:** FDN's public team page lists **"David Nwankwo", Managing Partner (Strategy, Capital & Ecosystem)**, and says he "created Capital Q". A capital strategist with private-capital, wealth-management, investment-immigration and venture-advisory experience (SELF_REPORTED). Confirm the correct surname with the owner before publishing. |
| Fortune Nwankwo | Partner, FDN (Operations, Product & Venture Execution) | SELF_REPORTED on the FDN team page. His role in Capital Q is UNKNOWN.                                                                                                                                                                                                                                                                                                          |

## 11. Partnerships: claimed vs evidenced

| Party                                                                                                               | Relationship                                                                                         | Evidence                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| FDN Capital Partners                                                                                                | Publisher of the marketing page, owner of the InvestIQ methodology, Layer 3 human-execution provider | ADR 0068; PADL #85; FDN site. VERIFIED that the page exists. The commercial terms between FDN and Capital Q are UNKNOWN.            |
| Invest Qatar and the "Qatar Five" entities                                                                          | Prepared **demo** entities                                                                           | `DECISIONS.md` says Invest Qatar is "played as an investment-promotion representative, never a VC". **These are not partnerships.** |
| Infrastructure vendors (Railway, Supabase, model providers, Cloudflare Stream, ElevenLabs, Deepgram, Tavus, Google) | Suppliers                                                                                            | Named in the repository. Vendor relationships are not partnerships.                                                                 |

## 12. Competition (illustrative)

- **Private-capital data and deal sourcing:** PitchBook, Crunchbase, Grata, Harmonic, Tracxn, Dealroom. In Africa: Briter Intelligence and Africa: The Big Deal.
- **Relationship CRM for investors:** Affinity, Intapp DealCloud, 4Degrees, Attio.
- **Inbound deal-flow intake (the GateQ analogue):** DealRoom-style intake forms, Airtable/Typeform workflows, Visible.vc and DocSend-style data rooms.
- **Founder readiness and fundraising tools:** VC4A (Africa), Visible, Foundersuite, plus generic AI assistants.
- **Differentiation claimed in the locked sources:**
  - one canonical company–investor relationship shared by both sides;
  - evidence-first assessments with explicit unknowns;
  - the Context Firewall protecting founder-private data;
  - deterministic, explainable ranking with no pay-to-rank;
  - one Q across discovery, intake, diligence and meetings.

## 13. Market opportunity

**Cited figures (each a third-party estimate):**

- **Private markets AUM:**
  - about **US$13 trillion** (late 2024), projected at more than US$20 trillion by 2030, per the BlackRock 2025 Private Markets Outlook (https://www.businesswire.com/news/home/20241216468500/en).
  - Preqin data as of 31 March 2025 puts private equity at about US$6.7 trillion (https://committees.parliament.uk/writtenevidence/157389/html/).
- **African venture funding 2025:**
  - AVCA: **US$3.9bn across 506 deals**, including US$1.8bn of venture debt (https://www.ecofinagency.com/news-finances/1402-52907-africa-vc-funding-climbs-to-3-9bn-in-2025-led-by-local-funds-avca).
  - Partech: **US$4.1bn, 570 transactions** (https://allafrica.com/stories/202601250064.html).
  - Africa: The Big Deal: **US$2.2bn equity**; the "Big Four" (Kenya, South Africa, Egypt, Nigeria) account for about 83% (https://businessday.ng/technology/article/africas-startups-raise-2-2bn-in-2025-as-growth-outruns-europe-china-and-india/).
- **AI adoption:**
  - Deloitte's 2025 GenAI in M&A survey (1,000 US corporate and PE professionals): **86%** have adopted GenAI in M&A workflows. 35% use it to identify and evaluate targets, and 35% for due diligence (https://www.deloitte.com/us/en/about/press-room/deloitte-survey-genai-in-mna.html).
  - Fuld survey of 100+ PE firms: 52% use AI for deal sourcing and diligence. Publication date unverified (https://www.fuld.com/private-equity-artificial-intelligence-here-to-stay/).

**ASSUMPTION-labelled sizing.** Illustrative arithmetic, not a forecast. Replace it with pipeline data.

- **TAM (global software spend on deal intelligence and relationship tooling by private-capital managers).**
  - US$13T AUM (cited) × ASSUMPTION 0.01% of AUM spent annually on sourcing, diligence and CRM software ≈ **US$1.3bn/yr**.
- **SAM (Africa and GCC private-capital corridor, the FDN focus).**
  - Investors: ASSUMPTION 1,500 active investor organisations × ASSUMPTION US$6,000/yr per organisation subscription ≈ US$9.0M/yr.
  - Founders: ASSUMPTION 20,000 companies actively fundraising per year × ASSUMPTION 5% buying Pro at US$600/yr ≈ US$0.6M/yr.
  - **SAM ≈ US$9.6M/yr of software revenue.** The optional facilitation fee and FDN execution services are excluded (UNKNOWN).
- **SOM (3-year capture).**
  - ASSUMPTION 5% of SAM investor organisations: 75 × US$6,000 = US$0.45M.
  - ASSUMPTION 25% of SAM founder revenue: US$0.15M.
  - **SOM ≈ US$0.6M ARR.**
  - A facilitation fee of ASSUMPTION 1% on capital raised through the platform would dominate this figure if adopted. AVCA's US$3.9bn deployed implies 1% of a 1% platform share ≈ US$0.39M/yr. That illustrates sensitivity only.

## 14. Capital intensity

- **Software-light, model-heavy.** The cost drivers are:
  - model inference (Q, voice, rehearsals with Tavus video faces, web research);
  - video storage and CDN (Cloudflare Stream);
  - four Railway services and hosted Supabase.

  Gated features are exactly the model-heavy ones (ADR 0034).

- **Human Execution (Layer 3)** is services revenue with people cost, delivered by FDN.
- **Unit costs: UNKNOWN.** No cost-per-active-user data is in the repository.

## 15. Regulatory and operational risks

1. **Investment-advice and securities rules.** Matching founders with investors, scoring investability and taking a facilitation fee may trigger broker-dealer, investment-adviser or crowdfunding rules. The relevant regimes include Nigeria's SEC (ISA 2025), the QFC/QFMA in Qatar, the EU (MiFID/ECSP) and the US.
   - The PADL keeps capital-form advice with human FDN advisory (#74).
   - Legal analysis is needed before any success fee is charged.
2. **Score credibility.**
   - InvestIQ constants are uncalibrated hypotheses.
   - Unicorn Potential has 0 numeric production scores, and its weights are "provisional product assumptions".
   - Marketing must not imply validated predictions. The landing page's animated example values (for example "92%") are illustrative.
3. **Data protection.** Founder-private financial data and EU residency are in scope (GDPR, NDPA 2023, Qatar PDPPL). Release-blocking invariant: founder-private data must never alter investor-facing ranking (Final System Review Finding 2).
4. **Model-provider dependency and cost.** All model calls go through the gateway, but voice and video depend on third-party vendors.
5. **Naming and IP.** InvestIQ belongs to FDN; the ™ marks are unregistered as far as known; the surname of a cofounder is inconsistent between sources. Product ownership between FDN and Capital Q is UNKNOWN.
6. **Operational maturity.** Recent handoff entries show:
   - merge collisions that broke production builds (`STATE.md`, 2026-10-18);
   - an invalid Supabase management token;
   - credentials exposed in chat that need rotation (`START-HERE.md`).
7. **Marketplace dynamics.** Value depends on enough evidence-rich companies and active investors. Today most evidence is self-reported, so most scores stay hidden.

## 16. Roadmap options

- **From the repository and handoff:**
  - InvestIQ calibration on the FDN pilot (v2);
  - Unicorn inputs v4 release and evidence-gap prompts;
  - Relationship Hub H2;
  - billing activation (ADR 0034);
  - a custom domain;
  - the Q Pitch certified tour;
  - per-decision PADL implementation matrix.
- **Analyst options (ASSUMPTION):**
  - a white-label GateQ for accelerators and investment-promotion agencies (the Qatar demo pattern);
  - an FDN-led pilot cohort, to generate verified evidence and the first calibrated scores;
  - a data-partner integration (registries, accounting APIs) to move evidence from SELF_REPORTED to DOCUMENT_SUPPORTED.

## 17. Open questions

1. Which legal entity owns Capital Q's IP and contracts with customers? How is it related to FDN Capital Partners?
2. Cofounder surname: "Okonkwo" (owner-provided) or "Nwankwo" (FDN team page)? Cap table and roles?
3. Will a custom app domain be bought? Should `LANDING-PROMISES.md` be updated to the `/capitalq/` URL?
4. Pricing, the facilitation-fee decision and its regulatory analysis.
5. Waitlist size, pilot customers, and any signed LOIs (none evidenced).
6. Calibration timeline for InvestIQ and Unicorn Potential.
7. Status of the trademark filings for CapitalQ™, Investment Snapshot™, Investability IQ™ and Investment Radar™.

## Brand

See `brand.md` and `brand.json`:

- accent blue `#1767D1` (light) / `#66A5FF` (dark);
- verified gold `#E0AF3B`;
- app icon gold `#C9A227` on `#16140F`;
- system UI font stack.
