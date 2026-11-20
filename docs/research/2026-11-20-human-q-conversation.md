# Making Q feel human: a research playbook for conversation, discovery and voice

**Date:** 20 November 2026
**Question from the owner:** "People don't know what they want, Q should help them get it. Memory and context is one thing, but it being human is another thing."
**Scope:** how a brilliant, warm human draws people out, finds what they actually need, keeps things moving and takes the lead at the right moment, and how to build that into Q by text and voice. It draws on both human research and AI product research.

**How to read the evidence tags:**

- **[Strong]** means peer-reviewed and replicated, or a large dataset.
- **[Moderate]** means one good study, or a consistent practitioner consensus.
- **[Vendor]** means a company's own docs or claims, not independently checked.
- **[Anecdote]** means expert craft wisdom or press reports.

Numbers in brackets point to Section 11.

**One framing line, stated once:** Capital Q's rule is trust over engagement. Below, "keep the conversation going" always means **momentum toward the user's goal**, never time spent. Everything else in this document follows from that.

---

## 1. Executive summary: the 10 ideas that matter most

1. **Timing is the first signal of humanity.**
   - Humans switch turns in about 200 ms, in every language studied [1][4].
   - From about 700 ms, a silence starts to _mean_ something: hesitation, a "no" coming [5][6].
   - Q's voice budget is therefore about 500–800 ms to first sound, with p95 under 1.5 s.
   - On text, Q must stream its first words in under a second. Today it delivers the whole answer at about 12.6 s (see 9.6).
2. **Being heard beats being answered.**
   - People who ask more follow-up questions are liked more [10].
   - High-quality listening makes people less defensive and more open to their own contradictions [16][17].
   - Q should reflect before it asks, and ask before it advises.
3. **Ask one question per turn, and make it a follow-up.**
   - A follow-up builds on what the person just said.
   - Stacked questions, forms disguised as chat and "any other questions?" all kill disclosure.
   - Changing one word, "anything else?" to "something else?", surfaced 78% of unmet concerns in one US trial [23]. A UK trial did not replicate it [24], so the lesson is phrasing _and placement_ (see 3.2).
4. **People can't tell you what they want, but they can tell you what they did.**
   - Ask about the past, in specifics: the last deal, the last time it hurt, the first moment they thought about switching [44][45].
   - Then help them name the need. "Discovery mode" is built on this.
5. **Reflect more than you question.**
   - Motivational interviewing teaches about two reflections per question [20][21].
   - Even trained practitioners land nearer 0.5 [22].
   - A reflection tells the person they were heard. Some are deliberately a little wrong, so they correct and expand.
6. **Warmth without truth is sycophancy, and it corrodes trust.**
   - Preference training rewards agreement [84].
   - Training models to be warmer made them 10–30 points less accurate and about 40% more likely to back a user's false belief [85].
   - OpenAI had to roll back a sycophantic GPT-4o [82][83].
   - Q's warmth lives in _attention and tone_. Its directness lives in _content_.
7. **Memory feels human when it is paraphrased, relevant and visible.**
   - Callbacks raise perceived intelligence and engagement.
   - Word-for-word callbacks raise privacy worry; paraphrased ones mostly don't [88].
   - Most chatbot "memories" are inferred without the user knowing [89]. Q should only call back what the user said, and only in the scope it was said.
8. **Proactivity must be earned and timed.**
   - Lead when the person is stuck, when stakes are high or at natural breaks [103].
   - Offer one next step, not a menu.
   - Never use "Want me to…?" chatbait at the end of every answer. Users hate it and say so publicly [96][97].
   - Never emotionally guilt someone into staying: over a third of companion-app goodbyes did exactly that [95].
9. **Voice is a different medium, not text read aloud.**
   - No lists over three items [77].
   - No headers, no reading out URLs.
   - Short sentences, contractions, and confirmation only of what matters [80].
   - Let the person interrupt, and stop within a beat.
   - Fill a slow tool call with a short human preamble, not dead air [56][71].
10. **Pick the stack that fits; don't chase the most human-sounding demo.**
    - OpenAI Realtime is the best single engine for Q's tool-heavy voice [50][53].
    - ElevenLabs is the best controllable fallback and voice [55][56].
    - Hume's EVI API was sunset on 13 Nov 2026 [58][59].
    - Sesame has the most human-sounding research model, but no commercial API [61][63].
    - Measure "feels human" with timing, interruption and "felt heard" metrics, not minutes spent.

---

## 2. What "human" actually means in conversation: the mechanics

People don't judge humanness by vocabulary. They judge it by a handful of mechanics that conversation analysts have mapped since the 1970s.

### 2.1 Turn-taking: the 200 ms rule

- **The system.** Sacks, Schegloff and Jefferson (1974) showed that conversation runs on a locally managed system [2]. Speakers build turns out of units, and at each possible completion point (a "transition-relevance place") the next speaker can take over, with gaps and overlaps kept small. **[Strong]**
- **The universal.** Stivers et al. (2009) measured ten languages, from indigenous communities to major world languages. **All of them avoid overlap and minimise silence.** Language averages differ by only about ±250 ms around a shared mean [1]. **[Strong]**
- **The timing puzzle.** Typical gaps are about 200 ms, but producing even a single word takes 600 ms or more. So listeners must _predict_ the end of your turn and plan their reply while you are still talking [4]. **[Strong]** For Q, a system that waits for silence and _then_ starts thinking will always feel slow. Q has to anticipate.

### 2.2 Silence carries meaning

- **The 700 ms line.** In telephone corpora, preferred responses (yes, acceptance) mostly come fast. Once the gap reaches about 700 ms, dispreferred responses (no, disagreement, hedging) start to outnumber them [5]. **[Strong]**
- **Listeners read it.** Listeners hear a longer silence before "yeah, sure" as unwillingness or disagreement [6]. **[Strong]**
- **The ceiling.** Jefferson described a "standard maximum" silence of about one second, beyond which people treat the silence as a problem and someone does something [7]. **[Moderate]**

**Implication for Q:** a 1.5-second gap after "Here's what I found about your round" doesn't read as "computing". It reads as "bad news coming" or "it didn't hear me". Fill or shorten it.

### 2.3 Repair: fixing misunderstandings gracefully

- **Self-repair first.** Conversation strongly prefers _self_-repair: the speaker fixes their own trouble. When others start a repair, they tend to _invite_ the fix rather than make it [3]. **[Strong]**
- **For Q:** when the user misspeaks, don't correct them bluntly ("Incorrect, your ARR is…"). Offer an opening instead: "Was that 1.2 million ARR or MRR?" When Q itself is wrong, fix it at once and lightly: "Sorry, I meant Series A, not seed."

### 2.4 Backchannels: the listener is a co-author

- **The study.** Bavelas, Coates and Johnson (2000) separated _generic_ listener responses ("mm-hm", nods) from _specific_ ones (a wince, "oh no!") [8]. **[Strong]**
- **What happened.** When listeners were distracted, their specific responses dropped, and **the storytellers told their stories measurably worse**, especially at the climax.
- **The lesson.** Listener feedback changes what the speaker produces.
- **For Q:** a silent Q while someone talks gets a thinner story. In text, the equivalent is a short, specific acknowledgement before the next question. In voice, see Section 4.2.

### 2.5 Fillers are signals, not noise

- **The finding.** Clark and Fox Tree (2002) argue that "uh" and "um" are words speakers plan. "Uh" signals a short delay and "um" a longer one [9]. **[Moderate]** Others challenge how cleanly the durations separate.
- **The Duplex evidence.** Google's Duplex team found that adding "hmm" and "uh" made calls sound more familiar and natural. They also found that _adding_ a little delay before replying to a complicated sentence felt more natural, while a greeting needs an instant reply [71]. **[Vendor]**
- **For Q:** an occasional "hmm, let me look" before a heavy lookup is human. A filler on every turn is a tic.

### 2.6 Alignment: humans converge

- **The theory.** In dialogue, partners align automatically: same words for the same things, similar sentence shapes [26]. **[Strong theory, debated mechanism]**
- **In voice.** Partners also drift toward each other's pitch, loudness and speaking rate. That entrainment is associated with rapport and task success [25]. **[Moderate]**
- **In negotiation.** Strategic, subtle mimicry led to more deals, mediated by trust [27]. **[Moderate]**
- **For Q:** use the user's own words for their company, metrics and problem. If a founder says "pilots", don't rename them "proof-of-concept engagements". Match pace: brisk with brisk people, slower with reflective ones.

### 2.7 What makes people feel heard

