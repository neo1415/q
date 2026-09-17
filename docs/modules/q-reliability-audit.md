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

**Verdict: PARTIAL**, and close. Measured against the running system: a
question needing no lookup is now **one** model call and 3.3 to 4.1 s end
to end, from 6.5 to 8.7 s.

What actually fixed it was the opposite of the first attempt. Splitting
"do you need a tool?" onto a small prompt saved almost nothing, because
what a turn costs is how many calls it makes rather than how large they
are, and it put 1.5 s in front of every question that needed no tool. The
round that may reach for a tool now carries the analyst's own prompt and
writes the answer itself.

The seam now logs where a turn's seconds went. That is how this was
found: a turn measured at 13 s held 3.4 s of model.

**Gap.** The last second is retrieval (0.4 to 0.9 s) plus a single model
call. Below 3 s needs A2.

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

**Verdict: SOLVED.** The first sentence now leaves as soon as it is
written. Measured on voice: first spoken words at 1.2 s.

**How, because the substance is what may safely leave early.** A fragment
has to be three things before a person can have it.

1. **The answer, not the object around it.** The analyst replies with one
   JSON object whose `answer` field is the prose. A scanner reads that
   field out of a document that is still being written, one character at a
   time, reporting nothing a later character could change: a trailing
   backslash might begin an escape, a trailing `\u00` might become an é.
2. **A whole sentence.** The guard that removes an invented ranking claim
   removes a sentence and cannot judge half of one.
3. **Already guarded.** On a voice call the fragment is about to be said
   out loud, and nothing said can be taken back, so the guards run on each
   sentence before it goes.

The last, unfinished sentence is never sent; it arrives with the completed
message, which stays the durable form.

**The rule that made it safe.** Retrying a model and falling back to
another are invisible precisely because nothing has left the building yet.
The gateway therefore stops retrying the moment it has spoken, and Groq
stops rotating keys. In practice that costs little: every failure actually
observed arrived before the first token.

**Gap.** When the model writes its fields in another order, nothing
streams and the answer arrives whole, as before. That is the intended
degradation, not a defect.

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

**Verdict: SOLVED.** 4.5 s was still under the time an answer took, so
every reply began "Hold on, checking" and a transcript read as Q clearing
its throat before every sentence. Now 8 s, above the slowest ordinary
answer. **PARTIAL** as a design: it is a constant tuned against current
latency, and A2 would retire it.

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

**Verdict: SOLVED.** An answer that opens by promising to check something
has that sentence removed before anyone hears it, deterministically
(`stripEmptyPromises` in q-core, tested). An answer is the checking: the
promise is redundant when work was done and untrue when it was not. An
answer that is ONLY a promise is left alone, so the real failure stays
visible rather than becoming silence.

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

**Verdict: SOLVED** for the mechanism, **PARTIAL** until a person's
profile has been read back in a live session.

**Gap, traced end to end.** The read-back is four layers, and
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
2. **No scope reached a person's understandings** — fixed, as a policy
   change. `OWN_PUBLIC_PRESENCE` is a scope of its own: bound to the
   subject the plan named, owner side only, never shared, never labelled
   public or network-visible. Plans are stamped `context-firewall-v2`. A
   golden test proves the owner sees it and a counterparty holding a
   network-visible profile does not.
3. **No person trigger** — fixed. Arrival research now looks up the person
   who arrived as well as the company they named: their own row only, told
   apart from namesakes by that company name, never carrying the company's
   website as their own.

### C3. Refusing what everybody knows

**Symptom.** "I asked who is the president of Nigeria and it still said
checking." Then, after 13 seconds, it said the question fell outside its
authorised context.

**Fully solved.** A question that is not about a Capital Q subject is
answered outright, fast, from what the model knows, labelled as general
knowledge and never offered as evidence about a subject.

**What exists (fixed in this pass).** Every plan had granted
`GENERAL_MODEL_KNOWLEDGE` all along and nothing ever told the model so, so
it read the charter's true rule — general knowledge is never
company-specific evidence — as "never use general knowledge". The
permission is now stated when the firewall has granted it, and the
invariant is untouched.

