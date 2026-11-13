# GateQ applicant journey: live certification run (13–14 Nov 2026, production)

## Scope and rules

- **Target:** production web, `https://capital-qweb-production.up.railway.app`.
- **Accounts:** fictional only.
  - Founder: `founder.kazikit@fictional.capitalq.local`. Company Kazikit (`8e2c40e7-…`, pre-seed, Nairobi).
  - Investor: `investor.kilima-angels.njeri-kamau@fictional.capitalq.local`.
  - Gateway: Kilima Angel Network (fictional) gate, `/g/gq_7aekqs9vfk8kvavm8k7tcacryn`.
- **Fictional checks (SQL, before starting):**
  - The gateway organisation has 2 active members, both `@fictional.capitalq.local`.
  - The gateway had 0 prior applications.
- **Not run:**
  - The video interview (paid).
  - Builds, tests and gates.
- **Product code:** none changed.
- **Interruption:** the container restarted after the reply was sent. State was re-checked with SQL before the run resumed, and nothing was re-applied.
- **Screenshots:** `/tmp/claude-0/-home-user/baac2e44-f461-5146-93f5-14f30f7b1f41/scratchpad/gq/shots/` (scratch, not committed).

## Steps (desktop 1440×900 unless noted)

| #   | Step                                                                                                  | URL                       | Result                                                                                                                                                                                                                                                  | Time                                                        | Evidence                                | Page errors                                    |
| --- | ----------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------- | ---------------------------------------------- |
| 1   | Founder signs in                                                                                      | `/auth/sign-in` → `/home` | PASS                                                                                                                                                                                                                                                    | 2.6 s                                                       | —                                       | none                                           |
| 2   | Open the gateway                                                                                      | `/g/gq_7aek…`             | PASS. The form is prefilled from the profile (company, one-liner, stage Pre-seed, Kenya) and the rules panel is live                                                                                                                                    | 4.8–5.7 s                                                   | `g1-01-gateway.png`                     | none                                           |
| 3   | Answer the form                                                                                       | same                      | PASS. The USD 350,000 raise made the round-size and cheque rules "Meets". The Software sector shows "Doesn't meet · Preferred only". The deck was **pre-ticked**; the product brief was ticked by hand and the financial summary left unticked          | 6.1 s to continue                                           | `F-01`, `F-02`, `F-03`                  | none                                           |
| 4   | Contact, account path                                                                                 | same                      | PASS. "From your account… no code to type"; email prefilled. Full name was **not** prefilled. The application shows "Email ownership confirmed"                                                                                                         | 8.9 s                                                       | `F-04`, `F-05`                          | none                                           |
| 5   | Documents                                                                                             | same                      | PASS. Only the deck and the brief reached the investor (`gateq.application_documents`: 2 rows). The financial summary is absent from the investor view                                                                                                  | —                                                           | `I-detail-full.png`                     | none                                           |
| 6   | Text interview (9 founder turns, including one "I don't know")                                        | same                      | PASS with defects (D2, D3)                                                                                                                                                                                                                              | Q reply 2.2–3.4 s (DB `latency_ms`); round trip about 6.5 s | `F-06` to `F-15`                        | none                                           |
| 7   | Review                                                                                                | same                      | PASS. Every answer is shown as "You said", with a word-for-word list of what is sent ("19 turns", the 2 documents). Traction lost its numbers (D2) and no "Answers that disagree" section appears (D3)                                                  | 5.1 s                                                       | `F-16-review.png`, `F-review-full.png`  | none                                           |
| 8   | Submit                                                                                                | same                      | PASS. The application is SUBMITTED at 23:35:10 UTC and a canonical relationship was created                                                                                                                                                             | 3.1 s                                                       | `F-sent.png`                            | none                                           |
| 9   | Founder "See your applications"                                                                       | `/gateq?tab=applications` | PASS: "Sent… Waiting on them"                                                                                                                                                                                                                           | 6.1 s                                                       | `F-my-applications.png`                 | none                                           |
| 10  | Investor inbox                                                                                        | `/gateq`                  | PASS. One item with a "Qualifies" band, a one-page summary, open questions, the evidence axes (origin, truth, evidence) and the transcript (19 turns). There is **no interview summary or coverage view**, and Q's reading shows "isn't ready yet" (D1) | 7.0 s                                                       | `I-inbox.png`, `I-transcript.png`       | none                                           |
| 11  | Investor asks Q "What is still unverified?"                                                           | `/gateq` (Q panel)        | PASS with a defect (D4)                                                                                                                                                                                                                                 | about 25 s                                                  | `I-ask-q.png`                           | none                                           |
| 12  | Reply: Q draft, then the approval card ("Sent only when you press Send, exactly as shown"), then Send | `/gateq`                  | PASS. `inbox_messages` REPLY row with `approved_by_user_id` and `client_request_id`. The UI says only "Replied" and **never claims delivery**                                                                                                           | 6.1 s                                                       | `I-reply-draft.png`, `I-reply-sent.png` | none                                           |
| 13  | Suppressed delivery                                                                                   | SQL                       | PASS. `platform_ops.email_deliveries` id 1339: source `api.gateq_answer`, outcome SUPPRESSED, `RESERVED_TEST_DOMAIN`, at 23:39:15                                                                                                                       | —                                                           | —                                       | —                                              |
| 14  | Founder outcome (390 px)                                                                              | `/gateq?tab=applications` | PASS. The page shows "They wrote: '…' · They replied" in-app, with no claim that an email arrived. No horizontal overflow                                                                                                                               | 7.9 s                                                       | `Fph-*.png`                             | none                                           |
| 15  | Re-open the gateway after submitting (390 px)                                                         | `/g/gq_7aek…`             | FAIL (D5). A fresh empty form and no "already applied" notice. A new IN_PROGRESS draft was created                                                                                                                                                      | 8.1 s                                                       | `Fph-*.png`                             | none                                           |
| 16  | Investor inbox and detail (390 px)                                                                    | `/gateq`                  | PASS with a defect (D6). No overflow. "Pass with a reason" is neutral: white background, grey border, near-black text, the same as "Ask for more"                                                                                                       | 8.2 s                                                       | `Iph-*.png`                             | one `ERR_NETWORK_CHANGED` (proxy, not product) |

