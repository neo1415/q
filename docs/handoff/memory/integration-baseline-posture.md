---
name: integration-baseline-posture
description: On a reset local DB the full integration gate is green as of 2026-09-18 (CQ-REC-002R); the demo Google posture was reverted by migration 20260926 and the permissions clock race fixed, so a failing integration run now means a real regression
metadata:
  type: project
---

Before 2026-09-18 a reset local database showed 8 Q/gateway failures (demo Google posture migrations 20260919/20260921 vs fixtures scripted for the reviewed posture) plus one permissions clock-skew flake. CQ-REC-002R resolved both: `20260926090000_restore_reviewed_google_posture.sql` restored google = UNREVIEWED / Gemini ceilings = PUBLIC (classification C against doc 13 §57.2, doc 15 §62), and disclosure policies now stamp `created_at` from the injected DisclosureClock. Full `pnpm test:integration` on a reset DB: 449 pass, 5 skipped (Storage credentials), 0 fail.

**Why:** the known-baseline excuse no longer applies; do not classify integration failures as "known posture drift".

**How to apply:** run `pnpm db:reset` first, then `pnpm test:integration`; any failure is packet work. Gemini answers PUBLIC work first (20260920 preference), Groq carries INTERNAL/CONFIDENTIAL. Related: [[hosted-supabase-state]], [[lint-heap-and-gates]].
