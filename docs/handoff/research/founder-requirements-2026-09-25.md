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

## Added 2026-09-26
R18. Discover must feel fully TikTok-like and smooth (preloading), with Q "watching with us": ask about the video at any moment; Q knows which pitch and the timestamp, answers from the transcript (and later visuals). Packet: pitch transcripts via Cloudflare Stream captions (also closes captions gap) + Q tool reading what's said around a timestamp; UXB passes pitch id + playback position to Ask Q.
R19. AI-generated pitch videos from decks — founder chose "narrated deck video": deck slides + Q-written script + ElevenLabs narration → MP4 → published as pitch; labelled "AI-narrated" to investors; founder voice cloning only with explicit consent. Near-free.
- 2026-09-26 decision: "ignore speech from a nearby video" (speaker filtering) is DROPPED. Do not build.

## Added 2026-09-26 (evening, founder live review) — all important
R20. CAPABILITY REGISTRY ("ledger of tools"). One code-built registry of every action the app can do (navigation to every screen, profile edits, visibility, handles/Q Card, documents PDF/PPTX, media, search/research APIs, relationships/interests, design/creation), each with its typed tool, authorize step and approval class. Q consults it on every turn (typed or voice) instantly, picks the tool and calls it straight away. Goal: Q can do anything the app can. Live bug: "edit my profile" by telling Q still does not work; "make a Q card" produced a brief.
R21. Q sees the screen: Q always knows what the person is looking at (route, the entities on screen, selection, open document/pitch + position) so it can answer and navigate. Implement as structured app-state context sent with each turn (not pixel screenshots), through the Context Firewall.
R22. Voice streaming is broken: speech stutters "like a game at 2 fps", words barely come out. P0, fix ASAP (gapless audio scheduling / buffering / chunk sizes / sentence streaming).
R23. Minimalism and abstraction, very high bar. No evidence/fact/gap blocks, truth labels or "self-reported" chips dumped into chats or pages. Answer first; sources and evidence available on demand (tap "Sources"), never by default. Investors want things done immediately. Review every surface for verbosity. (Progressive disclosure keeps the evidence invariants intact: record ADR.)
R24. Home Q page layout:
  - Default on Q page: ALL side bars collapsed; maximum space for the Q presence, which must be visible without scrolling (currently you must scroll up to see Q).
  - Right side bar (Board): collapsible, closed by default; opens when its icon is clicked or when a file (PDF/PPTX/etc.) is generated; closable again. Opening a file shows a big closable modal viewer.
  - Left side bar collapsible. Remove the separate chat icon from the left bar: the Conversations control (chat list + New chat) is the right pattern and stays.
  - Theme: a single icon that opens a small dropdown (light/dark/system).
  - Q motion setting: move to profile for now; build a proper Settings page.
  - Voice gender (male/female) buttons: remove from the page; a small icon opening those options.
  - Scope/context chip ("Investor private · Zino Aviation") out of the input field: move to the side bar or top/bottom.
  - Mute and End controls live inside the typing field.
R25. Profile page is sparse: everything answered in onboarding must appear in the profile (mandate, sectors, stages, geographies, cheque sizes, thesis, etc. for investors; full company data for founders), editable, minimal presentation.
R26. Q Card redesign: beautiful, professional card; the public scanned page (/@handle) redesigned with real UX thought (not basic).
R27. Relationships get their own page (top-level navigation).
R28. Settings page (theme, Q motion, voice, notifications, connected accounts later).
R29. Seeded content: fictional founders/companies with full stories, decks AND videos (narrated deck videos, R19), and investors. Discover videos full screen height, centre aligned, action buttons as icons (not big text boxes).
R30. Audit the whole user flow and journey (founder and investor), then fix.
R31. Cloud readiness: be ready to move to Claude cloud at the founder's say-so. Hand over EVERYTHING (not summaries): state, branches, queue, requirements, decisions, memory, sources, rules. Install graphify there if possible. Cloud lead runs multiple agents like here, every agent on Opus 5.5 at medium effort, each told which sources/files to read. It works unsupervised: builds, tests, deploys, and the founder returns to a far-along product.
