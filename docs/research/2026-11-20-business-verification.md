# Checking that a business is real, and that the founder runs it

Research note, 20 November 2026. Status: **research and recommendation only**. Nothing here is built, certified or approved. Any change to `evidence.verification_claims` (new methods, new providers) is a proposed migration that needs the integration owner and the product owner first.

Numbers in square brackets, such as [12], point to the sources list at the end. Where a vendor does not publish a price, this note says so; it does not guess one as if it were real.

---

## 1. The short answer

- **What investors need to know** comes down to two questions. Does this company legally exist? Is the person on the other end really someone who runs it? Everything else (revenue, traction, the team) is due diligence, and Capital Q already handles that as evidence with its own truth class.
- **No single check answers both questions.** A registry tells you the company exists and who its directors are. An ID check plus a selfie tells you who the person is. **The useful step is the match:** the verified person's name appears on the registry as a director or shareholder. Platforms that do this properly, such as Stripe Connect [41][42] and Paystack [44][45], always tie the person to the company.
- **Recommended launch design (the cheap option).** Four badges:
  - **Email verified**: the founder controls a work email on the company's domain.
  - **Registry matched**: the company is on the official register, it is active, and its name and number match.
  - **Founder ID verified**: a government ID plus a live selfie, and the name matches a director or shareholder on the register.
  - **Fully verified**: all of the above, plus a bank account in the company's name and an operator sign-off.

  Use one African KYB API for Nigeria, Kenya and South Africa (Dojah, Youverify, Prembly or Smile ID), the free UK Companies House API, and an operator queue for everywhere else.

- **Cost per verified company:**

  | Tier                | Cost                                                            |
  | ------------------- | --------------------------------------------------------------- |
  | Email verified      | about $0                                                        |
  | Registry matched    | about $0 to $5                                                  |
  | Founder ID verified | about $1 to $7 more                                             |
  | Fully verified      | about $3 to $15 in fees, plus 10 to 20 minutes of operator time |

  §7 shows the working. Most African vendors quote prices privately, so get quotes before relying on the Nigeria figures.

---

## 2. The verification ladder, from cheap to strong

Each rung answers a narrower question. None of them proves that a business is _good_: that is evidence and assessment, which is a separate axis in Capital Q.

### 2.1 Work-email domain control

- **What it proves:** the person can receive mail at `name@company.com` right now.
- **What it doesn't prove:**
  - that the domain belongs to the legal entity;
  - that the person is senior. Any employee, contractor or ex-employee with a live mailbox passes.
  - anything at all for Gmail or Yahoo addresses, which many early African startups use.
- **Cost:** effectively nil; one transactional email.
- **Friction:** very low; one click.
- **Note:** a stronger variant is DNS control. The founder adds a TXT record to the domain, which is how Google Workspace proves domain ownership [52]. This proves admin control of the domain, which is much stronger than owning one mailbox.

### 2.2 Website and DNS checks

- **What it proves:** the domain exists and how old it is. RDAP has replaced WHOIS for generic domains, and it returns the registration date [53][54]. It also shows whether a live site names the same company and registration number, and whether the domain has mail records.
- **What it doesn't prove:** who owns the domain. Registrant details are mostly hidden now [54]. A week-old domain is a fraud signal, not proof of fraud.
- **Cost:** free to cheap (public lookups).
- **Friction:** none. It runs in the background.

### 2.3 Official company registry lookup

- **What it proves:**
  - a company with this exact legal name and number exists;
  - its status (active, dissolved, struck off);
  - often its registered address and incorporation date.
- **What it doesn't prove:**
  - that the person in front of you is connected to it;
  - that the company trades;
  - that the filings are true. Registries record what is filed; most don't check it.
- **Cost:** from free to a few dollars per lookup (§3).
- **Friction:** low. The founder types a registration number (for example RC 1234567 for a Nigerian company, BN for a business name [9]).

### 2.4 Director and shareholder matching

- **What it proves:** that the claimed founder's name appears as a director, shareholder or person with significant control.
  - Nigeria's CAC has a free public beneficial-ownership register [25].
  - Provider "advanced" CAC calls return directors, proprietors and shareholders as "affiliates" [5].
  - In the UK, Companies House now requires directors and people with significant control to verify their identity, which makes UK officer names more reliable [20][21].
- **What it doesn't prove:** that the person _using the account_ is that director, because names are not unique. It must be combined with an ID check (§2.5).
- **Cost:**
  - Nigeria: the "advanced" CAC tier, which costs a little more than basic [6].
  - UK: free.
- **Friction:** none for the founder once the registry lookup has run.

### 2.5 Founder ID document plus selfie liveness

- **What it proves:**
  - the person holds a genuine-looking government ID;
  - the face on camera matches it;
  - the face belongs to a live person.
- **In Nigeria**, providers can also check NIN or BVN against government databases. Paystack asks Nigerian directors to consent to BVN validation [44].
- **What it doesn't prove:**
  - any link to the company, unless you also do the name match in §2.4;
  - complete safety. Deepfake "injection" attacks feed a fake video stream into the camera, and they are rising. Entrust/Onfido recorded a deepfake attempt about every five minutes in 2024 [57], and cheap bypass kits are sold online [58].
