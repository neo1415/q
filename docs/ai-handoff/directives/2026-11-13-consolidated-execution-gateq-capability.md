# CAPITAL Q: CONSOLIDATED CONTINUOUS EXECUTION, GATEQ, AND Q CAPABILITY INTELLIGENCE

**One authoritative instruction for the existing Claude Code integration-lead session.**

This file consolidates three owner requirements: (A) continuous execution and demo completion; (B) GateQ publishing, embedding and intelligent inbound workflows; and (C) Q-wide feature awareness, contextual recommendations, and actual action execution. All three are required. Do not implement Part C in isolation and assume that A or B is covered.

## Reading and governance

- Read this entire directive and the latest authoritative repository handoffs before implementation. Existing decisions and completed verified work remain in force; this instruction does not invalidate completed slices.
- Authority: locked PADL, then Real Capital Q Product Specification, then Final System Review, then MVP/V1 and technical specifications, ADRs, and current operational handoff. Flag any conflict, seek the appropriate decision/ADR process, and do not silently bypass locked architecture.
- The current programme is **demo-complete V1**, with the specifically requested GateQ external-publishing capabilities. Do not expand it into unrelated enterprise integrations or the entire long-term PADL. Distinguish already built, certified, incomplete, blocked and deferred functionality.
- Preserve the existing integration/release owner, bounded parallel work, stable typed contracts, canonical entities, context isolation, safe provenance and auditability. Do not clone Q or GateQ into parallel architectures.
- Never let a model's claimed knowledge confer a user's right to private data. Reading and drafting should be smooth; external sends, publishing, disclosure, meeting invitations and other consequential actions still require the established human approval unless explicit scoped delegation exists.
- Avoid idle status loops: after a bounded slice is verified, automatically choose the next unblocked acceptance item. Existing scheduling may serve as the continuation mechanism, but verify that it works and never claim continuity across unavailable provider sessions without evidence.
- When a requirement depends on an unavailable service, unapproved payment, external owner account, or human decision, record precisely what is blocked; finish the independent work. Never mock an external integration and call it production-ready.

---

# PART A AND PART B: OWNER'S EXISTING EXECUTION AND GATEQ DIRECTIVES

The following text is preserved from the owner's assembled directives as supplied in this conversation.

CAPITAL Q: CONTINUOUS EXECUTION AND DEMO COMPLETION DIRECTIVE

Continue Capital Q from its latest repository state, deployment receipts, decisions, handoff, source specifications and task backlog.

I am delegating routine engineering and product execution decisions to you for this work. I want sustained progress throughout the night and subsequent execution cycles, not a session that stops after completing one small task.

The objective is to bring Capital Q to a fully demonstrable MVP/V1 state across its defined founder, investor, Q intelligence, discovery, verification, planning, execution and relationship journeys.

This is an execution directive, not a request to produce another high-level research plan.

1\. Continuous execution

Do not treat completion of one task, fix, test, deployment, audit or release batch as completion of the overall assignment.

Operate a continuous loop:

1. Read the current state and unfinished acceptance criteria.
2. Identify the highest-priority unblocked work.
3. Execute a bounded implementation or validation slice.
4. Run appropriate tests.
5. Integrate and release safely.
6. Verify actual user-facing behavior.
7. Update the ledger, decisions, handoff and next-task queue.
8. Immediately continue to the next unblocked task.

If one task is waiting on CI, deployment, a provider, a review, or another dependency, continue separate independent work where safe.

Do not repeatedly ask me for routine approvals, report that one task is complete and then stop, or spend entire sessions on status messages.

Preserve the existing adaptive concurrency and single integration authority. Parallelize independent work where it demonstrably saves time; do not create competing implementations.

Session continuity

Use the scheduler or continuation mechanisms available in your actual execution environment.

Configure a recurring continuation check approximately every 30 minutes as a backstop, with immediate continuation on completed task events where supported.

Every check must:

- Inspect existing running sessions, jobs, gates and deployments before starting anything.
- Resume unfinished work from the latest durable handoff.
- Avoid duplicate jobs and duplicate deployment attempts.
- Continue the next ready task without requiring a new user prompt.
- Respect provider usage limits and resource availability.

Verify that the scheduled mechanism actually exists, is enabled and can resume execution. Record the task identifier, schedule and execution target.

