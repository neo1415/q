# Tavus-20 production seed: bugs and UX gaps

Found while seeding the 20 fictional companies into production through the real UI (Playwright, Chromium), 2026-10-06. Each entry: where, steps, expected, actual, severity (S1 blocks a founder, S2 wrong or lossy, S3 friction or polish).

## Log

## Checkpoint 1: Ledgerline (n1) end to end, 12:35 UTC

- Accounts: founder Tobenna Okafor + Funmilayo Adebayo (Admin), Emeka Chukwu, Zainab Lawal (Members); all `adedaniel502+cq-<first>-ledgerline@gmail.com`, created by the admin API (`fictional_demo`, synthetic), signed in with one-time admin magic-link tokens through `/auth/callback` (no email sent).
- UI: founder onboarding (form), profile About / Company / Sector / headline, logo + company cover + cover + profile photo (crop dialogs), Capital "Open a round", Documents upload (deck + 11 data-room PDFs), deck rename + "Investors who can find us", pitch upload in Pitch & media (READY 50 s 9:16, title, audience Investors, download on), Q personality Warm + guide upload, Team page "Let in" x3 + Funmilayo → Admin, members' name / headline / photo, Visibility "Make visible to investors".
- API (no UI control; see F4, F5, F8, F9, F10, F11): founder summaries, team/me titles, team facts, capital objective close date + use of funds, join requests, data-room levels + folders, member organisation activation.
- Verification: requested automatically at onboarding completion and decided by the synthetic decider (`SYNTHETIC_DEMO_ATTESTATION`, accounts marked synthetic), so no platform-admin step was needed. The only account with `verification.decide` is the founder's own (platform_owner); it was not used.
- Result: `network_visible` + `marketplace_ready` at 12:30:52. Zino's standing instruction (`includeNewCompanies`) was woken: next run fired 12:32:25 (+90 s). That run proposed messages on four existing relationships and created nothing for Ledgerline (see F14).

### F14. The newly-ready wake runs Zino's instruction, but the run does not look at the new company (S2, to confirm)
- The worker sends only `pg_notify(company id)`; q-api `wakeForNewCompany` just pulls `next_fire_at` forward, and the run ("express interest immediately when a company matches my mandate") re-reads everything. At 12:32 it produced four "Waiting for your yes" messages on existing relationships and no relationship or interest for Ledgerline (`network.relationships` has none for it). Either Ledgerline is outside Zino Aviation's mandate (aviation vs fintech), or the run does not consider newly-ready companies specifically. Suggest passing the woken company id into the run so it is assessed first, and recording "considered, not a fit" when it is not.

### F1. Onboarding "How would you categorise the company?" suggests unrelated categories (S2)
- Where: web `/onboarding/founder` form, step "Company 5 of 7"; `POST /v1/taxonomy/candidates`; `packages/taxonomy/src/classification/domain/scoring.ts` `lexicalScore`.
- Steps: founder form, describe Ledgerline ("checks every invoice at creation and files VAT returns for Nigerian SMEs ... FIRS e-invoicing").
- Expected: Fintech (or nothing). Actual: the only industry chip is **Education** ("0/1 tokens, similarity 0.40"). "regtech tax compliance" returns Agritech, France, Edtech, HR Technology before Fintech, all with 0 matched tokens.
- Cause: `score = max(blend, similarity)` lets a pure pg_trgm word similarity of 0.40 with zero matched tokens clear `candidateMinimumScore` 0.35.
- Proposed fix (classifier version bump + taxonomy eval re-run, so not done here): when `matchedTokens === 0`, require similarity >= 0.6 (or drop the `max(...)` and use the blend only).

### F2. Category step has no way to search or add a category (S2)
- Where: same step. Only the lexical suggestions are offered; a founder whose description does not literally contain a taxonomy word ("VAT", "e-invoicing", "SME") gets a wrong chip or none, and can only "Skip for now".
- Expected: a search box over taxonomy v1 (the endpoint already accepts free text), or a short list of top industries.

### F3. Profile: saving in one section makes the next section's save fail with a version conflict (S2)
- Where: `/profile`. Steps: Edit About → save "In one line" and "Description"; then Edit Company → save City.
- Expected: City saves. Actual: alert "This profile changed since the page was opened, perhaps through Q. Reload to see the latest" on every Company field until a full reload. Saves inside one section chain correctly; only the version held by the other section goes stale.