- **Cost:** published self-serve prices are roughly $0.80 to $1.89 per check:
  - Veriff [33]
  - Sumsub [31]
  - Stripe Identity, about $1.50 [56]

  Smile ID, Dojah and Youverify quote privately [16][30][35].

- **Friction:** medium. It takes 1 to 3 minutes on a phone, and some founders drop out here.
- **Legal:** a face scan counts as biometric data, which is sensitive personal data under Nigeria's Data Protection Act 2023 and needs explicit consent [55].

### 2.6 Bank account name match

- **What it proves:** a bank account exists in the company's legal name, and the founder can name it. Paystack's resolve endpoint returns the account holder's name for Nigerian and Ghanaian accounts [46]. Mono and Dojah offer similar lookups [47][48]. Paystack itself requires a corporate account in the same name as the registration document [44].
- **What it doesn't prove:** that the founder controls the account. A name lookup only reads the name. Proving control needs a small deposit or open-banking consent, and Africa's open-banking layer is fragile: Okra shut down in 2025 [49].
- **Cost:** low (cents per lookup, or bundled with a payments provider).
- **Friction:** low for name match; higher for proof of control.

### 2.7 Tax ID

- **What it proves:** the company is known to the tax authority.
  - In Nigeria, FIRS became the NRS on 1 January 2026, with a new 13-digit Tax ID. The NRS is replacing its TIN validation API [26][27].
  - Dojah and Youverify offer TIN validation [26][28].
- **What it doesn't prove:** that the company pays tax, or anything about the person.
- **Cost:** low per lookup (unpublished).
- **Friction:** low, but many pre-revenue startups don't have one or don't know it. Treat a missing tax ID as unknown, never as negative.

### 2.8 Proof of address

- **What it proves:** a utility bill or bank statement from the last six months shows that name at that address. Paystack uses this six-month rule [44].
- **What it doesn't prove:** much. These documents are easy to fake, and checking them is manual.
- **Cost:** operator time, or an add-on in some vendors' higher plans [31].
- **Friction:** high for a low gain. **Recommendation: skip it** for Capital Q, which does not hold money.

### 2.9 LinkedIn and web presence

- **What it proves:** a public footprint that is consistent over time: a company page, founders who list the role, press coverage.
  - LinkedIn verifies company pages only for Premium Company Page customers, checks the domain, and lets employees verify their workplace once the page is verified [50].
  - LinkedIn also offers "Verified on LinkedIn" for partners [51].
- **What it doesn't prove:** anything legal. Profiles are self-written.
- **Cost:** free to view. Scraping is against LinkedIn's terms, so an operator should look manually.
- **Friction:** none for the founder.

### 2.10 Investor or accelerator attestations

- **What it proves:** someone who has already done diligence vouches for the company. Examples: "We invested in X in 2025", or "X was in our cohort".
- **What it doesn't prove:** anything current. Attestations go stale, and the attester can be wrong or fake.
- **Cost:** nil, if the attester is already a verified Capital Q investor organisation. Otherwise it is operator time to confirm by email from the attester's own domain.
- **Friction:** low for the founder; a little effort for the attester.
- **Strength:** high, if the attester is verified. It is also a natural network effect for Capital Q.

### Ladder summary

| Rung                 | Proves the business exists | Proves the person runs it   | Cost per check                 | Founder friction |
| -------------------- | -------------------------- | --------------------------- | ------------------------------ | ---------------- |
| Work email           | weak                       | weak                        | ~$0                            | very low         |
| DNS TXT / site       | weak                       | medium (domain admin)       | ~$0                            | low              |
| Registry lookup      | **strong**                 | no                          | $0 to ~$5                      | low              |
| Director match       | strong                     | medium (name only)          | included in an advanced lookup | none             |
| ID + selfie          | no                         | **strong** (with the match) | ~$0.80 to $2                   | medium           |
| Bank name match      | medium                     | weak                        | cents                          | low              |
| Tax ID               | medium                     | no                          | cents                          | low              |
| Proof of address     | weak                       | weak                        | operator time                  | high             |
| LinkedIn / web       | weak                       | weak                        | ~$0                            | none             |
| Investor attestation | medium to strong           | medium                      | ~$0                            | low              |

---

## 3. Registries, country by country

