# Demonstration companies: Capital Q, KUUZA AI and Songscribe

Owner direction, 22 October 2026. Real people appear with their permission. Every figure is **demonstration data**: self-reported, labelled as such everywhere, and never verified.

## What it does

Source: `supabase/seed-assets/demo-companies/companies.json`, one fixture shared with the Q Story's Q Card. The script is `scripts/seed/demo-companies/seed.mjs`.

**Capital Q (CORRECT).**

- It is found by its organisation id, `f95c3469-…`, and the existing record is corrected in place. A second Capital Q is never created.
- Two names, any case, stop the run: "one canonical company is required".
- Values: Lagos, NG; pre-seed; website `https://capital-qweb-production.up.railway.app/`.
- Founders: David Nwankwo (Founder & CEO, surname confirmed by the owner) and Captain Zino Mario (Co-founder).
- Engineering team: Daniel Oyeniyi and Adeyemi Odunyugbo. They appear only through their own accounts, never as founders.

**KUUZA AI (FILL_GAPS).**

- It already exists live through its founder's own onboarding, so nothing its founder entered is ever overwritten.
- Only missing figures are added.
- Its visibility, stage and HQ stay the founder's.

**Songscribe (CORRECT; real company; its owners agreed).**

- An AI songwriting assistant. Founders: Excel Chukwu and Zino Mario.
- HQ and website are unknown, so they stay unknown.

**Figures.** Every figure is a claim with truth class `USER_CLAIM` (`ESTIMATE` for market size) and evidence status `SELF_REPORTED`, at `network_visible`. Its statement ends "(Demonstration data, self-reported by the company.)", so Q cites it as such.

**Corrections are append-only.**

- A wrong existing figure is **superseded** through a new revision.
- A wrong raise is **replaced**.
- Nothing is deleted.
- No verification is written.

**Label.** `core.companies.demonstration_data` (migration `20261229100000`) shows a "Demonstration data." note on the company profile and the Q Card. A person card whose focus echoes such a company shows it too.

**Q Cards.**

- Company handles: `capital-q-hq` (`capital-q` and `capitalq` are reserved platform handles) and `songscribe`.
- Numbers and raise are public. Relationships, Q's reading and team are members only.
- A person's own card only for an existing account named with `--person`: handle `david-nwankwo` or `zino-mario`, created as that person.

## Production run (owner-approved, at deploy time)

1. Apply migrations `20261229090000_person_q_card` and `20261229100000_company_demonstration_data` after pgTAP passes in CI.
2. Dry run, then read the plan:
   ```
   SUPABASE_ACCESS_TOKEN=… node scripts/seed/demo-companies/seed.mjs --hosted \
     --person david=<david's account email> --person zino=<zino's account email>
   ```
   Check:
   - Capital Q shows `company <its id>` (not CREATE);
   - KUUZA AI shows only additions;
   - no SKIP you didn't expect.
3. Apply: the same command with `--apply`. It runs one transaction per company and is safe to run again; a second run plans nothing.
4. Scores: the workers recompute on the outbox events the seed writes (`evidence.claim.changed`, `core.company.updated`). The 30-minute sweep is the backstop.
5. Team (owner 2026-10-22): `--person zino=<email> --person daniel=<email> --person adeyemi=<email>` seeds organisation memberships directly with the `organisation_member` role. **No invitation is created or sent.** It adds `company_members` with titles (Founder & CEO, Co-founder, Engineering) and, for founders only, network-visible background lines that are **roles only** ("Founder & CEO, Capital Q"). No career history is invented. Only founders get a person Q Card.
6. Data room: `--documents` uploads every document in `supabase/seed-assets/capital-q-documents/manifest.json` (owner, 22 Oct: "upload everything", superseding "business docs only"). The bytes go to `cq-documents-private`, and the rows are written as the founder's own upload: `evidence.documents`, version 1, a `data_room_entries` row, audit, and `evidence.document.version_created`.
   - The pitch deck is `PUBLIC` (fundraising folder), downloadable by investors.
   - The financial model is `ON_REQUEST` (financials folder).
   - The cap table, incorporation summary, shareholder-agreement summary and board note are ON_REQUEST. Each is watermarked as an illustrative demonstration document, not a legal or financial record.
   - Documents are never verification, and none is written.
   - A sha256 mismatch against the manifest stops the run.
   - On hosted, the event starts the real pipeline: processing, `evidence.document.ready`, then Q's deck reader through the model gateway.
