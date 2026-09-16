---
title: Q Reliability Audit
status: living
owner: Q platform
sources: PADL · Product Specification · Final System Review · doc 12 (Q) · doc 14 (RAG/Memory/Knowledge) · doc 19 (Discovery) · doc 24 (Testing/Evals/Observability) · doc 26 (Q Conversation Experience)
---

# Q Reliability Audit

Every way Q has failed in front of a person, every way it is still failing,
and the ones we should expect next. For each: what it looks like from the
person's chair, what **fully solved** means (a condition you can test, not a
feeling), what exists today, and the gap.

This is a checklist, not a narrative. It is meant to be re-run.

**Verdicts.** `SOLVED` — the condition holds and a test or a live probe
proves it. `PARTIAL` — the mechanism exists but the condition does not hold
in all the cases it claims to cover. `OPEN` — nothing in the codebase
addresses it.

Rules this audit is written under, from the locked sources:

- Unknown stays unknown; absence is never converted into zero or into
  negative evidence (PADL).
- Q has intelligence authority, humans keep commercial authority; a
  consequential action is prepared and approved, never assumed.
- The Context Firewall filters by scope _before_ the model is invoked.
- A person experiences one Q. Internal specialists, retries, fallbacks and
  failures are ours to absorb, not theirs to hear about.

---

## A. Speed and the feeling of speed

### A1. A simple question takes longer than a person will wait

**Symptom.** "The time it spends checking stuff up is too much, it's much
too slow." Measured: 12 s for a question that reached the public web, and
about 6 s for one that did not.

**Fully solved.** A question that needs no lookup is answered in under 3 s
end to end. A question that needs a lookup produces its _first spoken words_
in under 3 s and the rest as it arrives. No turn is silent for longer than
2 s without something true being said.

**What exists.**

- The tool-gathering round now runs on its own small prompt instead of
  re-sending the full analyst prompt, so the round that decides whether to
  look something up costs a fraction of the one that answers
  (`packages/model-gateway/src/q/index.ts`).
- Research and platform retrieval run concurrently in the company
  specialist.
- A research turn yields its own first line before the lookup returns.

**Verdict: PARTIAL.** Measured 6.4 s on a no-lookup question after the
change, down from about 12 s. Under 3 s is not reached.

**Gap.** Two model calls still run in sequence for every answer. The
gathering call is cheap but not free. The remaining lever is A2.

### A2. Nothing streams

**Symptom.** Q is silent for the whole answer, then says all of it at once.
The user's own suggestion: "maybe by it giving us its words before it
finishes searching."

**Fully solved.** The first sentence of an answer is spoken while the rest
is still being written. `q.message.delta` is emitted by the server and the
voice path speaks sentence by sentence from it.

**What exists.** The client already understands the event: the stream
reducer handles `q.message.delta` and there are tests for it
(`packages/api-client/src/q-stream-reducer.ts`). **The server never emits
it.** Both answer paths produce structured output and emit only
`q.message.completed`.

**Verdict: OPEN.** This is the largest remaining latency item and the only
one that can reach the 3 s target.

**Gap.** Structured output cannot stream usefully — the prose sits inside a
JSON field that is only valid once closed. Reaching the target means
separating the _spoken_ answer from the _recorded_ structure: stream the
prose, and attach citations, truth class and confidence when the object
closes. That is a design change to the analyst task, not a tuning change.

### A3. A filler on every single turn

**Symptom.** "Before, it was 'let me check on that', now it is always 'one
second', every time, no matter what."

**Fully solved.** A filler is heard only when a turn is genuinely slow. A
turn that answers quickly begins with the answer. A turn that reaches the
web begins with what it is doing, which is information, not a tic.

**What exists.** `FILLER_AFTER_MS` in `apps/q-api/src/voice/speech.ts` was
2.5 s, below the time an ordinary answer took, so every answer qualified.
Raised to 4.5 s. Research turns yield their own line first and never reach
the generic filler.

**Verdict: SOLVED** for the symptom, **PARTIAL** as a design: the threshold
is a constant tuned against current latency. When A2 lands, a streamed first
sentence makes the filler nearly unreachable, which is the right end state.

---

## B. Saying it will do something, then not doing it

### B1. An announced action that never lands

**Symptom.** Reported repeatedly. Q announces a lookup and the lookup never
happens, or happens with no answer.

**Fully solved.** Q never promises a later action. Either the action happens
inside the turn and its result is spoken, or Q says it cannot do it. A
promise with no matching tool call is impossible by construction, not by
prompt discipline.

