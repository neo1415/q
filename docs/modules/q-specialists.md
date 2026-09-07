# q-specialists — Q specialists and Company Intelligence

**Packet:** CQ-Q-020 · **Package:** `@capital-q/q-specialists`

Q's first real specialist intelligence capability: the bounded specialist
contract under one Q, and the Company Intelligence specialist that
understands a company as a business from Capital Q's own authorised state.

## What this is not

These separations are load-bearing. Collapsing any of them creates a second,
ungoverned answer to a question Capital Q already answers elsewhere.

```
Company Intelligence ≠ InvestIQ
Company Intelligence ≠ matching ≠ recommendation ≠ investor fit
Company Intelligence ≠ the canonical Company domain
a specialist          ≠ an agent a person talks to
```

- **Not InvestIQ.** Assessment dimensions, Business Quality, Investment
  Readiness, methodology versions and weighting belong to InvestIQ's governed
  methodology. Company Intelligence supplies structured company understanding
  that InvestIQ can later consume. It identifies risk, strength, gap and
  uncertainty; it invents no weight and no score.
- **Not matching or recommendation.** Investor-specific fit comes later, from
  deterministic recommendation factors. Nothing here produces a company fit
  score, an investment probability, a funding likelihood or a peer benchmark,
  and `validation.ts` drops any finding whose language asserts one.
- **Not the Company domain.** Canonical company state and the capital
  objective are read, never written. The specialist has no write path at all.
- **Not a chatbot.** A person asks Q. Q decides a specialist is needed. The
  findings come back to Q, and Q's synthesis is what the person reads. No
  reply names the specialist, the provider, the prompt version or a node.

## The specialist contract

```ts
type QSpecialist<TInput, TOutput> = {
  readonly id: string; // "company-intelligence"
  readonly version: string; // "v1" — never "latest"
  supports(probe: QSpecialistProbe): boolean;
  investigate(
    input: TInput,
    context: QSpecialistExecutionContext,
  ): Promise<TOutput>;
};
```

`QSpecialistExecutionContext` carries the server-resolved actor and the
Context Firewall's `PermittedContextPlan`. A specialist cannot widen its own
reach: nothing in the contract carries a tenant, an organisation, a
visibility scope or a grant a caller could set. There is no `execute`, no
approval and no write anywhere in it, so a specialist cannot become
consequential by being asked nicely.

Findings are the repository's existing `QInternalFinding` — four independent
axes, opaque evidence references, sensitivity and visibility for the
disclosure layer. A second finding shape would drift from the one the
firewall already knows how to project.

## How Company Intelligence runs

```
Q run
 └─ Context Firewall (plan)
     └─ answer seam
         ├─ supports()? no  → conversational answer path (delegate)
         └─ supports()? yes → Company Intelligence
              1. canonical structured state   (Safe Read tools, deterministic)
              2. authorised Q Knowledge       (current · as-of · series · disputes)
              3. authorised hybrid retrieval  (one search, the person's words)
              4. deterministic findings       (contradictions · staleness · changes · gaps)
              5. ONE model call               (COMPANY_ANALYST v2, EVIDENCE_SYNTHESIS)
              6. validate what the model wrote
         └─ Q writes the message
```

### The truth hierarchy

1. **Canonical structured state first.** A capital objective set last week
   beats a pitch deck from March, always, and the fact says so in its own
   source line. The two Safe Read tools (`company.get`,
   `capital.objective.get`) are called **deterministically**, not offered to
   the model: the model cannot choose to read a different company, cannot
   propose a call the plan did not admit, and cannot be talked into one by
   text inside a document.
2. **Authorised Q Knowledge second.** What Capital Q currently understands,
   with truth class, evidence status, confidence, validity, whether it is
   disputed and whether it is past its useful life. Searching documents for
   something already governed as knowledge would re-derive a worse answer.
3. **Authorised hybrid retrieval third.** The source material itself, for
   qualitative context and for the passages behind the summaries.

### Citation by opaque label

Every fact is handed to the model as `[F1] … [Fn]`. A finding cites those
labels; the map from label to real evidence reference never leaves the
server. The model therefore never writes an identifier, and **citation
fabrication is not merely discouraged but inexpressible**. An invented label
resolves to nothing and the citation is dropped, counted in
`telemetry.rejectedCitationCount`.

A retrieved passage carries a `DOCUMENT` reference only when the reader may
know the document exists. A citation asserts that a source exists, so when
existence is not disclosable the fact travels without a reference rather than
with a redacted one.

### What is computed, not asked

These are exactly the statements a fluent model gets subtly wrong in the
direction that flatters, so no model is asked for them:

| Computed deterministically      | Why                                                                  |
| ------------------------------- | -------------------------------------------------------------------- |
| Open contradictions, both sides | A model asked to reconcile picks one. Capital Q never does.          |
| Figures past their useful life  | "Stale is not false" is a distinction models blur.                   |
| Material changes                | Compared between recorded readings, never between two model answers. |
| Gaps for asked-about dimensions | Absence must not become weakness.                                    |
| Evidence coverage per dimension | A vocabulary, never a percentage.                                    |
| Information confidence          | Confidence in the understanding, never in the company.               |