| Country          | Registry                                                            | Free public search?                                                                                                                | Official API?                                                                                                                                                 | Practical route for Capital Q                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Nigeria**      | Corporate Affairs Commission (CAC)                                  | Yes, at search.cac.gov.ng, free and without an account [1][2]                                                                      | No public developer API found. Providers (Dojah, Prembly, Youverify, Smile ID) query it for you [5][7][9][12]                                                 | Provider API. Also the free CAC beneficial-ownership register, bor.cac.gov.ng, live since May 2023 [25]                                                                     |
| **Kenya**        | Business Registration Service (BRS), on eCitizen                    | Paid search; one report gives about Ksh 650 for an official search [13]                                                            | No public API found; bulk access is reportedly not permitted [14]. BRS v2 launched in 2026, with reported data issues [15]                                    | Smile ID or Youverify (both list BRS) [9][12]                                                                                                                               |
| **South Africa** | CIPC, plus the BizPortal front door                                 | Basic search via BizPortal; the eServices search needs a login [17][18]                                                            | A developer portal reportedly exists, but needs approval [19]                                                                                                 | Provider (Smile ID, Youverify) [9][12]                                                                                                                                      |
| **Ghana**        | Office of the Registrar of Companies (ORC)                          | The name search shows names only. Entity search costs GHS 30, or GHS 150 for charges and insolvency [22][23]                       | None found. The portal had a temporary outage in March 2026 [24]                                                                                              | Youverify lists Ghana [9]; otherwise an operator with an uploaded certificate                                                                                               |
| **Egypt**        | Commercial Register (Internal Trade Development Authority) and GAFI | Mostly enquiry-based and in Arabic; no open database [36][37]                                                                      | None found                                                                                                                                                    | Operator review of a certified commercial-register extract                                                                                                                  |
| **UK**           | Companies House                                                     | Yes                                                                                                                                | **Yes, free**: a REST API with a key, limited to 600 requests per 5 minutes [10][11]. Director ID verification has been mandatory since 18 November 2025 [20] | Direct integration; the cheapest good registry in the world                                                                                                                 |
| **US**           | 50 state registries; most startups are in **Delaware**              | The Delaware name search is free but **does not show status**. Status costs $10, a detailed status $20, and a certificate $50 [38] | No free API. Middesk aggregates state data [29]                                                                                                               | Operator check of Delaware status for high-value cases, or Middesk at scale. Federal beneficial-owner reporting no longer applies to US companies (FinCEN, March 2025) [39] |
| **EU**           | Each country's own register, linked by **BRIS**                     | The e-Justice "Find a company" search is free and covers EU/EEA limited companies [40]                                             | No single API. Public beneficial-owner registers were restricted after the November 2022 EU Court ruling [43]                                                 | BRIS for an operator check; Kyckr or Trulioo at scale                                                                                                                       |
| **Global**       | **OpenCorporates**                                                  | Free website                                                                                                                       | Paid API; plans reported from £2,250 a year [59]. It aggregates registries and can lag them, so it is not compliance-grade [24][60]                           | Good for a background "does this name exist anywhere?" signal, not as proof                                                                                                 |

Plain-English takeaway:

- Only the UK gives you a free, official, reliable API.
- Nigeria's data is good, but you reach it through a vendor.
- Kenya, Ghana and Egypt are patchy. Plan on operator review there.

---

## 4. Providers

Prices are only those publicly listed or reported by named third parties. "Quote" means the price is not published.

### 4.1 African providers

| Provider                   | KYB coverage                                                                      | What it checks                                                                                                               | Pricing                                                                         | API notes                                                                                  | Nigeria                                        |
| -------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| **Smile ID**               | Nigeria (CAC), Kenya (BRS), South Africa (CIPC); about 7 million companies [3][4] | Registration, incorporation, directors, beneficiaries; about 2-second responses [3]; strong biometric KYC across Africa      | Quote [16]                                                                      | Mature SDKs. The v3 KYB docs were "coming soon" in Nov 2026, so the legacy docs apply [61] | Yes, strongest on biometrics                   |
| **Youverify**              | CAC, CIPC, BRS, Ghana RGD [9]                                                     | Registry lookup, plus UBO, PEP, sanctions and adverse media [9][62]                                                          | Enterprise rate card; G2 lists bundles from $60 for 200 KYC checks a month [30] | Documented REST API [62]                                                                   | Yes; also TIN                                  |
| **Dojah**                  | Nigeria CAC (basic and advanced); global AML and document checks elsewhere [5][6] | Basic: name, type, status, RC, location. Advanced: address, date, share capital, **directors/shareholders** [5]              | Quote; the advanced lookup costs slightly more than basic [6]                   | Clean docs, a sandbox and a prepaid wallet [5]                                             | Yes; also TIN [26] and NUBAN name resolve [48] |
| **Prembly (IdentityPass)** | Nigeria CAC (RC, BN, IT numbers) [7]                                              | Advanced CAC verification                                                                                                    | Sales-led; no list price [8]                                                    | Public docs [7]                                                                            | Yes                                            |
| **VerifyMe (QoreID)**      | Nigeria-focused [63]                                                              | Identity, address, some business checks                                                                                      | Quote                                                                           | Little public KYB documentation found                                                      | Yes, but limited KYB                           |
| **Mono**                   | Nigeria                                                                           | Lookup suite, including bank account and identity lookups; pay per successful call; registered Nigerian businesses only [47] | Per call (unpublished)                                                          | API key in a header [47]                                                                   | Yes; useful for bank name match                |
| **Okra**                   | —                                                                                 | **Shut down in May 2025** [49][64]                                                                                           | —                                                                               | —                                                                                          | **Do not use**                                 |

### 4.2 Global providers

