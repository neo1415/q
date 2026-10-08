# 19 — Recommendation inputs (constraints for any redesign)

This file doesn't recommend a design. It lists the constraints and facts that a redesign must respect, so an external architect doesn't propose something that breaks a locked decision.

## Locked product and architecture rules (from `CLAUDE.md`, PADL and ADRs)

- **One Q.** Specialists are internal and are never selectable or named to users. Q never shows raw reasoning.
- **Context Firewall first.** Filter by scope _before_ any model sees data. Founder-private data must never shape investor-facing ranking or assessment. This is release-blocking.
- **Authority.** Prepare → Recommend → Human approval → Execute for consequential actions, unless explicit scoped delegation exists. Approval binds to the exact payload. Every consequential action has an idempotency key.
- **Model calls** go only through the Model Gateway, by task class. Models get typed tools (Zod) with an authorize step. There is no arbitrary SQL, shell or HTTP tool.
- **No LLM in feed ranking.** Ranking is deterministic and versioned. Viewing is not interest. Observed behaviour never rewrites a declared mandate.
- **Evidence semantics.** truth_class, evidence_status and lifecycle_status are separate axes. Unknown stays unknown. No invented confidence percentages.
- **Relationship state** is a deterministic projection over append-only events. There is one canonical company-investor relationship.
- **Video bytes** go browser↔CDN only. Playback is signed.
- **Design.** Semantic `--cq-*` tokens. WCAG 2.2 AA. Pass is neutral, not red. Glow on Q only. Stage + Board (ADR 0017).
- **Budget.** A small, founder-paid provider budget. No live provider calls in tests.

## Facts a redesign must account for

- **Hosting.** Railway runs all four services (web, api, q-api, workers). q-api is a single replica holding in-memory state (room feed, duplex lines). Deploys are frequent.
- **Voice.**
  - Duplex: OpenAI realtime (`gpt-realtime-mini` per `realtime/openai.ts`) over WebRTC, with server-side turn routing (`create_response=false`).
  - Fallback: Deepgram STT → Q think → ElevenLabs TTS.
  - The duplex model only voices Q's output; Q's brain is a separate run of about 3–7 s.
  - Relays are Next.js server actions, serialized per tab.
- **Brain.** gpt-5.6-luna is the primary for most task classes. The turn reader runs on Gemini flash-lite with a 2 s hedge. A reading step precedes every answer (TURN_READER v44).
- **Agents.**
  - Standing instructions are swept every 60 s, with a 240-minute cadence.
  - The writer/reviewer loop: threshold 75, two rounds; a near miss becomes an approval card; cards have a 24 h TTL.
  - Workforce jobs run fire-and-forget; errands have their own runner.
- **Persistence.** Supabase Postgres, with the app connecting as a role that bypasses RLS. 178 migrations. 0 embeddings, so retrieval is lexical only.
- **Rendering.**
  - A closed, validated union of result blocks.
  - No chart or map libraries.
  - Cards follow speech in the centre stage.
  - Side columns are used only before the conversation starts.

## What the founder is asking for (verbatim intent, 2026-10-08)

- **On login**, Q greets casually, happy to see them. Then:
  - a full summary of everything it and its agents did (messages answered, calls booked);
  - then everything that needs them: messages it couldn't answer, documents requested, and so on.
- **For an investor**, it notices new companies that match the mandate, lists them all and gives its opinion.
- **Cards** appear and disappear according to what Q is talking about. "What to do" and "what needs you" cards sit beside the Q presence, with some below when needed.
- **The voice conversation** feels like ChatGPT's realtime voice, acts on intent, and never just listens.
- **Agents** actually reply to investors and book calls.

## Known tensions to resolve

- **Autonomy vs approval:** "agents answer messages" vs "nothing outward without a pass or a yes".
- **Realtime voice naturalness vs one brain:** the voice model may not compose answers from its own knowledge.
- **Latency vs reading first:** a classification call precedes every answer.
- **Single-replica in-memory state vs reliability across deploys.**
