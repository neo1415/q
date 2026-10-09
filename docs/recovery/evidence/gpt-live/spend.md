# GPT-Live live-test spend ledger

The founder authorized this on 2026-10-09, for GPT-Live work only, using the existing OpenAI project credentials.

- **Cap for this workstream:** $3.00 total. That covers GPT-Live session time, the TTS that generates test inputs, and any OpenAI Realtime baseline sessions.
- **Price:** gpt-live-1 is $0.05 per minute, billed per second. The figure for each row is the `usage.seconds` value from `session.closed`; if a session never closed cleanly, the row uses the last `session.usage.updated` value and is marked unconfirmed.
- **Runaway protection:** every session has a hard client-side close at 3 minutes, or 6 minutes for the five-minute conversation test.

| When (UTC) | Who  | What                                                               | Billed seconds | Est. cost            | Running total |
| ---------- | ---- | ------------------------------------------------------------------ | -------------- | -------------------- | ------------- |
| 2026-10-09 | lead | Smoke test: TTS input (3.3 s, gpt-4o-mini-tts), 1 GPT-Live session | 13             | $0.011 + ~$0.001 TTS | $0.012        |
