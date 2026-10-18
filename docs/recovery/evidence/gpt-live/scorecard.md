# GPT-Live acceptance recordings: scorecard

These are real provider sessions. A is `gpt-live-1`, as reported by the provider's own `session.started`. B is `gpt-realtime-mini`, as reported by `session.created`.

The user side is **synthetic**: `gpt-4o-mini-tts`, instructed to speak with a Lagos Nigerian English accent. It is not a human speaker.

The recordings come from `scripts/recovery/live/harness.mjs`, and the table from `scripts/recovery/live/scorecard.mjs`. Each WAV mixes both sides. The user's audio is streamed in real time as one continuous microphone stream.

These are measurements only. **Whether Q sounds natural is the founder's call, made by ear.**

## How to read it

- **Latency:** time from the end of the user's last speech chunk to Q's first voiced output audio. GPT-Live streams silence too, so "voiced" means audio energy above a threshold.
- **Filler hits:** matches against a list of stalling phrases in Q's own transcript: "let me put/pull that up", "one moment", "I'm thinking", "give me a second", "great question", "hold on", "hang on", "bear with me".
- **Delegations:**
  - `local`: Q Brain on the local recovery stack, reached through `POST /v1/q/runs` as `investor.savanna-seed`.
  - The model behind Q Brain is the stack's **scripted fake**. The "top N fits" answers are code-built from computed fits, so they are real Q output.
  - For a request with no script rule, the voice was told the backend returned nothing, and it invented nothing.
  - `offline`: no Q Brain at all, and the voice was told so.
- **B baseline:** the same personality prompt, minus delegation, run standalone with semantic VAD. It is **not** the full routed duplex line the product runs.

## Table (final takes, 2026-10-09)

| #   | Scenario                    | Line | Model             | Billed s | Cost   | Latency ms (median, max) | Filler hits | Delegations | Usage confirmed |
| --- | --------------------------- | ---- | ----------------- | -------- | ------ | ------------------------ | ----------- | ----------- | --------------- |
| 0   | call-opening-briefing       | A    | gpt-live-1        | 37       | $0.031 | 1451, 1451               | 0           | 2 (local)   | yes             |
| 1   | pidgin-greeting             | A    | gpt-live-1        | 26       | $0.022 | 1323, 1323               | 0           | 0           | yes             |
| 1   | pidgin-greeting             | B    | gpt-realtime-mini | 25       | $0.006 | 4823, 4823               | 0           | 0           | tokens          |
| 2   | humour                      | A    | gpt-live-1        | 46       | $0.038 | 1110, 1110               | 0           | 0           | yes             |
| 3   | hesitant-question           | A    | gpt-live-1        | 41       | $0.034 | 1543, 1543               | 0           | 0           | yes             |
| 3   | hesitant-question           | B    | gpt-realtime-mini | 22       | $0.007 | 1063, 1063               | 0           | 0           | tokens          |
| 4   | interruption                | A    | gpt-live-1        | 24       | $0.023 | 1139, 1139               | 0           | 0           | yes             |
| 4   | interruption                | B    | gpt-realtime-mini | 39       | $0.017 | 4747, 4747               | 0           | 0           | tokens          |
| 5   | change-of-mind              | A    | gpt-live-1        | 32       | $0.030 | 1826, 1826               | 0           | 0           | yes             |
| 5   | change-of-mind              | B    | gpt-realtime-mini | 39       | $0.015 | 3959, 3959               | 0           | 0           | tokens          |
| 6   | top-three-delegated         | A    | gpt-live-1        | 33       | $0.028 | 1606, 1606               | 0           | 2 (local)   | yes             |
| 7   | talk-while-researching      | A    | gpt-live-1        | 33       | $0.030 | 1011, 1011               | 0           | 1 (local)   | yes             |
| 8   | facts-arrive-while-speaking | A    | gpt-live-1        | 51       | $0.045 | 632, 632                 | 0           | 1 (local)   | yes             |
| 9   | frustrated-user             | A    | gpt-live-1        | 57       | $0.048 | 1601, 1601               | 0           | 1 (offline) | yes             |
| 10  | five-minute-conversation    | A    | gpt-live-1        | 299      | $0.249 | 1124, 1773               | 0           | 4 (local)   | yes             |

## Observations, from the transcripts

**Understanding and accent.**

- Every take transcribed the Pidgin and Nigerian English inputs correctly.
- Q answers in standard English.
- One early take read "Guy, how far?" as frustration. The prompt fix corrected it; that take was replaced.

**Call opening (0).**

- GPT-Live does **not** speak first by itself. In the first take, Q stayed silent until the user spoke.
- The app now starts both halves of the opening:
  - the greeting, as `session.instructions.append`;
  - the briefing, as its own Q run, spoken through `session.commentary.append` when it lands.
- Q said "Hey Amaka, good to connect." and then gave the lowdown in its own words: "Ajopot and Ledgerfold are your strongest fits right now, tied at the top. Clinicrest is next…".
- The briefing is Q's code-built fit ranking. `GET /v1/q/attention` answers 500 on this branch (a Zod "unrecognized key: detail" on an item); that is a defect outside V.

**Top three, then "the second one?" (6).**

- Results are summarised, not read out: "The top two are Ajopot and Ledgerfold, tied at 8. Then Clinicrest at 6."
- The reference held: "the second one" resolved to the tied fit at 8. The follow-up's deeper "why" got no verified answer (the scripted model has no rule), and Q said so instead of inventing one.
- An earlier take paraphrased Q's "3 of 6 measures known" as "matches on three out of six". The prompt now requires every fact to keep its exact meaning; the final take did not repeat the drift.
- An earlier take also said "Hang on, I'm pulling them up". The prompt now forbids announcing fetches, and the final take has none.

**Talking while Q Brain works (7).** Q gave the fit result, then answered the pro rata question asked during the wait. The two were not conflated.

**Facts arriving while speaking (8).** Q gave the verified top five (ties said as ties), then carried on into first-call advice.

**Interruption (4, A).** Q stopped mid-sentence and gave the one-sentence version. B finished its long answer before giving the short one.

**Change of mind (5, A).** Q dropped the email answer mid-phrase and went straight to call preparation.

**Five minutes (10).**

- 14 turns, plus continuous audio to 299 s, with no filler hits.
- GPT-Live still delegates some advice questions to the backend (4 delegations). With the scripted model those come back empty, and Q answers them itself.
- One odd line remains: "I'll think it through straight with what you told me."
- Against a real model, delegating advice costs time rather than accuracy. This is worth one more pass on the delegation policy after the founder listens.

**Problems fixed in the prompt along the way:**

- "I'm here" openers, `um`/`hmm`, and a "[chuckle]".
- Delegating general questions.
- Prompt leakage ("Missing evidence is not bad news" spoken aloud).
- Fetch announcements.
- Fact paraphrase drift.

## Developer preview (`/dev/voice-preview`)

Option A was driven in Chromium with a fake microphone. Screenshot: `voice-preview-A.png`.

- **Proven:**
  - The page offers its SDP to the Q API.
  - The Q API creates a real GPT-Live WebRTC session; the key stays in q-api.
  - The provider's 201 names `gpt-live-1`, and the page shows it.
- **Not proven here:** media never connected.
  - The sandbox has no UDP egress.
  - The answer's ICE-TCP candidates (port 443) cannot be reached through the sandbox's HTTP proxy.
  - So `session.started`, transcripts and audio need a normal network, such as the founder's machine.
- Three such sessions were billed at OpenAI's 15 s minimum each; they are in the spend ledger.
