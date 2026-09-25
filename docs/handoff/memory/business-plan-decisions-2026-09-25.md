---
name: business-plan-decisions-2026-09-25
description: "Founder's business-side requirements (R1–R17) and decisions — PADL amend for \"Ask Q aloud\", keep LinkedIn lookup, Gmail watch in testing mode, \"Q Card\"; plan = BIZ-001..012 P0 packets"
metadata:
  node_type: memory
  type: project
  originSessionId: 2374147b-5604-4acd-887a-0c3e6155e493
  modified: 2026-09-25T13:29:13.419Z
---

2026-09-25 the founder asked that Capital Q cover the whole business side inside Q (email with approve-then-send and reply tracking, meetings/reminders, handles + shareable "Q Card", brand kit, editable enriched profiles, visibility centre, /ops admin/verification console, media generation/uploads, downloadable reports and edit logs, investor research-first onboarding, "Q can do anything the app can"). Requirements R1–R17 live in the session scratchpad `founder-requirements-2026-09-25.md`; the plan is `business-research.md` (P0 BIZ-001..012, P1, P2, each packet tagged to R-items). Nothing is to be dropped unless it conflicts with locked sources.

Founder decisions: C1 amend PADL #64 so Q is silent by default but can speak briefly when explicitly asked ("Ask Q aloud", discloses it is AI); C5 KEEP the existing Bright Data LinkedIn lookup despite legal/ToS risk (founder's call); C9 Gmail `users.watch`+Pub/Sub with the Google app in Testing mode for the demo (CASA before real users); C11 the business card is called "Q Card". In-app messaging (COMM-001) is later.

**Why:** founder said the product felt disjointed and wants a full-product feel even as a prototype.

**How to apply:** assign BIZ packets in order as worker slots free (BIZ-001 artifact export started first); founder must provide accounts/keys listed in business-research.md (Google Cloud project with Gmail/Calendar/Pub/Sub, verified domain, Postmark/Resend, Companies House key, SEC User-Agent, operator passkeys; P1 Recall.ai etc.). Related: [[design-direction-founder-2026-09-25]], [[no-patching-architecture-first]].
