# GPT-Live acceptance recordings: scorecard

These are real provider sessions. A is `gpt-live-1`, as the provider's own `session.started` reports it. B is `gpt-realtime-mini`, as reported by `session.created`.

The user's side is **synthetic**: `gpt-4o-mini-tts`, instructed to speak with a Lagos Nigerian English accent. It is not a human speaker.

The recordings come from `scripts/recovery/live/harness.mjs` and this table from `scripts/recovery/live/scorecard.mjs`. Each WAV mixes both sides, with the user streamed in real time as one continuous microphone stream.

Numbers are measurements only. **Whether Q sounds natural is the founder's call, by ear.**

## How to read it

- **Latency:** time from the last chunk of the user's speech to Q's first voiced output audio. Q counts as voiced when the audio's energy is above a threshold, because GPT-Live streams silence too.
- **Filler hits:** a regex list ("let me put that up", "one moment", "I'm thinking", "give me a second", "great question", "hold on", "bear with me"), checked against Q's own transcript.
- **Delegations:** `offline` means Q Brain was not connected in that take. The voice was told so truthfully, and nothing was invented. `local` means Q Brain ran on the local recovery stack with the scripted model, via `POST /v1/q/runs`.
- **B baseline:** the same personality prompt (minus delegation), standalone with semantic VAD. It is **not** the full routed duplex line the product runs.

## Table (takes as of 2026-10-09 04:10 UTC)

| #   | Scenario                 | Line | Model             | Billed s | Cost   | Latency ms (median, max) | Filler hits | Delegations | Usage confirmed |
| --- | ------------------------ | ---- | ----------------- | -------- | ------ | ------------------------ | ----------- | ----------- | --------------- |
| 1   | pidgin-greeting          | A    | gpt-live-1        | 26       | $0.022 | 1323, 1323               | 0           | 0           | yes             |
| 1   | pidgin-greeting          | B    | gpt-realtime-mini | 25       | $0.006 | 4823, 4823               | 0           | 0           | tokens          |
| 2   | humour                   | A    | gpt-live-1        | 46       | $0.038 | 1110, 1110               | 0           | 0           | yes             |
| 3   | hesitant-question        | A    | gpt-live-1        | 41       | $0.034 | 1543, 1543               | 0           | 0           | yes             |
| 3   | hesitant-question        | B    | gpt-realtime-mini | 22       | $0.007 | 1063, 1063               | 0           | 0           | tokens          |
| 4   | interruption             | A    | gpt-live-1        | 24       | $0.023 | 1139, 1139               | 0           | 0           | yes             |
| 4   | interruption             | B    | gpt-realtime-mini | 39       | $0.017 | 4747, 4747               | 0           | 0           | tokens          |
| 5   | change-of-mind           | A    | gpt-live-1        | 32       | $0.030 | 1826, 1826               | 0           | 0           | yes             |
| 5   | change-of-mind           | B    | gpt-realtime-mini | 39       | $0.015 | 3959, 3959               | 0           | 0           | tokens          |
| 9   | frustrated-user          | A    | gpt-live-1        | 57       | $0.048 | 1601, 1601               | 0           | 1 (offline) | yes             |
| 10  | five-minute-conversation | A    | gpt-live-1        | 300      | $0.268 | 1090, 1700               | 0           | 3 (offline) | yes             |

## Observations, from the transcripts

**Understanding.**

- Every take transcribed the Pidgin and Nigerian English inputs correctly ("Guy, how far? Wetin dey happen", "I beg, wetin you fit help me with today").
- After the founder's clarification, Q answers in standard English.
- One earlier take read "Guy, how far?" as frustration. The prompt now says a casual Pidgin greeting is friendly, and the next take greeted warmly.

**Interruption (4, A).**

- Q stopped mid-sentence ("…gives an investor the right to get equity later,") and gave the one-sentence version.
- B finished its long answer before the short one, because its response had already been generated.

**Change of mind (5, A).** Q dropped the email answer mid-phrase ("in plain—") and went straight to call preparation ("Right. For a first call…").

**Hesitation (3, A).** Q backchanneled through the pauses ("Go on. Take your time.") and answered only once the question was complete.

**Problems these takes exposed, and the prompt changes made:**

- "I'm here" openers, "um/hmm", and a "[chuckle]" in the humour take. Q now has no presence announcements, no fillers of its own and no laughter sounds.
- Delegating general questions, such as the bridge round in 3. General knowledge, advice, and the person's own numbers are now answered directly.
- **Prompt leakage.** In the first 5-minute take, Q said aloud "Missing evidence is not bad news" (a prompt line), and delegated "let's run the numbers" on figures the user had just given. That take is from before the fix and **needs a re-take**.

## Pending

- **Scenario 0**, the briefing opening: a warm hello by name, then the briefing via delegation.
- **Scenario 6**, the top three explained, then "what about the second one?".
- **Scenario 7**, talking while Q Brain researches.
- **Scenario 8**, facts arriving while Q is speaking.
- **Scenario 10**, a re-take.

All of these need Q Brain on the shared local stack, and wait for the lead's window.