When a model session or usage allowance is exhausted, preserve the complete handoff and use supported resumption mechanisms after availability returns. Do not invent a workaround for service limits or claim continuity that cannot be guaranteed.

Do not schedule unnecessary notifications to me. Keep progress in the repository and provide a concise consolidated report when I return.

2\. Establish the real current state

The most recent production baseline reported was 3743dc48b, with certification documentation subsequently pushed.

Verify current revisions, pending work, runtime jobs, branch states, scheduled tasks and release receipts. Do not assume those revisions are still current.

Read the locked PADL, Real Capital Q Product Specification, Final System Review, MVP/V1 definition, technical architecture, AGENTS.md or CLAUDE.md, current ADRs and the latest handoff.

Build a live acceptance matrix covering what is completed, deployed, live-verified, incomplete or blocked.

Do not repeat certified work unless regression evidence requires it.

3\. Make the fictional demo marketplace complete

This is a primary delivery objective.

Capital Q is being prepared for demonstration using seeded, fictional companies, investors, mandates, profiles, pitch materials, documents and relationships.

I need every curated demo company intended for marketplace participation to be usable in investor discovery, recommendations, company search, comparison and Q investigation.

Do not let the demo become empty simply because its intended fictional fixtures were never activated.

However, preserve PADL #57/#58. Do not globally bypass marketplace eligibility, declare unreviewed real companies verified, fabricate verification evidence or relax security controls.

Implement the appropriate controlled synthetic-fixture activation approach using the existing verification/readiness architecture and an isolated demo context where necessary. Record the synthetic basis and preserve auditability.

Review the existing test-signup companies. The 49 incidental fictional signup records previously found in investor name search should not pollute ordinary marketplace discovery or company resolution.

For investor-facing search, name matching, Discover, Save, Compare, recommendation slates and Express Interest, enforce a consistent marketplace-eligible universe where required by the locked rules.

Ensure curated demo investors have coherent mandates, cheque ranges, sectors, geography, thesis and organizational profiles. Investor qualification must not be conflated with company marketplace readiness.

Build or repair an idempotent, reproducible seed/activation procedure with verification checks, cleanup and rollback.

Do not mark all production companies marketplace-ready indiscriminately.

4\. Certify the real verification workflow

Exercise the complete founder verification journey:

- Submission and founder-visible status.
- Authorized administration and review.
- Four-eyes enforcement.
- Supporting documents through their proper private access controls.
- Approval, rejection and outstanding-information handling as supported by V1.
- Append-only decision and audit records.
- Readiness recalculation and marketplace activation.
- Investor visibility and eligibility after the change.

Identify any missing implementation and complete V1 requirements without weakening the Context Firewall.

A curated synthetic fixture must never be presented internally as a real identity independently verified outside the demo.

Where a genuine human authorization is legally or architecturally required, prepare the action and continue other independent work. Do not forge a signoff.

5\. Fix the canonical-data inconsistency

Investigate why Q or company comparison sometimes says facts are unknown even when the same company profile visibly contains them.

Investigate examples including:

- Headquarters country, geography and location.
- Company stage, sector and business model.
- Traction, funding and available financial figures.
- Fundraising target and amount sought.
- Investor mandate cheque size, minimum and maximum ticket.
- Company-investor fit.
- Readiness and marketplace status.

Reproduce using the same fictional investor identity and permitted viewing context on the company page, Q conversation, comparison surface and relevant artifact outputs.

Trace the canonical record, typed service contract, authorization, projection, retrieval and result presentation.

Fix the source of inconsistency rather than adding text replacements or hardcoded demo answers.

Distinguish investor cheque size from company fundraising amount. Preserve currency, range, date and provenance.

The output must not use UNKNOWN when the information is present and accessible to that viewer. Equally, it must not disclose founder-private information simply because the founder's own page can display it.

Use comparison and Q response tests that verify field-by-field parity with the authorized company-page projection.

6\. Make the release gate substantially faster

The approximately 46-minute full local gate is too costly in elapsed time for every small release.

Investigate actual timings, memory, CPU, I/O, Turbo caching, repeated builds, Vitest test distribution, lint/typecheck overhead, Supabase startup and integration tests.

Design and implement a safe faster release pipeline.

Priorities:

