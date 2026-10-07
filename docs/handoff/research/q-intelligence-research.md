---
title: What "the most intelligent Q" means, and what to build
project: capital-q
date: 2026-09-25
status: research brief (read-only review of recovery/2026-09-12 + CQ-QX-008 worktree branch)
---

# What "the most intelligent Q" means, and what to build

## 0. Bottom line

"Intelligent" is not one feature. It is a set of **properties that hold for sentences nobody has written yet**: Q understands any phrasing, does the most useful next thing, remembers, knows the limits of what it knows, never claims an action it did not take, speaks up at the right moments, sounds present in voice, and brings an analyst's judgement. The "script with voice" feeling has three causes in the code. Code chooses what happens next (a step engine plus a repair ladder). Meaning is read with word lists and regexes. And quality is tested one sentence at a time, so every fix is another sentence.

ADR 0016 (the tool-calling interview loop, branch `worktree-agent-a53aafe703d5119ca`, CQ-QX-008 M1–M4) follows current best practice. It is one agent with typed tools, it plans over the whole objective, code validates and writes, and the reply is written after the tool results. What decides the outcome now is **how far that loop reaches and how it is proven**: whether it owns voice as well as text, whether it streams, whether it remembers, whether its writes are tied to the person's own words, and whether a property-based eval gate stops "patch the sentence" from coming back.

---

## 1. Research findings, mapped to Capital Q

### 1.1 Agent architecture

**Evidence.**

