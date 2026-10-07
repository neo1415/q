---
title: Natural conversation for Q (voice and typed)
date: 2026-10-07
trigger: founder (Zino) live conversation d54a7441, 2026-10-07 20:23-20:27 UTC
---

# Natural conversation for Q

The founder's verdict on his last call: "The conversation is not natural... it feels like it's just
guessing... is this how you would talk to another human being?" This note sets out what natural
conversation is, what the leading voice agents do, what went wrong on that call, and the spec Q now
follows.

## 1. What went wrong (evidence)

| Symptom the founder named                                                                                     | What the record shows                                                                                                                                                                                                                                                             | Root cause                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Opener quoted a raw goal: `I did 4 things for "Please set this up as a standing instruction for me: "Reply…"` | `narrationOf` put `goal_text` into the line in quotes, cut at 60 characters                                                                                                                                                                                                       | Q read back internal text instead of saying what it did                                                                                                                                                                                                   |
| "Capital Q records that you have expressed interest… The record confirms interest, but not whether…"          | Run 84feb8a3                                                                                                                                                                                                                                                                      | The prompt taught a third-person "voices" register ("Capital Q records") and an over-hedging habit. No style rule asked for first person or for answering first.                                                                                          |
| List with scores: pros and cons with **no company names**, and no cards                                       | Run 1d4f4c27: `dropped: ["answerCards.cards.0.reasons:invalid_type"]` and `recommendation claims removed: 7`                                                                                                                                                                      | (1) One malformed card field caused the whole card set to be dropped. (2) `fit.profile` tells the model to say "7.5/10 · Good fit", but the recommendation guard deletes every sentence containing "N/10", and the company names were in those sentences. |
| "Q would like to know…" card while Q was answering something else                                             | Run 1d4f4c27 emitted `CLARIFICATION_REQUEST` beside a full answer                                                                                                                                                                                                                 | Every `clarifyingQuestions` entry became a card, even when the question had been answered                                                                                                                                                                 |
| 20-40 s turns                                                                                                 | voice turn timed: 22 s, 38.5 s and 20.6 s. Final model rounds took 10.4+7.7 s, 2.8+2.0+5.6+23.5 s and 2.0+15.9 s. `fit.profile` ×8 ran one after another. The "answer not produced / CANCELLED" lines are the voice speculation being cancelled (reason RESEARCH), not a failure. | Large structured outputs, serial tool rounds and serial reads. On the duplex line nothing is heard until the whole ask_q returns.                                                                                                                         |
| Nothing hummed or said while it worked                                                                        | 7 narration long-polls, each held its full 12 s with no beats                                                                                                                                                                                                                     | `timedVoiceTurns` wrapped the speaker without forwarding `narrate`, so the silence ladder yielded its stage line into the answer text (firstTextMs ≈ 1.8 s), the ladder stopped at its first yield, and the line stayed silent until ask_q returned       |
| "The voice just cuts (not a dropped connection)"                                                              | Line stats: worstLossPct 77.8, weakSeconds 4, rejoins 0. The spoken cap could cut mid-word: `bounded(rest, room)` with a small room returned a fragment.                                                                                                                          | Network bursts (not ours to fix). A spoken-cap cut mid-sentence. Instant barge-in on any VAD start, so a cough, echo or noise blip cut Q.                                                                                                                 |
| "Sure, got it" where it should not be said                                                                    | BACKCHANNEL instructions allowed "okay"/"got it" mid-turn                                                                                                                                                                                                                         | Acceptance tokens used as continuers                                                                                                                                                                                                                      |

## 2. What the research says

### Turn-taking and timing

