# Data room research (A3)

Research agent M1, 2026-10-06. Feeds A1 (tabs), A3 (data room), A4 (deck download control), A8 (Q tools).

## 1. Summary for builders

- A seed data room holds roughly 15-40 documents; Series A 30-70. Investors do not want volume; they want the right ten documents fast, then the rest when diligence is real ([Papermark](https://www.papermark.com/blog/startup-data-room-checklist.md), [Peony](https://www.peony.ink/blog/startup-data-room-checklist)).
- Every serious tool converges on the same core: **folders by category, per-folder or per-document permissions, view analytics, optional watermark, download on/off, expiring access, NDA gate, request access** (DocSend, Carta, Visible, Datasite; sources in section 4).
- Industry practice is **staged disclosure**: Level 1 (interest) deck and summary; Level 2 (serious diligence) financials, cap table, contracts; Level 3 (term sheet) employment, tax, compliance ([Peony](https://www.peony.ink/blog/startup-data-room-checklist)). Capital Q should model this as visibility per document, not as separate rooms.
- Africa matters: investors run a registry search (CAC in Nigeria, CR12 in Kenya, CIPC in South Africa) and compare it with the deck and cap table. Mismatches are the commonest red flag ([Corporate Bestie](https://corporatebestie.com/2025/11/20/the-right-way-to-structure-a-nigerian-company-for-startup-funding/), [Mondaq / Oyinlade](https://webiis10.mondaq.com/nigeria/contracts-and-commercial-law/1726102/investment-readiness-and-due-diligence-a-practical-guide-for-startups-and-investors-in-nigeria)).
- Capital Q's locked rule applies: **Q Knowledge ≠ Data Room disclosure**. Q reading a document to help the founder does not make its contents visible to an investor. The existing permission `data_room.share` (migration `20260903090000_organisation_service.sql`) is the hook.

## 2. Sensitivity levels (map to ADR-001 visibility scopes)

| Capital Q level (UI word) | Meaning | ADR-001 scope | Default for |
|---|---|---|---|
| **Public** | Anyone on the network sees it on the profile | `network_visible` (never `public_external` unless founder publishes a public link) | Deck (view), one-pager, product demo |
| **On request** | Listed (title, category, date) but locked; investor taps "Request access"; founder approves per investor | `specifically_shared` once approved | Financials summary, cap table summary, traction proof |
| **Shared after NDA / in diligence** | Hidden from the list entirely until shared with a named relationship | `relationship_shared` / `specifically_shared` | Contracts, full cap table, legal, HR, tax, KYC |
| **Private** | Only the founder's organisation | `organisation_private` / `founder_private` | KYC of individuals (passports, BVN/NIN), bank statements, payroll |

Rule for UX: "On request" shows the document exists (helps the founder look prepared); "Private" and unshared diligence documents do not even show their titles to investors, because a title can leak information (for example "Litigation with X").

## 3. Taxonomy by category and stage

Stage columns: P = pre-seed, S = seed, A = Series A, B = Series B. "●" expected, "○" nice to have / usually asked later, "–" not expected. Default level: Pub / Req / NDA / Priv as above. File types: PDF unless noted.

### 3.1 Fundraising and summary

| Document | P | S | A | B | Default | Who sees it, when | Types |
|---|---|---|---|---|---|---|---|
| Pitch deck | ● | ● | ● | ● | Pub (view only; download set by founder, A4) | Everyone at first look | PDF, PPTX, Keynote, Google Slides link |
| One-pager / executive summary | ● | ● | ● | ○ | Pub | First look | PDF |
| Elevator video / demo video | ● | ● | ● | ○ | Pub | First look | MP4/MOV (goes to Stream, not Postgres) |
| Product demo / screenshots | ○ | ● | ● | ● | Pub | First look | MP4, PNG, link |
| Financial model (3-5 yr) | ○ | ● | ● | ● | Req | After first call | XLSX, Google Sheets |
| Use of funds / budget | ● | ● | ● | ● | Req | After first call | PDF/XLSX |
| Round terms: SAFE / term sheet draft | ○ | ● | ● | ● | NDA | Term sheet phase | PDF, DOCX |
| Investor updates (past) | – | ○ | ● | ● | Req | Diligence | PDF, email export |
| Market sizing / research | ○ | ● | ● | ● | Req | After first call | PDF |
| Competitive analysis | ○ | ● | ● | ● | Req | After first call | PDF |
| Customer references (with permission) | – | ○ | ● | ● | NDA | Late diligence | PDF list |

### 3.2 Corporate and incorporation

| Document | P | S | A | B | Default | Types |
|---|---|---|---|---|---|---|
| Certificate of incorporation | ● | ● | ● | ● | Req | PDF |
| Constitution: Memorandum and Articles (MemArt) / Delaware Certificate + Bylaws | ● | ● | ● | ● | NDA | PDF |
| Registry extract: shareholders and directors | ● | ● | ● | ● | NDA | PDF |
| Certificate of good standing / status report | ○ | ● | ● | ● | Req | PDF |
| Group structure chart (holdco / opco, e.g. Delaware or UK parent with Nigerian, Kenyan subsidiaries) | ○ | ● | ● | ● | NDA | PDF, PNG |
| Board and shareholder minutes, written resolutions | – | ○ | ● | ● | NDA | PDF |
| Statutory registers (members, directors, charges, PSC/beneficial owners) | – | ○ | ● | ● | NDA | PDF, XLSX |
| Shareholders' agreement / investor rights agreements | ○ | ● | ● | ● | NDA | PDF |
| Founder agreement (vesting, roles) | ● | ● | ● | ● | NDA | PDF |
| Registered charges / security interests | – | ○ | ● | ● | NDA | PDF |

Jurisdiction specifics:

- **Nigeria (CAC)**: Certificate of Incorporation (RC number); Form CAC 1.1 (replaced CAC 2, 2.1, 3, 4, 7 at incorporation) showing shareholders, directors, persons with significant control; MemArt; CAC status report / certificate of good standing (confirms annual returns are filed); annual returns receipts; persons with significant control (PSC) register under CAMA 2020 ([Mondaq, CAC initiatives](https://admin.mondaq.com/nigeria/corporate-and-company-law/591052/ease-of-doing-business-in-nigeria-new-initiatives-from-the-corporate-affairs-commission), [Paperform CAC good standing](https://paperform.co/templates/cac-certificate-of-good-standing-request-form)). Foreign-owned: NIPC registration certificate, Certificate of Capital Importation (CCI) for each foreign investment (needed to repatriate dividends and exit proceeds); expatriate quota if foreign staff.
- **Kenya**: Certificate of incorporation; **CR12** (official list of directors and shareholding from the Registrar, usually requested dated within 3 months); MemArt; beneficial ownership register ([KRA guide](https://www.kra.go.ke/images/publications/Foreign-Investors-Tax-Guide-Document.pdf), [Mondaq KRA](https://mondaq.com/tax-authorities/1173654/ensuring-compliance-with-the-kenya-revenue-service-tax-registration-in-kenya)).
- **South Africa (CIPC)**: **CoR14.3** registration certificate; MOI (Memorandum of Incorporation); CoR39 (directors); share register (the CIPC register often has gaps, so share ownership is verified separately); SARB exchange-control approval for offshore structures ("flip" approvals) can stall a deal for months ([Govchain CoR14.3](https://govchain.co.za/terms/registration-certificate-cor14-3), [Ellty SA due diligence](https://www.ellty.com/blog/due-diligence-checklist-south-africa)).
- **UK (Companies House)**: certificate of incorporation, articles, confirmation statement, PSC register, SH01 allotment filings; SEIS/EIS advance assurance letters (UK angels ask for these first).
- **Delaware C-corp**: Certificate of Incorporation (and amendments), bylaws, Delaware good standing, EIN letter, 83(b) elections for founders, 409A valuation.

### 3.3 KYC / KYB

| Document | Stage | Default | Notes |
|---|---|---|---|
| Founder / director IDs (passport, national ID: NIN in Nigeria, Kenyan ID, SA ID) | S onward, mostly at close | **Priv**, shared only at closing to the investor's compliance team | Never in the browsable room; expiring share only |
| Proof of address for directors | close | Priv | |
| BVN (Nigeria) | close | Priv | Treat as highly sensitive identifier; never displayed |
| Beneficial ownership declaration (UBO ≥ 5-25% depending on jurisdiction) | S onward | NDA | |
| Company bank account letter / reference | close | Priv | |
| SCUML certificate (Nigeria, for designated non-financial businesses) | where applicable | Req | |
| Sanctions / PEP self-declaration | close | NDA | |

KYB is a separate workflow in Capital Q (`verification_claims`, ADR-001); the data room only stores the evidence files.

### 3.4 Cap table and equity

| Document | P | S | A | B | Default | Types |
|---|---|---|---|---|---|---|
| Cap table summary (founders / ESOP / investors %) | ● | ● | ● | ● | Req | PDF |
| Fully diluted cap table | ○ | ● | ● | ● | NDA | XLSX, Carta export |
| Pro forma cap table post-round | – | ● | ● | ● | NDA | XLSX |
| All SAFEs, convertible notes, KISS, ASAs (with caps / discounts) | ● | ● | ● | ● | NDA | PDF |
| Previous round documents (SHA, SSA) | – | ○ | ● | ● | NDA | PDF |
| ESOP plan and board approval; grant ledger | – | ○ | ● | ● | NDA | PDF, XLSX |
| 409A (US) / share valuation | – | ○ | ● | ● | NDA | PDF |
| Share certificates / allotment filings | – | ○ | ● | ● | NDA | PDF |

### 3.5 Financials

| Document | P | S | A | B | Default | Types |
|---|---|---|---|---|---|---|
| Key metrics dashboard (MRR/ARR, GMV, growth, burn, runway) | ○ | ● | ● | ● | Req | PDF, XLSX, link |
| Management accounts, monthly (P&L, balance sheet, cash flow) | – | ○ (6-12 m) | ● (12-24 m) | ● (36 m) | NDA | XLSX, PDF |
| Audited financial statements | – | – | ○ | ● | NDA | PDF |
| Bank statements | – | ○ | ● | ● | Priv → NDA | PDF |
| Revenue by customer, cohort retention, unit economics (LTV/CAC) | – | ○ | ● | ● | NDA | XLSX |
| Debt schedule (loans, venture debt, revenue-based finance) | ○ | ● | ● | ● | NDA | PDF, XLSX |
| Budget vs actual | – | ○ | ● | ● | NDA | XLSX |
| FX exposure note (naira, shilling, rand revenue vs USD costs) | ○ | ● | ● | ● | NDA | PDF |

Combination risk (CLAUDE.md Context Firewall): cash + burn + payroll implies runway. Q must not derive runway for an investor from documents the investor was not shown.

### 3.6 Tax and statutory compliance

| Document | Stage | Default |
|---|---|---|
| Tax ID: TIN (Nigeria, FIRS/NRS), KRA PIN certificate (Kenya), SARS tax reference (SA), EIN (US), UTR (UK) | S onward | Req |
| Tax clearance certificate (Nigeria TCC; Kenya Tax Compliance Certificate; SA Tax Compliance Status pin) | S onward | Req |
| Corporate tax returns | A onward | NDA |
| VAT registration and returns | A onward | NDA |
| Payroll tax: PAYE remittances | A onward | NDA |
| Nigeria: pension (PenCom) compliance certificate, NSITF, ITF, NHF | A onward | NDA |
| Kenya: NSSF, SHIF (formerly NHIF), Housing Levy | A onward | NDA |
| SA: UIF, SDL registration; B-BBEE certificate or affidavit | A onward | Req (B-BBEE often public) |
| Transfer pricing documentation (groups) | B | NDA |

### 3.7 Legal

| Document | Stage | Default |
|---|---|---|
| Litigation summary (pending, threatened, past) | S onward | NDA |
| Material contracts list | A | NDA |
| Regulatory correspondence | A | NDA |
| Insurance policies (D&O, cyber, professional indemnity) | A | NDA |
| Privacy policy and terms of service | P onward | Pub |
| Data protection: Nigeria NDPC registration (data controller / processor of major importance) and annual Compliance Audit Returns under the GAID 2025 (in force Sept 2025); Kenya ODPC registration under the Data Protection Act 2019; SA POPIA information officer registration with the Information Regulator; DPO appointment; breach log | S onward | Req ([Mondaq GAID](https://www.mondaq.com/nigeria/privacy-protection/1620778/synoptic-analysis-of-the-nigeria-data-protection-act-general-application-and-implementation-directive-gaid-2025), [LawPavilion](https://blog.lawpavilion.com/ndp-act-2023-gaid-2025-a-comprehensive-guide-to-nigerias-new-data-protection-landscape)) |

### 3.8 Intellectual property

| Document | Stage | Default |
|---|---|---|
| IP assignment from every founder, employee and contractor | P onward (critical) | NDA |
| Trademarks (registered / applied), domain registrations | S | Req |
| Patents and applications | S onward | Req |
| Open-source licence audit / SBOM | A | NDA |
| Third-party software licences | A | NDA |
| Nigeria: NOTAP registration of technology transfer agreements (needed to remit foreign licence fees) | A where applicable | NDA |

### 3.9 Team and HR

| Document | Stage | Default |
|---|---|---|
| Founder and team bios / org chart | P onward | Pub |
| Employment contracts (key hires), contractor agreements | A | NDA |
| Non-compete / confidentiality agreements | S | NDA |
| Employee handbook / policies | A | NDA |
| Hiring plan | S | Req |
| Payroll summary | A | Priv → NDA (headcount cost only) |
| Work permits / expatriate quota (Nigeria), work permits (Kenya, SA) | A | NDA |
| Advisory agreements (with equity) | S | NDA |

### 3.10 Commercial contracts

Top customer contracts, LOIs and pilots (S: LOIs; A: signed contracts), supplier and partner agreements, distribution / reseller, SLAs, MoUs, government contracts. Default NDA; LOIs often Req. Investors want customer names redacted at first look; offer a **redacted copy plus a full copy** as two versions of one document.

### 3.11 Product and technology

Product roadmap (Req), architecture overview (A, NDA), security posture (SOC 2 / ISO 27001 reports or a security questionnaire; NDA), penetration test summary (NDA), uptime / incident history (A), data map (NDA), metrics from analytics tools (Req).

### 3.12 Regulatory and licences (sector-specific, very relevant in Africa)

| Sector | Nigeria | Kenya | South Africa |
|---|---|---|---|
| Payments / fintech | CBN licences (PSSP, PSP, switching, MMO), CBN sandbox letter | CBK PSP licence, authorisation as e-money issuer | SARB / PASA registration, FSCA FSP licence |
| Lending | State money-lender licence (e.g. Lagos), FCCPC digital lending registration (2025 regulations) | CBK Digital Credit Provider (DCP) licence | NCR credit provider registration |
| Investments / crypto | SEC Nigeria registration (incl. digital asset regime under ISA 2025) | CMA licence / sandbox | FSCA CASP licence |
| Insurance / insurtech | NAICOM | IRA | FSCA / Prudential Authority |
| Telecoms / data | NCC licence | CA licence | ICASA licence |
| Health | NAFDAC, MDCN where relevant | Pharmacy and Poisons Board, KMPDC | SAHPRA |
| Logistics / mobility | State transport permits | NTSA | Operating licence |

Default: licence certificates **Pub or Req** (they are a strength); correspondence with regulators NDA. Verify the exact current licence names per company; regimes changed in 2024-25 (FCCPC digital lending, ISA 2025).

### 3.13 ESG and impact

Impact metrics (jobs created, women-led, financial inclusion reach), IFC Performance Standards or 2X Challenge alignment (Development Finance Institution investors such as IFC, BII, Norfund, FMO, Proparco ask for this), ESG policy, exclusion-list self-declaration, environmental and social management system (ESMS) for Series A+ with DFI money. Default Req. DFIs are a large share of African venture money, so this folder matters more than in US checklists.

## 4. How the leading products present data rooms

| Product | Structure | Access control | Analytics | Notable UX |
|---|---|---|---|---|
| **DocSend** (Dropbox) | Spaces with folders; also single-link docs | Email verification, passcode, expiry date, allow/block lists, revoke anytime, NDA gate; download toggle | Per-viewer, per-page time | Dynamic per-viewer watermark (name, email, time); file requests ([DocSend pricing](https://www.docsend.com/pricing/), [FitGap](https://us.fitgap.com/products/000557/docsend)) |
| **Carta** | Data room inside the cap-table product | Per-stakeholder permissions (open / download / share), expiry dates, NDA before access, watermark PDFs, disable downloads | Who viewed what | Shares a live subset of the cap table, 409A and grants without exporting PDFs; free for Carta Launch ([Carta blog](https://carta.com/blog/build-an-effective-data-room/), [Carta IR](https://carta.com/product-updates/startup-investor-relations/)) |
| **Visible** | Folders plus **custom pages** inside the room for guidance | Per-contact folder permissions, login or password, domain allow-list, share by link, no-download | Folder- and document-level engagement, download tracking | Built into fundraising pipeline (CRM) and investor updates; CTA buttons in the room; branding ([Visible data rooms](https://visible.vc/product/data-rooms)) |
| **Datasite** (M&A grade) | Numbered index (1.1, 1.2 ...) | Granular groups, redaction | Bidder engagement tracking | AI suggests the folder for each upload (OCR), AI redaction of PII reviewable in stages, Q&A module with "similar questions" de-duplication, assistant that answers with citations ([Datasite Diligence](https://www.datasite.com/us/en/products/diligence.html), [Datasite AI](https://www.datasite.com/en/resources/ai-at-datasite)) |

Common patterns worth copying: folder tree with counts; a readiness checklist; per-document "who can see this" chip; request-access flow; per-viewer analytics; download toggle; watermark; expiry; revoke. Patterns to avoid at our scale: bidder groups, complex numbered indices, enterprise Q&A workflows (CLAUDE.md: no full Data Room in the MVP slice beyond what the packet needs).

## 5. Recommended Capital Q design

### 5.1 Founder view ("Data room" tab, A1/A3)

1. **Readiness header**: "Your data room: 9 of 14 recommended for Seed". A thin progress bar, not a score. Stage comes from the company profile; the founder can switch stage.
2. **Checklist grouped by category** (collapsed groups, counts). Each row: document name, status (Added / Missing / Not applicable / Expired), who can see it (chip: Everyone · On request · Shared only · Only my team), last updated.
3. **Upload anything**: drag-and-drop or "Add files". Q proposes the category and the checklist item it satisfies ("This looks like your CAC status report, dated 12 Mar 2026") and a default visibility from the table above. The founder confirms (material Q-extracted facts need confirmation; CLAUDE.md onboarding rule). The founder can override every default.
4. **Per-document controls** (sheet on mobile, side panel on desktop): who can see (four levels), allow download (on/off), watermark (on by default for NDA level), expiry for each share, replace with a new version (keeps history; append-only), mark "Not applicable" with a reason.
5. **Requests inbox**: "Ada at Sahel Capital asked for: Financials (12 months)". Approve, decline, or approve with expiry. Approval writes a `relationship_events` row (data_room_access_granted) and an audit row; it is a consequential action with an idempotency key.
6. **Who viewed**: per document, per investor organisation: opened, time spent, downloaded. Viewing is not interest (CLAUDE.md), so never turn this into a "hot lead" score; show it plainly.
7. **Q coaching** (A6/A8): "Investors at Seed usually ask for IP assignments. You have none yet." Gaps, never blame; unknown stays unknown.

### 5.2 Investor view (company profile "Data room" tab)

- Folder list showing only documents the investor may see, plus titles of "On request" items with a lock and a **Request access** button (one tap, optional note).
- Viewer: in-app PDF / image / video viewer; download button only when allowed; watermark with the viewer's name, organisation and date on every page when on.
- "Ask Q about this data room": Q answers only from documents this investor can see (filter before retrieval, CLAUDE.md Context Firewall), with citations to page.
- No titles of private or unshared NDA documents ever appear.

### 5.3 Data model notes (for the owner of migrations, not decided here)

- `data_room_documents` (company-owned, tenant column, category id from a reference table, checklist item id, current version id, visibility scope from ADR-001, allow_download, watermark).
- `data_room_document_versions` (append-only; storage object key; sha256; mime; page count; uploaded_by).
- `data_room_grants` (document or folder, grantee organisation, relationship id, expires_at, revoked_at, granted_by, idempotency key).
- `data_room_access_requests` and `data_room_view_events` (analytics; separate from audit).
- Checklist and categories as **reference data** (not enums), versioned, so the default checklist can change per stage and country without a migration.
- Files in object storage behind signed short-lived URLs; never through the app origin for large files; RLS on every table; cross-tenant negative tests.

### 5.4 Default checklist (ship this; stage-aware)

**Pre-seed (8)**: pitch deck · one-pager · certificate of incorporation · registry extract of shareholders and directors (CAC 1.1 / CR12 / CoR14.3 / Companies House / Delaware) · founder agreement and vesting · IP assignment from founders · cap table summary · SAFEs / notes signed.

**Seed (+10 = 18)**: financial model · key metrics dashboard · use of funds · management accounts (last 6-12 months) · MemArt / bylaws / MOI · good-standing / status report · tax ID and tax clearance · data protection registration (NDPC / ODPC / Information Regulator) · sector licences (or "not applicable") · team bios and org chart.

**Series A (+12 = 30)**: monthly financials 24 months · cohort and unit economics · revenue by customer · top customer contracts · employment contracts for key hires · ESOP plan and grants · fully diluted and pro forma cap table · board minutes and resolutions · tax returns and statutory remittances (pension etc.) · litigation summary · trademarks · security overview.

**Series B (+8 = 38)**: audited accounts · debt schedule · transfer pricing and group structure · insurance · open-source audit · regulatory correspondence · ESG / ESMS · customer references.

## 6. Gaps and recommendations

1. **Version per share, not per document.** When a founder updates a document, investors who were granted the old version should see the new one by default, with "Updated 3 days ago" and a link to previous. Carta's expiring links exist to prevent stale data ([Carta blog](https://carta.com/blog/build-an-effective-data-room/)).
2. **Redacted twin.** Allow two versions of a contract: redacted (On request) and full (Shared only). Datasite does AI redaction; for the MVP, let the founder upload the redacted copy; Q can suggest what to redact later.
3. **Expiry defaults.** NDA-level grants expire after 30 days by default; founder can extend. Show expiry plainly.
4. **NDA gate as a click-through** at MVP (store the accepted NDA version, timestamp, user, organisation). E-signature integration is enterprise scope; skip.
5. **Watermark rendering** server-side into the delivered PDF (per viewer), or as an overlay in the viewer for images and video. Overlay is cheaper; state honestly that an overlay deters but does not prevent capture.
6. **Registry cross-check** (Q tool, later): compare the uploaded registry extract (CAC / CR12 / CoR14.3) with the declared cap table and team; flag mismatches as contradictions that coexist until the founder reconciles (CLAUDE.md). This is the single most valuable Africa-specific check.
7. **Freshness**: documents like good-standing, tax clearance and CR12 go stale (commonly 3-12 months). Store "valid until" and mark STALE (lifecycle axis), never delete.
8. **Bulk download pack** for investors (zip of what they may see, watermarked) supports the GateQ inbox (F4).
9. **Do not show view analytics to investors about each other.** Founders see per-organisation views; investors never learn who else looked.
10. **Viewing is not interest**: data-room analytics must not feed ranking or match scores (CLAUDE.md recommendations rules).
11. **Mobile**: the checklist is a long list; use collapsible categories with counts, sticky "Add files" button, and a bottom sheet for per-document controls; 44px targets.
