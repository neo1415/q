# Directive: GateQ voice reuses the existing voice providers (owner, 14 Nov 2026)

GateQ voice-only interviewing must not depend on `DEEPGRAM_API_KEY`. Capital Q already runs OpenAI GPT-Live and ElevenLabs voice.

**Before requesting any Deepgram configuration:** audit the existing GPT-Live and ElevenLabs implementations against GateQ's requirements, and prefer reusing the existing voice infrastructure, shared provider adapters and speech transport.

**Requirements:**

- **One interviewer:** voice and text use the same canonical interviewer, state, memory, recorded statements and corrections. No duplicated interviewer reasoning and no second independent AI agent.
- **Who can use it:** signed-in and guest applicants, each with properly scoped temporary credentials.
- **Conversation quality:** natural real-time conversation, interruption, captions, turn persistence and recovery.
- **Vendor code:** stays behind the existing provider contracts.
- **Provider choice:** the most suitable provider already configured, weighing quality, latency, cost and integration complexity.
- **Completed work:** voice work that is provider-independent is kept.
- **Deepgram:** may remain an optional fallback. It is never mandatory unless a specific capability is shown that the existing providers cannot support.
- **No new required paid services or credentials.** Other workstreams are not interrupted.