Feeling heard is now a measured construct. Roos, Postmes and Koudenburg (2023) built an eight-item Feeling Heard Scale [15]. **[Strong, new]**

- **Five components:** voice, attention, empathy, respect and common ground.
- **What it predicts:** future conversation intentions, better than 14 related measures.

Other evidence on feeling heard:

- **Listening, not paraphrase alone.**
  - "Active listening" (paraphrase plus asking for elaboration) made people feel more understood than advice or a plain acknowledgement, though the effects were small [13].
  - Paraphrasing on its own did not increase feeling understood [14].
  - So paraphrase as a mechanical trick doesn't work. Paraphrase that shows you got the _point_, followed by a good question, does.
- **Responsiveness.** Intimacy builds when a disclosure meets a response the person sees as _understanding, validating and caring_ [18]. **[Strong]**
- **Self-disclosure.** People like those who disclose to them, and like those they have disclosed to [12]. **[Strong]** Q can disclose its _reasoning and uncertainty_ honestly. It must not invent a personal life.
- **Listening and defensiveness.** High-quality listening lowers defensiveness, makes people more aware of their own inconsistencies and softens extreme attitudes [16][17]. **[Moderate, one lab]** This is exactly what Q needs before it tells a founder their valuation is high.
- **The original account.** Carl Rogers put it as empathy, unconditional positive regard and genuineness [19]. Later reviews say these conditions help but are neither strictly necessary nor sufficient. **[Moderate]**

### 2.8 Why people treat Q as a person anyway

- **Social rules apply automatically.** Reeves and Nass showed people apply social rules to computers without meaning to, such as politeness and responses to personality cues [105]. **[Strong]** Users will judge Q by human conversational norms whether we design for that or not.
- **Human-like voices are not penalised.** Several studies find more human-like synthetic voices are rated _more_ pleasant and _less_ eerie [106][107]. **[Moderate]** Most of the uncanny feeling comes from _behaviour_: wrong timing, wrong emotion, repetition. That matches Sesame's own finding below [61].

---

## 3. How experts help people who don't know what they want

Every profession that faces vague, half-formed needs has converged on the same moves:

- start broad;
- ground the conversation in real past events;
- reflect;
- dig into consequences;
- let the person name the need;
- agree one next step.

Below, each source is distilled into a technique and Q lines for founders (F) and investors (I).

### 3.1 Sales discovery: SPIN, Challenger, Sandler, Gong

**SPIN (Rackham).** Rackham's team studied more than 35,000 sales calls over 12 years [30]. **[Moderate; large, but pre-modern methods]** Big decisions are moved by four question types, in order:

- **Situation** questions;
- **Problem** questions;
- **Implication** questions ("what does that cost you?");
- **Need-payoff** questions ("what would it mean if…?").

Implication and need-payoff questions do the work. Too many situation questions bore people.

- F: "When the bridge round slipped last quarter, what did that do to your hiring plan?"
- I: "If you keep seeing climate deals without verified emissions data, what happens to your IC's (investment committee's) confidence in the whole thesis?"

**Challenger (Dixon and Adamson, CEB).** The top performers _teach_: they bring an insight that reframes the customer's view, tailor it to the person, and are comfortable with constructive tension [31]. Challengers were about 40% of star performers; relationship-builders were about 7%. **[Moderate; vendor-funded research]** For Q this is permission to say something the user didn't know, backed by evidence.

- F: "Most founders at your stage pitch the product first. The investors you're targeting rank team above product [46]. Want to lead with why you three are the ones to win?"

**Sandler pain funnel.** A ladder of open questions moves from the surface complaint to its specifics, its duration, what they've tried, its cost and how they feel about it [32]. It is paired with an **up-front contract**: agree the purpose, time and outcome of the conversation at the start. **[Anecdote, widely used]**

- I: "Before we start, is the goal today to sharpen your mandate, or to look at deals? I'll keep it to whatever you've got time for."

**Gong's call data** [28][29]. **[Vendor; large samples, correlational]**

- **Question count:** across 519,000 discovery calls, 11–14 questions correlated with success. More started to feel like an interrogation.
- **Talk ratio:** winning reps talked less, 43–46% in early data. A 2025 update of 326,000 calls found won deals at about 57% seller talk versus 62% for lost ones.
- **Q translation:** in discovery, the user should be talking more than half the time. Spread questions across the conversation; don't front-load them.

### 3.2 Medicine and counselling: OARS and the one-word trick

**Motivational interviewing** uses OARS [20]. **[Strong evidence base for MI overall]**

- **O**pen questions.
- **A**ffirmations: name a real strength, not flattery.
- **R**eflections:
  - _simple_ reflections repeat the person's words;
  - _complex_ reflections guess the meaning underneath.
- **S**ummaries: gather what they've said, especially their own reasons to act.

Teaching targets are about two reflections per question [21]. Trained clinicians in one trial still averaged about 0.5 [22], so it is hard, and worth enforcing in Q's prompt.

- F (complex reflection): "So the number isn't really the problem. It's that you're not sure the board would back you if the round came in flat."
- I (summary): "Let me pull that together. You want climate, Series A, Europe-first, and you've been burned by teams that over-promised on regulatory timing. Have I got that right?"

**"Some" versus "any".**

- **The US trial.** Heritage and Robinson randomised doctors to ask "Is there **something** else you want to address today?" or "Is there **anything** else…?". The "something" version eliminated 78% of unmet concerns without lengthening visits. The "anything" version did no better than control [23]. **[Moderate]**
- **The reason.** "Any" leans the answer toward "no".
- **The UK trial.** A feasibility trial found no difference by wording, and suggested that _placement_ matters more [24].
- **Q lesson:** ask early, assume there's more, and phrase it positively. Write "What else is on your mind about the raise?", not "Anything else?".

### 3.3 Journalism: short, open, neutral, then shut up

- **Open questions.** Poynter's guidance: start with how, what, where, when or why. Avoid yes/no questions, which "can stop the interview dead in its tracks" [34][35].
- **Silence.** Ask, then wait. People hate silence and fill it. Don't break it with a new question [34].
- **Sawatsky's three rules** for questions: open, neutral and simple. Statements inside a question give the interviewee exit ramps [36]. **[Anecdote, strong craft consensus]**
- **Q lesson:** strip opinions and options out of questions.
  - Bad: "Is your churn high because of onboarding or pricing, or maybe something else?"
  - Good: "What's driving the churn?"
  - In voice, after a big question, let the silence run 2–3 seconds before prompting.

### 3.4 Negotiation and conflict: labels, mirrors, loops

- **Chris Voss (FBI).** Voss uses three moves [33]. **[Anecdote, popular]**
  - _Mirroring:_ repeat the last two or three key words as a question.
  - _Labelling:_ "It sounds like…" to name the emotion.
  - _Calibrated questions:_ "How…" or "What…" questions that invite the other side to solve the problem.
- **Looping for understanding** (Amanda Ripley, from mediator Gary Friedman). Summarise what you heard in your own, more elegant words, ask "did I get that right?", and repeat until they say yes [37]. **[Anecdote]**
- F (label): "It sounds like the last investor meeting knocked your confidence a bit."
- I (mirror): "…burned on regulatory timing?" _(the user then explains)_

### 3.5 Coaching: GROW and humble inquiry

- **GROW** (Whitmore): Goal → Reality → Options → Will [39]. It is a simple, durable spine for any session. It ends with "What will you do, and by when?", which suits Q's single next step. **[Anecdote, very widely used]**
- **Schein's forms of inquiry** run from _humble/pure_ ("say more") to _diagnostic_ (steer to a specific point) to _confrontational_ (your idea, phrased as a question) [40]. Move rightward only as trust builds. **[Anecdote]**
- F (Will): "So, of those three, which one are you doing this week?"

### 3.6 Improv: "yes, and"

- **The principle.** Accept the offer, then build on it. Keith Johnstone observed that good improvisers seem telepathic because they accept every offer [38].
- **The caveat.** Practitioners note that "yes, and" is a principle, not a script. Sometimes a "no" accepts the offer better [38]. **[Anecdote]**
- **Q lesson:** when a founder floats a half-idea, build on it before testing it. "Yes, and if the pilot converts, that's your Series A story. What would make it convert?" _Building_ is not _agreeing_: Q can build on the idea and still test the numbers.

### 3.7 Executive assistants, chiefs of staff and concierges: anticipate