**Verdict: SOLVED.** Verified live: the question is answered in one model
call, in about 3.3 s.

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

**What exists.** A conductor fallback line, and a deadline of our own on
the voice think route (20 s) so the speech provider's patience never runs
out first. When it did, the person got the provider's failure instead of
ours: the line died and a banner appeared.

**Verdict: SOLVED.**

### D4. The line dies and the person is left reading about it

**Symptom.** "All of a sudden it can't think, all of a sudden voice is not
working, all of a sudden this and that."

**Fully solved.** A failure of the line ends it and picks the person back
up, on the same conversation, without them doing anything. When it cannot
be picked back up, Q says so once and stops.

**What exists.** Three defects, all fixed. A speech-agent error set an
error state and stopped, while a dropped socket healed itself, so a failed
turn stranded the person behind a banner; both now end the session the
same way and both reconnect. Reconnection was one attempt per thirty
seconds with no limit; it is now three tries at widening gaps, reset the
moment a session comes up, then one plain sentence and a stop. And the
think route has its own deadline (D3).

**Verdict: SOLVED** for the mechanism.

**Gap worth naming, because it is most of what was happening.** Voice
bindings are held in memory in the API process and a run is marked "did
not finish" by a sweep that runs at startup. So every restart of that
process kills every live voice session and every in-flight run at once.
In development the process restarts on every rebuild, which is why these
arrive in threes and feel like crashes. The reconnect above now covers it
from the person's side. Bindings surviving a restart is a separate piece
of work and is not done.

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

## F0. Following the conversation

**Symptom.** Q named a company from the discovery slate. Asked "can you
tell me more about it?", it answered that no company had been named. The
person asked whether it has context windows at all.

**Fully solved.** A conversation is one thing. What Q said a moment ago is
available to it, and "it" resolves to whatever is being discussed until
somebody changes the subject.

**What exists (fixed in this pass).** Two causes, both at the seam where
they belong.

History was scoped to the RUN. A voice turn is a run of its own, so the
model was handed the newest sentence and nothing before it: it could not
see what it had itself just said. History is now the conversation's.

Subjects were never carried. A turn that named nothing arrived with an
empty subject list, so the firewall planned a conversation about nothing.
A conversation now keeps its subject until a turn names a different one.
Inherited subjects are re-resolved on every run and dropped silently when
they no longer resolve, so a revoked share ends a subject rather than
failing a question; recording one grants nothing.

**Verdict: SOLVED**, with integration tests for inheritance and for
changing the subject mid-conversation.

---

## F. How failure sounds

### F1. Error messages inside a conversation

**Symptom.** Lines such as "Voice isn't working right now", "That didn't go
through", "I couldn't get a full review through just now".

**Fully solved.** Every line a person can hear or read is written in Q's
voice, says what is true, and offers the next move. No transport name, no
failure class, no "please try again" without a reason.

**What exists.** `plainLineProblems` in q-core states the rule, and a test
scans the fourteen files that hold person-facing wording and applies it.
No line may name a supplier, carry a failure class or an HTTP status, use
our vocabulary rather than the person's, or look like something that
leaked.

The line that prompted it was composed at runtime: the base sentence plus
the speech provider's own failure class in brackets. It is the only
runtime-composed one in the repository, and it is gone.

**Verdict: SOLVED**, and self-enforcing: a new line that breaks the rule
fails a test rather than reaching somebody.

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

**Verdict: SOLVED** for the gate. **One hole found and closed beside it.**
The gate governs whether a candidate may be written; it did not govern
what the candidate could be ABOUT. The model proposed the knowledge keys
`user.request`, `user.message` and `user.statement`, and three rows were
written against a live company whose content was the conversation itself.
The recordable keys are now a closed namespace and a key outside it is
refused before anything is written, which is the discipline the presence
build already had. Rows written before the fix are still there; removing
them is the owner's call, not a migration's.

### G2. Editing the profile must update Q's memory

**Fully solved.** A person edits a stated fact and Q's answer changes in the
same session, through the Write Gate, with the previous value kept as
history.