## What the interview showed

### Adaptivity

Q opened with the investor's own identity ("operator-led angel syndicate in Nairobi"). It then walked the gaps:

1. company.description
2. raise.use_of_funds
3. company.team
4. company.problem
5. claims.revenue, asked twice (D3)
6. company.business_model
7. company.market, which is the profile's known "not yet known"
8. company.solution, after "I don't know"

It confirmed a material number ("So that's USD 0 for revenue, right?") before recording it. After "I don't know" it moved on politely, and it followed up on use of funds with amounts.

### Coverage

The investor gets coverage only as the "Still open" list (website, instrument, lead investor, market unknown). There is no per-dimension coverage view.

## Defects (ranked)

### D1. High: the interview synthesis failed and stays hidden

- **What happens:** `gateq.application_syntheses` is FAILED with `attempts=1` at 23:35:16, still FAILED at 23:44, and no retry was observed. The investor sees "Q's reading of this submission isn't ready yet." That is a failure shown as pending, and there is no interview summary in the inbox.
- **Scope:** 1 of the 5 syntheses in production is FAILED: this one.
- **Reproduce:** submit any application, then run `select status, attempts from gateq.application_syntheses where application_id='3ec9713b-f060-428e-9cc7-abedd3e0e7cb'`.
- **Next step:** check the workers' logs for the cause.

### D2. High: one fact per dimension drops earlier traction claims and silently resolves a contradiction

`claims.traction` kept only the newest fact:

- turn 8, "1,900 sign-ups, 600 weekly", was superseded by…
- turn 10, "roughly 1,500 weekly users", which was superseded by…
- turn 14, "Willingness to pay has not been tested".

The review screen and the investor's evidence view show no user numbers. The transcript still has both 600 and 1,500. This breaks "Contradictions coexist until reconciled; never silently pick."

To check it, query `gateq.application_facts` for `dimension='claims.traction'` on this application.

### D3. Medium: Q missed a contradiction and repeated a confirmation

- **Missed contradiction:** "600 weekly" (turn 8) against "roughly 1,500 weekly" (turn 10). Q did not ask about it. It later quoted "1,500 weekly users" back as fact (turn 19).
- **Repeated confirmation:** the founder answered "Yes, zero revenue so far. Of our…" and Q asked "So that's USD 0 for revenue, right?" again. The fact was recorded only after the second "Yes" (seq 12). A confirmation combined with new content is not recognised.

