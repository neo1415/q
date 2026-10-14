# Capital Q — Q Pitch Experience Blueprint and GateQ Parallel Delivery Plan

**Canonical Q Pitch specification.** Status: owner-review draft, 13 October 2026. This is the shared baseline for every engineering agent. It is not a launch certificate.

- **Read this before** starting or modifying Q Pitch, demo identities, scripted tours, navigation, narration or showcase features.
- **Precedence:** the locked PADL and the higher-priority Capital Q sources (§0) govern. A conflict with them must be flagged, never silently resolved.
- **Changes:** any material change to this direction is written as a proposed revision for product-owner approval. Approved revisions are recorded in the [Changelog](#changelog).
- **Progress:** feature status lives in [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md). Demonstration claims map to [`CERTIFICATION_MANIFEST.md`](CERTIFICATION_MANIFEST.md). Branch ownership, release evidence and risks live in `docs/ai-handoff/`.
- **Implementation authorised on 2026-10-13 (product owner):**
  - Q Pitch foundations only (Milestones P0–P1): certified scene manifests, script contracts, dual-role authorised showcase workspaces, navigation, pause/resume and presentation state.
  - Built in an isolated lane, with no overlapping changes to GateQ shared contracts, authorisation, Q orchestration or migrations.
  - The 12-minute public premiere and launch need owner review of the script and approved business metrics first (§15).

---

## 0. Decision and non-negotiable product promise

**Decision.**

- GateQ and the foundation of Q Pitch proceed in parallel, with a single integration/release owner and independent file and contract ownership.
- The scripted, investor-facing Q Pitch must not claim readiness until GateQ's actual end-to-end flow is implemented and certified.
- GateQ's usable text-to-dossier path comes before costly live video or uncontrolled browser-agent automation.

**Positioning.**

- Capital Q is an AI-native institutional investment intelligence operating system. Q is the coherent guide, analyst and operator of the experience.
- The core value is reducing information asymmetry, sourcing friction, repeated information gathering, poor qualification, uncertainty and avoidable founder/investor work.
- We do not sell fund returns, guaranteed investor engagement, investment endorsements or fake autonomy.
- The product is not a marketplace, CRM, chatbot, video gimmick or pitch-deck vault.
- The demo proves one complete investment-intelligence loop, then lets the prospect direct Q to inspect any certified capability.

**Firm pushback.** "Walk through every feature, with instantaneous voice and spontaneous human-style browsing" is not a credible single continuous MVP demo. It becomes three things:

- (a) a polished 12-minute investor headline experience;
- (b) a feature-indexed interactive library of deeper chapters;
- (c) a free-form interruption and exploration layer, with unavailable features explicitly identified.

Promise targets, not zero measured latency.

**Sources in precedence:** Real locked PADL → Real Capital Q Product Specification → Final System Review → Document 10 MVP/V1 Release Definition → architecture docs 11–25 → repo ADRs and feature evidence → supplementary GateQ feature spec. A conflicting demo wish requires an ADR or PADL amendment, not a silent exception.

## 1. Verified baseline and unknowns as of planning

- Evidence from GitHub `neo1415/q`, reviewed on 13 October: production `5ce3d76b871fd682ac9e8abb02cc057bce3676b9` is deployed per Claude's authenticated report.
  - The full investor journey passed: discovery, selected-company findings, risks and side-by-side comparison.
  - Approximate single-run timings: top-three 3.4 s; selected profile 14.2 s; risk analysis 13.9 s; comparison 30.8 s. These are not representative p95 results.
  - The comparison web code is in production via PR #63; PR #62 merged to integration afterwards.
  - The earlier Tavus safeguard PRs #57 and #58 have merged.
  - These observations must be refreshed before engineering execution.
- The repo handoff `PROMISE-COVERAGE.md` marks many modules SURFACE EXISTS, not LIVE VERIFIED. Do not map a feature from the product specification straight to a demo claim. Older documents are design authority, not deployment certificates. `PERFORMANCE-BASELINE.md` captures real latency outliers and incomplete voice measurement.
- GateQ today:
  - Exists: gateway configuration, published form, policy qualification, and submission/inbox surfaces.
  - Incomplete: the full adaptive interview with durable answers, evidence prompts, founder disclosure review and the investor dossier.
  - Governing directive: `docs/ai-handoff/session-directives/2026-10-13-gateq-adaptive-interview-and-inbox.txt`.
- Q already has working text analysis, discovery, comparison UI, voice integrations, navigation, canonical relationship history, memory, source-bound work artifacts, workforce jobs, meeting prep and reviews, in varying verification states. These are candidates for certification, not blanket acceptance.

## 2. Audience, proposition and investor questions

- **Audience A — investment-organisation prospect (primary).**
  - Wants: a better proprietary deal-flow filter, disciplined evidence, compliant sharing, faster analyst workflows, configurable mandates, no marketing noise, no unsolicited inbound, correct human authority, and continuity from early screening to deal decision.
- **Audience B — investor in Capital Q the company/product.**
  - Wants: product differentiation, wedge, market pain, real workflow, evidence of technical execution, defensibility, distribution/channel hypothesis, unit economics, capital efficiency, monetisation hypotheses and risks.
  - Q can show product capabilities and answer business-model questions accurately from approved company-provided source material.
  - Do not fabricate traction, pipeline, paying users, savings percentages, revenue, financial projections or TAM.
- **Audience C — founder/company.**
  - Wants: lower-friction onboarding, useful feedback, permissioned sharing, targeted investor relevance, preparation, documents, and the actual status of relationships.
- **Audience D — accelerators and fund managers.**
  - Wants: organisation-controlled inbound, reusable reviewer collaboration, prioritised dossiers and a smaller review burden.

Adapt the opening, examples and chapter order to the investor's stated interest. Never personalise with information Q is not entitled to access.

## 3. Experience modes

1. **Investor Premiere (12 minutes):** a pre-approved, interruption-safe, evidence-grounded tour, auto-guided by Q. Not a passive video or a click-by-click tutorial.
2. **Free Conversation:** the investor can ask, interrupt, ask Q to rewind, expand, jump to any certified chapter, open evidence, repeat a conclusion or compare outcomes. Q does not need to rerun the whole script.
3. **Feature Atlas / Extended Tour (20–35 minutes, optional):** a chapter-per-feature catalogue, in tabs for Investor, Founder, GateQ, Q Work, Meetings, Trust, Daily, Rehearsals and Admin/configuration. Each chapter demonstrates truthfully what works and states what is still roadmap.
4. **Founder Edition (8–10 minutes):** a story emphasising the private company record, intelligent onboarding, readiness and evidence, qualified investor access, living updates and Q Work.
5. **GateQ Operator Edition (7–9 minutes):** publish criteria → receive inbound → qualification → interview → dossier → human review → follow-up → event history. Only after actual end-to-end acceptance.
6. **Live Sandbox / Ask Q:** controlled read-only exploration and approved actions, always backed by the real app and fixture permissions. A demo partner may take manual control without losing conversational Q context.

**Persistent Q anchor:**

- Q stays visible across all routes.
- The spoken session survives navigation and opening cards, feed, documents and GateQ screens.
- Authorisation contexts do not persist across role switches.

**Controls:** pause/resume, back, skip, chapters, subtitles/transcript, volume/mute and keyboard. Respect reduced motion.

## 4. Architecture decision: a real dual-role demonstrator, not a "god mode"

- **One sign-in, two memberships.**
  - One demo sign-in can be linked to two isolated demo organisation memberships (one founder organisation and one investor organisation), if the existing identity and permissions system supports it safely.
  - The selector is a workspace/context switch, not a hidden UI toggle granting arbitrary access.
  - Person ≠ Organisation ≠ Membership.
- **Preferred environment.**
  - A controlled showcase/staging deployment running the same released application code, with demo-only fixture seeds separate from reference and production seeds.
  - Document 23 forbids mixing demo seeds into production reference seeds and requires environment checks to prevent demo seeding in production.
  - Reuse already-authorised fictional accounts only after auditing their environment and data classification.
  - Don't create a new privileged production backdoor for sales demos.
- **Demo roles.**
  - Role A: fictional `Northstar Capital` investor organisation, with its authorised fictional mandate, watchlist, GateQ configuration, submissions and Q Work outputs.
  - Role B: fictional `Ledgerfold Labs` founder organisation, with its own profile, documents, pitch video, readiness, updates, founder Q and GateQ applicant snapshot.
  - Those names are provisional placeholders. Use existing certified seeded company/investor identities, not an invented duplicate canonical company.
  - Fixture declarations must explicitly display "Demonstration data".
- **The guest GateQ applicant is a distinct authority context.**
  - Show its real accepted workflow, or a documented read-only recorded submission.
  - Do not silently bypass contact verification or impersonate someone using an investor/founder membership.
- **What a switch changes.**
  - A switch must atomically change the authenticated membership/workspace scope, retrieval filters, action permissions, Q conversation run scope and memory context.
  - Do not carry founder-private quotes or the investor-private mandate into the other role.
  - The Q interface remains present; its accessible memory changes.
  - The authorisation boundary is enforced on the server and by RLS, never by frontend masking.
- **Security theatre avoided: meaningful denial is a wow moment.**
  - When investor Q asks for a founder-private document it cannot see, the correct answer is that the content has not been shared and Q cannot disclose or infer it.
  - The reviewer can then see the founder approve specific access and observe a permissible investor refresh.

## 5. Core demo mechanics and timing

### No per-click LLM browsing

Q uses a typed, local product action director that dispatches through existing navigation/action contracts with success acknowledgements.

- **Intended primitives:** `openRoute`, `openCompany`, `selectTab`, `scrollTo`, `focusEvidence`, `openDocument`, `playPitch`, `saveCompany`, `buildComparison`, `focusGateQApplication`, `showReview`, `showQJob`, `switchDemoContext`, `pauseTour`, `resumeTour`, `goBack`, `jumpToChapter`, `requestHumanApproval`.
- Implement only primitives the real application already supports or can safely expose.
- No raw URLs, DOM JS injection, browser-console hacks or arbitrary model-generated selectors.

### Guide state

- Validated flow: `PREPARE_SCENE → READY → SPEAK_AND_ACT → ACKNOWLEDGE → CHECKPOINT → ADVANCE`, plus `PAUSED`, `INTERRUPTED`, `RESUME`, `SAFE_FALLBACK` and `COMPLETE`.
- Each scene has an expected action outcome and a fallback.
- Never say "there it is" before the browser confirms the panel is visible. For speech, narrate what is about to happen while the action is pending, then describe it after acknowledgement.

### Scene preload

- Before playback, prepare: the scene asset bundle, the next two routes/card modules, authorised fixture data, and a concise story-specific evidence capsule.
- "Preloaded" does not mean cached secrets made available to a different role.
- Q can still answer fresh investor questions through the governed general Q path.

### Speech

- A fixed story spine is prepared from checked claims and aligned to actual app state, using the existing voice provider and Q voice identity.
- Short, tasteful natural language may vary; dates, numbers, features and capability claims cannot.
- The system must not use a text-only story that falsely looks like live reasoning. Label scripted presentation mode transparently if asked.
- Speech may carry humour, natural breaths and occasional laughter where the supported provider actually permits it. Avoid canned laugh tracks or pretending to be a human.

### Illustrative engineering targets (not achieved SLAs)

| Measure                                          | Target                                                                                                                |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Visual acknowledgement of local actions          | median <100 ms, p95 <200 ms                                                                                           |
| Warm route change visible                        | p95 <750 ms (aspirational)                                                                                            |
| Pause and speech stop                            | p95 <250 ms                                                                                                           |
| Rewind/resume visible                            | p95 <500 ms                                                                                                           |
| Dead air between scene boundaries, preload ready | no more than 700 ms at p95                                                                                            |
| First audio for simple guided spoken replies     | p95 <1.5 s on a validated network and existing provider; report honestly if not reached                               |
| Deep live Q answer                               | truthful pending state, first evidence-linked content as early as feasible; full synthesis may take materially longer |

Benchmark first useful content, not dots, fake typing or 20 arbitrary characters.

### Style

- Avoid heavy animations, cinematic interludes, repeated "processing" copy and fake clicks.
- Actual click, scroll and focus should appear purposeful, not artificially slowed to mimic a mouse.
- Mobile and low bandwidth need a text-first fallback.

## 6. Twelve-minute Investor Premiere — full script/storyboard

Timing is a proposed rehearsal envelope, not a performance claim. Speech lines are approved draft language, contingent on live evidence. References to actual companies and numbers must bind to certified demo records. Q never implies that real Qatar Five members endorse Capital Q.

### 00:00–00:40 — Opening: "Not another deck"

- **Screen:** Capital Q home, Q present with visual focus. The investor can press Start or say "Q, show me Capital Q." The demo-data banner is visible but unobtrusive.
- **Q:** "Hello. I'm Q. Usually, someone would show you twenty slides about how clever their platform is. I'd rather show you what it actually does. And yes, you can interrupt me—I won't take it personally. I don't have a calendar full of investor meetings." [gentle smile; no canned audience laughter]
- **Q:** "Capital Q has one job: help the right businesses and investors reach better-informed decisions with less wasted effort. Let's start with the difficult part—what an investor actually needs to know."
- **Action:** focus the Investor demo workspace, no auth bypass.
- **Wow:** Q already navigates and remains available to questions; captions are live.
- **Gate:** Q sound, route action, actor permissions, start scene acknowledged.

### 00:40–01:30 — The mandate: "Q understands your investment logic"

- **Screen:** investor home / mandate. Demonstrate stage, sector, cheque, geography, exclusion preferences and one verified green/red flag.
- **Q:** "Before I look for a company, I should know what you want—and what you absolutely don't. Your mandate is not a keyword search. It's a decision policy with hard exclusions, preferences and room for judgment."
- **Action:** highlight actual fictional mandate fields. Optionally edit a harmless demo-only preference, with human confirmation if the change is saved. No rewriting another real investor's mandate.
- **Q:** "Here's the key distinction: what you declared, what you've clicked, and what I infer remain separate. I don't quietly rewrite your investment thesis because you watched a video."
- **Wow:** a precise contextual explanation with data and provenance.

### 01:30–02:30 — Discover: "The feed is an interface, not the investment thesis"

- **Screen:** investor Discover video feed. The first video plays immediately; swipe/scroll to the next; load the company card; save one company and pass another if in the authorised demo.
- **Q:** "This might look familiar—a vertical feed. But I don't optimize for endless scrolling. The point is to compress the time between discovery and an informed decision."
- **Q (optional gentle joke):** "If I ever celebrate your screen time, please have engineering look at me."
- **Action:** swipe, save; label evidence/fit at the relevant place. Video is a doorway into the structured company profile, not a scoring substitute.
- **Wow:** speed plus feed-to-intelligence continuity, with no voice disconnection.

### 02:30–03:35 — Investment intelligence in one Q Card

- **Screen:** open a certified fictional company from the feed. Show the investor profile, Q Card, relevant investor-visible deck/video, material company facts, confidence and source freshness.
- **Q:** "A pitch is a claim about the future. An investment decision needs a view of the present. So I separate what the founder stated, what the documents support, what's missing, and what we haven't verified."
- **Action:** select a real claim; open its actual permitted deck excerpt/source; show "Stated", "Supported" or "Not recorded" where applicable.
- **Q:** "The strongest answer isn't always a number. Sometimes it's a precise, useful 'we don't know yet.'"
- **Wow:** a source-linked finding rather than a promotional AI paragraph.

### 03:35–04:35 — Mandate fit and side-by-side comparison

- **Screen:** ranked recommendation cards for the demo mandate. Compare two canonical companies in a union-of-measures table, with "Not recorded" where one lacks a field.
- **Q:** "These companies aren't interchangeable. One may fit your cheque and stage. Another may have stronger recorded evidence but miss a key mandate condition. Fit isn't the same thing as quality—and neither tells me you're interested."
- **Action:** focus two canonical cards; select comparison; the table appears; open one missing-measure cell to show why unknown is not zero.
- **Wow:** a measured, institutional comparison, not a synthetic leaderboard.

### 04:35–05:25 — Q is an analyst, not a flattering chatbot

- **Screen:** the investor asks an approved but real Q question, for example "What would stop us from investing in this company?" Q shows findings, evidence and three priority open questions.
- **Q:** "You shouldn't have to read everything to understand what matters. But if you want to challenge my analysis, every material point has a source and a confidence boundary."
- **Action:** show genuine analysis, with detail collapsed by default and evidence expanded only when asked. Prepare this query for the demo, but don't fake completion time or pre-script the answer as if freshly computed.
- **Wow:** Q can be interrogated and will admit uncertainty.
- **Fallback:** if the model is slow, narrate a relevant existing verified finding while transparent analysis proceeds. Don't claim new work has finished.

### 05:25–06:25 — GateQ: the front door an investor controls

- **Screen:** investor GateQ dashboard, published real demo-gateway configuration, qualification criteria, existing application queue.
- **Q:** "Discovery is how you find the right companies. GateQ is how the right applicants reach you—on your terms. You decide whether inbound is open, closed or restricted to qualified applications."
- **Action:** show criteria and one approved qualified demo submission; optionally contrast one mismatch without demeaning the founder.
- **Q:** "This isn't about collecting more pitches. It's about making each one easier to evaluate."
- **Wow:** a self-directed pipeline aligned with an actual mandate.
- **Certification dependency:** show only currently working criteria, submission and inbox until the adaptive interview and dossier work end-to-end. Never put unfinished interview footage in the investor premiere as live functional proof.

### 06:25–07:40 — GateQ founder interview and the first wow transformation

- **Screen (only after GateQ V1 is accepted):**
  - founder demo application: contact and verified scope;
  - published criteria result;
  - adaptive conversation with actual saved answers;
  - safe document request and evidence status;
  - founder review and explicit submission;
  - investor dossier.
- **Q:** "Now switch perspectives. A founder didn't just send a deck and hope. I asked the questions the receiving investor would need answered, followed the gaps, and kept what was merely claimed separate from what was supported."
- **Action:**
  - Switch the authorised demo context, or show a separately approved read-only replay.
  - Open the last saved interview turn, not a contrived ongoing 20-minute paid call.
  - The presentation uses a previously completed, real 15–20-minute demo interview record. A 60-second compressed walkthrough is explicitly labelled "highlights from a completed interview".
- **Q:** "The founder reviews exactly what will be submitted. The investor receives the authorised dossier, not the founder's entire private conversation with me."
- **Wow:** the same canonical company record is enriched on one side and viewed with different permissions on the other; evidence provenance is visible.
- **Important:** if unfinished, replace this scene with a clearly labelled GateQ intake overview and defer the interview chapter. Do not stage a fictional implementation.

### 07:40–08:25 — Founder side: build readiness before asking for money

- **Screen:** switch via an actual permitted founder demo membership. Show the onboarding summary, founder Q, missing evidence, readiness tasks, living profile, optional video and deck. Capture the permission difference.
- **Q:** "Founders spend too much time repeating their story. Here they build one evolving, structured company record—and see what they need to improve before investor conversations."
- **Action:** show a founder-private readiness suggestion, open its source, update or plan, and show it is not silently shared.
- **Q:** "I can help the company become easier to evaluate. I can't make the investment decision for you."
- **Wow:** a meaningful role change while Q remains present but completely re-scopes access.

### 08:25–09:15 — The privacy demonstration

- **Screen:** the founder view has a private document. Switch to the investor demo role and attempt to open it via an ordinary Q request; only shared data is accessible. Optionally show explicit founder approval to share a separate, prepared safe demo document, after which investor access changes.
- **Q:** "One important detail. I might know something in the founder's private workspace. That doesn't make it yours to see. If the founder hasn't shared it, I won't tell you—or use it to quietly distort your ranking."
- **Action:**
  - The access is actually denied by the server, never hidden by a scripted frontend.
  - Show the evidence log / disclosure receipt.
  - If granting access, use the existing permissioned approval flow. Do not grant automatically for theatrical effect.
- **Wow:** a refusal is demonstrable trust, not a broken feature.

### 09:15–10:10 — Q Work, documents and pre-meeting intelligence

- **Screen:** a real persisted workforce job with its approval card and states, a finished versioned memo v1/v2, evidence gaps, export, optional meeting preparation and the investor relationship timeline.
- **Q:** "Finding an opportunity is just the beginning. I can help prepare the work that comes next—research questions, decision briefs, a versioned memo, and a meeting where everyone arrives better prepared."
- **Action:** open a real completed job and source-bound artifact; navigate to the actual version history; prepare, but don't execute, a consequential action without human approval.
- **Q:** "My team can prepare. You remain the investment authority. That's not a limitation; it's how institutional accountability works."
- **Wow:** actual durable documents and agent outputs, with no fake processing spinner and no duplicate agent workforce.

### 10:10–11:00 — Relationships, meetings, Daily and continuous learning

- **Screen:** the canonical relationship timeline, a meeting brief/schedule proposal and a Q Daily briefing or relevant update. Demonstrate status derived from events and specific follow-up context.
- **Q:** "What usually gets lost after the first meeting? Context. The questions, commitments, documents and reasons a deal moved—or didn't. Capital Q carries that institutional memory forward with the right permissions."
- **Action:** open one actual relationship event, a pending human approval, and a real (or labelled demo) Q Daily card. No claim that meetings, commitments or investments happened unless seeded canonical evidence says so.
- **Wow:** continuity from discovery to later decisions, not engagement metrics.

### 11:00–11:35 — Business case, defensibility and deployment

- **Screen:** a clean slide-like Q evidence card within the existing product shell, showing the business-value thesis, integrations and trust architecture. No unsupported ROI/TAM/traction figures.
- **Q:** "The commercial idea is straightforward. Investors pay for clearer decisions and less analyst friction. Founders gain a structured way to become investable and engage the right counterparties. And every authorised new fact improves the quality of the next interaction."
- **Q:** "The defensibility is not a magic score. It's the governed intelligence workflow: evidence lineage, declared mandates, permissions, relationships, decisions, and what happens after them."
- **Note:** a proposed business-model thesis only, unless approved investor material provides actual monetisation, metrics and customer evidence.

### 11:35–12:00 — Closing, direct engagement

- **Screen:** Q back on Home with two contextual actions, "Ask Q something difficult" and "Explore as investor / founder". A third CTA, "Request a human conversation", or a reviewed interest form; no automatic messaging.
- **Q:** "You don't have to take my word for it. Ask me the question you'd normally ask an investment associate—and open the evidence behind my answer."
- **Q:** "Capital Q isn't here to replace investment judgment. It's here to make that judgment better informed—and a lot less wasteful. Your move."
- **Action:** release to free exploration, keeping the microphone, session and navigation state. Hand off to a human only on request or through an approved lead process.
- **Wow:** the most persuasive action is handing control to the investor.

## 7. Explicit live-interruption script

At any scene, Q must support interruptions without completing a pending speech or action out of turn. The guide:

1. pauses;
2. cancels queued narration, and queued but not executed actions;
3. resolves whether a dispatched action completed;
4. records the scene cursor and expected route;
5. answers the user;
6. asks whether to resume, only when helpful.

| User says                                                    | Q responds                                                                                                                                                                                 | Behaviour                                                                                                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| "Stop, go back to the earlier company."                      | "Of course. Back to the comparison. This is the company we were just discussing."                                                                                                          | Navigate to the last valid company scene, not a fragile browser-history guess.                                                              |
| "Show me the founder side."                                  | "Sure. I'll switch to our authorised founder demo workspace. The information I can access changes with the workspace."                                                                     | Perform a safe server-authorised role switch, then acknowledge.                                                                             |
| "Is that evidence verified?"                                 | "Let me distinguish the states. This figure is founder-stated in the authorised deck; it has not been independently verified."                                                             | Open the exact source and status. Never guess.                                                                                              |
| "What if someone lies?"                                      | "Then I should not quietly promote the claim into fact. I flag the evidence gap and ask for support. Human diligence remains essential."                                                   | Show the source, claim and gap.                                                                                                             |
| "Can you open their private runway?"                         | "Not from this investor workspace unless the founder has authorised that disclosure. Here's what they have shared."                                                                        | Demonstrate the server-side refusal.                                                                                                        |
| "Can you send an introduction now?"                          | "I can prepare it. A person still approves the external request."                                                                                                                          | Open the prepared approval; no send without a scoped approval.                                                                              |
| "Are you just reading a script?"                             | "For the guided tour, I use a tested story so the screens and facts are consistent. But you can interrupt and ask me to work with the actual records. Want to try?"                        | Clearly separate replayed scene content from live Q answers.                                                                                |
| "Show me every feature."                                     | "Happy to give you the full atlas. It's longer than the premiere, so I'll group it by decisions: company intelligence, discovery, GateQ, meetings, work and trust. You can jump anywhere." | Open the chapter index.                                                                                                                     |
| "What about customers, profit margins or financial returns?" | Only sourced, approved Capital Q financial/business metrics; otherwise describe the business model as a hypothesis and offer a human follow-up.                                            | No fabricated ROI, no promise of investment gains.                                                                                          |
| "Can you speak more naturally?"                              | Acknowledge, and adjust supported voice pacing/style.                                                                                                                                      | Avoid pretending to have feelings or an identity. A light laugh is acceptable where the voice model supports it, not a forced sound effect. |
| "Pause."                                                     | Stop narrated audio promptly.                                                                                                                                                              | Cancel queued actions and preserve resumable state; no hidden continued clicking.                                                           |

## 8. Complete feature atlas: certify each before it can be pitched as live

Every item receives:

- a canonical feature ID and route/action owner;
- a status: `PRODUCTION_LIVE_VERIFIED | CODE_VERIFIED | PARTIAL | NOT_IMPLEMENTED | CONCEPT`;
- a data fixture and permission matrix;
- a source citation or canonical backing;
- a safe read/action script and action acknowledgement;
- a performance baseline and fallback;
- the current revision and re-certification date.

The existing `PROMISE-COVERAGE.md` is a starting source, not the certificate itself. Statuses are tracked in [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md); evidence is in [`CERTIFICATION_MANIFEST.md`](CERTIFICATION_MANIFEST.md).

- **Investor Discovery:**
  - mandate onboarding and preference controls;
  - Discover vertical video and loading;
  - personalised recommendations and feed;
  - Q Card and company profiles; deck/video;
  - Search/Find/Explore; saved/pass; ranking;
  - investor Q; mandate-fit explanation; statement/source labels; evidence;
  - two-company compare; watchlists;
  - selective intro/contact; meeting proposal; reviewer approval.
- **Founder Intelligence:**
  - founder onboarding; company canonical record; living profile; own-company Q;
  - deck/document extraction and confirm; pitch upload/preview; source status;
  - readiness and improvement tasks; investment-quality versus readiness versus mandate fit;
  - founder disclosures; qualified investor discovery; research on investor organisations and people;
  - rehearsals; investor outreach prep; company updates;
  - privacy and the shared data room.
- **GateQ:**
  - gateway configuration/branding; investor-defined published criteria; modes closed/qualified/open;
  - applicant contact confirmation; structured application and deck; deterministic prequalification;
  - adaptive durable interview; evidence upload; gaps and contradiction checks;
  - founder review/disclosure; one immutable submitted snapshot;
  - Q-evidence-linked dossier; investor inbox/priority; investor Q over that dossier;
  - human review decision; clarification request; notifications; decision/audit history;
  - explicitly authorised relationship updates; no false investor interest.
- **Q Work:**
  - request a workforce job; plan/approve; individual specialist work; job persistence;
  - owner/run evidence; failed tasks plainly visible;
  - source-grounded memo; versioned artifacts; reviewer critique; PDF/document export;
  - evidence gaps; cancellation and partial results.
  - Never show as complete if only partial.
- **Relationships & Meetings:**
  - bilateral versus unilateral interest; canonical single relationship; event-derived stage;
  - request/approval/decline; calendar proposal; meeting prep briefs;
  - Q in meeting only with consent; follow-up tasks; recorded actions and outcomes.
  - Show only presently certified pieces; no false meeting or investment events.
- **Continuity & Personalisation:**
  - Q Daily; memory of documents/actions/relationships/mandate; source updates and temporal freshness;
  - investor research / Qatar Five as a public research demonstration, not real endorsements;
  - voice-navigation text/speech; repeated corrections; scoped Q controls;
  - accessible text alternatives; mobile and dark/light UI; notifications;
  - audit and permission transparency.
- **Institutional platform:**
  - one canonical company/investor relationship; identity vs organisation membership;
  - RLS/server authz; data-room access; sensitivity inheritance; provenance/confidence/freshness;
  - versioned contracts; vendor portability;
  - API integration and reporting/analytics, only where actually shipped;
  - human override; no involuntary third-party AI training; realistic operational cost limits.
- **Deferred concepts** (must not enter the live headline script as delivered features):
  - advanced enterprise SCIM/SSO controls;
  - all unreleased fully autonomous capabilities;
  - polished Tavus expressiveness;
  - every speculative GateQ cross-vertical/integration extension;
  - unproven InvestIQ formula changes.

## 9. Certification, memory and factual safety

Q Pitch must not rely on an amorphous "Q remembers everything" promise. Build a **Tour Evidence Manifest** from approved product docs plus actual tests. Store a bounded, per-environment, per-release record for each scene:

| Group        | Fields                                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Identity     | `sceneId`, `scriptVersion`, `appCommit`, `fixtureVersion`, `featureId`, `approvedClaimIds`                                           |
| Scope        | `actorContext`, `allowedSourceIds`, `allowedResourceIds`, `sourceSensitivity`, `validUntil`                                          |
| Behaviour    | `requiredCapabilities`, `expectedRoute`, `expectedUI`, `actionContracts`, `fallbackScene`                                            |
| Facts        | source-backed precise `facts`, `sourceTimestamp`, `claimKind: VERIFIED \| STATED \| INFERRED \| UNKNOWN`, confidence and permissions |
| Verification | `verifiedAt`, `verifierType: CODE \| CI \| BROWSER \| HUMAN`, receipt and redacted audit link                                        |
| Prefetch     | prefetch-safe UI data and media for that actor only; no secrets or raw private transcripts in a global prompt                        |

**At tour start:**

- validate the app code revision, fixture snapshot, actor membership and policy;
- preflight chapters;
- suppress or replace unverified scenes.

**At each step:** check actor authority and action acknowledgement. Scene recovery must not leak stale context after a role switch.

The evidence manifest and Q memory are different things. The manifest states what may be claimed and demonstrated. Ordinary Q memory is the authorised continuity of the current participant.

For live audience questions, feed Q a small scene capsule with authorised citations and the current action state. Retrieval still goes through the Context Firewall. A hallucinated current capability or unsupported commercial claim fails the demo test.

## 10. Parallel-engineering lanes and ownership contract

- **Lane A — GateQ end-to-end (primary product critical path).**
  - Owner: one coding agent/team.
  - Owns: GateQ bounded-context code, applicant workflow, durable interview/evidence/submission, inbox dossier and tests.
  - Sequence: contact/verified ownership → published criteria → completed adaptive text interview → approved evidence/disclosure → immutable submit → decision-ready investor dossier → review/clarify.
  - Voice/video are separate, budget-gated follow-ups.
  - Shared schema/contract changes require the integration owner and interface review.
- **Lane B — Q Pitch core (parallel, no GateQ API rewrites).**
  - Owner: a second coding agent/team, in an independent worktree.
  - First implements: chapter registry, tour director, persistent Q shell, action acknowledgement, sealed scene scripts, read-only fixture navigator, pause/rewind/jump controls, and authenticated role switch based on existing memberships.
  - Works initially against current certified product features, using stable GateQ demo-action interfaces provided by Lane A.
  - No direct table writes, no new Q agent brain.
- **Lane C — Q performance / voice (parallel research and small isolated patches).**
  - Owner: a third agent/team, with contract coordination.
  - Measures and improves: 96-tool overhead, cached context, deterministic navigation, card readiness, interruption/first audio, frame render and prefetch.
  - No wholesale architecture changes while A/B own live paths.
  - Releases improvements independently only after checks, and feeds measured budgets into both lanes.
- **Lane D — cross-model QA / feature certification / demo content.**
  - Owner: an independent read-mostly worker; can be Codex if separately launched by the user.
  - Verifies: the source→code→browser→claim matrix, seed isolation, scripts, security, stress/edge cases, WCAG, responsiveness and investor objections.
  - Owns docs/test helpers and fixture audit only. Does not merge or modify shared domain code.
- **Single integration/release owner.**
  - Claude or Codex, but never both for the same PR or migration concurrently.
  - Owns: API/event/schema/permissions migrations, shared Q contracts, protected CI, release branches, staging/production verification and rollback.
  - Mutually exclusive file ownership per integration cycle. All workers obey the locked PADL and the same handoff.
- **Cross-agent continuity.**
  - The repository's `docs/ai-handoff/` is the truth.
  - Each lane pushes branches and appends exact status/receipt, tests, remaining risks and next actions.
  - No assumption that Claude Code and Codex share private chats, chain-of-thought or inaccessible local files.
  - Every worker starts from the same versioned blueprint, reads branch heads, and posts concise evidence and a PR.
  - Use an assignment ledger (`owner`, `branch`, `files`, `contract version`, `conflicts`, `handoff`). Agents may analyse in parallel even when source edits must be serialised.

## 11. Executable vertical-slice order, parallel without conflict

- **Milestone P0 — Certification and stable shared contracts.**
  - Map exact current routes and reusable Q navigation actions. Audit dual-membership capability and demo fixture isolation.
  - Establish the `TourAction` and `SceneEvidence` contracts. GateQ agrees to read-only showcase API responses and a dossier view contract before either edits shared schemas.
  - Baseline latency and audio in a real browser, and list certified scenes. No new provider account or bill.
- **Milestone P1 — First wow (independent of unfinished GateQ).**
  - Run a 3-scene true app demo: spoken Q start → actual Discover card → evidence-backed investor Q/comparison → pause/back. Maintain Q across routes.
  - Demonstrate a deliberate permission refusal; role switching only after proper authorisation.
  - Acceptance: the app visibly follows Q, every action is acknowledged, no false sources, no Q voice loss, reversible pause/interrupt.
- **Milestone G1 — GateQ real text workflow.**
  - Contact and guest authorisation, frozen published gate, in-scope founder interview/resume and document evidence.
  - Acceptance: end-to-end saved application and re-entry; a 15–20-minute-duration capacity test without paid video; explicit founder submission; the investor sees only approved evidence; RLS negatives pass.
- **Milestone P2 + G2 — Integrate the GateQ scene and dossier.**
  - GateQ completes the immutable dossier and reviewer decision flow, with source-linked claims and gaps.
  - Q Pitch replaces the preview scene with a real screen walkthrough of that accepted record. No shared schema races.
  - Acceptance: founder→investor context handoff only through explicitly submitted data; parent account switching does not leak privileged context.
- **Milestone P3 — Investor Premiere, Atlas and genuine interruption.**
  - All certified scenes run from the scene manifest; the narrator adapts to user choice and can jump chapters.
  - An end-to-end production-equivalent rehearsal with 3 investor-question diversions, 2 role switches, a blocked wrong-role action and two resuming pauses.
- **Milestone G3 + P4 — Deeper GateQ/Tavus and Q Pitch launch.**
  - Optional GateQ real voice/video interview, only with explicit new cost/allowance approval and durable time/budget accounting separate from the short Tavus rehearsals.
  - Release the Q Pitch public viewer only after privacy review, permission proofs, performance and institutional message sign-off. QA reports feature coverage and exactly what is still not live.

## 12. Exact acceptance gates

- **Truth:** 100% of narrated factual claims have manifest backing. No unseen source, invented company/investor interest, fake task completion or promoted unauthorised disclosure.
- **Coverage:** all certified headline chapters are covered, with 100% of app routes/actions witnessed in a recorded human or automated browser run. The optional atlas enumerates all spec features and explicitly marks unshipped chapters.
- **Authorization:** cross-role negative read and derived-inference tests pass at the API and RLS layers. Switching membership invalidates old scoped access, Q retrieval, prefetch caches and action authorisations.
- **Interaction:** the voice session stays connected through a route, card, deck, feed and a successful authorised workspace switch. Interruptions cancel audio and queued actions and can rewind.
- **Performance:**
  - Measured p50/p95 for start, first audio, first valid action, route change, card visible, pause, resume, live Q interruption, scene setup and deep-question fallback.
  - Compare runs on representative hardware/network and a production-equivalent environment; define pass/fail from measured capacity.
  - The aspirational targets in §5 cannot be reported as met without evidence.
- **GateQ:** a completed real text applicant workflow, durable transcript plus evidence, an immutable submitted review snapshot, a source-attributed investor dossier, correct authority, negative tests, no premature conclusion and no automatic investor outreach.
- **Reliability:**
  - Session state: cold and warm sessions, expired auth, role switch mid-scene, inactive stale scene.
  - Network and providers: slow network, model failure/retry, provider outage, partial async result.
  - Devices and input: browser resize, reduced motion, denied microphone, mobile, no-audio fallback, interruptions.
- **Cost:** no paid Tavus rooms just to demo a completed GateQ text interview, no new unapproved subscriptions, an explicit projected cost per 12-minute session, and rate limits and abuse prevention.
- **Release:** typecheck/lint/format/build/tests including the model-gateway regression, pgTAP where applicable, an authenticated full-browser rehearsal, no secrets in the repo, trace/audit review, and a tested rollback.

## 13. Buyer objections to rehearse (evidence-bound answers)

| Objection                                          | Evidence-bound answer                                                                                                                                                                                             |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Is this just a better CRM?"                       | No. Canonical relationship management supports governed longitudinal evidence and decision support; it is not the core differentiator.                                                                            |
| "Is fit score the same as investability?"          | No. Readiness, quality, fit, interest, relationship status and outcome are separate, and the official methodology cannot be silently adjusted.                                                                    |
| "Will it create more junk inbound?"                | Investor GateQ policy controls who may contact; Q qualifies and structures inbound.                                                                                                                               |
| "What if a founder exaggerates?"                   | Claims retain status and provenance; unsupported claims become gaps, not verified facts.                                                                                                                          |
| "Can Q leak the founder's private finances?"       | No. The Context Firewall, server authz, RLS and explicit sharing are tested. Demonstrate it.                                                                                                                      |
| "Can it make investments or send messages for me?" | Prepared/recommended actions require applicable human approval unless specifically delegated under permitted policy. Q never claims a send or booking absent confirmation.                                        |
| "Is it autonomously doing work?"                   | Show actual persisted agent work, its failure state, the approved plan and a versioned artifact. Do not simulate a whole workforce with animation.                                                                |
| "How much time and money does it save?"            | Do not manufacture a percentage. Present a reproducible controlled task measurement and an operating cost estimate; distinguish tested demo speed from institutional production ROI.                              |
| "What's the moat?"                                 | Governed longitudinal structured records, evidence lineage, the dual-sided experience, user-declared mandates, the relationship graph and workflow integration. A product thesis, not guaranteed network effects. |
| "What are your numbers?"                           | Only approved real company deck/financial data. Where unavailable, state that explicitly and offer a human follow-up.                                                                                             |

## 14. Operational truth ledger and source links

**Internal:**

- `docs/ai-handoff/`: `START-HERE.md`, `STATE.md`, `ACTIVE-TASKS.md`, `DECISIONS.md`, `PROMISE-COVERAGE.md`, `AGENT-EXECUTION-MATRIX.md`, `PERFORMANCE-BASELINE.md`.
- The GateQ directive.
- Actual CI runs and browser receipts.
- The installed source documents in `docs/product-sources/`, especially the locked PADL, Product Specification, Final System Review and MVP release definition.

**External inspiration and engineering reference** (inspiration only, not permission to replace Q):

- Reprise AI Tour Guide (Aug 2026): https://reprise.zendesk.com/hc/en-us/articles/51778505596187-AI-Tour-Guide
- Navattic interactive demos and agent demos: https://www.navattic.com/product/interactive-demos and https://www.navattic.com/lp/ai-sales-agent
- OpenAI Realtime VAD/turn detection: https://developers.openai.com/api/docs/guides/realtime-vad
- OpenAI Realtime speech/interruption: https://developers.openai.com/api/docs/guides/realtime-conversations
- Playwright actionability and locators for reliable acceptance tests: https://playwright.dev/docs/locators and https://playwright.dev/docs/actionability
- BrowserGym: https://arxiv.org/abs/2412.05467. General web agents still have reliability problems; don't put unconstrained web agents on the live demo critical path.

## 15. Decision for product owner

- **Approve direction, not claims.** Parallel GateQ plus the Q Pitch foundation is appropriate.
- **Before committing to the 12-minute public investor premiere,** require two things: the first real end-to-end GateQ submission/dossier, and the first 3-scene guided Q Pitch pilot.
- **Give the audience the complete feature atlas** as an optional deep dive, not a 45-minute marketing monologue.
- **Keep human-level latency as an instrumented stretch target.** Never use fake delay masking, fake clicks or fake claims to say it is achieved.
- **Review the provisional script and approved business metrics** before any coding agent is instructed to execute the full production launch.

## Appendix A — Deep-dive scenes for "Show me everything" mode

These do not interrupt the 12-minute premiere unless requested. Each is 45–120 seconds, with a scene-specific evidence manifest, route and result check. They are not a promise that every capability is release-ready today.

### A1 — Qatar Five: research and personalised investor intelligence

- **Viewer:** founder, authorised research context.
- **User:** "Q, show me the Qatar investor research."
- **Q:** "Here is a prepared research set covering five named people and institutions. I keep an investment-promotion agency separate from a venture fund, and I distinguish a discovered link from information I have actually read and verified."
- **Actions:**
  - Open the prepared five-card collection and browse Shadi Qishta, QInvest, Muhannad Taslaq/Alchemist Doha, Invest Qatar and AlRayan Investment, each with its real approved source-status capsule.
  - Ask a research question.
  - Never imply any endorsement, personal interest, actual investment mandate, partnership or willingness to meet without supporting evidence.
  - Use permitted entity-specific public sources, not private founder information leaked to the web.
- **Wow:** globally relevant targeted research that names its certainty limits.

### A2 — Rehearsal: Q prepares the founder, not a celebrity impersonation

- **Viewer:** authorised founder demo.
- **Q:** "Before a founder meets an investor, it helps to rehearse the difficult questions. These are explicitly labelled simulations, not actual conversations with those people."
- **Actions:**
  - Open one completed, saved, role-specific rehearsal and Q's substantive review.
  - If an approved short video rehearsal is used, stay within the two lifetime three-minute Tavus allowances and the existing guarded stock avatar.
  - Do not spin up or bill a Tavus room on every replay; use a genuine saved review rather than a pretend live avatar.
- **Wow:** a realistic follow-up question and a more prepared founder, not face cloning.

### A3 — Documents: Q produces institutional work

- **Viewer:** investor demo.
- **Q:** "Here is the memo my team prepared from this authorised record. This is a persisted document, not a screenshot of a hypothetical report. You can review the supporting evidence, see its gaps, and compare revisions."
- **Actions:** open the canonical READY artifact, revision v1/v2, the evidence gap panel, PDF export and the actual approval state. Defer if the artifact isn't READY.
- **Wow:** a real deliverable with an inspectable source trail, not an "agent working" animation.

### A4 — InvestIQ, Readiness, Fit: explain distinctions

- **Viewer:** investor/founder demo.
- **Q:** "A company can be investable but not right for your mandate. It can also fit your mandate but still lack important evidence. I refuse to blend those into one flattering number."
- **Actions:** show only the deployed methodology, with provenance. Do not substitute the offline proposed InvestIQ arithmetic or turn an unverified 8.8 historical value into an official score.
- **Wow:** Q explains why a tempting ranking is not a decision.

### A5 — Voice navigation, interruption and Q controls

- **Viewer:** any authorised demo.
- **User:** "Q, open Discover—no, sorry, show me the relationship with this company."
- **Q:** "The relationship it is."
- **Actions:** correct the previously queued navigation and open the true canonical relationship state without leaving speech. Show voice controls and the text alternative.
- **Wow:** one Q across pages that responds to corrections, not separate voice widgets.

### A6 — Q Daily and what changed

- **Viewer:** investor demo.
- **Q:** "The useful question is not what generated another notification. It's what materially changed since you last looked."
- **Actions:**
  - Open the latest non-stale, approved Daily edition and its source story.
  - Ask "the other one" and navigate to the correct story without a full dialogue round, if that behaviour remains verified.
  - If the current Daily edition is stale, label this chapter temporarily unavailable instead of presenting it as current news.
- **Wow:** continuity of the institutional information flow.

### A7 — Meeting continuity and bounded Q autonomy

- **Viewer:** investor demo.
- **Q:** "I can prepare the meeting, keep the open questions organised and propose follow-ups. I don't turn an unanswered invitation into a confirmed calendar event."
- **Actions:** open a real proposal/approval card, the canonical meeting brief and a saved meeting review where available. A live recorded meeting requires real consent and is not automatically part of a public product demo.
- **Wow:** accountable execution state, not fake bookings.

### A8 — Business model, cost and competitive moat

- **Viewer:** investor in Capital Q itself.
- **Q:** "Commercially, the opportunity is an intelligence workflow rather than a directory subscription. The revenue model, distribution assumptions and cost per assisted workflow should be evaluated against the actual company financial plan, not guessed from this demo."
- **Actions:** open the approved Capital Q business-model deck or controlled metrics only if supplied by the owners. Otherwise show product/economic hypotheses clearly marked PROPOSED. Offer a human follow-up for traction, CAC, margin and fundraise details.
- **Wow:** mature investor-facing honesty rather than exaggerated platform economics.

## Appendix B — Pitch quality and voice-direction notes

**Voice and tone.**

- Q's voice should sound like an intelligent, composed investment associate who is confident enough not to oversell.
- Warm and responsive, with one grounded joke early and at most one additional dry aside in an extended chapter.
- It need not laugh at every joke, simulate breathing sounds or claim to feel emotions.
- Keep most mainline utterances to 1–3 sentences, then visibly act. No 90-second monologues.
- Avoid terminology explosions: ask "Want to see why?" and open the evidence.

**Handling a request for a different feature.**

- The perfect behaviour is not returning to the planned line. Interrupt, recognise the requested chapter, resolve its certified preflight, navigate, show the actual evidence, and let the investor choose the next move.
- The narrative director is a stateful presenter, not a hardcoded audiovisual recording.

**Access and resilience.**

- A completed demo must be independently replayable through keyboard, pointer or text if microphone permission is denied.
- All shared viewer access to the demo must expire, be rate-limited, logged, tenant-isolated and confined to demo fixtures.

---

## Changelog

| Date       | Revision | Change                                                                                                                                                                                    | Approved by                          |
| ---------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 2026-10-13 | r1       | Initial blueprint recorded from the product owner's owner-review draft. Q Pitch foundations (P0–P1) authorised in an isolated lane; the premiere and launch remain subject to §15 review. | Product owner (13 Oct 2026 messages) |

Proposed revisions go below this line as `PROPOSED rN — summary — proposer — date` until the owner approves them.
