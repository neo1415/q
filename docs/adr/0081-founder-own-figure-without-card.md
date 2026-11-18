# ADR 0081: A founder's own stated figure is recorded without a card

- Status: Accepted (owner decision 105, 2026-11-18)
- Narrows: CLAUDE.md "Material Q-extracted facts require confirmation before becoming authoritative" and "Prepare → Recommend → Human Approval → Execute unless explicit scoped delegation exists" (Q Architecture, Authority). This ADR is that explicit scoped delegation, for one case only.
- Related: A8 claim extraction in chat (`propose_company_figure`), commit 240e0b9a0 (question turns hold approval cards).

## Context

A founder who tells Q their own figure ("our MRR is now $120k", "we have 14 customers now") was shown an approval card for their own words. Decision 105 says Q records it straight away, says what it recorded and offers an immediate correct-or-undo. A low-confidence or garbled voice transcript still asks first.

## Decision

`company.figure.record` declares `ownStatement` (app-actions `OwnStatementDelegation`). q-tools runs it at once, with no card, only when **all** hold; otherwise the existing card is prepared, unchanged:

1. **Clear reading** (`ownStatementClear`, code from the turn reader's fields, `ownStatementClearOf`): a reading exists, confidence not LOW, not `UNCLEAR_TRANSCRIPT` or `FRAGMENT`; a spoken turn only with transcript `CLEAR` and not re-heard by sound (`:heard`); addressed to Q; no named other company or person.
2. **Founder member** (server-side): human actor with a membership, in the organisation and tenant that own the company, holding `evidence.record` on it. Investors and other organisations never qualify.
3. **Their own words, this turn**: the tool's `statedNow` flag, cross-checked by code. The quote must be in the latest user message itself (not earlier ones), and the value must be a numeral written in that quote. Figures from documents, pages or Q's inference never qualify (`document`/`web` inputs are refused).
4. **Idempotency**: `q-own-sha1(conversationId | messageId | action | figure)`. A retry also hits Evidence's same-value check, so it is `ALREADY_RECORDED`.

**Recording** goes through the same declaration and Evidence services the approved card runs (`recordStatedFigure`): USER_CLAIM / SELF_REPORTED, a CONVERSATION source with USER_STATEMENT reliability and the founder's words as evidence. It has the card's default visibility (`organisation_private`, never widened) and is audited with `claim.changed`. The source metadata says how it was taken: `approvedCard: false`, `delegation: "ADR-0081"`.

**Saying it**: the tool returns DONE with code's line, which Q says verbatim. The line gives the exact value, unit and date, and the offer to correct it or say undo.

**Correct or undo**:

- Only for the figure Q's own stored words in this conversation say it recorded ("Recorded your …").
- A correction is `correctStatedFigure`: the next revision of that claim through `reviseClaim`, carrying the new value, the founder's words as evidence and the change reason.
- Undo is the existing withdrawal (`withdrawClaim`): a SUPERSEDED revision with their reason.
- Neither overwrites anything. Any other withdrawal or correction keeps its card.

Question turns (240e0b9a0) still withhold every other card-preparing tool.

## Consequences

- No migration.
- No turn-reader prompt change (it uses the existing `confidence`, `transcript`, `kind`, `heardAs`/`:heard`, `addressedToQ`, `aboutNamedOther` and `namedOther` fields).
- A number said only in words ("fourteen") falls back to the card, by design.
