# Lane 8: attach a document anywhere Q is (2026-10-22)

Branch `speed/q-uploads` → PR into `speed/q-oct20`.

## What these show (black_gold preset, phone 390 and desktop 1440)

1. `*-1-reading`: the PDF is attached with no words typed. The line reads "Reading term-sheet.pdf" and Send is held.
2. `*-2-attached-send-live`: the file has landed and Send is live on the document alone. This was the reported bug.
3. `*-3-summary`: Q says what the document is, the 2–3 things worth knowing (cited by page) and the next steps.
4. `*-4-follow-up`: a follow-up question is answered from the same document, and the request still carries its id.
5. `*-5-new-conversation-finds-it`: after "New chat", nothing is attached, and "that document I sent" finds the document again.

Source: `apps/web/e2e/q-attach.spec.ts` on `/dev/q-attach`. That harness runs the real `QComposer`, the real attachments store and the real screen context. The upload and Q are fixtures: a fake model answering from the page text it was given.

## Timings

These are the fixture timings (`*-timings.json`): upload fixture 600 ms, fake model 250 ms.

|                      | phone   | desktop |
| -------------------- | ------- | ------- |
| attach → Send live   | 959 ms  | 706 ms  |
| Send → first words   | 400 ms  | 754 ms  |
| attach → first words | 2082 ms | 1811 ms |

**Server side, in process.** `packages/model-gateway/test/q-answer-attached-document.test.ts` runs the real Q answer seam with the real `read_attached_document` tool and a fake model:

- An attachment-only turn is answered in about 60 ms.
- The document is read before the model is asked, with no extra model round.

**Production, not measured.** The pipeline polls every 0.75 s (outbox) and 1 s (documents), then parses. A small PDF should therefore have pages within a few seconds. A question asked before then waits for the pages for up to 12 s; after that, Q says it is still reading.

## Not covered here

- No full-stack run: the sandbox has no Docker, so there was no local Supabase, worker or q-api.
- No live production check was made.
