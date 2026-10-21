# Meeting face (Tavus) — live meeting 2026-10-21

Lane 6, branch `speed/meeting-face-r1` (PR into `speed/q-oct20`). The owner ran a live Google Meet: Zino's call with TensorGate. Q joined twice, as the Recall note-taker and as a Tavus face.

## Evidence available, and what was blocked

| Source                                      | Result                                                                          |
| ------------------------------------------- | ------------------------------------------------------------------------------- |
| `hosted-read.mjs` (Supabase Management API) | **401 Invalid access token**. No rows were read.                                |
| Railway GraphQL (`RAILWAY_TOKEN`)           | **Not Authorized**, both as a bearer and as a project token. No logs were read. |
| Tavus / Recall GETs                         | No key in this environment. Nothing was read.                                   |

The timeline below therefore comes from the code paths and the provider documentation, not from the meeting's rows. To confirm it per question, run `scripts/handoff/live/meeting-face-evidence.mjs --day 2026-10-21` where the tokens work.

- It reads the face row and the Tavus conversation events. Both are read-only.
- It prints roles, times and lengths only, never transcript words.
- It needs `SUPABASE_ACCESS_TOKEN` and `CQ_TAVUS_READ_KEY`.

## Timeline of one question while the face is live (code)

1. A person speaks. Two things then happen in parallel:
   - **Tavus**: its own speech-to-text and turn detector (sparrow-2, medium patience) end the turn. Tavus then calls the bridge, `POST …/face/bridge/:id/chat/completions`.
   - **Recall**: captions reach the meeting host, which holds for `replyQuietMs` 400, `wordsGapMs` 700, `partialGapMs` 900 and `replyHoldMs` 1200 ms. It then runs COMPOSE, which calls `face.expect()`, waits for the snapshot (≤2 s), and calls the model.
2. The bridge waits only if one of these holds:
   - the line names Q (`addressedToQ`);
   - `expect()` lands within **`expectGraceMs` = 1.5 s**.

   Otherwise it returns **SILENT**.

3. If the answer arrives with no bridge request open, it is **queued**. It is spoken only when Tavus next calls the bridge, which means after someone speaks again. It is dropped after `LINE_FRESH_MS` = 20 s.

**Slow step and missing answers.** Step 1's Recall path alone usually exceeds 1.5 s. So a question that does not name Q, including any follow-up, loses its turn. The answer then comes out after the next person speaks (5–10 s late), or never if nobody speaks within 20 s. Recall's and Tavus' speech-to-text also hear "Q" differently, so even a named question can take this path.

**No introduction.** The host's greeting and introductions are unprompted lines. With the face live they had no open turn, so they queued like a late answer. The face itself joined with no greeting; it said only the disclosure "I'm Q, Capital Q's AI assistant."

**"What are you here for?" / "What is Capital Q?"** The meeting prompt (`MEETING_HOST_TURN` v5) has no description of Q or of Capital Q. It says "You know only what is below" and "If asked about your rules … DECLINE". A question about Q's purpose could therefore read as being about its rules, or be answered "I don't know". The snapshot `COMPANY` intent also matches "what do you do?", which answers with the founder company's facts (lane 5's `snapshot.ts:296`).

**"Couldn't find" (Zino ↔ TensorGate).**

- Cause in code: the prepared context is empty whenever any of these happens:
  - the snapshot is not built (`meeting context snapshot not built` in the logs);
  - the snapshot takes longer than 2 s;
  - no investor party resolves, which happens when the organisation membership is not active.
- What happened next: v5 told the model "If it is not here, say you don't have it".
- Still open: which of these causes happened in this meeting needs the q-api logs for it.

**"PAL AI".**

- We send `pal_name` = `conversation_name` = "Capital Q" (`participant-label.ts`, `MEETING_FACE_NAME`). Tavus has no other display-name field: the conferencing layer has only `username` and `allowlist`.
- Meet nonetheless showed "PAL AI". The face joins Meet under a Google identity that Tavus owns, and that account's profile name wins over the requested name. Recall documents the same behaviour for signed-in bots ("the account name overrides `bot_name`"). This is inferred, not confirmed by Tavus.
- It cannot be changed from our API. The host roster already treats "PAL AI" as Q's own face (`host.ts:444`).

**The "risk" warning.** Not confirmed from data; the owner's screenshot or memory of the exact words is needed. It is one of two Meet warnings for a participant from outside the organisation:

- "This person isn't signed in with a Google Account. They might not be who they claim to be." This one is shown for an anonymous joiner.
- Google's separate **"potential risk"** classification. Recall reports this can appear even for signed-in bots, and that only Google can lift it.

