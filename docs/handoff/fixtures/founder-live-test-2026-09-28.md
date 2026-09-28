---
title: Founder live test 2026-09-28 (after deploy 3242e5b) — backlog for the next session
date: 2026-09-28
---

Deployed head at capture: 3242e5b (hosted 80/80 migrations). Every item below is NOT built yet. Fix as general capabilities (ADR 0011/0016), not phrase patches.

## Q capability and conversation

1. Q claims it can't make a PDF ("I can't create or attach a PDF in this conversation") although PREPARE_DOCUMENT/artifacts exist. Q must consult the capability registry (packages/q-tools/src/capabilities.ts, the manifest) before refusing anything; refusing a registered capability is a bug. Add a test: for every registry capability, the answer model is told it exists for the run's purpose (check purpose narrowing, MODEL_TOOLS_MAX 64).
2. Meeting: "2:00 PM tomorrow" was refused as "date could not be validated". Resolve relative dates in the person's timezone deterministically (code, from the model's structured date), never ask to confirm an unambiguous date.
3. No emails or Meet links arriving. Check live: Gmail connection has calendar scope (reconnect needed?), workers SMTP vars (set 2026-09-27), BIZ-008 executor logs (`railway logs --service @capital-q/workers | grep -i meeting`), approval → execute path.
4. Approvals sometimes stay "approval needed" after the person approves (card and conversation). Trace approve → resume → execute; status must flip to Saved or show the real failure.
5. Home Q default view: plain chat transcript like a normal chat. Sources, evidence, company lists etc. are small collapsed buttons that expand/collapse. Remove the stacked cards ("Answer", "Companies", "Show exchange", pin/close) as the default.
6. Voice transcript text still shows at the top while chatting — show only the chat thread.
7. Composer (text box) too tall on mobile and desktop — make it compact, grow with content.

## Discover

8. Loading state: "Building your list… check back in a moment" never refreshes by itself. Poll/stream until the slate is ready and show a proper skeleton/buffer; never require a manual refresh.
9. Mute/unmute: icon button, not a text button.
10. Remove the "1 of N" counter.
11. Videos loop seamlessly when they end.

## Founders

12. Founders can view other founders' pitches (check docs/product-sources first; if a conflict, ADR).
13. Founder "Investors" page/entry (small top-right button or a full page): investor cards with profile image + minimal info, open to the investor's profile (only fields the investor made visible). Founders can connect/reach out only to investors who allow being contacted; investor accepts. Check the sources (PADL/spec) on founder-initiated contact before building; ADR on conflict.
14. Multiple pitch videos per founder: Pitch & media main page = grid/list of all their videos; each opens a details/edit page (today's page becomes the per-video detail).

## Profile

15. Profile redesign modelled on LinkedIn: cover image + profile picture upload (media via the direct-upload path, never through Next.js), sectioned blocks (About, Experience/Team, Company/Mandate, Activity…), clear hierarchy.
16. Typography: LinkedIn uses a system font stack (-apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif; historically "Source Sans Pro"). Adopt a similar professional stack via the --cq-* font tokens.

## Founder items still open (from 2026-09-27)

Google sign-in redirect_uri_mismatch (Cloud Console); malware scanner for chat files/voice notes; ADR 0019 peer chat, ADR 0020 unknown-never-excludes; reminder approval class ADR; Share on rail vs ADR 0017 C4; reconnect Gmail for calendar scope.

## Progress 2026-09-28 (lead, low budget)

- DONE, deployed a0044af: #9 mute/unmute is an icon; #10 "1 of N" counter removed; #11 pitches restart on `ended` (streamed MSE sources can ignore `loop`).
- DONE, deployed 5f5eb36: #8 "Building your list" reloads itself every 6 s, at most 10 times per session (sessionStorage counter), until the slate is ready.
- DIAGNOSED #1 (Q "can't create a PDF"): not a missing registry lookup. Home Q can only PREPARE_DOCUMENT three types: PITCH_DECK, INVESTMENT_BRIEF, OWN_MANDATE (packages/q-tools/src/capabilities.ts ~L300-345, eligible when artifacts are composed). The founder asked for a PDF of "an assessment of how I come across", which is none of those, so the answer model truthfully had no document type. Fix: add a general "export this answer / any Q-written report as a PDF" document type (e.g. Q_REPORT: the answer's own text and sources rendered through deck-render/BIZ-001 export), registered as a PREPARE_DOCUMENT hand, plus a test that any answer can be exported. Also make the answer note say which document types exist so Q offers the nearest one instead of refusing.
- Next in order: #4 stuck approvals, #3 emails/Meet (check `railway logs --service @capital-q/workers | grep -iE "meeting|reminder|smtp"` and whether Gmail was reconnected with calendar scope), #2 relative dates, #5-#7 chat layout, then #12-#16.

## Added by the founder 2026-09-28 (second message) — in progress

- Chat layout (#5-#7) + structured live responses: lists, comparison cards, tables, colour-coded (with labels) rendered as Q streams — worker CHATUI, branch ux/chat-structured.
- Emails / Meet links / stuck approvals / "2 PM tomorrow": hosted logs showed no meeting ever reached execution. Worker MEET, branch fix/meet-approvals.
- LinkedIn-style profile + cover/profile photo upload, LinkedIn-like system font stack; Q Card: choose which onboarding fields show, Save success state (Save silently failed), beautiful /@handle page with See more; Q can revise its own PDF/PPTX (new version) and export any answer as PDF. Worker PROF, branch ux/profile-qcard.
- Noted for later: founders see other founders' pitches; founder Investors page + contact rules (check sources); multiple pitch videos per founder.

## Shipped 2026-09-28 afternoon

- 1a42caf LIVE: chat thread layout + structured streaming (safe built-in markdown renderer, COMPANY_ANALYST v11); meetings/emails/approvals root causes fixed (local-time resolution, typed approval starts a new turn, personal reminders owner-scoped, approved-but-lost runs execute through the gate). Live logs confirm "google workspace configured on q-api" and "reminder email enabled: SMTP configured".
- 5b4647f deploying: LinkedIn-style profile (cover + photo upload with crop, sections, See more, system font token), Q Card save feedback + per-field toggles + redesigned /@handle, revise_my_document (Q edits its own PDF/PPTX as a new version). Hosted 81/81 (profile_images).
- Open: Q_REPORT (export any answer as PDF); ADR 0017 amendment (chat thread + Share on rail); founders view other pitches; founder Investors page; multiple pitch videos.
