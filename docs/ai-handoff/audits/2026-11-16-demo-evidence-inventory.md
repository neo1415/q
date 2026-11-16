# Demo evidence inventory — Phase 1 (16 Nov 2026)

Directive: [`../directives/2026-11-16-demo-evidence-data-room-seeding.md`](../directives/2026-11-16-demo-evidence-data-room-seeding.md). Phase 1 only: read-only. No seeding, uploads, production writes or model calls were made.

**Method.** Read-only production SQL through `scripts/handoff/live/hosted-read.mjs` (SELECT only), plus code reading at `2fdc90b1c` (`fix/resume-asking-cv9ru3`). Email addresses appear here only as domains or patterns.

**Correction to the brief.** `core.company_members.user_id` and `core.investor_representatives.user_id` hold `identity.user_profiles.id`, not `auth.users.id`. Join them through `user_profiles.auth_user_id`. Joined that way, Tensorgate has 4 members and Nixo has 1. The "no members" finding came from the wrong join.

## 1. Classification

The universe is 585 companies, grouped by the domains of their members:

| Members                    | Companies |
| -------------------------- | --------: |
| `fictional.capitalq.local` |       521 |
| `gmail.com`                |        25 |
| `guerrillamailblock.com`   |        13 |
| `maxxspace.com`            |        11 |
| `example.com`              |         4 |
| `zinoaviation.com`         |         1 |
| none                       |        10 |

`demonstration_data = true` is set on only 3 rows: Capital Q, KUUZA AI and SongScribe AI (the owner-approved `scripts/seed/demo-companies`). It does not mark the fictional world.

Fictional investors' CURRENT slates (section 5 lists the investors) show 86 companies:

- 64 with fictional-domain members;
- 20 from the tavus-20 cohort;
- Nixo;
- Spheros.

The 10 member-less real public companies (Bumpa, Duplo, Mintlify, …) are not in those slates.

### Cohorts and their evidence

| Cohort                                                                                                                                                                                                                                                                       | Created        | How it was made and the evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Class                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Dev fictional world** (12): Ledgerfold, Tarmacly, Yamfield Agro, Clinicrest, Marketlight Grids, Tallyloom, Ajopot, Maji Loop, Nsuo Labs, Brightkloof Energy, Souqsheet, Kazikit                                                                                            | 27 Sep         | Made by `scripts/seed-fictional-world.mjs`, using `apps/q-api/src/dev/fictional-world/companies.ts`. Members are on `fictional.capitalq.local`, websites are `.example`, and legal names end in "(fictional)".                                                                                                                                                                                                                                                                                                         | FICTIONAL                                                        |
| **Fictional bulk** (~500): Watchly, Rankpay, Umoja Cover, Clinicly, Dawaledger, Layero, …                                                                                                                                                                                    | 15 Oct onwards | Made by `scripts/seed/fictional-bulk/*`. Members are on `fictional.capitalq.local` and websites are `.example`. Repeated rehearsal copies are included, such as the "Tamarind Ledger" ×20 and "Ledgerline XXXX (fictional)" ×9 (both `organisation_private`, run-scoped).                                                                                                                                                                                                                                              | FICTIONAL                                                        |
| **tavus-20** (20): **Tensorgate**, **Halyard Security**, Ledgerline, Baridi, MedTrail, Mizan, Portside, Silo Credit, Termly, Akshar, Clearwater Assurance, Cosecha Labs, Drishti Health, Ferrolith, Hui, Orphéa Genomics, Prumo, Railhead Robotics, Rand Treasury, Shiftwell | 6 Oct          | Made by `scripts/seed/tavus20/*` from `docs/seed/tavus-20/companies-full.json`; DATASET.md says "Every company, person, investor, customer and document is fictional". All 76 members are `+cq-` aliases of one owner mailbox, and every one carries `user_metadata.fictional_demo=true` and `app_metadata.synthetic=true` (`scripts/seed/tavus20/lib.mjs:143-147`). `scripts/seed/demo-activate-plan.mjs:20-26,114` treats exactly this as fictional. Websites are `.example`. Claims come from provider `demo_seed`. | **FICTIONAL** (on a real mailbox; see Q2)                        |
| **Nixo**                                                                                                                                                                                                                                                                     | 30 Sep         | One member, a plain gmail address: no alias and no fictional or synthetic marker. Legal name "Nixo Inc.", website `withnixo.com`. Its 75 public-web evidence items include pages on `withnixo.com`, `workatastartup.com` (a YC jobs board), `roundfunded.com` and LinkedIn. It applied through GateQ to Zino Aviation and to Atlas Health.                                                                                                                                                                             | **POSSIBLY-REAL** (a real company and a real sign-up are likely) |
| **Spheros**                                                                                                                                                                                                                                                                  | 5 Oct          | One plain gmail member and the website `spheros.io`. The handoff calls it Kathryn's real demo account.                                                                                                                                                                                                                                                                                                                                                                                                                 | POSSIBLY-REAL (treated as real)                                  |
| Kiln Payroll, Mai Soli, Primed e health                                                                                                                                                                                                                                      | —              | One plain gmail member each, with no markers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | POSSIBLY-REAL                                                    |
| Real public companies (10): Bumpa, Duplo, Mintlify, Koolboks, HoneyCoin, MoneyHash, Tangible, F2, Anchor, ekko                                                                                                                                                               | 6 Oct          | Unclaimed public profiles with no members, made by `scripts/seed/real-companies/seed.mjs`. Their claims are public-web `DOCUMENT_SUPPORTED`/`MULTI_SOURCE_SUPPORTED`.                                                                                                                                                                                                                                                                                                                                                  | REAL (public record; never seed)                                 |
| Zino Aviation ×3, Capital Q, KUUZA AI, SongScribe                                                                                                                                                                                                                            | —              | Owner and owner-approved demonstration companies (`demonstration_data`). These are real.                                                                                                                                                                                                                                                                                                                                                                                                                               | SEEDED-NONFICTIONAL (real; not in scope)                         |
| guerrillamail, maxxspace and example.com tenants                                                                                                                                                                                                                             | 30 Oct–12 Nov  | QA, stress and journey sign-ups ("Granary Ledger Systems (fictional)", "Siloskov Data (fictional)", …). They are `organisation_private`.                                                                                                                                                                                                                                                                                                                                                                               | SEEDED-NONFICTIONAL (test litter; never seed into these)         |