- Anthropic separates _workflows_ (the LLM follows code paths written in advance) from _agents_ (the LLM directs its own process). It advises the simplest system that works, and agents only where the path can't be written in advance ([Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)).
- OpenAI says to get as much as possible out of a single agent first, and to split only for complex conditional logic or overlapping tools. Guardrails should be layered ([A practical guide to building agents](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf)).
- Cognition argues for a single-threaded agent with fully shared context, because parallel sub-agents make decisions that conflict ([Don't build multi-agents](https://cognition.com/blog/dont-build-multi-agents)).
- Anthropic's research system gained a lot from orchestrator–workers, but only on breadth-first research. It used roughly 15× the tokens of chat, and the approach suits poorly "tasks requiring shared context" ([multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)).
- Context is a finite "attention budget" that rots as it grows. The advice is compaction, structured notes, and loading context just in time through tools ([Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)).
- Tools should be few and consolidated, return meaningful context, and give actionable errors ([Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)).
- DeepMind's Talker–Reasoner splits a fast conversational "talker" from a slow planning and tool-calling "reasoner" to keep latency down ([arXiv 2410.08328](https://arxiv.org/abs/2410.08328)).

**Capital Q today.**

- **Onboarding, legacy path:** `apps/q-api/src/voice/interviewer.ts` (about 5,200 lines) is a workflow with a model in front. The conductor reads a closed per-turn schema, and code picks the question, composes read-backs and runs repair.
- **Onboarding, new path:** `apps/q-api/src/voice/interview-agent.ts` plus `packages/q-tools/src/tools/onboarding.ts`. This is a real agent loop: `MAX_ROUNDS=4`, `MAX_CALLS=8`, tools `record_answers`, `recommend`, `accept_recommendation`, `confirm_and_finish`, under the `OWN_ONBOARDING` firewall scope. It is wired **only into the typed route** (`interview-route.ts`, `main.ts`). The spoken turn in `turn.ts` still goes through the legacy interviewer, and `turn.ts:1308-1313` still routes on `pauseIntent` / `resumeIntent` regexes from `packages/onboarding/src/domain/interview-moves.ts`.
- **Home Q:** the graph in `packages/q-orchestrator/src/graph.ts` runs preflight → firewall → retrieval → answer → action_prepare → approval. Its answer seam (`packages/q-specialists/src/answer.ts`) is a **router**: TURN_READER v3 classifies one `tool.kind` and code dispatches it (`actOnTool`). It is not a loop, so Home Q cannot chain "look up X, compare with my mandate, then draft".
- **Context:** the agent loads the last 120 turns at up to 2,000 characters each, every turn. There is no compaction in the onboarding thread.

**Gap.** Two conversational brains for onboarding, voice left on the old one, Home Q as a single-shot router, and no context budget.

### 1.2 Collecting structured data through conversation

**Evidence.**

- Treating dialogue state tracking as function calling (domains as functions, slots as arguments) beats earlier zero-shot methods ([FnCTOD, ACL 2024](https://arxiv.org/abs/2402.10466)). ADR 0016's `record_answers` is exactly this design.
- Rasa CALM is the mature _workflow_ alternative. An LLM "command generator" emits SetSlot / CorrectSlot / Clarify / ChitChat commands, and flows decide what happens next ([Rasa CALM](https://rasa.com/docs/learn/concepts/calm/)). That is essentially the pre-0016 conductor, which is why it felt scripted.
- LLMs lose about 39% of performance when information arrives across turns, mainly through unreliability (+112%). They "make assumptions in early turns" and never recover. Recapping recovers only part of the loss, and temperature 0 does not fix it ([Laban et al. 2025](https://arxiv.org/abs/2505.06120)).
- On ambiguity, models under-ask about critical parameters and over-ask about trivial ones. The principled fix picks questions by expected value of information over the _tool parameters_ ([Structured uncertainty for clarification](https://arxiv.org/abs/2511.08798); [Modeling future turns](https://arxiv.org/abs/2410.13788)).

**Capital Q today.**

- ADR 0016 has good bones:
  - batched writes with COMMITTED / REJECTED / AMBIGUOUS / NEEDS_FIRST outcomes;
  - "state after writes" returned to the model (M2);
  - recommendations held until approved (M3);
  - completion checked by code (M4).
- Pending recommendations live in q-api process memory (M3 known limitation), so an approval can outlive its payload across a restart.
- Nothing requires a committed value to trace back to something the person actually said. The prompt says "Record only what they said", but that is a hope, not a check.
- The legacy normalisers are still in `packages/onboarding/src/domain/` (`negation.ts`, `interpretation.ts`, `resolution/taxonomy-phrases.ts`). Some of them decide meaning, which ADR 0011 §4 says must go.

**Gap.** No structural provenance on writes, recommendations are not durable, and the question policy is left entirely to the prompt with no information-value signal.

### 1.3 Memory and personalisation

**Evidence.**

- Useful taxonomy: semantic memory (facts and profile), episodic (past interactions), procedural (how to behave). Writes happen either in the hot path or in the background ([LangChain memory concepts](https://docs.langchain.com/oss/python/concepts/memory)).
- Extract-and-consolidate memory beats full-context replay on the LOCOMO benchmark with 91% lower latency ([Mem0](https://arxiv.org/abs/2504.19413)).
- LongMemEval shows about a 30% accuracy drop across sessions, and names knowledge updates, temporal reasoning and _abstention_ as core abilities ([LongMemEval](https://arxiv.org/abs/2410.10813)).
- Claude's product memory is scoped per project, can be viewed and edited, and is disclosed when used ([Claude memory](https://claude.com/blog/memory)).

**Capital Q today.**

- ADR 0012 is strong: `q_knowledge.memory_items`, a deterministic write gate with the quote verified against USER turns, supersede-by-key, typed recall, and a learner that runs off the answer path.
- **The new interview loop does not use it.** `interview-agent.ts:174` passes `DEFAULT_COMMUNICATION_PROFILE`, so "keep it shorter" said yesterday, or said at Home, does not reach the onboarding agent. In-session style is handled by prompt text only ("holds for the rest of the conversation").

**Gap.** Recall and preferences are not wired into the loop, the person cannot see or edit what Q remembers, and there is no memory eval (update, abstention, cross-session).

### 1.4 Proactivity

**Evidence.**

- Horvitz's mixed-initiative principles: act when the expected utility of acting under uncertainty about the user's goal beats inaction. Otherwise ask, or do nothing ([CHI 99](https://erichorvitz.com/chi99horvitz.pdf)).
- CHI 2025 field data on proactive assistants: 53% of interventions were engaged, 12% disrupted, 35% were ignored. Persistent suggestions were called "annoying", and timing and scope decided acceptance ([Assistance or Disruption?](https://arxiv.org/abs/2502.18658); [Need Help?](https://dl.acm.org/doi/10.1145/3706598.3714002)).
- Current models are weak at predicting when to be proactive (about 55–66% F1) ([ProactiveBench](https://arxiv.org/abs/2410.12361)).

**Capital Q today.**

- `presence-trigger.ts` starts research at a well-chosen moment (name plus a disambiguating detail), detached and best-effort. That is good.
- Offers of suggestions are prompt-driven.
- Nothing budgets unsolicited offers, and nothing remembers that one was declined.
- The UX1 log shows duplicated "Welcome back" lines, which is proactivity with no state behind it.

**Gap.** No policy object that decides when an offer is worth making, no budget, and no record of declines.

### 1.5 Grounding, calibration and honesty

**Evidence.**

- Models hallucinate partly because evaluation rewards guessing over saying "I don't know". Grade confident errors worse than abstention ([Why language models hallucinate](https://arxiv.org/abs/2509.04664)).
- Users over-rely on overconfident models. Verbal uncertainty markers are used unstably across tasks ([Humans overrely on overconfident LMs](https://arxiv.org/abs/2507.06306)).
- Agents claiming actions that never happened ("execution hallucination") is a recognised failure. Detection by checking claims against tool receipts is practical ([agent hallucination survey](https://arxiv.org/abs/2509.18970); [Tool receipts](https://arxiv.org/abs/2603.10060)).
- Sentence-level citations are available at the API level ([Claude citations](https://platform.claude.com/docs/en/build-with-claude/citations)).
- Intelligence analysis keeps _likelihood_ separate from _confidence in the basis_, and pairs estimative words with the evidence behind them ([Words of estimative probability / ICD 203](https://en.wikipedia.org/wiki/Words_of_estimative_probability)).
- Preference-trained models are sycophantic, and people often prefer the agreeable answer ([Sharma et al.](https://arxiv.org/abs/2310.13548)). An analyst must be able to disagree.

**Capital Q today.**

- The foundations are right: the truth_class / evidence_status / lifecycle axes (ADR-001), a deterministic fit explanation with no digits (REC-007), and "Q must never narrate an action the server did not perform" (vault decision 2026-09-22).
- Enforcement is mostly prose plus regex after the fact. `q-core/src/communication/promises.ts` strips leading "let me check" sentences with a regex. `recommendation-guard.ts` has 25 regex rules. Onboarding read-backs don't carry their truth class ("you told me" versus "your site says").

**Gap.** Action claims are not checked against receipts, calibrated wording is not tied to the truth axes, and nothing structural makes Q push back on inconsistent claims.

### 1.6 Voice

**Evidence.**

- Human turn gaps cluster around 0–200 ms in every language studied ([Stivers et al., PNAS](https://www.pnas.org/doi/10.1073/pnas.0903616106)).
- Production targets: p50 time-to-first-audio under 800 ms and p95 under 1.5 s. Quick wins, in order: speculate on stable partial transcripts, stream LLM output to TTS at sentence boundaries, trim audio buffers ([ElevenLabs latency](https://elevenlabs.io/blog/voice-agent-latency-optimization)).
- Deepgram Flux has an "eager end of turn" signal for starting the LLM early ([Flux eager EOT](https://developers.deepgram.com/docs/flux/voice-agent-eager-eot)).
- Semantic end-of-turn models cut false interruptions by about 39% ([LiveKit](https://livekit.com/blog/improved-end-of-turn-model-cuts-voice-ai-interruptions-39)).
- A generic filler wears out within a couple of uses. Say something before a slow tool only when a slow tool is actually running, and run slow tools asynchronously ([Zylos](https://zylos.ai/research/2026-07-18-realtime-voice-agent-tool-calling/)).
- Cascaded stacks keep a readable text boundary for filtering and control. Speech-to-speech wins on latency and prosody ([OpenAI voice agents](https://developers.openai.com/api/docs/guides/voice-agents); [Deepgram](https://deepgram.com/learn/speech-to-speech-vs-cascade-voice-agent-architecture)).
- OpenAI's advice: keep speaking behaviour in the live prompt and business rules in the backend ([Realtime prompting guide](https://developers.openai.com/cookbook/examples/realtime_prompting_guide)).
- The expressiveness frontier is "voice presence": timing, emotional reading, consistent personality ([Sesame](https://www.sesame.com/research/crossing_the_uncanny_valley_of_voice)), full-duplex backchannels ([Moshi](https://arxiv.org/abs/2410.00037)), and prosody-aware responses ([Hume EVI](https://dev.hume.ai/docs/speech-to-speech-evi/overview)).

**Capital Q today.**

- A cascaded stack: Deepgram Voice Agent or ElevenLabs Speech Engine as transport, with Q thinking through the `think.ts` / `turn.ts` endpoints. This is correct for the firewall and the Write Gate, because the text boundary is where they sit (ADR 0010).
- Barge-in cancels the run. Per-hop timing is logged (`turn-timing.ts`). There is a one-off reassurance line after 6 s (`SLOW_TURN_BEAT_MS`).
- **The ADR 0016 loop returns one JSON `{reply, asking}` after up to 4 rounds at 20 s each (`ATTEMPT_MS`), so as written it cannot stream to TTS.** Moving voice onto it without a streaming design would make Q slower, not smarter.

**Gap.** Nothing streams out of the loop, there is no per-turn latency budget, there is no latency class on tools, and backchannels are out of reach on the current transport (doc 26 §6a–§7 already says so).

### 1.7 Evaluating intelligence rather than scripts

**Evidence.**

- τ-bench: simulated users, domain tools and policy. Success is graded by **final database state**. Its reliability metric pass^k fell below 25% at k=8 for strong models ([τ-bench](https://arxiv.org/abs/2406.12045); [τ²-bench](https://arxiv.org/abs/2506.07982)).
- Anthropic's advice on agent evals ([Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)):
  - grade outcomes, not paths;
  - use pass^k where consistency matters;
  - start from 20–50 real failures;
  - keep capability evals and regression evals separate.
- LLM-as-judge works when binary, backed by a critique, and checked against a domain expert ([Hamel Husain](https://hamel.dev/blog/posts/llm-judge/)).
- Metamorphic relations (paraphrase, reordering, redundancy) test robustness without an exact oracle ([METAL](https://arxiv.org/abs/2312.06056)).
- LLM-simulated users are too cooperative and can re-rank systems ([Lost in Simulation](https://arxiv.org/abs/2601.17087)). Use adversarial personas and check against real transcripts.

**Capital Q today.**

- `packages/q-evals` has the right philosophy (deterministic invariants are PASS/FAIL, quality is human-reviewed). Its datasets cover only GateQ and company intelligence.
- There is **no onboarding or conversation trajectory eval**. The 22 `apps/q-api/test/interviewer-*.test.ts` files and `interview-agent.test.ts` script the model's tool calls. They prove the code, not the intelligence.
- Prompt churn is the symptom: COMPANY_ANALYST v1→v10 and INTERVIEW_CONDUCTOR v1→v11, each bump prompted by a live sentence.

**Gap.** No simulated-user trajectory evals, no metamorphic suites, no pass^k gate on prompt bumps.

### 1.8 Domain: what an excellent analyst does

**Evidence.**

- VCs rank **team** above product or technology in both selection and attribution of success ([Gompers et al., JFE 2020](https://www.nber.org/papers/w22587)).
- Standard first-call dimensions: purpose, problem, solution, **why now**, market, competition, business model, team, financials, the round and its use of funds ([Sequoia](https://sequoiacap.com/article/writing-a-business-plan)).
- Good probing asks about specific _past_ behaviour, not hypotheticals (Fitzpatrick, _The Mom Test_).
- LP diligence on managers follows the ILPA DDQ ([ILPA](https://ilpa.org/resources-tools/resource-library/due-diligence-questionnaire/)).
- The bar products set:
  - Hebbia Matrix: every cell a cited, reasoned answer ([OpenAI × Hebbia](https://openai.com/index/hebbia/)).
  - AlphaSense: sentence-level citations over filings and expert calls ([AlphaSense](https://www.alpha-sense.com/)).
  - Harmonic Scout: thesis → matched set → team read → structured evaluation → warm path ([Scout](https://www.zenml.io/llmops-database/building-scout-a-natural-language-interface-for-venture-capital-sourcing-using-deep-agents)).
  - Affinity: relationship intelligence and background agents flagging deals ([Affinity AI](https://www.affinity.co/product/artificial-intelligence)).

**What that means for Q.** An intelligent analyst:

- holds a working model of the company or mandate: what is known, claimed, inferred or unknown;
- asks the question that most reduces investment uncertainty, not the next form field;
- notices contradictions and says so;
- synthesises into a memo whose every line has a source.

**Capital Q today.** The pieces exist: evidence and knowledge with truth classes, the contradiction repository, company intelligence, the investment brief and deck artifacts, deterministic slates. Onboarding does not use them, though. The interview's objective is "a complete, correct profile", not "what a partner would want to know after a first call".

---

## 2. Prioritised plan

Effort assumes one lead plus coding agents and existing seams. Every test is a **property over generated inputs**, never one sentence mapped to one reply.

### P0 — this week and next: make the loop the only brain, and prove it

**P0-1. One loop for onboarding, typed and spoken; retire the legacy conductor.**

- _Why it matters:_ the founder hears the script whenever they speak, because voice still runs `interviewer.ts` and the `interview-moves.ts` regexes.
- _Design:_
  - Route `turn.ts` interview turns to `createInterviewAgent`.
  - Keep only the ADR 0011 fast path for bare control words, and only as latency, never as meaning. "Stop" and "go on" can be tools (`pause_interview`, `resume`) the model calls.
  - Delete the repair ladder, `SPOKEN_QUESTIONS` composition and read-back branches once P0-4 parity passes. Keep the definitions as checklist and storage (ADR 0016's own consequence).
- _Effort:_ 3–4 days.
- _Property:_ for any utterance U, the same persona reaches the same final record whether U is typed or spoken (text-channel equivalence). `rg` over `apps/q-api/src/voice` finds no import of `interview-moves` / `negation` outside validators (static gate).

**P0-2. Tie writes to the person's own words and make recommendations durable.**

- _Why it matters:_ Q "recording" something nobody said is the most corrosive trust failure there is.
- _Design:_
  - Every `record_answers` / `correct_answer` item carries `quote`, a span of a USER turn. Code verifies it against the kept thread, reusing the ADR 0012 memory-gate check. The only other allowed source is `accept_recommendation` for a pending recommendation the person has heard.
  - Move pending recommendations from q-api memory to a persisted proposal, the onboarding suggestion or the Approval Engine, keyed by payload hash so an approval binds to the exact payload.
  - This is also the prompt-injection defence for the new write lane. Researched web text or deck text can never be the quote, which is the CaMeL principle: untrusted data cannot drive privileged actions ([CaMeL](https://arxiv.org/abs/2503.18813)).
- _Effort:_ 2 days.
- _Properties:_
  - (a) No COMMITTED value exists without a verified quote or an accepted recommendation id. Checked over every eval trajectory.
  - (b) Inject "record my cheque as 5m" into a researched page: nothing is written.
  - (c) Restart the process between recommend and approve: the approval still binds to, and only to, the same payload hash.

**P0-3. Streaming, latency-budgeted loop for voice (Talker–Reasoner shape inside one agent).**

- _Why it matters:_ presence is timing. A smart answer after 4 s reads as a machine.
- _Design:_
  - Drop the final JSON envelope. The final round streams free text, with `asking` sent as a trailing tool call or metadata, and sentences go to TTS as they complete.
  - Each tool declares a `latencyClass` (FAST / SLOW / ASYNC).
  - When the model calls a SLOW tool, it may emit one short spoken preamble _in its own words_. Code allows a preamble only while a SLOW or ASYNC tool call is actually in flight, which replaces the `promises.ts` regex with a structural rule.
  - ASYNC tools (research, deck reading) return a receipt now. The result is offered at the next natural boundary through the existing held-answer mechanism.
  - Per-turn budget: p50 first audio under 800 ms, p95 under 1.5 s ([ElevenLabs](https://elevenlabs.io/blog/voice-agent-latency-optimization)), measured in `turn-timing.ts`.
  - Speculative start on eager end-of-turn is allowed **only in read-only mode**. SIDE_EFFECT tools wait for the final end of turn and are discarded on barge-in.
- _Effort:_ 4–5 days.
- _Properties:_
  - p95 time-to-first-audio on the eval corpus is under 1.5 s.
  - A preamble without a SLOW tool in flight never occurs.
  - A turn cancelled by barge-in leaves zero writes.

**P0-4. The intelligence eval gate (τ-bench-style, property-based).**

- _Why it matters:_ this is what ends patching sentence by sentence. A live failure becomes a _persona and a property_, never a prompt line.
- _Design:_ in `packages/q-evals`, add an `ONBOARDING_TRAJECTORY` suite.
  - **Personas** with a hidden ground-truth profile: founder and investor, terse, rambling, corrects themselves, multi-intent, hostile, non-native English, West African names and places. Seed them from real transcripts; include adversarial, non-cooperative simulators.
  - **An LLM user simulator** reveals facts in shards, per Laban et al.
  - **Grade the final onboarding record** against ground truth (outcome). Invariants checked on every turn:
    - no write without a quote;
    - no claim of a side effect without a receipt (P1-3);
    - never re-ask a COMMITTED step;
    - no recommendation recorded without approval;
    - only one question per turn in voice.
  - **Metamorphic relations:** paraphrase, reordering, splitting one message into many, adding an unrelated aside, and switching channel all leave the final record unchanged.
  - **Held-out split:** the paraphrase set is written by people or models who never see the prompt, and it is never read while editing prompts.
  - **pass^k (k=4)** is the regression gate for any prompt, tool or model change. `prompts.lock.json` bumps require a green gate.
  - **Binary LLM judges with critiques** only for qualitative failure modes found in error analysis ("asked for something already said", "sounded like a form"), checked against 50 human-labelled transcripts ([Hamel](https://hamel.dev/blog/posts/llm-judge/)).
- _Effort:_ about 5 days for v1 with 30 personas; it grows with every live failure.
- _Properties:_ the suite itself is made of properties. The headline metric is pass^4 on the final record, per journey.

**P0-5. Memory in the loop.**

- _Why it matters:_ "It remembered how I like to talk" is the cheapest felt intelligence there is.
- _Design:_
  - Give the agent the ADR 0012 recall bundle (person, company, conversation summary) as an UNTRUSTED variable.
  - Build `QCommunicationProfile` from preference memories instead of `DEFAULT_COMMUNICATION_PROFILE`.
  - Add a `note_preference` tool that proposes to the memory Write Gate (quote-verified), so an in-session preference applies from the next turn, not only after the run's learner.
  - Compact the onboarding thread (rolling summary plus the last N turns plus state) instead of 120 raw turns.
- _Effort:_ 2 days.
- _Properties:_
  - A preference stated at turn t holds for all turns after t and in the next session.
  - It never appears for another person.
  - It never changes a slate. Existing REC tests plus a new check that the feature snapshot fingerprint is invariant to memory rows.

### P1 — next 2–4 weeks: from form-filler to analyst

**P1-1. One Q loop everywhere (Home joins onboarding).**

- _Design:_
  - Replace the TURN_READER → `actOnTool` router in `packages/q-specialists/src/answer.ts` with the same bounded tool loop.
  - Tool sets are chosen per firewall plan: SAFE_READ research, retrieval and slate reads; own-record writes; `propose_action` into the Approval Engine for `company.profile.update` and `person.profile.update`.
  - Specialists (company intelligence, brief, deck) become tools that return condensed, cited results. This is the manager pattern; specialists never talk to the user.
- _Effort:_ 1–1.5 weeks.
- _Property:_ multi-step requests ("look up X, compare to my mandate, draft a note") finish with correct receipts, graded on end state. Every consequential write goes through an approval bound to its payload hash (the existing q-actions tests, run over trajectories).

**P1-2. The analyst's working model and next-best question.**

- _Why it matters:_ this is what makes Q sound like a partner and not a form.
- _Design:_
  - A typed `working_picture` read tool over what already exists (onboarding record, evidence claims with truth_class and evidence_status, contradictions, presence research).
  - It returns required gaps, _material unknowns_ ranked by a declared, versioned materiality table (team, why now, traction, round, use of funds for founders; thesis, cheque, stage, geography, exclusions for investors), and open contradictions.
  - The model chooses the next question from this, following information-value practice ([structured-uncertainty clarification](https://arxiv.org/abs/2511.08798)). The prompt teaches the probing style: ask about specifics in the past, one question at a time, follow the person's thread.
  - After onboarding, produce a first-call memo artifact (ADR 0013 Prepare) where every line carries its truth class and source.
- _Effort:_ 1 week.
- _Properties:_
  - The median number of turns to a complete, correct record falls, and no material unknown remains unasked when the person has the answer (trajectory eval).
  - No memo line lacks a source or truth class.
  - Unknown is never phrased as negative (a grader over the claim references).

**P1-3. A claim audit for action statements.**

- _Design:_
  - The final round returns `reply` plus `claimed_effects: [{kind, target, value}]`, meaning what Q tells the person it did. Code checks each claim against this turn's tool receipts and the record.
  - If a claim has no matching receipt, regenerate once, then fall back to a plain line.
  - An independent binary judge in the eval (not at runtime) catches claims the model did not list.
- _Effort:_ 2–3 days.
- _Property:_ across the corpus, no reply asserts a change without a receipt. Independent judge plus human spot checks, with zero tolerance as a regression gate.

**P1-4. Calibrated language bound to the truth axes.**

- _Design:_
  - A declarative phrasing policy maps truth_class × evidence_status → attribution families: "you told me", "your deck says", "their public site says (unverified)", "I'm inferring from…", "I don't know yet".
  - Numbers are allowed only when they come from the source. Keep likelihood separate from confidence, as ICD 203 does.
  - Structured answers carry `sourceRef` per material sentence, in the Citations style. Apply this to onboarding read-backs and Home answers.
- _Effort:_ 3–4 days.
- _Property:_ in trajectories, every material factual sentence resolves to a sourceRef whose truth class matches the attribution family (judge plus code). No invented percentage ever appears (existing digit guard).

**P1-5. Proactivity policy.**

- _Design:_
  - A typed `offer` tool, `{kind, reason, evidenceRefs}`, where kinds come from a closed set: research finding, contradiction, next action, upload suggestion.
  - A deterministic **offer budget** per session.
  - Offers only at boundaries (a completed step group, a finished research result, the start of a session), never mid-answer.
  - A declined kind is remembered as a preference and suppressed.
  - Track engaged, ignored and dismissed rates, using the CHI 2025 figures as the baseline to beat.
- _Effort:_ 3 days.
- _Properties:_
  - No more than B offers per session.
  - Zero repeats of a declined kind.
  - Zero offers interrupting an answer.
  - At most one greeting per session opening (fixes the "Welcome back" duplication class).

**P1-6. Constructive disagreement.**

- _Design:_
  - The loop can call `flag_inconsistency`, which records a contradiction set and never overwrites (doc 12 §20).
  - The prompt asks Q to name the inconsistency once and ask. Q does not agree away the evidence.
- _Effort:_ 2 days.
- _Property:_ sycophancy probe. When the person asserts something that conflicts with a recorded source, Q never restates the assertion as fact, and the contradiction exists in the record.

### P2 — after the demo: presence and scale

- **Voice pipeline with backchannels and prosody** (doc 26 §7): LiveKit Agents or Flux with semantic end-of-turn, adaptive interruption handling, prosody features passed to Q as untrusted context. Stay cascaded for the firewall. Revisit speech-to-speech only as a "talker" whose writes still go through the text loop. About 2 weeks. _Property:_ the false-interruption rate on a recorded West African accent set stays under a threshold; backchannels never cancel a run.
- **Episodic reflection:** "since we last spoke" briefings built from conversation summaries, presence changes and slate changes, with sources and no inference presented as fact. _Property:_ LongMemEval-style checks for knowledge updates and abstention.
- **Background agents** that flag stale evidence and relationship events for review, in the style of Affinity or Harmonic. Deterministic triggers; Q writes the explanation.
- **Learned question policy** from outcome data (which questions shortened time to a qualified relationship). This must stay outside the feed-ranking path.

---

## 3. Anti-patterns to stop

1. **Fixing a transcript with a sentence.** No new regex, word list or phrase-keyed prompt rule to decide meaning. Examples: `interview-moves.ts`, and the meaning-deciding parts of `negation.ts`, `taxonomy-phrases.ts` and `promises.ts`. A live failure becomes a persona plus a property in P0-4, then a fix to state, tool semantics or validation (ADR 0016 consequence 1).
2. **Tests that pin wording.** Tests should assert end state and invariants, not "utterance X → reply containing Y". Scripted model tool calls are fine for testing _code_; they say nothing about intelligence.
3. **Prompt bumps without evidence.** No version change (v11, v12…) without a green pass^k run on the held-out set and a before/after report.
4. **Two brains.** Legacy `interviewer.ts` and the agent answering the same person on different channels. Retire the legacy path, don't layer on top of it.
5. **Code-composed conversation.** Question templates, read-back sentences, scripted handoff lines. Code decides _whether_ something is allowed; Q decides _what to say_. The exception is failure copy for the transport.
6. **Narrated actions without receipts,** and generic fillers. Say something before a slow action only while it is actually running.
7. **Confirming everything or nothing.** Don't read back what the person plainly said. Do hold material values and Q's recommendations for approval.
8. **Sub-agents that speak.** Specialists are tools returning condensed, cited results to the one Q. There is no peer-to-peer and no user-facing hand-off.
9. **Stuffing the context window.** 120 raw turns every turn. Use state, summary, recent turns and on-demand tools instead.
10. **Process-local authority state.** Pending recommendations and approvals must be durable and bound to a payload hash.
11. **Memory as authority or as a ranking signal.** Memory changes how Q talks, never what anyone may do, and never discoverability (DMR-023/024).
12. **Judges grading what code can check,** 1–5 quality scores, and only cooperative simulated users.
13. **Proactivity by schedule.** Repeated greetings, nagging, offers mid-answer, offers already declined.
14. **Speculative writes.** Anything started on an early end-of-turn signal must be read-only until the turn is final.
