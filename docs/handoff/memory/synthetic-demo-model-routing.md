---
name: synthetic-demo-model-routing
description: Demo/dev work can use Gemini instead of hitting Groq free-tier limits by setting CQ_SYNTHETIC_DEMO_ROUTING=true; it is a claim about the data, not a cost switch, and it cannot be enabled outside local/test
metadata:
  type: project
---

Set `CQ_SYNTHETIC_DEMO_ROUTING=true` in `.env.local` to let the demo run on
the preferred free model (Gemini-lite first for dialogue, extraction and
synthesis) instead of falling back to Groq once its free tier is exhausted.
Added by CQ-REC-007 A (commit `413d8c0`).

**Why:** doc 15 §62 — "free" is a cost property, not a privacy
classification; free inference may be used aggressively for synthetic data
and development, while confidential customer information still needs an
approved provider. The Model Gateway only knew *sensitivity* and treated
every request as a customer's, so a demo full of invented companies could
reach only the reviewed (rate-limited) provider.

**How to apply:** the flag is a claim about the DATA this deployment holds.
It is checked again at startup by `createSyntheticDemoRoutingAllowance` and
the process refuses to start if `CAPITAL_Q_ENV` is not local/test or the
database is not loopback — so it can never be switched on where real
companies live. A request must ALSO declare `dataPosture: "SYNTHETIC_DEMO"`
from server code; no HTTP DTO carries it, so a browser cannot. Real
CONFIDENTIAL/HIGHLY_CONFIDENTIAL/RESTRICTED traffic is untouched, and no
`ai_ops` row changed (google stays UNREVIEWED, Gemini ceilings PUBLIC).
Check a route with `node scripts/demo-routing-smoke.mjs`, which prints the
provider chosen under each posture. Related: [[hosted-supabase-state]].