**Halia.** There is no company, organisation, investor, gateway, GateQ `declared_name` or Q conversation message that matches `h[ae]l+[iy]a` in production. The repository has no match outside the Deepgram voice "aura-2-thalia". The nearest name is **Halyard Security** (tavus-20, fictional): a GB, seed-stage company selling phishing-resistant passkeys to NHS trusts. It sits in 11 fictional investors' slates. The Oct-21 nav journeys used "compare Nixo and Halyard" (`docs/ai-handoff/workstreams/INSTANT-NAV-2026-10-21.md:69`). "Halia" is probably Halyard as spoken, and needs the owner's confirmation.

## 2. Per-company evidence (showcase first)

Notes on the table:

- **Docs**: active documents.
- **DR levels**: data-room entries as PUBLIC/ON_REQUEST/SHARED_ONLY/PRIVATE; none = no entry.
- **Ch**: active chunks.
- **Emb**: embeddings.
- **Claims**: count and evidence_status. Every claim is USER_CLAIM, except NO_EVIDENCE claims (UNKNOWN) and 5 ESTIMATE.
- **Net-visible claims**: the ones an investor's Q can read through `read_company_figures`.

| Company                                                                           | Class         | Docs (types)                                                                                                                                                              | DR levels            | Ch   | Emb | Deck reading | Claims                   | Net-visible claims | DOC_SUPPORTED claims (scope)     |
| --------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---- | --- | :----------: | ------------------------ | ------------------ | -------------------------------- |
| **Tensorgate**                                                                    | tavus-20      | 12: deck; FINANCIAL (management accounts); LEGAL (contract summary); 9 UNCLASSIFIED (cap table, ESOP, IP deeds, board minutes, KYB, tax, pentest, benchmark, certificate) | 2/3/4/3              | 15   | 0   |   1 (deck)   | 16 SELF_REPORTED         | 16 (`demo_seed`)   | 0                                |
| **Halyard Security**                                                              | tavus-20      | 12: the same pattern (deck, management accounts, NHS contract summary, DSPT, HMRC/SEIS, …)                                                                                | 2/4/3/3              | 15   | 0   |      1       | 20 SELF_REPORTED         | 20                 | 0                                |
| **Nixo**                                                                          | possibly real | **0**                                                                                                                                                                     | —                    | 0    | 0   |      0       | 0 (10 knowledge objects) | 0                  | 0                                |
| Maji Loop (GateQ scene)                                                           | dev world     | 7: deck; 2 "deck QA 14 Nov" leftovers; "note"; FINANCIAL (txt); COMPANY_PROFILE; PRODUCT                                                                                  | 3/1/0/0, plus 3 none | 12   | 0   |      3       | 8: 5 SR, 1 NE, 2 DOC     | 5                  | 2 (`organisation_private`)       |
| Ledgerfold                                                                        | dev world     | 5: deck, FINANCIAL, COMPANY_PROFILE, PRODUCT, OTHER                                                                                                                       | 3/1/0/0, plus 1 none | 5    | 0   |      1       | 10: 8 SR, 1 NE, 1 DOC    | 8                  | 1 (org-private)                  |
| Clinicrest                                                                        | dev world     | 4 (deck, FINANCIAL, profile, product)                                                                                                                                     | 3/1/0/0              | 4    | 0   |      1       | 6: 3 SR, 1 NE, 2 DOC     | 3                  | 2 (org-private, 1 CONTRADICTORY) |
| Ajopot                                                                            | dev world     | 8 (2 decks, FINANCIAL, FINANCIAL_MODEL, 3 profiles, product)                                                                                                              | 4 of 8 have entries  | 8    | 0   |      2       | 6: 4 SR, 2 NE            | 4                  | 0                                |
| Tarmacly, Tallyloom, Marketlight, Souqsheet, Brightkloof, Kazikit, Nsuo, Yamfield | dev world     | 4 each (deck, FINANCIAL, profile, product)                                                                                                                                | 3/1/0/0              | 4    | 0   |      1       | 4–8, mostly SR           | SR only            | 0–1 each (org-private)           |
| Watchly                                                                           | bulk          | 5: deck, COMPANY_PROFILE, PRODUCT, COMMERCIAL (csv), MANAGEMENT_ACCOUNTS (csv)                                                                                            | 3/2/0/0              | 5    | 0   |      1       | 0 (3 knowledge objects)  | 0                  | 0                                |
| Rankpay, Umoja Cover                                                              | bulk          | 6 (deck, FINANCIAL, 4 UNCLASSIFIED)                                                                                                                                       | all have entries     | 6    | 0   |      1       | 0                        | 0                  | 0                                |
| Ledgerline, Baridi, MedTrail, Mizan, Portside, Silo Credit, Termly                | tavus-20      | 9–12 each, the tavus-20 data-room pattern (Portside, Silo and Termly each have one version that never processed)                                                          | all have entries     | 9–15 | 0   |      1       | 16–20 SELF_REPORTED      | all SR             | 0                                |
| Spheros                                                                           | real          | 0                                                                                                                                                                         | —                    | 0    | 0   |      0       | 0                        | 0                  | 0                                |

