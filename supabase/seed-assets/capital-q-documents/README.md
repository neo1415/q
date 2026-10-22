# Capital Q demonstration data room

Owner direction, 22 October 2026. Capital Q is seeded as a demonstration company inside its own product (`docs/seed/demo-companies/README.md`). These files fill its data room. The demo-companies seed loads them from `manifest.json`.

**Every file is a demonstration document.** Each PDF page and each spreadsheet sheet carries, in its footer, header row and file properties:

> DEMONSTRATION DOCUMENT — illustrative, prepared for the Capital Q product demo. Not a legal or financial record.

| File                                                 | What it is                                                            |
| ---------------------------------------------------- | --------------------------------------------------------------------- |
| `capital-q-pitch-deck-q3-2026.pdf`                   | 15-slide pitch deck, black and gold                                   |
| `capital-q-financial-model-2026-2028.xlsx`           | 36-month model; assumptions on their own sheet; reconciliation checks |
| `capital-q-cap-table.xlsx`                           | Pre-round and pro forma for the proposed SAFE; sums to 100%           |
| `capital-q-certificate-of-incorporation-summary.pdf` | A summary, not the certificate                                        |
| `capital-q-shareholder-agreement-summary.pdf`        | A summary of illustrative founder terms                               |
| `capital-q-board-composition-note.pdf`               | Board and governance note                                             |

## Rules these files keep

- **One set of numbers.** Figures match `supabase/seed-assets/demo-companies/companies.json`. The model's "Annual Summary" sheet reconciles each shared figure and shows OK or CHECK.
- **Illustrative placeholders, owner to confirm:**
  - the SAFE post-money valuation cap of USD 10,000,000;
  - the founder split (6,000,000 and 3,000,000 shares);
  - the 1,000,000-share ESOP;
  - the legal terms marked "illustrative".
- **Legal documents are summaries.** There are no seals, signatures, stamps or registry marks. Identifiers are placeholders such as `RC-DEMO-000000`. Unknown particulars are written as unknown.
- **Real people: roles and titles only.**
- **Not verification.** Loading these files never creates or implies a verification claim.

## Pitch video

There is no fabricated founder video. `manifest.json` → `pitchVideo` names the Q Story master: Q genuinely pitching Capital Q. It is uploaded through the normal `/pitch/new` path with the audience "Everyone on Capital Q", as an owner-approved deploy-time step.

## Rebuild

The commands are listed in `manifest.json` → `build`. The scripts are in `scripts/seed/capital-q-documents/`. PDFs print with Chromium. Spreadsheet formulas are computed by LibreOffice through the xlsx skill's `recalc.py`.
