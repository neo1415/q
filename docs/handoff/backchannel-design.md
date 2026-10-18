# Backchannels on the duplex line (backchannel-61)

**Goal (founder, verbatim):** "not just hmm mm… it should sound like how you are talking to a human… don't make it annoying… if someone asks it to stop, it actually does… fully dynamic, not hardcoded."

## Mechanism chosen

1. **Out-of-band responses (OpenAI Realtime, `response.create` with `conversation: "none"`).**
   - A reaction or a bridging line is a separate response.
   - It never enters the conversation, so Q's memory of the call and its turns are unchanged.
   - Settings on each one:
     - `output_modalities: ["audio"]`;
     - `max_output_tokens` 40 for a reaction (under a second) and 90 for a bridge;
     - `tools: []` and `tool_choice: "none"`;
     - `metadata` that tags it;
     - its own server-owned `instructions`, with an `input` that holds only what it needs.
   - The browser plays it at 60% volume, never shows it as a transcript line, ignores any function call it proposes, and cuts it if its transcript turns into a sentence or contains a number.
2. **When: deterministic code, not the model** (`apps/web/src/features/voice/provider/backchannel.ts`).
   - A local energy detector on the person's microphone finds mid-turn pauses. No audio leaves the browser for this.
   - The provider's `semantic_vad` says whether the turn is still open. Eagerness is `auto` while reactions are on and `high` when they are Off, so pauses that sound unfinished stay inside the turn.
   - A reaction is due only when all of these hold:
     - the person is inside a turn and in a pause, never while they are voiced, so never mid-word;
     - the pause is at least 350 ms (Natural) or 450 ms (Subtle), adapted up to 650 ms for a person who pauses longer, and at most 900 ms;
     - the turn already has enough speech, so a quick command gets none;
     - there has been enough speech and time since the last reaction;
     - the turn has not used up its budget (2 per turn on Subtle, 5 on Natural);
     - Q is not speaking, answering or working.
   - Density adapts:
     - A reaction the person talks over backs off the next ones, up to 3×. One that is heard to the end relaxes that again.
     - A long turn (a story of 15 s or more) gets more.
     - So does an engaged moment: the model chose more than a bare continuer.
3. **What: the model, with live context.**
   - At the pause, the browser commits the audio so far. A manual commit starts no response of its own.
   - The reaction then references only this turn's audio items, so the model hears the person's words and their tone.
   - It also gets a short note: Q's last sentence, the transcript of this turn so far (from `gpt-4o-mini-transcribe`), and the reactions it already used, so it does not repeat them.
   - The instructions describe continuers, assessments, empathy tokens and a soft laugh. They are examples to choose from, not a list.
   - The person resuming cancels the reaction at once: `response.cancel` with its id, `output_audio_buffer.clear`, and local muting.
4. **The thinking filler.** On duplex, "hmm" and "One moment" are replaced by a bridge.
   - It happens only when `ask_q` takes longer than 700 ms; a fast answer gets silence.
   - The model writes one line of at most eight words from the person's own request (for example "Let me pull up Kazikit's numbers").
   - It never states a fact or a result, and it varies from the recent bridges.
   - Q's answer waits until the bridge has finished, for at most 2.5 s.
   - The standard voice keeps its timed "Hm" beats. A generated bridge there would need an extra Model Gateway call on every slow turn and would race the answer, so it was not cheap there.
5. **Control.**
   - **By voice.** "Stop doing that", "less of that" and "you can react more" lead the main model to call the duplex-only tool `set_listening`, with a change from a closed set and the person's quote.
     - The broker applies the level deterministically: LESS and MORE move one step.
     - The level takes effect on the line at once.
     - It is kept as the memory preference `preference.voice.listening`, through the Write Gate (`Q_PROPOSED`). The gate checks the quote against the provider's own transcript of the person, not against the model's words.
     - Q confirms once, in a few words.
   - **In Settings.** Settings → Q's voice → Listening sounds offers Off, Subtle (the default) and Natural.
     - The choice is kept on this device. The line uses whichever was set more recently: this toggle or the remembered voice preference.
     - The toggle stays on the device because a new hand-written mutation route would exceed the ADR 0040 ceiling.
   - Off also turns bridges off.
   - The kill switch is `CQ_VOICE_REALTIME_BACKCHANNEL=off` on q-api. With it, duplex runs exactly as before, with no transcription.

**Rejected alternatives:**

- **The main model backchannels on its own.** VAD only hands it the turn at the end, so it cannot react mid-turn, and anything it says would enter the conversation.
- **Client-controlled turn-taking (`create_response: false`).** It adds a hold to every answer.
- **A text "decide" pass followed by an audio pass.** Two round trips miss a 300 to 800 ms pause.

This follows the published behaviour of continuers and assessments at prosodic pauses (voice-activity-projection work such as "Yeah, Un, Oh", arXiv 2410.15929). It also follows OpenAI's out-of-band pattern (`conversation: "none"`, `input` with `item_reference`).

## Cost (gpt-realtime-mini: audio $10/M in, $20/M out; text $0.60/M in, $0.06/M cached; gpt-4o-mini-transcribe: $3/M audio)

| Item                                 | Per event                                                                                                                            | Per minute of conversation                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| Reaction                             | About 420 instruction tokens (mostly cached), 60 to 150 audio tokens of this turn, and about 15 audio tokens out. **≈ $0.001–0.002** | Subtle 1 to 3: **≈ $0.003**. Natural up to 6: **≈ $0.01** |
| Bridge (only when an answer is slow) | Text in, about 1.5 s of audio out. **≈ $0.001**                                                                                      | ≤ $0.001                                                  |
| Input transcription                  | —                                                                                                                                    | ≈ $0.002 (the person's speech only)                       |
| **Added in total**                   |                                                                                                                                      | **Subtle ≈ $0.005/min, Natural ≈ $0.012/min**             |

The base cost of duplex is about $0.10 to $0.20 a minute, so this adds about 3 to 8%.

Every reaction, bridge and transcription is reported per response and written to `ai_ops.model_usage` under `VOICE_REALTIME`. They count under the same daily cap and the per-line reservation.

The transcription rows carry the session's realtime model id. They are priced at the transcriber's own rates, and their `costBasis` is `ESTIMATED`.

## Risks to watch live

- **A manual commit in the middle of a turn.** It must not end the person's turn. The policy treats speech that resumes within 2 s as the same turn.
- **Echo.** Q's own reaction leaking into the microphone would cut it. A headset or echo cancellation avoids this.
- **Turn ends under `auto` eagerness.** They may wait up to about 1 s longer when a sentence sounds unfinished.