**Verdict: PARTIAL.** A person can now change their own details by saying
so: their name, their company's name, its website, where it is based, its
description. Read deterministically, read back, and applied only on a yes,
through the platform's own API under their own authority. Only their own:
there is no way to name somebody else's, and the company is resolved from
their session rather than from anything they said. Those fields are
canonical state, so changing them changes what Q answers from.

**Gap.** Five fields, not every field, and no typed edit surface yet.

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

**Verdict: PARTIAL**, and better than the last pass said. The firewall
integration suite already holds the golden cases doc 24 asks for: founder-
private to an investor with no hint, investor-private to a founder,
organisation-private across organisations, relationship-shared to exact
parties only, an unshared and a nonexistent company indistinguishable, a
combination reduced to an aggregate, and expiry and revocation honoured at
evaluation time. The scope added this pass has its own.

**Gap.** Those prove the PLAN. Nothing yet proves the layer below it: that
a retrieval given a plan cannot return a row outside it, against a real
database. That is the test still missing.

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

## L. Arrival: the first minute

### L1. Q meets a stranger it was told about

**Symptom.** Sign-up captured an email and a password, so Q opened every
conversation knowing nothing and spent its first minute asking for things
the person would happily have typed.

**Fully solved.** Sign-up captures a name and, optionally, what the
organisation is called. Q greets somebody by name and does not ask for
what it was already told.

**What exists.** Both fields on the form. The name rides on the account,
because that is the only thing that survives a confirmation email, and the
first authenticated page copies it into the profile through the ordinary
API under the person's own session. The trigger that creates a profile
still reads nothing a person supplied, which is the right rule and is not
weakened here. A name the person has since changed is never overwritten.

**Verdict: SOLVED.**

### L2. The one question of the first minute had nothing to tap

**Symptom.** Whether somebody is raising or investing decides everything
that follows, and it could only be spoken. Somebody in a noisy room, or
who would rather not talk, was stuck on it.

**Fully solved.** Every question that has choices shows them. Where only
the person's own words will do, Q says once that they can type instead.

**What exists.** Two cards on the welcome stage, which disappear the
moment the answer is known. Yes-or-no review steps have cards too. The
labels are what somebody would have said, so a tap and a sentence arrive
as the same answer. The questions that are left are the ones where only
their own words work — a name, a website, a description, a number — and
those now carry an instruction for Q to mention the Type button once,
never on a question that has options.

**Verdict: SOLVED** on the voice stage.

**Gap.** While voice is on, a tapped option is sent as text to the model
rather than through the structured submit path the typed workspace uses.
It works, and it is two paths where one would do.

### L3. Q researches somebody and never mentions it

**Symptom.** "I want it to always try to guess who it is talking to."

**Fully solved.** Once Q has a name and something to tell that name apart
by, it looks the person up, says what it found and where it found it, and
asks whether it has the right person. A no settles it.

**What exists.** The arrival build now runs for the person as well as
their company. What it finds is carried back to the conversation and asked
in the next gap, once, riding along with a reply rather than interrupting.
Saying where it came from is not a courtesy: a system that simply knows
things about somebody is unsettling, and one that names the site and the
profile it read is not.

**Verdict: SOLVED** for the mechanism.

**Gap.** A no is spoken and honoured in the conversation; it does not yet
retract the understandings that were written. Doing that properly is a
correction through the Write Gate, not a delete.

### L4. Reading what somebody has published

**Symptom.** "What kind of posts do I have that may not favour me?"

**Fully solved.** Q can read a person's public posts and comments, subject
to the same namesake filtering and the same gate as everything else, and
answer questions about how they read.

**Verdict: OPEN, and blocked outside the code.** The profile lookup that
exists returns a headline, an about, a location, follower counts and
employment history. Posts and comments are a different dataset with its
own identifier, which is not configured. Nothing here can be guessed at.

---

## N. The second demo: what a founder's session showed

Run against the working system by the person it is for, with a company on
the profile. Everything here was found by that session, not by reading.

### N1. Every question went to the company specialist

**Symptom.** "What's up", "who is the CEO of Paystack", "you can just
search online" — each refused as outside the scope of the company's data.