### F4. No UI for the founder's own background (S2, data gap)
- Where: `/profile` "You and your team" only edits Name and Headline. `PATCH /v1/companies/:id/founder-profile/me` (professional summary, background summary) and `PUT /v1/companies/:id/team/me` (business title, e.g. "Co-founder & CEO" vs the onboarding radio "CEO") are only reachable via Q record-change actions; no web form calls them. Seed used the API.
- Education, previous roles, languages and city of a person have no field anywhere in the product (no data model), so a founder cannot state their track record except in prose.

### F5. Capital: raise terms are lost or have nowhere to go (S2)
- Onboarding "Target close: Within 3 months" is not stored (`capital-objectives/current.targetCloseDate` stays null).
- `/capital` has no editor for target close date or use-of-funds detail (the objective supports both); seed used `PATCH /v1/companies/:id/capital-objectives/:id`.
- No field anywhere for valuation cap / pre-money, minimum cheque, previous rounds, existing investors, cash, burn or runway. Investors only see these via the deck and data room.
- After onboarding says "Raising USD 1,800,000", `/capital` still shows "No round open"; the founder must re-enter the same raise in "Open a round".

### F6. Profile "Edit sector" cannot add geography or "other" categories (S3)
- Typing "Nigeria", "West Africa", "Africa" or "Regulated Financial Services" in the sector dialog finds nothing, though they are taxonomy v1 nodes the dataset assigns. Only industry / business model / customer type / technology are searchable.

### F7. Onboarding traction step records only a signal type (S3)
- "Paying customers" is a radio; there is no way to give the number (1,140 businesses, ₦38m MRR) in the form, and no metrics editor elsewhere in the founder UI.

### F8. A new team member cannot ask to join their company from the UI (S1 for teams)
- Where: new account → welcome → founder journey offers only "raising / preparing / exploring" (continuing would create a duplicate company). GateQ → "Find my startup" (`GET /v1/companies/claimable`) answers 400 "You're not working inside an organisation yet" for a person with no organisation, which is exactly who joins a team; the page says "Search didn't load. The connection dropped" (wrong words for a 400). Even with an organisation, the search only returns companies the caller can already see, so a private (pre-verification) company is never findable.
- The person-level `POST /v1/join-requests {organisationId}` works without an organisation, but nothing in the web app calls it, and a person cannot know the organisation id.
- Invitations email a one-time link (the raw token exists only in the email), so the email path is the only UI path today.
- Proposed fix: on the welcome screen add "I'm joining my team" → search by company name or website among all companies (name + city only, no profile data), and send `POST /v1/join-requests`; let `/v1/companies/claimable` run as a person action without organisation context. Seed workaround: API join request, owner approves on Team page (UI).

### F9. Data room: the first level change on any uploaded document always fails (S1) — FIXED in build/seed-fixes
- Where: `/company/:id?tab=dataroom`, "Who can see <doc>" radios; `POST /v1/data-room/documents/:id/level`; `packages/permissions/src/application/data-room.ts` `setLevel`.
- Steps: upload a PDF in Documents; open the data room; pick "Public".
- Expected: saved. Actual: "That didn't save. Someone may have changed it; refresh and try again." on every document that has never been filed (all new uploads). API: `expectedVersion: 1` → 409; `0` → 422 (contract min 1).
- Cause: the owner view reports `Math.max(document.version, 1)` for a document with no `data_room_entries` row, so the screen sends 1; the store then runs the UPDATE path (`version = 1`), finds no row and returns a conflict. The INSERT path (expected 0) is unreachable from the screen.
- Fix: a document with no entry (version 0) is always a first filing (insert, which keeps its own `on conflict do nothing` guard). Test added in `packages/permissions/test/data-room.test.ts`.

### F10. Data room: no way to file a document in a folder (S2)
- Every upload that is not a pitch deck lands in "Other documents"; the checklist ("Certificate of incorporation (CAC)", "Cap table", ...) stays "Usually expected" even after the exact document is uploaded. `POST .../level` accepts `folderCode` and `checklistItemCode`, but no UI sends them, and Q's reading does not file them. Seed filed folders through the API.
- Also: Documents → Share → "Who can download it" (deck "Investors who can find us") and the data room level ("Private") are two separate controls for the same deck and can disagree.