| Provider                            | Coverage                                                                       | What it checks                                                                            | Published pricing                                                                       | Africa / Nigeria                 |
| ----------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------- |
| **Middesk**                         | US                                                                             | Secretary of State filings, tax ID, watchlists                                            | Not published. Vendr reports about $2 to $5 per verification at moderate volume [29]    | No                               |
| **Persona**                         | Global KYC; KYB available                                                      | ID, selfie, database and business checks                                                  | Essential plan about $250 a month; the rest is quoted [32]. AngelList uses Persona [65] | ID documents, yes; no CAC depth  |
| **Sumsub**                          | Global                                                                         | ID, liveness, AML; **KYB only on Enterprise**                                             | $1.35 per check (minimum $149 a month) or $1.85 (minimum $299 a month); KYB quoted [31] | ID yes; KYB via Enterprise       |
| **Onfido (Entrust)**                | Global                                                                         | Document, biometric, database checks; acquired by Entrust in April 2024 [66]              | Quote                                                                                   | ID yes; no CAC KYB found         |
| **Trulioo**                         | Claims business data in 195 countries; depth varies [67]                       | Registry data, UBO                                                                        | Quote                                                                                   | Thin                             |
| **ComplyCube**                      | Global                                                                         | KYC, AML; a KYB "company lookup" on higher tiers                                          | Plans reported from $99 to $299 a month; the KYB price is not shown [68]                | ID yes                           |
| **Veriff**                          | Global                                                                         | ID and selfie                                                                             | $0.80, $1.39 or $1.89 per check (minimums $49 to $209 a month) [33]                     | ID yes; KYB not core             |
| **Alloy**                           | US/global orchestration                                                        | Decision engine over 120 to 270 data sources; continuous ("perpetual") KYB re-checks [69] | Quote                                                                                   | Through partners only            |
| **Kyckr**                           | 300+ registries in 100 to 120 countries; some live, some request-and-wait [34] | Live registry extracts, documents                                                         | Quote                                                                                   | Partial; depends on the registry |
| **Moody's Orbis (Bureau van Dijk)** | About 625 million entities [70]                                                | Ownership trees, financials                                                               | Enterprise licence                                                                      | Some coverage; not real-time     |
| **Stripe Identity**                 | Global ID and selfie                                                           | Document plus selfie                                                                      | About $1.50 per check in the US; first 50 reported free [56]                            | ID documents only                |

**For Capital Q:**

- Pick **one African KYB API** for Nigeria, Kenya and South Africa. Dojah or Youverify gives a cheap Nigeria-first start; Smile ID is better if you also want one vendor for biometrics.
- Use **Companies House** directly for the UK.
- Pick **one global ID-plus-selfie vendor** with self-serve pricing (Veriff, Sumsub or Stripe Identity) for founders outside Africa.
- Don't buy Middesk, Kyckr, Trulioo or Orbis until US or EU volume justifies a contract.

---

## 5. How comparable platforms do it

- **Stripe Connect.**
  - Collects the company's details, a **representative** with an ID document, **owners of 25% or more**, and directors.
  - Pauses payouts if they aren't verified [41][42].
  - Tells platforms that Stripe's checks do not replace their own obligations [42].
  - **Lesson:** always tie a named person to the company.
- **Paystack (Nigeria).**
  - Asks for different documents for each CAC entity type (RC, BN, IT).
  - Requires a CAC status report, a TIN, **two directors** with BVN consent, proof of address within six months, and a **corporate bank account in the same name** [44][45].
  - **Lesson:** for Nigeria, BVN or NIN plus the CAC status and a bank name match is the local norm.
- **Republic and Wefunder (US Reg CF).**
  - Must run a background and regulatory-history check on the issuer, its officers, directors and holders of 20% or more [71].
  - A company with a "bad actor" among them cannot raise [72][73].
  - FINRA has fined portals that overstated their diligence [74].
  - **Lesson:** never claim more checking than was done.
- **Crowdcube (UK).**
  - Says it checks the company, its legal structure, financials and directors through Creditsafe, Experian and Onfido [75].
  - The UK Financial Ombudsman has still found gaps in specific cases [76].
  - **Lesson:** badges must say exactly what was checked.
- **Seedrs (now Republic Europe).**
  - Verifies pitch claims before launch and again before completion.
  - Says 90% of applicants fail initial checks, but it does not audit accounts [77].
  - **Lesson:** re-check at the moment money moves.
- **AngelList.**
  - KYC and KYB for investing entities, with beneficial owners, run on Persona.
  - Accreditation is a separate step from identity [65][78].
  - **Lesson:** keep "who you are" separate from "what you are allowed to do". This matches Capital Q's rule that verification claims are separate from the truth and evidence axes.
- **Carta.**
  - Public material covers investor-side KYC: biometric ID scans and OFAC/PEP screening for fund investors [79].
  - Nothing found on company-side KYB.
- **LinkedIn.**
  - Company-page badges are checked against the domain, at LinkedIn's discretion, and can be revoked for abuse [50].
  - **Lesson:** a badge needs a revoke path.

---

## 6. Recommended design for Capital Q

### 6.1 The four badges

**Tier 1: Email verified**

- **Required checks:**
  - a one-time code sent to an address on the company domain;
  - the domain is not a free-mail domain;
  - the domain's RDAP record is older than 90 days, or else the case is flagged.
