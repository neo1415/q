# Live founder ⇄ investor journey audit (13 Nov 2026)

**Scope:** acceptance matrix rows A11 (relationship progression, pipeline, meetings, communications) and A12 (Discover → profile → interest).
**Where:** production web `capital-qweb-production.up.railway.app`, 21:40–22:00 UTC, Chromium. Desktop 1440×900, then phone 390×844 for the key steps.
**Accounts (all fictional):**

- Investor: `investor.savanna-seed@fictional.capitalq.local`, Savanna Seed Partners. `core.investor_organisations` id `1c4b9266…`; identity org `db84dbc3…`.
- Founder: `founder.fb0005.ama-okafor@fictional.capitalq.local`, company **Watchly** (`526c2d72-9142-4e48-b106-ee4910f19318`). Every member is `@fictional.capitalq.local`, and there was no relationship before the audit.
- Pass test: Brancheon Works (fictional). The pass was undone at the end.
- Avoided: Ledgerline and Baridi, the first and sixth Discover cards, because their members are non-fictional gmail aliases.

**How:** I checked the database with read-only `hosted-read.mjs`. I changed no product code.

**What I created:**

- one relationship, Savanna ↔ Watchly, now CONNECTED;
- three messages;
- one save of Watchly.

Screenshots: `/tmp/claude-0/-home-user/baac2e44-f461-5146-93f5-14f30f7b1f41/scratchpad/e2e/shots/` (scratch, not committed). Prefixes: `i*` investor desktop, `f*` founder desktop, `pi`/`pf` phone.

No page errors or 5xx responses were seen. The only console errors were `ERR_NETWORK_CHANGED`, which is sandbox proxy noise.

## Journey

Page times are DOMContentLoaded. Each one was about 1–2 s, plus a fixed settle wait.

