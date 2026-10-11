# Durable founder product decisions for coding agents

These are founder directions from the engineering discussions, kept so every model and session applies them the same way.

They sit **below** the locked PADL, the Product Specification, the Final System Review and the root `CLAUDE.md` invariants. If a direction here conflicts with a Locked PADL decision, record the conflict in `HANDOFF-LOG.md` and propose a PADL amendment; never silently change either. A direction here is not proof that code satisfies it. See `ACTIVE-TASKS.md` for the verified status.

## Authority order (unchanged)

Locked PADL → Product Specification → Final System Review → MVP/V1 Release Definition → Technical Architecture docs 11–25 → ADRs/engineering specs → current task → code.

GateQ Feature Specification is supplementary and never overrides the first three. Source register: [`SOURCES.md`](SOURCES.md).

## Product and experience

1. **One integrated Q.** Q Brain, GPT-Live voice, Work agents, public research, documents, Discover, Relationships, meetings, notifications and Q Daily operate over canonical records, never duplicate state.
2. **Grounded claims only.** Q never says it sent, booked, opened, verified, extracted or approved something unless the action actually completed. "Opened" requires a browser confirmation.
3. **Speed.**
   - Routine Q interactions aim for sub-second responses after the intent is final.
   - Warm known-route navigation targets p95 < 1 s.
   - Deterministic answers (mandate, prepared entities, Daily follow-ups, card controls, navigation) are composed by code, with no model chain and no redundant reads.
   - Deep research may take longer, but must show truthful incremental output.
4. **Preloaded welcome and attention context.** The Arrival Context Snapshot holds the authorised detail behind every named welcome item, so follow-ups need zero extra reads.
5. **Correct relationship and message history.** The canonical relationship (`UNIQUE (company_id, investor_organisation_id)`), state derived from `relationship_events`, and no parallel CRM.
6. **Voice navigation everywhere.** Pages, tabs, sub-tabs, decks ("open X's pitch deck") and Daily stories. Self-corrections ("open discover… no wait, open rehearsals") are understood. The voice session stays connected.

## Qatar demo specifics

7. **Qatar Five prepared entities:**
   - Shadi Qishta (person);
   - QInvest (organisation);
   - Muhannad Taslaq (person, Alchemist Doha);
   - Invest Qatar (government investment-promotion agency, **not a fund**);
   - AlRayan Investment (organisation).

   Requirements:
   - Instant identity.
   - Rich sourced follow-ups.
   - Honest per-source status (LINK_DISCOVERED, CONTENT_READ, FACT_EXTRACTED, VERIFIED_AGAINST_SOURCE, BLOCKED_OR_UNAVAILABLE, NEEDS_REFRESH).
   - Never invented quotes or opinions.
   - No fresh web search unless the user asks for updated information.

8. **Research beyond the five.** Q researches other people and organisations by itself through public search (Serper first, Tavily corroboration). Unconfirmed public findings may be used with soft wording ("reportedly", "according to their LinkedIn"); never present them as verified.
9. **Discovery by meaning.** "Top three Arab investors who may be interested in this" (and paraphrases) returns investor cards: prepared entities first, then a bounded web search. The fit reasons are composed by code. Q never claims interest. Founder-private data never reaches the web query.
10. **External research-informed rehearsals.**
    - Clearly labelled AI simulations, with no face or voice cloning, and personas built before the call.
    - Each persona follows industry-standard investor behaviour with one evidence-based quirk.
    - Invest Qatar is played as an investment-promotion representative, never a VC.
11. **Demo rehearsal access.** Kathryn (Spheros) and every seeded demo founder can rehearse with all five through an explicit DEMO REHEARSAL ACCESS entitlement. That entitlement never creates a relationship, connection, message, interest or mandate.

## Meetings and scheduling

12. **Meeting Q stays and converses.**
    - Silence is never consent.
    - "Wait / hang on / don't leave / stay with me / let's talk while we wait" keep Q present within a configurable cap (`MEETING_WAIT_MAX_MINUTES`, default 20, plus hard provider-minute caps).
    - Q never reschedules or cancels an active meeting because someone is absent.
    - At the cap Q explains why it is leaving and preserves state.
13. **Meeting intelligence.**
    - Q in a meeting keeps its full conversational ability and permitted tools.
    - The meeting context is layered (shared, founder-private, investor-private, disclosed, live). A private layer is used only when everyone in the room is authorised for it.
    - An append-only meeting record separates suggestion, tentative and commitment.
    - A post-call summary and follow-ups are never sent or booked automatically.
14. **Investors have final approval of founder–investor meeting times:**
    - States: PROPOSED → INVESTOR_REVIEW → CONFIRMED | DECLINED | COUNTERPROPOSED.
    - Nothing is booked or announced as confirmed before the investor's explicit acceptance is recorded, with an idempotency key.

## Daily, cards, design

15. **The quiet day is Q Daily.** With nothing urgent, Q greets naturally and may mention one or two genuinely relevant, dated Q Daily stories. "Give me the gist / the other one / take me to the story / show me that section" are answered from the same prepared objects, and open the **exact** story or section anchor. No invented news; no "All quiet. Nothing needs you."
16. **Clear and restore cards by voice and click.** "Clear all cards", "hide the connection cards", "bring back the TensorGate card". This is presentation only: it never approves, declines, deletes, cancels or touches Work. It runs with no model and no DB.
17. **Premium gold everywhere.**
    - Landing, auth, GateQ and onboarding share the authenticated product's tokens.
    - Light, dark and system themes work signed-out, with no theme flash.
    - The glossy gold VERIFIED badge appears only for verification status `VERIFIED`.
    - Researched or unclaimed entities never get it.

## Agents and documents

18. **Autonomous workforce.**
    - Agents autonomously do authorised internal research, drafting, analysis, testing, document creation and revision.
    - They ask only for consequential external actions or scope expansion.
    - Tool, model or schema errors are not policy violations.
    - Agents talk to Lead Q and Q talks to agents through typed messages.
19. **Documents** use the existing artifact/deck pipeline (`packages/q-artifacts`, `packages/deck-render`, document studio), with versioning, revision, QA and approval-to-share. Never a disconnected replacement.

## Cost, safety, release

20. Do not buy new infrastructure or subscriptions without the founder's approval. Founder provider credits (OpenAI, Gemini, ElevenLabs, Deepgram, Recall, Serper, Tavily, etc.) are for product use. Tests use disabled keys (`disabled-locally-000000000000`).
21. Deploy fast and incrementally, but never with destructive migrations, failing required CI, authorization bypasses, or success claims that haven't been verified.
22. Secrets never go into Git, logs or handoff files. Record credential **names** only.