- Fast targeted checks while implementing.
- Build caching and reuse of outputs tied to the exact revision.
- Test sharding and bounded parallel execution where resource measurements justify it.
- Independent checkouts or isolated resources for concurrent test jobs.
- A single aggregate PASS receipt covering the exact full SHA and every mandatory gate.
- Related fixes grouped into coherent release batches.
- No redundant full test runs for superseded commits.

The existing approximately 11-minute historical execution is worth investigating as a benchmark, but do not assume it can be reproduced on the current machine.

Do not simply disable tests, remove database security checks, suppress failures or deploy with incomplete receipts.

Preserve formatting, lint, root typecheck, builds, unit tests, integration tests, pgTAP, tenant-isolation checks and relevant security regression tests.

Measure actual before-and-after elapsed time, resource consumption and test coverage.

Do not spend additional GitHub Actions minutes or provision paid runners without the required authorization.

7\. Complete the end-to-end founder and investor stories

Use actual Capital Q workflows and seeded fictional accounts, not Paystack or other unrelated public companies as substitutes for the platform's internal journey.

Founder journey

Sign up, conversational onboarding, complete company profile, provide supporting materials, view readiness and assessment, complete verification, activate the company, receive relevant investor recommendations, use Q for research and planning, create useful artifacts, receive investor interest and proceed through the appropriate relationship actions.

Investor journey

Sign up, define mandate and cheque range, discover marketplace-ready companies, inspect a company and its materials, ask Q questions, compare opportunities, save or shortlist, express interest, receive the appropriate response, progress toward a meeting, and use Q for analysis, planning, diligence and investment work products.

Cross-journey consistency

The investor's Q findings must agree with the authorized company profile, company-investor fit calculation and comparison data.

Relationship history must remain consistent across both sides and derive from canonical relationship events.

Preserve Readiness, Quality, Fit, Interest, Relationship State and Outcome as separate concepts.

Use screenshots, API traces, stored rows, tests and real browser execution to certify the journeys.

Respect approvals for outreach, meeting invitations, document sharing and other consequential actions. Use fictional accounts and do not contact real people.

8\. Finish Q intelligence and rich interaction

Continue the earlier intelligence programme after addressing the most important demonstrated defects.

This includes:

- Planning that researches externally when appropriate, without searching unnecessarily.
- Reliable memory and natural follow-up conversations.
- Public and private evidence used only within their permitted contexts.
- Better investment synthesis, contradiction handling and source traceability.
- Source-backed financial charts and comparison tables.
- Relevant pictures, media and document previews through the existing result-block architecture.
- Reliable investment memos, diligence briefs, analysis and exportable artifacts.
- Natural typed-chat document delivery without unexpected modals.
- Existing voice-stage document presentation preserved.
- Text-to-text, voice-to-text, text-to-voice and realtime voice-to-voice interaction paths, within the defined V1 scope.

Do not rebuild already working components or create a competing agent platform.

Optimize Q for reliable institutional analysis and natural, consumer-grade interaction.

9\. Measure planning and execution performance

The latest certified investor analysis took several minutes, and the Clinicrest plan drafting took 161 seconds.

Investigate actual time distribution rather than blindly reducing model budgets or quality checks.

Measure planning, research, writing, critique, revision, waiting, job scheduling, artifact creation, delivery and frontend behavior.

Avoid unnecessary repeated model calls, serial steps, redundant searches and long periods without meaningful progress.

Preserve durable execution, review integrity and approvals.

Also investigate the costly question-reading fallback previously observed, while preserving existing spend limits.

Search-provider status: Brave was functioning; Tavily and Serper lacked available credit. Continue using functioning providers with clear degradation behavior. Do not buy credits or add paid providers without authorization.

10\. Quality, safety and acceptance

Before modifying a module, inspect its current implementation and relevant source decisions. State the change's objective, expected contracts, threat implications, tests and rollback.

After implementation, verify tests, typecheck, build, applicable RLS/tenant isolation, failure paths, performance and integration boundaries.

Check public-research queries for unnecessary private-data egress. The prior Clinicrest test reported 12 of 13 minimized queries; investigate the remaining query rather than assuming the audit is complete.

Do not disguise unsupported facts as verified. Do not become so restrictive that Q refuses to reason with incomplete information.

Do not fabricate data, verification, citations, test outcomes or production status.

A high reviewer score alone is not evidence that a plan is good. Test usefulness, consistency and real task completion.