- **What investors see:** "Email verified · company.com". Shown only on the company profile, with the date.
- **What the badge must NOT imply:** that the company is registered.

**Tier 2: Registry matched**

- **Required checks:**
  - a registry lookup by number;
  - the status is active;
  - the legal name matches the profile (normalised: case, "Ltd/Limited", punctuation);
  - the jurisdiction is recorded.
- **What investors see:** "Registered in Nigeria · CAC RC 1234567 · active as of 20 Nov 2026".
- **What the badge must NOT imply:** that this person runs the company.

**Tier 3: Founder ID verified**

- **Required checks:**
  - a government ID plus a live selfie (NIN or BVN in Nigeria);
  - the verified name matches a director, shareholder or PSC on the registry record from Tier 2.
- **What investors see:** "Founder identity verified · director on the register". The investor sees the founder's name and the badge only; **never** the ID document, number, selfie or date of birth.
- **What the badge must NOT imply:** that the founder's claims or numbers are true.

**Tier 4: Fully verified**

- **Required checks:**
  - Tiers 1 to 3 within the last 12 months;
  - a bank account name match to the legal name;
  - a tax ID where the company has one (missing means unknown, not failed);
  - an operator sign-off.
- **What investors see:** "Fully verified by Capital Q · reviewed 20 Nov 2026".
- **What the badge must NOT imply:** that Capital Q endorses or recommends the investment.

Rules that follow from Capital Q's invariants:

- **Verification is a separate axis** (ADR-001). A badge never raises a company's truth class, evidence status, readiness or ranking by itself.
  - Investors may _filter_ by badge, because that is a declared rule.
  - Ranking must not quietly reward it beyond the versioned, documented weight.
  - Unverified means **unknown**, never "suspicious".
- **The ID data stays founder-private.** Only the claim (badge, date, method class) is visible to investors.
  - The document images and numbers stay with the provider, or in a restricted store; never in a model prompt.
  - Under Nigeria's Data Protection Act, biometric data needs explicit consent [55].
- **Multi-founder companies:** each founder verifies separately. The company shows "2 of 3 founders verified", and never rounds up.
- **Investor attestation** is an extra badge line, not a tier: "Backed by <verified investor org>". The attester confirms it inside Capital Q from their own verified organisation account.

### 6.2 Provider adapters, and where each result lands

The schema already has the right shape:

- `evidence.verification_claims` covers:
  - `claim_type`: `FOUNDER_IDENTITY`, `INVESTOR_IDENTITY`, `ORGANISATION` or `DOMAIN_CONTROL`;
  - `status`: `PENDING`, `VERIFIED`, `EXPIRED` or `REVOKED`;
  - monotonic revisions.
- `core.kyb_submissions` and `core.identity_submissions` hold what the founder submitted.
- `core.human_reviews` is the operator queue.
- **Gap:** `method` and `provider` currently allow only `SYNTHETIC_DEMO_ATTESTATION`/`OPERATOR_DECISION` and `CAPITAL_Q_SYNTHETIC_DEMO`/`CAPITAL_Q_OPERATOR`. Real providers need a **proposed, owner-approved migration** that widens these checked text columns. They are reference values, not enums.

Proposed flow:

1. **One adapter interface**, `BusinessRegistryProvider` and `IdentityProvider`, behind which sit Dojah, Smile ID, Companies House, Veriff and others. It follows the same pattern as `ModelProvider`: provider SDKs never leak into domain code.
   - Each call is a background **job** with an idempotency key.
   - No database transaction stays open across the provider call.
2. **The raw provider response** goes to a restricted, append-only store (provider reference, received time, hash). Only the normalised fields go further: legal name, number, status, officer names, match score.
3. **A deterministic matcher, not a model,** compares:
   - the registry name to the profile name;
   - the ID name to the officer names.

   Each comparison produces `MATCH`, `PARTIAL` or `NO_MATCH`, with reasons.

4. **Outcomes:**
   - `MATCH`: the system writes a new `verification_claims` revision with `status = VERIFIED`, `decided_by_actor_type = SYSTEM`, the provider, the provider reference and a short `decision_basis` ("CAC advanced lookup; status ACTIVE; name exact; director match on surname+given name").
   - `PARTIAL` or `NO_MATCH`: the system opens a `human_reviews` item and leaves the claim `PENDING`.
5. **The badge is a read projection** over the current claim revisions. It is not a column that someone flips.

### 6.3 Operator review queue (mismatches)

Send a case to the existing admin queue when:

- the names differ beyond normalisation, such as a trading name versus the legal name, or a business name (BN) versus a company (RC);
- the founder is not found among the officers. This is common when the founder holds shares through a holding company, or when the CAC data is stale;
- the registry is unavailable, or the jurisdiction has no API (Kenya without a provider, Ghana, Egypt, US states, most of the EU). The operator then checks an uploaded certificate against the official portal;
- a fraud signal fires (§6.5).

Each decision records:

- an outcome (`UPHELD`, `CHANGED` or `NEEDS_EVIDENCE`);
- a reason;
- a due date, already modelled in `human_reviews`.

