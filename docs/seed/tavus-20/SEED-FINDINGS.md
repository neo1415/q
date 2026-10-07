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

### Note (tooling, not a product bug): non-ASCII file names
- In this environment Playwright does not deliver a file whose name contains "ã" to the browser's file input (no change event), so the upload silently never starts. Verified the product accepts the same file under an ASCII name. Seed uploads such files under their ASCII spelling and renames them in Documents → Rename to the true title (e.g. "Key customer contract summary: São Paulo construtora (name withheld)").
- Also not a product bug: one Ferrolith setup save said "Your session ended" because the seed reset that account's password (lead's request) mid-run, which ends its sessions.

### F19. A company outside 16 countries can never say where it is based (S1 for those founders) — FIXED in build/seed-fixes (profile)
- Where: setup "Where is the company based?" and `/profile` Company → Country both use the same 16-entry `COUNTRY_OPTIONS`; setup's "Somewhere else" stores no country, and the profile list has no Vietnam, Mexico, etc. (Its "Somewhere else" entry even mapped to the invalid code "OTHER".)
- Effect: Hui (Ho Chi Minh City) and Cosecha Labs (Guadalajara) have no HQ country; readiness requires "where you are based", and Hui's verification was never auto-requested ("Not requested").
- Fix (web): `apps/web/src/features/profile/profile-fields.ts` offers the short list first, then every ISO 3166-1 alpha-2 country by name (`Intl.DisplayNames`); the API already accepts any code. Test in `apps/web/test/profile-editing.test.tsx`. Setup's own list is unchanged (suggest the same treatment there). Seed set VN/MX via `PATCH /v1/companies/:id` until deployed.

## Final state (16:45 UTC)

All 20 companies: `network_visible` + `marketplace_ready`, both verification claims VERIFIED (auto, synthetic decider), deck PUBLIC + downloadable, 10–11 data-room documents filed by folder and level, pitch READY with audience NETWORK and download on, logo + company cover, founder and team photos, Q personality + guide, team joined with roles. 76 accounts; emails in `LOGINS.md`. `scripts/seed/tavus20/verify.mjs` prints the per-company check.

F14 update: Zino's instruction kept being woken (last fired 16:42); 7 of the 20 seeded companies now have a relationship row, so the wake does reach new companies once Discover's slate includes them. The first run after Ledgerline turned ready did not, which suggests the slate refresh lags the wake.

## P6: Zino's agents on autopilot (17:00–18:00 UTC)

Setup: all 20 founders' Q guides verified via `GET /v1/me/etiquette-guide` (Silo Credit's was missing; re-uploaded in Settings, now present; the seed step now checks the API). Four mandate-fit founders (Ledgerline, Clearwater Assurance, Tensorgate, Shiftwell) accepted Zino Aviation's interest on `/company/interest` (Accept → confirm) at 17:20–17:22; each relationship went `interest_expressed → connection_accepted` (CONNECTED). Each founder then wrote a short first message in the relationship chat. Rand Treasury had no interest from Zino, so Shiftwell (US B2B SaaS, Series A) was used instead.

### F20. Zino's instruction asks him to approve chat messages to companies that never accepted; the approved sends then fail (S1 for autopilot) — FIXED in build/seed-fixes
- Evidence (read-only SQL, `q_runtime.actions`, proposer Zino): three `app.chat.message.send` actions with approvals APPROVED ended `FAILED / APP_ACTION_REFUSED` (08:12 Nsuo Labs, 12:32 Maji Loop, 13:54 Nsuo Labs). Both relationships are `INTEREST_EXPRESSED`; chat needs a matched state (ADR 0019, `isMatchedRelationshipState`). The founder approved a card that could never be sent.
- Fix: `validateStep` (`apps/q-api/src/composition/instructions/engine.ts`) refuses a chat step to a relationship whose state is not matched with a new refusal code `NOT_CONNECTED` ("they haven't accepted your interest yet, so chat isn't open / I'll write once they accept"), so the planner replans instead of asking. Test in `apps/q-api/test/instruction-engine.test.ts`.

### F21. Every run stacks another card for the same company (S2) — FIXED in build/seed-fixes
- Evidence: Zino has 21 `AWAITING_APPROVAL` chat cards from one instruction: Tarmacly 7, Marketlight Grids 7, Souqsheet 6, Maji Loop 4, Nsuo Labs 3, Nixo 3. Each 4-hour (or woken) run proposed a new message while the previous card still waited.
- Fix: the store reads relationships with a card still waiting (`awaitingAnswer`: ASKED steps whose action is PROPOSED / AWAITING_APPROVAL); `validateStep` HOLDs a new message to them (`ALREADY_ASKED`, "A message to them is already waiting for your yes."). Wired in `apps/q-api/src/main.ts`. Test added. Existing duplicate cards are Zino's to reject; the seed did not touch his account.