### Platform-wide facts

- **Embeddings.** `q_knowledge.embeddings` holds **0 rows**. 2,752 chunks sit in 2,152 ACTIVE chunk sets.
- **Document claim readings.** Only 5 exist, all COMPLETED: the 2 Maji Loop QA decks plus 3 other versions.
- **Claims.** 428 USER_CLAIM/SELF_REPORTED, 31 DOCUMENT_SUPPORTED, 10 MULTI_SOURCE, 13 UNKNOWN, 5 ESTIMATE.
- **DOCUMENT_SUPPORTED claims.** On fictional companies every one is `organisation_private`. On the real public companies they are network-visible and come from public web.
- **Integrity.** Documents ↔ company tenant mismatches: 0. Owner organisation mismatches: 0. 30 active documents have no chunk set.

### What the documents look like

The tavus-20 data-room PDFs are **summary sheets of about 500–1,300 characters**: a title, the folder, the visibility and 3–5 bullets. Only the decks are real documents (about 9k characters).

The dev-world "financials" are 1-page `.txt` files of about 950 characters. Titles and legal names carry "(fictional)", which conflicts with the directive's "no repeated fictional warnings".

Tensorgate's and Halyard's "Certificate of Incorporation" text opens with "The Delaware Division of Corporations …". This is an imitation of an official certificate, which the directive forbids, and it must be replaced or relabelled.

