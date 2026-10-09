# GPT-Live live-test spend ledger

The founder authorized this on 2026-10-09, for GPT-Live work only, using the existing OpenAI project credentials.

- **Cap for this workstream:** $3.00 total. That covers GPT-Live session time, the TTS that generates test inputs, and any OpenAI Realtime baseline sessions.
- **Price:** gpt-live-1 is $0.05 per minute, billed per second. The figure for each row is the `usage.seconds` value from `session.closed`; if a session never closed cleanly, the row uses the last `session.usage.updated` value and is marked unconfirmed.
- **Runaway protection:** every session has a hard client-side close at 3 minutes, or 6 minutes for the five-minute conversation test.

| When (UTC) | Who  | What                                                               | Billed seconds | Est. cost            | Running total |
| ---------- | ---- | ------------------------------------------------------------------ | -------------- | -------------------- | ------------- |
| 2026-10-09 | lead | Smoke test: TTS input (3.3 s, gpt-4o-mini-tts), 1 GPT-Live session | 13             | $0.011 + ~$0.001 TTS | $0.012        |
| 2026-10-09 03:51 | workstream V | Scenario 1 pidgin-greeting on gpt-live-1 + TTS inputs | 106 | $0.091 | $0.103 |
| 2026-10-09 03:53 | workstream V | Scenario 1 pidgin-greeting on gpt-live-1 | 27 | $0.023 | $0.126 |
| 2026-10-09 03:53 | workstream V | Scenario 2 humour on gpt-live-1 + TTS inputs | 38 | $0.035 | $0.161 |
| 2026-10-09 03:54 | workstream V | Scenario 3 hesitant-question on gpt-live-1 + TTS inputs | 35 | $0.032 | $0.193 |
| 2026-10-09 03:55 | workstream V | Scenario 4 interruption on gpt-live-1 + TTS inputs | 24 | $0.023 | $0.216 |
| 2026-10-09 03:55 | workstream V | Scenario 5 change-of-mind on gpt-live-1 + TTS inputs | 32 | $0.030 | $0.246 |
| 2026-10-09 03:56 | workstream V | Scenario 9 frustrated-user on gpt-live-1 + TTS inputs | 49 | $0.044 | $0.290 |
| 2026-10-09 04:15 | workstream V | Scenario 1 pidgin-greeting on gpt-live-1 | 28 | $0.023 | $0.313 |
| 2026-10-09 04:15 | workstream V | Scenario 2 humour on gpt-live-1 | 46 | $0.038 | $0.351 |
| 2026-10-09 04:16 | workstream V | Scenario 3 hesitant-question on gpt-live-1 | 41 | $0.034 | $0.385 |
| 2026-10-09 04:17 | workstream V | Scenario 9 frustrated-user on gpt-live-1 | 57 | $0.048 | $0.432 |
| 2026-10-09 04:23 | workstream V | Scenario 10 five-minute-conversation on gpt-live-1 + TTS inputs | 300 | $0.268 | $0.700 |
| 2026-10-09 04:25 | workstream V | Scenario 1 pidgin-greeting on gpt-live-1 | 26 | $0.022 | $0.722 |
| 2026-10-09 04:25 | workstream V | Scenario 1 pidgin-greeting on gpt-realtime-mini | 25 wall (tokens) | $0.006 | $0.728 |
| 2026-10-09 04:26 | workstream V | Scenario 3 hesitant-question on gpt-realtime-mini | 22 wall (tokens) | $0.007 | $0.735 |
| 2026-10-09 04:27 | workstream V | Scenario 4 interruption on gpt-realtime-mini | 39 wall (tokens) | $0.017 | $0.752 |
| 2026-10-09 04:27 | workstream V | Scenario 5 change-of-mind on gpt-realtime-mini | 39 wall (tokens) | $0.015 | $0.767 |
