# 17 — Open questions

These can't be settled from the code alone. Each needs a product decision, production configuration, or access the audit didn't use.

## Product decisions

1. **Waiting cards.** Should a card that waits (a near-miss draft, or an approval request) escalate, send a holding reply, or be retried? The code's rule today is "nothing outward without a passing score or a yes". The founder expects agents to "answer messages".
2. **Lapsed approvals.** Should they be expired eagerly so the agent can redraft or notify (D-01)?
3. **Briefing on screen.** Should the arrival briefing be a persistent layer, with side columns kept while talking, or move into the presence stage once Q speaks (E-01)?
4. **"Needs you".** Which single source of truth: approvals, notices, held drafts, unanswered relationship messages, data-room requests?
5. **Investor arrival.** What should it contain: the slate delta since the last visit, the top N by fit, and Q's view (fit is not quality)?
6. **Voice line.** Is duplex (OpenAI realtime) the only supported mode, or must the standard line support card commands too?
7. **Silence on unclear speech.** Should Q stay silent on unclear spoken turns, say "sorry?", or guess?
8. **Short turns with a card on screen.** Should every utterance of 12 words or fewer while a card is in focus go to the voice model?
9. **Charts and maps.** In scope for V1 result blocks?
10. **Q-sent messages.** Should every one carry a visible "sent by Q" mark (D-07)?
11. **WRITER and REVIEWER.** Separate plan steps, or internal to the conversation agent (D-02)?

## Configuration and infrastructure

12. Production values or presence of: `CQ_VOICE_REALTIME*`, `CQ_VOICE_REALTIME_DAILY_CAP_USD` (default $1 platform-wide), `CQ_INSTRUCTIONS_AUTO`, `CAPITAL_Q_SYNTHETIC_DEMO_ATTESTED`, `CQ_SYNTHETIC_DEMO_ROUTING`, `Q_EMBEDDING_PROVIDER`, `SUPABASE_SECRET_KEY` (on q-api).
13. Number of q-api replicas and the deploy frequency during calls.
14. Which branch Railway deploys from: `recovery/2026-09-12` and `recovery/2026-09-12-8y2j4w` are both pushed to.
15. Is RLS meant to apply to service traffic? This needs an ADR either way (A-02).
16. Is web meant to be on Vercel (per the ADRs) or Railway (actual)?
17. Retention policy for checkpoints, the outbox, run events, voice transcripts and usage.
18. Should the `q.action.*` events be registered or dropped (A-01)?
19. Do real customers use the staging project? This decides whether R-F2 is a breach or an accepted demo posture.

## Not determinable without paid or live calls

20. Real voice latency: first audio and end-to-end per turn. Logs exist ("voice turn timed"), but the audit didn't aggregate them.
21. Duplex behaviour in a real desktop browser. The sandbox's WebRTC couldn't hold a call.
22. Actual monthly spend per provider. Deepgram, ElevenLabs, Recall, Tavily, SerpAPI, Bright Data and OpenAI embeddings have no usage ledger.