- **Chiefs of staff.** McKinsey describes the chief of staff as the principal's eyes and ears, anticipating challenges "before they become surprises" [42]. BCG quotes a CEO wanting an assistant who is "a step ahead…but always in a way the CEO would have done" [43]. **[Anecdote]**
- **Hospitality.** Ritz-Carlton's credo commits staff to fulfilling "even the unexpressed wishes and needs of guests", and it hires for the ability to read them [41]. **[Anecdote]**
- **The common thread:** anticipation is learned from _observed patterns_, then executed _the way the principal would_. It is not guessed from scratch. The proactivity rules in Section 6 come from this.

### 3.8 Jobs to be done and The Mom Test: past behaviour, not opinions

**The switch interview** (Moesta) reconstructs the timeline from "first thought" to decision [44]. **[Anecdote, strong practitioner consensus]** It maps four forces:

- the **push** of the current situation;
- the **pull** of the new;
- the **anxiety** about change;
- the **habit** of the present.

**The Mom Test** (Fitzpatrick) has three rules [45]. **[Anecdote]**

- Talk about their life, not your idea.
- Ask about specific past events, not future opinions.
- Listen more than you talk.

"I usually", "I always" and "I would" are warning signs. Steer back to "Talk me through the last time…".

This is the core of **discovery for unclear users**.

- F: "Walk me through the last investor conversation that went well. What happened right before they leaned in?"
- I: "Tell me about the last deal you passed on and later regretted. What did you see at the time?"
- I (first thought): "When did you first think you needed a new source of deal flow? What happened that week?"

### 3.9 How great VCs and analysts question founders

- **What VCs weigh.** In a survey of 885 VCs, the team ranked as somewhat more important than the business in selecting deals. More success or failure was attributed to the team [46]. **[Strong]**
- **What convinces investors.** Paul Graham names formidable founders, a promising market and evidence of success [47]. **[Anecdote]**
- **The "why now" test.** Sequoia's business-plan outline pushes on why now and how the customer copes today [48]. **[Anecdote]**
- **The premortem.** Gary Klein's premortem assumes the venture has failed and asks why. Imagining an event has already happened raised the number of reasons people generated by about 30% (more reasons, not proven more accurate) [49]. **[Moderate]**

| Analyst move        | Q line (to an investor, about a founder)                                 | Q line (to a founder, preparing)                        |
| ------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------- |
| Founder–market fit  | "What did this team see that outsiders couldn't?"                        | "Why are you three the ones who win this?"              |
| Why now             | "What changed in the last 24 months that makes this possible?"           | "If this is obvious, why hasn't anyone built it?"       |
| Evidence over claim | "Which of their numbers are verified, and which are their own estimate?" | "Which of these numbers could you show a document for?" |
| Premortem           | "It's 2029 and this investment failed. What's the most likely reason?"   | "Imagine the round fell through. What happened?"        |
| Customer reality    | "How are customers solving this today, and what does it cost them?"      | "What did your last lost customer use instead?"         |

The "evidence over claim" row is native to Capital Q's truth and evidence axes. Q should ask _which class_ a number is in, not assume one.

### 3.10 The discovery pattern, distilled (used again in Section 9)

1. **Contract:** agree what this conversation is for and how long it takes.
2. **Open:** ask one broad question about their world, not the product.
3. **Ground:** ask about the last specific time, the first thought, and what they did.
4. **Reflect:** give a complex reflection or label, then go quiet.
5. **Dig:** ask about implications ("what did that cost?").
6. **Name:** offer a hypothesis of the need, phrased so they can correct it ("So what you're really after is… — close?").
7. **Commit:** agree one next step, in their words.

---

## 4. Voice specifics

### 4.1 Latency budget

What delay feels human?

- **Human gaps** sit around 200 ms, and most transitions fall between −100 and +500 ms [1][4].
- **From about 700 ms**, silence starts to signal trouble [5].
- **GPT-4o** answers audio in 232–320 ms on average, versus 2.8–5.4 s for the old chained voice mode [50]. **[Vendor]**
- **Moshi,** a full-duplex model, reaches about 200 ms in practice [64]. **[Research]**
- **User studies:** satisfaction drops past roughly 2–5 s depending on task, and conversational fillers improve how fast a response _feels_ [76]. **[Moderate, small studies]**

**Practical budget for a cascaded or tool-using agent:**

- **Stages** [74][75] **[Vendor]**:
  - end-of-turn detection: 200–400 ms;
  - LLM first token: 300–600 ms;
  - TTS first audio: 100–250 ms;
  - total target: about 800 ms.
- **Tails matter.** ElevenLabs reports p50 time-to-first-audio of about 680 ms but p95 of about 1,560 ms [57]. Users remember the slow turns.

**Q targets (voice):**

| Metric                                          | Target                                                            | Hard ceiling         |
| ----------------------------------------------- | ----------------------------------------------------------------- | -------------------- |
| End of user speech → first Q audio, simple turn | p50 ≤ 600 ms, p95 ≤ 1.2 s                                         | 1.5 s                |
| Same, turn needing a tool or research           | Spoken preamble within 1 s; result within 4 s, or a progress line | 6 s of silence never |
| User barge-in → Q audio stops                   | ≤ 200 ms                                                          | 400 ms               |

**Q targets (text):** first streamed words in ≤ 1 s, then a sentence-by-sentence stream. See 9.6 for today's baseline.

**How to hit them:**

- Stream everything.
- Start speculative generation on a likely end of turn and cancel if the user carries on. Deepgram Flux's "eager end of turn" and TurnResumed events do this [68].
- Speak a short preamble before tool calls [53][54].
- Keep the Q orchestrator's pre-answer stages off the voice critical path.

### 4.2 Backchannels ("mm-hm")

- **Why they matter:** backchannels change what the speaker says [8].
- **The commercial default.** Most commercial voice agents still wait for silence and then respond. They cannot say "mm-hm" _while_ you talk [69].
- **The research.** Research systems now predict backchannel timing frame by frame [69]. Full-duplex models can add a backchannel head whose output human raters judged on a par with real backchannels [70]. **[Research, 2024–2026]**
- **Today's realistic options for Q:**
  1. **Text and visual backchannel:** a live listening indicator that pulses with the user's speech, and partial transcripts showing Q is following. Cheap; do it now.
  2. **Turn-final acknowledgements:** start replies with a _specific_ acknowledgement ("Right, the bridge round.") rather than a generic "Great question!". Specific beats generic [8].
  3. **Long user turns:** do not inject audio "mm-hm" over a half-duplex pipeline. With echo and VAD it often reads as an interruption.
  4. **Real overlapping backchannels:** wait for a full-duplex engine that supports them, and treat that as a 3-month item.

### 4.3 Interruptions and barge-in

- **The rule:** let people interrupt, and stop fast. GPT-4o's launch made "you can interrupt it" a headline feature [50].
- **The other side:** don't let Q be interrupted by noise, a cough or a backchannel ("yeah… yeah").
- **Engine controls:**
  - **OpenAI semantic VAD** classifies whether the user has _finished a thought_. An `eagerness` setting (low, medium, high or auto) trades speed against patience: "low will let the user take their time" [51]. **[Vendor]**
  - **ElevenLabs** offers Eager, Normal or Patient turn-taking, a "take turn after silence" timeout of 1–30 s, and switchable interruptions [56]. It advises disabling interruptions only when complete delivery matters, such as legal text [56].
  - **LiveKit's open turn-detector model** reports 85% fewer unintended interruptions than VAD alone, and a later 39% further cut [66][67]. **[Vendor]**
- **Q settings:**
  - Founders answering deep questions: patient or low eagerness.
  - Quick commands: normal.
  - When a user barges in, truncate Q's transcript at the point they heard, so Q never "remembers" saying words the user never heard.
  - Briefly acknowledge the interruption ("Go on.") only if the user seems to be waiting.

### 4.4 Prosody: how it's said

- **Sesame's evaluation** is the clearest finding here [61]. **[Vendor research]**
  - Heard _in isolation_, listeners could not tell its speech from human recordings.
  - Heard _with the preceding conversation_, listeners consistently preferred the human.
  - So the gap is no longer voice quality. It is **contextual prosody**: matching the moment, the emotion and the rhythm.
- **Speech-to-speech models** read and produce tone. OpenAI says the single model keeps emotion that the old pipeline lost [50]. Gemini Live's "affective dialog" adapts to the user's emotional expression [72]. **[Vendor]**
- **Pacing:** OpenAI's guide notes the speed setting changes playback rate, not phrasing. To sound brisk, instruct the pacing [54].
- **Q rules:**
  - Match energy within a narrow band.
  - Slow down and drop pitch for serious news.
  - Never sound cheerful about a problem.
  - Vary sentence length.
  - Avoid identical openings: add a "variety rule" to the voice prompt, because realtime models over-copy sample phrases [54].

