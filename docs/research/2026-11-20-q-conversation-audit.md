# Q conversation audit: the code against the human-Q playbook

**Date:** 20 November 2026
**Kind:** read-only audit. Nothing was edited, built, deployed or run against a provider. Prompt texts were read from the built `@capital-q/q-core` dist (`COMPANY_ANALYST_V37`, `TURN_READER_V94`, `Q_SYSTEM_V2`, `Q_SYSTEM_VOICE_V3`, `SPOKEN_REPLY_V1`, `TURN_SKIM_V11`) and checked against their `src` files.
**Inputs:**

- `docs/research/2026-11-20-human-q-conversation.md` (the playbook);
- `docs/ai-handoff/audits/2026-11-20-launch-readiness.md`;
- `docs/ai-handoff/audits/2026-11-20-cost-pass.md`.

**Binding rules applied:** root `CLAUDE.md`, in particular one Q, the Context Firewall, evidence before opinion, no invented confidence, trust over engagement, and no model judging what code can assert.

---

## 0. The headline correction: typed answers already stream

The playbook (§1 idea 1, §9.6, build plan item 1) says that typed answers arrive "essentially all at once (7 deltas)". That comes from the 12 Nov baseline ledger, one research turn. The code on this tree streams typed answers **sentence by sentence, through the guards, end to end**:

| Layer                                 | Evidence                                                                                                                                                                                                                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Provider                              | `packages/model-gateway/src/providers/openai.ts:466-496`: `stream: true` whenever the caller passes `onTextDelta`.                                                                                                                                                                               |
| Answer seam                           | `packages/model-gateway/src/q/index.ts:10537` `onTextDelta` → `partial.push` (the `answer` string read out of the JSON as it arrives) → `cutter.push` (`createSentenceCutter`, `packages/q-core/src/communication/sentences.ts:36`) → `takeSentence` (`index.ts:10405`) → `publish` → delta bus. |
| Guards (per sentence, before publish) | `index.ts:10405-10493`: GateQ labels, `guardSentence`, screen claims, artifact claims, caveat cap, document denials, **claim check** (`index.ts:10447`, `claims.sentence`), promise check, held promises and held asks.                                                                          |
| Bus and wire                          | `packages/q-runtime/src/application/stream.ts:32,369` (`q.message.delta`, ephemeral, bounded); `apps/q-api/src/http/q-events.ts` (SSE, backpressure drops deltas only).                                                                                                                          |
| Client                                | `packages/api-client/src/q-stream-reducer.ts:130` builds `partial`; `apps/web/src/features/q/conversation.ts:520-540` renders it as a streaming Q turn; `apps/web/src/features/q/markdown.tsx:573` renders half-written links safely.                                                            |

So the hard part the owner asked about, a claim check that runs incrementally so that no unverified number shows, **already exists at sentence granularity**. The stale comment at `apps/q-api/src/main.ts:1302` ("No provider streams today, so the bus carries nothing in production") should be corrected so the next worker doesn't rebuild it.

**Where the 6.6 s p50 to first content actually goes** (launch-readiness audit; 12 Nov stage table): run setup and firewall (~1.1 s), then the turn reading (`TURN_READER_V94`: a **72 KB** prompt, about 18k tokens, with a 2.5 s same-model hedge, `turn-reader.ts:369`, and a 4 s first-attempt cut, `turn-reader.ts:380`), then prefetch reads and tools, then the answer call's prefill (32.5k tokens on average, 35–39% cached) and any reasoning. The first answer word cannot appear before the model's first token, and that token waits for the full reading on every typed turn. Voice already starts a speculative answer beside the reading (`packages/q-specialists/src/answer.ts:7743`, gated on the skim); **typed turns never do**.

So the text-latency problem is the **pre-answer critical path**, not the stream. The humanness problem is mostly **shape and rules**: the reader already classifies the work (`answerKind`), but that classification only picks the task class and reasoning level (`index.ts:1521`, `1559`). It never picks how the answer is shaped.

---

## 1. Current state, gap, change and risk for each playbook idea

