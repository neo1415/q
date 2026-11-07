# Navigation misses in the batch-7 owner replay: root causes and fix (W4, 7 Nov 2026)

Source: `receipts/2026-11-07-owner-replay-batch7/README.md`. R1 works: decisions run and moves happen. Each remaining miss traces to what the decision was given, not to its model:

| Replay                                                                                     | Root cause (evidence)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Fix                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #7 "can i see their elevator" → "Capital Q doesn't have an elevator page"                  | **My batch-7 regression.** The turn reader names only the person's own destinations, so a company's Elevator tab read as an unknown screen. `actOnTool`'s unknown-screen branch (`answer.ts`) answers "does not exist" unless the answer can open records (`opensRecords`, meaning open_page is offered). The one-authority change stopped offering open_page in the workspace, so the false line was recorded. The digest does list the tab: `elevator "Elevator pitch"` on `/company/[companyId]`. | In workspace mode the reader's NAVIGATE steps aside entirely: no move and no "missing page" line. The decision places the page.                                                                                                                                                                                             |
| #2 "harbourline cargo's pitch deck" (no deck) stayed; #6 "tell me about clinicrest" stayed | **The decision was told it could only name records in THEIR RECORDS.** In production that list is the person's relationship counterparts (`counterpartNavigationRecords`). A Discover company like Harbourline or Clinicrest isn't in it, so v9 ("record names … exactly as listed in THEIR RECORDS") left the model nothing it was allowed to name. Code resolves any name through `open_page` as the person, so the restriction was only in the prompt.                                            | v10: a company or investor they name or point at goes in `record` even when unlisted. Code finds it as them, and if it isn't theirs nothing moves. A tab is the place even when it is empty. A conversation that turns to one record places its page, and the tab of the part they ask about.                               |
| #4/#5 "curious about their team" → "can i see it?" stayed on Overview                      | **The decision had no focus.** The pane's record was named only if it was in THEIR RECORDS (`placeOf` otherwise says "a record"). The decision didn't get W3's situation (FOCUS), so "their" and "it" couldn't be tied to Harbourline.                                                                                                                                                                                                                                                               | The decision now gets **the same situation the answer gets**: `runSituation(request, situationOf)` (`model-gateway/src/q/index.ts`), shown as THEIR SITUATION (fenced as data). It carries the on-screen record by name and the me/their precedence. v10 also says that "can I see it?" refers to the thing just discussed. |
| #10 "what can you find about me online?" → /search                                         | **No rule about research.** People search's purpose is looking someone up on the public web, and the model matched the goal "find online" to that place.                                                                                                                                                                                                                                                                                                                                             | v10: something they ask Q to find out or research is answered in chat. A search page applies only when they ask to search there.                                                                                                                                                                                            |

**Tests written failing first:**

- `answer-turn-reading` replay #7: in workspace mode a tab the reader can't name is never said to be missing, and the turn goes to the answer.
- `navigation-decision`:
  - THEIR SITUATION is rendered and fenced;
  - `createQPageMoves` reads the run's situation and passes it to the decision.

**Eval:** the q-nav runner gives every turn a situation from the synthetic world (on-screen record, a founder's own company), as production does.

**Live check, run by integration on `a707264e7`:** 8/8, $0.2257, 24 calls, 1.4–2.2 s per sentence. Receipt: `receipts/2026-11-07-qnav-replay-live.md`. Each sentence landed where expected:

| Sentence                   | Landed on              |
| -------------------------- | ---------------------- |
| Harbourline's pitch deck   | Harbourline › deck     |
| Harbourline's profile      | Harbourline › overview |
| "their team"               | Harbourline › team     |
| "can I see it?"            | Harbourline › team     |
| "tell me about clinicrest" | Clinicrest › overview  |
| "their elevator"           | Clinicrest › elevator  |
| "who viewed my profile"    | Analytics              |
| "find me online"           | STAY                   |

**Caution:** v10 changed the prompt, so the third held-out set's 88.1% no longer describes production. A fourth set (`heldout-fourth.ts`, about 120 turns, separate author, conversation-driven placement and tabs) is sealed before it is run once.

## The fourth held-out set, run once on `19514ed` (v10): now spent

Results (category level only; no rows read):

- pass 90.8%; decision 93.3%;
- move-target 91.5% (third set: 88.1%);
- **wrong-page 4.2%** (5 turns; third set: 1.6%); forbidden 0; p95 2.1 s.
- Wrong-page turns by category: FOLLOW_UP 2 of 34, LOOKALIKE_MOVE 1 of 8, LOOKALIKE_STAY 1 of 3, TYPO 1 of 4.

**Diagnosis from what v10 changed (category level).** v10 placed more pages correctly but loosened four places where a wrong page can come from:

1. **Unlisted names.** "By the name they used" let the model pass raw words, including a misspelt or partial _listed_ name. Code then matched it by substring or words, which can be a lookalike (TYPO, LOOKALIKE_MOVE).
2. **The topic rule was too broad.** "The conversation turns to one record → its page" also fired for a record merely mentioned inside a wider question (LOOKALIKE_STAY, STAY_IN_CHAT).
3. **Tabs.** "The part they ask about is that page's tab" pushed the model to name a tab even when no single tab holds the part, and a wrong tab counts as a wrong page (FOLLOW_UP).
4. **Pointing words.** When the record the conversation is about and the record on screen differ, the model had to pick one (FOLLOW_UP, NOT_THAT_ONE, STALE_CONTEXT).

**Tightening, on `fix/q-nav-batch8`:**

- **Code (all prompt versions):** a company or investor found only by part of the name said (`byNameMatch`, not exact) is **offered, never moved to** (guard `INEXACT_NAME`). With the pane collapsed it is only remembered. Board items and documents are exempt, because people name them by what they are about.
  - Failing-first tests are in `navigation-decision.test.ts`.
  - The production `open_page` port can't report exactness yet, so it keeps today's behaviour. Its own matcher has a floor and a lead margin, and the three votes must agree.
- **NAVIGATION_DECISION v11** (lock `1bf61b64`):
  - a listed name said misspelt or in part is written in full;
  - a record only mentioned inside a wider question is answered in chat;
  - a tab only when the part asked about is what that tab holds, otherwise the page as it opens;
  - a pointing word that fits both the conversation's record and the screen's gives the other as `alternative` (an offer, not a guess).
- **Dev:** 15 conversation-placement turns written for dev (FOLLOW_UP, TYPO, STAY_IN_CHAT, LOOKALIKE_STAY). None is a held-out sentence, which the "holds out" test checks.
- **Measurement:** an A/B on the same focused dev subset, v10 against v11:
  - `CQ_QNAV_PROMPT_VERSION=10|11`;
  - `CQ_QNAV_CATEGORIES=FOLLOW_UP,LOOKALIKE_MOVE,LOOKALIKE_STAY,TYPO,NOT_THAT_ONE,STALE_CONTEXT,COLLAPSED_PANE,DIRTY_FORM,STAY_IN_CHAT`.
    That is about 146 turns, roughly $3.2 per version. Ship v11 only if dev wrong-page falls with move-target held. There is no fresh held-out set for v11; a fifth set would be needed for that claim.
