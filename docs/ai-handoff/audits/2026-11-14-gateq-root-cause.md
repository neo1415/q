# GateQ sustained journey: the shared cause behind three failed live runs (14 Nov 2026)

Directive: `directives/2026-11-14-release-workflow-branding-q-voice.md`, point 2: on repeated failures in one workflow, fix the shared cause, not the symptoms. Inputs: the three live sections of `audits/2026-11-14-gateq-sustained-journey.md` (1f9e33016, d2ce8c91e, 06910b145) and the two fix slices `ed85e8448` and `4dd353859`.

## The pattern

Each run failed on different symptoms, and each patch tightened or loosened one heuristic. The next run then hit the heuristic next to it.

| Run       | Symptom                                                                      | Mechanism in code                                                                                                                                                                                      | Patch                                                                       | What the patch broke next                                                                  |
| --------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1f9e33016 | 600 vs 1,500 WAU never linked                                                | Code detection skipped a null `as_of`                                                                                                                                                                  | `ed85e8448`: `samePeriod(null, x)` is true                                  | Two numbers in **one sentence** ("from 1 to 4") are now "the same period" and DISAGREE     |
| 1f9e33016 | "Leave it open" stored as an UNKNOWN statement                               | No D<n> existed, so the reader expressed intent as a value                                                                                                                                             | `ed85e8448`: UNKNOWN on a dimension with an OPEN disagreement = LEAVE_OPEN  | Any UNKNOWN on that **dimension** is swallowed (run 3: CAC → leave-open on 1-vs-4 schools) |
| d2ce8c91e | Form autosave CORRECTED interview stage statements                           | `formStatementPlan` related a form answer to every item on the **dimension**                                                                                                                           | `4dd353859`: CORRECTS only form answers; DISAGREES on single-answer dims    | Fixed for the form; the same dimension-wide relation remained in the turn path             |
| d2ce8c91e | 600 vs "Not known" false OPEN disagreement                                   | Code detection and the qualifying rule linked anything differing on the dimension; UNKNOWN was a comparable end                                                                                        | `4dd353859`: UNKNOWN never disagrees; UNKNOWN NEW → LEAVE_OPEN on dimension | Broadened the dimension-wide LEAVE_OPEN of run 1 to DISAGREES S<n> too                     |
| 06910b145 | CAC unknown swallowed; 1→4 schools a false contradiction                     | `standingOn` (statement-plan.ts ~897) matches by dimension only; detection (~853 and the projector ~326) ignores source turn                                                                           | —                                                                           | —                                                                                          |
| 06910b145 | Revenue asked 5× after "Nobody pays yet", then the period of a zero          | "Settled" decided in two places: the view status per dimension (revenue UNANSWERED: the zero went to `paying_customers` on traction) and `missingSpecifics` on legacy text (a TEXT zero has no period) | —                                                                           | —                                                                                          |
| 06910b145 | "I haven't marked those two answers as left open yet" (they were, since t18) | `replyHeldToReading` judged the claim by this turn's events only; the repeat "leave it open" was read as a note                                                                                        | —                                                                           | —                                                                                          |

## The shared cause (hypothesis confirmed)

**Code infers relations between statements from coincidence on the coarse `dimension` bucket, instead of from the reader's explicit references plus the statement's own validated identity.**

`claims.traction` holds weekly active users, CAC, partner schools and percentages of users at once. "Same dimension" is therefore not "same thing". Five places each asked "same dimension?" with their own extra heuristic:

1. **Code-detected DISAGREES** in the write path (`planReading`, ~853) and in the projector (`projectView`, ~326): same dimension, same quantity, period "maybe the same", and the source was ignored. So two halves of one sentence could disagree.
2. **The qualifying-dimension DISAGREES** (~867): differs from the _latest_ held value on the dimension, whoever said it and in which turn.
3. **Implicit LEAVE_OPEN** (`standingOn`, ~897): any standing disagreement with an end on the dimension, whatever metric the UNKNOWN was about.
4. **The form's relations** (`formStatementPlan` before `4dd353859`): every item on the dimension.
5. **"Settled"**: the view's per-dimension status for asking, but the legacy-text regex (`missingSpecifics`) for follow-ups, and nothing linking a zero of paying customers to revenue.

