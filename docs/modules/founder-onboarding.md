# founder-onboarding — the founder journey and Founder Onboarding Q

**Packets:** CQ-ONB-002 (journey v1) · CQ-Q-021 (Q, and journey v2)
**Package:** `@capital-q/founder-onboarding`

The published founder journey as declarative data, the integration layer that
carries confirmed answers into the owning domains, and — from CQ-Q-021 — what
Q does with the material a founder already has.

## The idea CQ-Q-021 implements

```
give Q what already exists → Q reads it → Q shows what it understood
→ the founder confirms or corrects it → Q asks only what is still missing
→ a first Company Intelligence reading
```

A founder who uploads a deck should type **materially less** than one who
does not. That sentence is the whole packet, and most of the code below
exists to make it decidable rather than aspirational.

## Journey versions

|              | v1 (CQ-ONB-002)                                                                          | v2 (CQ-Q-021)                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| F2 Materials | `multi_select` — checkboxes, and copy admitting _"uploading arrives in a later release"_ | **`document_upload`** against the real Evidence API                                                     |
| F3 Review    | confirmation of what the founder typed                                                   | confirmation framed as _"Here's what I understood"_, with Q's readings offered beside it as suggestions |
| F7 Follow-up | `long_text` — "Anything else?"                                                           | the few questions the planner decided are worth asking                                                  |
| F8 Snapshot  | confirmation saying _"Q has not analysed anything yet"_                                  | a first reading of the company                                                                          |

v1 stays published and immutable; sessions pinned to it keep running its own
journey. v2 is published by the generated migration
`20260913090000_founder_onboarding_definition_v2.sql` and inherits every step
it did not replace from v1 verbatim, so the two cannot drift on what they
share (a test asserts this).

**F2 stays immediately after company basics.** Asking for documents _before_
forty manual questions is the point; asking after them is the failure mode
this packet exists to remove.

## F2 — what a founder actually gets

A real upload against the Evidence API, and nothing about it is simulated:

```
ask permission → short-lived signed target → browser PUTs bytes straight to
private storage → server verifies what landed and freezes an immutable
version → processing job queued
```

- **Private by default.** The document's scope is the Evidence context's
  decision; uploading is not publishing, and the screen says so in the open
  rather than in a tooltip.
- **The states are real.** A file waiting in a queue says it is waiting. A
  file the parser could not read says so. Nothing shows a spinner labelled
  "Q is thinking" over work that has not started.
- **Skipping is a first-class path**, worded as a choice. A founder without
  documents is not behind.
- **Drag-and-drop is an enhancement.** The file picker is a real button,
  reachable by keyboard and usable on a phone.
- **Only formats the pipeline can read** are offered: PDF, PPTX, DOCX and
  plain text. Offering a spreadsheet would let a founder upload one and then
  learn nothing came of it.

## What Q does with it

```
processed documents → authorised passages → ONE model call
→ validated candidates → onboarding suggestions
→ the founder confirms / edits / rejects
→ the journey's existing validated-response path → owning domain
```

### Provenance, and why citation fabrication is inexpressible

Passages reach the model as `[S1] … [Sn]`. A candidate cites those labels,
and the server resolves each to a document, version and locator. The model
never writes an identifier, so a candidate cannot claim to come from a slide
nobody supplied — an invented `S9` resolves to nothing and is dropped,
counted in `telemetry.rejectedCitationCount`.

What a founder reads is the resolved locator in their own words: _"From your
pitch deck, slide 6"_ — never a document id, a bucket or a storage key.

### What is refused

- **Nothing becomes VERIFIED.** The schema excludes it and the mapper
  refuses it again, so the guarantee does not rest on one file staying
  correct. A deck asserting five hundred customers is a claim.
- **A specific figure with nothing behind it is dropped.** That shape is
  what general model knowledge produces, and it is never evidence about this
  company.
- **A model's suggestion is never a company record.** The onboarding runtime
  validates every suggestion against the pinned step's own schema before
  storing it, and accepting one creates a normal validated response through
  the same path a typed answer takes. There is no route from model output to
  canonical state that does not pass through a person.

