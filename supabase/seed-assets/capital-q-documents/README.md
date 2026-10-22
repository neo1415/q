# Capital Q demonstration data room

Owner direction, 22 October 2026. Capital Q is seeded as a demonstration company inside its own product (`docs/seed/demo-companies/README.md`). These files fill its data room. The demo-companies seed loads them from `manifest.json`.

**Every file is a demonstration document.** Each PDF page and each spreadsheet sheet carries, in its footer, header row and file properties:

> DEMONSTRATION DOCUMENT — illustrative, prepared for the Capital Q product demo. Not a legal or financial record.

**Uploaded by the seed** (owner, 22 Oct 2026: business documents only):

| File                   | Type              | Data room level | Folder        |
| ---------------------- | ----------------- | --------------- | ------------- |
| `pitch-deck.pdf`       | `PITCH_DECK`      | `PUBLIC`        | `fundraising` |
| `financial-model.xlsx` | `FINANCIAL_MODEL` | `ON_REQUEST`    | `financials`  |

- The deck has 15 slides in black and gold.
- The model covers 36 months, with inputs on their own Assumptions sheet and reconciliation checks.

**Kept here, never uploaded**, until real documents exist (`manifest.json` → `notUploaded`):

- `capital-q-cap-table.xlsx`
- `capital-q-certificate-of-incorporation-summary.pdf`
- `capital-q-shareholder-agreement-summary.pdf`
- `capital-q-board-composition-note.pdf`

## Rules these files keep

- **One set of numbers.** Figures match `supabase/seed-assets/demo-companies/companies.json`. The model's "Annual Summary" sheet reconciles each shared figure and shows OK or CHECK.
- **Illustrative values, approved by the owner on 22 Oct 2026 and still marked illustrative:**
  - the SAFE post-money valuation cap of USD 10,000,000;
  - the founder split (6,000,000 and 3,000,000 shares);
  - the 1,000,000-share ESOP.

  The legal terms marked "illustrative" are placeholders.

- **Legal documents are summaries.** There are no seals, signatures, stamps or registry marks. Identifiers are placeholders such as `RC-DEMO-000000`. Unknown particulars are written as unknown.
- **Real people: roles and titles only.**
- **Not verification.** Loading these files never creates or implies a verification claim.

## Pitch video

There is no fabricated founder video. `manifest.json` → `pitchVideo` names the Q Story master: Q genuinely pitching Capital Q. The seed does not upload it. David uploads it at `/pitch/new` with the audience "Everyone on Capital Q", as an owner step, because it needs his session and the stream provider.

## Rebuild

The commands are listed in `manifest.json` → `build`. The scripts are in `scripts/seed/capital-q-documents/`. PDFs print with Chromium. Spreadsheet formulas are computed by LibreOffice through the xlsx skill's `recalc.py`.