The reply checks (invariant 7) had the same flaw in the other direction: they counted this turn's _writes_, not the recorded _state_, so a true sentence about a standing LEFT_OPEN was replaced with a false denial.

Evidence that this is one cause, not several: every P1/P2 defect in runs 2 and 3 sits at one of those five call sites, and each was introduced or exposed by a patch to a neighbouring site (the table above).

## The rule that removes the class

A relation between two statements (DISAGREES, an implicit LEFT_OPEN target, the code's own detection) exists only when **one predicate, `relatable(a, b)`**, holds, and code never writes or projects one otherwise:

1. **Both ends hold a value.** UNKNOWN is never an end, and ZERO is a known value (it can disagree with 600, and it settles).
2. **Same dimension and same metric.** For numbers, both name the same non-null quantity, and the value kind fits that quantity: a PERCENT is only a rate, a COUNT is only a count. "40 percent of students are girls" is never `users`.
3. **Comparable period.** Known dates are equal, or a date is not given.
4. **Different utterances.** Two statements from the same source turn never relate to each other ("from 1 school to 4" is a change, said once).
5. **Explicit beats inferred.** A reader's DISAGREES S<n> is validated by 1, 2 and 4, and dropped as a link (the statement is kept as NEW) if it fails. A LEAVE_OPEN takes the reader's D<n>. Inferred from an UNKNOWN, it applies only to a disagreement whose ends share the UNKNOWN's dimension **and** quantity (or that the op's own S<n> target belongs to).

Plus two single-source rules:

- **One "settled" predicate**, used by the asking plan and by every reader. It comes from the statement view. A stated zero of paying customers is a stated zero of revenue: the write path records both, with the founder's words. A zero, numeric or TEXT, never needs a period.
- **Reply claims come from recorded state.** "Left open" stands when this turn wrote or named a LEFT_OPEN. It also stands when, after the turn, a LEFT_OPEN disagreement stands and none is OPEN, so the sentence cannot be about anything else. "Noted" needs a recorded statement.

Stored links written before this rule are judged by the same predicate when they are projected. A link that fails it decides nothing, whoever wrote it. So the frozen `c4cf20bd` (600 vs "Not known") and `1e9fd48e` (1 vs 4 schools in one sentence) read correctly without rewriting a row.

## Fix list (this slice)

- `statement-view.ts`: `relatable()`; the projector's detection and its stored-link activity both use it.
- `statement-plan.ts`: the write path's detection, the qualifying rule, model DISAGREES validation and `standingOn` all use it. The quantity fits the value kind. A paying-customers zero also records the revenue zero. `leftOpenCount` comes from state.
- `question-needs.ts` / `answer-specificity.ts`: the specifics follow-up reads the view (a zero is complete), so there is one settled predicate.
- Readings record `reading_version` 3 (the rule and prompt v8). Plan checkpoint version unchanged.
- Prompt v8 (reading schema v2 unchanged):
  - a change or range said once is one statement;
  - "nobody pays" is a ZERO on revenue;
  - a repeated "leave it open" is a LEAVE_OPEN on its D<n> and never a note.
- Contracts: `gateqRelatable` is the single source of the rule, and `statement-view.ts` delegates to it. A frozen v2 dossier is read under the current rule (`gateqDossierAsReadNow`) in the investor inbox and in a pending synthesis:
  - a relation the rule forbids is inactive;
  - its contradiction line and its diligence question are not shown;
  - the qualification stays as decided at submission;
  - the frozen row is never rewritten.

  Decision: re-read for display, not label-as-submitted. The statements are the submitted record, unchanged; only a pairing that no relation may ever be is withdrawn.

- No draft is created on page load. A signed-in page load asks `reopenOnly` (`StartApplicationRequest.reopenOnly`), and the API answers 404 when no draft exists. The founder's first action starts one.
- Documents on resume:
  - In the same browser, the ticks were already restored (local recovery).
  - In a new browser they cannot be restored today. Ticks are held only until Send, because consent is at Send (ADR 0067), and there is no server store for a pre-Send selection.
  - Review no longer sends 0 of N silently. It says "No documents ticked yet" and offers "Choose documents to share", which goes back to the questions page with the stored answers.
  - Restoring across devices needs a server-held selection: a migration plus a contract field. **Flagged; not done in this slice.**
- The dossier's company header shows every stage answer while the answers disagree (`dossierStageWords`). The frozen `company.stage` is unchanged.
