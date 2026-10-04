# Q in a Google Meet: 5-minute live test (meet-47)

Two people: **Zino** (the investor account) and **Nixo** (the founder account), already connected on Capital Q. Each person uses their own laptop, with the sound on and the app open in a second tab.

## Before you start (lead, once)

- Deploy `build/meet-47`, and apply migration `20261202090000_communication_meeting_join_and_bot_retries`.
- Set these on q-api:
  - `RECALL_API_KEY` set to a real key;
  - `CQ_MEETING_HOST` left unset (on);
  - `Q_API_PUBLIC_URL` set;
  - ElevenLabs configured.
- Optional, for instant notes after the call: in the Recall dashboard, add a webhook to `<Q_API_PUBLIC_URL>/v1/integrations/recall/meeting-host`. Subscribe it to `bot.status_change` and `transcript.done`, and put its `whsec_…` secret in `RECALL_WEBHOOK_SECRET`. Without it, the notes still arrive through polling, within a minute or two.
- Leave `RECALL_TRANSCRIBER` unset. Unset, Q uses the call's own captions, so turn captions on in Meet. If the captions name speakers poorly, set it to `recallai_streaming`.

## The test

| Min       | Who  | Do                                                                                                                                                 | Look for                                                                                                                                                                             |
| --------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0:00      | Zino | Open meet.new and copy the link. On Nixo's relationship page, go to Calls, choose **Have Q join a call**, paste the link and choose **Send Q in**. | "Q is on its way into the call." The call appears in the list with "Q joins and keeps the record for both sides."                                                                    |
| 0:00      | Nixo | Open the notices and join the Meet.                                                                                                                | "Zino asked Q to join your call", with the consent line and the Meet link.                                                                                                           |
| 0:30      | both | Don't admit Q yet. Wait until "Q (Capital Q notes)" knocks, then about 1 more minute.                                                              | Both of you get the notice **"Q is waiting to be let in: …"**.                                                                                                                       |
| 1:30      | Zino | Admit Q.                                                                                                                                           | Q greets each of you by first name and says "I'm Q from Capital Q; I'll take notes for both sides and help when asked". It introduces Zino and Nixo to each other, then stays quiet. |
| 2:00      | Nixo | Say "Q, what's this call about?"                                                                                                                   | Q answers in one or two sentences, after a short pause.                                                                                                                              |
| 2:20      | Zino | Ask Q another question, and start talking while Q is answering.                                                                                    | Q stops mid-line and doesn't carry on.                                                                                                                                               |
| 2:40      | Nixo | Say "Q, send them the deck."                                                                                                                       | Q says "I've put that in your Capital Q to approve, Nixo." Nixo's Q has a **Share your deck** card. Zino gets nothing.                                                               |
| 3:00      | Zino | Say "Q, send me the financial model."                                                                                                              | Q says it is in Zino's Capital Q. Zino's Q has an **Ask Nixo for: financial model** card. Nothing is shared from Nixo's side.                                                        |
| 3:20      | both | Say these out loud: "Let's book a follow-up on Thursday at 3pm." "We'd look at putting in 250k." "Nixo will send the cap table by Friday."         | Nothing visible yet.                                                                                                                                                                 |
| 4:00      | both | Leave the Meet.                                                                                                                                    | Q leaves when the call empties.                                                                                                                                                      |
| 4:00–5:00 | both | Refresh the relationship page.                                                                                                                     | See the checks below.                                                                                                                                                                |

Checks after the call:

- The notices "Q's notes are ready" (Zino as organiser) and "The call's record is ready" (Nixo) arrive.
- The meeting record shows:
  - the transcript, with "Q" on Q's own lines;
  - attendees and agreements;
  - the 250k as money mentioned.
- On each side:
  - **"How did it go?"** asks about the outcome.
  - The money stays **DETECTED** until both of you confirm it.
  - The relationship history shows **Meeting held**.
- In Zino's Q (the organiser): a **recap message** draft to approve, a **Book the next call** card (Thursday 15:00), and a reminder.
- In Nixo's Q: a **cap table** reminder and the deck card from earlier.
- No card for one side ever acts for the other.

## The same thing by asking Q (30 s, optional)

In Q's chat, Nixo types "Q, join my call with Zino: https://meet.google.com/xxx-xxxx-xxx".

Q answers that it is on its way and that you should admit "Q (Capital Q notes)". Sending the same link again joins the same call; it doesn't create a second one. A non-Meet link, such as Zoom, is refused in words.

## If something goes wrong, it should say so

Nothing should fail silently. Each failure appears both on the meeting record and as a notice to both of you:

