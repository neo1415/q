---
name: demo-model-policy-openai-primary
description: "For the synthetic demo the user wants every provided model usable for any task at any sensitivity, OpenAI primary, no Groq; stop re-raising data-policy gating"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 2374147b-5604-4acd-887a-0c3e6155e493
  modified: 2026-09-24T11:23:27.661Z
---

For the Capital Q synthetic demo (local + Railway staging), the user's standing instruction (2026-09-24, repeated "like thrice"): any model they give may carry anything, however confidential — they will choose data-respecting providers themselves before launch. Do not re-raise sensitivity/provider-policy gating as a blocker. OpenAI (paid, gpt-5.6-luna) is the primary model for every task class; Gemini is fallback only; Groq is dropped (free-tier rate limits and its 8k window). Implemented as migrations 20261008120000 and 20261008130000.

**Why:** rate-limited free tiers were costing more time than they saved; speed of iteration matters more than provider purity before launch.

**How to apply:** route new task classes to OpenAI first; don't add Groq back; when something fails on quota, fix routing rather than debugging the free tier. Keep a note in the migrations that launch needs reviewed providers. See [[synthetic-demo-model-routing]] and [[railway-elevenlabs-key-mismatch]].
