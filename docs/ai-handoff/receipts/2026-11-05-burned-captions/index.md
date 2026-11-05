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

## Sweep 2: every READY founder pitch (108), 2026-11-05

**Input:** `all-ready-pitches.json` (108 READY founder pitches; 6 already flagged).

**Method:** for each unflagged asset, as the same fictional investor, reads only:

- open `/company/{companyId}?tab=elevator`;
- find `[data-profile-video="{mediaAssetId}"]` and press Play;
- confirm the playing asset is the listed one;
- set our `<track>` to `hidden` and hide every element inside the player except the video;
- grab the bare video at 20%, 50% and 80%.

Contact sheets: `contact-sheet-company-1..7.png`.

**Result:** 17 more assets show captions drawn into the picture. Each has a frame grab, `<mediaAssetId>.png`:

| Company                  | mediaAssetId                           |
| ------------------------ | -------------------------------------- |
| Akshar                   | `52e5bca7-acd4-4ea4-8687-c635bdced268` |
| Capital Q (product demo) | `d06108c4-a835-4344-876c-bbf409f79f56` |
| Drishti Health           | `2914f664-8edd-4490-8dbe-0a2459a2794b` |
| Ferrolith                | `f67359f7-eaed-460a-9045-5184c1418a17` |
| Hui                      | `fab878ce-3ff6-4139-b358-df5cd5112276` |
| MedTrail                 | `0b18f34f-e22d-432d-88c4-e4d1b19e65fe` |
| Mizan                    | `1942d6c9-c712-43e5-8711-1f40a8043a02` |
| Nixo                     | `38579af4-cfa2-4fd8-9381-d9f562768c03` |
| Orphéa Genomics          | `c508b45b-d78a-4bf1-b222-0aee4c9dd93d` |
| Portside                 | `6446ecd8-59c6-40df-b704-6b8e2f0a5be8` |
| Prumo                    | `117e57ea-5db4-4428-8920-86a64ad5e6a5` |
| Railhead Robotics        | `782410d9-ccac-4ca6-9ad4-8983f041516f` |
| Rand Treasury            | `95e52695-7c27-4079-8a4c-2606c78cd19c` |
| Shiftwell                | `c1ff04c2-685a-45c6-8d06-40805ae1daf2` |
| Silo Credit              | `d93bb9a2-124b-4426-800d-ca35da8ef601` |
| Spheros                  | `774e5868-ea44-4b1b-9246-9b3dbc5e3ee7` |
| Tensorgate               | `278ec231-a070-4540-b599-396b0d6e68b3` |

**Totals** (`sweep.json`, one row per READY pitch, with `checkedBy`):

- 23 flagged (`captionsInPicture: true`);
- 65 checked clear (`false`);
- 20 not reachable (`null`).

The data script sets the flag only for the 23 that are `true`.

**Not reachable (20):** the listed video is not on its company's elevator tab for this investor. These are most likely older pitches the page no longer shows, or a narrower audience. Access was not worked around.

- Ajopot `d83b6741`
- Brightkloof Energy `520ef763`, `274c18b1`
- Capital Q `cdaadc96`, `104d9721`
- Clinicrest `47e73410`
- Kazikit `d808ac66`, `cd27062e`
- Ledgerfold `1447da38`
- Maji Loop `a6473c96`
- Marketlight Grids `c1e81086`
- Nsuo Labs `47dd744d`, `c6d0e69f`
- Souqsheet `62d012a2`
- Tallyloom `4a0930c1`, `f6b7f1e5`
- Tarmacly `f3aec1c0`, `fd6da954`
- Yamfield Agro `2c025df1`, `c81ecb46`

Full ids are in `sweep.json`.

**Harbourline Cargo (`1218b83c`) is not flagged, on purpose.** With every app element hidden, its frames still show a lower-third bar: "AI presenter · AI-generated / Harbourline Cargo / Pitch summary for founder Babatunde Oyelaran".

- That bar is burned into the video, but it is a static title card, not captions.
- The same burned lower third is on most of the AI-presenter videos (about 60). `feed-card.tsx` `aiPresenterLine` already documents it.
- Flagging these would remove the only captions those videos have.
- The overlap between our caption and that title is a cue-placement matter (`placeCues`), not a captions-in-picture one.