**What exists.** The conductor charter carries "never promise a later
action". Tool execution is observable through `lastObservation()`. The
think-route keepalive and slow-turn beat keep a long turn audible.

**Verdict: PARTIAL.** The rule is a prompt instruction. Nothing in code
detects "Q said it would look something up and no lookup happened".

**Gap.** A deterministic post-check: if the spoken text matches a promise
pattern and no tool ran for the turn, the turn is a defect. Cheap to add,
and it converts a prompt hope into a measurable invariant, which is exactly
the kind of assertion doc 24 says code should make rather than an LLM.

### B2. Routing that is announced but slow or wrong

**Fully solved.** A navigation Q offers is to a page the person is
authenticated and authorised for, and it happens within the same turn.

**What exists.** `spokenDestination` resolves navigation deterministically
against a fixed list; authorisation resolves before the route is offered.

**Verdict: SOLVED.**

---

## C. Refusing what it should simply look up

### C1. An authorisation refusal for a public company

**Symptom.** Asked about a well-known public company, Q refused on
authorisation grounds instead of reading the public web.

**Fully solved.** A question about a company the person has no relationship
with is a `PUBLIC_EXTERNAL_DATA` question. Q researches it, answers, and
labels the answer as public-web sourced and unverified. Authorisation
language is reserved for information that genuinely belongs to someone else.

**What exists.** `asksForPublicResearch` routes these deterministically; the
tools note says when to fetch; a deterministic second hop fires public
research when a platform lookup comes back empty; the analyst prompt no
longer says to answer from supplied facts alone.

**Verdict: SOLVED** for the named case, verified live: seven pages read,
seven kept, five understandings.

**Gap to watch.** The deterministic trigger is lexical. A question phrased
unusually still depends on the model choosing the tool.

### C2. Cannot read the internet about people and places

**Symptom.** "It can't read the internet on people and places and other
stuff."

**Fully solved.** A named person, company or place produces a public
footprint read through the same evidence path as a company, subject-matched
so a namesake is never reported as the subject, and written to memory only
through the Write Gate.

**What exists.** `packages/q-presence` with subject matching
(`domain/subject-match.ts`), evidence registration, Write Gate writes, and a
smoke script. Presence triggers exist for companies.

**Verdict: PARTIAL.**

**Gap.** Traced end to end in this pass. The read-back is four layers, and
they do not line up for a person:

| Layer                            | Company                        | Person                         |
| -------------------------------- | ------------------------------ | ------------------------------ |
| Presence build writes            | yes, at `organisation_private` | yes, at `organisation_private` |
| Plan names the subject           | yes                            | yes, self only                 |
| Retrieval reads the subject back | **fixed in this pass**         | **fixed in this pass**         |
| A granted scope reaches it       | yes, via `EVIDENCE_DOCUMENTS`  | **no**                         |

1. **Retrieval read companies only** — fixed. `authorisedKnowledgeFacts` in
   `packages/q-knowledge/src/q/evidence-retrieval.ts` mapped only
   `COMPANY` subjects out of the plan, so a person's and an investor
   organisation's understandings were written, gated, stored and then
   dropped on the way to the answer. It now maps all three subject types an
   understanding can be about, with a test.
2. **No scope reaches a person's understandings** — open, and it is a
   Context Firewall change, not a retrieval one. A knowledge constraint
   takes its subject ids from the scope, and the only scope carrying the
   `organisation_private` label that presence writes at is
   `EVIDENCE_DOCUMENTS`, whose subject ids are company ids. So a company's
   public presence does flow back into later answers, and a person's cannot
   until the firewall grants a scope for a person's own understandings.
   This is a packet, and it should be done deliberately rather than
   appended to a long session: the firewall is a Forbidden Shortcut area.
3. **No person trigger.** Only companies start a presence build, so a
   question about a named person has no path even once (2) lands.

---

## D. Model and provider failure

### D1. A long answer is cut off and reported as a failure

**Symptom.** "Break that down into actionable steps" returned "I couldn't
get a full review through just now."

**Fully solved.** An answer longer than the usual allowance is finished, not
truncated. When a ceiling is genuinely reached, the person is told the
answer was shortened, never that the system failed.

**What exists (fixed in this pass).** The ledger gave the cause exactly:
task class `EVIDENCE_SYNTHESIS`, failure `INVALID_MODEL_OUTPUT`, output
tokens 3072 — the ceiling to the token. The JSON never closed, the parse
failed, the failure class sent the request to the next model, which
truncated identically, and the third attempt exhausted the budget.

Two changes:

- The ceiling for `EVIDENCE_SYNTHESIS` and `COMPARISON` is 8,192 and for
  `NORMAL_DIALOGUE` 4,096. Cost stays bounded by the same money budget.