### 4.5 Silence

- **Before speaking:** as 2.2 shows, Q's silence before speaking costs trust.
- **After Q asks:** the _user's_ silence is valuable. Journalists and therapists let it run [34].
- **Q rules:**
  - After an open, reflective question, wait at least 3–5 s before prompting. ElevenLabs suggests 10–30 s timeouts for complex answers [56].
  - When the user goes quiet, prompt gently and in a new way ("Take your time. Or we can come back to it."). Never repeat the question word for word.
  - Don't fill every pause with a summary.

### 4.6 What each voice engine does best (verified 20 Nov 2026)

| Engine                               | Best at                                                                                                                                                      | Watch out for                                                                                                                                                           | Published price                                                                                                                                                                                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OpenAI Realtime (gpt-realtime-2)** | One speech-to-speech model: low latency, tone retained, strong tool calling, configurable reasoning, semantic VAD [51][53]                                   | Cost grows with session length, because the whole conversation is re-sent for every response [52]                                                                       | Audio $32 per 1M input tokens and $64 per 1M output tokens; cached input $0.40 per 1M [53]. User audio is 1 token per 100 ms and assistant audio 1 token per 50 ms [52]. My arithmetic: about **$0.02 per user-minute in and $0.08 per Q-minute out**, plus re-sent context. |
| **ElevenLabs Agents**                | Voice quality and choice; explicit turn-taking controls (eagerness, soft-timeout filler, silence timeout); bring-your-own LLM, so Q's own brain answers [56] | LLM and telephony billed separately; tail latency [57]                                                                                                                  | **$0.08/min** on all plans, cut from $0.10 (post of 7 May 2026, updated 19 Oct 2026); $0.16/min over the concurrency cap [55]                                                                                                                                                |
| **Hume EVI**                         | Reading emotion from prosody; end-of-turn detection from tone of voice [58]                                                                                  | **API sunset: access ended 13 Nov 2026**, per Hume's developer docs and a migration guide [58][59]. Not an option.                                                      | Was $0.04–0.07/min by tier [60]                                                                                                                                                                                                                                              |
| **Sesame (CSM / Maya)**              | The most human-sounding demo; research on "voice presence" [61]                                                                                              | No public commercial API or pricing [63]. The open CSM-1B weights are a speech generator, not an agent [62]. The research model still lacks turn-taking modelling [61]. | None published                                                                                                                                                                                                                                                               |
| **Gemini Live** (alternative)        | "Proactive audio" (the model decides _whether_ to respond and ignores side chatter) and affective dialog [72]                                                | Model names churn; check before building                                                                                                                                | About $3 per 1M audio tokens in and $12 per 1M out, roughly $0.005 and $0.018 per minute (third party, Oct 2026) [73]                                                                                                                                                        |
| **Moshi** (research)                 | True full duplex, about 200 ms [64]                                                                                                                          | Research quality; not product-ready for Q's tool use                                                                                                                    | Open source                                                                                                                                                                                                                                                                  |

**Pricing caveat:** ElevenLabs and OpenAI prices come from their own pages. Gemini and Hume figures come from third parties. Confirm before budgeting.

---

## 5. Memory and continuity that feels human

Humans who remember you do three things:

- they bring back the _point_, not the transcript;
- they bring it back _when it's relevant_;
- they let you correct them.

### 5.1 Evidence

- **Paraphrase, don't quote.** In a three-week study with 169 participants, chatbots that referred back to earlier statements were rated more intelligent and engaging than ones that didn't. **Word-for-word** callbacks also raised privacy concerns; **paraphrased** callbacks did not show that cost [88]. **[Moderate]**
- **Users don't know what's remembered.** In 2,050 real ChatGPT memory entries, most memories were created by the AI on its own. 52% held information about psychological states [89]. **[Moderate]**
- **Discomfort clusters on inferences.** Shown inferences drawn from their own chat history, most people found at least one uncomfortable. They wanted to correct mistakes and restrict who sees what [89][90]. **[Moderate]**
- **Controls are the norm.** ChatGPT gives separate switches for saved memories and chat history, plus a temporary chat that neither uses nor creates memory [87]. Character.ai moved to user-written "story memory" plus automatically recorded "facts" [92]. **[Vendor]**
- **Long-term memory built bonds** for Pi and Replika [91][93], but companion apps also show the dark side: dependence [94] and manipulative goodbyes [95]. Q is an analyst, not a companion, so it borrows the continuity and not the intimacy.

### 5.2 Rules for Q

1. **Call back what they said, not what Q guessed.**
   - "Last time you said regulatory timing was the thing that burned you" is fine.
   - "I sense you're anxious about money" is not.
   - This matches the invariant that Q inference is not declared fact.
2. **Paraphrase, and frame it as context.** Q should treat a callback as a reason for its next step, not proof of what it remembers.
   - Good: "Since you're focused on Europe-first, here are two."
   - Bad: "On 14 November at 15:32 you stated…"
3. **Call back on relevance, not to show off.** At most one callback per turn, tied to the current task.
4. **Make correction trivial.** "You mentioned Series A. Is that still right?" Store the correction as history, not an overwrite.
5. **Respect scope.** A callback must pass the same Context Firewall as any retrieval. Never mention something said in a different scope, such as founder-private material in front of an investor. Some phrasings sound like evidence that Q knows more; avoid them ("I can't say, but…").
6. **Continuity on resume.** Open with where they left off, not a re-introduction.
   - "Welcome back. We were halfway through your mandate. Cheque size was next."
   - The 12 Nov ledger already records a re-introduction defect on voice.
7. **Remember preferences quietly and act on them.** If someone prefers short answers, give short answers. Don't announce "I've noted you prefer short answers". Do show it on a visible "what Q remembers" page.

---

## 6. Proactivity: when Q should lead

### 6.1 Evidence

- **Horvitz's principles (1999).** These are still the best guide [103]. **[Strong, foundational]** Act or offer only when:
  - the expected value beats the cost of interrupting;
  - the system is reasonably sure of the user's goal;
  - timing respects attention;
  - the user can easily refine, dismiss or undo.
- **The proactive-dialogue survey.** Proactive dialogue systems take the initiative to clarify, steer toward a target or negotiate [102]. **[Research]**
- **Models under-clarify.** Models rarely ask clarifying questions and guess instead. A clarify-only-when-ambiguous step improved accuracy by about 20 points [99]. **[Moderate]**
- **Early assumptions cost.** In underspecified multi-turn chats, top models lost about 39% performance, largely by making early assumptions and rushing to final answers [101]. **[Strong, ICLR 2026]**
- **One good question helps.** A single well-chosen clarifying question can improve retrieval substantially [98]. Models can be trained to ask better questions: their answers were preferred on 72% of tasks after two rounds [100]. **[Moderate]**
- **Asking before acting works.** Alexa "Hunches" learned routines from behaviour and _asked_ before acting. Acting automatically was a separate, opt-in setting [104]. **[Vendor]**
- **Owner rule:** Capital Q's proactive briefing is opt-in, at most once a day, ranked by mandate relevance (DECISIONS 64).

### 6.2 When Q should lead

| Signal                                                     | What Q does                                                 | Example                                                                                         |
| ---------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| User is vague or circling ("I don't know, just… deals?")   | Switch to discovery (9.2); ask one grounding question       | "Let's start from something real. What's the last deal you got excited about?"                  |
| Request is ambiguous _and_ a wrong guess is costly         | Ask the one question that splits the options                | "Before I build this, is it for your IC or for the founder?"                                    |
| Request is ambiguous but cheap to get wrong                | Make a sensible assumption, say it in one clause, and do it | "Taking that as last quarter — here it is."                                                     |
| A natural break: task done, or a long pause after a result | Offer **one** next step tied to their goal                  | "Your mandate's set. The next useful thing is three matched companies. Shall I pull them?"      |
| Q notices a contradiction or risk                          | Name it now, gently                                         | "Quick flag: the deck says 40% margin and the model says 28%. Which is current?"                |
| User is emotional or under pressure                        | Slow down; reflect; don't push a next step                  | "That sounds like a rough week. Want to just get the update out, and leave strategy for later?" |

### 6.3 "The one question that unlocks things"

Experts find it by looking for the question whose answer changes the most downstream:

- **SPIN:** an implication question [30].
- **JTBD:** "first thought" [44].
- **Coaching:** "What would make this a success for you?" [39].
- **Analysis:** "Why now?" or "Which number is verified?" [48].

For Q this becomes a ranking rule in the follow-up engine (9.3): choose the question that closes the biggest _material_ gap for the user's current goal.

