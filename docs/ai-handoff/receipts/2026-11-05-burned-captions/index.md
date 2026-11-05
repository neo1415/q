# Pitch videos with captions burned into the picture — 2026-11-05

**Method:** a read-only sweep as the fictional investor `investor.savanna-seed@fictional.capitalq.local`, on production web.

- Walked Discover → For you and Your companies until the feed repeated.
- For each pitch:
  - read the mediaAssetId from our caption `<track>` URL (`/api/pitch-captions/{companyId}/{mediaAssetId}`);
  - set our own text track to `hidden`;
  - hid the app's overlays inside the card;
  - grabbed the bare video element at 20%, 50% and 80% of its length.
- Contact sheets: `contact-sheet-1..4.png`. `sweep.json` lists all 40 assets with the flag.

**Result:** 6 of 40 assets show captions drawn into the picture itself. Each has a frame grab at 50%, named `<mediaAssetId>.png`:

| Company              | mediaAssetId                           | What the picture shows                                                           |
| -------------------- | -------------------------------------- | -------------------------------------------------------------------------------- |
| Ledgerline           | `dd29efcc-fe71-4abf-aee8-25462dc7b782` | Boxed white captions ("It connects to the tools")                                |
| Baridi               | `f2e0f28a-83ac-472d-98d4-4f6ae33163c0` | Boxed white captions ("Traders don't buy anything.")                             |
| Termly               | `f891a735-ed8e-44ff-902c-248344e2fa7c` | Stylised word-by-word captions ("SO THEY", "AND SCHOOLS")                        |
| Halyard Security     | `10f024de-eb99-4315-b0f4-ec3a09919a78` | Monospace captions ("Someone typed a password into")                             |
| Cosecha Labs         | `929f7a77-e98f-4679-8888-30991b7b7bdf` | Boxed captions ("the aquifers are dropping every")                               |
| Clearwater Assurance | `918b81b8-62b4-4d59-96ba-4381809ba367` | A framed layout with its own title and captions ("What I learned is that banks") |

Five of the six (not Cosecha Labs) also carry a faint burned-in "AI actor · fictional company" mark at the top. The other 34, all AI presenter videos, show no text in the picture. So "AI presenter" is not the rule, and each asset has to be flagged.

**Limits:**

- Coverage is what this investor's Discover reaches: 40 assets.
- A pitch outside this feed (another audience, or not publishable) is not in the list.
- The app's caption bar (company name, founder line) could not be hidden in every card. Text under it would be partly masked, but none of the 34 shows text above it.

**Applying the flag:**

- Migration `20261231240000_media_captions_in_picture.sql` adds the column.
- `scripts/handoff/captions-in-picture-data.mjs` sets it for these ids.
- Apply the migration first, then run the script with `--apply`.