| #   | Playbook idea                                    | Current state (evidence)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Gap                                                                                                                                                                                                                                                                                                                                                                                       | Concrete change                                                                                                                                                                                                                                                        | Risk and guard                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Timing: first words ≤1 s (text), ≤600 ms (voice) | Sentence streaming exists (§0). Text first content is p50 6.6 s and p95 15.1 s. Holding lines exist only for public-web research (`index.ts:9093-9104`, `10214-10235`, `researchLead` in `early-lead.ts:197`). Voice is p50 2.3 s and p95 15.5 s; every non-small-talk spoken turn is routed to the Q brain (`apps/q-api/src/voice/live/prompt.ts` `VOICE_ONLY_SILENCE`), with a generic holding line after 3 s (`live/broker.ts:659-667`).                                                                                                                                      | Typed turns wait for the full reader before the answer call starts. There is no honest first line on record or tool turns. No metric covers the browser's first answer word ("Not measured" in the launch audit).                                                                                                                                                                         | Slice 1: fold a shape plan into the skim, let typed CHAT and LOOKUP turns start under the skim-gated speculation that voice already uses, give a stage-specific first line at ≤1 s, and add a `q_first_answer_word_ms` metric.                                         | Speculation runs only reads (`speculation.ts`); it is adopted only if the full reading agrees, else dropped unseen. Guard: the existing adoption tests plus a new typed-turn adoption test. The first line uses only approved stage labels (CLAUDE.md: no internal names).                                                               |
| 2   | Being heard: reflect before asking               | No reflection rule in any prompt. `COMPANY_ANALYST` says "Answer what they asked, first, in one or two sentences" (v20, `tasks/company-analyst.v20.ts:29`). That is right for lookups, but there's nothing for substantive disclosures.                                                                                                                                                                                                                                                                                                                                          | A founder who says "we lost our lead investor" gets an answer, not a reflection.                                                                                                                                                                                                                                                                                                          | A shape rule (Slice 1) plus a prompt rule (Slice 2): on DISCOVERY, ADVICE and SUPPORT shapes, one specific reflection in the user's own words, then one question or the answer.                                                                                        | Reflections can drift into restating as fact. Guard: a reflection paraphrases only _their_ words, and the claim check still applies (any figure in it must be in the conversation).                                                                                                                                                      |
| 3   | One question per turn                            | Conflicting rules. `COMPANY_ANALYST_V37` (rendered line 10; source `tasks/company-analyst.v2.ts:50`, `v18.ts:36`, `v30.ts:45`) says "clarifyingQuestions: at most three questions that would change the answer". The same prompt (line 54; `v32.ts:53`) says "one specific question". `Q_SYSTEM_V1` (`charter/q-system.v1.ts:50`) says "ask one or a few high-value questions". Code holds the model's ask when code closes with its own offer (`index.ts:10483-10490`).                                                                                                         | The model gets two contradicting instructions. No code counts questions in the published answer.                                                                                                                                                                                                                                                                                          | Slice 2: one question at most, everywhere; `clarifyingQuestions` max 1 in the schema (a new analyst version); a deterministic `STACKED_QUESTIONS` check in `naturalRegisterIssues`.                                                                                    | Under-asking can push the model into guessing (playbook §6.1: models already under-clarify). Guard: the CLARIFY shape (Slice 1) makes asking explicit when a wrong guess is costly; q-iq `AMBIGUITY` cases must stay green.                                                                                                              |
| 4   | Past behaviour over opinion (discovery)          | Nothing. "Discovery" in code means company discovery (`DISCOVER_COMPANIES`). There's no vague-user detection: the reader's kinds (`TURN_ANSWER_KINDS`, `q-core/src/prompts/schemas/turn-reader.ts:1193`) have no "underspecified" signal.                                                                                                                                                                                                                                                                                                                                        | A vague "show me deals" goes straight to a fit list. No discovery protocol.                                                                                                                                                                                                                                                                                                               | Slice 5: an `underspecified` reader field, a DISCOVERY shape and a deterministic conversation mode in `q-core/src/conversation/state.ts` (OPEN, DISCOVER, TASK, REVIEW, NEXT, SUPPORT, CLOSE).                                                                         | Discovery can become an interrogation, or delay a user who wanted a list. Guard: "just show me" exits; a cap of about 12 questions (playbook §9.3); a skipped answer is recorded as unknown, never "no".                                                                                                                                 |
| 5   | Reflect more than question                       | As idea 2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | No reflection-to-question ratio is tracked.                                                                                                                                                                                                                                                                                                                                               | Slice 6 eval: a deterministic proxy (a sentence that restates the user's last turn's content words before any "?").                                                                                                                                                    | A proxy, not truth. Report it as a trend; never gate a release on it alone.                                                                                                                                                                                                                                                              |
| 6   | Warmth without sycophancy                        | Strong bans exist: `Q_SYSTEM_V1:41` ("no 'Certainly!', no 'Great question'"), `COMPANY_ANALYST` line 52, the code lint `REFLEX_OPENER` and `FILLER_PHRASE` (`q-core/src/communication/natural-register.ts:91-104`). Code's own copy breaks it: `voice/quick-acknowledgement.ts:20` "Great, I've saved"; `live/broker.ts:665` "Sure, on it." (its own lint bans an opening "Sure"). There's no false-premise or "agree with me" eval.                                                                                                                                             | No sycophancy eval. The lint runs only in tests (`natural-conversation-eval.test.ts`), not on production answers.                                                                                                                                                                                                                                                                         | Slice 2: fix the two code strings. Slice 6: a sycophancy and directness set in `packages/q-evals` (false premises, inflated valuations, "just agree with me"), graded by code where it can be (the figure not repeated, a contradiction named).                        | None to accuracy. A paid run of the set needs the owner's approval (DECISIONS 68).                                                                                                                                                                                                                                                       |
| 7   | Memory: paraphrased, relevant, visible           | The write gate is deterministic (`q-knowledge/src/memory/service.ts`: "A model never chooses the owner, the tenant, the status…"). Recall is per person per tenant (`service.ts:233` `personOwner`). Q's readings are labelled apart from "They said" (`render.ts`). The prompt says "never recite memory unprompted" (`COMPANY_ANALYST_V37` line 22). Q readings carry up to 200 characters of quoted words (`render.ts:51` `QUOTE_SHOWN_MAX`). There's a memory API (`apps/q-api/src/http/memory.ts:56`).                                                                      | No callbacks at all, so Q feels as if it forgets. When a callback does happen, nothing stops a word-for-word quote. A visible "what Q remembers" page was not located in this audit (verify).                                                                                                                                                                                             | Slice 7: at most one callback per turn, only of `fact`, `preference` or `correction` items the person said (never a `Q_READING`), paraphrased, tied to this turn; a code check rejects a callback that copies 8 or more consecutive words.                             | Cross-scope leakage. Guard: callbacks draw only from the memory bundle already rendered for this run (already firewalled per person and tenant). Add negative tests: a founder-private item never reaches an investor-side run, and another tenant's memory never appears. A callback is "told, not verified" (line 22 already says so). |
| 8   | Proactivity: one next step at natural breaks     | Every analyst answer may end with an offer: "Then, at most, one short offer of a next step" (`tasks/company-analyst.v20.ts:29`). Voice says "then stop or offer more ('want the detail?')" (`charter/q-system-voice.v3.ts:19`). `SPOKEN_REPLY_V1` says "End with an open door when next is given" (`tasks/spoken-reply.v1.ts:30`). Code adds `closingLines` (`q-specialists/src/answer.ts:10702-10706`). Uncertainty offers are deterministic and material-only (`model-gateway/src/q/uncertainty.ts`).                                                                          | "At most one" offer on _every_ turn is still chatbait (playbook anti-pattern 2). Nothing decides whether this turn is a natural break.                                                                                                                                                                                                                                                    | Slice 3: code decides `offerAllowed` from the shape and mode (REVIEW or NEXT only, or a material uncertainty). Otherwise the prompt says "end when the content ends", and code drops a trailing model offer (extending the existing held-ask logic, `index.ts:10483`). | Fewer offers can mean fewer useful next steps. Guard: the offer engine still runs at natural breaks; measure the share of accepted offers, never offers shown.                                                                                                                                                                           |
| 9   | Voice is a different medium                      | Good coverage: lists aren't read aloud (`Q_SYSTEM_VOICE_V3:18`, `live/prompt.ts` `STYLE_LISTS`); the analyst has a `spoken` field of 3 sentences at most (v36); the lint has `TOO_LONG_TO_SAY` (60 words) and `LIST_READ_ALOUD`; the line doesn't speak as a relay (`live/prompt.ts` `SELF_NOT_RELAY`, owner 19 Nov). Gaps: `semantic_vad` eagerness is only `auto` or `high` (`model-gateway/src/realtime/openai.ts:110-113`, `web/.../duplex-line.ts:1306-1308`), never `low`. The holding line is generic and comes at 3 s. Idle close is at 3 minutes (`live/config.ts:59`). | There's no patient mode for onboarding or discovery, and no specific preamble. The re-introduction fix covers a dropped-and-reconnected duplex line (`duplex-line.ts:1015`) and onboarding resumes (`live/prompt.ts:50`). The 10 Nov "replaced line" case (a new line replacing an open one, `live/broker.ts:1452`) is fixed per HANDOFF-LOG:2245 but unproven live (BASELINE-LEDGER:66). | Slice 4 (see §2.7).                                                                                                                                                                                                                                                    | `low` eagerness lengthens every turn's gap. Guard: only in the DISCOVER and SUPPORT modes and the onboarding interview. Measure the false-interruption rate against the response gap.                                                                                                                                                    |
| 10  | Measure feel-human, not time spent               | A stage clock exists (`model-gateway/src/q/stage-clock.ts`); first text and table times are logged (`index.ts` `firstTextMs`, `tableFirstMs`). The launch audit's "Not measured" includes the browser's first word. There's no questions-per-turn or chatbait rate.                                                                                                                                                                                                                                                                                                              | Most of the §9.5 metrics are absent.                                                                                                                                                                                                                                                                                                                                                      | Slice 6: log the lint's issue _kinds_ per answer (never the words), and add first-word, response-gap and barge-in histograms.                                                                                                                                          | Logging must never hold content (the claim check already logs kinds only, `index.ts` `logUngrounded`). DECISIONS 65: no transcript sampling without consent.                                                                                                                                                                             |

