# Durable founder product decisions for coding agents

These are founder directions from the engineering discussions, kept so every model and session applies them the same way.

They sit **below** the locked PADL, the Product Specification, the Final System Review and the root `CLAUDE.md` invariants. If a direction here conflicts with a Locked PADL decision, record the conflict in `HANDOFF-LOG.md` and propose a PADL amendment; never silently change either. A direction here is not proof that code satisfies it. See `ACTIVE-TASKS.md` for the verified status.

## Authority order (unchanged)

Locked PADL → Product Specification → Final System Review → MVP/V1 Release Definition → Technical Architecture docs 11–25 → ADRs/engineering specs → current task → code.

GateQ Feature Specification is supplementary and never overrides the first three. Source register: [`SOURCES.md`](SOURCES.md).

## October 12 investor demo and InvestIQ reconciliation

The founder's complete October 11 directives are preserved verbatim:

- [Investor demo priority override](session-directives/2026-10-11-investor-demo-priority.txt).
- [InvestIQ accuracy, methodology and architectural reconciliation](session-directives/2026-10-11-investiq-reconciliation.txt).

The actual investor journey is the immediate release priority. Document-workforce infrastructure is not proof of intelligent research, writing, design or critique. Preserve the completed document milestone; expand it after the demo blockers. Rehearse Discover, accurate top-three cards, company selection, grounded analysis, follow-ups and comparison through the real authenticated interface. Measure first useful text and first audio independently; an opened voice session is not audio acceptance.

Core Seven remains the governing assessment framework. The new directive authorizes designing, prototyping and recommending a serious proposed quantitative methodology, with test vectors and source reconciliation. It does not authorize silently replacing production scoring semantics or presenting draft arithmetic as official FDN InvestIQ. Continue code correctness, evidence permissions, presentation and measured speed work while that proposal is prepared. Preserve historical assessments and legacy source documents.

## October 12 directions: delegation by meaning, stated evidence, concision

- **Delegation is understood, not keyword-matched.** Q recognises work handed to its team from meaning (TURN_READER `teamJob`), in any words. A keyword count is only a deterministic fast path to the same decision. Both go through the one orchestration (`propose_q_job` → one plan card). A plan that cannot be made is said plainly; it is never covered by an ordinary answer that looks like the work was done.
- **"Not formally disclosed" is not "not known at all."** A figure a company stated where the reader may see it (a pitch they may play, a deck section the founder confirmed) is shown as stated and attributed, and Q reads it. It is never scored unless the founder formally shares it: the canonical mandate-fit methodology and disclosure controls are unchanged. Q never asks the investor for what their authorized deck already says.
- **Progressive disclosure, everywhere.** Capital Q is an analyst who gets to the point:
  - Lead with the insight, not how the system works.
  - Primary assessments are 2–3 dense sentences.
  - Show at most three high-priority questions at first.
  - Long evidence lists, repeated claims, coverage grids and technical explanations are collapsed by default. Provenance, confidence detail and methodology sit behind accessible expandable controls.
  - No caveat or fact repeats across adjacent sections.
  - Depth is on demand: a question to Q. Conciseness is not shallowness; reason fully, say what matters.

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

## Four-lane round (2026-10-15)

23. **Paid tests:**
    - The owner approved paid live testing.
    - Lead caps per round: Tavus about $10 (stop at an $8 estimate), OpenAI baselines about $3, Q Pitch voice about $2.
    - Every paid session is logged with its estimated cost. Unit, e2e and eval tests still use disabled keys.
