# Founder requirements — 2026-09-25 (nothing to be dropped unless it conflicts with locked specs; conflicts get an ADR proposal)

Principle: Q can do anything the app can do (unless technically impossible), by voice or typing, from the floating Q or the Q page. Nothing in the niche's business processes should require leaving Q. Full-product feel, smoothest journeys, proactive, easy to see/edit/download.

## Artifacts & media
R1. Q must actually produce viewable AND downloadable PDF and PPTX (user reports it refused on the hosted build) — investigate + fix, prove on the deployed stack.
R2. Q can create and edit media (images, e.g. deck visuals, brand assets) that it can reuse; users can upload their own media and Q can use them.
R3. Reports downloadable; edit logs/history viewable and downloadable.

## Profile, identity, brand
R4. Profile page: much better design + enrichment; editing is broken (clicking/typing does nothing) — fix; editable by UI and by Q.
R5. Handles for companies and investors.
R6. Digital business cards they can share, linking to their Q profile — a serious brand identifier; design carefully (public_external vs network_visible visibility per ADR-001).
R7. Brand settings: users input brand details, colours, logos; Q and artifacts use them ("Q is theirs and theirs only" — on their side, but not a yes-man).
R8. Visibility controls fully fleshed out (who sees what, card/profile public vs network).

## Business workflow (the actual business part)
R9. Integrations via MCP/connectors (LangChain available): Q proactively (from full context) asks an investor whether to email founders, drafts it, shows it, asks permission, sends it, and detects/tracks the founder's reply. Same pattern for other systems.
R10. In-app chat/messaging later (COMM-001) — plan it.
R11. Alarms/reminders; meeting links; Q joins meetings, summarises, and can speak in them.
R12. Small admin dashboard for us: accept/verify companies (verification queue), etc.
R13. Investor onboarding: Q first researches as much as possible (public sources) to pre-build the investor profile, asks to confirm, then finishes onboarding faster. (Founders already have presence research — extend/align.)

## Experience
R14. Product feels disjointed — unify flows; everything reachable via Q (dock or page).
R15. Deep research + enrich user journeys from PADL/specs so we don't only do what was listed; full product experience even as a prototype.
R16. Keep an agent improving Q intelligence continuously while product work proceeds.
R17. Deploy now-ish so the founder can test; keep deploying as things land.

## Founder decisions (2026-09-25, after business research)
- C1 Meetings: AMEND PADL #64 — "Ask Q aloud": Q silent by default, speaks briefly only when explicitly asked, announces itself as AI; demo as private in-ear coach until built.
- C5 LinkedIn: KEEP the existing Bright Data lookup as is (founder's call; legal/ToS risk noted in business-research.md C5).
- C9 Email replies: Gmail users.watch + Pub/Sub, Google app in Testing mode for demo (≤100 test users); CASA needed before real users.
- C11 Card name: "Q Card".
Plan: business-research.md P0 packets BIZ-001..012.
