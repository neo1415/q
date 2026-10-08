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

## 4. Round 3 (2026-10-08): why Q still sounds like a robot, and the change of approach

### 4.1 Evidence: conversation c10b845f, 2026-10-08 03:22-03:27 UTC

| Person said | Q said | What is wrong |
| --- | --- | --- |
| "Show me the top three companies that are aligned against the mandate." | "I've scored your top 10 companies against your mandate. Halyard Security fits best, at 8.8 out of 10, then Clearwater Assurance at 8.8 out of 10. Pros and cons for each are on screen." | Asked for **three**, heard "10", got **two** names. Seven companies tie at 8.8 and the tie was said as a ranking ("fits best… then"). The repeated "out of 10" and the fixed close are a template heard twice. |
| "Tell me about the third company on the list." | `Opening "Tensorgate".` | A request to **talk about** something answered with a page move. Nothing about Tensorgate was said, though its card (seed, United States, 8.8, stage and sector fit, cheque size unknown) was on screen. |
| "Take me to the explore page." (twice) | "Taking you to Discover." (twice, identically) | Same words every time: no variety. |

Root cause, architectural: on both voice paths the words heard were **composed by code templates** (`fitSweepSummary`, `openingLine`, the navigation table) or by the answer pipeline, and the voice layer only **read them out**. The duplex conduct said "say what it returns, faithfully". The realtime model, which is a conversational model with a persona, was reduced to a text-to-speech engine for template text. Round 2 tuned the templates. That cannot work: a template has one prosody, one wording and no knowledge of what the person actually asked.

### 4.2 What the best voice products do

- **Split the speaking from the thinking.** OpenAI's voice-agent guide: "keep speaking behavior in the live model's prompt and business rules in the backend prompt". The backend returns results to the live model, which voices them, and evals should "verify that spoken confirmations match completed actions" ([OpenAI, Voice agents](https://developers.openai.com/api/docs/guides/voice-agents)). The backend hands over the facts, and the live model chooses the words.
- **Variety is an explicit rule.** Models "closely follow sample phrases", so the guide adds a Variety rule ("do not repeat the same sentence twice") and labels examples "vary, don't always reuse" ([OpenAI Realtime prompting guide](https://developers.openai.com/cookbook/examples/realtime_prompting_guide); [PDF](https://cdn.openai.com/API/docs/realtime-prompting-guide.pdf)). Prompt sections go Role, Personality & Tone, Tools, Conversation Flow.
- **Prosody needs context.** Sesame's "one-to-many problem": "there are countless valid ways to speak a sentence, but only some fit a given setting". Without the conversation, a voice model cannot pick the delivery, and listeners prefer human prosody precisely when context is given ([Sesame, Crossing the uncanny valley of voice](https://www.sesame.com/research/crossing_the_uncanny_valley_of_voice)). Text fed in verbatim takes away the voice model's one advantage, which is knowing what was just said.
- **Write for speech, one idea per utterance.** Hume's EVI guide: "format all responses as spoken words", use discourse markers and interjections ("oh wow", "I mean"), "keep each utterance to one idea", fewer than three sentences of about 20 words, numbers written as they are said, and structured data passed through tools rather than read out ([Hume, Prompting](https://dev.hume.ai/docs/speech-to-speech-evi/guides/prompting)). EVI 3 takes its persona from a prompt ("sound like a wise professor") ([Hume, EVI 3](https://hume.ai/blog/introducing-evi-3)).
- **Discourse markers make speech fluid.** Google's conversation design guidance: markers ("also", "now", "by the way", "actually") preview how the next sentence relates to the last. Without them a prompt "sounds stilted". Acknowledgements ("okay", "sure") are not markers ([Google, Discourse markers](https://developers.google.com/assistant/conversation-design/discourse-markers)).
- **Three items, then the screen.** Jefferson's three-part lists let a listener predict turn completion. Google Assistant speaks the first three items and puts the rest on screen ([Google Design, Rule of three](https://design.google/library/rule-of-three)). Alexa offers options in small batches because "customers don't have much time to listen" ([Alexa design patterns](https://developer.amazon.com/en-US/alexa/alexa-haus/patterns-and-components)). Contact-centre design ends a list with a clear cue for the caller's turn ([Ada, flowing voice conversations](https://docs.ada.cx/en/build-and-maintain-your-bot/create-phone-conversations-with-voice/learn-how-to-build-effective-and-flowing-voice-conversations.html)).
- **Companion apps: brevity plus an open door.** Pi "knows how to be brief" and keeps conversations moving with a follow-up, in a warm and curious register ([CMSWire on Pi](https://www.cmswire.com/digital-experience/pi-the-new-chatbot-from-inflection-ai-brings-empathy-and-emotion-to-conversations); [Maginative](https://www.maginative.com/article/inflection-unveils-pi-a-revolutionary-personal-ai/)). Gemini Live's "affective dialog" adapts style and tone to the user's expression ([Google Cloud, Live API](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/live-api)).
- **Radio and podcast technique.** One idea per sentence, subject and verb close together, contractions, about three words a second, sounding like "one person telling another something important", and the name before the fact ([UBC, Writing for the ear](https://wiki.ubc.ca/Course:LFS400/Workshops/Writing_For_the_Ear); [Media Helping Media](https://mediahelpingmedia.org/how-to/how-to-write-a-radio-news-script)).

### 4.3 Rules for Q's spoken turns (round 3)

1. **Code owns the facts, and the voice owns the words.** `ask_q` returns structured `facts`, a `mustSay` list, an optional `caveat` and `next` step, and a `fallback` sentence. The voice model speaks in its own words.
2. **Count fidelity.** Asked for N, name exactly N (the first N shown). Never say how many were scored when the person asked for a number.
3. **Ties are ties.** Equal scores are said together ("Halyard, Clearwater and Tensorgate are level at 8.8"), never "best… then".
4. **"Tell me about X" is talked about.** Say who they are from the facts (stage, place, score, the strongest reason, the unknown), then mention it is on screen. Never `Opening "X".`
5. **Persona:** a warm, sharp senior analyst colleague. Contractions, a natural discourse marker or acknowledgement where it fits ("Right,", "So,", "Actually,"), varied wording, matching the person's energy, two to four short sentences, and an open door ("want me to go through Tensorgate?").
6. **Numbers said once and as speech:** "8.8", not "8.8 out of 10" repeated.
7. **Banned in speech:** `Opening "…"`, "Taking you to…", "Pros and cons for each are on screen", "fits best, at", "I've scored your top N" when N was not asked, "out of 10" twice in one turn.
8. **Bounded:** at most about 60 words. Standard path: one fast rewrite through the Model Gateway (FAST class, about 1.8 s budget). If it misses the deadline or fails any check, the fact-built fallback is said. That fallback already satisfies rules 2-4.

### 4.4 Checks in code (`q-core` `spokenFidelityIssues`)

`COUNT` (asked N, named N), `MUST_SAY` (every must-say item present), `TIE` (tied names not said as a ranking), `BANNED` (banned phrase list), `LENGTH` (≤ 60 words), `NUMBER` (no number that is not in the facts). The fixtures replay c10b845f in `packages/q-core/test/spoken-facts.test.ts` and `apps/q-api/test/spoken-reply.test.ts`.
