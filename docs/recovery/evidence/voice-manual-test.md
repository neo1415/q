# Voice manual test: real microphone (required before production)

Workstream A, RECOVERY-2026-10. Run this on a **local** or **private staging** stack, never production, with your own microphone and speakers (headphones off for the echo checks, on for the rest). It spends on the existing OpenAI key: about $0.15–0.45 per full run, and the daily cap (`CQ_VOICE_REALTIME_DAILY_CAP_USD`, default $1) stops it in any case. It needs the founder's approval before it is run. Setup and the log commands are in `voice-transport.md` ("Local live procedure").

Every step has an **expected** result. Mark each one PASS or FAIL. Most rows also say what to check in `q_runtime.voice_line_turns` and in the q-api log.

How to read the evidence:

- **Log.** Each turn writes one q-api log line, `"duplex voice turn"`, with `turnId`, `disposition` (ANSWERED, CLARIFIED, ACTED, FAILED, CANCELLED, SUPERSEDED or IGNORED), `failure` and `firstAudioMs`/`relayMs`. The browser console shows `[q-voice] turn` with the same fields.
- **Database.** `voice_line_turns` holds one USER row per heard turn (`routed` = `ask_q`, `smalltalk` or `model_only`) and one Q row per spoken reply, ordered by `spoken_at`. Query it with your own id only:

  ```sql
  select role, routed, typed, left(content, 80), spoken_at
  from q_runtime.voice_line_turns
  where voice_session_id = '<the session id from the "duplex voice line minted" log>'
  order by spoken_at;
  ```

- **No silent turns.** Every USER row must have one of these: a following Q row; a `"duplex voice turn"` log line with IGNORED, FAILED, CANCELLED or SUPERSEDED; and, for IGNORED or FAILED, a sentence on screen.

## 0. Start

| #   | Do                                           | Expect                                                                                                                                      | Evidence                                                                                            |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 0.1 | Open Home and start voice.                   | "Connecting", then Q opens in its own natural voice: the server's opener, not robotic. The presence moves while you talk and while Q talks. | Log `"duplex voice line minted"`. With the sideband on, also `"duplex sideband attached"`.          |
| 0.2 | Say "Find anything that needs my attention." | Q answers from your records, with cards on screen.                                                                                          | USER row `routed = ask_q`, then a Q row. `"duplex voice turn"` ANSWERED, with `firstAudioMs` noted. |
| 0.3 | Say "Thanks!"                                | A few warm words. No facts, no offer.                                                                                                       | USER row `routed = smalltalk`.                                                                      |

## 1. Interrupting mid-answer

| #   | Do                                                                                                            | Expect                                                                      | Evidence                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1.1 | Ask "Walk me through my top five investors." While Q is mid-sentence, say clearly "Wait, just the first one." | Q dips, then stops within about half a second, and answers the new request. | Earlier turn ANSWERED; new turn ANSWERED. The Q row of the cut answer holds only what was heard (truncated). |
| 1.2 | While Q answers, say just "No."                                                                               | Q stops. "No" is treated as your turn, not discarded.                       | USER row "No." exists (C-11).                                                                                |
| 1.3 | Type a question in the dock while Q is speaking.                                                              | Q stops and answers the typed one aloud.                                    | USER row `typed = true`.                                                                                     |

## 2. A cough during generation

| #   | Do                                                                                             | Expect                                                                                          | Evidence                                                       |
| --- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 2.1 | Ask something substantive. Right after you stop, while the screen says "Thinking", cough once. | The answer still comes. The cough does not cancel it (C-07).                                    | Turn ANSWERED. No USER row for the cough.                      |
| 2.2 | Ask again. When Q starts speaking, cough or knock on the desk for about a second.              | Q stops for the noise, then carries on with its answer without repeating it (the noise repair). | One Q row continues the same answer; there is no new USER row. |
| 2.3 | Hum "mm" briefly while Q speaks.                                                               | Q keeps going.                                                                                  | No USER row.                                                   |

## 3. A long pause