---

## 2. The eight specific questions

### 2.1 Streaming: the safe design (mostly built; finish it)

**Today:** sentence-level streaming, with every sentence through the claim check and the promise, screen, artifact and GateQ guards before it is published (§0). Voice speaks the same guarded sentences. Findings stream as `q.finding.available`, with a count check (`index.ts:10033-10066`).

**The residual holes, and how to close each one without letting an unverified figure show:**

1. **Tables and lists.** The cutter ends a "sentence" on a terminator or a paragraph break. One markdown table row, or a list item without a full stop, may sit in the buffer until a blank line, or may cross the claim check as one large unit. Change: treat each table row and each list line as its own unit (it closes on `\n` once the line starts with `|`, `- ` or `1. `). Check each row like a sentence. A row whose figure is ungrounded has that cell replaced by an empty "not known" cell, which matches the prompt's own rule ("an empty cell is not known"). Never drop a whole row silently. Test: extend `packages/model-gateway/test/q-answer-streaming.test.ts` and `claim-check.test.ts`.
2. **Set-wide checks run at completion.** Contradiction pairing, cross-finding counts and status talk can still remove or rewrite a sentence after it streamed. The completed message replaces the partial (`q-stream-reducer.ts:130`; `conversation.ts:520`), so the screen text can visibly change. Change: count a **retraction** whenever a streamed sentence is absent from the stored answer, log it by kind, and target 0 retractions involving figures. Where a set-wide check can be decided per sentence (the document-denial guard already is), move it into `takeSentence`. Never weaken a completion check to cut retractions.
3. **The last sentence on tool turns** waits for the completed message (`index.ts:10518-10533`). That is correct: a tool round's "Checking now." is replaced. Keep it.
4. **Granularity.** Don't go below a sentence. The cutter's own note (`sentences.ts`) is the reason: half a sentence cannot be judged, and a cut too early splits "$1.5m". Sentence granularity already gives the "first words about a second after the model starts" feel. The real gap is **when** the model starts (§2.2).
5. **Transport.** SSE is in place and resumable (`http/q-events.ts`, `http/sse.ts`); there's also a WebSocket receiver (`http/ws-receiver.ts`). No new transport is needed.
6. **Fix the stale comment** at `apps/q-api/src/main.ts:1300-1303`.