- The gateway now distinguishes _cut off_ from _badly written_: a structured
  parse failure whose finish status is `MAX_OUTPUT_TOKENS` marks the attempt
  truncated, and every later attempt asks the chosen model for its own
  maximum instead of repeating the same ceiling
  (`packages/model-gateway/src/gateway.ts`).

**Verdict: SOLVED** at the mechanism level. Needs one live re-run of the
failing question to confirm end to end.

### D2. Rate limits and provider outages inside a turn

**Fully solved.** A quota or an outage on one provider is invisible to the
person: the next eligible model answers within the same turn.

**What exists.** Fallback and retry classes; a rate-limited candidate is
skipped when another waits; `INVALID_REQUEST` was added to the fallback
classes after Gemini's thought-signature rejection, and Gemini's
`providerState` is echoed on the follow-up.

**Verdict: SOLVED.** Doc 26 lists the quota wall as an external need rather
than a code defect: three Groq quotas, then Gemini.

### D3. Every model fails

**Fully solved.** Q says so plainly in its own voice and re-offers the
current step. It does not emit an error string.

**What exists.** A conductor fallback line.

**Verdict: PARTIAL.** See F1: some of these lines still read as error
messages.

---

## E. Voice turn-taking

### E1. Q keeps talking when the person starts

**Symptom.** "It hears me, but it keeps talking."

**Fully solved.** Speech from the person stops Q within about 300 ms. A
cough, a laugh or a backchannel does not.

**What exists.** A sustained-sound window with level and fraction
thresholds, loosened to 260 ms after a regression I introduced made Q
effectively uninterruptible; `isNonLexical` keeps backchannels from
counting.

**Verdict: SOLVED** for the reported symptom. **PARTIAL** as engineering:
three numeric thresholds tuned by hand against one voice in one room. Doc 26
names the durable answer, a turn-detection model in a LiveKit pipeline with
Krisp noise cancellation, and lists it as not yet built.

### E2. Interruption restarts instead of resuming

**Fully solved.** "Go on" continues from the sentence Q was on; the held
remainder is spoken, never the whole answer again.

**What exists.** Held speech as remainder and answer, `unsaidPartOf`, and
per-binding spoken-sentence memory.

**Verdict: SOLVED.**

### E3. The same answer twice

**Fully solved.** A sentence Q has already spoken in this binding is never
spoken again in the same turn or the next.

**What exists.** Spoken-sentence memory per binding.

**Verdict: SOLVED** for the reported case.

### E4. Mishearing names

**Fully solved.** West African names and the interview vocabulary are
recognised, and a correction is remembered.

**What exists.** Recogniser keyword lists and a pronunciation intent, per
doc 26.

**Verdict: PARTIAL.** Doc 26 is explicit that no published benchmark
predicts our audio and that measurement needs a recorded set of Nigerian,
Ghanaian and Kenyan speakers. Until that set exists this cannot be called
solved, only untested.

---

## F. How failure sounds

### F1. Error messages inside a conversation

**Symptom.** Lines such as "Voice isn't working right now", "That didn't go
through", "I couldn't get a full review through just now".

**Fully solved.** Every line a person can hear or read is written in Q's
voice, says what is true, and offers the next move. No transport name, no
failure class, no "please try again" without a reason.

**What exists.** Several of these lines were rewritten this session.

**Verdict: PARTIAL.**

**Gap.** There is no single inventory of person-facing failure strings, so
there is no way to prove the rule holds. A file that owns every one of them,
with a test asserting no line contains a provider name, a status code or the
word "error", would make this checkable.

### F2. Repeating a question already answered

**Fully solved.** A question answered, skipped or explicitly refused is not
asked again in the same setup.

**What exists.** Conductor step validation, skip handling, tangent counting.

**Verdict: PARTIAL.** Reported and partly fixed; no regression test pins it.

### F3. "I don't know" turning into a completed step

**Symptom.** Told "I don't know", Q reported the mandate as partially
complete.

**Fully solved.** Unknown is recorded as unknown. It never becomes a value,
a zero, or a completed step. This is the PADL invariant, not a nicety.

**What exists.** Unknown is a valid state in the conductor contract.

**Verdict: PARTIAL.** Needs a negative test: answer one step "I don't know"
and assert the stored state is unknown and completion does not advance.

---

## G. Memory, knowledge and the Write Gate

### G1. A fact Q learns must survive and must be governed

