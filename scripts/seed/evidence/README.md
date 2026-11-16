# Synthetic demo evidence: Tensorgate and Halyard Security

Phases 2 and 3 of the owner directive of 16 Nov 2026 (`docs/ai-handoff/directives/2026-11-16-demo-evidence-data-room-seeding.md`). This folder builds a deterministic evidence pack for the two fictional tavus-20 showcase companies. It works locally and offline: nothing here uploads, seeds, writes to a database or calls a model.

## Files

| File                                               | Role                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fixtures/tensorgate.json`                         | Source of truth for Tensorgate (USD). It holds 18 months of actuals (May 2025 to Oct 2026), customers, invoices, the bank account at a fictitious bank, the cap table, the seed raise, projections to Dec 2027, the team and the known discrepancies.                                                                         |
| `fixtures/halyard.json`                            | The same for Halyard Security (GBP).                                                                                                                                                                                                                                                                                          |
| `documents.mjs`                                    | Builds the document models, the CSVs and the manifest from a fixture. Pure: it uses no clock and no randomness.                                                                                                                                                                                                               |
| `render.mjs`                                       | Renders text-native PDFs with `pdf-lib`, the library the memo and deck export already uses. It is resolved from `packages/deck-render`, so no dependency was added. Every page carries the synthetic header line, a light diagonal watermark, and a footer with the company, title, version, period, issue date and page n/m. |
| `generate.mjs`                                     | Writes the files to `out/<company>/`, which is gitignored, and checks the committed manifests.                                                                                                                                                                                                                                |
| `manifests/<company>.json`                         | One entry per document: stable id, file name, title, document type code, default sensitivity, whether an investor's Q can read it under current rules, period, issue date, version, data-room folder and checklist item, intended level (PRIVATE), and the planned fictional investor share.                                  |
| `apps/workers/test/demo-evidence-fixtures.test.ts` | The consistency validator.                                                                                                                                                                                                                                                                                                    |

```bash
PATH=/opt/node24/bin:$PATH node scripts/seed/evidence/generate.mjs                  # build into out/, check manifests
PATH=/opt/node24/bin:$PATH node scripts/seed/evidence/generate.mjs --write-manifest  # after a fixture change
bash scripts/heavy.sh npx vitest run apps/workers/test/demo-evidence-fixtures.test.ts
```

## Rules the fixtures keep

- **Seed preserved.** Each fixture keeps its company's identity, founders, team, industry and stage, and its seed raise (amount, instrument, valuation, close date, minimum cheque, use of funds) from `docs/seed/tavus-20/companies-full.json`. It also keeps every KPI point the 6 Oct seed wrote as a SELF_REPORTED claim. The validator checks each of these against the seed file.
- **Reconciled.**
  - Revenue for each month equals that month's invoices plus documented reconciling items: Tensorgate's deferred implementation fee, and Halyard's deployment fees, which are invoiced at signature and recognised at go-live.
  - Cash rolls forward every month, and burn and runway are derived from it.
  - Receivables, deferred revenue and the balance sheet tie out.
  - Ownership sums to 100.00%. Customer counts are dated from customer records.
  - Projections start after the last actual month.
  - Every document that mentions the raise prints one identical terms sentence.
- **Known discrepancies.** Each company has two deliberate contradictions and one reconciliation the seed forced. Each is listed under `knownDiscrepancies`, with the reason and the exact documents it appears in.
  - Tensorgate:
    - **Burn and runway.** The deck says about 135k a month and 8.1 months. October's accounts show 152,800 and 6.2 months: the SOC 2 audit, round legal fees and GPU reserved for Customer C.
    - **Contracted ARR (360k) against billed revenue.** Customer C signed in August but is billed only from 1 Oct 2026, after deployment acceptance.
  - Halyard:
    - **Gross margin.** The deck says 82%, which is licence margin. The accounts show 29.3% because the deployment team sits in cost of sales.
    - **Burn and runway.** The deck says about 70k and 6.9 months. October shows 92,340 and 4.2 months: two deployment hires, a recruitment fee, and no deployment-fee receipts that month.
  - The forced reconciliation (`deliberate: false`): the seed lists only one small pre-seed round, which cannot fund 18 months of costs down to the seeded September cash. The accounts therefore record a December 2025 SAFE extension for Tensorgate and a July 2025 advance subscription for Halyard.
- **Synthetic and honest.**
  - Banks are fictitious and account numbers masked.
  - There are no certificates, registries, seals or signatures, and customer names are withheld.
  - Titles never say "fictional"; the header line says what the document is.

## What the upload step will need

The upload step is not part of this slice.

- Upload as each company's fictional founder, through the supported document route, with the manifest's `documentType` declared and text-layer PDFs, so no kind classification or page transcription runs. Default level is PRIVATE.
- Six documents per company are HIGHLY_CONFIDENTIAL by default, because their types are FINANCIAL, MANAGEMENT_ACCOUNTS or FINANCIAL_MODEL: the management accounts, monthly actuals, revenue breakdown, invoice register, bank statement and projections. An investor's Q cannot read them even when they are shared. See the inventory, decision 5 (a/b/c). The CONFIDENTIAL ones are the contracts, cohorts, concentration, cap table, raise terms, KPI pack and team plan.
- Grants go through the data-room approval or diligence-share workflow:
  - Tensorgate: to Savanna Seed Partners, where the relationship exists.
  - Halyard: to Thames Arc, where a relationship must exist first.
- Embeddings need the provider decision (decision 6).