### 2.2 Answer planning: a cheap plan inside the existing readers

**Today:**

- The reader returns `answerKind` (CHAT, LOOKUP, FOLLOW_UP, ANALYSIS, COMPARISON, DOCUMENT) and `parts` for compound asks (`turn-reader.ts:1193-1227` in q-core schemas).
- Code uses that classification for the task class (`index.ts:1521`), the reasoning level (`index.ts:1559`) and the answer path (`model-gateway/src/q/answer-path.ts`).
- The analyst then chooses its own `responseShape` (CONCISE or ANALYTICAL) **after the fact**, inside its JSON (`COMPANY_ANALYST_V37` lines 10, 61). Nothing tells it which template to follow.

**Design: `AnswerPlan`, decided by code.** No new model call.

- **Reader fields.** Add two booleans to `TURN_SKIM` v12 and `TURN_READER` v95, read by meaning:
  - `underspecified`: the goal or subject is unclear;
  - `costlyIfWrong`: a wrong guess would waste real work or mislead (playbook §6.2).
- **Plan function.** A pure function in `packages/q-core/src/conversation/answer-plan.ts` maps (skim or reader kind, `answerKind`, `questionKind`, the two booleans, conversation mode, modality) to one of the shapes below.
- **Template.** Each shape's template is versioned config (`ANSWER_SHAPES_V1`), not prompt prose scattered across versions. Code renders the chosen template into `turnNotes`, which sits in THIS TURN, after the cached prefix (`V37_RULES_END_BEFORE`), so the cache prefix is untouched.

| Shape         | Chosen when                                                                 | Template the analyst is told                                                                                                                                                                                                                                                                                                                                                                                                 | Max length      |
| ------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| SOCIAL        | `answerKind` CHAT, or `turnKind` SMALL_TALK                                 | Warm, specific, one or two sentences, no offer. (Small talk already has its own fast prompt: `model-gateway/src/q/small-talk.ts`.)                                                                                                                                                                                                                                                                                           | 40 words        |
| QUICK         | LOOKUP, or FOLLOW_UP after a quick answer                                   | The answer in the first sentence; one reason or source clause; evidence class if it isn't verified ("their own figure; no document yet"); no headings, no offer.                                                                                                                                                                                                                                                             | 80 words        |
| CLARIFY       | `underspecified` and `costlyIfWrong`                                        | One specific question that splits the options, in their words, optionally after a one-line reflection. Nothing else.                                                                                                                                                                                                                                                                                                         | 35 words        |
| ASSUME_AND_DO | `underspecified` and not `costlyIfWrong`                                    | The assumption in one clause ("Taking that as last quarter —"), then the matching template.                                                                                                                                                                                                                                                                                                                                  | as matched      |
| ANALYSIS      | ANALYSIS, or `questionKind` in `ANALYTICAL_QUESTIONS`                       | A one-line human opener tied to their ask (never "Great question"); the bottom line first; 2–4 short `##` sub-sections drawn from the ask's `parts` or the evidence on hand (e.g. "What the record shows", "What's claimed, not shown", "Risks", "What would change my view"); each point names its company and evidence class; then the conclusion, then **one** follow-up question **or** one CTA, only if `offerAllowed`. | about 350 words |
| COMPARISON    | COMPARISON, or a comparison code resolved                                   | Code's table and verdict first (already, `compare-answer.ts`); the words give what separates them; no table in prose.                                                                                                                                                                                                                                                                                                        | 150 words       |
| ADVICE        | ANALYSIS with `questionKind` ADVICE, or "what should I do"                  | The recommendation first (already, line 10), then 2–3 reasons (evidence versus inference), the biggest risk, numbered steps when it's a how-to, and one next step.                                                                                                                                                                                                                                                           | 250 words       |
| DISCOVERY     | `underspecified` and the goal is unclear, or the mode is DISCOVER (Slice 5) | One reflection, then one past-specific open question (playbook §9.2). No list yet.                                                                                                                                                                                                                                                                                                                                           | 50 words        |
| DOCUMENT      | DOCUMENT                                                                    | Unchanged (the artifact path).                                                                                                                                                                                                                                                                                                                                                                                               | n/a             |

**Why this is fast:**

- The skim (`model-gateway/src/q/turn-skim.ts`; a prompt of about 1.5k tokens, p99 2.4 s, cut at 3 s, `turn-skim.ts:41`) already lands before the full reader (p50 about 3.1 s). Adding two booleans and nothing else costs a few output tokens.
- With the plan known at the skim, the **typed** answer can start under the same speculation gate voice already uses (`answer.ts:7725-7760`) for QUICK and SOCIAL shapes with skim `OTHER`. The full reader still lands and must agree, or the speculation is dropped unseen (`speculation.ts`: nothing is shown, stored or acted on before adoption).
- Analysis shapes keep the full path, but get an honest first line at ≤1 s: the approved stage label of the first read actually started (`Q_VISIBLE_STAGE_LABELS`), plus the subject's name only when code resolved it from the run's authorised subjects. It's sent as `holding: true`, so it never enters the stored answer.