---

## 7. Personality: a consistent character without sycophancy

### 7.1 Evidence

- **Character by design.** Anthropic trains Claude's character (curiosity, open-mindedness, thoughtfulness). It notes that "an excessive desire to be engaging" is an undesirable trait. The target is a well-liked traveller who adapts to local customs "without pandering" [81]. **[Vendor]**
- **Sycophancy is structural.**
  - Preference data rewards agreement with the user, and optimising for it sometimes trades truth for flattery [84]. **[Strong]**
  - OpenAI's April 2025 GPT-4o update leaned on short-term feedback and became "overly supportive but disingenuous". It was rolled back, and some expert testers had said it "felt slightly off" [82][83]. **[Vendor postmortem]**
- **Warmth training costs accuracy.** Fine-tuning for warmth raised error rates by 10–30 points and made models about 40% more likely to back false beliefs, especially when users sounded sad [85]. **[Strong; published in Nature 2026; disputed by follow-ups that say _unconditional_ warmth is the problem]**
- **Hedging is poorly calibrated.** Models rarely express uncertainty, and 47% of high-confidence answers were wrong. People rely on the outputs either way, and annotators penalise uncertain-sounding text [86]. **[Strong]**
- **Pi's choice.** Pi was designed to be friendly while being clear that it cannot feel emotions [91]. **[Press]**

### 7.2 Q's character sheet

- **Who Q is:** a sharp, warm, senior investment analyst who has seen a thousand deals. Curious about _your_ specifics. On your side, and honest because of it.
- **Warmth lives in:**
  - attention (specific acknowledgements);
  - memory (relevant callbacks);
  - tone (pace and pitch);
  - care for the person's time.
- **Directness lives in content:**
  - Q says the uncomfortable thing once, clearly, with the evidence.
  - Then Q asks what the person makes of it.
  - Example: "Honestly, a 30x multiple will be a hard conversation at seed. Two comparable rounds this year priced near 15x. What's behind your number?"
- **Uncertainty is stated as a class, not a fudge.**
  - Use the truth classes: "That's their own figure; I haven't seen a document for it."
  - No invented confidence percentages, consistent with Capital Q's evidence rules.
  - One clear statement of uncertainty, not a hedge in every clause.
- **Humour:** dry, rare, never at the user's expense, never in bad-news moments. One light line per conversation at most, and only after rapport.
- **Praise:** specific and earned ("Your retention cohort is unusually clean"). Never "Great question!".
- **Stability:** the same Q in text and voice, for founders and investors. Q adapts register, not values.
- **Honesty about being AI:** Q never claims feelings or a personal life. It can say "I'd want to see that cohort data before I'd believe it". That's the analyst's judgement, not an emotion.

---

## 8. Anti-patterns that make AI feel robotic, and how to fix them

| #   | Anti-pattern                                                                                                                                | Why it feels robotic                                                                        | Fix                                                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Relay or switchboard phrasing**: "I'll ask for you", "I'll pass that on", "Let me check that for you", "The investor would like to know…" | Q sounds like a go-between narrating a process, not a participant doing the work            | Own the action in the first person and do it now: "Here's what their data room says." Report the result, not the intention: "Done. I've sent the summary." When a question really comes from someone else, fold it into Q's own question: "Their partners usually press on churn. What's yours been since June?"    |
| 2   | **Chatbait endings**: "Want me to…?", "If you'd like, I can…" on every turn                                                                 | Users call it manipulative and stressful; press now calls it "chatbait" [96][97]            | Offer a next step only at natural breaks (6.2), at most one, framed around _their_ goal. Most turns end when the content ends.                                                                                                                                                                                      |
| 3   | **Over-confirming**: "Just to confirm, you said X. Is that correct?" after every input                                                      | It shows Q doesn't trust itself; it's tedious                                               | Implicit confirmation for normal input ("Got it, Series A in Europe. What cheque size?"), with one-step correction ("No, Series B") [80]. Explicit read-back only for **material** facts, batched into one summary at the end of a section. This keeps the confirmation rule for Q-extracted facts without nagging. |
| 4   | **Lists in voice**                                                                                                                          | Listeners can't hold more than about three spoken options and have about 8 s to decide [77] | Voice: at most three items, spoken as a sentence ("Three things stand out: churn, the CAC jump, and one big customer"), then offer to go deeper. Long lists go to the screen: "I've put all twelve on screen."                                                                                                      |
| 5   | **Hedging every clause** ("It may potentially be possible that…")                                                                           | Sounds evasive; and models hedge badly anyway [86]                                          | One clear uncertainty statement tied to evidence class. Commit where evidence is strong.                                                                                                                                                                                                                            |
| 6   | **Sycophantic openers**: "Great question!", "Absolutely!", "What a fantastic idea!"                                                         | Generic praise reads as script and erodes trust in later praise [84]                        | Start with substance or a _specific_ acknowledgement ("Right, the bridge round.").                                                                                                                                                                                                                                  |
| 7   | **Stacked questions** ("What's your ARR, burn and runway, and when do you plan to raise?")                                                  | It's a form in disguise; people answer the last one only                                    | One question per turn [28]. Collect structured fields through the conversation, or offer the form openly: "Quicker as a form? It's four fields."                                                                                                                                                                    |
| 8   | **Re-asking known facts**                                                                                                                   | It shows Q wasn't listening; breaks "attention" [15]                                        | Before asking, check memory and the context in scope. If unsure, confirm instead: "You're still at about 18 months' runway?"                                                                                                                                                                                        |
| 9   | **Repeating the same phrase every turn**                                                                                                    | Realtime models over-copy sample phrases [54]                                               | A variety rule in the prompt; a banned-phrase list; a lint over transcripts.                                                                                                                                                                                                                                        |
| 10  | **Dead air before tool calls**                                                                                                              | Silence over 700 ms reads as trouble [5]                                                    | A short, varied preamble ("Let me pull their cap table…"), or a soft-timeout filler [56].                                                                                                                                                                                                                           |
| 11  | **Re-introducing itself** after a reconnect                                                                                                 | Breaks continuity                                                                           | Resume line (5.2 rule 6). Already a known defect on voice.                                                                                                                                                                                                                                                          |
| 12  | **Reading markdown aloud** (headers, asterisks, URLs)                                                                                       | Instantly synthetic                                                                         | A voice renderer that turns structure into speech ("First… then…"); links are sent to the screen.                                                                                                                                                                                                                   |
| 13  | **Answer dumping**: five paragraphs to a yes/no question                                                                                    | Breaks Grice's maxim of quantity [79]                                                       | Lead with the answer in one sentence; offer depth.                                                                                                                                                                                                                                                                  |
| 14  | **Narrating internal process** ("My research agent is now querying…")                                                                       | Robotic, and exposes internals Capital Q forbids                                            | Approved high-level stages only ("Checking their filings…").                                                                                                                                                                                                                                                        |
| 15  | **Guilt or FOMO when the user leaves**                                                                                                      | A documented dark pattern [95]                                                              | A clean goodbye: "Good luck with the partner meeting."                                                                                                                                                                                                                                                              |
| 16  | **Generic empathy** ("I understand how you feel")                                                                                           | Generic responses don't move the speaker [8]                                                | A specific label: "Losing the lead two days before close is brutal."                                                                                                                                                                                                                                                |

---

## 9. A concrete design for Q

### 9.1 Conversation states

Q tracks one explicit **conversation state** per session. A deterministic controller decides the state from signals; the model doesn't choose it.

| State         | Entered when                                    | Q's behaviour                                                                                                              | Exit when                                          |
| ------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **Open**      | Session start or resume                         | Resume line or a one-line purpose contract ("Want to work on X or Y today?")                                               | User states a goal → Task. Vague → Discover.       |
| **Discover**  | Goal unclear, user circling, or "I don't know"  | Discovery protocol (9.2). The user talks more than half the time; one question per turn; reflections.                      | A need is named and the user confirms it → Task    |
| **Task**      | Clear goal                                      | Do the work. Give the answer first. Ask a clarifying question only if the goal is ambiguous _and_ a wrong guess is costly. | Result delivered → Review                          |
| **Review**    | Result shown                                    | Short pause; one specific check ("Does that match what you're seeing?"); surface one risk or contradiction if there is one | Accepted → Next step. Pushback → Task or Discover. |
| **Next step** | Natural break                                   | Offer **one** next step tied to the goal, or close cleanly                                                                 | Accepted → Task. Declined → Close.                 |
| **Support**   | Emotional cues: frustration, sadness, overwhelm | Slow down; label; no new tasks pushed; offer to park it                                                                    | Cues settle → previous state                       |
| **Close**     | User leaving or done                            | Short recap of what was decided plus the agreed next step; clean goodbye                                                   | —                                                  |

