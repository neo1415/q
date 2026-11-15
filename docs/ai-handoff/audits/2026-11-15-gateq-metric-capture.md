# GateQ metric capture: the shared cause behind the "new phrasing, new failure" runs (15 Nov 2026)

Directive: `directives/2026-11-14-release-workflow-branding-q-voice.md`, point 2: on repeated failures in one workflow, fix the shared cause, not the symptoms. Inputs: the re-certification sections of `audits/2026-11-14-gateq-sustained-journey.md` (30c99ccc5, 318577a8e, 5757518c7, 64637e8c9, 84ac9afa7) and `audits/2026-11-14-gateq-root-cause.md` (the relation rule).

## The pattern

Each live run used new founder phrasing, and each one surfaced a new capture failure. Each fix patched the phrase that had just failed.

| Run       | Founder said                                       | What happened                                                                                             | Where in code (before this slice)                                                                                                                                                                      |
| --------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 30c99ccc5 | "2,300 patient records digitised"                  | Read as `customers`, then paired with "4 clinics" as a disagreement                                       | Fixed by `unitFits`: a count keeps its metric only when the reader's unit is the metric's **listed** noun                                                                                              |
| 64637e8c9 | "It buys about 18 months"                          | Read as MONEY 18 (raise USD 18)                                                                           | Fixed by `moneyAsSaid`                                                                                                                                                                                 |
| 84ac9afa7 | "500 … weekly active shops", "about 1,300 … shops" | Both stored with quantity null, so never compared. Q's own reply named the difference, and no surface did | `unitFits(unit, "weekly_active_users")` compares "weekly active shop" with the listed "weekly active user" word for word, so it fails and the metric is dropped. The 30c99ccc5 fix broke the next noun |
| 84ac9afa7 | "Actually, CAC is about $12 per shop."             | Reading NO_STATEMENTS, `not_recorded` empty, and Q said "That's a useful update."                         | `planReading` records only what the reader proposes. Nothing checks a turn whose figure no op names. `replyHeldToReading` knows only "noted/recorded/saved" claims                                     |
| 84ac9afa7 | "the bank calls us Series A"                       | Stored as TEXT (the sentence is not a stage code) and code-detected as DISAGREES with CODE `series_a`     | Qualifying rule in `planReading` compares `canonical(value)`: the TEXT and the CODE are different strings                                                                                              |
| 84ac9afa7 | "We don't know our CAC yet."                       | Stored correctly (UNKNOWN, quantity `cac`), shown as "Business model: Not known"                          | `gateqStatementsInWords` and `coverageFromView` label every line by its dimension. An UNKNOWN has no words of its own                                                                                  |

## The shared cause

**Capture is exact-match on a closed vocabulary, and a miss is silent.**

The reader is asked to map the founder's words onto closed lists: metric keys with one listed unit noun each, and stage codes. Code then compares only exact identities: the unit word for word, values as canonical strings. When the founder's noun is not on the list ("shops", not "users"), the value is kept with no metric. When they say a code in prose ("the bank calls us Series A"), it stays prose. When the reader maps nothing at all ("CAC is about $12 per shop"), nothing is written. None of the three is detected:

1. **The unit check is a vocabulary check, not a family check.** `unitFits` accepted only the listed noun or a suffix of it. "Weekly active shop" names the weekly-active metric by its own words ("weekly active"), and the noun is just who the customers are. The listed-noun rule was introduced to stop "patient records" being customers. It cannot tell a customer noun from a non-customer noun, so it drops both.
2. **An empty reading is never cross-checked against the turn.** A turn with a figure and an empty reading has `outcome NO_STATEMENTS`, the same as "Yes, that's right." `not_recorded` lists only what code rejected, never what the reader skipped.
3. **Values are compared before they are normalised.** A stage answer is TEXT or CODE depending on how the founder phrased it. The comparison ran on the raw value, so the same code in two phrasings disagreed.
4. **Q's acknowledgement is not tied to a write.** The claim check (invariant 7) covered "noted/recorded/saved" and "left open". An acknowledgement of an update ("That's a useful update", "I've updated…") was never checked against the reading.
5. **Labels come from the dimension, not from what the statement is about.** A metric unknown has only the dimension's label. "Business model: Not known" hides which metric is unknown.

Evidence that this is one cause: each 84ac9afa7 defect is one of these five sites. Each earlier fix (30c99ccc5 `unitFits`, 64637e8c9 `metricNamedIn` for CAC) widened or narrowed one exact list for the phrase that failed. The next run's phrase then fell just outside it (the root-cause audit's "patch broke the neighbour" pattern, in capture rather than relation).