Record every important result with exact SHAs and evidence.

11\. What completion means

Do not declare Capital Q demo-ready merely because the code builds or several unit tests pass.

Completion requires:

- A coherent, fully usable curated fictional demo universe.
- Properly working eligibility and verification workflows.
- Correct authorized company and investor data across Q, profiles, matching and comparisons.
- A complete founder-to-investor demonstration without unexplained blockers.
- Working Q research, planning, execution, artifacts and follow-up conversations.
- Appropriate media and presentation behavior across chat and voice.
- No known critical tenant-isolation, authorization or data-integrity defect.
- Reproducible tests and verified deployment evidence.
- Recorded limitations and explicit distinction between completed V1 requirements and deferred enterprise features.

Use the current MVP/V1 definition and locked sources to determine the actual scope. Do not interpret this directive as authorization to implement every speculative long-term feature in the PADL.

Continuous delivery instruction

After finishing any item, immediately choose the next highest-priority unblocked item and continue.

Do not stop at a status report.

Do not wait for me to ask you to continue.

Do not repeat already completed work.

Do not spawn unnecessary agents.

Do not weaken the architecture for demo convenience.

Do not burn credits merely to maintain activity.

When something is genuinely blocked, record the blocker and advance another independent task. Keep the overall programme moving.

I will review the accumulated results when I return.

CAPITAL Q ADDENDUM: COMPLETE GATEQ PUBLISHING, EMBEDDING AND INTELLIGENT INBOUND EXPERIENCE

Continue the current Capital Q master execution directive and scheduled continuation checks. Do not stop the existing programme or restart the architecture.

Add GateQ as a coordinated, independently owned workstream. Maintain one integration/release authority and prevent overlap with existing Q intelligence, security, rich-media and database work.

The objective is a complete, investor-branded, plug-and-play inbound application gateway powered by Q.

1\. Begin with a real GateQ audit

Review the locked PADL, GateQ Feature Specification, Real Capital Q Product Specification, current contracts, GateQ implementation and existing UI.

Trace and reproduce the investor publisher, public application form, contact verification, interview, video bridge, review, submission and inbox.

Identify what already works before implementing anything. Preserve the existing GateQ intake engine, qualification rules, canonical transcript, frozen published policy and versioned contracts.

Use current behavior, not assumptions, to choose fixes.

2\. Make “Draft my GateQ rules with Q” fully functional

The existing policy editor requires pasted or uploaded mandate text. Add a Q-powered path that can construct a proposed GateQ policy from the investor's authorized organizational information.

Q should examine the active mandate, investment preferences, organization profile, previously approved criteria and other relevant permitted information.

Generate an editable proposal containing:

- Required qualification criteria.
- Preferred criteria.
- Geographic, sector, stage, cheque-size and investment-instrument considerations.
- Clear public descriptions of what the investor looks for.
- Proposed interview priorities.
- Information gaps or ambiguous preferences that the investor may want to clarify.

Include supporting source references in the publisher's private review.

Distinguish the investor's private mandate from the rules the investor explicitly chooses to publish. Do not automatically expose confidential thresholds, documents, relationship history or private notes.

Support both the button and normal Q conversation commands such as “Q, draft my GateQ rules” and “Q, update my criteria.”

Q does the preparation. An authorized investor approves the exact version that becomes public.

Test the actual button in a browser, including loading, success, errors, editing, cancellation and publishing.

3\. Repair the application form and navigation

Reproduce the reported back-then-forward bug, empty step and inconsistent form controls.

Complete an authenticated and guest application in a real browser at desktop and mobile widths.

Ensure:

- Back and Continue navigate reliably.
- No empty or duplicated steps.
- Answers survive back/forward navigation, reloads and session recovery.
- Existing answers are not silently overwritten.
- Dropdowns and selection controls follow Capital Q's design system.
- Options are relevant, clear, keyboard accessible and comfortable on mobile.
- Form questions cover the published criteria that can reasonably be collected as structured answers.
- Missing or declined information is represented correctly without unnecessary rejection.

Preserve the existing core questions where they are useful. Do not make the whole form unpredictable by generating arbitrary questions with a model.

After the form, show a clear explanation that Q will conduct a brief interview to better understand the application before submission.

Maintain one canonical record of form answers, contact details and interview responses.

