# GateQ atomic statements: an invariant-level fix (design, 14 Nov 2026)

Owner directive: `directives/2026-11-14-intelligence-limits-gateq-invariants.md`, item 3. This is the plan to replace concatenated-text facts. It is read-only design; slices are tracked in the acceptance matrix row B4.

## Root cause shared by D2–D11

Each dimension has one current `gateq.application_facts` row (`application_facts_one_current_idx`). It holds a TEXT value: lines joined by "\n" and clauses joined by "; ", plus an `unreconciled[{earlier,later}]` list that pairs quoted text.

`interviewer.ts` routes every turn through `addedStatement` / `correctedStatement` / `holdsWords` (`fact-history.ts`). Those functions find what a correction or disagreement refers to by substring-matching the model's free-text quotes.

"Left open" is only inferred from how many times Q asked. A founder turn that never got a Q reply is never read into facts.

## Target model

Statements are append-only and the view is a deterministic projection, like `relationship_events`. No stored concatenated text is truth.

1. **Schema.** One fix-forward migration, `gateq_application_statements`, adding four tables.
   - **`gateq.application_statements`**: id, application, tenant, dimension, optional `quantity` (a closed key such as `weekly_active_users`), `value_kind` (TEXT, CODE, MONEY, COUNT, PERCENT, ZERO or UNKNOWN), bounded `value` jsonb, `as_of`, exact `words`, provenance, `origin` (TURN, FORM, DOCUMENT_CONFIRMED or BACKFILL), `source_turn_id` (composite FK), and a unique `backfill_key`.
   - **`gateq.application_statement_links`**: kind CORRECTS or DISAGREES, from (newer) and to (older), origin (MODEL_READING, CODE_DETECTED or BACKFILL), and the source turn. No self-links; each (kind, from, to) is unique.
   - **`gateq.application_disagreement_events`**: state LEFT_OPEN, REOPENED or RESOLVED, plus `resolved_by_statement_id`. The latest event is the current state, and OPEN when there is none.
   - **`gateq.application_turn_readings`**: one per PERSON turn, with READ, NO_STATEMENTS or REJECTED, `recorded_statement_ids` and a bounded `not_recorded`. This is the authoritative execution result, and it is how an unread turn is found.
   - **Triggers on all four tables:**
     - append-only, so UPDATE and DELETE are refused;
     - the tenant matches the application;
     - no inserts after SUBMITTED;
     - link ends are in the same application;
     - `to` is older than `from`.
   - **Access:** RLS on with no policy and no browser grants (server-only). pgTAP covers every rule above.
2. **Versioned contracts.**
   - `DimensionView`: items with `sourceKind` (APPLICATION_STATEMENT, FORM or DOCUMENT), superseded statements, disagreements with their state, and a status. The status is one of SETTLED, ZERO, UNKNOWN, DECLINED, DISAGREEMENT_OPEN, DISAGREEMENT_LEFT_OPEN or UNANSWERED.
   - `GateqDossierV2` (submission snapshot v3). Old frozen rows are never rewritten, and readers accept every version.
   - Interviewer reading schema v2 and prompt v7: statement ops (NEW, CORRECTS S<n> or DISAGREES S<n>) and disagreement actions (LEAVE_OPEN or RESOLVE). S<n> and D<n> are short handles that the server maps to UUIDs and checkpoints. An unknown handle is never guessed.
3. **Pure projector** `statement-view.ts`:
   - CORRECTS hides only its target.
   - UNKNOWN never hides a held value.
   - ZERO is a value.
   - DISAGREES keeps both statements until RESOLVED.
   - Code detects a disagreement deterministically when two current numbers share the same dimension, quantity and as-of but differ.
   - Question needs come from the view status: SETTLED, ZERO, DECLINED and LEFT_OPEN are never asked again.
4. **Write path:** atomic with the turn, inside `completeTurn`'s existing transaction. Unread earlier PERSON turns are recovered before the next reading. A reply may say "noted" only for statements in `recorded_statement_ids`.
5. **One view for every reader:**
   - founder review;
   - the frozen dossier;
   - the investor inbox;
   - synthesis;
   - the investor's Q, which labels profile and document facts by their own source.

   Every one of them uses one shared formatter.

6. **Backfill:** idempotent, dry-run by default, with honest BACKFILL flags. Submitted dossiers stay as frozen.
7. **Long-journey regression:** 34 scripted turns with fixture readings, asserting the owner's eight invariants after every turn. Also a projector property test, Postgres fault injection, and a live Playwright certification script that checks counts, ids and states, never wording.

## Slices (each gated separately)

1. **Foundations, no runtime change:** migration, pgTAP, contracts, projector, unit and property tests.
2. **Write path:** reading v2 and prompt v7; statements written alongside the legacy facts; turn readings and recovery; the journey test for invariants 1–7.
3. **Readers switch:** dossier v2, inbox, synthesis and investor Q; backfill; invariant 8.
4. **Live certification, then retire** the concatenation and quote-matching code (the legacy table stays).

## Owner decision needed

A qualifying dimension (such as the raise amount) with an OPEN disagreement. Until you decide, rules keep using the latest current value, which is today's behaviour. The alternative is to treat the dimension as UNKNOWN for qualification.
