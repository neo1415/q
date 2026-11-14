# Limits that reduce Q's intelligence (read-only audit, 14 Nov 2026)

Owner directive: `directives/2026-11-14-intelligence-limits-gateq-invariants.md`, item 2. The audit was done by reading and grepping only. Paths are relative to the repository.

## B: arbitrary ceilings that silently lose meaning (replace), by impact

1. **GateQ synthesis points.**
   - `packages/q-core/src/prompts/schemas/gateq-dossier-synthesis.ts:48` sets `points .max(9)`. `packages/gateq-intake/src/application/dossier-synthesis.ts:291` uses DROP, and `:224` slices to 9. Point text is cut to 400 characters and the takeaway to 600 (`:213`, `:223`), and at most 4 fact ids and 4 turn numbers are kept.
   - The gateway's drop report is never read. `model-gateway/src/policy/structured.ts:56-57` caps passes at 4 and reported drops at 8.
   - Fix: a versioned `GateqSynthesisV2` with no count cap, plus `complete` and `omittedCount`. Show 9 by default and expand the rest in the UI only.
2. **GateQ transcript and findings fed into synthesis.**
   - `dossier-synthesis.ts:122` sets `TRANSCRIPT_MAX=14_000`, and `:181` stops at the first turn that does not fit, so the latest turns (often corrections) are dropped. Findings are cut the same way (`:102`, `:174`).
   - `GATEQ_TRANSCRIPT_MAX_TURNS=400` (`packages/contracts/src/http/gateq-intake.ts:566`). The model is never told that anything was omitted.
   - Fix: send every fact by id, then the turns it came from, then recent turns, map-reducing if needed. Tell the model "N turns omitted" and record coverage.
3. **Accumulated fact text capped at 2,000 characters.**
   - `packages/gateq-intake/src/application/fact-history.ts:48`, with `bounded()` at `:224-235` (`.slice(-2000)`) and `:66`.
   - Fixed by the atomic-statements design: one row per statement.
4. **Four unresolved contradictions.**
   - `fact-history.ts:49` (`UNRECONCILED_MAX=4`, `slice(-4)`), and `packages/gateq-intake/src/contracts/index.ts:168` (`.max(4)`).
   - `interviewer.ts:579` cuts the joined text at 2,000 characters, and `coverage.ts:322` keeps the first 16.
   - Fixed by the atomic-statements design: a disagreement link table with no cap. Prompts get the top N plus "and M more".
5. **Analyst gaps and strengths lost wholesale.**
   - `packages/q-core/src/prompts/schemas/analyst.ts:337` has `gaps .max(30).catch([])`, and `:440` has `strengths .max(8).catch([])`. A 31st gap empties the whole list.
   - Fix now: drop the excess items, not the list. Then remove the cap, with batching.
6. **Company-analyst lists.**
   - `company-analyst.ts:70-72` caps findings and missingEvidence at 24 (`LIST_MAX`, used with DROP at `q-specialists/src/company/specialist.ts:906`).
   - Other caps on the same pattern:
     - assumptions and wouldChangeIf: 10;
     - coverage: 16;
     - materialChanges: 12;
     - profileUpdates: 6;
     - claims: 20 (`claim-extraction.ts:126`);
     - conflicts: 8 (`founder-extraction.ts:280`);
     - memory items: 12 (`memory-extractor.ts:89`).
   - Fix: model batching with a `more` flag, or input splitting in code, with what was cut recorded on the result.
7. **GateQ question limits.**
   - `question-needs.ts:117` (`MAX_ASKS_PER_DIMENSION=2`) and `:136` (6 needs per turn). This is reported, not silent, but the ceiling is fixed.
   - Fix: keep a guard against badgering, but derive it from the view's status (atomic statements).
8. **Q work results shown to Q.**
   - `packages/q-tools/src/tools/q-work.ts:362-363`, `:752` and `:776` keep 8 findings and 5 questions, with no "more" marker.
   - Fix: add `total` and `truncated`, plus an offset.

## B/C: needs a "more available" signal or retrieval

- **Q chat memory:** the last 12 turns, each cut at 4,000 characters (`q-specialists/src/answer.ts:2218-2219`). Not yet confirmed: whether a recall tool reaches older turns (`prompts/schemas/conversation-recall.ts`).
- **GateQ interviewer memory:** `RECENT_TURNS=8` (`conversation-service.ts:53`, `interviewer.ts:588`), with the utterance cut at 4,000 characters and needs at 2,000. Acceptable once facts become statements.
- **Meeting host memory:** `packages/communication/src/meeting-host/memory.ts:580-667` keeps the last 8, 5 or 12 items, and text is cut at 2,000 characters. Acceptable if the event log is complete; not checked.
- **Dossier, visible to investors:** `dossier.ts:219-220` keeps the first 20 documents and 80 diligence questions, and quotes are cut at 400 characters. Add counts and links.

## C: display or compact limits where the full data persists (acceptable)

- **Page reading:** `q-tools/src/tools/company-documents.ts` reads up to 60 pages by range with a `truncated` flag. `attached-documents.ts` caps at 14k characters or 40 pages with a `cut` flag.
- **Other bounded views:** stream reducer, rounds (last 50), own records (12k), deck-writer layout.

## A: justified controls (keep)

- **Retries:** GateQ synthesis gets 3 attempts with backoff.
- **Contact codes:** at most 5 attempts.
- **Cost budgets:** the gateway's `maxEstimatedCostUsd`.
- **Tool result size:** `MODEL_TOOL_RESULT_MAX_CHARS` is 32k.
- **Query sizes:** SQL page sizes.
- **Untrusted input:** 2,000-character caps on user, HTTP and action fields, and on web excerpts.
- **Output tokens:** synthesis at 1,600 and interviewer at 1,024. Raise synthesis together with B1.
- **Token-limit stops:** Anthropic and Google report when output hits the limit. Make sure that becomes a failed or incomplete result, never a silent partial one.

## Contract changes

- **B1, B2 and B4:** versioned contracts.
- **B3:** a migration and a value-kind change, both covered by atomic statements.
- **B5 and B6:** prompt schema version bumps.
- **B7 and B8:** no migration.