### The adaptive planner

Deterministic, and deliberately so. A model may _propose_ questions; the
planner decides which are asked, in what order, and how many — because four
properties must hold every time and a fluent proposer guarantees none of
them:

1. **Never ask what is already answered.** A confirmed response, or a
   pending suggestion awaiting confirmation, removes the question. This is
   the packet's central promise.
2. **Never ask what this business does not produce.** A pre-revenue company
   is not asked for customer counts or growth rates. The shape comes from
   the founder's own revenue answer, and an unknown shape excludes nothing.
3. **Every question maps to a real step** of the pinned definition, so the
   answer lands somewhere with a schema, a validator and a write target.
4. **The count is bounded** (four per iteration). Onboarding must feel
   finished; twenty "just in case" questions is the questionnaire this
   packet replaces.

Order encodes what _material_ means: contradictions between the founder's
own documents first, then what onboarding cannot complete without, then
figures whose meaning is unclear, then everything else. A contradiction
outranks a gap because a wrong number already in the record does more damage
than a missing one.

### Contradictions

Two documents disagreeing becomes **one question with both readings
attached**. Nothing averages them, prefers the larger, or prefers the newer.
A conflict is asked even when the fact already has an answer — because two
sources disagreeing is precisely the case where the recorded answer may be
the wrong reading.

### Unknown

"I don't know" is a real answer. Absence is missing information — never a
zero, never a false, never a mark against the company. Onboarding completes
on a short required set; everything else stays a visible gap rather than a
blocked journey, and there is no completion percentage to chase.

### No coaching before assessment

The prompt may say _why_ Q needs a figure. It must not tell a founder what a
better-looking answer would be. Establishing what is true comes first;
advice comes after.

## Prompt

`FOUNDER_ONBOARDING_EXTRACTION` **v2** (`q-core`, `STRUCTURED_EXTRACTION`),
ACTIVE. v1 is DEPRECATED — retained, immutable, resolvable by exact version,
hash unchanged in `prompts.lock.json`.

v2 adds source passages cited by opaque label, taxonomy candidates as plain
phrases (Capital Q's own service maps them; a model that could emit taxonomy
ids could invent one), conflicts recorded as two readings plus a settling
question, ambiguity as its own finding, and bounded proposed questions
restricted to keys the server already said are unanswered.

## Security

- All model access through the Model Gateway. No provider SDK, no HTTP
  client, no API key anywhere in this package.
- Uploads carry the HttpOnly session's token server-to-server. The browser
  never holds a Capital Q token and never chooses a tenant.
- The Context Firewall is unchanged: there is no onboarding bypass, and a
  founder-private document stays founder-private afterwards.
- A model that cannot be reached, or context no configured provider may
  receive, becomes a coded blocked state. Onboarding continues by asking.

## Malware scanning — stated plainly

**Not implemented.** `packages/config/src/workers.ts` defaults
`CQ_MALWARE_POLICY=REQUIRE_CLEAN`, and with no scanner attached the verdict
is `UNAVAILABLE`, so **an unscanned document is BLOCKED rather than parsed**.
`ALLOW_UNSCANNED` exists for local development and is refused outside a local
environment. This packet added no scanner and marks nothing CLEAN.

The consequence for a production deployment is real: until a scanner is
attached, F2 accepts uploads and the pipeline will not open them.

## Verification

| What                                                   | Where                                              |
| ------------------------------------------------------ | -------------------------------------------------- |
| Journey v2, planner, mapping, suggestions (27)         | `test/founder-onboarding-q.test.ts`                |
| The replan: session facts, suggestions, questions (16) | `test/founder-review.test.ts`                      |
| v1 journey and write targets (11)                      | `test/definition.test.ts`                          |
| The web journey over the runtime contract              | `apps/web/test/founder-onboarding-journey.test.ts` |

## Known limitations

See the CQ-Q-021 postflight. In short: the F2 upload path, the extraction,
the planner and the replan are real and tested; the F3 review screen does not
yet render Q's suggestions, F7 and F8 are not yet wired to the live session,
and nothing in production yet triggers the review when a document finishes
processing.