**Cause.** With a company as the subject, the specialist claimed every
question and answered only from that company's records. None of the
general-knowledge, lookup, research or streaming behaviour lives there.

**Fixed.** The specialist takes only questions that are about the company:
first person, an analysis asked for outright, or a dimension of it.
Anything about somebody else, the outside world, or nothing in particular
goes to the conversational path. The reading is deterministic and says
why. Verified live: small talk is answered and the Paystack question was
researched on the web instead of refused.

### N2. A raise target read as a string of zeros

**Fixed.** Money and grouped numbers are spoken as a person says them:
"200 000 000 NGN" is "200 million naira". The stored figure is untouched.

### N3. "Thinking" for good, and three refused calls a second

**Cause.** A failed session stopped its microphone but not its socket, so
the provider kept thinking against a binding the reconnect had replaced;
and nothing told the browser the server had let its session go.

**Fixed.** The socket is closed with the session. A refused think call
logs why. The turn poll notices a vanished session and ends the line as
dropped, which is what brings it back.

### N4. Five seconds of silence before every reply

**Cause.** The turn-end threshold was 0.8 with the provider's five-second
timeout, so a short utterance ended only when the timeout did.

**Fixed.** 0.7 and three seconds.

### N5. Sixteen seconds for "what's up"

**Cause.** Twelve of them were retrieval, before any model was asked. The
query embedding had only the provider's sixty-second timeout as a limit.

**Fixed.** A two-and-a-half-second budget on the query embedding, past
which retrieval runs lexically and says so; a step-by-step log for any
retrieval over two seconds; and the embedder warmed at startup. Measured
after: about nine seconds end to end on a cold path, which is still more
than it should be and is now attributable.

### N6. The server died

**Cause.** It was a child process of the assistant's own session, and
went down with it. Separately, a ten-second network blip reaching the
secondary speech engine was treated as fatal by the launcher.

**Fixed.** The launcher runs detached in its own window, and the
secondary engine step is a warning.

### N7. The microphone

**Not reproduced.** Nothing spoken in that session reached the server;
everything in the transcript was typed. Scripts can drive the think route
but not a microphone, so this is unverified. The browser now prints one
line every five seconds saying how many audio frames left it and what the
provider last said back, which is enough to tell the three causes apart
next time.

## O. The third demo: an answer, then an apology; and a stack that kept dying

Two reports from the founder's next session, 2026-09-17, each with one
cause.

**O1. Q answered, then said it had hit a snag.** A question about the
company was answered in full, streamed sentence by sentence, and then Q
said "I've hit a snag on my side, ask again". The ledger shows why: the
final structured object was refused by its schema on six citation labels
(`companyFindings.N.citations.0:invalid_format`), a field nobody hears.
The model, having just read PUBLIC WEB SOURCE entries, cited "S1"-style
labels where the schema wants `F<n>`. A refusal after the answer had
already been delivered ended the run as FAILED, and the voice turn spoke
the recovery line for it. Three fixes, each sufficient on its own:

- The gateway keeps an answer whose text was read before its object was
  refused: the prose the reader saw goes through the same guards as any
  answer and is persisted as the message, and the run completes. Only
  the structured extras of that turn are not recorded.
- Citation labels are normalised and the unresolvable ones dropped before
  the schema sees them, which is what the specialist did with them after
  the schema anyway. A stray label now costs a citation, never an answer.
- The voice turn says nothing after a run fails once its answer has been
  spoken; the failure is logged with its code.

