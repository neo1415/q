# Production seed run: findings and plan (2026-10-23)

Status: **not run. Nothing was written to hosted.** (Second attempt, 2026-10-23: see "Run 2 findings" at the end.) This branch, `seed/production-run`, is `origin/speed/q-oct20` (74d90d59) with `origin/seed/zino-photo` merged in, which adds `supabase/seed-assets/capital-q-team/zino-cofounder.jpg`.

## Blocker found

- The `SUPABASE_ACCESS_TOKEN` in that environment returned HTTP 401 "Invalid access token" from `api.supabase.com/v1/projects/vcohxiqsmnkzxnvawgri/database/query`.
- `seed.mjs` reads and writes only through that endpoint, so even the dry run cannot plan.
- `SUPABASE_SECRET_KEY` works for the auth admin API, but PostgREST exposes only `public` and `graphql_public` (PGRST106 for `core`). It cannot replace the SQL path.
- The owner has a new token. A fresh session must have it in its environment secrets.

## Environment

- `SUPABASE_URL=https://vcohxiqsmnkzxnvawgri.supabase.co`. The script needs it for the storage uploads (photos, documents).
- `NODE_USE_ENV_PROXY=1`.
- `CQ_SEED_ACCOUNT_PASSWORD` was set.

## Read-only findings

- **No team accounts yet.** None of `zino.mario@`, `daniel.oyeniyi@`, `adeyemi.odunyugbo@` or `david.nwankwo@fictional.capitalq.local` exists (all 1283 auth users checked).
- **Two David candidates:**
  - `founder.capitalq@fictional.capitalq.local`, created 2026-10-15;
  - `davidnwankwo14@gmail.com`, created 2026-10-16. This is a real address.

  Resolve which one owns the Capital Q organisation with SQL before choosing `--person david=`.

- **The `f95c3469…` id.** From the coordinator: `identity.organisation_memberships` has no rows for an `organisation_id` starting `f95c3469`. So `f95c3469…` may be the company id, not the organisation id. Check `core.companies.id` and `core.companies.organisation_id`, and the fixture's `match.organisationId` in `supabase/seed-assets/demo-companies/companies.json`, before applying. A wrong match id could plan a CREATE, which would give a second Capital Q.
- **Pitch video.** `supabase/seed-assets/capital-q-documents/capital-q-pitch-video.mp4` is 6,445,790 bytes. Its sha256 `8c84963b809aac9f1ed1a599d2d546a1f74666a442b3e6f93a6e493d39a8eff6` matches the manifest.
- **Data-room manifest.** The deck is `PUBLIC`. The financial model, cap table, incorporation summary, shareholder-agreement summary and board note are `ON_REQUEST`.

## Run order (dry run first at every write step; show the plan before `--apply`)

1. **Check the token.** Run a read-only `select 1` through the management API.
2. **Resolve with SQL:**
   - Capital Q's company id and organisation id, and confirm exactly one active Capital Q;
   - the organisation's owner;
   - which David account is a member;
   - KUUZA AI and Songscribe as they are now.
3. **Accounts.** Create the three team accounts with the auth admin API, email confirmed, no email sent, password `CQ_SEED_ACCOUNT_PASSWORD`. Create `david.nwankwo@…` only if neither David candidate owns Capital Q. Do this right before step 4, so no account is left without a membership.
4. **Dry run the seed:**
   ```
   node scripts/seed/demo-companies/seed.mjs --hosted \
     --person david=<email> --person zino=zino.mario@fictional.capitalq.local \
     --person daniel=daniel.oyeniyi@fictional.capitalq.local \
     --person adeyemi=adeyemi.odunyugbo@fictional.capitalq.local \
     --photo david=supabase/seed-assets/capital-q-team/david-founder.jpg \
     --photo zino=supabase/seed-assets/capital-q-team/zino-cofounder.jpg \
     --documents
   ```
   Check:
   - Capital Q shows `company <id>` and not CREATE;
   - KUUZA AI shows additions only;
   - there is no unexpected SKIP.
5. **Apply.** Run the same command with `--apply`.
6. **Pitch video.** The seed does not do this (see `seed.mjs`). Sign in as David and drive the web's real upload route over HTTPS (the `/pitch/new` flow), with audience "Everyone on Capital Q". Do not call the stream provider directly. Do the same for Songscribe and KUUZA AI only if the seed has a video for them.
7. **Confirm the deck.** Once Q's reading of the deck exists, run the same `--person` arguments with `--confirm-deck` (dry run, then `--apply`).
8. **Verify on production.** Use read-only SQL, then Playwright with `executablePath: /opt/pw-browsers/chromium`. Take screenshots of:
   - exactly one Capital Q;
   - the team with photos on the company card and both person cards;
   - the six documents at their levels;
   - the video playing on the profile and appearing in Explore;
   - Q answering "tell me about Capital Q" and Songscribe;
   - the InvestIQ band.
