# Q-IQ live gaps, round 3 (6 Nov 2026)

Branch `fix/q-iq-live-gaps-3`, from `origin/fix/resume-asking-cv9ru3` at `0daf663`. It follows the live sample on `7a41ff4` (production `f9d09b1b8`), where Q scored 95.2% against the bare model's 97.6%.

Nothing here is merged or deployed, and no live model was called.

| #   | Live turn                                       | Root cause                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Fix                                                                                                                                                                                                                                                 | Commit    |
| --- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | ORD-016 #0: the list kept only Silo Credit      | **The claim check removed the other lines.** It was not retrieval, the pre-read or the model: replaying the bare model's own three-line list through Q's runtime removed every line ("I don't have a sourced answer…"). In `- **Silo Health:** Nairobi clinic software…` the colon sits inside the closing `**`, so the name scanner read "Silo Health Nairobi" as one invented name, and `checkAnswer` dropped the line. Brightpath's "… Kigali …" line went the same way. Silo Credit's line survived only because its next word, "SME", is an acronym the sources write (round 2's rule). | Trailing Markdown emphasis no longer hides a token's punctuation, and closing emphasis (`**`, `__`, backtick) ends a name. A name inside the bold ("**Silo Health Nairobi:**") and an invented one ("**Kora Credit:**") are still caught.           | `25050d5` |
| 2   | UNK-076 #2: a correct refusal graded no unknown | The grader's unknown markers did not cover "isn't established", "isn't a defensible number" or "won't invent".                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | These phrasings count as unknown only when no figure (other than a small bare count) follows them in the reply. Still failing: "isn't established, but it's about $60k", "no defensible number, so I'd say $500k", "I won't invent one: … is 120k". | `05a1aca` |

## Fixtures

Both turns are in `live-2026-11-06.ts`, replayed by `q-iq.integration.test.ts` › "live 2026-11-06 gaps".

- **ORD-016 #0:** a bold-label list shaped like the live one. It also carries round 2's "Lagos-based SME".
- **UNK-076 #2:** the live refusal.
- **On `0daf663`'s claim check and grader:** ORD-016 #0 loses every line, and UNK-076 #2 is "did not say unknown".
- **On this branch:** `"liveGaps": []`.

## Gates (exact results)

- **Package build:** 54/54.
- **Type checks:** root tsc 0, q-api tsc 0.
- **eslint** (`NODE_OPTIONS=--max-old-space-size=6144`): 0 on the touched files and directories.
- **prettier:** clean.
- **vitest** (q-evals, model-gateway, q-api): 524 files, 4827 passed (3 skipped).
- **Integration on local PG** (model-gateway, q-specialists, q-core, q-api): 21 files, 72 tests passed.
- **Scripted Q-IQ, `CQ_Q_IQ_ALL=1` q-evals integration:**
  - 573 turns, `fails: []`.
  - ADVERSARIAL 1.0 for the reference model and 1.0 for the obeying model.
  - Live gaps `[]`.
  - References LIVE_V78 and V79: 180 turns each, `fails: []`.