4\. Make the interview investor-aware and conversational

Keep the existing question-needs engine as the foundation.

Q should understand the published GateQ criteria, authorized mandate emphasis, submitted answers, relevant documents and unanswered investment questions.

Permit investors to add optional, versioned interview focus notes and questions during GateQ setup.

Use these to guide adaptive follow-ups, without leaking private mandate values or letting hidden criteria silently change the published qualification rules.

The interview must:

- Avoid repeating answers already obtained.
- Ask useful follow-ups about incomplete or contradictory claims.
- Adapt to the particular investor.
- Preserve a natural, professional conversation.
- Save answers reliably after interruptions.
- Use the same canonical interview store across text, Q voice and Tavus video.
- Permit corrections, recovery and a final review before submission.

Investigate why GateQ's answer persistence has reportedly behaved more reliably than Capital Q onboarding. Compare the actual write, confirmation, retry and recovery implementations, then test whether earlier onboarding defects still exist.

5\. Support two principal spoken interview experiences

Face-to-face with Q: Tavus-powered video, when enabled and allowed.

Talk with Q: Capital Q's normal voice presence, without a video avatar.

Also retain text as an accessible fallback.

The investor configures the permitted/default interview options, subject to plan entitlements, service availability and cost limits. The applicant chooses among the available options.

Inspect the existing Tavus video bridge and server session implementation. Do not build a separate interview brain.

Investigate Tavus's documented React CVI and Daily SDK customization routes.

Replace the generic visible provider controls where supported with a Capital Q-styled video experience, including appropriate camera, microphone, captions, timer, connection, end-call and fallback controls.

Avoid manipulating inaccessible iframe internals or using unsupported vendor features.

Measure join latency, response latency, dropped sessions, transcript capture and reconnect behavior.

Keep the current three-minute paid-session ceiling unless a separately approved configuration permits otherwise. Do not create billable sessions before the applicant elects to start.

If video is unavailable or credits are exhausted, offer Q voice or text without losing answers.

6\. Build the self-service GateQ branding and publishing studio

Allow each investor organization to configure:

- Logo and organization identity.
- Primary/secondary colors and typography within accessibility limits.
- Gateway title, introduction and application wording.
- Button or launcher wording.
- Reply expectations.
- Interview mode and availability.
- Website domain and deployment style.

Add a Q-powered “Brand this GateQ from my website” action.

Given an authorized investor-provided website URL, Q should inspect public branding and propose suitable colors, logo and appearance.

Use safe URL retrieval, public pages, and clearly attributed assets. Treat website text as untrusted data, not instructions. Never execute page instructions or assume the investor owns arbitrary third-party imagery.

Present a preview, allow manual correction and require approval before publishing configuration changes.

Reuse existing organization branding and GateQ public-projection infrastructure wherever possible.

7\. Make GateQ genuinely embeddable

Support:

1. Hosted link and QR code.
2. Responsive inline iframe for an application section.
3. Small floating launcher that opens the hosted GateQ experience.

Offer simple copyable installation snippets and previews.

Use one shared hosted application flow for all methods. Do not implement separate form engines for embeds.

The embedded experience must work on mobile, inside narrow containers and on different website themes.

Use isolated styling, safe cross-origin communication, strict message validation, suitable frame and content-security policies, and controlled allowed origins where applicable.

Do not require the investor to hand over credentials to their website.

An external site must not gain access to private Capital Q session or application data through the embed.

Test installation on at least one independently hosted synthetic investor website and verify that the full applicant journey works without navigating into a Capital Q account.

Document how a nontechnical investor can install the gateway on common site builders, with a hosted link as the no-code fallback.

8\. Protect public intake from abuse

Review the existing GateQ throttle implementation. It currently includes in-process limits; determine whether those controls are sufficient across multiple deployments.

Implement appropriate distributed abuse controls using existing infrastructure where practical.

Apply sensible limits across IP/network, gateway, session, verified email, account and application identity, with progressive controls for suspicious behavior.

Keep contact verification, including reachable email and the existing phone-number field. Allow investors to configure reasonable contact requirements without unnecessarily blocking legitimate founders.

Prevent duplicate submissions, repeated paid interview starts, contact-code abuse, provider-cost exhaustion and file-upload abuse.

Do not rely solely on IP addresses or client-side controls.

Preserve consent, data minimization and record-level access controls.

