# Production acceptance — 4 Nov 2026

- **Web:** https://capital-qweb-production.up.railway.app
- **Release:** all four Railway services (web, api, q-api, workers) were SUCCESS on `8967c4fd4` from 20:20Z. That commit is `8fa327a04` plus one formatting commit to the receipts index.
- **Account:** fictional `investor.savanna-seed@fictional.capitalq.local`, signed in with one-time admin magic links. No tokens or cookies are stored here.
- **Restraint:** no outward send was approved and no Approve, Send or Express Interest button was pressed.
- **Q turns:** 17 sent (`results.json` → `qTurnLog`), and "okay" never reached Q.
- **Viewports:** 1440 is desktop and 390 is phone.
- **Caveat:** another actor used the same account at the same time; there are conversations at 20:28–20:33 that are not ours.

| #   | Journey                                   | Result      | Evidence                                                                                        |
| --- | ----------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------- |
| 1   | Pipeline → Open pipeline → drawer         | PASS (both) | J1-1440-\*.png, J1-390-\*.png, J1-\*.webm, J1-\*.json                                           |
| 2   | Pipeline → Stay here → follow-up in place | PASS (both) | J2-1440-\*.png (incl. followup-settled), J2-390-\*.png, J2-\*.webm                              |
| 3   | Memo → stages → Discover and back → PDF   | PARTIAL     | J3-1440-stage-\*.png, J3-390-on-discover/back-home.png, J3-\*-viewer.png, J3-\*-download-\*.pdf |
| 4   | Plan → stages → plan card                 | PARTIAL     | J4-1440-1-progress-\*.png, J4-1440-1.png, J4-1440.json                                          |
| 5   | Top list → "second and third" → traction  | PARTIAL     | J5-1440-1..3.png, J5-1440.json                                                                  |
| 6   | Video / chart / deck in chat              | FAIL        | J6-1440-1.png, J6b-1440-1.png, J6b-1440-2.png, J6\*-1440.json                                   |
| 7   | Reload mid-answer; unknown document       | PASS        | J7-before-reload.png, J7-after-reload.png, J7-random-artifact.png, J7-1440.json                 |
| 8   | "okay" with nothing pending               | FAIL        | J8-okay-1440-1.png, J8-okay-conversations.png, J8-okay-1440.json                                |

## Observed

1. **Pipeline.** Q answered: "12 companies: 1 in diligence; 7 connected; 3 interest expressed; 1 waiting for your reply…". Open pipeline went to `/relationships?view=pipeline` ("Investment Hub", Pipeline tab), and the dock showed the same question and answer at both widths. **Defect:** the page says "8 connected · 3 awaiting reply · 2 waiting on you", with chips Connected 8 and Needs you 2, which does not match Q's counts.
2. **Stay here.** The card hid and the address stayed the same. At 1440 the follow-up answer was "Ajopot is furthest along… decide whether to advance, pause or pass"; at 390 it was "Clinicrest is the furthest along…". The two answers differ, probably because the account changed between runs.
3. **Memo.** Stages shown: Understanding your request → Pulling it together → Looking at the company → Writing your document → Reading Ledgerline's deck and documents → card READY, in 21–25s. At 390, leaving for Discover at 4s and coming back showed progress still running, then READY. The viewer opened at both widths, the PDF downloaded at both widths (232 KB and 235 KB), and `/api/q-artifact/<id>/pdf` returned 200 `application/pdf`. **Defect, content:** the 1440 brief says "The company identity is unresolved because public sources describe multiple businesses using the Ledgerline name" and leaves traction, financials and team as gaps, ignoring Ledgerline's own deck. The 390 memo did use the deck (Lagos VAT compliance). The same prompt gave inconsistent grounding.
4. **Plan.** The plan card **rendered**, so the known defect was not reproduced: 7 steps, "A draft: not fully reviewed yet · Draft 3 · 1 of 2 reviews passed", after 194s. Stages: Gathering your situation → Gathered 83 facts → Reading your documents → Researching → Drafting → Reviewing. **Defect:** step 1 is about other companies ("Approve, change or decline the pending Clinicrest, pipeline, Maji Loop, Watchly and Ledgerline cards"), as Q's own reviewer noted. Nothing was approved.
5. **Comparison.** "Compare the second and third" resolved to Mizan and Silo Credit, the displayed places 2 and 3, and the follow-up kept that context. **Defects:**
   - The compare answer says "Traction is not known for either", but the next turn quotes traction for both (EGP 640m originated; ₦2.1bn financed).
   - When the next message was sent, the completed compare turn was relabelled **"Couldn't finish… This request was cancelled."** (J5-1440-3.png).
   - Company logos render as black squares.
6. **Media.** "Show me Ledgerline's pitch video" navigated to **Ledgerfold**, a different company, and its video. "Show me Ledgerline's pitch deck" replied "Opening **Ledgerfold's** pitch deck…" and opened the Ledgerfold deck. "Chart Ledgerline's revenue" produced no chart: "it doesn't provide a time series or dated revenue points". Yet in J7 Q quoted the deck's MRR series, ₦19.6m in Oct 2025 to ₦38m in Sep 2026.
7. **Reload and unknown document.** After a reload 9s into an answer, the same conversation showed the question once and the full answer once. A random UUID returned 404 `{"message":"I couldn't find that document."}`. That is an honest denial, but the browser shows raw JSON. `/documents?artifact=<uuid>` shows the library with no error.
8. **"okay".** After sending, no "You: okay" bubble and no reply appeared, and no new conversation was listed. The message was silently discarded on the returning home surface.

## Defects ranked by client impact

1. **Wrong company:** asking for Ledgerline's pitch video or deck opens Ledgerfold's (J6).
2. **Memo grounding is inconsistent:** one memo calls Ledgerline's "identity unresolved" from public web sources and ignores its Capital Q deck (J3-1440).
3. **"okay" silently discarded** on home (J8).
4. **Answered turn relabelled "Couldn't finish / cancelled"** once the next message is sent (J5).
5. **Q contradicts itself on traction and revenue data:** "not known" or "no time series", then quotes figures; no chart renders (J5, J6b).
6. **Q's pipeline counts don't match the Relationships page:** 7 vs 8 connected, 1 vs 2 waiting on you (J1).
7. **Plan step 1 targets other companies**, not Ajopot (J4).
8. **Minor:**
   - logos render as black squares;
   - a denied document shows raw JSON;
   - Ledgerfold's video claim timestamps all read 0:00;
   - the docx and md exports return 404 (only PDF is offered).

Harness notes: two parallel sign-ins invalidate each other's magic link (J1-390-error.png, so no Q turn was spent). The 1440 memo timeline missed READY because the status is uppercase. That was harness-only.