### F11. A team member who joined (request or invitation) is locked out of the app (S1 for teams)
- Where: `apps/web/src/features/q/context.ts` `resolveOnboardingState` / `founderLookup`.
- Steps: owner lets Emeka in (Team page); Emeka signs in and opens `/home`.
- Expected: Ledgerline's home. Actual: redirected to `/welcome` (founder onboarding), which would create a second "Ledgerline". `/profile` says "You haven't set one up yet". The founder context is derived only from the person's own founder onboarding session subject; a joined member has none. `GET /v1/me` says `CONTEXT_REQUIRED` and `/v1/me/organisations` lists Ledgerline with `active:false`, but the web has no organisation switcher (no caller of `listMyOrganisations` / `activateOrganisation`).
- Knock-on: profile photo upload fails with "You're not working inside an organisation yet" until the organisation is activated. Seed activated it via `POST /v1/organisations/:id/activate` (API) for each member.
- Proposed fix: (1) add `companyId` to `MyOrganisationDto` (join `core.companies` on `organisation_id`); (2) in `founderLookup`, when there is no onboarding subject, fall back to the active (or only) COMPANY membership; (3) `resolveOnboardingState` returns DONE for a person with any membership; (4) activate the organisation on join/accept, and add a switcher for people in more than one.
- Display name: members whose identity profile was first created by an API call show their email local part as their name on the owner's Team page ("adedaniel502+cq-emeka-ledgerline") until they set a name, although `user_metadata.display_name` was set at sign-up (S3).

### F12. Q personality options do not match the documented set (S3)
- Settings → Q → Personality offers Auto, Warm, Witty, Sharp, Calm. The dataset (and earlier specs) use WARM, WITTY, DIRECT, FORMAL, AUTO; there is no "Formal". Seed mapped DIRECT → Sharp and FORMAL → Calm.

### F13. Small display issues (S3)
- Settings → "How Q speaks for you": an uploaded Markdown guide is shown as one paragraph of raw Markdown (`#`, `**`, numbered list run together).
- Pitch editor: "Save" stays enabled while the download switch's own save is in flight; pressing it then fails with "The pitch changed since this page was opened".
- Onboarding "Where is the company based?" lists 16 countries; Vietnam and Mexico (dataset n14, n15) must pick "Somewhere else". Raise currency lists lack BRL, INR (round form), MXN, VND, EGP.

### F15. Resuming an unfinished founder setup opens live voice by default (S2)
- Steps: leave the setup form part-way; sign in again. `/home` redirects to `/onboarding/founder?talk=1`, which starts the voice room ("Voice paused · Q can't hear you: the microphone isn't available") although the founder chose "Prefer to type" and the form before. Expected: resume in the mode last used (the form), voice only on request. It also opens a voice session nobody asked for.

### F16. Series A setup asks for traction numbers; seed and pre-seed do not (S3, refines F7)
- For `series_a` the "Business and traction" step asks revenue shape, paying customers and six-month growth; for seed / pre-seed it is a single signal radio with no numbers.
- "A few things I still need" sometimes has nothing to ask ("Nothing I still need from you") but is still a step to click through.

### F17. Setup summary: "Go to Home" fails with a raw error code while Q's first reading is still running (S2)
- Where: `/onboarding/founder`, "Here's what we have so far" (step F8.snapshot).
- Steps: finish the form; press "Go to Home" a few seconds in, while "Preparing your analysis" shows.
- Actual: red banner "Couldn't save. The onboarding session does not allow this action right now. (REQUIRED_STEPS_INCOMPLETE) Your answers on this screen are kept." Session stays ACTIVE (`canComplete:false`, F8.snapshot IN_PROGRESS). Waiting and pressing again works.
- Expected: the button waits for (or does not need) the analysis; never show an internal code.

### F18. Profile "Edit sector" silently caps at 8 categories (S3)
- When 8 are chosen the search box disappears with no message; a founder with more relevant tags cannot tell why.

### Lead request (raise shared with the network): not done, conflicts with a locked privacy rule
- The only raise-sharing control is per relationship (`shareRaiseAction(companyId, relationshipId)` on `/company/visibility`), and the page states "Your raise: Private to your company ... it is never shown to the network or the public." There is no network-wide raise share in the product or API. Making the raise network-visible would change a founder-private disclosure rule (CLAUDE.md: founder-private information never silently reaches investors); it needs an ADR / PADL decision, not a seed workaround. Seed leaves raises private; investors see "Raising: Not shared" until a founder shares it with a relationship.
- Pitches: switched to audience "Everyone on Capital Q" (NETWORK) through the pitch editor, since Explore lists only NETWORK pitches.

