# Voice transport: sideband vs relay — decision on mock evidence

Workstream A, RECOVERY-2026-10 (TRACKING A8, audit C-08). Founder rule 2026-10-08: no billable live AI calls without his explicit approval. **Everything below is MOCK evidence.** Nothing here was measured against OpenAI.

## Decision

**Default: relays over one route handler with deadlines (`ROUTE`). The sideband ships behind `CQ_VOICE_REALTIME_SIDEBAND=on`, off by default, until a live run confirms it.**

Why, on the mock evidence:

1. **Most of the gain comes from leaving server actions, and `ROUTE` already has it.** Server actions run one at a time per tab. Moving the relays to fetches gives this:
   - recovery from a dropped call fell from 4,000 ms to 450 ms, because the rejoin no longer waits behind the `heard` relay holding an ask_q;
   - on a busy page, turn end → answer delivered fell by about 280 ms at p50.
2. **The sideband's remaining gain is one browser hop:** about 60 ms at p50 and 125 ms on a busy page in the mock. That is small next to Q's own work (1.5–6 s) and the model's first audio (0.45–0.9 s). It is not worth making an unverified transport the default on the core voice path.
3. **Reliability is the same on all three transports.** The turn ledger (A4) brings every accepted turn to a terminal disposition, including injected failures: 60/60 on each. The guarantee lives in the browser line and the broker, not in the transport.
4. **What the sideband adds that relays cannot**, and why it stays built:
   - usage recorded from the provider's own events, rather than only from browser reports;
   - realtime `error` events and failed responses in the server log;
   - first-audio latency measured on the server;
   - delivery that does not depend on the browser's relay finishing.

   These are worth turning on once a live call shows the WebRTC sideband accepts `conversation.item.create` and `response.create`. The guide documents only `session.update` and tool results for it.

## Mock results

Source: `apps/web/test/voice-transport-harness.test.ts`, seed 20261008. The **shipped** browser line (`DuplexLine`) runs against a simulated provider (data-channel events, with seeded, configurable timings) and simulated relays, in fake time. Provider latencies are inputs (`DEFAULT_TIMINGS`):

- transcription: 250–700 ms;
- response.create to first audio: 450–900 ms;
- ask_q: 1.5–6 s, with 5% taking 24 s;
- relay RTT: 120 ms;
- server↔provider and browser↔provider: 40 ms each.

So the numbers measure Capital Q's own overhead and failure handling. `ACTION_QUEUE` keeps the fixed line and serializes its relays the way Next.js runs server actions, together with the 1.5 s turn poll. That isolates the transport effect. It is not the old line with its lost-turn defects; those are covered by the unit tests named in the A report.

Regenerate with `VOICE_HARNESS_WRITE=1 npx vitest run apps/web/test/voice-transport-harness.test.ts`, which writes `voice-transport.generated.md` next to this file.

### Injected failures: 2% realtime errors on the answer, 1% failed responses, 1% lost relays, 5% slow ask_q

| Transport    | Terminal turns | Dispositions          | Turn end → answer delivered p50 / p95 (ms) | Turn end → first audio p50 / p95 (ms) | Cost per turn (USD) |
| ------------ | -------------- | --------------------- | ------------------------------------------ | ------------------------------------- | ------------------- |
| ACTION_QUEUE | 60/60          | ANSWERED 59, FAILED 1 | 4544 / 6764                                | 5131 / 7563                           | 0.0257              |
| ROUTE        | 60/60          | ANSWERED 59, FAILED 1 | 4544 / 6638                                | 5131 / 7458                           | 0.0257              |
| SIDEBAND     | 60/60          | ANSWERED 59, FAILED 1 | 4484 / 6578                                | 5071 / 7398                           | 0.0257              |

Most injected faults are recovered without a FAILED:

- a realtime error caused by an active response is retried once that response is done;
- a lost relay falls back to the forced ask_q path.

### Busy page: poll every 500 ms taking 400 ms, relay RTT 250 ms

| Transport    | Terminal turns | Delivered p50 / p95 (ms) | First audio p50 / p95 (ms) |
| ------------ | -------------- | ------------------------ | -------------------------- |
| ACTION_QUEUE | 20/20          | 5863 / 25017             | 6385 / 25615               |
| ROUTE        | 20/20          | 5585 / 24928             | 6243 / 25526               |
| SIDEBAND     | 20/20          | 5460 / 24803             | 6118 / 25401               |