### Sensitivity

`defaultDocumentSensitivity` (`packages/evidence/src/domain/sensitivity.ts:44-49`) makes every FINANCIAL, MANAGEMENT_ACCOUNTS and FINANCIAL_MODEL document **HIGHLY_CONFIDENTIAL**. All other types are CONFIDENTIAL. All chunks are `organisation_private`.

### Grants and requests involving fictional investors

| Relationship          | State        | Detail                                                                                                                                        |
| --------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Savanna ↔ Ajopot      | IN_DILIGENCE | 22 events; 4 diligence requests (3 fulfilled, 1 pending); 1 live document share; 2 data-room requests. The only end-to-end diligence example. |
| Savanna ↔ Watchly     | CONNECTED    | 5 meetings                                                                                                                                    |
| Savanna ↔ Nsuo Labs   | CONNECTED    | 2 data-room requests                                                                                                                          |
| Savanna ↔ Harbourline | CONNECTED    | 1 data-room request                                                                                                                           |
| Lagoon ↔ Kazikit      | CONNECTED    | 1 meeting                                                                                                                                     |

Live document disclosure policies platform-wide: 3 of 11.

**Tensorgate, Halyard and Nixo have no diligence, shares or meetings with any fictional investor.** Their only relationships are Savanna↔Tensorgate and Atlas↔Nixo, both DISCOVERED.

## 3. Why Q keeps saying "self-reported / not verified"

The labels are correct for the data. The data condition, not retrieval, is the cause.

1. **Every investor-visible figure is SELF_REPORTED by construction.**
   - `read_company_figures` returns only CURRENT claims at `network_visible`/`public_external` (`packages/q-tools/src/tools/company-figures.ts:37,116`).
   - The only such claims on demo companies were written by `scripts/seed/demo-figures-plan.mjs` and the tavus-20 seed, provider `demo_seed`. Both seed as USER_CLAIM / **SELF_REPORTED** on purpose (header of `demo-figures-plan.mjs`, lines 31-35).
   - Q states each one "as the company states it" (`packages/model-gateway/src/q/company-fact.ts:156-200`; labels in `uncertainty.ts:1271-1273`, `list-conditions.ts:790`, `figure-chart.ts:357`).
2. **Document-backed claims never reach investors.**
   - The deck/profile path proposes figures to the founder only. Confirmed figures stay `organisation_private` (`apps/q-api/src/composition/document-claim-cards.ts:34-70`; eligible types at `:88`).
   - `evidence.createClaim` refuses any scope broader than private (noted in `demo-figures-plan.mjs:14-19`). There is no claims API route.
   - So the 2 DOCUMENT_SUPPORTED claims on Maji Loop, Clinicrest and the others are invisible to every investor.