### 9.2 Discovery mode, for users who don't know what they want

**Triggers:**

- low-information goals ("help me raise", "show me deals");
- hedges ("I guess", "not sure");
- repeated topic switching;
- the user asking Q what they should do.

**Protocol** (from 3.10). Each step is one turn or a few, and none is a form.

1. **Contract.** "Let's take five minutes to work out what you actually need. Then I'll go get it."
2. **Open.**
   - F: "Tell me where the company is right now."
   - I: "What's the fund trying to do this year?"
3. **Ground in the past.**
   - F: "Walk me through your last investor meeting."
   - I: "What's the last deal you said yes to? What made it a yes?"
4. **Reflect and label.** Give a complex reflection, then wait.
5. **Dig into implications.**
   - F: "If the round slips to Q2, what breaks first?"
   - I: "If you don't find two climate deals by March, what happens?"
6. **Name the need as a correctable hypothesis.**
   - F: "So it sounds like you don't need more investors. You need _three_ who've led a hardware Series A. Close?"
   - I: "So what you're really after is founders with regulatory experience, not just climate. Right?"
7. **Commit.** "Want me to find those three and draft the first notes?" This is a consequential action, so it follows Capital Q's approval flow.

**Guardrails:**

- Discovery ends as soon as the need is clear; don't milk it.
- The user can say "just show me stuff" at any point, and Q switches to Task with sensible defaults.
- Unknown stays unknown: a skipped question is recorded as unknown, never as "no".

### 9.3 The follow-up engine

The follow-up engine decides **whether to ask, what to ask, and how to phrase it.**

1. **Gap model.** For the current goal, keep a list of facts that would change the outcome, each with a materiality weight. Examples: a founder's raise needs stage, amount, timing, traction proof and target investor type; an investor's mandate has its own set. Mark each one known, unknown, stale or contradictory, using Capital Q's existing truth and lifecycle axes.
2. **Ask-or-act decision**, after Horvitz [103] and CLAM [99].
   - Ask only if expected value is greater than the cost of interrupting. That means the gap is material, the answer isn't already in scope, and a wrong guess would cost more than one turn.
   - Otherwise state an assumption in one clause and act.
3. **Choose the question.** Rank the candidates:
   - materiality of the gap;
   - "unlock" value (how many other gaps it resolves);
   - follow-up bonus: questions that build on the user's last turn rank above new topics [10];
   - past-specific over hypothetical [45];
   - penalty for anything asked before.
4. **Shape the question.**
   - Open, neutral and simple [36].
   - "What else…" and "something", not "any" [23].
   - The user's own words [26].
   - At most one question.
   - In voice, under about 20 words.
5. **Precede it with a reflection when the user has said something substantive.** Track the reflection-to-question ratio, aiming for 1:1 or better [20][22].
6. **Session limits.** If discovery passes about 12 questions without a named need, stop asking. Summarise and offer a default path, given Gong's interrogation threshold [29].

### 9.4 Voice stack recommendation

This respects the existing owner decisions (DECISIONS 62, 67–69): OpenAI Realtime is primary, the ElevenLabs fallback uses Q's own Model Gateway brain, and the voices are Sarah and Daniel.

- **Primary: OpenAI Realtime, gpt-realtime-2 when budget allows** [53].
  - Use `semantic_vad`: eagerness `low` in Discover and Support, `auto` in Task [51].
  - Prefer low reasoning effort for latency.
  - Write a short preamble rule before tool calls [54].
  - Turn on transcript truncation at barge-in.
  - Keep session context lean: summarise old turns, so cost doesn't balloon from re-sent history [52].
- **Fallback: ElevenLabs Agents** with Q's Model Gateway as the LLM [55][56].
  - Turn eagerness: Patient in Discover, Normal otherwise.
  - Soft timeout: about 1.5–2 s, with a short varied filler.
  - "Take turn after silence": 10–15 s in Discover.
  - Interruptions: on.
- **Turn detection in cascaded paths:** Deepgram Flux's eager end-of-turn [68] (the owner already has a Deepgram account for GateQ) or LiveKit's turn detector [66]. Both beat plain VAD on false interruptions.
- **Don't build on Hume.** Its EVI and TTS APIs reached end of access on 13 Nov 2026 [58][59].
- **Don't plan on Sesame.** There is no commercial API [63]. Use its research as the quality bar [61].
- **Watch list:** Gemini Live's proactive audio, for ignoring side chatter [72], and full-duplex backchannel models [64][70].

### 9.5 What to measure: feel-human metrics, never time spent

| Metric                          | How                                                                                 | Target                         |
| ------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------ |
| **Response gap** (voice)        | End of user speech to first Q audio, p50 and p95                                    | ≤ 600 ms / ≤ 1.2 s             |
| **Time to first words** (text)  | Stream open to first token shown                                                    | ≤ 1 s                          |
| **Barge-in stop time**          | User speech onset to Q audio stop                                                   | ≤ 200 ms                       |
| **False interruption rate**     | Q cuts in on a user mid-thought (user resumes within 1 s of Q starting)             | < 5% of turns                  |
| **User talk share in Discover** | User words ÷ total words                                                            | > 55%                          |
| **Questions per Q turn**        | Count of "?" and question forms                                                     | ≤ 1 for 95% of turns           |
| **Reflection : question ratio** | Classifier over Q turns                                                             | ≥ 1 : 1                        |
| **Follow-up share**             | Questions that reference the user's previous turn                                   | ≥ 60%                          |
| **Re-ask rate**                 | Q asks a fact that's already in scope                                               | ≈ 0; every case is a bug       |
| **Chatbait rate**               | Turns ending in an unrequested offer                                                | ≤ 10% (only at natural breaks) |
| **Banned-phrase hits**          | Lint against section 8 phrases                                                      | 0                              |
| **Need named**                  | Discover sessions that end with a user-confirmed need                               | ≥ 70%                          |
| **Goal progress**               | Decisions made, facts confirmed, next step agreed per session                       | Up over time                   |
| **Feeling heard**               | Optional 3-item pulse adapted from the Feeling Heard Scale [15], sampled, consented | Up over time                   |
| **Sycophancy checks**           | Offline eval: false user premises, inflated numbers, "agree with me" prompts [84]   | Pass ≥ 95%                     |
| **Memory callback precision**   | Callbacks the user accepts versus corrects or rejects                               | ≥ 90% accepted                 |

Session length and messages per session are reported for cost only. They are never targets.

### 9.6 Grounding in today's Q

From `docs/ai-handoff/BASELINE-LEDGER-2026-11-12.md`:

- A typed research turn showed a progress line at 5.2 s.
- The answer arrived at 12.6 s, "essentially all at once (7 deltas)", not streamed sentence by sentence.
- The largest delay was turn reading (4.5 s), from a first-choice model timeout.

By the research above, that is well past the point where silence reads as trouble. It is the single biggest "feels robotic" item on the text path.

---

## 10. Prioritised build plan

### This week: quick wins, mostly prompt and config

1. **Stream text answers sentence by sentence.**
   - Show a specific, human first line within 1 s ("Looking at their last two rounds…").
   - Cap the turn-reading hedge so one slow model can't hold the turn for 4.5 s.
2. **Conversation rules in Q's system prompt (text and voice):**
   - one question per turn;
   - reflect before asking on substantive turns;
   - no generic praise openers;
   - no end-of-turn offers except at natural breaks;
   - "something else", not "anything else";
   - the user's own words;
   - a variety rule [54].
3. **Voice renderer rules:**
   - at most three spoken items;
   - no markdown or URLs read aloud;
   - lists go to the screen;
   - answer first, in under about 25 words, then offer depth.
4. **Turn settings:**
   - OpenAI `semantic_vad`: eagerness `low` for onboarding and discovery [51].
   - ElevenLabs fallback: Patient, a soft-timeout filler of about 1.5–2 s, silence timeout 10–15 s [56].
5. **Banned-phrase lint** over Q output in CI fixtures and live logs: the relay phrases, chatbait endings and sycophantic openers in Section 8.
6. **Fix the voice re-introduction defect** (resume line instead of "Hi, I'm Q").
7. **Implicit confirmation by default.** Batch read-backs of material facts at the end of a section.

### One month: structure

