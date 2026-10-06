# Real-company seed profiles

These 10 companies are real, operating startups. Each profile in `companies.json` is built only from facts published by the company or reputable press, with source URLs listed per company.

Seeding rules:

- Seed as unclaimed public profiles. No founder accounts, no AI-generated video, no invented metrics, no verified badge.
- `null` means a fact could not be sourced. Unknown stays unknown; do not fill gaps.
- Metrics are company-reported at the stated date and carry their source. Treat them as USER_CLAIM or self-reported, never VERIFIED.
- Descriptions are written in our own words from the sources.
- Funding data reflects the latest round found, not necessarily the latest round that exists. Duplo, Bumpa and Anchor rounds date from 2022-2023.

Gaps filled on 2026-10-06 (P13), each with its source in `fact_sources`; facts that could not be sourced were dropped, with the reason in `gap_notes`:

- Websites confirmed for all 10 (company site fetched, or a directory/press link).
- ekko: second source (Retail Banker International, 2024-05-16) confirms the round and London; the unsourced "seed" stage label was dropped.
- Koolboks HQ Lagos (NextBillion, 2025-08-29); F2 HQ New York, founded 2025 (Y Combinator directory); Anchor founded 2022 (Y Combinator directory).
- Dropped: Bumpa founding year (relaunched 2021 from a 2018 project; sources conflict) and HQ city (no reputable source); MoneyHash city (Wamda describes it as US-based; Cairo unconfirmed). Founding year stays null for HoneyCoin, MoneyHash and Mintlify (sources conflict).
- Public descriptions no longer carry internal research notes.

## How they are seeded

`scripts/seed/real-companies/seed.mjs` (dry run by default; `--apply` writes; idempotent, deterministic ids; ids in `seed-state.json`). Admin-only, under the founder's Supabase management token held in memory. One transaction per company:

- its own tenant and organisation with no members (the platform's 1:1 model), so "Find my startup" shows it as unclaimed and an approved claim can only ever reach that one company;
- the company: `network_visible`, readiness `not_assessed` (never in Discover), no logo (the UI monogram), stage only when the vocabulary has it;
- every fact as a `PUBLIC_WEB` source (URL, publisher, date when stated) → evidence item → claim, `truth_class` USER_CLAIM; `evidence_status` SELF_REPORTED for company-reported metrics and company-only sources, DOCUMENT_SUPPORTED for one independent source, MULTI_SOURCE_SUPPORTED for two or more. Never VERIFIED;
- curated taxonomy (`admin_curated`) for industry, business model, customer type and geography;
- audit rows (`capital_q_system` under the platform owner's authority) and outbox events, as the API would write them.

`search-eval.mjs` measures company search on production data (read-only); `research-probe.mjs` runs a capped number of live Q questions and logs their model cost.

Mandate-fit flags (pre-seed to Series A; B2B SaaS, fintech or enterprise software; Africa, UK or US; no insurance, gambling or adult): Koolboks (hardware climate) and Mintlify (Series B) do not fit; the other eight do.
