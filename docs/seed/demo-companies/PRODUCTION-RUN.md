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