9\. Complete the GateQ inbox as an intelligent investor workspace

GateQ applicants may be external founders who have not joined Capital Q.

Keep external applications distinct from canonical marketplace company records until a properly authorized identity/claim/linking process occurs. Do not silently create duplicate canonical companies or treat external applicants as marketplace-verified.

Ensure every valid submitted application reaches the correct investor organization's inbox with:

- Structured company facts.
- Form responses.
- Interview answers and transcript.
- Relevant permitted documents.
- Published-rule qualification outcome.
- Evidence standing and information gaps.
- Clear applicant contact details and reply status.

Build explainable prioritization over the existing inbox, distinguishing rule qualification, thesis fit, evidence completeness and Q's analytical assessment. Do not turn any one of these into a misleading universal quality score.

Support questions to Q such as:

“Show the three strongest GateQ applications against my mandate.”

“Which applicants need further clarification?”

“Compare these two GateQ companies.”

“Draft a reply to the most promising applicants.”

Q must understand the difference between GateQ inbound applicants and Capital Q marketplace companies, and must only access the investor's own applications.

10\. Reuse connected email and meeting capabilities

Inspect the existing connected Gmail, email approval and Google Calendar meeting-action infrastructure.

Determine what can safely be reused for external GateQ applicants.

Support Q preparing tailored replies, requests for more information, invitations and follow-ups, using the investor's approved and connected channels.

For external applicants, add proper GateQ-specific recipient authorization and consent handling rather than fabricating company-investor relationships.

Preserve Prepare/Recommend → approval → Execute for outbound emails, invites, document sharing and other consequential actions, except where the owner has explicitly granted scoped delegation.

Do not silently send messages or book meetings with real people during testing.

Support external meetings where the calendar integration permits it, and preserve subsequent optional onboarding into Capital Q.

11\. Complete GateQ's publication and applicant acceptance journeys

Certify with real browser testing:

Investor: Q drafts rules → investor reviews → Q proposes branding → investor approves → publishes GateQ → receives link, QR and embed snippet → embeds on a test website.

External applicant: opens embedded GateQ → completes responsive form → navigates back/forward → confirms contact → chooses permitted Q interview mode → completes interview → reviews answers → submits → receives confirmation.

Investor inbox: submission appears once → Q explains qualification and fit → investor compares applicants → prepares outreach → requires appropriate approval → performs the approved action or reports a specific integration blocker.

Existing Capital Q founder: enters the investor's GateQ, receives appropriate prefill under authorization, chooses what to submit, answers investor-specific questions and completes the same application without duplicating their company record.

Failures: expired session, duplicate submission, invalid contact code, unavailable Tavus, no video allowance, network interruption, wrong tenant, malicious embed origin, private-context leak and revoked access.

Record screen captures, timings, exact revision, durable state, tests, release receipts, rollback and unresolved limitations.

12\. Continue the broader Capital Q work in parallel

Do not let this GateQ stream displace the existing demo-seeding, verification, canonical-data consistency, release-speed, Q intelligence, voice and rich-media work.

In particular, maintain the high-priority rich-media milestone: Q should naturally deliver relevant pictures, comparison charts, sourced documents and interactive results inside chat, while preserving the immersive voice experience.

Continue through bounded slices and reuse approved versioned contracts. Coordinate any cross-module changes with the existing integration owner.

13\. Continuous execution

Keep the existing recurring continuation checks and handoff discipline.

After completing a GateQ slice, immediately advance the next unblocked GateQ deliverable.

Do not wait for routine engineering decisions. Do not stop the broader programme just because Tavus credits, external email configuration or a human approval is unavailable.

Escalate only decisions that genuinely require owner authorization, paid-service approval, access to external accounts, a PADL amendment, or a consequential action that cannot legally or architecturally be delegated.

Treat this as an ongoing product-completion assignment, not as a request to write another specification.

Proceed with implementation, tests, integration and live certification.

---

# PART C: Q-WIDE PRODUCT CAPABILITY INTELLIGENCE, SMART ASSISTANCE, AND WORKING ACTIONS

## C1. Objective: Q is the intelligent operating interface, not a product salesperson

Q should understand Capital Q, GateQ and the actual capabilities available to the current user. When the user describes an outcome, Q should know what tools, workspaces, actions or features can meaningfully help and be able to operate the relevant ones. A user should not need to memorize feature names or page locations.