- Turns are allocated locally, one speaker at a time, and transitions cluster at transition-relevance
  places (Sacks, Schegloff & Jefferson, 1974,
  [Language 50(4)](https://doi.org/10.2307/412243)).
- Across ten languages people avoid overlap and minimise silence. Mean gaps sit within about 250 ms of a
  shared cross-language mean, which is roughly 200 ms (Stivers et al., 2009,
  [PNAS 106(26)](https://doi.org/10.1073/pnas.0903616106)). A long silence after a question is heard as
  trouble or as a dispreferred answer coming.
- Practical latency budget for voice agents: about 500-800 ms from end of turn to first audio is
  "natural". Above about 1.5 s it needs a filler, and past about 4 s it needs a progress update
  ([LiveKit end-of-turn](https://livekit.com/blog/solving-end-of-turn-detection);
  [Voice-Light, arXiv 2609.20995](https://arxiv.org/pdf/2609.20995): about 650 ms mean end-of-turn
  latency at an 800 ms cap).

### Adjacency pairs, answer-first, preference

- A question makes an answer conditionally relevant. Anything else (a counter-question, a hedge, a
  caveat) is heard as **not answering** (Schegloff, 2007, _Sequence Organization in Interaction_, CUP).
  Asking back "Q would like to know…" in place of the answer is exactly an inserted counter-question
  without a reason.
- A preferred response is fast and direct. A dispreferred one is delayed, prefaced and accounted for.
  Q's hedged "the record confirms interest, but not whether…" packages a _preferred_ answer in
  dispreferred form, which is why it "feels like guessing".

### Grounding and backchannels

- Conversation advances only on mutually accepted contributions, through acknowledgements,
  continuers and next relevant turns (Clark & Brennan, 1991,
  ["Grounding in communication"](https://doi.org/10.1037/10096-006)).
- Continuers ("mm-hm", "yeah") pass the floor back and claim no understanding. Acceptance tokens ("got
  it", "okay", "sure") claim understanding and **commitment** (Schegloff, 1982; Yngve, 1970). Said
  mid-turn, "got it" claims something not yet heard. Said to a question, "sure" agrees to something
  never proposed. That is the founder's "sure, got it to things that should not be said".
- The best acknowledgement is usually the next relevant action, which is the answer itself.

### Repair

- Self-repair is preferred over other-repair, and repair is initiated narrowly ("which Kenya
  companies?" rather than "could you clarify?") (Schegloff, Jefferson & Sacks, 1977,
  [Language 53(2)](https://doi.org/10.2307/413107)). Ask back only when you genuinely cannot answer,
  and make the question specific.

### Grice and recipient design

- Quantity: as informative as required, no more. Quality: no hedging beyond the evidence. Relation:
  answer the question asked. Manner: brief and orderly (Grice, 1975, "Logic and conversation").
- Recipient design: talk is built for this listener (Sacks et al., 1974). An investor who asked
  "which companies have you reached out to?" gets names, in first person, from the one who did the
  reaching out.
- Communication accommodation: converge on the partner's energy, formality and length (Giles, Coupland
  & Coupland, 1991). This is vibe-matching: a short casual question gets a short casual answer.

### Spoken versus written register

- Speech uses short clauses, contractions, coordination over subordination, and no visual structure
  (Biber, 1988, _Variation across Speech and Writing_; Chafe, 1982). A list read aloud is a wall. Say
  the gist and the count, name the top two or three, and put the rest on screen.

### Leading voice agents

- **OpenAI Realtime** ([prompting guide](https://developers.openai.com/cookbook/examples/realtime_prompting_guide),
  [VAD guide](https://developers.openai.com/api/docs/guides/realtime-vad)) recommends short bullet
  instructions, explicit variety rules so sample phrases do not repeat, explicit handling of unclear
  audio (ask to repeat; never guess), short preambles before slow tools, and semantic VAD for end of turn.
- **Sesame, "voice presence"** ([research](https://sesame.com/research)) names four parts: emotional
  intelligence; conversational dynamics (timing, pauses, interruptions); contextual awareness (tone
  fits the moment); and a consistent personality.
- **Hume EVI** ([interruption config](https://dev.hume.ai/docs/speech-to-speech-evi/configuration/interruption))
  uses prosody-aware end-of-turn detection and a `min_interruption_ms` threshold (default 800 ms), so
  brief sounds do not cut the agent off.
- **LiveKit / Pipecat** ([LiveKit turns](https://docs.livekit.io/agents/build/turn-detection);
  [Pipecat strategies](https://docs.pipecat.ai/server/utilities/turn-management/user-turn-strategies))
  keep semantic end-of-turn separate from interruption detection, run VAD for barge-in with a
  minimum duration, and use fillers or "thinking" sounds for slow tool calls.

### Executive-assistant and analyst style

- BLUF (bottom line up front): the answer, then the reason, then the next step.
- Own the work in first person ("I've reached out to…", "I'd start with Portside").
- One caveat, only when it changes a decision. Uncertainty is stated once, not sprinkled.

## 3. Spec for Q

### 3.1 Spoken style guide (voice and typed answers)

1. **Answer first** in one or two sentences, in first person. Then up to two supporting sentences.
2. **Names in every item.** A list never says "Pros: …" without the name it belongs to.
3. **Lists, scores, comparisons:** the cards carry the detail. Say the gist ("Eight of them. Portside
   and Souqsheet fit best. They're on screen.") and offer more.
4. **Contractions, short sentences, plain words**, as said aloud.
5. **Caveat once, briefly, only when it matters.**
6. **Mirror the person's register:** brief for brief, casual for casual, detailed only when asked.
7. **Acknowledge only when it fits:** after an instruction is complete ("Done."), never as a reflex,
   never "sure/got it" to a question.
8. **Never quote internal text:** goals, tool names, ids, field names or system notes.

### 3.2 Banned patterns (checked in code, `q-core` `naturalRegisterIssues`)

"Capital Q records…", "The record confirms…", "the records show", "According to Capital Q", "As an
AI", "Great question", "Certainly!", a turn opening with "Sure," or "Got it", "I hope this helps",
"Pros:/Cons:" without a name, raw quoted goals, tool or field names.

### 3.3 Turn policy

- Q never takes the floor from a real speaker, and never yields it to a blip. A barge-in counts only
  after about 450 ms of continuous speech (Hume's default is 800 ms; a shorter value fits an analyst
  call). A shorter blip ducks Q's volume, then restores it.
- Ask back only when Q genuinely cannot answer, and then in voice, with one specific question. Never
  as a card beside an answer.
- After a question to the person, stop.

### 3.4 Latency targets

| Moment                                                        | Target                                         |
| ------------------------------------------------------------- | ---------------------------------------------- |
| End of turn to first sound (tone or acknowledgement)          | ≤ 0.7 s                                        |
| First words (a stage line from the real stage, or the answer) | ≤ 1.5-2 s                                      |
| Progress line on a slow answer                                | every 4-6 s, at most 3, then a hum             |
| Simple answer, first answer words                             | < 2-3 s                                        |
| Analytical answer                                             | < 8 s typical. The cards come with the answer. |

### 3.5 Eval rubric (deterministic, `packages/model-gateway/test/natural-conversation-eval.test.ts`)

For each founder question replayed as a fixture:

1. First person: no "Capital Q records", and an "I/I've/I'd/my" or "you/your" frame.
2. Names present: every company in the cards is named, and no orphan "Pros:/Cons:".
3. Cards present on list, score or compare questions (`ANSWER_CARDS` with fit where computed).
4. No banned phrases.
5. Spoken length ≤ 60 words when cards carry the detail.
6. No `CLARIFICATION_REQUEST` block beside a substantive answer.
7. Opener contains no quoted goal text.

Probabilistic quality (warmth, wit) stays with human review and LLM evals. These checks are code.
