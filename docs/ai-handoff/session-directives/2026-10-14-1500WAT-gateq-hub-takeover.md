# CAPITAL Q — CODING ACCOUNT TAKEOVER (GateQ + Relationship Hub)

**Checkpoint:** 14 October 2026, approx. 15:00 WAT (Lagos). **Repository:** https://github.com/neo1415/q

**Purpose:** Durable continuity across interrupted Codex sessions. This section reflects latest verified GitHub activity and the immediately preceding operator log. The full Hub product requirements are appended below. **Always refresh GitHub, protected CI, Railway, migrations, and local worktrees before changing or claiming release state.** When this checkpoint conflicts with an earlier dated paragraph later in this file, this new checkpoint takes precedence. Locked PADL and Real Product Spec retain higher architectural authority.

## Executive outcome: GateQ text journey is now real, CRM H1 is live, remaining intelligence/evidence work blocks full completion

**Production release**: `recovery/2026-09-12` at `71c5d4a58c314eca7981c08265b2e29015bc2b7b` (PR #85), with prior PR #84 qualification protection. Latest checked GitHub CI `38556079265`: **SUCCESS**. Outgoing agent explicitly reported all four Railway services running this revision, plus real founder/investor Hub browser checks. Connector access in this handoff verified branch and CI, not Railway service API directly.

**GateQ founder → investor LIVE TEXT ACCEPTANCE (operator report from final session):** Fictional Maji Loop founder went through verified contact, four-step structured form, adaptive Q interview preserving qualified canonical facts, full review and explicit Submit, reloaded with persisted history and submission confirmation. Investor opened the **same submitted application** in GateQ inbox and saw its mandate assessment, saved applicant and Q turns, frozen brief, missing evidence, claim labels and expanded transcript. Another investor was denied (404 for gateway and dossier). Thus core **text** submission-to-investor journey is proven on released baseline. It does NOT prove guest-document uploads, document-grounded interview, dossier Q or completed investor follow-ups.

**Critical newly discovered product failure:** With that actual submitted dossier open, investor Q responded that application content was unavailable, despite fully rendering an answer (~23.5s one observed sample). Reported causes: current **screen-context read knows only the inbox list rather than the selected dossier**, and existing **dossier-reading Q tool puts long findings into a field capped at 600 characters**. The outgoing agent was editing this repair when usage ended. Nine changed files (~185 additions according to session UI) existed in its working environment, but GitHub did NOT show a pushed investor-Q repair branch/PR as of this checkpoint. **Do not assert recovery without direct git status/worktree proof**; rescue first if possible, otherwise reimplement narrowly using existing authorized dossiers, Q tool and manifests. A rendered answer is NOT adequate acceptance; require source-backed content and selected-application attribution.

**Second new GateQ issue:** Some meaningful applicant traction and use-of-funds details were excluded from the frozen dossier because the interviewer's permitted _recordable dimensions_ were tied to its shorter list of _next questions to ask_. Decouple capability to record valid factual dimensions from next-question selection. Preserve validation, accurate typing, provenance, temporal/source evidence and deterministic qualification. Avoid inventing facts or changing scoring.

**Dossier description bug already preserved:** PR **#89** (`https://github.com/neo1415/q/pull/89`) merged into `build/int-rc` at `1b72e44dc2dd701dd2800231784f8cefee96de69`. Source head `ac6cd481e738a97352eb81c7b197e423fd35c926` and exact-head CI **38572329768 SUCCESS**. It keeps a natural-language applicant description in the submitted dossier while bounding inbox preview to the contract. This code is **not yet in the current production branch**; create a properly tested production release candidate rather than redoing it. Other release candidates may be stacked; refresh first.

## Relationship Hub / CRM current state

**H1 released and operator-verified:** Role-aware investor **Investment Hub** and founder **Fundraising Hub** are available under `/relationships?view=overview`, using canonical Relationship records, real authorized Results read, links to Discover/GateQ/Capital/Q Work/Reports and existing Capital Q tokens. `/relationships` still has existing Relationships board. Outgoing account reported authenticated investor and founder desktop and mobile acceptance, and typed Q navigation receipts. No independent UI design prototype was merged. H1 is a shell and aggregation, **NOT full CRM**.

**Major RECOVERABLE H2 WIP:** branch `codex/hub-h2-pipeline` HEAD `2d9dfa1ef8687bc4827a70a8070c30f35a1bb97e` pushed at 13:19 UTC. One WIP commit; latest comparison to `build/int-rc`: **diverged, 1 ahead, 2 behind**. Approximately 27 modified/new files across contracts, Network application/API, web UI, Results/export and tests. Implements initial **server-authorized filtering/search/sorting/cursor pagination**, relationship pipeline tables/boards, selections, contextual preview, route-based view state, Q semantic controls, local per-device saved views/column preferences and a scope-matched export path. **It has not passed release CI, is not merged or deployed; do not assume it works end to end.** Review the `apps/web/src/features/relationships/relationship-pipeline.tsx` (substantial), `packages/network/src/application/relationship-pipeline.ts`, `apps/web/app/(app)/relationships/export/route.ts` and tests. Preferences currently use browser `localStorage`, **not durable cloud/team-synchronized views**. Audit authorization, cursor integrity, selected-row scope, CSV formula injection, performance and output metadata. Rebase/reconcile via feature branch, not wholesale unreviewed integration.

**H3/H4 still outstanding:** connected relation detail for meeting timestamps/transcripts, document pages and Evidence provenance, GateQ dossier and Q Work jobs/approvals, coherent Q context and fast semantic navigation, authorized collaboration/reporting, complete states and responsive/accessibility checks. This is a major product initiative; deliver vertical slices instead of a big speculative rewrite.

**Visual owner decision:** Previous design PR #75 is _rejected aesthetically_ (wrong colors/theme, verbose explanatory copy, weak hierarchy). It remains review-only and is NOT approved for production. Functional Hub is explicitly authorized; build with existing Capital Q UI tokens, light/dark themes, typography, existing navigation/motion/accessible semantics, small concise copy, progressive disclosure and real loading/empty/error/pending/approval states. Future premium redesign must not require rewriting contracts/business logic/Q control.

## GateQ guest Evidence: partially recoverable, not yet release-ready

Saved branches **not merged**:

- `codex/gateq-guest-upload-expiry` HEAD `553316c5136a8e6e624b33a4a9af42dffe9f7762` (13:28 UTC): recovered application evidence custody and **fenced provider upload expiration / cleanup**; includes 3 candidate migrations `20261223120000`, `20261223130000`, `20261223140000`, RLS tests and Evidence integration tests. Based on an older integration revision; validate migrations vs current hosted migration inventory.
- `codex/gateq-guest-evidence-recovery` HEAD `b35813def71c4bf5293580e4243d64c989c11dca`: conservatively reserved upload bytes. Earlier problem: trusting only declared file size can undercount actual file and complicate refused upload/deletion safety.
- `claude/gateq-guest-evidence` HEAD `5858eb1ddfac5c5d5675ce4d5cc775bd67ea15cd` and `codex/gateq-guest-integration` HEAD `05e7ab62ea06a7bf9e0530a9b75c39b0f019598f`: historical foundations. **Diverged**; cherry-pick selectively only with schema/security review; never blanket-merge old migrations.

Desired end state: guest-scoped application uploads with real size/expiry and idempotent reservations, ingestion/extraction authorization, safe failed retry and cleanup; Q questions grounded in authorized document evidence; founder review/selection and explicit document/version disclosure; immutable submitted document references; investor reads only validly shared versions; no shadow tenant membership; hard cross-application/tenant boundaries and prompt-injection defenses. Never equate file upload with disclosure or relationship formation.

## Other in-flight work

- **Research competitor follow-up**: `codex/q-competitor-research-audit` PR #86 exact `6aae43781e910cb959976ac956de596743e968fc` CI **SUCCESS**; release PR #88 branch `codex/release-research-continuity-oct14` exact `c8374d6b4b2d3821aa21f592897f5ca79d2813bf` CI **SUCCESS**, still OPEN at last read. This fixes loss of named researched aviation-company target on follow-up, not Capital Q product-inventory gap analysis. Secondary priority. Check real release lane and browser behavior, do not burn main work window researching market gaps.
- **Hub acceptance evidence**: PR #87 `codex/hub-h1-release-takeover-oct14` at `4a02425da7d01e757f0ca2f4ee7a15da2877db30` CI SUCCESS, OPEN. Contains acceptance driver and handoff, not H2 feature code. Reconcile without losing work.
- Historical `codex/wip-gateq-*` branches are UNVERIFIED/SUPERSEDED, do not wholesale merge.
- Q Pitch is a separate workstream and must not be modified casually.

## Immediate priorities and acceptance

**P0 — Recover interrupted work / release safe completed changes:** inspect all current worktrees, `git status --short`, untracked files, branches and workers for the partially implemented **investor Q dossier-context/600-character cap fix** and interview claim-dimension change. Preserve meaningful work in a fresh WIP commit (not automatically release-ready). Verify current release of #89. Do NOT restart previously shipped GateQ fixes.

**P1 — Finish investor Q GateQ dossier intelligence:** bind authorized Q screen context to the actual selected submitted application and appropriate version, not merely inbox. Reader contract must handle large source-linked findings without truncation or exposing private material; revise type safely/version as needed. Test wrong app, wrong investor, pre-submission visibility, stale/closed dossier, large findings, multi-application selection, native Q response showing actual dossier claims/uncertainty. Model response ~23.5s needs later timing optimization; correctness first. Release and verify live browser.

**P2 — Capture full applicant claims:** decouple recordable supported dimensions from interviewer next-question coverage and bound only valid server-verified claims. Verify traction/use of funds in frozen investor dossier and stable correction/retry behavior. Fix tests, integrate and release.

**P3 — Complete guest Evidence:** recover above branch work, do secure upload/custody/extraction/Q use/founder disclosure/investor evidence read end to end with migrations, RLS and hostile-scope tests.

**P4 — CRM H2:** recover above pushed H2 WIP, test and integrate safe functional slices using canonical Network/Results/Relationship contracts; secure scoped exports, saved views, columns, table/board, Q controls, pagination. Then H3/H4 deeper integrations with meeting transcripts, GateQ, Q Work and Q-readable scoped activity.

**P5 — Ancillary research follow-up:** only after important GateQ/Hub slices, finish validated PR #88 normal release and run original failed competitor follow-up replay, avoid inventing market gaps. Full competitor-vs-live-Capital-Q implementation inventory is a different product-sourced research feature and needs separate verified implementation facts.

For each slice: read governing documents/ADRs and existing code; short objective/acceptance/threat preflight; implement, run format/lint/types, relevant tests/pgTAP/authorization/browser/perf, commit & PUSH, protect CI, integrate and verify hosted service SHA; report known gaps. Preserve human approval, Context Firewall, one Q runtime, existing Q Work and voice, canonical company/investor/relationship, events and separate Readiness/Quality/Fit/Interest/Relationship State/Outcome. Never report a deployed result from merely merged integration code.

**Before account usage cap:** commit/push current meaningful changes or WIP, list every dirty worktree, exact branch HEAD and PR, CI jobs, migrations, current hosted version, live test receipts and blockers in `docs/ai-handoff/HANDOFF-LOG.md`, `STATE.md`, `ACTIVE-TASKS.md`. Never lose uncommitted work during context compaction or handoff.

---

## CANONICAL RELATIONSHIP HUB PRODUCT SCOPE (appended from prior owner-approved functional handoff)

# Capital Q — Relationship Hub / CRM Product & Engineering Handoff

**Checkpoint:** 14 October 2026, ~10:08 WAT. **Document status:** User-directed functional brief and implementation checkpoint, **not an architectural ADR**, not a new higher-authority product specification. Refresh live state before acting.

**Repository:** https://github.com/neo1415/q

## Authority and owner decisions

Source precedence: (1) locked PADL; (2) Real Capital Q Product Specification; (3) Capital Q Final System Review for clarifications and V1 boundaries; (4) supplementary/partially verified GateQ Feature Specification; then relevant approved ADRs, engineering docs 10–25, code and the user's latest explicit decisions. Flag any conflict and propose ADR/PADL amendment rather than silently contradicting higher authority.

Owner decisions for this initiative:

1. The former design prototype (PR #75) is **not approved as Capital Q's production visual design**. Its colors, layout, verbose copy and themes diverged from the real product. Keep it as a _functional research/prototype reference only_; **do not merge its visual CSS into production**.
2. Functional production implementation is **authorized immediately** using the existing Capital Q UI system (`packages/ui/` tokens/components, established themes, navigation, accessibility). A later professional redesign must be possible without rewriting APIs, data models, Q controls, workflows or tests. Do not block useful functionality on prototype design approval.
3. Presentation style: quiet institutional futurism, minimal first glance, detail accessible on demand, precise concise labels, no verbose helper prose everywhere, coherent states and transitions, subtle existing motion, reduced-motion support, mobile and desktop, light/dark/system consistency.
4. GateQ production acceptance and guest Evidence continue in separate nonconflicting branches; Hub is not an excuse to stop GateQ.
5. Q is one shared governed institutional analyst/orchestrator, never a separate per-tab chatbot, independent memory/database or model-directed browser script. Reuse and improve current fast navigation, manifests, controls, receipts, RAG, Q Work and voice.

## Product promise

**One Capital Q; two role-specific relationship workspaces.** Investors see an **Investment Hub** for screening, diligence, decisions and portfolio relations; founders see a **Fundraising Hub** for investors, their raise, meetings, requests and progress. Not a generic sales CRM. The overview answers: **What matters? Why? What is next? Where is the source?** The system maintains one canonical company, investor organisation and company-investor relationship. No duplicate CRM domain database. Relationship state comes from append-oriented events. Preserve six distinct dimensions: Readiness, Quality, Fit, Interest, Relationship State, Outcome. A GateQ application is not automatically investment interest or a canonical relationship.

### Investor capabilities

- **Overview:** Q's permission-filtered briefing, overdue/urgent reviews, material changes and evidence gaps, upcoming meetings, decision/approval queue, relevant active agent work, next actions. Avoid a wall of KPI tiles and generic activity counts.
- **Pipeline:** All authorized opportunities from Discover, GateQ, intros and established channels; search, combinations of filters, sorting, saved/team views, optional table/board/timeline, owners, source, recency, statuses, compact record previews and bulk actions. Board movement cannot arbitrarily mutate canonical stage.
- **GateQ:** Investor's approved published criteria, inbox, qualification and coverage (distinct from Q quality opinions), founder interview/transcript, frozen submitted dossier, claims vs documented evidence, assignment, comparison, follow-ups, human review, audited decisions.
- **Meetings & Activity:** Bookings/meeting outcomes, transcript and timestamps, meeting summaries, agreements, tasks, messages, relationship event timeline, clear provenance and visibility.
- **Portfolio:** Confirmed investments, company updates, commitments, monitoring and follow-on context where real source records exist; never invent valuations/performance KPIs.
- **Reports & exports:** Existing Results dashboard as deep reporting surface, CSV/PDF and eventually justified XLSX, filtered exports, source-linked diligence briefs, activity/progression/outcomes (different from engagement), download status/expiry and permission-scoped jobs.

### Founder capabilities

- **Overview:** Actual raise/commitment progress, investor relationship priorities, investor requests, Q briefing, meetings and next actions.
- **Investors:** Search/qualify prospects; mandate fit where supported; outreach/intros; real relationship stage, latest actions, discussions, private notes and follow-up deadlines.
- **Fundraising:** Rounds, target, amount committed vs soft interest, terms, document readiness, funding outcomes with correct units/provenance.
- **Meetings & Requests:** Relationship calls, Q meeting summaries, transcript navigation, diligence requests, replies and delivery tracking.
- **Updates:** Founder-approved company/investor updates and scoped, revocable disclosures; no hidden investor deliberations or internal notes.
- **Reports:** Raise and relationship progress, permission-filtered exports and Q explanations.

### Individual record — investment relationship workspace

One canonical counterpart and relationship; no parallel per-Hub deal record. Short initial header: identity, relationship state, owner, next action, evidence/mandate signals **kept distinct**. Progressive, accessible tabs/sections for Overview, Intelligence, GateQ, Evidence/Documents, Meetings/Transcripts, Activity/Communications, Diligence, Q Work, Decisions/Outcomes. The investor and founder see different authorized fields. Contextual quick actions: review, schedule, ask Q, compare, request evidence, export, open Work, prepare/approve. Avoid eight equally prominent tabs on narrow mobile; group secondary details. Every claim can navigate to its underlying authorized timestamp, source document page, transcript span or historical event.

### Conventional CRM behaviors (real, not fake controls)

- Fast global/scoped search; server-side authorized filters by company/investor, sector, geography, stage, owner, source, fit/qualification, evidence gaps, meeting/follow-up dates, recency, Q Work status; cursor pagination and stable sort.
- Save/rename/delete views per user or organization with appropriate role permissions; configurable columns; table and board as presentations over canonical records, not new stages.
- Cross-page selection, record previews, back/forward/deep-link behavior, bulk operations with audited/approved consequences. Input and keyboard accessibility.
- Role-scoped attachments, file versioning, meeting transcripts and source links, activity history, notes, reminders and collaboration via owning contexts.
- Imports with mapping/deduplication where justified; exports limited to **the exact authorized selected/filter scope**, safe CSV formatting, progress/error/expiry/denial, no surprise broad exports.
- Complete state machine UX: loading, ready, empty, no matches, partial/stale, unavailable, unauthorized, pending/confirm, blocked, processing, failure/retry, finalized, export queued/ready/expired, agent running/awaiting approval/failed/completed. Use semantic state/data contracts independent of visual motion; no unverified optimistic completion.

## Q: fast total workspace control, context and intelligence

The user must be able to tell Q naturally to open the Hub, switch tab/view, filter/sort, select company/relationship, reveal a panel, scroll, open a specific document/page, jump to transcript timestamps, navigate GateQ results, show a comparison, open an agent job/report/approval and return without losing the conversation. Voice and typed control share typed actions. Reuse `apps/web/src/features/q/control/{fast-navigation,app-routes,q-control-runtime,registry,perform}.ts*`, `apps/web/src/features/q/manifest.ts`, tool/control parity generator and actual Q action/receipt lifecycle. Never invoke a second navigation implementation, random DOM selectors/coordinates, fabricated route or false success. Prepare → human approval → execute for consequential changes, unless valid explicitly scoped delegation.

**Speed:** deterministic local actions for known tabs/filters/scroll, low-latency route resolution, prefetch, stable semantic IDs, preserved Q/voice sessions, measured final-words-to-action, action-to-settled-UI, document open/seek, first useful answer, retrieval/provider timing, failure receipts. Keep LLM calls off trivial UI critical paths. No invented performance metrics.

**Context:** Hub is Q's principal _view_ of relationships and events, not Q's authoritative memory/database. Provide permission-filtered scoped read models and fresh, source-linked briefing summaries for 'what matters today?'. Deep investigations use canonical facts first, then authorized RAG on documents, GateQ, meetings, transcript spans and Work. Context Firewall: user/organization/private vs shared sources, source time, confidence/provenance, cache authorization/invalidation. Q knowing something never implies current actor can read, cite, export or share it. No silent private competitor/third-party data exfiltration in research.

**Q Work:** surface **real** persisted existing jobs, agents, statuses, generated evidence/artifacts, approvals, recovery and report links in relationship context. No mock agent work in production. Workforce runs on its established governed kernel; Hub is only a permission-aware presentation/interaction layer.

## Existing implementation to reuse

- `apps/web/src/features/results/`: server-authorized Results analytics and existing PDF/CSV.
- `apps/web/src/features/relationships/`: canonical board/detail/history/next actions.
- `apps/web/src/features/gateq/`: GateQ inbox, dossier and review.
- `apps/web/src/features/capital/`: founder raise/rounds and related tabs.
- `apps/web/src/features/schedule/`: meeting actions and Q meeting UI.
- `apps/web/src/features/work/`: real Q Work and workforce activities.
- `apps/web/src/features/q/`, control/ and manifest: existing Q control and navigation.
- Evidence, Q knowledge/RAG, permissions/RLS, tenant contexts, notifications, approvals, reports, message and relationship modules own canonical business state.

**Implementation architecture:** modular monorepo, TS strict, Node, Supabase PostgreSQL/RLS, typed/versioned contracts and Zod boundaries; module-owned reads/event projections, no cross-module table joins from the Hub. New Hub read aggregation belongs behind an explicit composition API, not an arbitrary React query or shadow source. Logs/audits for consequential operations. Protect list/export/search/Q reads equally.

## Delivery slices and acceptance

**H1 (built, not live at this checkpoint):** role-aware Hub at existing `/relationships` route; existing `/relationships` retains original board, `/relationships?view=overview` adds Investment/Fundraising overview from real Results data. Links to Discover, GateQ, Capital, Work and Reports. Q alias/semantic tab and section controls with route settlement, auth-scoped loaded references, actual current theme. Must pass protected CI AND signed-in investor/founder desktop/mobile browser; then merge and deploy. Don't state it is live merely because CI is green.

**H2:** server-side search/filter/sort/pagination, saved views, persistent column preferences, table/board, scoped export, record previews, bulk actions with approval, stable Q actions. Real e2e browser test.

**H3:** unified authorized event/meeting/transcript/Evidence/GateQ/Work view; exact document page and timestamp opening, source-linked Q cross-artifact comparisons, permissioned contextual briefing, reliable multi-action navigation and receipts.

**H4:** deeper collaboration, investor updates/portfolio where real data exists, reporting and export jobs, state completeness, responsive and accessibility polish, measured performance budgets. Do not make speculative paid integrations a prerequisite.

All slices: objective, file/module/contract/migration impacts, tenant/auth/privacy and concurrency risks, targeted/unit/pgTAP/browser/negative tests, diff review, formatting/type/lint/build/security, protected PR, reviewed migrations/RLS, deployed exact revision and realistic role-isolation acceptance. Small committed/pushed vertical slices; nonconflicting worktrees and one integration owner. Never claim 'done' for a frontend mock.

## Verified implementation snapshot (GitHub; refresh immediately)

- **Production Q release**: `recovery/2026-09-12` at `37b5414e0cf7cfe09b21ab91544c391605f193a7`, merge PR #82 (Q Discover follow-up attribution), CI `38535940958` SUCCESS. Previous GateQ cold-opening / fact correction release at `62bd144a` is included. Codex live investor rehearsal reports three company cards, selected-company risk attribution and two-company comparison passed; individual answer completions ~4, 14, 23, 26s, not p95.
- **Hub H1**: [PR #81](https://github.com/neo1415/q/pull/81), branch `codex/relationship-hub-h1`, SHA `7919c215d30df1be94110f0ec6e79e716e78307f`, protected CI `38536343143` SUCCESS. **Open/unmerged, NOT live.** Based on older integration; rebase/merge carefully against Q release. UI uses `HubNavigation`, `hub-view`, Results read. Missing H2-H4 and browser acceptance.
- **GateQ qualification safety**: [PR #83](https://github.com/neo1415/q/pull/83), branch `codex/gateq-typed-qualification-facts-oct14`, SHA `e222f552166f8767b6d2506c2e222255832eeb72`, open and CI in progress at last inspection. Prevents adaptive interview TEXT from overwriting canonical coded stage. Not live, submission path blocked in last acceptance.
- **Guest Evidence**: `codex/gateq-guest-evidence-recovery` at `b35813def71c4bf5293580e4243d64c989c11dca`; `claude/gateq-guest-evidence` at `5858eb1ddfac5c5d5675ce4d5cc775bd67ea15cd`. Unreleased, diverged; verify ownership, byte reservation accounting, expiry, extraction, disclosure/version and migration compatibility before merging.
- **Rejected visual prototype**: [PR #75](https://github.com/neo1415/q/pull/75) open design-only; 76 screenshots/four simulated MP4s. Owner rejected its aesthetics, verbose copy and theme mismatch. Functional implementation authorization supersedes the older design-review gate; do not merge the prototype CSS.

## Why Q's competitor/market-gap answer needs investigation

Q already defines a bounded research tool, `public_web.search` in `packages/q-tools/src/tools/research-public-web.ts`, plus `public_web.extract`. Their tool descriptions explicitly include _competitors_ and _markets_, and permit source-linked public search with authorized scopes. Each research turn supports up to four planned queries and at most six extracted pages with short excerpts. Web claims remain `UNKNOWN`/unverified; search/extract availability is a runtime prerequisite.

**The user asked:** search competitors online; compare what they offer to Capital Q; identify missing features and market gaps. The exact Q run trace has not yet been inspected, so the root cause of its 'I don't know the market gaps' answer is **unverified**. The likely product-level missing step is comparing evidence from public sources against a **trusted versioned Capital Q capability/status inventory**. Public competitor search alone does NOT establish what this revision of Capital Q actually implements. Product specs contain goals (not all shipped), and Q must not pretend all plans are live.

New agent must: locate the original Q run ID/trace/receipt and test with the same authorized account; check tool-selection, `PUBLIC_EXTERNAL_DATA` scope, search provider status, exact queries, source counts/excerpts, synthesis prompt/answer and failure classification; test general competition questions with and without a selected-company scope. Then create or reuse a permission-safe published product capability/readiness inventory grounded in the _actual implementation and release evidence_, not raw repo/credentials. Compare public competitor claims against LIVE/PARTIAL/PLANNED/UNVERIFIED Capital Q capabilities and date/scope. Return an honest matrix: competitor offering (link/date), verified Q state (source/revision), parity, demonstrated gap, differentiation opportunity, unknown/needs validation, and recommended next investigation. If Q cannot read enough evidence, say specifically what's missing and still provide supported comparison; avoid blanket 'don't know' where research produced usable facts. Cite sources and clearly distinguish research-based hypotheses from demonstrated customer/market demand.

**External research baseline, not assertions of Capital Q gaps:** Affinity advertises automated email/calendar capture, enrichment and relationship intelligence; Visible advertises portfolio monitoring, document metric extraction and request automation; OpenVC advertises investor outreach/deck tracking and fundraising pipeline; Attio advertises customizable objects/views. Verify each claim on dated live vendor pages; don't assume Capital Q lacks something merely because it is absent in H1. A market gap is not simply an unshipped feature: customer validation, segment, geography, willingness to pay and competitor substitute matter.

## Immediate next-account sequence

1. Inspect exact current branches/CI/deployment and preserve any uncommitted local session changes before rebasing; reconcile PR #83 and GateQ acceptance as its isolated release.
2. Complete H1 PR #81 with current integration, protected checks, investor/founder browser proof, Q navigation receipts and deployed verification. Do not mix GateQ fixes into the Hub PR.
3. Implement H2 functionality, keeping Q support from slice one. Start guest Evidence reconciliation in an independent, capacity-limited lane after confirming canonical migrations.
4. Reproduce Q competitor-gap response with trace, then repair researched comparison and product capability grounding in a bounded slice; do not rewrite the entire Q brain.
5. Preserve state in `docs/ai-handoff/` and this document under the repository's approved docs/specs or design location, updating evidence and approval status rather than creating conflicting sources of truth.

## Source references for the next agent

Owner's October 14 functional Hub directive and previous research discussion in the current conversation; locked PADL/Product Specification/Final System Review; docs 17/18/22/23 and code; PR #81 body and changed files; PR #83; `docs/ai-handoff/STATE.md`, `ACTIVE-TASKS.md`, `HANDOFF-LOG.md`; `docs/design/relationship-hub/research.md` (research patterns only); public competitor vendor pages. Do not let a handoff snapshot override newer verified implementation.