9. **Hand back.** Commit the evidence (no secrets), open a PR into `speed/q-oct20`, and message the coordinator.

## Run 2 findings (2026-10-23, second worker)

- **Token:** the new `SUPABASE_ACCESS_TOKEN` works (`GET /v1/projects` → 200; read-only SQL works). `origin/speed/q-oct20` (37599c71) is merged into this branch.
- **Capital Q (resolved, one only):** company `ee75a7d8-d457-4b59-9ad8-0d64b3026a3d`, organisation `f95c3469-ef29-4574-a508-c1ba1131d842`. So `f95c3469…` is the **organisation** id and the fixture's `match.organisationId` is correct. It is `network_visible`, `demonstration_data=false`.
- **David:** `founder.capitalq@fictional.capitalq.local` (user profile `7ab32dff…`, display name "Capital Q demo founder") is Capital Q's **only** member. `davidnwankwo14@gmail.com` (profile "David") has no membership in any organisation. Use `--person david=founder.capitalq@fictional.capitalq.local`.
- **KUUZA AI:** company `866bcc12…`, `organisation_private`, founder-onboarded. The dry run plans additions only.
- **Songscribe: owner decision needed.** The fixture assumes Songscribe is absent ("Songscribe created once"). It now exists live as **"SongScribe AI"** (company `b3308b98…`, created 2026-10-19 by its founder's own onboarding, `organisation_private`, slug `songscribe-ai`, website `https://www.songscribe.ai`, "AI music studio that turns your story into a finished custom song in about a minute"). The fixture's names don't include "SongScribe AI", so a run as written would **CREATE a second Songscribe**. Adding the name in `CORRECT` mode would instead overwrite the founder's own name, description and visibility with the fixture's different description. Neither is acceptable without the owner, so this run uses the new `--skip songscribe`. Options for the owner: (a) treat it like KUUZA AI (`FILL_GAPS`, add "SongScribe AI" to `match.names`) after checking the fixture's nine figures still describe this product; (b) leave it to its founder.
- **Dry run (David only, `--skip songscribe`, `--documents`, David photo):** Capital Q `company ee75a7d8…` (no CREATE): fields website_url, short_description, primary_description + demonstration label; claims +11, superseded 0; taxonomy +6; raise replace; card create; handle `capital-q-hq`. KUUZA AI: fields none + label; claims +4; taxonomy +2. Team title for David; David photo 512×512 WebP; data room: deck PUBLIC, five others ON_REQUEST; person card `@david-nwankwo`.

### Blocker (run 2)

The session's permission policy refused the first production write (creating the three team accounts through the auth admin API) as "Modify Shared Resources": the production direction reached that worker as a coordinator message, not from the owner in that session. Nothing was written. A session where the owner states the go-ahead directly can run the exact commands below.

### Exact commands for the run

```
export NODE_USE_ENV_PROXY=1 SUPABASE_URL=https://vcohxiqsmnkzxnvawgri.supabase.co
pnpm exec turbo run build --filter=./packages/*   # seed.mjs imports packages/*/dist
# 1. accounts: POST $SUPABASE_URL/auth/v1/admin/users, email_confirm true, password CQ_SEED_ACCOUNT_PASSWORD
#    zino.mario@, daniel.oyeniyi@, adeyemi.odunyugbo@fictional.capitalq.local
# 2. dry run, then the same with --apply
node scripts/seed/demo-companies/seed.mjs --hosted --skip songscribe \
  --person david=founder.capitalq@fictional.capitalq.local \
  --person zino=zino.mario@fictional.capitalq.local \
  --person daniel=daniel.oyeniyi@fictional.capitalq.local \
  --person adeyemi=adeyemi.odunyugbo@fictional.capitalq.local \
  --photo david=supabase/seed-assets/capital-q-team/david-founder.jpg \
  --photo zino=supabase/seed-assets/capital-q-team/zino-cofounder.jpg \
  --documents
# 3. pitch video at /pitch/new signed in as founder.capitalq@, audience "Everyone on Capital Q"
# 4. --confirm-deck (same --person args) once Q's hosted deck reading exists
```

## Run 2 result (2026-10-23, owner said "go" in-session)

Written to production (all idempotent; a re-run plans "nothing to change"):

- Accounts (auth admin API, email confirmed, no email sent): `zino.mario@`, `daniel.oyeniyi@`, `adeyemi.odunyugbo@fictional.capitalq.local`.
- `seed.mjs --hosted --skip songscribe` with all four `--person`, both `--photo` and `--documents`, then `--apply`:
  - Capital Q updated in place (`ee75a7d8…`): 3 fields, the demonstration label, +11 self-reported claims, +6 taxonomy, the raise replaced, the company Q Card, handle `capital-q-hq`.
  - KUUZA AI: +4 claims, +2 taxonomy, the label. Nothing overwritten.
  - Team memberships (member role only) with titles; photos for David and Zino (512×512, `READY`); cards `@david-nwankwo` and `@zino-mario`.
  - The six data-room documents: the deck PUBLIC, the other five ON_REQUEST.
- `--confirm-deck --apply`: confirmed Q's reading `23364fd4…` of "Pitch deck, Q3 2026" (15 pages, read 08:45 UTC), as David.
- Profile names (same columns the app's own profile update writes, `version + 1`), from the fixture: David Nwankwo (replacing "Capital Q demo founder"), Captain Zino Mario, Daniel Oyeniyi, Adeyemi Odunyugbo. Without a name, `/u/zino-mario` returned 404; the seed sets no names (gap in `seed.mjs`).

Pitch video: **FAILED, owner decision needed.**

- Uploaded through the real `/pitch/new` flow signed in as David. Media asset `9e3ba15e…` is `PROCESSING_FAILED` at Cloudflare Stream.
- Cause: the file is 3 min 59 s (238.8 s, H.264/AAC 1280×720). The product's hard limit is 180 s (`packages/media/src/contracts/index.ts` `DEFAULT_PITCH_DURATION_POLICY.hardMaxSeconds`), and it is sent to Stream as `maxDurationSeconds`.
- The failed record is private (organisation only); "Upload again" on `/pitch/9e3ba15e…` reuses it.
- Capital Q's existing pitch ("AI presenter, AI-generated", 0:50, NETWORK) is unchanged.

Live verification (Playwright, investor `investor.equator-line@` and David; screenshots in `evidence-2026-10-23/`):

| Check                       | Result                                                                                                                                                                                                                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One Capital Q               | PASS (SQL: one active company; profile 200)                                                                                                                                                                                                                                                         |
| Demonstration label         | PASS (profile, company card, both person cards)                                                                                                                                                                                                                                                     |
| Team with photos            | PASS: Team 4 (David Nwankwo Founder, Captain Zino Mario Co-founder, Adeyemi and Daniel Engineering), both photos load; `/u/david-nwankwo` and `/u/zino-mario` 200 with photo                                                                                                                        |
| Documents at their levels   | PASS (David's data room: all six; ON_REQUEST shown). The investor tab reads "Data room 0" before interest; the deck has its own tab                                                                                                                                                                 |
| InvestIQ band               | PASS: Investability 75/100 "Strong, low confidence, 17 of 46 factors"; Suitability 60/100                                                                                                                                                                                                           |
| Q "tell me about Capital Q" | PARTIAL: the bare question is answered about the platform. Naming the company, Q answers from the profile and cites demonstration data, but says it has no authorised record of revenue, customers or raise: the 11 new claims don't reach Q yet (projection lag or a retrieval gap; not diagnosed) |
| Video plays on profile      | NOT VERIFIABLE HERE: this Chromium has no H.264/MSE (`canPlayType` empty). The existing 0:50 pitch is listed on the Elevator tab                                                                                                                                                                    |
| Video in Explore            | NOT FOUND in the first 25 feed cards for this investor (likely ranking or mandate; Capital Q is a stage mismatch for this Series A fund)                                                                                                                                                            |

## Run 2, owner decisions applied (2026-10-23, in-session)

- **Songscribe** (owner: "fill in the gaps"): the fixture now matches "SongScribe AI" in `FILL_GAPS` mode with only the four figures that fit its product. Applied to `b3308b98…`: +4 self-reported claims (monthly revenue, gross margin, team size, raise target), +2 taxonomy (industry, technology) and the demonstration label. Its name, description, website and `organisation_private` visibility are unchanged; no raise record, card, handle or membership. Re-run plans nothing. `--skip` is no longer needed but stays available.
- **Pitch video** (owner: "trim to 3:00 and upload"): trimmed to 179 s with a 1.5 s fade-out:
  `ffmpeg -i capital-q-pitch-video.mp4 -t 179 -af "afade=t=out:st=177:d=2" -vf "fade=t=out:st=177.5:d=1.5" -c:v libx264 -crf 20 -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart capital-q-pitch-video-3min.mp4`
  (sha256 `5eb887205281595c4f2c311f64cd8838b005fbca4889b8763dbb350485684d40`, not committed; reproducible from the original). Uploaded as David through "Upload again" on the failed pitch: new media asset `104d9721…` **READY**, 179 s, audience NETWORK ("Everyone on Capital Q"), playback AUTHORISED; it replaces the failed `9e3ba15e…` (superseded). The investor profile's Elevator tab shows "2 videos and pitches from the founders" including the 2:59 pitch, and Cloudflare Stream answered the player's playback request with 200. Frame decoding is not checked here (this Chromium has no H.264).
- **Local tests:** `scripts/local-pg/setup.sh` then `node --test scripts/seed/demo-companies/seed.local.test.mjs`: 12/12 pass (the Songscribe test now asserts gap-fill only, never a second company).