**Do not reframe every question around Capital Q features.** This is a hard acceptance criterion. The default is to serve the user's immediate intent with the shortest effective path:

- Ordinary questions and conversation: respond normally, naturally and directly. No unsolicited tour, feature list or promotional sidebar.
- Search existing records or documents: retrieve the appropriate authorized records and answer. Do not propose unrelated features or external web research just to appear helpful.
- Planning and research: plan and research as the task requires, including public internet research when material, without forcing feature suggestions or skipping research when it matters.
- Complex user objectives: combine relevant Capital Q capabilities _inside_ the work when they improve the result, such as market research, company comparison, matching, documents, pipeline tasks, scheduling or meeting preparation.
- Genuine unmet need: recommend at most the most useful one or two product capabilities at a natural moment, explain why and offer a concrete next action. Do not interrupt a direct task, repeat recommendations, optimize for clicks or turn an ordinary answer into an advertisement.
- Once accepted: carry forward the user's goal and the specific offer, and prepare/execute the actual operation. Do not merely navigate to an empty page or ask the user to repeat everything.

Example: If an investor says they need more quality applications, Q can distinguish Discover (companies already on Capital Q) from GateQ (inbound applications from outside). It might offer to prepare GateQ rules from the investor's authorized active mandate. When the investor says "yes," Q must start that _real_ governed preparation and deliver an editable draft. This is one example, not a mandatory prompt rule for all investors.

## C2. A grounded capability catalogue, not another source of truth

Audit and reuse the existing `packages/app-actions` registry, Q typed-tool catalogue, page/navigation action contracts, feature flags, subscription entitlements, Q orchestration, work execution and action approval machinery.

Implement a coherent, versioned **capability-awareness projection** over these existing contracts and deployed capabilities, not a separate ungoverned registry or monolithic prompt containing every screen and API.

For every relevant V1 capability record:

1. The user goal it solves, with examples of when it is useful and when it is **not** useful.
2. Founder/investor/organization context, feature flags, account entitlement, prerequisites and server-side authorization.
3. Real operational status: can explain, can navigate, can prepare, can execute, temporarily unavailable, or not implemented.
4. The existing typed tool/action/workflow identifier, owner module, destination UI and result contract.
5. The actual confirmation, approval, delegated scope, durable job or external-service requirements, where applicable.
6. The correct output mode for text chat versus voice/immersive stage.
7. Tracing and failure behavior, including a truthful fallback when the capability is incomplete or an integration is disconnected.

Coverage includes, where actually implemented: GateQ setup and inbound applications; Discover/Explore/search; mandate and Thesis Match; readiness and investability intelligence; company comparisons; profiles; analytics; pipeline and relationship history; Q Daily; Q Work; plans and durable execution; artifacts, decks and data rooms; meetings and reminders; connected email; verification and onboarding; organization/team; settings and more. Discover the real inventory instead of assuming this list covers all features.

Keep capability descriptions compact and select relevant detail at run time. Do not add a giant universal prompt or unconditional LLM call to every Q turn. Keep fast paths fast.

## C3. Conversational intent and continuity

An offer is an executable proposition, not generic marketing copy. Carry its durable intent, target, actor, organization, required prerequisites, expected outcome, expiry and whether it needs confirmation. Resolve "yes, do it," "change the stage," "use the second one," "publish it," and "show me the applications" to the correct _current_ offer/workflow, even after normal follow-up discussion or page navigation.

Disambiguate real competing offers when necessary, but never invent an acceptance or silently switch targets. Preserve per-user scope and authorized context; an offer made to an investor cannot leak another investor's mandate or be executed as a founder. Retain versioned work state as appropriate, not only fragile conversational prose.

Q may use several capabilities within a normal planning or execution task without separately pitching each one. Example: investigate candidates → compare thesis fit → prepare an investment brief → suggest a follow-up meeting where relevant. Do not automatically send, publish, book or share without the existing approval path.

The same semantics should work for typed chat, text-to-voice, voice-to-text and realtime spoken interaction within the available V1 pathways.

## C4. Every Q-offered button or action must work, end to end

**No inert suggestion buttons, decorative CTAs, misleading "go ahead" actions, dead-end navigation, or approval cards that fail silently.** This explicitly covers Q-generated feature suggestions, follow-up chips, proposal cards, plans, artifact controls, GateQ publisher buttons, meeting offers and similar prompt-time controls.

