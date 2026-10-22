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
5. Photos: David's own photo is seeded with `--photo david=supabase/seed-assets/capital-q-team/david-founder.jpg` (needs `--person david=<email>`, plus `SUPABASE_URL` and `SUPABASE_SECRET_KEY` for the upload). It is re-encoded by the product's own processor, uploaded first, and recorded as his READY avatar. It then shows on Capital Q's Q Card team section (members only) and on his own card. Alternatively, upload David's headshot (`supabase/seed-assets/capital-q-team/david-founder.jpg`, on branch `seed/team-photos`) through the profile UI, which re-encodes it, as David's photo and, if wanted, Capital Q's logo. Zino's is pending from the owner. No photo of a real person is fetched from the web.

## Local rehearsal (no Docker)

- Postgres 16 with pgvector and pgTAP, a `pgmq` stub and a minimal Supabase bootstrap (roles, `auth`, `storage`). All migrations apply from empty.
- The test clones the migrated database as a template:
  ```
  CQ_SEED_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:54329/cq \
    node --test scripts/seed/demo-companies/seed.local.test.mjs
  ```
- 9 tests:
  - one canonical Capital Q;
  - claims self-reported only, and no verification;
  - wrong figures and raise superseded;
  - KUUZA AI gap-fill only;
  - Songscribe created once;
  - listed to Q;
  - Q Cards;
  - idempotent;
  - a duplicate stops the run.

## Scores (local, after seeding, deterministic scorers)

| Company    | InvestIQ                                                     | Unicorn potential     |
| ---------- | ------------------------------------------------------------ | --------------------- |
| Capital Q  | 50, **Investable**, Low confidence; 1/8 areas, 8/46 criteria | Insufficient evidence |
| Songscribe | 50, **Investable**, Low confidence; 0/8 areas, 7/46 criteria | Insufficient evidence |
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

## Discoverability

- **Q:** listed and discovery-eligible in `knowledge.company_profiles`, so Q's company discovery and search find them, with their demonstration statements.
- **Investor Discover** additionally needs `marketplace_ready`, which requires the founder's identity and the organisation to be verified by Capital Q. A seed must not fake that.
- **Explore** needs a pitch video.

These remain owner actions.