3. **Financial documents are held back from Q by design.**
   - HIGHLY_CONFIDENTIAL documents are never read and never sent to a model (`packages/q-tools/src/tools/own-records.ts:303-345` `heldBackFromQ`; `apps/q-api/src/composition/material-documents.ts:38,130,166`).
   - Every management-accounts or financial document above (Tensorgate's, Halyard's, Watchly's) is in this class.
   - Their figures only become usable through the code-only "local figures" path (`apps/workers/src/documents/pipeline.ts:119-140`) and the **founder's** confirmation. Even then they stay private to the founder's organisation.
4. **Document chunks are invisible to investor retrieval.**
   - Hybrid retrieval filters `c.visibility_scope = any(plan scopes)` and a sensitivity ceiling (`packages/q-knowledge/src/infrastructure/postgres-retrieval-repository.ts:127-135,254-260`).
   - All document chunks are `organisation_private`, and the data-room level never widens derived data (`packages/contracts/src/http/data-room.ts:26-31`, ADR 0041 §3).
   - The semantic half is also empty, because there are 0 embeddings. Lexical FTS still works for owners.
5. **The one working investor path is `read_company_document`.**
   - It reads a data-room document as the person, only where the viewer's access is OPEN or OWNER and the document is not held back (`packages/q-tools/src/tools/company-documents.ts:491-552`; `material-documents.ts:150-170`).
   - It marks what it reads USER_CLAIM / **DOCUMENT_SUPPORTED** (`company-documents.ts:547-548`).
   - For Tensorgate and Halyard, that is only the deck and the "certificate" (PUBLIC). Everything else is ON_REQUEST, SHARED_ONLY or PRIVATE with no grants, or HIGHLY_CONFIDENTIAL.

**Verdict on each possible cause:**

| Possible cause         | Verdict                                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Stored but not indexed | No. Chunks exist for 98.6% of documents, though embeddings are absent.                                                  |
| Wrong company id       | No. There are 0 tenant or org mismatches.                                                                               |
| Main cause             | (a) **missing evidence**: thin summary PDFs, no Nixo documents, no investor-visible document-backed claims.             |
| Contributing cause     | (b) **genuine permission limits**: no shares to fictional investors, and financials held back from Q by classification. |
| Broken retrieval       | Only (c) the absent embeddings, which leaves semantic retrieval empty.                                                  |

## 4. Supported ingestion path (founder upload) and its model calls

| Step | What happens                                                                                                                                                                                       | Where                                                                                                                                                                                 |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `POST /v1/documents/upload-sessions` with `{companyId, documentType, title, filename, mime, size}`                                                                                                 | `packages/contracts/src/http/documents.ts:23-25`; `packages/evidence/src/application/upload-use-cases.ts:106-117,178`; app action `packages/app-actions/src/actions/documents.ts:109` |
| 2    | The client uploads the bytes straight to private storage (`cq-documents-private`). The API never proxies them.                                                                                     | `apps/api/src/http/documents.ts:27-38`                                                                                                                                                |
| 3    | `POST …/:uploadSessionId/complete`, which creates a `document_versions` row and the outbox event `evidence.document.version_created`                                                               | `documents.ts:161`; `upload-use-cases.ts:418`                                                                                                                                         |
| 4    | Workers run the pipeline: job → security gate → malware → sandboxed parse → extraction (`cq-extractions-private`) → instruction-risk signal → chunk set → `evidence.document.ready`. **No model.** | `apps/workers/src/events/document-processing-handler.ts`; `apps/workers/src/documents/pipeline.ts:42-58`                                                                              |
| 5    | Model steps that fire on ready                                                                                                                                                                     | see below                                                                                                                                                                             |
| 6    | Data room: `POST /v1/data-room/documents/:id/level` creates the `data_room_entries` row (PUBLIC/ON_REQUEST/SHARED_ONLY/PRIVATE)                                                                    | `packages/evidence/src/infrastructure/postgres-data-room.ts:224-245`                                                                                                                  |
| 7    | Sharing, by any of three routes, each creating a `permissions.disclosure_policies` row (`relationship_shared`, recipient = the relationship, `view`, expiry) plus a relationship event and audit   | below                                                                                                                                                                                 |

The model steps in step 5, per document:

| Step                               | Applies to                                            | Task class                       | Calls per document | Avoidable?                                                | Where                                                                                                  |
| ---------------------------------- | ----------------------------------------------------- | -------------------------------- | ------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Document-kind classification       | UNCLASSIFIED uploads only                             | FAST_CLASSIFICATION              | 1                  | Yes: upload with an explicit `documentType`               | `pipeline.ts:82-92`                                                                                    |
| Page transcription                 | Pages with no text layer                              | Vision model                     | per page           | Yes: text-layer PDFs, or `CQ_PAGE_TRANSCRIPTION=disabled` | `apps/workers/src/main.ts:1315-1330`                                                                   |
| Deck reading into 12 sections      | PITCH_DECK only                                       | STRUCTURED_EXTRACTION            | 1                  | —                                                         | `apps/workers/src/evidence/deck-reading-handler.ts`; `packages/model-gateway/src/q/deck-reader.ts:163` |
| Founder onboarding document review | Only if the founder is in an onboarding journey       | STRUCTURED_EXTRACTION            | 1                  | —                                                         | `apps/workers/src/main.ts:445-465`                                                                     |
| Document claim cards (q-api)       | PITCH_DECK and COMPANY_PROFILE, CONFIDENTIAL or lower | Registered claim-extraction task | ≤3 (≤3 retries)    | —                                                         | `document-claim-cards.ts:56,76-88`                                                                     |
| Local figures                      | FINANCIAL, MANAGEMENT_ACCOUNTS, FINANCIAL_MODEL       | **None**: code reads them        | 0                  | —                                                         | `pipeline.ts:119-140`                                                                                  |

The three sharing routes in step 7:

- a direct grant, `POST /v1/data-room/documents/:id/grants` (and the folder-level version);
- an investor request (`POST /v1/companies/:id/data-room/requests`) followed by the founder's decision (`POST /v1/data-room/requests/:id/decision`);
- diligence fulfilment (`POST /v1/document-requests/:id/fulfil`).

Routes are in `packages/contracts/src/http/founder-documents.ts:263-317` and `data-room.ts:66-78`. Writes go through `packages/permissions/src/infrastructure/postgres-disclosure-policy-repository.ts:95`.

**Can a seed script drive it without model calls?** Steps 1–4, 6 and 7 can: the seed signs in as each fictional founder and investor and calls the same API routes. Declaring `documentType` explicitly and using text-layer PDFs removes kind classification and transcription.

The only step that cannot avoid a model is deck reading and claim cards. That is about **1 + up to 3 calls per deck or company-profile version**: about 4 per showcase company if only one new deck is uploaded, and none if decks are left alone. Two ways to avoid them:

- **Reuse existing readings.** Leave the current decks in place; all three showcase decks already have readings.
- **Disable them on a local stack.** This applies locally only. In production the hosted workers will fire on the `ready` event. Any model calls in production need the lead's approval and must be reported with their cost (root CLAUDE.md budget rule).

## 5. Fictional investors

All have exactly 1 ACTIVE mandate. None has portfolio references (`investor_portfolio_references` = 0). Gateways are all ACTIVE.

| Investor (seed)                       | Cheque / stage / currency    | Constraints | Gateway | Slate | Relationships (states)                                                                                                                                             |
| ------------------------------------- | ---------------------------- | ----------: | :-----: | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Savanna Seed Partners** (dev world) | 250k–1M USD, seed            |           8 |    ✓    |    35 | 15: Ajopot IN_DILIGENCE; Ledgerfold, Maji Loop, Watchly, Nsuo, Clinicrest, Tallyloom, Tarmacly, Brightkloof, Harbourline CONNECTED; Tensorgate, Spheros DISCOVERED |
| Lagoon Angels Circle                  | 25k–150k USD, pre-seed–seed  |           4 |    —    |    41 | Kazikit, Tarmacly CONNECTED; Ajopot, Clinicrest DECLINED                                                                                                           |
| Chidi Nwosu Angels                    | 10k–60k USD, pre-seed–seed   |           4 |    —    |    46 | Yamfield INTEREST_EXPRESSED                                                                                                                                        |
| Equator Line Capital                  | 2–8M USD, Series A           |           4 |    —    |    42 | Tarmacly CONNECTED                                                                                                                                                 |
| Tidewater Growth                      | 5–20M USD, Series A–B        |           4 |    —    |    36 | Tallyloom CONNECTED; Nsuo DECLINED                                                                                                                                 |
| Pan-African Climate Dev. Fund         | 3–25M USD, Series A–B        |           4 |    —    |    47 | Marketlight INTEREST_EXPRESSED                                                                                                                                     |
| Transcoastal Telecom                  | 0.5–3M USD, seed–Series A    |           4 |    —    |    39 | Souqsheet CONNECTED                                                                                                                                                |
| Rift Valley Seed Fund                 | 150k–750k USD, pre-seed–seed |           4 |    —    |    41 | Maji Loop INTEREST_EXPRESSED                                                                                                                                       |
| **Kilima Angel Network** (bulk)       | 10k–150k USD, pre-seed–seed  |           6 |    ✓    |    37 | 15 INTEREST_EXPRESSED (the GateQ applicants)                                                                                                                       |
| **Atlas Health Partners**             | 400k–6M USD, seed–Series B   |           7 |    ✓    | **0** | Nixo DISCOVERED                                                                                                                                                    |
| Cape Meridian Growth                  | 2–15M USD, Series A–B        |           7 |    ✓    |    36 | Wardora CONNECTED; Milla INTEREST_EXPRESSED                                                                                                                        |

These gateway owners have no relationships:

| Investor             | Mandate      | Slate |
| -------------------- | ------------ | ----: |
| Baobab Ridge         | 50k–600k USD |    44 |
| Sahel Bridge         | 0.25–3M USD  |    41 |
| Nile Delta           | 0.3–2.5M USD |    16 |
| Thames Arc           | 150k–2M GBP  |    39 |
| Gulf Horizon FO      | 3.5–37M AED  |    16 |
| Rhine Impact         | 0.5–8M EUR   |    46 |
| Lagos Forge          | 40–450M NGN  |    42 |
| Monsoon Digital      | 0.5–4M USD   |    40 |
| Savanna Scale Credit | 3–25M USD    |    43 |

The test investor "Test – Partech Africa" (0.5–15M USD, seed–Series B; slate 44) has a gateway and two INTEREST_EXPRESSED relationships, with Coreeon and Dawaledger.

### Mandate completeness gaps

- Raw mandate text runs 80–220 characters.
- There are no portfolio references, no decision-process or diligence-needs fields, and no notes.
- The only meetings are Savanna↔Watchly (5) and Lagoon↔Kazikit (1).
- Observed and inferred mandate data are not seeded separately from declared data.
- Atlas Health's slate is empty.
- Zino Aviation (the owner's real investor account, 36 relationships) is **not** fictional.

## 6. GateQ applications and states

| Gateway        | Applications                             | Submitted outcomes                                                                                                                           |
| -------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Savanna        | 29 in progress, 6 submitted, 2 withdrawn | QUALIFIED: Maji Loop ×2, TensorGate (with dossier), Tensorgate (no dossier, 10 documents), Spheros (no dossier), and one with no name        |
| Kilima         | 5 in progress, 15 submitted              | **QUALIFIED ×7.** **UNRESOLVED ×8**, with `STAGE_DISPUTED` disagreements LEFT_OPEN on 10 applications. Kazikit has 1 investor REPLY message. |
| Atlas Health   | 7 in progress, 1 submitted               | Nixo QUALIFIED (dossier ready)                                                                                                               |
| Zino Aviation  | real gateway                             | Mizan, Rand Treasury, Nixo submitted                                                                                                         |
| Partech (test) | —                                        | FDN Advisory, with 1 REPLY                                                                                                                   |

Directive scenarios against what exists:

| Scenario                         | Status                                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Strong application               | **EXISTS** (Kilima QUALIFIED; Savanna Maji Loop)                                                                  |
| Unresolved questions             | **EXISTS** (Kilima UNRESOLVED, `STAGE_DISPUTED`)                                                                  |
| Genuine discrepancy              | **PARTIAL**: 19 disagreement events, all `LEFT_OPEN`, none resolved                                               |
| Founder correction, history kept | **MISSING**: no disagreement resolved by a later statement                                                        |
| Submitted with frozen dossier    | **EXISTS** (`application_submissions.dossier` set on 22 of 26 submissions)                                        |
| Answered request                 | **WEAK**: only 2 REPLY inbox messages. The diligence equivalent is Savanna↔Ajopot (3 fulfilled).                  |
| Pending request                  | **WEAK**: 1 unfulfilled diligence request on Savanna↔Ajopot. There is no GateQ info-request message kind in data. |

No GateQ application involves Halyard.

## 7. Gaps

| Kind                                                                                         | Gap                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Missing evidence** (the bulk)                                                              | **Nixo**: 0 documents, 0 claims.                                                                                                                                                       |
|                                                                                              | **Tensorgate and Halyard**: 12 documents each, but everything except the deck is a ≤1.3k-character summary sheet.                                                                      |
|                                                                                              | No bank statements, invoices, customer lists, dated KPI packs, round documents or reconciled monthly financials, so burn, runway, concentration and reconciliation cannot be answered. |
|                                                                                              | No deliberate deck-against-accounts contradiction on the showcase three. Clinicrest and Tarmacly have CONTRADICTORY claims, but they are organisation-private.                         |
|                                                                                              | Dev-world companies have 1-page `.txt` financials.                                                                                                                                     |
|                                                                                              | Maji Loop has QA leftovers: "deck QA 14 Nov" ×2 and "note".                                                                                                                            |
| **Genuine permission limits** (correct behaviour; the data has to move through the workflow) | No document shares, diligence or meetings between fictional investors and the showcase three.                                                                                          |
|                                                                                              | Financial documents are HIGHLY_CONFIDENTIAL and held back from Q even when shared.                                                                                                     |
|                                                                                              | Confirmed figures stay organisation-private.                                                                                                                                           |
|                                                                                              | Network-visible figures can only be SELF_REPORTED.                                                                                                                                     |
| **Broken or absent retrieval**                                                               | Embeddings = 0, so the semantic half of hybrid retrieval is empty.                                                                                                                     |
|                                                                                              | 30 active documents have no chunk set.                                                                                                                                                 |
|                                                                                              | 3 tavus-20 versions are unprocessed (Portside, Silo Credit, Termly).                                                                                                                   |
| **Content defects**                                                                          | Imitation official certificates ("The Delaware Division of Corporations Certificate of Incorporation", and the Companies House equivalent for Halyard).                                |
|                                                                                              | "(fictional)" in legal names and document titles, against the directive's no-repeated-warnings rule.                                                                                   |
|                                                                                              | Duplicate rehearsal companies ("Tamarind Ledger" ×20, "Ledgerline XXXX" ×9) pollute counts.                                                                                            |

**Investment questions Q cannot answer today for the showcase three:**

- burn and runway from accounts;
- revenue trend from documents;
- the reconciliation of deck against accounts;
- customer concentration;
- the ownership split from the cap table (SHARED_ONLY, ungranted);
- the use of funds against the round documents;
- the history of an unanswered diligence request;
- any Nixo fact beyond public-web excerpts.

### Open product questions (owner)

1. **Halia.** It does not exist. Is it Halyard Security, as transcribed by voice? Or should a new fictional "Halia" be created? A new company changes the seed matrix and the Discover slates.
2. **Tensorgate (and Halyard).** The evidence says they are fictional: tavus-20 markers `fictional_demo` and `synthetic`, `.example` domains, and DATASET.md. That conflicts with `CERTIFICATION_MANIFEST.md:114` ("not fictional-world records"), which refers only to the dev-world seed. They are therefore safe for synthetic documents. However, their accounts sit on a real owner mailbox, so any notification sent to these founders reaches the owner's inbox. The owner should confirm this, and the manifest note should be amended.
3. **Nixo.** Treat it as **real**. A plain gmail founder with no markers, a live `withnixo.com` and YC listings mean that seeding synthetic financial documents into it would plant false records in a real company's tenant. That would break the "never touch non-demo tenants" rule. Proposal: replace Nixo in scenario E with a fictional peer, or obtain the founder's explicit written consent first.
4. **Ledgerline and Baridi.** The brief called them real gmail-alias tenants. The data shows they are tavus-20 fictional, carrying the same markers as Tensorgate. Confirm whether to include them.
5. **Financial evidence for Q (Scenario A).** Showing burn and runway "from documents" to an investor's Q needs one of the following. The choice is the owner's or an ADR's; do not weaken the firewall to get there.
   - **(a)** The founder confirms code-read figures, plus a sanctioned way to publish them network-visible. Today no product route does this; the demo-figures seed only writes SELF_REPORTED values.
   - **(b)** A decision that shared synthetic financials may be read by Q at CONFIDENTIAL. This would amend the HIGHLY_CONFIDENTIAL hold-back policy (`own-records.ts:303`) and needs an ADR.
   - **(c)** The evidence lives in non-financial document types, such as invoices and commercial or KPI packs (CONFIDENTIAL and readable once shared). Financial statements themselves stay held back.
6. **Embeddings.** Is the hosted embedding provider expected to be on? It needs a decision before "indexing and search" can be certified. Turning it on is a paid provider call.
7. **Model calls.** Uploading new decks triggers deck reading plus claim cards (about 4 calls per deck). The lead must approve that budget, or the existing decks must be kept.