| #   | Step (side)                            | URL                                                                           | Result                                                                                                                                                                                                                                                                                                                  | Verdict                                                                                   | Shot                 |
| --- | -------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------- |
| A1  | Discover feed loads (I)                | `/discover`                                                                   | The video card renders with the counter "1 of 10+" and a Profile/Save/Pass/Ask Q/More rail. Next and Previous work.                                                                                                                                                                                                     | PASS                                                                                      | i1-01, pi-01         |
| A2  | Viewing ≠ interest (I)                 | card + `/company/526c…` (overview, deck, data room, team)                     | The card and all four profile tabs were viewed. **No `network.relationships` row** existed afterwards. Saved page copy: "Saving isn't interest, and viewing counts for nothing here."                                                                                                                                   | PASS                                                                                      | i2-01..04            |
| A3  | Profile tabs (I)                       | `?tab=deck`, `?tab=dataroom`, `?tab=team`                                     | Deck: view-only, watermarked, figures labelled "Founder's claim, not verified". Data room before connecting is locked: "opens once you're connected". Team: "Identity not verified yet". Unicorn Potential reads "insufficient evidence".                                                                               | PASS                                                                                      | i2-02/03             |
| A4  | Save (I)                               | Discover rail                                                                 | Toggles to "Saved" (`aria-pressed=true`). Recorded in `recommendation.interaction_state.saved`. Watchly is in `/discover/saved`. No relationship row created.                                                                                                                                                           | PASS                                                                                      | i1-03, i1-04         |
| A5  | Pass (I), Pass neutral                 | Discover rail → `/discover/passed`                                            | The Pass button has a transparent background and the same neutral text colour as the other rail buttons (not red). The card advances and shows "Passed Brancheon Works · Undo". The company is listed under Passed. Undo pass worked.                                                                                   | PASS (see D12)                                                                            | i1-05, i1-06         |
| A6  | Express Interest, server-confirmed (I) | profile header and next step                                                  | A confirmation step ("not a commitment to invest") → `POST 200` → "Interest sent · Interest expressed in Watchly." in 1.4 s. The database gained one relationship row with events `discovered` (investor_private) and `interest_expressed` (relationship_shared). After a reload the header chip reads "Interest sent". | PASS                                                                                      | i2-05..07            |
| A7  | Pipeline state (I)                     | `/relationships?view=pipeline`                                                | Watchly shows "Awaiting reply". The relationship page shows "Interest expressed · 1 of 5".                                                                                                                                                                                                                              | PASS                                                                                      | i4-01, i3-03         |
| A8  | Messages before connecting (I)         | `/relationships/company/526c…/messages`                                       | Gated: "Messages open once both sides agree to connect".                                                                                                                                                                                                                                                                | PASS (copy D7)                                                                            | i3-04                |
| A9  | Ask Q about the company (I)            | relationship page, Q pane                                                     | About 22 s. The answer is grounded and lists unknowns explicitly (volume, false positives, margin, burn, SAFE terms). It keeps relationship status separate from evidence.                                                                                                                                              | PASS                                                                                      | i4-02                |
| A10 | Q follow-up while awaiting reply (I)   | Q pane                                                                        | Q proposed a **second "Express interest" card with a note**. Approving it returned "already expressed interest; nothing new was sent", so the note was discarded.                                                                                                                                                       | **FAIL (D2)**                                                                             | i4-03, i5-01         |
| B1  | Founder sees the interest (F)          | bell, `/relationships`, `/company/interest`                                   | `INTEREST_RECEIVED` was sent to all 3 Watchly members. The Hub, Interest inbox and investor record show the interest, with fit lines (stage, sector, geography). Also shown: "Someone from Savanna Seed Partners saved your company" (D10).                                                                             | PASS (D6)                                                                                 | f1-*, f2-01          |
| B2  | Founder accepts (F)                    | `/relationships/investor/1c4b…`                                               | Accept → confirmation ("not an investment") → `POST 200` → "Connected · 2 of 5", event `connection_accepted`.                                                                                                                                                                                                           | PASS (copy D7)                                                                            | f2-02, f2-03         |
| B3  | Investor told of the acceptance        | notifications                                                                 | **No notification was written for the investor.** The next investor notification was the chat message at 21:50.                                                                                                                                                                                                         | **FAIL (D1)**                                                                             | —                    |
| B4  | Data room per rules (I)                | `/company/526c…?tab=dataroom`                                                 | After the founder accepted: "5 documents, 3 open to you". Management accounts and the pipeline summary are "On request". This matches the founder's settings ("Investors you accept" ×3, "On request" ×2).                                                                                                              | PASS                                                                                      | i6-02, f3b-02        |
| B5  | Founder messages (F)                   | `/relationships/investor/1c4b…/messages`                                      | Sent (`POST 200`) and shown with Unsend. The Q briefing popover **covers Send** (D4). The list preview stayed "No messages yet" (D5).                                                                                                                                                                                   | PASS with defects                                                                         | f3-01, f3b-01        |
| B6  | Investor reads and replies (I)         | `/relationships/company/526c…/messages`                                       | The founder's message is visible and the reply was sent. The founder sees the reply, with read receipts.                                                                                                                                                                                                                | PASS                                                                                      | i6-04, f4-01         |
| B7  | Q follow-up when connected (I)         | Q pane                                                                        | Q drafted a "Message Watchly" card (pilot results and pricing). A later request to schedule a call **replaced that pending card** (D3). Approving the final card sent "Sent by Q for Amara Diallo-Benson"; the founder received it.                                                                                     | PARTIAL (D3)                                                                              | i7-01, i7-03, i8-01  |
| B8  | Meeting prep and scheduling (I/F)      | Q pane; `/…/calls`                                                            | Q meeting prep returned questions and unknowns, and offered a rehearsal. Calls tab: "Google Calendar isn't connected", so no free hours. That is honest, but no meeting could be booked. Q proposed a time by message only.                                                                                             | PARTIAL (calendar not connected, so MEETING_HELD and the later stages were not exercised) | i7-02, f3b-03        |
| B9  | One canonical relationship             | DB plus both UIs                                                              | Exactly 1 row (Watchly, Savanna), CONNECTED, with 6 events. The investor pipeline shows "Connected" and the founder pipeline shows "Connected · Book a call". Both pages read "Connected · 2 of 5".                                                                                                                     | PASS                                                                                      | i6-01, f4-02         |
| P   | Phone 390×844 (both)                   | discover, profile ×3, EI confirm/cancel, pipeline, messages, founder interest | No horizontal overflow (scrollWidth 390). The rail is usable. The Express-interest confirm renders and Cancel works. Messages work on both sides. The Q briefing covers the founder's Accept/Decline card (D4). Some touch targets are under 44 px (D8).                                                                | PASS with defects                                                                         | pi-01..08, pf-01..03 |

**Invariants observed:**

- Viewing ≠ interest: PASS.
- Save ≠ interest: PASS.
- Express Interest is server-confirmed and idempotent: PASS. Q's duplicate was deduplicated by the server.
- One canonical relationship: PASS.
- Pass is neutral: PASS.
- Unknown stays unknown: PASS. Q answers and the profile say "not provided", "insufficient evidence" and "not verified".
- No founder-private data reached the investor: none observed. The investor saw only deck figures labelled as founder's claims, and only documents the founder's rules opened.

## Defects (ranked)

**D1. High (A11). The investor is never notified when the founder accepts their interest.**

- The investor-facing data-room gate promises "Next: The room opens · You'll get a notification".
- Production `communication.notifications` holds 1,100+ rows. No acceptance or connection kind exists among them, and none has ever been written. `group by kind` shows only INTEREST_RECEIVED, CHAT_MESSAGE, COMPANY_SAVED and similar.
- The acceptance writes `connection_accepted` (and `relationship.interest_accepted` in `packages/network/src/application/respond-to-interest.ts`), but nothing writes a notification.
- Reproduce:
  1. As the investor, express interest in a fictional company.
  2. As its founder, Accept at `/relationships/investor/<investorOrgId>`.
  3. Run `select kind,title from communication.notifications where user_id=<investor profile id> and created_at > <accept time>`. It returns nothing until a chat message arrives.