Operators see the provider extract, never a model's opinion of it.

### 6.4 Re-verification over time

- **Registry status:** re-check every **6 months**, and before any consequential step, such as an investor opening a data room or moving to term sheets. On a dissolved or struck-off result, the system writes `REVOKED` with a reason, and the badge disappears.
- **Founder ID:** valid for **24 months**, or until the ID document expires. After that, `EXPIRED`, with a prompt to redo it.
- **Domain control:** re-check the TXT record or mailbox every **12 months**.
- **Officer changes:** in the UK, the Companies House streaming API or a periodic poll; elsewhere, re-check on the 6-month cycle. Alloy-style "perpetual KYB" is the scale version [69].

### 6.5 Fraud signals (each one routes a case to a person; none blocks automatically)

- the domain is younger than 90 days, or the site is a template with no registration number;
- a free-mail address paired with a claim to be a large company;
- the registry shows the company is dissolved, or incorporated days before sign-up;
- the ID name is not on the officer list, or the ID's date of birth conflicts with the registry;
- the same face, ID number, phone, bank account or device appears on multiple companies;
- a liveness check fails, or injection-attack signals appear (virtual camera, emulator). Deepfake injection is a live, growing threat [57][58]; ask vendors for test results under CEN/TS 18099 [58];
- the bank account name differs from the legal name;
- an attestation from an organisation that is not itself verified;
- the deck and profile name a team that LinkedIn and the web do not corroborate (operator judgement only; never automatic).

### 6.6 Cheapest launch option, versus scale option

**Launch, for the first ~500 companies:**

- **Tier 1:** a built-in email code plus a free RDAP lookup.
- **Tier 2:**
  - Nigeria: one KYB vendor (Dojah or Youverify), CAC advanced, pay as you go;
  - UK: Companies House, free;
  - everywhere else: the founder uploads a certificate and an operator checks the official portal (BRIS, Delaware $10 status, CIPC, ORC).
- **Tier 3:** the same African vendor for NIN or BVN plus a selfie in Nigeria; Veriff or Sumsub self-serve for other countries.
- **Tier 4:** a Paystack or Dojah name resolve, plus operator sign-off.
- **Vendors:** 2 to 3 contracts, no minimum over about $50 to $150 a month.

**Scale, for thousands of companies across many countries:**

- **Orchestration:** Alloy-style rules, or your own, with automatic re-checks.
- **Coverage:** Smile ID for pan-African biometrics and KYB; Kyckr or Trulioo for EU and global registries; Middesk for US states.
- **Monitoring:** continuous registry monitoring, and a duplicate-identity graph.
- **Vendors:** contracts with volume discounts; likely $10k to $50k+ a year in commitments [29][32].

---

## 7. Cost per verified company (estimates)

Assumptions, stated plainly:

- **Africa:** the African vendors' KYB prices are **not published** [6][8][16][30]. This note uses a planning range of **$0.50 to $2 per CAC advanced lookup** and **$0.50 to $2 per NIN or BVN plus selfie** until real quotes arrive. Replace these with the quoted rates.
- **Global:** ID-plus-selfie checks use the published $0.80 to $1.89 [31][33][56].
- **Operator time** is costed at 10 to 20 minutes per manual review. The team should insert its own hourly rate.
- **Retries:** about 1.3 attempts per success are allowed for on ID checks, because vendors bill completed checks [33].

| Tier (cumulative)   | Nigeria / UK (API path)                                                                            | Manual-registry country (Kenya, Ghana, Egypt, US, EU)                               |
| ------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Email verified      | ~$0                                                                                                | ~$0                                                                                 |
| Registry matched    | Nigeria ~$0.50 to $2; UK $0                                                                        | registry fee $0 to $10 (Delaware $10 [38], Ghana GHS 30 [23]) + **10 min operator** |
| Founder ID verified | +$1 to $3 → **~$1 to $5 total**                                                                    | +$1 to $2.50 → **~$1 to $13 + operator time**                                       |
| Fully verified      | +bank resolve (cents) + tax ID (cents) + **10 to 15 min operator** → **~$2 to $6 + operator time** | **~$3 to $15 + 20 to 30 min operator time**                                         |

Re-verification adds roughly the Tier 2 cost every six months. In practice **operator minutes, not API fees, are the main cost.** That is why the design auto-approves clean matches and sends only mismatches to people.

---

## 8. Open points for the product owner

1. **Schema:** approve widening the `verification_claims.method` and `provider` reference values for real providers, in a new forward-only migration.
2. **Vendor:** choose a Nigeria-first vendor after getting written quotes from Dojah, Youverify, Prembly and Smile ID for CAC advanced, NIN or BVN with selfie, and TIN.
3. **Badges:** confirm the investor-facing wording and that the tiers are visible to investors. Confirm that ranking uses a badge only as a declared filter or a documented, versioned weight.
4. **Retention:** decide the retention period for raw provider responses, and the NDPA consent text for biometrics.
5. **Certification:** none of this is certified. Any Q Pitch claim about "verified founders" must first map to an entry in `CERTIFICATION_MANIFEST.md`.

---

## Sources