24. **InvestIQ naming:** InvestIQ is FDN's proprietary methodology and the canonical name. The Capital Q engine implements FDN InvestIQ.
25. **InvestIQ v1 method:**
    - The owner delegated the weights, rules and bands to the lead, who set them from cited research. The method awaits calibration on 3–5 real FDN companies and runs in shadow mode only.
    - Locked rules still bind:
      - Investor Fit stays outside readiness;
      - Q gives no advice on capital form (PADL #74);
      - valuation stays outside the grade;
      - an unknown value never becomes zero.
26. **Credit top-up:** the owner tops up credits 08:00–09:00 WAT. If a paid test hits a provider limit before then, pause it and retry after 09:00 WAT; all other work continues.
27. **GateQ guest uploads:** investors may only ever be shown files with a CLEAN malware scan. Each gateway has a storage cap, 5 GiB by default.
28. **Q Pitch demo company:** Option A. Capital Q stays organisation-private and never appears in Discover. Investor questions about it are answered from the knowledge pack, and unknown figures stay unknown.
29. **GateQ video limits:** each limit is configurable, with these defaults:
    - 480 s per session;
    - 1 session per application;
    - concurrency 2;
    - a typed fallback that is always available.
    - Paid test runs are capped at 180 s.

## Later on 15 October 2026

30. **Full approval:** the owner has given full approval to proceed without asking for permission. Safety rules still bind: no secrets in Git or logs, no RLS weakening, no fabricated claims, and paid spend logged.
31. **Tavus accounts:**
    - Live GateQ and Rehearsal conversations use the owner's Tavus Builder key. It is configured on api and q-api, with fingerprint `b4a4e71d`; never record the key itself.
    - The six owner-provided disposable keys are only for pitch-video generation. They are stored owner-only on the operator machine, never in the repository.
    - Budget for this verification round: 10 Builder minutes. Never trigger overage.
32. **Video allowance:**
    - 5 Tavus sessions per user per week, shared across GateQ and Rehearsals, 180 s each.
    - A global monthly cap, default 600 s.
    - Testers are recorded in the ledger but don't use the weekly allowance.
    - Every signed-in founder and investor gets access through the allowance.
33. **Presenters:** variety comes first. Each stock replica id appears on at most 2 companies and each person on about 4, Black presenters are used wherever the catalogue allows (about 30%), and every video is labelled as an AI presenter.
34. **Synthetic demo verification:** it is kept, but displayed as a distinct "Demo verified (synthetic)" badge. The gold badge is only for real operator or provider verification.
35. **Q in Google Meet:** Q appears as a real Tavus presenter, a stock replica of a Black woman, rather than a letter tile.
36. **Live voice:** the trial limits for the owner's test accounts are removed, and the daily caps are raised to $25 live and $15 realtime.

## Organisation roles (2026-10-22)

37. **Admins never see members' private Q conversations or Q memory.** The founder decided this on 2026-10-22. The organisation activity feed and member pages, for owners and admins only, show:
    - what each person did directly: notes and corrections, relationship stage moves, consequential screen actions;
    - what Q did under a person's approval.

    They never show Q conversations, memory, delegations, standing instructions or other `personal_private` content.

38. **Colour.** Capital Q's colours are the black-and-gold brand preset: gold on black in dark mode, and bronze-gold on ivory in light mode. The prototypes' charcoal, gold and near-black option tones are not used, and blue is only the unbranded token fallback.

## Onboarding (2026-10-27, owner after a live voice test)

39. **Voice onboarding is a conversation first.** Q introduces itself properly (who it is, what this is and why, roughly how long, that they can stop and pick up later, that the form is there), then talks with the person from a checklist of the setup's topics, in plain words, one thing at a time. It is never a form read aloud. What is said is kept in the onboarding thread as it is said, and the whole transcript is read by meaning and saved in the background (soon after each answer and again when they leave), on the server, so leaving loses nothing. A later word that changes an earlier one wins, and the old value is kept as history. When they come back, Q carries on where they stopped. Uploads are read in parallel, and what is found reaches the conversation, so Q does not ask for it again. At the end, Q reads back from what is actually saved and asks what else to add. "Continue later" is in voice as well as the form. Implemented in `apps/q-api/src/voice/onboarding-conversation.ts` and the `ONBOARDING_TRANSCRIPT_READER` prompt; `CQ_ONBOARDING_VOICE_CONVERSATION=off` restores the guided interview.
40. **No keyword or opening-word rules decide what someone meant.** This has been repeated many times. Whether words answer, ask or decline is read by meaning (the readers). Regexes over people's words that accept or reject them are defects; remove them on sight.
41. **"Done" for onboarding includes voice and a brand-new account.** A score earned on typed onboarding with existing accounts is not evidence for voice. Each onboarding fix adds a regression test for a fresh account whose organisation is created during the call.

## Real people on the staging deployment (2026-10-28)

42. **One deployment holds the demo world and real sign-ups; each is treated as what it is.** The owner chose to keep the current Railway/Supabase deployment as it is (a separate production database and subdomain come later, with a per-user/tenant export) and to let real people onboard on it now. The split is the service-role marker `auth.users.raw_app_meta_data.synthetic = true`, which a person cannot set:
    - Marked accounts (the seeded world and the owner's `+cq-` aliases) keep the demo treatment: "Demo verified (synthetic)" from the auto-verify sweep, and the synthetic-demo model routing.
    - Everyone else is a real customer: no demo badge (the sweep already skipped them), and their requests are routed by the providers' reviewed ceilings only (OpenAI, zero retention, up to CONFIDENTIAL). A tenant with any unmarked member counts as real.
    - Nothing gets stricter in practice: every successful model call on 2026-10-21..28 already ran on OpenAI, and no role holds `company.financials.view`, so Q's plans stop at CONFIDENTIAL. HIGHLY_CONFIDENTIAL documents are never sent to a model, as before.
    - The deployment's attestation env vars stay on. Removing them would only take the demo treatment away from the seeded world.

## Research, credits and confidential figures (2026-10-28/29, owner)

43. **Search credits: use them when the work needs them; never waste them.** The founder pays for web search (Brave, Serper). Real users research fully within the per-job budget, with no extra caps. Live tests search the web whenever the task being tested needs it (owner 2026-10-29: "we can afford credit uses in the single units"); what is avoided is waste: repeated runs of the same check, retries that resend searches, and loops. Unit tests and scripts make no live provider calls (keys stay `disabled-locally-000000000000`). Each live run reports the searches it sent (q-api "public research provider call" lines).
44. **Deep research is an investigation, not a summary of results.** Plan → iterative gap-driven rounds → retrieval → evidence extraction → cross-source validation in code (corroboration by independent domains, contradictions kept side by side, staleness) → primary sources first (regulators, filings, registries, audited accounts, company disclosures, said to be the company's claim) → implications for the investor's own thesis and mandate (labelled inference) → sourced report with what public search cannot establish (private revenue, beneficial ownership, fund commitments) and next actions; progress visible; state durable across restarts. It lives in Q's own orchestrator and workforce job runner. No LangChain or LangGraph. Example asks are examples: never seed or hard-code a company or sector from one.
45. **The planning bar stays at two reviews ≥ 99/100.** When a plan falls short, the card says plainly what the reviewers still want; the bar is never lowered to pass.
46. **Founder-stated figures recorded before the 2026-10-28 rule are CONFIDENTIAL too (owner, 2026-10-29: "let Q use those figures").** About 1,256 rows (cash, burn, revenue, runway, margin; USER_CLAIM, founder_private, not read from a document) move from HIGHLY_CONFIDENTIAL to CONFIDENTIAL by migration `20261231170000`, each with a revision `OWNER_RECLASSIFIED_CONFIDENTIAL`. Visibility stays founder_private: never an investor, a ranking or a feed. Figures read from a highly confidential document stay HIGHLY_CONFIDENTIAL until the founder confirms them, and the documents themselves never reach a model.
47. **One context layer for every Q capability (owner, 2026-10-29, after deep research scored 4/10 and 2/10).** Research, planning, documents and answers start from everything Q knows about the account: the situation dossier (`packages/q-specialists/src/situation/assemble.ts`), read as the person. A capability that works from a thin slice of the account (only the typed words, a few profile fields) is a defect; it is fixed by consuming the dossier, never by patching around the symptom (e.g. adding country lists to the search filter). Q does not dump the dossier on a task: it first decides what this question needs from everything it knows (a brief: the market in question, the facts that matter and why, what is unknown, what is irrelevant), and only that selection drives the work. What may leave in a web search comes from the brief's selected public-safe facts plus the person's words; private facts never leave.
48. **Research is tested on real public companies and real markets.** Test accounts stay ours (fictional people and organisations), but the subjects researched are real public companies, sectors and markets, so web search has something to find. Never seed or impersonate a real company as a Capital Q account and never contact anyone. Every live research failure becomes a recorded acceptance case (real pages recorded once, replayed in CI with code-asserted checks) before the fix ships.