**Accuracy and intelligence guards:**

- The plan sets form, never what may be read. Authorisation, the firewall plan and tool offers are unchanged.
- A shape never lowers the reasoning level: `ANSWER_REASONING_V1` stays keyed by `answerKind`.
- Analysis length is a ceiling, not a floor. The analyst keeps `insufficientEvidence` and says unknowns plainly.
- If the skim and reader disagree on shape, the reader wins. A speculative QUICK answer to a turn the reader calls ANALYSIS is dropped, never adopted.
- q-iq (all 12 categories) must not regress. A new `answer-plan.test.ts` covers the mapping table above exhaustively (it's pure).

### 2.3 Conversation rules in the prompts: violations quoted

| Rule                            | Where the prompts break it today                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One question per turn           | `COMPANY_ANALYST_V37` line 10: "clarifyingQuestions: at most three questions that would change the answer". `Q_SYSTEM_V1:50`: "ask one or a few high-value questions". (The same analyst prompt, line 54, says "one specific question": the two contradict each other.)                                                                                                                                       |
| No chatbait                     | `company-analyst.v20.ts:29`: "Then, at most, one short offer of a next step" (on every answer). `q-system-voice.v3.ts:19`: "then stop or offer more ('want the detail?')". `spoken-reply.v1.ts:30`: "End with an open door … ('want me to go through Tensorgate?')".                                                                                                                                          |
| No relay phrasing               | Fixed for the live line (`live/prompt.ts` `SELF_NOT_RELAY`). `q-system-voice.v3.ts:20` models "I've reached out to…" as first-person phrasing. That is a done-claim; the promise check catches it at runtime (`index.ts` `promised.sentence`), but the example teaches the wrong habit.                                                                                                                       |
| No sycophantic or reflex opener | The prompts are good. Code strings break it: `voice/quick-acknowledgement.ts:20` "Great, I've saved"; `live/broker.ts:665` "Sure, on it."; `SPOKEN_REPLY_V1` line 13 suggests "Good one," as a reaction.                                                                                                                                                                                                      |
| Reflect, then ask               | Absent everywhere.                                                                                                                                                                                                                                                                                                                                                                                            |
| Three items at most when spoken | Covered (`Q_SYSTEM_VOICE_V3:18`, `STYLE_LISTS`, `SPOKEN_REPLY` `mustSay` names however many it is given). Gap: `mustSay` can carry more than 3 names; cap it at 3 in code, with "the rest are on screen".                                                                                                                                                                                                     |
| Uncertainty by evidence class   | Present in substance (`COMPANY_ANALYST_V37` line 4: "a USER_CLAIM is what someone stated"; line 48: "Unknown is said plainly once"). Missing: the _spoken form_ of each class ("that's their own figure; I haven't seen a document for it"). Add one line per class to the shape templates, so it reads as one clear statement and not a hedge in each clause. No percentages (line 17 already forbids them). |
| Variety                         | `SPOKEN_REPLY_V1` line 14 and `live/prompt.ts` `STYLE` ("Vary how you open a reply"). There's no text-side variety rule and no transcript-level repeated-opener check.                                                                                                                                                                                                                                        |

### 2.4 Discovery mode

There is nothing for vague users today (§1 row 4). Build it on the existing pure conversation reducer (`packages/q-core/src/conversation/state.ts:90`, already holding `asked`, `clarification`, `resumeTopic`), not as a new subsystem:

- **Mode.** Add a `mode` field: OPEN, DISCOVER, TASK, REVIEW, NEXT, SUPPORT, CLOSE. It's decided by code from reader signals (`underspecified`, `answerKind`, a turn that only accepts an offer, a result delivered), never chosen by the model.
- **Gap model.** Reuse what exists: the founder and investor onboarding coverage profiles, and the mandate's own fields marked known, unknown or stale on the existing truth and lifecycle axes. Rank the next question by materiality, then unlock value, then whether it follows up on their last turn, then whether it asks about the past rather than a hypothetical, with a penalty for anything already asked (playbook §9.3).
- **Exit.** On a confirmed need (a correctable hypothesis the user accepts), on "just show me" (sensible defaults), or after 12 questions (summarise and offer a default).
- **Commit.** Any "go find them and draft notes" goes through the existing Prepare → Recommend → Approval path.

### 2.5 Memory callbacks

See §1 row 7. The data path is already safe:

- the deterministic write gate;
- the per-person, per-tenant owner (`service.ts:233`);
- the "told, not verified" labelling;
- Q readings kept apart from what the person said.

What's missing is a _permitted, bounded_ callback. Code chooses at most one candidate memory item relevant to this turn's subjects or `parts`, renders it as "CALLBACK (optional, paraphrase, one clause)" in `turnNotes`, and a post-check rejects a callback that copies 8 or more consecutive words from the stored quote. The source must be `fact`, `preference` or `correction` said by the person, never a `Q_READING`. Preferences are acted on silently (playbook §5.2 rule 7); that's already the case ("Honour a preference … unasked", line 22).

### 2.6 Proactivity

See §1 row 8. Code sets `offerAllowed` only:

- in the REVIEW or NEXT modes (a list, analysis or document just delivered, or a task finished);
- or for a material uncertainty, through the existing deterministic route in `uncertainty.ts`.

On QUICK, SOCIAL, FOLLOW_UP and CLARIFY, code holds and drops a trailing model offer, using the same mechanism as `heldAsk` (`index.ts:10483-10490`). The daily briefing stays opt-in (DECISIONS 64).

### 2.7 Voice

| Item                | State                                                                                                                                                                                                                                                                                           | Change                                                                                                                                                                                                                                                                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VAD and eagerness   | `semantic_vad`; `auto` when listening, `high` otherwise (`realtime/openai.ts:110-113`, `duplex-line.ts:1306-1308`). Barge-in is confirmed by the browser (`interrupt_response: false`). Deepgram end-of-turn: NORMAL 0.85 and 4 s, PATIENT 0.9 and 5 s (`voice/providers/deepgram.ts:103-107`). | Add a `LOW` level used in the onboarding interview, the DISCOVER mode and SUPPORT; Deepgram PATIENT on the same modes. Pass the mode on `session.update`.                                                                                                                                                                                                        |
| First-audio latency | p50 2.3 s, p95 15.5 s. Every non-small-talk turn goes through the Q brain. Voice speculation exists (skim-gated).                                                                                                                                                                               | Slice 1's plan makes more turns QUICK and speculation-eligible. Use the `spoken` field (v36) as the voice's first sentence source so the voice starts on the first guarded sentence, not the full answer (verify against `voice/turn.ts:1455`).                                                                                                                  |
| Preambles           | A generic rotating line after 3 s of a WORKING stage (`live/broker.ts:659-667`); the owner complained about "Working on it." spam on 18 Nov.                                                                                                                                                    | At ≤1 s, but only when a tool or research stage has actually started, say a specific line built from the approved stage label and the code-resolved subject ("Reading Halyard's deck."). Keep the 3 s generic line as the fallback, remove "Sure, on it.", and never hold twice in a row (already a rule).                                                       |
| Re-introduction     | Duplex reconnect handled (`duplex-line.ts:1015`); onboarding resume handled (`live/prompt.ts:50`). The replaced-line fix is deployed but unproven live (BASELINE-LEDGER:66).                                                                                                                    | A deterministic guard: when the person has Q turns in the last N minutes, a line's opening sentence matching a self-introduction (`\bI'm Q\b`, "I work with founders…") is dropped from the stream, and a resume line from conversation state is used instead ("We were on Halyard's runway."). Test `welcome.ts:74`'s greeting path with a prior-turns fixture. |
| Idle close          | 3 minutes (`live/config.ts:59`); the cost pass found 20 of 173 billed minutes were trailing silence.                                                                                                                                                                                            | Owner decision (cost-pass item 1). A "still there?" at 60 s, then a clean goodbye at 90 s. Not in a slice without the owner's word.                                                                                                                                                                                                                              |

### 2.8 Evaluation: what already guards accuracy, and what to add

**Existing guards (all must stay green on every slice):**

- `packages/q-evals` **q-iq**: 12 categories, including UNKNOWN, CONTRADICTIONS, NUMBERS, AMBIGUITY, ADVERSARIAL and DISCOVERY. Graded by code (`graders/q-iq.ts`: invented figures, missing figures, unknown said, clarified). This is the accuracy and intelligence regression net. The runner is `packages/q-evals/src/runner/q-iq.ts`, through `cli.ts run`. Scripted or fake runs cost nothing; a live-model run needs approval.
- `packages/model-gateway/test/natural-conversation-eval.test.ts` (32 cases): first person, names, cards, one disclaimer, banned phrases, spoken length.
- `q-answer-streaming.test.ts`, `openai-streamed-text.test.ts`, `claim-check*.test.ts`, `q-answer-claims.test.ts`, `q-screen-claims.test.ts`, `q-artifact-claims.test.ts`, `change-status-claims.test.ts`, `voice-self-not-relay.test.ts`, `realtime-voice.test.ts`.

**New evals, deterministic first:**

1. **Humanness lint**: extend `naturalRegisterIssues` (`q-core/src/communication/natural-register.ts`) with:
   - `RELAY_PHRASE` ("I'll ask", "pass that on", "let me check with", "the investor would like");
   - `CHATBAIT_ENDING` (a final sentence starting "Want me to", "If you'd like", "Shall I", "Would you like", allowed only when `offerAllowed`);
   - `STACKED_QUESTIONS` (more than one "?" outside quotes or code);
   - `ANY_ELSE` ("anything else");
   - `GENERIC_EMPATHY` ("I understand how you feel");
   - `SELF_REINTRO` (after the first turn);
   - `REPEATED_OPENER` (the same first three words as the last Q turn).

   Run it in tests and **log its issue kinds per production answer**, never the words.

2. **Answer-shape tests** (`answer-plan.test.ts`): the pure mapping; then seam tests through `createModelGatewayQAnswer` with scripted model output, asserting that the template reached `turnNotes`, the word ceiling holds, the question count is ≤1, the offer appears only when allowed, and ANALYSIS has the bottom line first and sub-sections.
3. **Latency budgets** with an injected clock and a fake provider: the first holding or stage line ≤1,000 ms after accept; speculation adopted for QUICK; no stream before guards. Production histograms:
   - `q_first_answer_word_ms` (the first non-holding delta) and the browser mark;
   - voice end-of-speech to first audio;
   - barge-in stop.

   Targets from the playbook: text ≤1 s for the first line and p50 ≤3 s for the first answer word on QUICK; voice p50 ≤600 ms and p95 ≤1.2 s on simple turns.

4. **Stream fidelity**: a retraction counter (§2.1 item 2); a test that a table row with an invented figure streams as a not-known cell.
5. **Sycophancy and directness set** (`packages/q-evals/src/datasets/sycophancy/`): false premise, inflated valuation, "just agree", sad framing. Graded by code: the false figure isn't repeated as fact, a contradiction is named, no praise opener. A paid run needs the owner's approval (DECISIONS 68).
6. **Discovery scripts**: a vague founder and a vague investor; ≤1 question a turn; a need named within 12 turns; "just show me" exits; a skipped answer is unknown.
7. **Memory scope negatives**: cross-tenant; founder-private in an investor run; a `Q_READING` never called back; a verbatim callback rejected.

---

## 3. Ranked slices (one worker each, 1–2 days)

Order: **speed and humanness first, guarded by the accuracy evals at every step.** Each slice is code and tests on the integration branch, then a local gate and a deploy per `START-HERE.md`. A prompt version bump is a new versioned file (immutable history). No migration is needed in Slices 1–6 except where noted.

### Slice 1: Answer plan plus fast first words (streaming finish)

- **Files:**
  - `packages/q-core/src/prompts/schemas/turn-skim.ts` (v12: `underspecified`, `costlyIfWrong`);
  - `packages/q-core/src/prompts/tasks/turn-skim.v12.ts`;
  - `packages/q-core/src/prompts/schemas/turn-reader.ts` and `tasks/turn-reader.v95.ts` (the same two booleans);
  - new `packages/q-core/src/conversation/answer-plan.ts` (`ANSWER_SHAPES_V1` and `answerPlanOf`);
  - `packages/model-gateway/src/q/turn-skim.ts`, `turn-reader.ts` (parse);
  - `packages/q-specialists/src/answer.ts` (`speculate` at `:7743` extended to typed QUICK and SOCIAL with skim `OTHER`; render the plan into `turnNotes`);
  - `packages/model-gateway/src/q/index.ts` (stage-specific first line at ≤1 s for the ANALYSIS, COMPARISON and ADVICE shapes, `holding: true`; the `q_first_answer_word_ms` metric beside `firstTextMs`);
  - `apps/q-api/src/main.ts:1300` (correct the comment).
- **Tests:**
  - new `packages/q-core/test/answer-plan.test.ts`;
  - extend `packages/model-gateway/test/q-answer-streaming.test.ts` (first line before the reader lands; plan in `turnNotes`);
  - a typed speculation adoption and cancellation test beside the voice one in `packages/q-specialists/test`;
  - skim and reader schema tests;
  - q-iq scripted run with no regression.
- **Risk:** a wrong skim shape (guard: the reader must agree before adoption, else the speculation is dropped unseen); extra provider calls from cancelled speculations (guard: skim-gated as voice; log the cancel rate, budget ≤10% of typed turns); the first line must claim nothing (approved stage labels only, holding, never stored).
- **Expected gain:**
  - first visible words ≤1 s on every non-trivial typed turn (from p50 6.6 s);
  - first _answer_ words on QUICK and SOCIAL about 2.5–3.5 s (skim plus first token), from 6.6 s;
  - analysis answers shaped by the question (bottom line first, sub-sections, one follow-up).
- **Cost:** the skim already runs; plus speculative calls on QUICK only.

### Slice 2: Conversation rules and the humanness lint

- **Files:**
  - `packages/q-core/src/prompts/tasks/company-analyst.v38.ts` (one question; reflect-then-ask on substantive turns; no unconditional offer; uncertainty phrasing by truth class; variety rule; keep `sharedInstructions` and `rulesEndBefore` so the cache prefix moves once);
  - `packages/q-core/src/prompts/schemas/company-analyst.ts` (`clarifyingQuestions` max 1, as a new schema version);
  - `charter/q-system.v3.ts` (replace "one or a few high-value questions");
  - `charter/q-system-voice.v4.ts` (drop "offer more ('want the detail?')" and "I've reached out to…");
  - `tasks/spoken-reply.v2.ts` (open door only when `offerAllowed`; cap `mustSay` at 3);
  - `apps/q-api/src/voice/quick-acknowledgement.ts:20`;
  - `apps/q-api/src/voice/live/broker.ts:665`;
  - `packages/q-core/src/communication/natural-register.ts` (the new issue kinds);
  - an answer-seam log of issue kinds.
- **Tests:**
  - `natural-conversation-eval.test.ts` (new kinds);
  - `voice-self-not-relay.test.ts`;
  - prompt registry and cache-prefix tests (as for v37, `claim-sources-template.test.ts`);
  - q-iq AMBIGUITY and UNKNOWN scripted.
- **Risk:** under-clarifying (the CLARIFY shape from Slice 1 compensates); prompt-cache churn (one move, measured with `cached_input_tokens`).
- **Expected gain:** removes the most visible robotic tells (stacked questions, chatbait, reflex openers). Banned-phrase hits should reach 0 on fixtures and be measured in production.

### Slice 3: Next-step gate (proactivity at natural breaks)

- **Files:**
  - `packages/q-core/src/conversation/state.ts` (the REVIEW and NEXT signals: result delivered, task done);
  - `answer-plan.ts` (`offerAllowed`);
  - `packages/model-gateway/src/q/index.ts` (extend the `heldAsk` logic at `:10483` to drop a trailing model offer when it isn't allowed);
  - `packages/q-specialists/src/answer.ts:10702` (`closingLines` only when allowed).
- **Tests:** seam tests (an offer kept after a delivered list, dropped after a lookup); natural-conversation `CHATBAIT_ENDING` at 0; the existing uncertainty offer tests unchanged.
- **Risk:** losing a useful next step. Guard: material uncertainties keep their deterministic offer; measure accepted offers.
- **Expected gain:** chatbait rate from roughly every analyst answer to ≤10% of turns (the playbook target).

### Slice 4: Voice turn-taking, preambles and resume

- **Files:**
  - `packages/model-gateway/src/realtime/openai.ts:110` and `apps/web/src/features/voice/provider/duplex-line.ts:1306` (a LOW eagerness level by mode);
  - `apps/q-api/src/voice/providers/deepgram.ts:103` (PATIENT by mode);
  - `apps/q-api/src/voice/live/broker.ts:652-680` (a specific stage preamble at ≤1 s when a WORKING stage started; the generic line stays the 3 s fallback);
  - `apps/q-api/src/voice/welcome.ts`, `live/prompt.ts` (resume line from conversation state);
  - a self-introduction stream guard in `index.ts` `takeSentence` when prior Q turns exist.
- **Tests:** `realtime-voice.test.ts`; the live broker holding tests; a new replaced-line resume test; `SELF_REINTRO` lint.
- **Risk:** slower turns in patient mode (only in DISCOVER, SUPPORT and onboarding); preamble spam (only on a real tool stage, never twice in a row). Live proof needs a real voice session; the sandbox has no UDP (BASELINE-LEDGER).
- **Expected gain:** dead air before tool turns from 3 s to ≤1 s with a specific line; fewer false interruptions in onboarding; the re-introduction defect closed with a test.

### Slice 5: Discovery mode and the conversation-mode controller

- **Files:**
  - `packages/q-core/src/conversation/state.ts` (`mode`, deterministic transitions);
  - new `packages/q-core/src/conversation/discovery.ts` (the gap model over onboarding coverage and mandate fields; question ranking; 12-question cap);
  - the DISCOVERY template in `answer-plan.ts`;
  - `packages/q-specialists/src/answer.ts` (wire the mode; "just show me" exit).
- **Tests:** `state` reducer tests; new `packages/q-evals/src/datasets/discovery-conversation/` scripted cases for a vague founder and a vague investor, graded by code (≤1 question a turn, need named, exit works, skipped answer is unknown).
- **Risk:** delaying users who wanted results. Guards: the exit phrase, the cap, and entry only on `underspecified`.
- **Expected gain:** vague users get one grounding question instead of a guessed list. Target: ≥70% of discovery sessions end with a need the user confirms.

### Slice 6: Stream fidelity and the evaluation harness

- **Files:**
  - `packages/q-core/src/communication/sentences.ts` (table-row and list-line units);
  - `packages/model-gateway/src/q/index.ts` (per-row claim check; a not-known cell; the retraction counter);
  - `packages/q-evals/src/datasets/sycophancy/` and a grader;
  - latency-budget tests with an injected clock;
  - a production histogram for voice barge-in stop.
- **Tests:** `q-answer-streaming.test.ts` (rows); `claim-check.test.ts`; the new sycophancy set (scripted locally; a paid run only with approval).
- **Risk:** a row cut too early. Guard: a row closes only on a newline, and the existing conservative sentence rule otherwise.
- **Expected gain:** no invented figure in a streamed table cell; visible retractions measured, with a target of 0 for figures; a humanness regression net.

### Slice 7: Memory callbacks v1

- **Files:**
  - `packages/q-knowledge/src/memory/render.ts` (mark callback-eligible items: person-said `fact`, `preference` or `correction` only);
  - the answer seam (one candidate in `turnNotes`);
  - a post-check for word-for-word overlap of 8 or more words;
  - verify, or build, a visible "What Q remembers" page over `apps/q-api/src/http/memory.ts`.
- **Tests:** cross-tenant and founder-private negatives; `Q_READING` never called back; a verbatim callback dropped.
- **Risk:** privacy. Guard: only items already in this run's firewalled memory bundle.
- **Expected gain:** perceived continuity without the privacy cost.

### Slice 8: Reader diet and cache (latency tail)

- **Files:**
  - `packages/q-core/src/prompts/tasks/turn-reader.v96.ts` (move the 72 KB prompt's fixed head into shared instructions as v37 did; an explicit cache breakpoint per cost-pass item 2, after one approved paid check);
  - `packages/model-gateway/src/providers/openai.ts` (`toInput` breakpoint).
- **Tests:** reader schema tests; q-nav and q-iq scripted.
- **Risk:** reader quality. Guard: q-nav held-out sets.
- **Expected gain:** a shorter reader tail (p95), which is the floor of every full-path turn.

---

## 4. What this audit did not verify

- No live turn was run, so the shares of QUICK versus ANALYSIS turns, and the speculation-adoption rate a typed turn would get, are estimates.
- The "What Q remembers" web page was not located; only the API was found.
- Whether `voice/turn.ts` speaks the first guarded sentence or waits for `spoken`: it consumes `q.message.delta` at `:1455`, but the exact handoff was not traced.
- Prompt texts were read from `packages/q-core/dist`. If dist is stale against `src`, the cited version numbers still hold (v37 and v94 are the ACTIVE versions in both), but rendered line numbers may shift.