**Fully solved.** Nothing a model says becomes a stored fact without passing
the Write Gate: subject, provenance, tenant, scope, truth class, evidence,
temporal, sensitivity, contradiction, confidence. An inference is held for
confirmation, never persisted as fact.

**What exists.** `packages/q-knowledge` implements the full chain; a
non-automatic candidate is held for confirmation rather than written.

**Verdict: SOLVED.**

### G2. Editing the profile must update Q's memory

**Fully solved.** A person edits a stated fact and Q's answer changes in the
same session, through the Write Gate, with the previous value kept as
history.

**Verdict: OPEN.** Raised by the user directly; the edit surface itself is
still thin.

### G3. Refresh of a public profile

**Fully solved.** A profile is refreshed when the world changes, not on a
timer alone.

**What exists.** Time-based refresh only.

**Verdict: PARTIAL.** Acceptable for V1. Worth noting rather than building a
change detector now.

---

## H. Visibility, discovery and the firewall

### H1. A founder who chose to be visible must be findable

**Symptom.** "Even after making a founder visible, when I ask Q as an
investor about it, it still says it doesn't know."

**Fully solved.** A company at `network_visible` appears to any
authenticated participant whose query matches, across tenants, and never
appears to someone outside the platform.

**What exists.** The cause was that candidate generation was scoped to the
caller's tenant, so `network_visible` could never match. The discovery
repository now queries cross-tenant on the visibility column. Investor
visibility has a data model and a migration.

**Verdict: SOLVED.** `network_visible` and `public_external` stay distinct
per ADR-001.

### H2. Founder-private data must never leak into investor-facing output

**Fully solved.** Release-blocking: private facts do not alter ranking,
discoverability or assessment for an investor not authorised to use them.
Enforced at retrieval, at the recommendation feature layer and in the
database, not by hiding UI.

**What exists.** Scope filtering before model invocation; discovery ranking
is deterministic with no model in the path.

**Verdict: PARTIAL.** The mechanism is right. What is missing is the proof
doc 24 asks for: positive, cross-tenant-negative and revoked-grant tests on
the sensitive paths. Until those exist this is asserted, not demonstrated.

### H3. Discovery quality

**Fully solved.** Order is hard eligibility, candidate generation, declared
exclusions, explicit fit, semantic fit, evidence and freshness, exploration,
rank, with versioned weights and cursor paging.

**What exists.** Everything except semantic fit, evidence weighting,
exploration and precomputed slates. Cursor paging is in, and no model runs
in the path.

**Verdict: PARTIAL**, and deliberately so under the delivery constraint.

---

## I. Hardcoding

**Fully solved.** A value that policy, a person or the world can change
lives in data: routing policies, prompt versions, ranking weights, taxonomy
reference data, budgets. A constant in source is either a physical limit or
carries a comment saying why it cannot move.

**What exists.** Prompts are registry entries with content hashes and a lock
file. Routing policies are rows. Taxonomy is reference data. Ranking weights
are versioned config.

**Verdict: PARTIAL.** Known remaining constants, each now carrying its
reason in source: the voice thresholds in E1, the filler threshold in A3,
the per-task budgets in D1, and the environment-notes ceiling.

**Gap.** The budgets are the clearest candidate to move into the model-ops
schema alongside routing policies, since they are the thing most likely to
need changing without a deploy.

---

## J. Appearance and access

**Fully solved.** Light mode is first-class, the person can choose, the
choice survives a reload and is applied before the first paint, and nothing
communicates meaning by colour alone. WCAG 2.2 AA.

**What exists (added in this pass).** `apps/web/src/features/appearance/`:
three choices, stored under one key, applied by an inline pre-paint script
so a dark-mode person never sees a white flash, with pressed state on a
labelled group. The tokens already carried all three states.

**Verdict: SOLVED** for the toggle. Contrast has not been re-measured across
both themes since the tokens changed.

---

## K. What this audit says to do next, in order

1. **A firewall scope for a person's own understandings** (C2, item 2).
   Retrieval now asks for them; nothing authorises them. Until this lands,
   the online and personality profile built at arrival is still research
   performed and thrown away. Highest value per hour of anything on this
   list, and the one item that needs a real packet rather than a patch.
2. **Stream the spoken answer** (A2). The only path to the 3 s target, and
   it retires the filler question permanently.
3. **A promise without a tool call is a defect** (B1). Small, deterministic,
   and it turns the most-reported complaint into something a test catches.
4. **One home for person-facing failure lines, with a test** (F1).
5. **The firewall tests doc 24 requires** (H2). Release-blocking invariants
   should not rest on assertion.
6. **A person trigger for presence** (C2).
7. **Budgets into the model-ops schema** (I).