1. Apify, Nigeria Company Search — CAC Registry Lookup: https://apify.com/mansalabs/cac-company-lookup
2. Legit.ng, How to verify a CAC certificate online: https://www.legit.ng/ask-legit/guides/1730212-how-verify-a-cac-certificate-online-minutes-office-visit-required/
3. Smile ID, Business verification solution: https://usesmileid.com/solutions/business-verification
4. TechCrunch, Smile Identity Series B (2023): https://techcrunch.com/2023/02/15/costanoa-ventures-and-norrsken22-back-smile-identity-in-20m-series-b-round
5. Dojah docs, CAC business verification: https://docs.dojah.io/overview/business-verification/cac
6. Dojah docs, Business verification dashboard guide: https://docs.dojah.io/dashboard-guide/verify/business-verification
7. Prembly docs, Advance CAC: https://docs.prembly.com/docs/advance-cac-copy
8. xpay.sh, Prembly pricing snapshot: https://www.xpay.sh/saas-pricing/prembly/
9. Youverify, Business registry verification in Africa (CAC, CIPC, registries): https://youverify.co/en/blogs/business-registry-verification-africa-kyb-cac-cipc-company-registries
10. Companies House, Developer guidelines: https://developer.company-information.service.gov.uk/developer-guidelines
11. Companies House, Rate limiting: https://developer-specs.company-information.service.gov.uk/guides/rateLimiting
12. Youverify, KYB compliance Nigeria guide: https://youverify.co/en/blogs/kyb-compliance-nigeria-cac-verification-aml-guide
13. Kenyans.co.ke, Verify a registered business in Kenya for Ksh 650: https://www.kenyans.co.ke/news/96818-simple-process-verify-registered-business-kenya-ksh-650
14. Business Data Guide, Kenya company search: https://businessdataguide.com/blog/jurisdictions/kenya-company-search-guide
15. Bowmans, Kenya companies registry reform agenda: https://bowmanslaw.com/insights/kenya-companies-registry-a-reform-agenda-for-ease-of-doing-business/
16. Smile ID docs, Pricing: https://docs.smileidentity.com/getting-started/pricing
17. BizPortal (CIPC): https://www.bizportal.gov.za/
18. OurPower, CIPC company lookup: https://www.ourpower.co.za/tools/company-registration/cipc-company-lookup
19. CompanyData, CIPC API: https://companydata.com/cipc-api/
20. GOV.UK, Companies House confirms identity verification rollout from 18 November 2025: https://www.gov.uk/government/news/companies-house-confirms-identity-verification-rollout-from-18-november-2025
21. CMS, ECCTA identity verification mandatory: https://cms.law/en/gbr/legal-updates/economic-crime-and-corporate-transparency-act-2023-identity-verification-became-mandatory-from-18-november-2025
22. Ghana ORC, Entity information search: https://orc.gov.gh/service/entity-information-search/
23. Ghana ORC, Fees: https://orc.gov.gh/fees.php
24. Business Data Guide, Ghana company search: https://businessdataguide.com/blog/jurisdictions/ghana-company-search-guide
25. Nairametrics, CAC launches beneficial ownership register: https://nairametrics.com/2022/11/26/cac-launches-beneficial-ownership-register-bor-platform-for-more-transparency/
26. Dojah docs, FIRS TIN: https://docs.dojah.io/overview/business-verification/firs-tin.md
27. Nairametrics, NRS unified Tax ID system (May 2026): https://nairametrics.com/2026/05/18/nrs-introduces-unified-tax-id-system-for-all-taxable-persons-in-nigeria/
28. Youverify, Tax ID verification Nigeria: https://youverify.co/en/blogs/tax-id-verification-nigeria-youverify
29. Vendr, Middesk pricing: https://www.vendr.com/marketplace/middesk
30. Capterra / G2, Youverify pricing: https://capterra.com/p/10007173/YouVerify
31. Sumsub, Pricing: https://sumsub.com/pricing/
32. Persona, Pricing: https://withpersona.com/pricing
33. Veriff, Pricing: https://www.veriff.com/pricing
34. Kyckr, Company register data: https://kyckr.com/company-register-data
35. Dojah blog, KYC pricing in Nigeria: https://dojah.io/blog/kyc-pricing-nigeria
36. GAFI, Egypt investor services: https://gafi.gov.eg/en/contenttemplate/7307ff68-c777-4c5b-8ed0-ebc6c6e80588
37. Business Data Guide, Egypt company search: https://businessdataguide.com/blog/jurisdictions/egypt-company-search-guide
38. Delaware Division of Corporations, FAQ: https://corp.delaware.gov/faq/
39. FinCEN, Removes beneficial ownership reporting for US companies: https://www.fincen.gov/news/news-releases/fincen-removes-beneficial-ownership-reporting-requirements-us-companies-and-us
40. European e-Justice, Find a company (BRIS): https://e-justice.europa.eu/topics/registers-business-insolvency-land/business-registers-search-company-eu/general-information-find-company_en
41. Stripe docs, Required verification information: https://docs.stripe.com/connect/required-verification-information
42. Stripe docs, Identity verification for connected accounts: https://docs.stripe.com/connect/identity-verification
43. Transparency International, CJEU ruling on EU beneficial ownership registers: https://www.transparency.org/en/blog/cjeu-ruling-eu-public-beneficial-ownership-registers-what-next-for-corporate-transparency
44. Paystack, What documents do I need for my Nigerian business: https://support2.paystack.com/hc/en-us/articles/360018458659-What-documents-do-I-need-to-complete-the-compliance-exercise-for-my-Nigerian-business
45. Paystack, Compliance requirements for Nigeria: https://support.paystack.com/en/articles/2123970
46. Paystack docs, Verify account number: https://paystack.com/docs/identity-verification/verify-account-number/
47. APIs.io, Mono Lookup API: https://apis.io/apis/mono-africa/mono-africa-lookup-api/
48. Dojah docs, Resolve NUBAN: https://docs.dojah.io/api-reference/financial-credit/resolve-nuban
49. NextBillion, Inside the fall of Okra: https://nextbillion.net/news/inside-the-fall-of-okra-how-africas-most-promising-open-banking-startup-shut-down-at-its-peak
50. LinkedIn Help, Request verification for your LinkedIn Page: https://www.linkedin.com/help/learning/answer/a7174627
51. LinkedIn News, Verified on LinkedIn: https://news.linkedin.com/2025/Verified_on_LinkedIn
52. Google Workspace, Verify your domain with a TXT record: https://support.google.com/a/answer/183895
53. ICANN, Launching RDAP, sunsetting WHOIS: https://icann.org/en/announcements/details/icann-update-launching-rdap-sunsetting-whois-27-01-2025-en
54. Dynadot, WHOIS vs RDAP: https://www.dynadot.com/blog/whois-vs-rdap
55. Future of Privacy Forum, Nigeria's Data Protection Act explained: https://fpf.org/blog/nigerias-new-data-protection-act-explained/
56. Stripe, Identity: https://www.stripe.com/identity
57. Infosecurity Magazine, One deepfake identity attack every five minutes (Entrust 2025 report): https://www.infosecurity-magazine.com/news/deepfake-identity-attack-every/
58. Biometric Update, Deepfake-as-a-service and identity fraud: https://www.biometricupdate.com/202601/deepfake-as-a-service-revolutionizing-biometrics-spoofing-and-identity-fraud-report
59. European Purpose, OpenCorporates listing (pricing): https://europeanpurpose.com/tool/opencorporates
60. OpenCorporates, Pricing: https://opencorporates.com/pricing/
61. Smile ID docs, Business verification (v3): https://docs.usesmileid.com/products/onboarding-businesses/business-verification.md
62. Youverify docs, Know Your Business services: https://doc.youverify.co/business-verification-services
63. Biometric Update, VerifyMe Nigeria international expansion: https://www.biometricupdate.com/202209/verifyme-nigeria-begins-international-expansion-rolls-out-digital-id-orchestration-platform
64. Nairametrics, Okra shuts down: https://nairametrics.com/2025/07/03/nigerian-fintech-okra-shuts-down-as-co-founder-fara-ashiru-moves-to-uks-kernel
65. Persona, AngelList customer story: https://withpersona.com/customers/angellist
66. Entrust, Completes acquisition of Onfido: https://entrust.com/company/newsroom/entrust-completes-acquisition-of-onfido-creating-a-new-era-of-identity-centric-security
67. Trulioo, KYB verification: https://www.trulioo.com/solutions/business-verification/kyb-verification
68. ComplyCube, Pricing: https://complycube.com/pricing
69. Alloy, Perpetual KYB solution: https://www.alloy.com/kyb-solution
70. Moody's, Orbis: https://www.moodys.com/web/en/us/capabilities/company-reference-data/orbis.html
71. SEC, Regulation Crowdfunding intermediary FAQs: https://www.sec.gov/divisions/marketreg/tmcompliance/cfportal-faqs
72. Republic, What is a bad actor check: https://republic.co/help/what-is-a-bad-actor-check
73. Republic, Issuer ineligibility: https://republic.com/learn/issuers/ineligibility
74. Goodwin, Four lessons from two FINRA enforcement actions against crowdfunding portals: https://www.goodwinlaw.com/en/insights/publications/2022/05/05_11-four-lessons-from-two-finra-enforcement
75. Crowdfund Insider, Crowdcube publishes Due Diligence Charter: https://www.crowdfundinsider.com/2016/11/93108-crowdcube-publishes-due-diligence-charter-addressing-commitment-transparency-guiding-principles/
76. Financial Ombudsman, Decision DRN7590473 (Crowdcube): https://www.financial-ombudsman.org.uk/decision/DRN7590473.pdf
77. Republic Europe, Due diligence: the Seedrs Standard: https://europe.republic.com/insights/due-diligence-the-seedrs-standard
78. AngelList Help, What is AngelList's KYC verification process: https://help.angellist.com/hc/en-us/articles/4409973772301-What-is-AngelList-s-KYC-verification-process
79. Carta, KYC onboarding process in private markets: https://carta.com/learn/private-funds/regulations/aml-kyc/kyc-onboarding/