**D2. Medium (A11/Q). With interest awaiting a reply, "draft a follow-up" yields a duplicate Express Interest card that does nothing.**

- Reproduce:
  1. Express interest, then on `/relationships/company/<id>` ask Q: "Draft a short follow-up note to Watchly's founders asking for their pilot results and business model."
  2. Q returns the card "Express interest in Watchly … with your note: …".
  3. Approve. Result: "Your organisation had already expressed interest in Watchly; nothing new was sent."
- The drafted note is lost, and the founder's inbox still shows "No note with their interest".
- Q knew the state, because an earlier answer said "the company has not accepted yet". It should have said no channel is open yet, or offered a channel that exists.

**D3. Medium (A11/Q). A new Q draft silently replaces a pending, unapproved message card.**

- Reproduce on a CONNECTED relationship page:
  1. Ask "Draft a follow-up message to Watchly's founders asking for their pilot results and pricing model." Card 1 appears ("Hi, just following up: could you share your pilot results and your pricing model?").
  2. Ask "Prepare me for a first meeting…", then "Schedule a call with Watchly next week."
  3. Q says "Still waiting for your approval: Message Watchly". The only remaining card now holds the scheduling text. Card 1 is gone, and the page has exactly one Approve.
- Approval still binds to the payload shown, so this is not an authority breach. It is lost work, and it contradicts what Q says.

**D4. Medium (UX). The Q arrival briefing popover covers primary actions.**

- Desktop 1440×900: on the founder's `/relationships/investor/<id>/messages`, the "Good evening, Ama…" card overlays the composer's Send button. A pointer click on Send is intercepted, and Playwright timed out after 30 s until "Close" was pressed.
- Phone 390×844: on `/company/interest` it covers the interest card's Decline/Accept.
- Screenshots: f3-01, pf-01.

**D5. Low. The founder's conversation list is stale after the first send.** After sending, the left list still reads "Savanna Seed Partners · No messages yet" while the thread shows the message, until reload. Screenshot: f3b-01.

**D6. Low. Duplicate entries.**

- The founder Hub Overview lists one interest twice: "Savanna Seed Partners is interested in Watchly" and "SP Savanna Seed Partners · Interested in your company". The same pair appears for The Vaultlyne.
- Q's briefing counts The Vaultlyne twice ("wants to connect … and The Vaultlyne is interested in Watchly").

**D7. Low (copy).**

- "Accept Savanna Seed Partners's interest?" should read "Partners'".
- "You expressed interest on 21:43" should read "at 21:43" or give a date.
- The founder's message list labels a _received_ interest "Interest sent".
- Saved and Passed list descriptions end in "..".
- Q's scheduling message reads "a 30-minute call about Watchly first meeting".

**D8. Low (a11y, phone).** Touch targets under 44 px on `/company/<id>?tab=dataroom`:

- the folder filter chips are 39 px tall;
- the header links "$1M seed safe" and "Your relationship" are 20 px tall.

**D9. Low (provenance).** The message Q drafted and the human approved shows "Sent by Q for Amara Diallo-Benson" in the UI, but its `relationship_events` row is `actor_type=HUMAN`. Confirm that Q's drafting is recorded in audit or provenance elsewhere.

**D10. Observation for the product owner.**

- What happens: a Save notifies all company members by firm name ("Someone from Savanna Seed Partners saved your company").
- Why it is not a defect: this is by design (Q Workspace §8 A6, gated by `analytics.viewing_privacy_settings`).
- The gap: the investor is not told at save time that the firm becomes visible. The Saved page says only "Saving isn't interest".

**D11. Observation (performance).** Q turns took about 22 s (company Q&A), about 9 s (draft) and about 60 s each for the follow-up, meeting-prep and schedule turns, in one conversation.

**D12. Low (data).** Brancheon Works had `saved=true` and `passed=true` at the same time, and was listed in both Saved and Passed. A pass did not clear the earlier save.

## Not exercised

- Meeting booking and `MEETING_HELD`, because Google Calendar is not connected for the founder.
- Diligence and deal stages.
- Data-room "Request" for on-request documents and the founder granting them.
- "Let Q handle this".
- Founder decline path.

## Bearing on the matrix

- **A11:** the core progression (interest → accept → messages → pipeline both sides) works live, and one canonical relationship is proven. D1, D2, D3, D4 and D5 are open. Meetings are not verified.
- **A12:** the full Discover → profile → save/pass → interest journey is verified on desktop and phone.
- **Q action authority / approval cards:** affected by D2 and D3.
- **UX:** affected by D4 and D8.