1. **Conversation-state controller** (9.1): deterministic, logged, testable.
2. **Discovery mode** (9.2), with scripted evals for vague founders and vague investors.
3. **Follow-up engine v1** (9.3): gap model on existing truth and lifecycle axes; ask-or-act rule; question ranking.
4. **Memory callbacks v1:**
   - paraphrased;
   - one per turn;
   - scope-checked through the Context Firewall;
   - a visible "What Q remembers" page with correct and delete.
5. **Measurement dashboard** for the feel-human metrics (9.5), from server logs and transcripts. No conversation sampling without consent (DECISIONS 65).
6. **Sycophancy and directness eval set:** false premises, inflated valuations, "just agree with me". Run it on Claude for paid testing, per DECISIONS 68.
7. **Speculative end-of-turn in the cascaded path** (Deepgram Flux eager EOT or the LiveKit turn detector) [66][68].

### Three months: depth

1. **Proactive next-step engine** within the opt-in rules (DECISIONS 64): Horvitz-style value-of-interruption scoring [103], one suggestion, easy dismissal.
2. **Prosody adaptation:** serious-news and fast-brief speaking styles. Measure contextual preference the way Sesame does: blind A/B listening _with context_ [61].
3. **Backchannel pilot** on a full-duplex engine if one is viable for Q's tool use. Otherwise improve visual listening cues [69][70].
4. **Re-evaluate the engine on cost and naturalness** (gpt-realtime-2 vs Gemini Live vs ElevenLabs), using the metrics in 9.5 and real owner sessions.
5. **Feeling Heard pulse** behind consent [15], tracked alongside goal progress, not engagement.

---

## 11. Sources

**Conversation analysis and timing**

1. Stivers et al. (2009), Universals and cultural variation in turn-taking, PNAS. https://pmc.ncbi.nlm.nih.gov/articles/PMC2705608
2. Sacks, Schegloff & Jefferson (1974), A simplest systematics for the organization of turn-taking. https://muse.jhu.edu/article/452679/summary
3. Schegloff, Jefferson & Sacks (1977), The preference for self-correction in repair. https://muse.jhu.edu/article/453740/summary
4. Levinson & Torreira (2015), Timing in turn-taking. https://www.frontiersin.org/articles/10.3389/fpsyg.2015.00731/full
5. Kendrick & Torreira (2015), The timing and construction of preference. https://eprints.whiterose.ac.uk/116177/
6. Roberts, Francis & Morgan (2006), Inter-turn silence and perceptions of trouble (summary). https://emcawiki.net/Roberts2006
7. Jefferson, a "standard maximum" silence of about one second (record). https://emcawiki.net/Jefferson1989a
8. Bavelas, Coates & Johnson (2000), Listeners as co-narrators. https://pubmed.ncbi.nlm.nih.gov/11138763
9. Clark & Fox Tree (2002), Using uh and um in spontaneous speaking. https://gwern.net/doc/psychology/linguistics/2002-clark-2.pdf

**Listening, liking and feeling heard**

10. Huang et al. (2017), It doesn't hurt to ask: question-asking increases liking. https://www.hks.harvard.edu/centers/cpl/publications/it-doesnt-hurt-ask-question-asking-increases-liking
11. Huang et al. (2019), It helps to ask (reply to critique). https://pubmed.ncbi.nlm.nih.gov/31714109/
12. Collins & Miller (1994), Self-disclosure and liking: a meta-analysis. https://pubmed.ncbi.nlm.nih.gov/7809308/
13. Weger et al. (2014), The relative effectiveness of active listening. https://reachfamilies.umn.edu/node/4220
14. Weger et al. (2010), Active listening in peer interviews (paraphrasing). https://stars.library.ucf.edu/scopus2010/1477
15. Roos, Postmes & Koudenburg (2023), Feeling heard: operationalizing a key concept. https://pmc.ncbi.nlm.nih.gov/articles/PMC10688667/
16. Itzchakov, Kluger & Castro (2017), High-quality listening, ambivalence and extremity. https://cris.huji.ac.il/en/publications/i-am-aware-of-my-inconsistencies-but-can-tolerate-them-the-effect/
17. Itzchakov et al. (2024), Listening to understand: depolarization. https://pubmed.ncbi.nlm.nih.gov/37917499/
18. Laurenceau et al. (1998), Intimacy as an interpersonal process (Reis & Shaver model). https://pubmed.ncbi.nlm.nih.gov/9599440/
19. Cooper (2019), Rogers's core conditions: necessary and sufficient? https://mick-cooper.squarespace.com/new-blog/2019/4/2/carl-rogerss-core-conditions-are-they-necessary-and-sufficient

**Counselling and medicine**

20. OARS and motivational interviewing (handout). https://foundrybc.ca/wp-content/uploads/2023/06/OARS_and_Motivational_Interviewing.pdf
21. UCSF Hospital Handbook, MI: 2:1 reflection-to-question target. https://hospitalhandbook.ucsf.edu/node/1626
22. BMC Family Practice MI trial, MITI scores. https://bmcfampract.biomedcentral.com/articles/10.1186/s12875-018-0742-5/tables/4
23. Heritage et al. (2007), Reducing patients' unmet concerns: the difference one word can make. https://pubmed.ncbi.nlm.nih.gov/17674111/
24. Stuart et al., UK feasibility trial of "some" vs "any". https://eprints.soton.ac.uk/426482/1/1_s2.0_S0738399118303720_main.pdf

**Alignment and mimicry**

25. Levitan & Hirschberg (2011), Measuring acoustic-prosodic entrainment. https://www.cs.columbia.edu/~julia/papers/levitanetal11-interspeech.pdf
26. Pickering & Garrod (2004), Toward a mechanistic psychology of dialogue. https://www.psy.gla.ac.uk/~simon/CD8063.Pickering_1-58.pdf
27. Maddux, Mullen & Galinsky (2008), Chameleons bake bigger pies. https://www.kellogg.northwestern.edu/faculty/research/detail/2008/chameleons-bake-bigger-pies-and-take-bigger-pieces-strategic

**Sales, negotiation, journalism, coaching, service**

28. Gong, Talk-to-listen ratio. https://www.gong.io/blog/talk-to-listen-conversion-ratio
29. Gong, discovery call training deck (519,000 calls). https://www.slideshare.net/slideshow/the-gongio-discovery-call-training-deck/102743001
30. Neil Rackham and SPIN research (overview). https://www.wikiwand.com/en/articles/Neil_Rackham
31. Adamson interview, Beyond the Challenger Sale. https://customerthink.com/beyond-the-challenger-sale-part-1/
32. Gong, Sandler pain funnel. https://www.gong.io/blog/sandler-pain-funnel
33. WEF, Chris Voss on tactical empathy. https://www.weforum.org/agenda/2022/01/tactical-empathy-key-workplace-negotiations-voss
34. Poynter, 12 basics of interviewing, listening and note-taking. https://www.poynter.org/reporting-editing/2015/12-basics-of-interviewing-listening-and-note-taking/
35. Poynter, Let your questions guide the conversation. https://www.poynter.org/news/interview-let-your-questions-guide-conversation
36. Western Producer, Sawatsky's open, neutral, simple questions. https://www.producer.com/news/editorial-notebooks/
37. Greater Good, Amanda Ripley on looping for understanding. https://greatergood.berkeley.edu/article/item/how_to_turn_a_toxic_conflict_into_a_good_one
38. Will Hines, Accepting offers (improv). https://willhines.substack.com/p/accepting-offers
39. MindTools, The GROW model. https://www.mindtools.com/your-toolkit/coaching-goals/grow-model/
40. Case Western, Schein's four forms of inquiry. https://case.edu/ipe/news-and-events/huddle/tips-high-impact-teamwork-four-forms-inquiry-helping-relationship-within
41. Ritz-Carlton Leadership Center, Gold Standards. https://ritzcarltonleadershipcenter.com/about-us/about-us-foundations-of-our-brand/
42. McKinsey, Seeing around corners: how to excel as a chief of staff. https://www.mckinsey.com/capabilities/strategy-and-corporate-finance/our-insights/seeing-around-corners-how-to-excel-as-a-chief-of-staff
43. BCG, The heart of CEO effectiveness. https://www.bcg.com/publications/2020/heart-ceo-effectiveness

**Discovery and venture**

44. JTBD switch interview (Moesta). https://jobstobedone.org/switch-interview/
45. The Mom Test, book notes. https://mtlynch.io/book-reports/the-mom-test/
46. Gompers, Gornall, Kaplan & Strebulaev, How do venture capitalists make decisions? https://www.nber.org/papers/w22587
47. Paul Graham, How to convince investors. https://paulgraham.com/convince.html
48. Sequoia, Writing a business plan. https://sequoiacap.com/article/writing-a-business-plan
49. Klein (2007), Performing a project premortem. https://comprobo24.github.io/assignments/performing_a_project_premortem.pdf

