# Capital Q demonstration data room

Owner direction, 22 October 2026. Capital Q is seeded as a demonstration company inside its own product (`docs/seed/demo-companies/README.md`). These files fill its data room. The demo-companies seed loads them from `manifest.json`.

**Every file is a demonstration document.** Each PDF page and each spreadsheet sheet carries, in its footer, header row and file properties:

> DEMONSTRATION DOCUMENT — illustrative, prepared for the Capital Q product demo. Not a legal or financial record.

**Everything is uploaded** (owner, 22 Oct 2026):

| File                                                 | Type              | Data room level                  | Folder        |
| ---------------------------------------------------- | ----------------- | -------------------------------- | ------------- |
| `pitch-deck.pdf`                                     | `PITCH_DECK`      | `PUBLIC`                         | `fundraising` |
| `financial-model.xlsx`                               | `FINANCIAL_MODEL` | `ON_REQUEST`                     | `financials`  |
| `capital-q-cap-table.xlsx`                           | `CORPORATE`       | `ON_REQUEST`                     | `cap_table`   |
| `capital-q-certificate-of-incorporation-summary.pdf` | `CORPORATE`       | `ON_REQUEST`                     | `corporate`   |
| `capital-q-shareholder-agreement-summary.pdf`        | `LEGAL`           | `ON_REQUEST`                     | `legal_ip`    |
| `capital-q-board-composition-note.pdf`               | `GOVERNANCE`      | `ON_REQUEST`                     | `corporate`   |
| `capital-q-pitch-video.mp4`                          | pitch video       | audience "Everyone on Capital Q" | `/pitch/new`  |

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

`capital-q-pitch-video.mp4` is a copy of the Q Story **investor edition** (3:58, 720p share copy, from branch `qstory/editions-card`): Q genuinely pitching Capital Q, not a founder video.

- Title: "Capital Q — the story, for investors".
- It goes up through `/pitch/new` with the audience "Everyone on Capital Q", which needs the founder's session and the stream provider.
- This is S1's final take (`qstory/editions-card` @ `934ae9ca9`). Its corner still reads "Internal rehearsal" (`pitchVideo.ownerApprovedForAudience: false`). If the owner approves the cut, S1 re-cuts it; replace the copy and re-run `finalize.py`.

## Rebuild

The commands are listed in `manifest.json` → `build`. The scripts are in `scripts/seed/capital-q-documents/`. PDFs print with Chromium. Spreadsheet formulas are computed by LibreOffice through the xlsx skill's `recalc.py`.