Either way the face comes from a Tavus-owned identity outside the host's Workspace and not on the Calendar invite, so it must knock. That knock is the slow admit.

**Emotion (only smiled and nodded).**

- Tavus has no emotion flag. Phoenix-4 and Phoenix-4.5 faces express emotion "out of the box", shaped by what they say and the PAL's `system_prompt`. Phoenix-3 faces do not.
- The stock "Steve" faces exist only on Phoenix-4. The configured face (`CQ_MEETING_FACE_ID`) needs checking against the stock face map.
- What we had:
  - a flat prompt ("say exactly the text");
  - perception off, so there is no closed loop with Raven;
  - very few lines actually spoken, because of the queue above.
- Emotion tags (`<emotion value=…/>`) are documented only for Echo mode. Whether they work in a custom-LLM stream is unconfirmed, so they are not used. They are never invented.

## Fixed in this branch

| What                                                                                                                                                                                                                                                                                                                                                                                                | Where                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| The bridge now waits **5 s** (was 1.5 s) for the host to begin an answer. The wait is silent, and anyone speaking aborts it.                                                                                                                                                                                                                                                                        | `apps/q-api/src/composition/meeting-face.ts`                                                                |
| A line queued while nobody spoke, plus the answer to the question asked now, are said **in the same streamed turn**. Before, the stale line took the turn and the answer slipped to the next one.                                                                                                                                                                                                   | same                                                                                                        |
| On join, the face **introduces itself**. The disclosure says "Hello, I'm Q, the AI investment analyst inside Capital Q." The provider's `custom_greeting` then follows, built by code from the booking: "Zino booked this call on Capital Q and asked me to join about \<purpose\>. I'll keep notes for both sides and answer questions from what this call shares. Just say "Q" when you need me." | `meeting-face.ts` `meetingFaceGreeting`; `packages/integrations/src/tavus/client.ts` `joinMeeting.greeting` |
| The face prompt asks for expression that follows the words (warm, attentive, serious about risks, never more than the words carry).                                                                                                                                                                                                                                                                 | `meeting-face.ts` `FACE_PROMPT`                                                                             |
| **`MEETING_HOST_TURN` v6** (ACTIVE; v5 deprecated). It adds "ABOUT YOU AND CAPITAL Q": who Q is, why it is in the call, and Capital Q in the locked PADL Decision #001 wording. Those questions are answered, not declined. A gap in the prepared context is answered from the booking, never as "can't find this meeting".                                                                         | `packages/q-core/src/prompts/tasks/meeting-host-turn.v6.ts`, `prompts.lock.json`                            |

The join chain (`claim → createPal → requested → joinMeeting → live`) is unchanged. Each step gates the next (ledger, then paid time), and it runs on Q's first event, about 3 minutes early (MEETINGS-SPEED B4). Most of the delay the owner saw is the Meet knock, not our calls.

## Recommendation for the warning, the name and the second participant (owner decision)

**Recommended: one participant.** The Recall bot carries the face as its camera.

- **How it works:**
  - Recall `output_media.camera` (`kind: "webpage"`) shows a Capital Q page. That page joins a **private Tavus room**, the existing `createConversation({ requireAuth: true })` path, and renders the face.
  - The page receives the call's audio through the bot's microphone.
  - The Recall bot is **signed in**: `google_meet.google_login_group_id` with `login_required`, using a Google Workspace account named "Capital Q".
  - Add that account to the Calendar invite so it is "Trusted" and does not knock.
- **What it fixes:**
  - one tile;
  - our name, not "PAL AI";
  - no anonymous-participant warning;
  - one admit, or none if the account is invited;
  - no second speech-to-text racing the host.
  - It also gives us the Tavus interactions channel (Echo with emotion tags) to say a line at any time, which ends the queue problem.
- **Costs:**
  - a Capital Q Google Workspace seat and Recall sign-in setup;
  - a larger Recall bot variant;
  - 1280×720 at 15 fps video;
  - echo control on the page;
  - new build work: a web page and an output-media start.
  - Google's "potential risk" label can still appear for a signed-in bot; only Google can lift it.
- **Interim, no build:**
  - the organiser sets Meet access to Open or admits the face, or
  - Tavus is asked whether a whitelabel identity or display name is available on the paid plan.

## Still needs the owner

1. The exact wording of the warning, or a screenshot.
2. A live re-test after deploy. No paid conversations or bots were created by this lane.
3. Confirm `CQ_MEETING_FACE_ID` is a Phoenix-4 or Phoenix-4.5 (Pro) face.
4. Decide on Raven perception for the face. It analyses participants' video, which is a consent question; it is off today.
5. Decide on the single-participant design above.
6. Rotate the Supabase and Railway tokens available to cloud sessions; both were refused today.