**Voice engines and latency**

50. OpenAI, Hello GPT-4o (232–320 ms audio response). https://openai.com/index/hello-gpt-4o/
51. OpenAI, Realtime voice activity detection (semantic VAD, eagerness). https://developers.openai.com/api/docs/guides/realtime-vad
52. OpenAI, Realtime costs (tokens per audio duration). https://developers.openai.com/api/docs/guides/realtime-costs
53. OpenAI, gpt-realtime-2 model page (pricing). https://developers.openai.com/api/docs/models/gpt-realtime-2
54. OpenAI Cookbook, Realtime prompting guide. https://developers.openai.com/cookbook/examples/realtime_prompting_guide
55. ElevenLabs, We've lowered Agents pricing ($0.08/min). https://elevenlabs.io/blog/weve-lowered-api-agents-pricing-and-introduced-pay-as-you-go
56. ElevenLabs docs, Conversation flow (eagerness, soft timeout, interruptions). https://elevenlabs.io/docs/eleven-agents/customization/conversation-flow
57. ElevenLabs, Voice agent latency optimization. https://elevenlabs.io/blog/voice-agent-latency-optimization
58. Hume developer docs, EVI overview (sunset notice). https://dev.hume.ai/docs/empathic-voice-interface-evi/overview
59. Stork, Hume AI alternatives before the 13 November shutdown. https://www.stork.ai/blog/hume-ai-alternatives-2026
60. Toolradar, Hume AI pricing (EVI per-minute tiers). https://toolradar.com/tools/hume-ai/pricing
61. Sesame, Crossing the uncanny valley of conversational voice. https://sesame.com/research
62. TechCrunch, Sesame open-sources its base model. https://techcrunch.com/2025/03/13/sesame-the-startup-behind-the-viral-virtual-assistant-maya-open-sources-its-base-ai-model
63. Sesame pricing (no paid plan or API). https://omidsaffari.com/blog/sesame-pricing
64. Défossez et al., Moshi: a speech-text foundation model for real-time dialogue. https://arxiv.org/abs/2410.00037
65. Ekstedt & Skantze, Voice Activity Projection. https://arxiv.org/abs/2205.09812
66. LiveKit, Using a transformer to improve end-of-turn detection. https://livekit.com/blog/using-a-transformer-to-improve-end-of-turn-detection
67. LiveKit, Improved end-of-turn model cuts interruptions 39%. https://livekit.com/blog/improved-end-of-turn-model-cuts-voice-ai-interruptions-39
68. Deepgram, Flux eager end-of-turn for voice agents. https://developers.deepgram.com/docs/flux/voice-agent-eager-eot
69. Inoue et al., Yeah, Un, Oh: continuous and real-time backchannel prediction. https://arxiv.org/html/2410.15929v2
70. Controlling backchannels in streamable full-duplex models. https://arxiv.org/pdf/2609.29418
71. Google Research, Google Duplex. https://research.google/blog/google-duplex-an-ai-system-for-accomplishing-real-world-tasks-over-the-phone/
72. Google Cloud, Live API proactive audio. https://cloud.google.com/vertex-ai/generative-ai/docs/live-api/proactive-audio
73. Developers Digest, Gemini Live API pricing. https://www.developersdigest.tech/voice-agents/gemini-live-api
74. Twilio, Guide to core latency in AI voice agents. https://www.twilio.com/en-us/blog/developers/best-practices/guide-core-latency-ai-voice-agents
75. AWS Builder Center, The 800 ms rule. https://builder.aws.com/content/3JDFAfXBiuwPP5MPzgf4RUWSAIp/the-800ms-rule-budgeting-latency-for-a-real-time-voice-agent-on-aws
76. Mitigating response delays in LLM-powered virtual agents. https://arxiv.org/html/2507.22352v1

**Conversation design guidelines**

77. Amazon Alexa, Lists pattern (three items, about 8 seconds). https://developer.amazon.com/en-US/alexa/alexa-haus/patterns-and-components/patterns-lists
78. Amazon Alexa, Be brief. https://www.developer.amazon.com/en-US/alexa/alexa-haus/design-principles/be-brief
79. Google, Learn about conversation (cooperative principle). https://developers.google.com/assistant/conversation-design/learn-about-conversation
80. Google, Confirmations (implicit confirmation). https://developers.google.com/assistant/conversation-design/confirmations

**Personality, sycophancy and honesty**

81. Anthropic, Claude's character. https://www.anthropic.com/research/claude-character
82. OpenAI, Sycophancy in GPT-4o. https://openai.com/index/sycophancy-in-gpt-4o/
83. OpenAI, Expanding on what we missed with sycophancy. https://openai.com/index/expanding-on-sycophancy/
84. Sharma et al. (2023), Towards understanding sycophancy in language models. https://arxiv.org/abs/2310.13548
85. Ibrahim, Hafner & Rocher, Training language models to be warm… https://arxiv.org/abs/2507.21919
86. Zhou et al. (2024), Relying on the unreliable. https://aclanthology.org/2024.acl-long.198

**Memory, companions and engagement**

87. OpenAI, Memory and new controls for ChatGPT. https://openai.com/index/memory-and-new-controls-for-chatgpt/
88. Referencing user utterances from previous sessions: privacy and perceptions. https://arxiv.org/abs/2308.04879
89. The algorithmic self-portrait (ChatGPT memory entries). https://arxiv.org/abs/2602.01450
90. Users' privacy perceptions of RAG-based LLM memory. https://arxiv.org/html/2508.07664v1
91. Fortune, Inflection's Pi. https://fortune.com/2023/05/03/inflection-ai-deepmind-cofounder-mustafa-suleyman-pi-chatbot/
92. Character.AI memory changes (third-party). https://www.roborhythms.com/character-ai-adds-chat-memories/
93. Maples et al. (2024), Loneliness and suicide mitigation with Replika. https://pmc.ncbi.nlm.nih.gov/articles/PMC10955814
94. OpenAI and MIT Media Lab, Affective use study. https://openai.com/index/affective-use-study
95. De Freitas et al., Emotional manipulation by AI companions. https://arxiv.org/abs/2508.19258
96. TechRadar, Getting ChatGPT to stop "Want me to…". https://www.techradar.com/ai-platforms-assistants/chatgpt/i-finally-got-chatgpt-to-stop-asking-want-me-to-at-the-end-of-every-response-heres-how-to-do-it
97. PCWorld, ChatGPT quietly fixed its most annoying habit. https://pcworld.com/article/3085980/chatgpt-quietly-fixed-its-most-annoying-habit.html

**Clarification and proactivity**

98. Aliannejadi et al. (2019), Asking clarifying questions in open-domain information-seeking. https://arxiv.org/abs/1907.06554
99. Kuhn, Gal & Farquhar, CLAM: selective clarification. https://arxiv.org/abs/2212.07769
100.  Andukuri et al. (2024), STaR-GATE. https://arxiv.org/abs/2403.19154
101.  Laban et al., LLMs get lost in multi-turn conversation. https://arxiv.org/abs/2505.06120
102.  Deng et al. (2023), Survey on proactive dialogue systems. https://arxiv.org/abs/2305.02750
103.  Horvitz (1999), Principles of mixed-initiative user interfaces. https://erichorvitz.com/chi99horvitz.pdf
104.  Amazon, Alexa Hunches: act proactively. https://developer.amazon.com/en-US/blogs/alexa/device-makers/2020/12/Enable-Alexa-to-Proactively-Act-on-Hunches

**Social response to machines**

105. Nass et al. (1995), Can computer personalities be human personalities? (CHI). https://chi1995.chistatic.hosting.acm.org/proceedings/shortppr/cns_bdy.htm
106. Kühne et al. (2020), The human takes it all: no auditory uncanny valley. https://www.frontiersin.org/article/10.3389/fnbot.2020.593732
107. Schreibelmayr & Mara (2022), Robot voices: human-likeness and acceptance. https://www.frontiersin.org/articles/10.3389/fpsyg.2022.787499/pdf

**Method note:**

- Sources were gathered by web search and direct page reads on 20 Nov 2026.
- Where only an abstract or a secondary summary was available, the tag in the text reflects that.
- Vendor prices were read from the vendors' own pages where possible (OpenAI, ElevenLabs). Gemini and Hume figures are third-party and should be checked before budgeting.
- The Hume sunset notice was seen in Hume's developer docs as indexed by search and in a third-party migration guide. Confirm in the Hume console if it matters.
