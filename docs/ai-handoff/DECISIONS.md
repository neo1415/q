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

## MVP bar and the end of patch loops (owner, 2026-10-30/31)

49. **A working MVP is the bar in `MVP-DEFINITION.md`,** verified live on fresh fictional accounts at 1440 and 390. Unit tests and CI are necessary, never sufficient.
50. **Bounded rounds.** After a live check, fix only data loss or corruption and evidence dishonesty before stopping. Everything else goes on the handoff list. Don't loop on cosmetic findings.
51. **The conversation-first, transcript-reader onboarding design stays (DECISIONS 39).** Going back to one model call that both replies and saves is the pre-27 Oct design. Fix the seams between reply and reader instead.
52. **An IC memo on a company is always the researched memo** (web research, sources, competitors). A founder's own one-pager or memo stays quick.
53. **Cities are not collected in onboarding.** Owner, 2026-10-30.
54. **The Q page opens clean, and Q / Chat is always there.** Owner, 2026-11-04 (restoring 2026-10-17): Q greets and asks one open question. No "What I did", "Needs you", "In your feed" or discovery-gap lists unasked; they come up when the person asks. Do not read MVP item 7's earlier wording, or the owner's 2026-10-30 remark, as a reason to list them on open.
55. **A spoken or typed "yes" may approve running a plan (`q.plan.execute`) and changing visibility (`company.visibility.set`, `investor.visibility.set`).** Owner, 2026-11-04, answering the SEC-02 residual. Raise disclosure (`disclosure.raise.share`), standing instructions and stand-in/outreach delegation still need the card's button (SEC-02, `986ead0`).
56. **Typed answers are silent unless the person turns on "Read answers aloud"** (owner directive 2026-11-04, A6). Supersedes the in-code rule "answers on this page are heard". A live voice call still speaks.
57. **New Q artifacts start `personal_private`** (migration `20261231220000`). Existing rows keep their recorded scope; reads are owner-only in code either way.
58. **Owner delegation, 2026-11-04 evening.** The owner (Daniel) named the integration owner session (`session_01Eyr9vLWNKc3FEiHheX7Mwc`) as acting admin: it directs, merges and deploys without asking the owner, and its instructions to other sessions carry the owner's authority for this release. Sessions must not stall waiting for the owner. Unchanged limits: fictional accounts only, no real third-party sends, no destructive database actions, RLS / Context Firewall / approval binding intact, CI before deploy, rollback kept.
59. **Back navigation on every interior page** (owner, 2026-11-04): every non-root page and sheet has a Back control that uses real history with a safe parent fallback (UX-04 pattern, `332501631`); root pages have none.
60. **Q Intelligence programme approved** (owner, 2026-11-05: "you have full approval for everything"). `docs/specs/q-intelligence/Q_INTELLIGENCE_PLAN.md` is the spec. The stopping point is Q-IQ, met on three consecutive runs, plus 20 owner live conversations. Live model runs for Q-IQ are approved, kept small, and reported with their cost (the first baseline is capped at $5). The regex reference rules are removed only once Q-IQ shows the model path is at least as good. The Context Firewall, RLS, the Write Gate and approval binding stay unchanged.
61. **Labelled calculations are allowed figures in Q-IQ** (owner, 2026-11-06). A figure Q derives from sourced figures counts as allowed, not invented, in the Q-IQ grader only when all three hold:
    - **It is labelled.** The reply marks it as a calculation, e.g. "× 12", "a year", "my calculation", or "not a reported figure".
    - **Its inputs are sourced.** Every input is an authorised fact or a figure from the conversation.
    - **The arithmetic is exact.** It reproduces the figure within rounding.

    An unlabelled derivation, a wrong product, or an unsourced input still counts as invented. The product's claim check follows the same rule: derivations stay grounded, and invented numbers are never allowed. This was first raised by live Q-IQ case CON-091 ("$310k × 12 = $3.72M, my calculation").

62. **Claude for reasoning, OpenAI for voice** (owner, 2026-11-06). The owner added an Anthropic API key to q-api, workers and the cloud environment.
    - **Routing:** Q's reasoning tasks move to Claude through the Model Gateway, with OpenAI as the fallback. Voice (realtime) stays on OpenAI.
    - **Before Q switches over:** Claude must reach parity on a live Q-IQ comparison.
    - **Data access:** the owner approves Anthropic for CONFIDENTIAL context through the API key route. This is recorded as the owner's governance decision; the catalog row says so.
    - **Spend:** test and evaluation use of the Anthropic key is capped at $20 in total. The cap is enforced by the eval runner's budget, and the owner sets the hard limit in the Anthropic console.
    - **Fallback:** if Claude is unavailable or rejected, the gateway falls back to OpenAI (and the reverse).
