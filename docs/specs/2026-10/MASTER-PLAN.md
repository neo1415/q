# Capital Q — 2026-10 master plan (lead)

Founder brief (2026-10-01, condensed, nothing dropped): continue from HANDOVER.md; dedicated agents for (1) Q realism/speed/memory/proactivity research + hardening (never fails), (2) Rehearsals: Meet-style room, Q role-plays any connected investor/founder from a continuously built personality profile, moods, screen share if feasible, review + score + tips, unlimited, suggested when a meeting is scheduled, (3) full autonomy with LangGraph: investor "handle it" sourcing → interest → chat → scheduling (asks investor for times) → first-stage interview → PDF report → follow-up booking; founder stand-in while offline; Q-to-Q; works from any Q; reminders, notification centre, Web Push, (4) documents/design agent (decks and any document from anywhere, images, charts, fonts, colours, proactive; pop-up open/download card anywhere; Q edits its documents; export any answer as PDF), (5) The Q Daily: agents scour news daily for each user and the documents engine lays it out as a newspaper with real photos/diagrams, emailed weekly/daily or on the dashboard, (6) per-user results dashboard + downloadable business reports, (7) Capital Q platform admin dashboard (roles, monitoring, auditing of Q), (8) Discover videos must start instantly (preload). Minimalism, speed, security, a little less gradient. End-to-end testing from sign-up to raising/deploying capital, with fictional accounts and the founder's gmail.com accounts.

## Workstreams and owners

| Agent                                                                                                                                                                    | Branch         | Spec                    | Migrations |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | ----------------------- | ---------- |
| HARDEN (continuous)                                                                                                                                                      | build/harden   | specs/2026-10/harden.md | 202611100* |
| REHEARSE                                                                                                                                                                 | build/rehearse | rehearse.md             | 202611110* |
| AUTO                                                                                                                                                                     | build/auto     | auto.md                 | 202611120* |
| DOCS                                                                                                                                                                     | build/docs     | docs.md                 | 202611130* |
| DAILY (next free slot)                                                                                                                                                   | build/daily    | daily.md                | 202611140* |
| ADMIN (next free slot)                                                                                                                                                   | build/admin    | admin.md                | 202611150* |
| Rules for all: specs/2026-10/WORKER-RULES.md. Lead merges by cherry-pick, runs full gates, applies migrations, deploys, live-checks, keeps HANDOVER.md + ledger current. |

## Queue after the first four land

1. DAILY: news agent (sources with licences/attribution, per-user relevance from mandate/raise/relationships), weekly default (daily opt-in), newspaper layout via DOCS engine, email + dashboard reader, Q tools.
2. ADMIN: platform admin roles (platform_operator with step-up), verification/KYB queue, accounts, Q monitoring (runs, refusals, latency, costs from ai_ops.model_usage), audit search, incident tools; per-user results dashboard + CSV/PDF reports.
3. End-to-end bench: founder sign-up → onboarding → deck → pitch video → Discover → interest → chat → rehearsal → meeting → commitment confirmed; investor sign-up → mandate → handle it → first-stage interview report → meeting → commitment. Fictional + founder gmail accounts.

## Lead's "wow" proposals (beyond the brief; to evaluate against the specs)

- Deal room memory: every relationship gets a living one-page "where we are" Q keeps current (open questions, promises made by each side, next step, risk), shown on the relationship and spoken in briefings.
- Promise tracker: Q detects commitments people make in chats/calls ("I'll send the data room Friday") and turns them into reminders for the person who promised, with a nudge before the deadline.
- Objection bank: from rehearsals and real meetings, Q builds each founder's personal list of hard questions and their best answers, rehearsable in 5-minute drills.
- Investor fit radar: a visual for founders of which connected investors are warming or cooling (response time, questions asked, meetings), evidence-based, never a score without reasons.
- Pitch video coach: Q watches a founder's pitch video transcript and pacing and suggests a tighter 60-second cut, with a re-record checklist.
- Data-room readiness checker: Q lists what investors at this stage usually request and what's missing, and prepares templates.
- Weekly voice brief: a 2-minute spoken summary of the week (podcast-style) in the Q Daily.
- Intro graph: who in your network can introduce you to an investor, with consent-based warm intro requests.
- Term sheet assistant: plain-language explainer and comparison of term sheets, linked to confirmed commitments, e-sign later.
