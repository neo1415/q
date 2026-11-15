# Owner directive, 15 Nov 2026: toward a stable demo release candidate

1. Continue without interrupting running tests or releases.
2. Navigation: decision 98 (automatic when it advances the immediate task; never merely because something is mentioned; stay or offer when ambiguous, unsaved, or asked to stay). No navigation redesign.
3. Priorities: complete GateQ sustained certification (done 8/8 on `318577a8e`; reply-quality polish in progress), correct the meeting-rescheduling response (`7f218ec22`, pending deploy), fix the remaining investor Q UX defects.
4. Then a complete demo-readiness audit against the locked V1 requirements: founder and investor onboarding, GateQ branding with real websites and logos, voice, Q intelligence, discovery/video, comparisons, relationship actions and meetings. Distinguish implemented / tested / production-verified / incomplete. Unit tests are not end-to-end proof.
5. Fix actual demo blockers; preserve Q's quality and fluidity; no unnecessary expansion or compliance-heavy UX.
6. Continue autonomously; escalate only genuine product decisions, new external dependencies, or actions needing approval. Goal: a stable, fully functional demo release candidate for the owner's hands-on QA.

## Testing budget, 15 Nov (owner)

"Continue testing" and "take another 5": an extra $5 of external testing spend for 15 Nov UTC (day cap $10; per-test cap stays $1). Ledger fix the same day: records made with a shortened reservation id were not matched, so estimates were double counted; actual spend at 15:40 UTC was $1.66 (from `ai_ops.model_usage`).