Do a focused real-browser and contract audit of the action surfaces Q actually emits, plus the primary controls along the certified founder, investor and GateQ user journeys. For each:

- Verify the control is only shown/enabled when the action is real and the actor can use it; distinguish unavailable, loading, pending approval and completed states.
- Verify click/tap/keyboard interaction invokes the correct typed action or correct, pre-populated destination with the original intent and user context preserved.
- Confirm server authorization is rechecked and each consequential action uses the established approval path. Never treat frontend hiding as authorization.
- Verify success changes canonical persisted state where required; revisit/reload and confirm the outcome. Verify idempotency for repeated clicks, retries and network interruption.
- Verify error and partial completion states explain what happened and let users retry without losing work or creating duplicates.
- Test text-chat inline rendering, mobile 390px, desktop 1440px and the equivalent voice-stage behavior for features which support voice.
- If a feature is not implemented or unavailable, Q must not offer it as working. Provide a clear fallback, with no fake completion language.

For a suggested operation, acceptance requires a full **intent → suggestion → user acceptance/click → authorized action → durable result → conversational follow-up** trace. A passing component unit test alone is insufficient.

## C5. Demonstrable cross-feature interactions

Test these scenarios under appropriately authorized fictional users; verify actual capabilities and record failures rather than rewriting the question to match implementation:

1. Investor asks how to find new founders: Q may distinguish Discover from GateQ, then prepares a GateQ draft if the investor accepts.
2. Investor asks for a company record: Q retrieves permitted facts directly, with **no** obligatory GateQ pitch or unnecessary public search.
3. Founder asks for a 90-day fundraising plan: Q delivers ordinary planning, optionally incorporating readiness, permitted public research, documents or scheduling when relevant.
4. Investor asks about three marketplace companies: Q uses the authorized canonical company projection and mandate/fit where relevant; no phantom unknowns where the viewer's own company-page data answers the question.
5. Investor asks for top three _GateQ applicants_: Q queries that investor's inbound applicants, not the Capital Q Discover feed, and does not silently turn external applicants into marketplace entities.
6. User accepts a Q-generated CTA, revises the prepared output, and then asks Q to continue from it in chat or voice.
7. Q proposes an email or a meeting as a natural part of a plan and correctly prepares it, applies approval and reflects actual connection status; no unauthorized send.
8. Disconnected provider, expired permissions, plan restriction, duplicate click, retry, stale offer, unavailable feature and wrong-tenant access produce explicit, correct outcomes.
9. Chat document cards work inline; deliberate open expands the artifact; immersive voice behavior stays appropriate.
10. Typical casual questions, record lookup, ordinary summaries and simple navigation remain fast and free of irrelevant capability suggestions.

## C6. Continuous execution, evidence and scope

Integrate this Part C with Parts A/B as a **third coordinated scope**, not a third massive independent team or a system rewrite. Q capability awareness crosses modules, so the integration owner must enforce typed contract ownership and prevent two agents from editing shared orchestration files concurrently.

Use bounded vertical slices, measured costs and working end-to-end acceptance. Prioritize: (a) correct product/feature intent routing without spam; (b) the GateQ rules preparation offer and functional CTA; (c) real data and comparison consistency; (d) Q actions working across independent features; (e) broad regression coverage and rich-media delivery. Other independent A/B tasks may run in parallel as dependencies allow.

Do not allow new Q suggestions to degrade direct-answer latency or add unnecessary model calls. Test false-positive feature recommendations as seriously as missed useful recommendations. Record measured task completion, time-to-first-useful-response, action success and failure causes, rather than measuring click-through or engagement.

Maintain a cross-program acceptance matrix. For every claimed completed capability, record exact SHA, release receipt, live test identity, canonical-state evidence, any screenshots, and remaining limitations. Never call a workflow complete solely because a button rendered, a feature appeared in the spec, or an agent reported success.

The overall handoff is complete only when the in-scope acceptance journeys for Parts A, B and C are verified or explicitly identified as blocked/deferred under the authoritative MVP/V1 requirements. After each delivered slice, proceed to the next unblocked one through the existing scheduled-continuation mechanism. Do not stop merely to provide a status update; do not burn credits on idle activity.