| #   | Do                                                                                 | Expect                                                                                                                                                            | Evidence                                                                                     |
| --- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 3.1 | Ask for something slow ("Build me a fundraising strategy."), then wait in silence. | Short "working" lines in Q's own voice, then the answer. If it passes 30 s: one spoken sentence that it took too long, and "Listening". Never "Thinking" forever. | ANSWERED, or FAILED with failure `TIMEOUT` and the line "That one is taking longer…".        |
| 3.2 | Stay silent for longer than the idle window (30 s by default).                     | Voice ends with a visible "Voice paused after a quiet spell…" notice. It is not silent.                                                                           | Log `"duplex voice line ended"` reason `IDLE`.                                               |
| 3.3 | Say something to someone else in the room ("Sam, can you close the door?").        | Q does not answer it. The screen shows "Not answered: that didn't sound meant for me…".                                                                           | USER row; `"duplex voice turn"` IGNORED. There is no Q row, and the voice did not improvise. |

## 4. Navigating mid-call

| #   | Do                                                                                         | Expect                                                                                                | Evidence                                                                                         |
| --- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 4.1 | Say "Take me to Discover", then "Open the second investor", then "Show their mandate."     | The pages change and the call keeps going. There is no reconnect sound and no second greeting.        | One `voice_session_id` for the whole sequence. No `"duplex voice line ended"` between the pages. |
| 4.2 | Click to another page yourself during an answer.                                           | Q keeps speaking. The call survives the route change.                                                 | Same as above.                                                                                   |
| 4.3 | With an arrival-briefing card in focus, say "Send it", then "What does Halyard invest in?" | "Send it" goes to the card. The question is answered by Q, not by the card or the voice alone (C-03). | USER rows `routed = model_only`, then `ask_q`.                                                   |

## 5. Nigerian English phrases

Say each phrase naturally, in your own accent.

| #   | Say                                                        | Expect                                                                           |
| --- | ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 5.1 | "Abeg, show me the investors wey fit my raise."            | Q answers with investors. It is not IGNORED.                                     |
| 5.2 | "I wan know how my readiness dey."                         | Q gives your readiness.                                                          |
| 5.3 | "Find anything that needs my attention, I beg."            | The same as 0.2.                                                                 |
| 5.4 | "No wahala, go ahead." (after Q asked whether to go ahead) | Treated as your yes to the proposal on screen. Nothing is sent without the card. |
| 5.5 | "Ehen, so what next?"                                      | A clear answer, or one short clarifying question. Never silence.                 |

Evidence: compare each USER row's `content` (the transcript) with what you said. Note any garbled transcription, because it goes to the transcription hint work. Each turn must have a terminal `"duplex voice turn"`.

## 6. A network drop

| #   | Do                                                                                                         | Expect                                                                                                                                                                      | Evidence                                                |
| --- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 6.1 | Ask a slow question. While it is "Thinking", turn Wi-Fi off for about 5 s, then on.                        | "Reconnecting…", then the answer is said on the new call. It is not lost (C-04).                                                                                            | Log `"duplex voice line rejoined"`; that turn ANSWERED. |
| 6.2 | Turn Wi-Fi off for 60 s.                                                                                   | A visible "switching to my standard voice". The conversation continues on the standard line.                                                                                | `"duplex voice line ended"` reason FALLBACK.            |
| 6.3 | (Local stack) Restart q-api (`Ctrl-C`, then `pnpm dev` in `apps/q-api`) during a call, then ask something. | The question is answered: the line is adopted from its sealed token (A11). If adoption fails, the screen shows "I lost that last request while reconnecting. Say it again?" | Log `"duplex voice line adopted"`.                      |

## 7. Standard line (duplex off)

Set `CQ_VOICE_REALTIME=off` and repeat 0.2, 3.1 and 3.3.

Expect: the same answers, a visible sentence for an ignored or timed-out turn, and never more than 14 s of "Thinking" without a word.

## Sign-off

Record these in `voice-transport.md` ("Live"):

- the date;
- whether the run was local or private staging;
- whether the sideband was on or off;
- PASS/FAIL per row;
- first-audio p50/p95 from the log;
- spend from `"duplex voice line ended"` `spentUsd`.

Production needs every row PASS, or a FAIL with a stated, accepted reason.