| What happened                     | On the meeting record                                                                                                                                         | Notice to both                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Recall refused to create the bot  | "Q couldn't be booked into the call yet; trying again at HH:MM UTC."                                                                                          | "Q is having trouble joining"  |
| Q was never let in from the lobby | "Nobody let Q in from the call's lobby…" and "Unrecorded"                                                                                                     | "Q has no record of this call" |
| Q was removed from the call       | "Q was removed from the call." If it had already heard something, the record keeps that and marks the rest unrecorded ("Q's record of this call is partial"). |                                |
| The transcript is late            | Q waits, polling every minute (or the webhook fires). After 3 hours: "Q's transcript of the call never came back."                                            |                                |

When a call is still running, **Send Q in again** on the record retries.

If none of these appear and Q never arrives, check the q-api logs for `meeting bot not created`. Bot status can be read-only checked with `GET /api/v1/bot/<id>/`.

## meet2-64: what the 2026-10-04 call showed, and what to check next time

What happened (Recall bot `6cf27e41`, meeting `21d82131`): Q was admitted at 18:36:31, greeted, then said nothing until 18:40:06, when it said a greeting and three answers in one go. The call ended at 18:41:46. The record was written at 18:42:58 (polling worked; the webhook is not set up), but nobody was told: the "notes are ready" notice failed the link check, and that failure skipped everything after it.

- **The delay.** Recall's participant events show Meet's "speaking" flag on for 130 s from one open microphone, then switching between the two laptops every 0.3–3 s. Q waited for nobody to be speaking. Answers were composed 1.6–2.3 s after each question; captions arrived 1–3 s after the words.
- **Echo.** Two laptops in one room, both mics open: every line was captioned twice, once under each name. For the demo, use one laptop per room, or headphones.
- **Two calls.** Q's voice "repeats its last action" made two bookings 4 s apart. The second bot sat in the lobby, and its "Q has no record of this call" was the only after-call notice anyone got. This is voice-side; the voice owner should fix it.

Check next time (deploy `build/meet2-64`; no migration):

| When                                  | Look for                                                                                                                                                                                                  |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| You ask "Q, …?" or "Um, hello, Q?"    | The answer starts within about 2 s of you stopping, even if the other laptop's mic is open. In the q-api logs, `meeting host composed` shows `composeMs` and `meeting host spoke` shows `ttsMs`/`playMs`. |
| You ask three questions quickly       | One answer, to the last one, starting "Taking the latest question:". Never a pile of answers.                                                                                                             |
| You start talking while Q speaks      | Q stops (your words, or a fresh voice in a quiet room). Two open mics flipping on their own don't stop it.                                                                                                |
| Mid-call                              | The meeting record already shows the transcript so far (saved every 10 s).                                                                                                                                |
| Within about 1 min of the call ending | Both sides get "Q's notes are ready" / "The call's record is ready". Each gets the recap email (Brevo). Work has the follow-up cards. Money is shown as **DETECTED** ("a million dollars" is now read).   |
| End the call early                    | The record still appears, built from what Q heard; if the provider's transcript failed, it is marked partial.                                                                                             |

Logs to grep (they never contain the call's words): `meeting host composed`, `meeting host spoke`, `a step after the meeting record failed`, `the live record was not saved`, `meeting follow-up cards prepared`.

### Backfill for today's call (proposed, not run)

Recall keeps the bot's transcript (retention: forever). After `build/meet2-64` is deployed (which marks `meeting_held` once per meeting), let the collector settle the call again:

```sql
update communication.meeting_assistants
   set status = 'IN_CALL', updated_at = clock_timestamp()
 where id = '80b4e357-6731-473d-ac2f-e1df64b84245' and status = 'DONE';
```

Within a minute the collector reads bot `6cf27e41` and rewrites the notes (one MEETING_NOTES model call). It then sends both notices and both recap emails, prepares the follow-up cards, and files "a million dollars" as DETECTED (key `meeting:21d82131…:<n>`, idempotent). Notices dedupe on `meeting-notes:<id>`. Cost: one notes model call plus two emails.

### Sharing the deck on screen in a call (plan, after the demo)

Recall Output Media can show a web page as the bot's camera or screen share (`POST /bot/{id}/output_media/`, kind `webpage`). This was not built for the demo: it needs more than the 2-hour budget and needs a security review.

1. "Q, share my deck" in a call makes the founder's existing **Share your deck** card. Nothing is shown before approval.
2. On approval, the server mints a short-lived deck-view token. The token is scoped to the meeting, the deck document and the approving founder. It expires at the call's end, and it is checked server-side on every page and image request.
3. A read-only deck viewer route is reachable only with that token, and serves no other document.
4. The server then calls `output_media` with that URL, and `DELETE` stops it. Both happen only from the founder's approval or their "stop sharing", never from the model.
5. Tests: the token is refused for another meeting, another deck, after expiry and after the founder revokes it.
