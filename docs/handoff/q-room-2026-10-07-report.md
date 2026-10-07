# The Q room: report, 7 October 2026 (morning)

Answers every id in `q-room-2026-10-06-plan.md`. All waves merged and deployed. Deploy head is `a259ae22`, and the hosted database has 166 migrations with none missing. Each merge ran the package build, typechecks on all four apps, targeted tests, the route parity test and a production web build. New tables ran their pgTAP suites on a local database rebuilt from scratch.

| Id | Ask | Result |
|---|---|---|
| R0 | Voice errors, card actions, certificate of incorporation | Fixed. The startup self-check no longer logs `NO_BINDING_FOR_TOKEN`. An idle line no longer cuts a question Q is still answering. "Open profile" on a card works. Documents are found by meaning. Q no longer claims something is on screen when it isn't. |
| R1 | Q sees the whole screen | Done. Every page describes all of itself, not only what is scrolled into view, and that includes open windows. A "Q can see" line shows what Q is looking at. |
| R2 | Deep links | Done. Q can open a company's elevator pitch, data room, deck or team, a work item, a round, a GateQ application, or settings. |
| R3 | Documents in the room | Done. The document opens in the room. Q reads it aloud with the text highlighted and summarises it with page numbers. Next page, previous page, go to page N, download and close all work by voice or text. A new page table (`evidence.document_pages`) checks the same permissions as the data room. |
| R4 | Cards come and go | Done. Cards close as soon as the topic moves on and reopen if it comes back, and "close it" works too. |
| R5 | Q as a colleague | Done. Before starting, Q checks for approvals already waiting about the same companies, people or kind of job, and asks. Its plan says what will need you. Without a calendar, Q says so, suggests three working-hour times and shows a Connect Google Calendar card. The card opens a pop-up, so the room stays put. |
| R6 | Web and news, PDF, downloads | Done. Long web or news answers offer "Want it as a PDF?", and yes opens the PDF in the room. "Download it" works for any open document. |
| R7 | Never silent | Done on both voice lines. At about 0.7 s a soft tone, at 1.5 s a spoken line about the real stage ("Looking at Ledgerline's deck…"), then progress lines. After 8 s, at most one remembered small-talk thread per wait, and never during an approval. Company names come only from what the person is allowed to see. Waiting lines stay out of the transcript. Particles travel round the page edge. Small-talk memory goes through the Write Gate, is kept 90 days, can be deleted and is never shown to anyone else (ADR 0062). |
| R8 | Decks and documents | Done. The pipeline writes the slides and code picks the layouts. Pictures come in this order: the founder's own, charts from their numbers, Pexels photos, then generated images (at most 6, Gemini first). A check-and-fix step follows. The output is PDF plus PowerPoint. Placeholders get a floating Upload button. Voice edits each make a new version. One-pagers and memos use the same pipeline. Q offers to draft the deck after a founder's first upload. |
| R9 | Fast on weak networks | Done for the room. Tested on Slow 4G with a 4x slower CPU. A named document's first page draws in 2.7–3.4 s, down from 4.7 s. Interaction while particles move is 104–112 ms, down from 136–144 ms, and layout shift stays at 0.03 or below. Everything retries once, then shows "Couldn't load — try again". Voice narration reconnects after a drop without repeating itself. |
| R10 | Research, then design, then build | Done. Research is in `docs/research/2026-10-06/`; the design (9 scenes) and video are in `docs/design/2026-10-06/q-room/`. |

## Live tests (founder-paid)

| Call | Cost |
|---|---|
| One Gemini test image (`gemini-3.1-flash-lite-image`), confirms billing on the new key | about $0.03 |
| Deck 1 (images were still off on workers): text only, and the polish step was thrown away over one long bullet | model calls only |
| Deck 2: polished, pictures on 5 of 11 slides, but the generated image went to OpenAI `gpt-image-1` | $0.04 (OpenAI) |
| Deck 3: the generated image went to Gemini, one fix round, about 35 s end to end | $0.034 (Gemini) |

Gemini is now the first image provider. OpenAI is only the fallback.

## Known limits

- The room still takes about 7 s to become interactive on Slow 4G. Most of that is about 330 KB of startup script, and the presence face's drawing is the biggest cost on the page.
- Firm traction numbers can still stay as a sentence when the polish step rewrites the slide. The cover subtitle is long.
- If a placeholder upload's final step drops, retrying can leave a duplicate document.
- Voice narration goes quiet after about 6 s offline instead of waiting for the connection to return.
- The calendar card treats a connected Google account as a connected calendar.
- The vision check of rendered slides is not built; the checks are code-only for now.

## Decision for you

- A picture dropped on a placeholder goes through a new q-api route, listed by name as an exception in the route test. The alternative is to declare it in the action registry. It stays an exception unless you say otherwise.