7. Deck confirmation, a **separate later run**: once the reading exists, `--confirm-deck` confirms the latest reading of the current deck version on the founder's behalf (owner: "seed marks it confirmed"). It is audited `deck_extraction.confirmed` with `confirmedOnOwnerApproval: true`. With no reading yet, it plans nothing.
8. Pitch video (owner 2026-10-23: "seed the video"): `node scripts/seed/demo-companies/pitch.mjs --founder <david's account email> [--apply]` (needs `SUPABASE_ACCESS_TOKEN`). It uploads the owner-approved investor master (`capital-q-pitch-video.mp4`, checked against the manifest's sha256 and size) through the product's own pitch flow as David: create, direct upload to the stream provider's edge, sync until READY, then title "Capital Q — the story, for investors", audience NETWORK ("Everyone on Capital Q") and investor playback AUTHORISED. David's session comes from a one-time magic-link exchange; no email is sent. A dry run reads the current pitch only. A second run changes nothing. This is one upload to the stream provider (about 6.4 MB, 4 minutes).
9. Photos: David's own photo is seeded with `--photo david=supabase/seed-assets/capital-q-team/david-founder.jpg` (needs `--person david=<email>`, plus `SUPABASE_URL` and `SUPABASE_SECRET_KEY` for the upload). It is re-encoded by the product's own processor, uploaded first, and recorded as his READY avatar. It then shows on Capital Q's Q Card team section (members only) and on his own card. Alternatively, upload David's headshot (`supabase/seed-assets/capital-q-team/david-founder.jpg`, on branch `seed/team-photos`) through the profile UI, which re-encodes it, as David's photo and, if wanted, Capital Q's logo. Zino's is pending from the owner. No photo of a real person is fetched from the web.

## Local rehearsal (no Docker)

- Postgres 16 with pgvector and pgTAP, a `pgmq` stub and a minimal Supabase bootstrap (roles, `auth`, `storage`). All migrations apply from empty.
- The test clones the migrated database as a template:
  ```
  CQ_SEED_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:54329/cq \
    node --test scripts/seed/demo-companies/seed.local.test.mjs
  ```
- `--local-fixture-reading` writes `scripts/seed/demo-companies/local-deck-reading.fixture.json` as the deck reading. It is a **LOCAL REHEARSAL FIXTURE — NOT A MODEL READING**, hand-transcribed from the deck so the scorers can be measured without a model call. `--hosted` refuses it. `--storage-dir <dir>` writes uploads to a directory instead of Supabase Storage.
- 12 tests:
  - one canonical Capital Q;
  - claims self-reported only, and no verification;
  - wrong figures and raise superseded;
  - KUUZA AI gap-fill only;
  - Songscribe created once;
  - listed to Q;
  - Q Cards;
  - idempotent;
  - a duplicate stops the run;
  - team: member role only, no invitations, roles-only backgrounds;
  - data room: all six manifest documents at their levels, only the deck open to investors, and confirmed by David;
  - person cards for the founders only.

## Scores (local, after seeding, deterministic scorers)

| Company    | InvestIQ                                                     | Unicorn potential     |
| ---------- | ------------------------------------------------------------ | --------------------- |
| Capital Q  | 50, **Investable**, Low confidence; 1/8 areas, 8/46 criteria | Insufficient evidence |
| Songscribe | 50, **Investable**, Low confidence; 1/8 areas, 8/46 criteria | Insufficient evidence |
| KUUZA AI   | not scored: not listed (its founder's choice)                | not scored            |

**What moved them:**

- Self-reported claims for traction, customers (filed as `customers.*`), financials, market size and team.
- The raise stated as a `capital.raise_target` claim (+2 criteria for Capital Q).
- Business model, product description and taxonomy.

Self-reported evidence carries weight 0.5, so confidence stays Low. **That is honest, and it is left as is.**

**What would raise them truthfully:**

- A confirmed pitch deck shared with investors; it grades many criteria against stage benchmarks.
- Founders' own network-visible background lines: role history and prior companies.
- The team as accounts with titles.
- A pitch video.
- Capital Q's organisation verification, decided by an operator.

### Capital Q before and after the team and data room (local, InvestIQ)

The deck reading here is the **local fixture**. On hosted, the result depends on Q's real reading of the deck.

| Stage                                   | Score | Band       | Confidence | Areas | Criteria |
| --------------------------------------- | ----- | ---------- | ---------- | ----- | -------- |
| Claims only                             | 50    | Investable | Low        | 1/8   | 8/46     |
| + team and role-only backgrounds        | 50    | Investable | Low        | 2/8   | 9/46     |
| + data room with an unconfirmed reading | 69    | Strong     | Low        | 4/8   | 15/46    |
| + deck confirmed                        | 76    | Strong     | Low        | 4/8   | 15/46    |

| Area                  | Before (graded)   | After (graded)    |
| --------------------- | ----------------- | ----------------- |
| Business fundamentals | 3/6               | 5/6, scored       |
| Commercial strength   | 2/6, insufficient | 3/6, scored       |
| Financial readiness   | 1/6               | 3/6, scored       |
| Management and team   | 1/5               | 2/5, scored       |
| Investment case       | 1/6               | 2/6, insufficient |
| Diligence readiness   | 0/6               | 0/6               |
| Governance            | 0/5               | 0/5               |
| Legal and corporate   | 0/6               | 0/6               |

- Confidence stays Low: everything is self-reported, and verification is unfaked.
- Uploading the four legal and corporate documents changes nothing: 76 Strong, 4/8 areas, 15/46 criteria. **InvestIQ does not read data-room documents other than the deck**; diligence, governance and legal grade only from a confirmed deck, background lines and verification. So those areas stay at 0, and no score comes from the illustrative summaries.
- Unicorn potential is unchanged: insufficient evidence (P2 2, P3 2.5, P4 3, P5 2).

## Discoverability

- **Q:** listed and discovery-eligible in `knowledge.company_profiles`, so Q's company discovery and search find them, with their demonstration statements.
- **Investor Discover** additionally needs `marketplace_ready`, which requires the founder's identity and the organisation to be verified by Capital Q. A seed must not fake that.
- **Explore** needs a pitch video.

These remain owner actions.

## Coverage: why claims alone cannot lift the scores further

InvestIQ maps a network-visible claim to a criterion by its claim type alone:

| Claim type         | Criterion                  |
| ------------------ | -------------------------- |
| financial, revenue | `fh.historical_financials` |
| traction, metric   | `cp.traction`              |
| customers          | `cp.customer_base`         |
| market             | `mo.market_size`           |
| team               | `fl.leadership_depth`      |
| compliance         | `gir.regulatory_exposure`  |
| capital            | `cs.raise_amount`          |

So claims reach at most 9 of 46 criteria.

- **Capital Q** covers 8. Songscribe covers 8 since its market estimate was added.
- **`compliance` is left empty on purpose.** It would assert Capital Q's regulatory position, which nobody has stated.
- **The other 37 criteria** come only from:
  - a deck whose sections the founder confirmed, for product, competition, go-to-market, founders and team;
  - founders' own network-visible background lines;
  - verification and confirmed facts for governance, legal and diligence (the scorer does not read data-room documents other than the deck);
  - Capital Q's organisation verification;
  - a pitch investors may play.

A seed may not invent any of these.

**Unicorn potential, per pillar after seeding:**

| Pillar             | Capital Q | Songscribe |
| ------------------ | --------- | ---------- |
| P2 market          | 2         | 2          |
| P3 problem and fit | 2.5       | 2.5        |
| P4 traction        | 3         | 3          |
| P5 unit economics  | 2         | 2          |

- Every other pillar is unknown: founders, moat, team, scalability, timing, distribution, capital strength and ecosystem.
- Runway (P8) is excluded on purpose: with cash and burn it reveals runway.
