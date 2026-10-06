# Real-company seed profiles

These 10 companies are real, operating startups. Each profile in `companies.json` is built only from facts published by the company or reputable press, with source URLs listed per company.

Seeding rules:

- Seed as unclaimed public profiles. No founder accounts, no AI-generated video, no invented metrics, no verified badge.
- `null` means a fact could not be sourced. Unknown stays unknown; do not fill gaps.
- Metrics are company-reported at the stated date and carry their source. Treat them as USER_CLAIM or self-reported, never VERIFIED.
- Descriptions are written in our own words from the sources.
- Funding data reflects the latest round found, not necessarily the latest round that exists. Duplo, Bumpa and Anchor rounds date from 2022-2023.

Known gaps to re-check before display:

- ekko has a single source and an unverified stage label (see `data_quality_note`).
- Several websites are null because the sandbox could not fetch or confirm them.
- Founding year is null where sources conflict (HoneyCoin, MoneyHash, Mintlify).
- Bumpa and Koolboks HQ city were not stated in the sources.

Mandate-fit flags (pre-seed to Series A; B2B SaaS, fintech or enterprise software; Africa, UK or US; no insurance, gambling or adult): Koolboks (hardware climate) and Mintlify (Series B) do not fit; the other eight do.