### D4. Medium: Q's answer to the investor mixes sources and misstates the documents

- **Sources mixed:** Q said "retention beyond three months is also unknown" and framed it as coming from the application. That text exists only in Kazikit's `network_visible` profile (Sources: "Company · 1"). The application, the transcript and both attached documents do not contain it; checked in `evidence.document_pages`.
- **Leak check:** this is not a leak, because the investor can see that profile anyway. But it blurs provenance, and the founder's review screen says "Nothing else from your Capital Q account goes with it."
- **Documents misstated:** Q also said "no independent document was read" although the deck (7 pages) and the brief were attached. Q does not read the documents the founder submitted.

### D5. Medium: a page view creates a draft, and there is no "already applied" notice

- **Drafts:** each visit by a signed-in founder to `/g/<id>` creates an IN_PROGRESS application.
  - `2d27025f…`: a look before the run.
  - `7b812448…`: a revisit after submitting.
- **No notice:** after submitting, the gateway shows a fresh form. The 180-day rule refuses only at Submit (409), after the whole form and interview have been redone.
- **Reproduce:** sign in as the founder, open `/g/gq_7aekqs9vfk8kvavm8k7tcacryn`, then count the rows in `gateq.applications`.

### D6. Low: touch targets under 44 px at 390 px

- Gateway document checkboxes are 22×22. The label may extend the hit area; this was not measured.
- Inbox "Star Kazikit" is 32×32.
- "Turn off" (keyboard shortcuts) is 45×16.
- The "Inbox" and "All" tabs are 41 px wide.

### D7. Low: copy and prefill

1. **Pre-ticked document:** the deck is pre-ticked even though the copy says "only if you tick it". The default should be opt-in.
2. **Name not prefilled:** the contact step leaves Full name empty for a signed-in founder.
3. **Copy after Submit:** the side panel still says "Nothing is sent until you press Submit."
4. **Inbox claims every rule is met:** the inbox reads "Meets every rule of your gate" although the preferred Sector rule "Doesn't meet". Only the required rules are met.
5. **Questions the founder already answered:** "Website: Missing" while the profile has one, and "What instrument?" while the note says SAFE.

## Records created (production, all fictional)

| What                        | Value                                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Application (submitted)     | `3ec9713b-f060-428e-9cc7-abedd3e0e7cb` (`ga_3w9ej1d5mtsefw6yv2zxdfc62r`), SUBMITTED 23:35:10 UTC            |
| Orphan drafts (IN_PROGRESS) | `2d27025f-36fb-49b9-a3ee-44539e9a4a84`, `7b812448-bf6d-487a-ba1f-b8f229d67f89`                              |
| Relationship                | `network.relationships` `dad0d418-507b-4fda-9813-234d83ebf277`, state INTEREST_EXPRESSED (Kazikit × Kilima) |
| Reply                       | `gateq.inbox_messages` `6fb74858-99a3-4493-bc75-8be8113a0d42` (REPLY, approved by the investor)             |
| Suppressed delivery         | `platform_ops.email_deliveries` id 1339 (SUPPRESSED, `RESERVED_TEST_DOMAIN`)                                |
| Interview                   | 18 turns stored, plus 1 pending Q question                                                                  |
| Synthesis                   | 1 row, FAILED                                                                                               |

## Acceptance-matrix rows affected (`ACCEPTANCE-MATRIX-2026-11-13.md`, part B)

| Row                     | Result                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------- |
| B1                      | No B1 row exists in the matrix; nothing recorded                                      |
| B3 (form)               | Live on desktop and phone, with D7                                                    |
| B3 (contact)            | Account path LIVE_VERIFIED; the guest code path is still unverifiable                 |
| B4 (adaptive interview) | Moves from NOT AUDITED to PARTIAL, LIVE. Investor-aware and gap-driven, but D2 and D3 |
| B5                      | Not run (paid video). The UI shows "5 of 5 video sessions left this week"             |
| B8                      | 180-day block not exercised to 409, deliberately. D5                                  |
| B9 (inbox)              | LIVE with D1 (no synthesis) and D4                                                    |
| B10                     | Reply through Capital Q's own sender after approval; SUPPRESSED row verified          |
| B11 (prefill)           | LIVE, except Full name                                                                |
| B12                     | Allowance display seen only; plan gate not tested                                     |