## The rules that remove the class

1. **Metric families with a unit noun.** A customer-unit metric (`customers`, `paying_customers`, `users`, `daily_/weekly_/monthly_active_users`) holds the founder's own noun for a customer as its unit:
   - With the metric's own words ("weekly active shop", "paying clinic"), any noun fits. The words are the metric; the noun is who.
   - A bare noun fits only when it is the company's declared customer unit (the nouns of its held `company.customers` prose). "4 clinics" are customers of a company that serves clinics; "2,300 patient records" never are.
   - When the reader gave no metric, a unit carrying a metric's own words names that metric (`metricOfUnit`). A bare noun never does.
   - The relation rule is unchanged: same dimension, same metric, comparable period, different turns. Units are judged once, at write time, into the family's metric. So 500 versus 1,300 weekly active shops disagree, and crates and patient records relate to nothing.
2. **No figure is read as nothing.** When the reader proposed nothing for a turn (no statement, no action, no read-back), and the turn holds a figure that no statement on record holds, each sentence with such a figure is kept in their own words as a founder's note (`application.note`, TEXT, no metric). The digit check only flags. It never decides what the figure is about.
3. **Acknowledgements stand only on writes.** An update claim stands only when the turn filed a statement against an answer; a note holding an unfiled figure does not count. This covers "a/the/useful/helpful… update", "updated" and "I've updated/replaced/changed/revised". When no statement was filed, the claim is removed. Q says instead that it kept their words as a note and has not filed the figure ("I've kept "…" in your words as a note, but I haven't filed that figure against any answer yet."), or gives the existing not-recorded line.
4. **Code lists are compared as codes.** `answerKey` turns a CODE, or a stage in prose naming exactly one stage, into its canonical code. Both the write path's qualifying rule and the projector use it. A stored DISAGREES between two answers that are one code decides nothing, whoever wrote it: the live `19a1c0bc` reads correctly without rewriting a row. A sentence naming two stages stays prose.
5. **A metric unknown reads under its metric.** `gateqStatementLabel` gives the label: a statement line reads "CAC: Not known", and coverage lists the unknown as "CAC". This also covers an unknown beside a held answer on the same dimension (the fee and the CAC unknown on business model). A later CAC figure supersedes the unknown, as before (`projectView`).

Prompt v14 (`GATEQ_INTERVIEWER`, reading_version 9) adds two things:

- the family rule, with "500 weekly active shops" → `weekly_active_users`, unit "weekly active shop";
- "a figure they state is always a statement", with "Actually, CAC is about $12 per shop." → MONEY 12 USD, quantity `cac`.

The code rules above do not depend on the prompt.

## Fix list (this slice)

- `statement-plan.ts`:
  - metric families: `unitFits` with the declared customer nouns, `metricOfUnit` and `customerNounsOf`;
  - the unfiled-figure note (`figuresIn`, `unfiledFigures` on the plan outcome);
  - `claimsUpdate`, `unfiledFigureLine` and `replyHeldToReading` with the unfiled figures;
  - the qualifying rule compares by `answerKey`;
  - `STATEMENT_READING_VERSION` 9.
- `statement-view.ts`: `answerKey` and `sameCodedAnswer`. A stored link between one coded answer said twice is inactive.
- `statement-words.ts`: coverage labels a metric unknown by its metric, also beside a held answer.
- `contracts/http/gateq-statements.ts`: `GATEQ_METRIC_LABELS` and `gateqStatementLabel`, used for statement and history lines.
- `interviewer.ts`: passes the unfiled figures to the claim check.
- q-core: prompt `gateq-interviewer.v14.ts` (v13 deprecated), registry, prompts.lock.
- Test: `live-relations-replay.test.ts` replays the ninth run (form plus 16 turns, the eight invariants and the capture invariants after every turn), a v14-reading variant, the family and code-list units, and the frozen `19a1c0bc` link. It fails on the previous code.

## Limits

- The declared customer unit is the nouns of held `company.customers` prose. That is a coarse set: a sentence about customers that also names a non-customer noun admits that noun for the generic `customers` and `users` metrics only. The qualified metrics need no declared unit.
- A frozen v2 dossier read in the investor inbox (`gateqDossierAsReadNow`, contracts) does not yet normalise stage codes. The wire view carries no code for a prose answer, so the frozen 84ac9afa7 dossier still lists the bank's "Series A" contradiction until it is re-read from the statements.
- An unfiled figure stays a note until the founder or a later reading files it. Q says so, but it does not ask a dedicated confirm question, so the plan's next question keeps its place.