**O2. "The api keeps dying, everything keeps dying."** No service crashed.
The Windows event log shows the Claude desktop app updating itself at
10:24:42; the demo log ends at 10:24:42. Both stacks that "died" had been
started from that app's shells and so lived inside its process tree. The
launcher now has a detached start (`scripts/demo-detached.ps1`, through
WMI, outside any caller's job object) and a stop, and the header of
`scripts/demo.mjs` says to run it from a terminal of one's own.

Two further things were found on the way. A packaged (MSIX) application
sees its own AppData: pnpm's shim and corepack's cache installed from
inside the app do not exist at those paths outside it, so the detached
launcher maps them. And turbo's strict environment mode drops any variable
turbo.json does not declare, which silently discarded `pnpm demo --local`'s
overrides; the dev task now passes the environment through.

**O3. One Supabase, not two.** While these were being fixed, `.env.local`
came to name the hosted project for auth while the database and the web
app still named the local stack; every service then failed differently.
The launcher refuses that mix and says which variable is the odd one out.
The direct connection host of the hosted project is IPv6-only and does not
answer from this network; the session pooler does, and `pnpm db:push`
uses whichever of the two connection strings is set. The push itself waits
on a database password the project accepts.

## P. The third transcript: a founder's Home conversation and a new founder's setup

Read from the two transcripts of 2026-09-17, most of it not reported, all
of it visible.

**P1. "The difference between me and Paystack."** Went to the
conversational path, which held the company's scopes but no company facts,
and answered that no records existed. "Me" on one's own company page is
the company: first-person comparisons now route to the specialist.

**P2. "200 nairamillion."** The spoken-figure rule ate the space between
"₦200" and "million". A scale word now travels with its figure.

**P3. Answers that end "Give me a moment to look that up."** A closing
promise is now stripped from the finished answer and held back from the
stream until a sentence follows it.

**P4. Every sentence of the person shown twice.** The transcript line and
the recorded turn differ in punctuation; they are now compared as words.

**P5. "You cannot update Capital Q's records in our conversation."**
Fixed by ADR 0011: the analyst reads a request to change a declared
profile field, quoting the person; the answer seam hands it to the
action proposer; the Approval Engine proposes `company.profile.update`;
the person approves on screen or by saying yes; the companies context
performs the update. Q's own presence findings do not yet flow into the
profile through the same action; that is listed under M.

**P6. The setup.** A website said aloud was recorded letter for letter
("Savage Bridge dot com") and looked up as words; "four" was no number;
"demo" fitted none of the upload step's options and the question came
round three times; "three hundred million dollars" was followed by "what
currency"; a look-up that found nothing was announced in two sentences;
the person was never looked up because the company row did not exist
yet; and a brand-new person was greeted with "Welcome back". Each is
fixed deterministically in the interviewer, the presence trigger, the
voice turn and the welcome page, with tests. An upload control on the
voice stage itself is not built; the person is told where the upload
lives and the step is not asked again.

**P7. Mishearing.** The recogniser is now told the organisation the
person typed at sign-up as a key term; "NEM Salvage" heard as "name
salvage" is the recogniser not knowing the word. The company name from
the interview and the person's own name should follow when a session can
carry them.

**P8. The model.** Dialogue runs on the small Gemini model because the
larger one answered with 503s seventeen times in three hours on the free
tier (migration 20260922). A smarter first choice needs a paid tier.

## M. What this audit says to do next, in order

1. **Prove the retrieval layer, not just the plan** (H2). The firewall's
   goldens prove what a plan permits. Nothing yet proves that a retrieval
   given that plan cannot return a row outside it, against a real
   database. This is the release-blocking invariant and the half still
   resting on assertion.
2. **Voice sessions that survive a restart** (D4). Every restart of the
   API kills every live voice session and marks every in-flight run
   unfinished. Reconnection covers it from the person's side; the sessions
   themselves are still in process memory.
3. **A tapped option and a typed one should take the same path** (L2).
   While voice is on, a tap is sent as text; typed mode submits a
   structured value. Two paths where one would do.
4. **Saying no to a recognition should retract what was written** (L3),
   as a correction through the Write Gate rather than a delete.
5. **Retrieval sometimes takes six seconds** (A1). Usually under one. The
   spike is in the assemble phase and has not been traced.
6. **Semantic fit, evidence weighting, exploration and precomputed
   slates** in Discover (H3).
7. **Per-task budgets as rows rather than constants** (I).
8. **A recorded set of Nigerian, Ghanaian and Kenyan speakers** (E4), so
   the recogniser can be measured rather than hoped about.

Blocked outside the code: the Bright Data dataset for LinkedIn posts and
comments (L4), and the SERP and Unlocker zone names.
