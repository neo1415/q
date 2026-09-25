---
name: railway-elevenlabs-key-mismatch
description: "Railway q-api held a different, exhausted free-tier ElevenLabs key; \"Q listens but never speaks\" on the deployed stack = speak relay upstream 401 quota_exceeded"
metadata: 
  node_type: memory
  type: project
  originSessionId: 2374147b-5604-4acd-887a-0c3e6155e493
  modified: 2026-09-23T20:12:56.522Z
---

On 2026-09-23 the deployed voice path (Railway q-api) connected and thought but Q never spoke. q-api logged `voice speak relay refused upstream status=401`; replaying the relay's exact ElevenLabs request with the Railway `ELEVENLABS_API_KEY` returned `quota_exceeded` (a free-tier account, 10,000 credits, 0 left). The key in the repo-root `.env.local` is a different account (Creator tier, 131k chars) and works. Setting Railway variables is a secret-store write my auto-mode classifier denies; the user has to run `railway variables --service "@capital-q/q-api" --set ELEVENLABS_API_KEY=…` themselves.

**Why:** the two keys were never compared; "voice verified on Railway" earlier was the think path, and ElevenLabs returns 401 (not 402/429) for an exhausted quota, which reads like a bad key.

**How to apply:** when Q is silent but `FAILED_TO_THINK` is absent, pull `railway logs --service "@capital-q/q-api"` and grep `speak relay`; compare local vs Railway key hashes (`railway variables --service ... --kv`) before touching code. Related: [[render-vercel-state]], [[synthetic-demo-model-routing]].
