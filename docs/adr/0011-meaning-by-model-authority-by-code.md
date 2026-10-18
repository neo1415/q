# ADR 0011 — Meaning is read by a model; authority stays in code

## Status

Accepted — 2026-09-17.

## Context

Three live sessions in two days produced a list of Q behaviours that each
got a deterministic fix: a regular expression to route "the difference
between me and Paystack" to the company specialist, another to turn "four"
into a number, another to read "salvage bridge dot com" as an address,
another to take a currency from an amount, a list of words that mean the
person wants the public web, a list of words that mean a spoken profile
edit, and so on. Each was right. Together they are a system that
understands only the sentences somebody has already met, and the product
owner named the pattern for what it is: patching edge cases forever.

The architecture never asked for that. Doc 12 draws one line: the model
reasons, code enforces. The Context Firewall, the Tool Registry, the Write
Gate and the Approval Engine are deterministic because they are authority.
Whether a sentence is an answer to a step, a request to change a profile
field, a question for the public web or small talk is not authority; it is
meaning, and reading meaning is what the model is for.

The interview already works this way. The conductor reads every open step
from any sentence in any order and code validates each reading against the
step's own kind and options. What failed live was the validation layer
quietly dropping a reading it could not place, and a document step that no
spoken answer could ever satisfy. Home had no reading layer at all: a
sentence went straight to an answer, and a request to change something was
answered as if Q had no hands.

## Decision

1. **A model reads what the person means, into a closed schema.** Each
   surface has one structured reading per turn: the interview conductor
   for the setup, the company analyst's structured fields for a company
   conversation. New kinds of meaning (a profile change, a look-up, a
   navigation) are added as fields of that schema with a bounded shape,
   never as a regular expression over the words. Where a deterministic
   reader survives it is a fast path in front of the model for unambiguous
   control words ("stop", "go on", a bare "yes"), not the way meaning is
   understood.

2. **Code validates, holds, confirms and executes.** A reading is checked
   against the contract it targets. A reading that fits is recorded; a
   material one is read back and held for a yes; one that does not fit is
   answered with a plain question in the contract's own terms, never
   dropped and never acknowledged as if taken. A consequential reading
   becomes a proposal through the Approval Engine: Prepare → Recommend →
   Human Approval → Execute, bound to the exact payload, executed by the
   owning context under the person's authority.

3. **Profile changes are the first real Q action.** `company.profile.update`
   is a CONFIRM_REQUIRED action over the company's editable profile fields.
   The analyst reads a request to add or change any of them from the
   person's own words, quoting them; the answer seam notes the reading;
   the action proposer turns it into a proposal; the person approves on
   screen or by saying yes; the companies context performs the update.
   The same action is how Q offers what it learned about the company from
   its public presence for the person to accept into the profile.

4. **What was patched is kept only where it is validation.** Reading a
   number said in words, an address said aloud, and a currency named in
   an amount are normalisations a validator may do before it decides;
   they stay. Routing by word lists is to be replaced by the reading
   above as each surface is brought under it, and no new word list is
   added to decide what a person meant.

## Consequences

- One more field on the analyst's schema per new meaning, one more action
  definition per new consequence. No new reader modules.
- A turn may cost one structured model call where a regular expression
  cost nothing. That is the price of understanding the sentence nobody
  has met yet, and it is paid on the small, fast dialogue model.
- The Approval Engine, until now holding no definition, becomes load
  bearing. Its tests are the ones that protect this decision.
- Doc 12 §29-§32 and CQ-Q-008 are unchanged; this ADR names what uses them.

## References

- `docs/architecture/12_Q_Technical_Architecture.md` §27-§33
- `docs/modules/q-reliability-audit.md` §N, §O, §P
- `packages/q-actions` (CQ-Q-008), `packages/q-core/src/prompts/tasks/interview-conductor.v1.ts`