### F22. Accepting a connection wakes Zino's instruction, but nothing on his side takes the conversation forward today (S3 timing + S2 product gap)
- Evidence: q-api log `q work woken ... relationshipId=aaa1a9ff… target="instructions" woken=1` (and for the other three) at 17:21–17:22; the instruction ran at 17:22:16 and recorded no steps. Its goal is only "express interest when a company matches my mandate". Zino has no instruction or delegation that replies to founders, follows up or proposes meetings, so the founders' first messages (17:25–17:30) get no answer from his Q. The only "reply to any chat" instruction belongs to another user (f042c12e…).
- Correction after reading the grant: Zino's working hours are Mon–Fri 09:00–17:00 Africa/Lagos (16:00 UTC). The acceptances (17:20 UTC) and messages (17:28 UTC) woke runs at 17:22, 17:28 and 18:00 that all exited `OUTSIDE_HOURS` before planning, which is correct. A wake outside working hours still pulls `next_fire_at` forward and fires a run that can only exit (small waste; the wake could respect hours).
- Expected for autopilot: either the interest instruction's grant covers what follows acceptance (introduce, answer, propose a time), or Q offers to extend it when a connection is accepted ("Ledgerline accepted. Shall I reply and propose a call?"). The seed does not create instructions in Zino's (the real founder's) account.

### F23. Organisation switching: works in the API, absent in the web (S1 for people in two organisations; extends F11)
- Case created: Emeka Chukwu (Member of Ledgerline) asked to join Termly (`POST /v1/join-requests`, F8); Termly's owner let him in on Team → "Let in".
- API: `GET /v1/me/organisations` → Ledgerline (active) + Termly (inactive); `POST /v1/organisations/<Termly>/activate` → 200, `/v1/me` context RESOLVED to Termly's tenant and organisation, list flips `active`; activating Ledgerline again → 200. Switching is correct and reversible.
- Web (deployed `recovery/2026-09-12` and this branch): no caller of `listMyOrganisations` / `activateOrganisation`, no switcher in the sidebar or settings; `/home` still redirects Emeka to `/welcome` (F11). A person in two organisations cannot choose which one they are working in from the UI.
- Proposed: a switcher in the sidebar context pill ("Founder private · Ledgerline") listing `/v1/me/organisations`, calling activate and refreshing; plus the F11 context fallback so a member lands in their active company.


## P7: Zino's first working-hours run after the four connections (7 Oct, 08:03 UTC = 09:03 Lagos)

Read-only (`scripts/seed/tavus20/watch.mjs 2026-10-07T07:00:00Z`; `q_runtime.instruction_steps` for instruction 54e6dba6…). Nothing was sent from Zino's side: no messages in the four chats since the founders' first messages (17:27–17:28 on 6 Oct). The 00:09 run exited `OUTSIDE_HOURS` (correct). At 08:03 the run drafted four `app.chat.message.send` cards (Ledgerline, Clearwater Assurance, Tensorgate, Shiftwell), all `AWAITING_APPROVAL` with approval `PENDING`; Spheros was held `PACE_ALREADY_ASKED` (the F21 guard working live). The silence is expected: messages are ASK in Zino's grant and only Zino can approve. The seed sent no founder replies because nothing reached the founders.

### F24. Q answered founders who wrote first with a cold introduction (S2) — FIXED in build/seed-fixes
- Evidence: all four founders wrote first (deck or a 20-minute call offered). Steps read "Introduce Ledgerline specifically…"; the drafts open "Hello Ledgerline team — … I came across the company through your Capital Q profile. How are SMEs responding to the product?" (actions 8c6b06ef, 17e5b6f1, bd5b0024, 7f84128b). None acknowledges the founder's message or offer; Ledgerline's question re-asks what Tobenna had just said (1,140 SMEs).
- Root cause: the planner's person line said "no message from your side yet" (code's first-message cue) even when the thread facts said "last from THEM"; and code had no check that a reply is not written as an introduction.
- Fix (`apps/q-api/src/composition/instructions/engine.ts`): where they wrote first and our side hasn't, the planner line now says "they wrote first and your side hasn't replied: any message is a reply to them, not an introduction"; `messageProblem` refuses a message in reply to them that opens cold ("came across", "found your company", "let me introduce" …) with new code `COLD_OPEN_IN_REPLY`, so the planner redrafts. Tests in `apps/q-api/test/instruction-engine.test.ts` (refused cold open, accepted reply, planner line).

### F25. Tensorgate's deck-or-call offer was routed to Zino as "terms or money" (S3, not fixed: model extraction)
- Evidence: step 08:03:41 `q.note QUESTION_FOR_YOU` "Passed Tensorgate's question to you: It's about terms or money". Tensorgate wrote "…2 converted to $180k contracts… Raising a $4m seed. Want the deck, or 20 minutes this week?" Ledgerline's message has the same shape ("raising a $1.8m seed… share the deck or find 20 minutes") and was not flagged: the quarantined thread reader (`INSTRUCTION_THREAD_READER` v2) is inconsistent on a founder stating its own round size.
- Also: in the same run Q drafted a card to Tensorgate anyway (ASK cards on terms are by design, test "terms or money stay theirs"), while the planner had been told "write no reply" — so Zino gets both "reply in the chat yourself" and a cold-intro card that ignores the question (now refused by F24).
- Proposed: a v3 reader prompt saying a company stating its own raise or traction figures is not raising terms (terms = valuation, an amount offered or asked of this investor, conditions, signing), with an eval pair from these two messages. Not changed here: a prompt version change needs its eval run, which makes live model calls.