### Forced reconnect: the call fails 1 s into a 4 s ask_q

| Transport    | Drop → listening (ms) | Turns lost across it |
| ------------ | --------------------- | -------------------- |
| ACTION_QUEUE | 4000                  | 0                    |
| ROUTE        | 450                   | 0                    |
| SIDEBAND     | 450                   | 0                    |

The answer that comes back after the rejoin is said on the new call. That is C-04, fixed. At baseline it was dropped, and the screen stayed on "Thinking".

### Cost per turn

Cost comes from the gateway's price tables (`OPENAI_REALTIME_MINI_PRICES` and `OPENAI_TRANSCRIBE_PRICES` in `packages/model-gateway/src/realtime/openai.ts`). The token counts per turn are assumptions:

- audio: about 10 tokens/s in and about 20 tokens/s out;
- instructions: 3,200 text tokens, cached after the first response;
- history: about 220 text tokens a turn, plus the conversation's audio re-read on each response.

The averages differ by scenario: about $0.026 per turn over 60 turns, and about $0.011 over 20. The cost grows with the length of the line because history is re-read. The transport does not change token use. **Live usage events (`ai_ops.model_usage`, purpose VOICE_REALTIME) replace these assumptions.**

## What still needs live confirmation

1. Provider latencies. Transcription time and response.create → first audio are inputs to the mock, not results.
2. That the WebRTC sideband (`wss://api.openai.com/v1/realtime?call_id=…`) accepts `conversation.item.create` and `response.create`, and that the browser plays the response the server asked for. The connector and broker code are tested only with a fake socket.
3. How long the sideband stays up through long silence (community reports say it drops), and whether bounded re-attach covers it.
4. Behaviour of `response.create` while another response is active. The line queues and retries it once on `conversation_already_has_active_response`; the exact error code is assumed.
5. Real audio token rates, and the cost per turn from `ai_ops.model_usage`.
6. Vercel's function duration limit for the relay route. `heard` can hold up to 38 s, the browser deadline.

## Local live procedure (founder's machine, his microphone, existing configuration)

This needs the founder's explicit approval, because it spends on his own OpenAI key. Expected spend is in step 5. No new keys. Nothing here prints a secret. Never paste `.env.local` contents anywhere.

1. Use Capital Q's existing local configuration (`.env.local`, already holding the OpenAI key).
   - Add or confirm these lines yourself in an editor, never by echoing the key: `CQ_VOICE_REALTIME=on`, `CQ_VOICE_REALTIME_DAILY_CAP_USD=1`, `CQ_VOICE_REALTIME_SIDEBAND=off`.
   - The daily cap is enforced server-side and fails closed.
2. Start the stack: `pnpm dev`, with the local Supabase from the repository's usual setup. Open the app, sign in as yourself, and start voice from the Q dock.
3. Run the manual script `voice-manual-test.md` once, about 15 turns. Then stop voice.
4. Set `CQ_VOICE_REALTIME_SIDEBAND=on`, restart `pnpm dev`, and run the same script again.
5. Expected cost per run, from the mock assumptions: 15 turns × about $0.01–0.03 = **about $0.15–0.45**. The daily cap stops the line at $1 in any case.
6. Compare the two runs from the q-api log. These lines carry ids and milliseconds only:
   - per turn, `"duplex voice turn"`: `disposition`, `firstAudioMs`, `relayMs`;
   - sideband run only, `"duplex sideband first audio"` (`firstAudioMs`), `"duplex sideband realtime error"` and `"duplex sideband response did not complete"`;
   - per line, `"duplex voice line ended"`: `firstAudioMsP50`, `firstAudioMsMax`, `rejoins`, `spentUsd`.

   For example, to extract them from a log saved to a file:

   ```bash
   grep '"duplex voice turn"' q-api.log | jq -c '{d: .disposition, f: .failure, firstAudioMs, relayMs}'
   grep '"duplex voice line ended"' q-api.log | jq -c '{line, spentUsd, rejoins}'
   ```

7. Record p50/p95 first audio, terminal turns / accepted turns, and spend per turn for both runs in a new "Live" section of this file. The sideband becomes the default only if it is at least as reliable (every turn terminal, no `sideband realtime error` for our own events) **and** faster at p50.