The result is also the **trusted frame** the model is shown, and v2 tells it
plainly that it may not overturn it. The frame names the metric and says a
disagreement exists; it never carries either conflicting value.

### What the model writes, and what survives

`validateModelFindings` applies five checks, dropping rather than repairing —
a rewritten finding is a finding nobody wrote:

1. **Citations must resolve** to a fact the render actually showed.
2. **An entity-specific material claim needs support.** A finding asserting a
   number or a named organisation with nothing behind it is dropped: that is
   exactly what general model knowledge produces, and general knowledge is
   never entity-specific evidence.
3. **Truth class is bounded by what supports it.** `VERIFIED` is reachable
   only by restating something already verified upstream; an `INFERENCE`
   stays `Q_INFERENCE` however well supported.
4. **Absence is a gap.** A finding whose own words say information is missing
   becomes a `GAP`, whatever type the model chose. An absence claim is never
   rejected for lacking support — a gap is _about_ there being none.
5. **No scores, fit, probabilities or benchmarks.** Matched on the finding's
   own words; the pattern list is deliberately narrow so honest findings with
   positive wording survive.

Confidence is bounded too: a disputed supporting fact forces
`CONFLICTING_EVIDENCE`, a stale one caps `HIGH` at `MODERATE`, and a finding
citing nothing is `INSUFFICIENT_EVIDENCE`.

## Prompt

`COMPANY_ANALYST` **v2** (`q-core`, task class `EVIDENCE_SYNTHESIS`), ACTIVE.
v1 is `DEPRECATED` — retained, immutable and resolvable by exact version, so
a run recorded against it stays explainable. Its content hash is unchanged in
`prompts.lock.json`.

v2 adds the structured company reading, citation by label, the trusted
institutional frame, gap-is-not-risk, and an explicit refusal of scores, fit,
probabilities and peer benchmarks. Every new output field is defaulted, so a
response shaped for v1 still validates and the conversational answer path is
unchanged.

The prompt is not the security boundary. Every rule it states is also
enforced in code.

## Model routing and privacy

All model access is through the Model Gateway by task class. There is no
provider SDK, no HTTP client and no API key anywhere in this package. The
gateway decides provider eligibility from the declared sensitivity **before**
any provider is contacted; a `POLICY_INELIGIBLE` denial with no attempt
becomes `blocked: NO_ELIGIBLE_MODEL_ROUTE`, which is a correct refusal rather
than an outage, and the public message says so without naming a provider.

Context too sensitive for every configured provider is never sent to a less
suitable one to keep the feature available.

## Budget

One bounded investigation: **one model call**, **one retrieval search**, two
deterministic tool calls, and knowledge reads bounded by the fixed key list.
Facts are capped at 80 and passages at 8; when the cap bites it is the
passages that are dropped, because losing a quotation degrades an answer
while losing canonical state would make it wrong.

Cancellation is checked before each stage and propagated into the reads and
the model call.

## Observability

`telemetry` carries counts, codes, identifiers and timings: specialist
version, prompt bundle, provider, model, routing policy, call counts, finding
counts by type, evidence-reference count, contradiction/gap/uncertainty/stale
counts, and how many model findings and citations were rejected. It never
carries a statement, a fact, an excerpt, a prompt or a model output.

## Composition

```ts
const specialist = createCompanyIntelligenceSpecialist({
  gateway,
  canonical: createToolCanonicalPort(toolPort),
  knowledge: createKnowledgeCompanyPort(knowledgeQueryService),
  evidence: createRetrievalEvidencePort(authorisedRetrievalService),
});

const answer = createSpecialistQAnswer({
  specialist,
  delegate: conversationalAnswerPort, // where unsupported requests go
  repositories,
  sql,
  transactions,
});
```

`answer` implements the runtime's existing `QAnswerPort`, so the graph, the
firewall, the lifecycle and the stream are untouched.

## Verification

| What                                              | Where                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| Deterministic unit cases QCIU-001..011 (43 tests) | `packages/q-specialists/test/company-intelligence.test.ts`         |
| QCI-001..017 through the real Q path (17 tests)   | `packages/q-evals/test/q-company-intelligence.integration.test.ts` |
| Developer smoke, four turns of one conversation   | `pnpm q:company-intelligence:smoke`                                |
| Live variant through the existing gateway         | `pnpm q:company-intelligence:smoke --live`                         |

The integration test asserts in three places on purpose: the **provider
input** (the last surface before a model, and the only honest place to prove
a private figure never travelled), the **specialist result**, and the
**stored Q message**.

## Known limitations

- A reading swept to `STALE` by `reassessForFreshness` leaves
  `currentForSubject`, so the specialist stops seeing it entirely rather than
  reporting it with its age. Freshness assessed live on an `ACTIVE` reading
  works correctly. Which behaviour "current" should have for an analyst is a
  real seam between CQ-KNW-003 and this packet.
- Comparison for material change is within one knowledge key. "Cash and burn
  imply a runway that disagrees with the stated one" is not detected.
- No InvestIQ assessment is read as context, because none is implemented.
- The rendered `COMPANY_ANALYST` bundle sits close to the repository's
  3,000-token prompt budget; a materially longer v3 would need that budget
  revisited rather than quietly exceeded.