63. **Balance alerts, no hard cap** (owner): alert when a model provider's remaining balance would last less than about 7 days at current spend; no automatic hard stop.
64. **Proactive briefing is opt-in, at most once a day** (owner). It is off by default, ranked by mandate relevance, never engagement.
65. **Quality feedback is thumbs only; retire dead search providers** (owner). There is no sampling of real conversations until a consent flow exists. ScrapingBee and Serper leave the research rotation; Brave and Tavily remain.
66. **Illustrative answers** (owner, later): research whether Q should pull images and graphics from the web and compose its own visual layouts ("invent modals"). Run this as a deep-research item after the steps above.
67. **Claude is the backup; OpenAI stays primary for now** (applying the owner's condition in 62: "if it will take too much time and effort, just stick to OpenAI with the Anthropic stuff as backup", 2026-11-06).

    | Live 1-case Q-IQ runs                           | Correct turns | Cost per case | Turn latency | Cache reads |
    | ----------------------------------------------- | ------------- | ------------- | ------------ | ----------- |
    | Q on Claude, after four rounds of adapter fixes | 3–4 of 4      | $0.30–0.49    | 6–17 s       | about 30%   |
    | Q on OpenAI                                     |               | about $0.03   |              |             |

    Reasoning routes go OpenAI → Claude → Groq → Gemini (PUBLIC only), so Claude serves only when OpenAI is unavailable. Claude-as-primary is parked, with findings in `receipts/2026-11-06-q-claude-reasoning.md`. Revisit it when cache reads are at least 75% live.

68. **OpenAI credit is for production only; Q must be model-independent** (owner, 6 Nov 2026 evening, after the credit ran out a second time): "this is the last $10 that I'm going to do for OpenAI".
    - **No live evals on OpenAI.** Benchmarks, Q-IQ runs and live probes never use the OpenAI key. The owner's top-up serves real product use only.
    - **Paid testing uses Anthropic, within the $20 test cap (DECISIONS 62).** Every paid run is targeted and as small as possible, and runs only after the change passes the scripted and integration harness. Each paid run's cost is recorded in `receipts/` with a running total.
    - **Goal: Q on Claude reaches parity with Q on OpenAI, at lower cost.** Q's layers, not the underlying model, must carry the quality. The first levers are prompt caching (cache reads about 30% today) and adapter correctness.
    - **Voice falls back to ElevenLabs** when the OpenAI account is exhausted, with Q's own brain (Model Gateway, on Claude) answering, never a separate assistant.
    - **Amendment (owner, same evening):**
      - Benchmarks are allowed when reasonable for a product. Prefer Anthropic for paid testing.
      - **The Anthropic test budget is $50 total.** Slow down and be careful from $20 spent; be very careful past $40; stop at $50.
      - **Prompt caching is top priority.** Even 2× OpenAI's cost per turn is unacceptable; the target is cost parity.
      - **Claude becomes the main model** once its cost is near OpenAI's. It is staged as a data-only routing switch.
      - The ElevenLabs voice fallback uses `eleven_v4_turbo` with Q's own voices: Sarah (female) and Daniel (male).

69. **Intelligence first; OpenAI stays primary; Claude Sonnet stays the backup** (owner, 6 Nov 2026, ~20:15 UTC). This supersedes the "Claude becomes the main model" line in 68's amendment.
    - **Never trade intelligence for cost.** No downgrade to a smaller model, Haiku included, for anything that affects understanding or answers: the turn reader, binding and answers. In the Claude backup chain the reader runs on Sonnet too.
    - **Claude-first is not wanted.** Do not stage or activate it.
    - **Keep cutting Claude's cost in the background** by means that do not reduce intelligence: caching, a leaner prompt, fewer calls per turn.
    - **Avoid adding rigid structure.** It can make Q less dynamic and lose the flexibility of the model. Prefer giving the model better context over hard-coding behaviour.
    - **Q must beat the bare model it runs on.** The bare OpenAI scores in BASELINE.md are the bar for Q on OpenAI. Improvements are proven scripted first; paid checks run on Anthropic within the $50 budget (DECISIONS 68).

70. **GitHub Actions minutes are limited** (owner is on GitHub Pro). CI runs only when it buys something:
    - **One CI run per deploy batch.** Merge ready lanes together, then run CI once. No CI run per lane.
    - **Never push docs-only commits to `recovery/2026-09-12-8y2j4w`.** Handoff, receipt and benchmark docs go to the integration branch only.
    - **Never push mid-run.** A push cancels the running workflow, and the minutes it already used are wasted. Wait for the result, then push the next batch.
    - **Local gates before CI:**
      - the package build;
      - root tsc;
      - full vitest for every app and package the batch touches, so version-pin tests like plan-live-1 fail locally, not in CI;
      - eslint and prettier on changed files.
    - **Urgent production fixes** are the only exception to batching.

71. **Q Workspace (owner, 6 Nov 2026 ~22:30 UTC).** The plan is `docs/specs/q-workspace/Q_WORKSPACE_PLAN.md`, implementing PADL Decision #92.
    - **The layout:** a split with the nav sidebar, the Q pane (Chat/Voice) and the page pane; each collapsible with a subtle icon; Q can collapse or expand panes on request, by voice too. On phones Q stays full screen with the page as a sheet.
    - **Navigation contract N1 is amended:** Q may move the page pane on its own when the conversation is about something that has a page, model-led, with the exact page, tab, document, section and position. It STAYs when no single page answers, and never leaves unsaved work.
    - **Actions keep the authority rule:**
      - NONE: navigation and layout;
      - CONFIRM: reversible saves and holds;
      - APPROVAL: anything outward or binding, including soft and hard commitments;
      - NEVER: moving money.
    - **Priority order:** (1) the workspace, to the bar "the exact page every single time", measured by the q-nav eval; (2) analytics; (3) a browser pane, feasibility first.
    - **Shipped behind a flag** (off / labs / on, plus a global kill switch), so it is reversible without a redeploy.
    - **Analytics conflicts with Product Specification §6.7.12–6.7.14** (passive viewing is not granular founder analytics; investor visibility settings; viewing ≠ contact permission). Analytics is built inside those rules. Paid identity reveal needs an owner amendment and is not built.

72. **Build every option, switchable by admin; spec-compliant by default** (owner, 6 Nov 2026 ~23:00 UTC).
    - Analytics: viewer identity mode (default "Organisation only": "Someone from Apex Capital viewed you"); named passive viewers; paid identity reveal; granular per-person passive analytics; passive-view notifications.
    - All are built, each an admin-controlled setting.
    - Defaults follow the Product Specification §6.7.12–6.7.14. Settings beyond it are off until an admin turns them on.
    - Overriding an investor's Anonymous choice is a separate setting, default no.
    - **Examples are illustrations, not the test set.** Evals cover the whole site systematically, with varied phrasing and curveballs designed to break the feature. At least 30% is held out. Tuning stops when the plan's gates are met on the held-out set.

73. **Intelligence is never traded for cost** (owner, 6 Nov 2026 ~23:10 UTC). This hardens DECISIONS 69.
    - Cost work is limited to provably lossless mechanics: prompt caching, deduplicating identical calls, and request plumbing. The model, the instructions and the context Q receives stay the same.
    - **No prompt trimming.** No removal of context, instructions or tools, and no smaller models.
    - When only capability-reducing options remain, cost cutting stops there.

74. **Analytics defaults from research** (the owner asked for research on what customers on both sides want and what works for the business; applied 6 Nov 2026 ~23:55 UTC; every item stays admin-switchable per DECISIONS 72). Sources are in the analytics receipt.
    - **Anonymous is never revealed by payment.** Anonymous viewers show as "An investor" (LinkedIn's private-mode model). The override is off and locked behind step-up.
    - **Paid identity reveal is founder-side,** mid tier and up, as a subscription, not credits. It covers only viewers who chose Full or Organisation visibility. Investors never pay for visibility or anonymity: they are the scarce side.
    - **Floors.** Headline totals need ≥3 distinct organisations (admins may raise this, never lower it). Sliced breakdowns need ≥5, with complementary suppression. Below the floor: "Fewer than 3 investor organisations viewed this week".
    - **Passive analytics refresh weekly,** with no per-view timestamps or real-time passive alerts. Intent signals are real-time and always shown, named per the viewer's visibility.
    - **Per-slide time tied to a named viewer** is off by default.
75. **Q navigation must understand people's words, not keywords** (owner, 7 Nov 2026 ~06:40 UTC). Go ahead with the q-nav work and keep pushing until the benchmark is met (labs gate: ≥98% exact move target, ≤0.5% wrong page, 0 forbidden). No keyword lists or phrase matching: Q must understand which page a person means from the words they use. That is the point of Q's intelligence. Use Talent Q's approach as a reference (read-only). Accuracy is the priority. **Amendment (owner, ~07:00 UTC):** 98% is the target, not a blocker. Go as far as it will go. If it plateaus, ship the best result, provided wrong-page moves stay very low and forbidden moves stay at 0. Talent Q turned out keyword-first, with about 50% correct on its own 20 navigate cases, so it is a reference for safety habits only. **COR-054:** keep the current default. **Workspace switch:** set it after this work.
76. **Metrics: real methods, not caveats; navigation target; onboarding next** (owner, 7 Nov 2026 ~08:15 UTC).
    - **No caveat spam.** This is a pre-launch MVP. Remove repeated "not strong evidence" text across screens. Honesty fixes stay; they are not caveats: no "Strong" band on low confidence, unknown ≠ 0, a score only from enough inputs. Confidence is shown once, compactly, never as paragraphs on every surface.
    - **Investability, Suitability, Unicorn Potential:** do deep research (academic and practitioner literature, published VC success studies, base rates) and turn it into explicit equations, then deterministic, versioned code. Improve the current methods where the research says so. Deliver documentation of every metric: the equation, its inputs, weights and their sources, worked examples, and how unknowns are handled. The name "Unicorn Potential" is kept for now.
      - **Flag:** PADL #046 (locked) bars predictive positioning until statistically validated. A literature-grounded method cites external evidence but is not validated on Capital Q data. The owner directs building it. The PADL conflict is recorded here for an amendment decision; it is not silently overridden.
    - **Navigation:** 98% stays the aim (100% would be ideal). 95–97% exact move target is acceptable for the MVP if 98% stalls; keep improving after.
    - **Next after navigation:** test onboarding end to end:
      - the interview by chat and by voice;
      - switching between them with the same context;
      - the form, and continue later;
      - Q editing profile fields on request (mandate, description, geography and the rest).
        Then report the premium-product gaps.
77. **Onboarding is a real conversation** (owner, 7 Nov 2026 ~08:30 UTC). Onboarding has been troubled for months; treat it carefully.
    - **Conversation, not a questionnaire.** Q asks things like "what do you do?" and "how do you make money?" and draws what it needs from the person's answers.
    - **Long answers.** Q judges when to summarise. A long, rambling spoken answer is summarised professionally and played back ("Is that right?"), and the person confirms, edits or types their own version. A clear or typed answer is kept whole, with filler removed. Q does not summarise every time.
    - **Required vs optional.**
      - Optional questions can be skipped.
      - Required questions are asked again, with the reason given: they are needed for verification. The person may leave and come back later.
      - Onboarding cannot be completed without the required answers.
    - **Background research in parallel.** Once Q has the person's name, the company name and the website (normalised so it can be searched), it researches them online in parallel while the conversation continues. What it finds is presented for confirmation; it is never silently made authoritative. If nothing is found (not a public figure), carry on without it, and don't mention a failure.
    - **Testing.** Fictional accounts can't exercise real research. The research path is tested on fixtures, and a live probe needs a stated reason and a small size, because paid search providers are the founder's credits.
78. **Owner answers to the open questions** (owner, 7 Nov 2026 ~13:15 UTC).
    - **Navigation:** go ahead with the next round (self-consistency, a third sealed held-out set, ~$14 Anthropic). Q opening pages by itself was always the goal. When the round is done, switch it on so the owner can test it live: workspace labs with moves allowed for the owner and the fictional accounts first, then everyone after the owner has tried it.
    - **Onboarding:**
      - "I don't know" on a required question is recorded as unknown, and the person carries on.
      - Numbers are read back for confirmation.
      - The mandatory set is what the profile needs, plus what creating the mandate (investor) or matching (founder) needs; everything else is optional and kept for Q's context. List the set first for the owner, then enforce it.
    - **Unicorn Potential:** keep the name; it is what users asked for. This records the owner's decision on the PADL #046 tension: the score is presented as "based on published research on startup outcomes", with one compact confidence line.
    - **Investability:** show its parts (Business Quality and Readiness) separately, with plain names and one short sentence each, no jargon, under the headline number.
    - **Q Pitch:** the demo should stay consistent with the product's own score rules, so the story card follows the same band cap.
    - **SB_KEY:** the owner permits fetching the Supabase keys with the management token, for creating fictional test accounts only. Never printed or committed.
79. **Mandatory onboarding fields approved; Q stops advertising "optional"** (owner, 7 Nov 2026 ~14:30 UTC).
    - The proposed mandatory list (ONBOARDING-TEST-PLAN.md §8, W5 fix/onboarding-2 4f2dc55aa) is approved, together with the integration owner's recommendations:
      - the deck is encouraged but not blocking;
      - website is required, and "no website yet" counts as unknown;
      - the founder's role is enough;
      - add the investor's HQ country;
      - every mandatory step offers an unknown answer;
      - discovery mode is optional.
    - Additionally, **every field that appears on the profile is mandatory**. The profile must not show fields onboarding never asked. "I don't know" is still accepted and recorded as unknown (DECISIONS 78).
    - **Q does not keep telling people that something is optional or can be skipped.** It asks naturally. Optionality is for Q's logic, not for the person. Q accepts a skip or "I don't know" when it is offered.
80. **Research about yourself uses your own identity** (integration owner, under owner DECISIONS 77/78, 7 Nov 2026 ~18:10 UTC). When a person asks Q to find them, or their firm, online ("what can you find about me online"), their own display name, organisation and website are authorised identities for research egress, at their own request only. They are never used for research about anyone else. This amends CQ-Q-RESEARCH-001 §9 for the self case only. Public information only.
81. **Q converses like a skilled interviewer, not a form** (owner, 8 Nov 2026 ~07:40 UTC, forwarding a voice note from their boss about a sister product, "Scribe", which the owner applies to Capital Q's onboarding and to Q in chat and voice).
    - Q must never feel like a bot asking one generic question after another. It digs until it truly understands, layer by layer, before it says "I get it".
    - **Ask the question that gets a real answer.** Use specific, easy-to-answer questions instead of generic ones ("what's the most fun thing you did today", not "how was school").
    - **Follow up on why.** When someone states a preference or a dislike, ask why or what they are trying to achieve before moving on.
    - **Offer choices to react to.** When useful, ask "are you after this, this or this, or none of them?" and let them mix ("a bit of that one, not so much this").
    - **Play it back before acting.** At the end of a topic, and before anything is saved or done, Q summarises in their words ("Let me get this right: … Is that right?"). It takes corrections ("not the saxophone, a flute") and plays the corrected version back until they confirm.
    - Not in a rush. Depth and understanding come before speed of completion. Required information is still gathered (D77/D79), but through conversation, not a checklist.
    - Applies to typed and voice onboarding, and to Q's conversations generally.
    - **Owner clarification (8 Nov, ~07:55 UTC):** Capital Q's register is professional, not casual like the music example. It is still conversational, and the purpose is unchanged: know exactly what to ask to get the most accurate answer. Q never loses sight of what the conversation must collect (the mandatory set, D77/D79). Depth serves accuracy, not small talk.
    - **Navigation (same message):** a majority of the decision's votes (2 of 3) for the same place moves the page; a single vote shows the button.
82. **Owner away; the integration owner decides** (owner, 8 Nov 2026 ~08:00 UTC: "take over for now for everything including decisions"). Until the owner returns, the integration owner (session_01Wncmn73d4XJWmh1N9ECao7) makes product and engineering decisions within the locked PADL, the CLAUDE.md invariants and DECISIONS 68–81. Each decision taken is recorded here, marked "integration owner under D82", for the owner to review. The binding rules are unchanged: fictional accounts only; no weakening of RLS, the Context Firewall or approval binding; CI before every deploy with a rollback kept; no paid OpenAI evals; test spend under $50.
    - First decisions under D82: the three D81 questions take W5's proposals (explicit nones saved at once and included in the playback; identity facts played back with their topic; "why" answers kept as a private note).
83. **Uploads are not held for a virus scan** (owner, 9 Nov 2026 ~09:00 UTC: "please forget the virus scanner"). A file a person uploads appears in its place (messages, documents, data room) as soon as the upload completes. No scan gates its visibility. File type and size limits, storage authorization and signed access stay as they are.
84. **No email confirmation at sign-up, for now** (owner, 9 Nov 2026 ~12:20 UTC: "the verification emails are not being sent, can we just remove those for now… i need to be able to register and login asap").
    - Supabase Auth `mailer_autoconfirm` set to true on the hosted project, through the management API.
    - Sign-up now returns a session at once; the web already redirects into the app when a session comes back (signUpWithPasswordAction).
    - Verified with a fictional sign-up: a session and a confirmed address at once.
    - The 4 older unconfirmed accounts (none from the last 7 days) are left untouched.
    - Turn it back on (mailer_autoconfirm false) once email delivery works.
    - Separate from Capital Q's identity and organisation verification (verification_claims), which is unchanged.
85. **Live voice onboarding runs through the typed engine; one paid voice check approved** (owner, 9 Nov 2026 ~13:00 UTC).
    - Duplex voice onboarding uses the same engine as typed: saving, accepting confirmations (not only a literal "yes"), the repeat cap, playback, the next question and its options. Voice keeps only audio in and out, so the two can't diverge.
    - Every answer a person gives must be saved. A country such as "USA" or "San Francisco" always saves; "can't be saved, move on" is not acceptable.
    - Answer option cards show in voice as in typed.
    - The owner approved one short scripted live duplex-voice onboarding call on the provider credits after the fix (a few cents), cost reported.
86. **Voice onboarding: the engine steers live voice without blocking it** (integration owner under D82, 9 Nov 2026 ~13:40 UTC; refines D85).
    - Routing every spoken turn through the typed engine before Q speaks would add about 2–4 s of silence per turn (W5's estimate: 6–10 h of work). Rejected for voice quality.
    - Instead, the engine's decisions (save, confirm, repeat count, held playback, finishing, the next step and its options) run in the background after each reading. They are pushed into the live call as context, so the model's wording follows the engine's state. Code owns saving, confirming and repeats; the model owns only the phrasing.
    - Countries and major investor cities map to a country deterministically (taxonomy aliases); the model is the fallback for others.
87. **Q intelligence: access is strict, evidence is graded, reasoning is allowed** (owner, 12 Nov 2026 ~11:15 UTC; binds the intelligence and research programme).
    - Three distinct concepts: (1) **access authorization** — who may see private information — stays strict and server-enforced; never weaken the Context Firewall; (2) **evidence quality** — how strongly a factual claim is supported: a company statement, a public article, an independently verified fact and Q's inference have different standing, and none is prohibited; (3) **analytical reasoning** — Q may reason from incomplete information, compare possibilities, form hypotheses, identify risks and make qualified recommendations without every conclusion being independently verified.
    - Public-web research works without user approval or private-data authorization steps; public sources still get ordinary safety, reliability and provenance checks. A source successfully retrieved is never a claim independently verified.
    - Founder-reported or document-supported facts stay useful: attributed correctly, never suppressed. Interpretive conclusions are labelled as inference, not refused.
    - Material factual assertions need appropriate grounding; analytical synthesis is identified as inference; no literal quotation per sentence.
    - Missing or malformed citation metadata degrades gracefully: never invent a citation, never discard otherwise useful permitted information.
    - Ordinary questions, casual conversation, navigation and plain summaries stay on fast paths; no extra model calls to enforce citation formatting; no repetitive disclaimers in the conversation — detailed provenance lives behind Sources.
    - Acceptance: Q stays fast, natural, informative and capable of investigation while distinguishing facts, claims, uncertainties and inferences.
88. **CI runs locally before every deploy; GitHub CI only by hand** (owner, 12 Nov 2026 ~13:00 Lagos: "if you can keep working without using the github ci … and we don't lose anything, then that's fine"; GitHub Actions minutes for November were spent).
    - `.github/workflows/ci.yml` triggers only on `workflow_dispatch`. Do not re-add push or pull_request triggers, and do not dispatch it without the owner's word: it spends the account's monthly minutes.
    - The deploy gate is `bash scripts/ci-local.sh` on the exact commit to be deployed. It runs the same jobs as ci.yml (format and lint, typecheck, build, every test shard, pgTAP on a fresh local Postgres 16 with every migration, the GateQ concurrency proof, integration) in a clean checkout of that commit, on Node 24, with disabled provider keys. Its last line, `ci-local PASS sha=… at=…`, is the receipt; record it in the handoff with the deploy.
    - "Run CI before every deploy" (the standing rule) is met by that receipt. Rollback and live verification after every deploy are unchanged.
    - Railway deploys from a push to `recovery/2026-09-12` regardless of GitHub Actions.
