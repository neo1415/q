---
title: Capital Q business-side research and packet plan
project: capital-q
date: 2026-09-25
tags: [research, journeys, integrations, meetings, identity, admin, artifacts, parity]
---

# Capital Q: the business side, end to end

Research date 2026-09-25. The repo was read only. Sources are the locked PADL, the Product Specification, the Final System Review, the GateQ specification, the MVP/V1 Release Definition (doc 10), architecture docs 11–26, ADR-001 and ADRs 0001–0017, `docs/design/ux-direction-2026-09.md`, a code survey of the repo, and two web-research passes. Web claims carry their URL in section 15. Prices marked (secondary) come from aggregators, so re-check them before budgeting.

The founder's requirement list is R1–R17 (`founder-requirements-2026-09-25.md`). Its principle: "Q can do anything the app can do, by speaking to it; nothing in the niche's business processes should need leaving Q; full product feel; smoothest, proactive journeys." Nothing on that list is dropped here. Where an item conflicts with a locked source, section 12 says so and proposes the amendment.

## 0. What governs this plan

These locked rules shape every design below. Each is quoted or paraphrased from its source.

| Rule | Source | Consequence for the business side |
|---|---|---|
| Q has intelligence authority, humans commercial authority, Capital Q integrity authority | Final System Review §2; PADL #154 | Q drafts and recommends. People approve sends, shares and bookings. |
| Prepare → Recommend → Approve → Execute for consequential relationship actions; Q "may aggressively automate administrative work" | PADL #120, Spec 6.6.13, 8.7.5 | Email, calendar, share and meeting actions are Approval Engine actions bound to the exact payload. Internal admin (reminders, CRM logging) can be delegated. |
| Progressive autonomy, per capability, explicit and revocable | Spec 5.5 (Communications, Calendar, CRM, Data Room, Outreach); PADL #140 | A delegation settings page and `delegations` records. Nothing is automatic by default. |
| Q is the operating layer; every capability is reachable through navigation and conversation | PADL #39, #55 | Capability parity (R-principle, R14) is locked product law, not a wish. |
| Meeting-first, not chat-first; messaging belongs to the Match | PADL #118, Spec 6.6.6–6.6.8 | Schedule Meeting is the primary post-match action. Messaging is gated on the match. |
| Q attends meetings only with consent, **as a silent assistant** | PADL #64 (locked), #119, #133; Spec 6.9.4; doc 10 §14 | R11 "Q can speak in meetings" conflicts (section 12, C1). |
| V1 meetings use Zoom, Meet or Teams; Capital Q owns scheduling, attendance, intelligence and follow-up | PADL #133 | A meeting-bot vendor, not native video. |
| Shareable Q identity / Q Card; value before sign-in | PADL #121 (locked, name TBD); Spec 6.6.9; FSR §8, §19 | R5 and R6 are core product, not decoration. The card is a *presentation layer* over the canonical profile. |
| Eight visibility scopes; `network_visible` ≠ `public_external` | ADR-001 D1; PADL #149 | The card and profile carry field-level scope, and the public route shows `public_external` only. |
| Truth class, evidence status and lifecycle are three independent axes | ADR-001 D2; PADL #139 | The profile shows provenance on those three axes and never shows a single "verified" tick. |
| Verification is claim-specific and never endorsement; action-based | PADL #147, #57, #58; Spec 8.1, 8.9.3 | The operator queue decides claims (identity, organisation, affiliation, domain). Badges say exactly what was verified. |
| Institutional Operating System for FDN (verification workflows, appeals, platform health) | PADL #051, #050 | R12 (the admin dashboard) is locked scope. Doc 17 §150 says admin is separate from product navigation. |
| Evidence-acquisition connectors (Drive, OneDrive, Dropbox) | PADL Ch4 #66 | Document connectors are sanctioned. |
| Intelligent, batched, action-oriented notifications; the user controls channels | PADL #67; Spec 5.4 attention levels 0–4, Focus/Standard/Proactive modes | Reminders and alarms (R11) go through one notification service with attention levels. |
| Model calls through the Gateway; provider SDKs behind adapters; no raw MCP to the model | CLAUDE.md; doc 12 §34–35; doc 22 §140–150 | Connectors are typed Capital Q tools. MCP is an adapter, never the model's surface. |
| A private draft is Prepare; leaving the owner is Execute | ADR 0013 | Artifacts, drafts and images can be made freely; sharing or sending needs approval. |
| Meaning by model, authority by code | ADR 0011 | Q reads intent into closed schemas; code confirms and executes. |

Q may **know** more than the user, which does not let the user **see** it. Q may **recommend**, which does not give Q **authority** (FSR §29–30). Every design below keeps these apart.

## 1. Journey maps

The states come from the sources: verification levels 0–4 (Spec 8.1.2), marketplace readiness (PADL #58), visibility scopes (ADR-001), relationship progression (FSR §5: Discovered → Viewed → Interest → Match → Connected → Meeting → Diligence → Soft Commitment → Confirmed Commitment → Investment / Pass) and the Data Room layers (Spec 6.3.2, 6.7).

Column key: **Today** is what the code does now (from the code survey); **Gap** is what is missing; **Q proactive** is what Q should do before being asked, at the attention level shown (Spec 5.4: L0 silent, L1 passive, L2 contextual, L3 action recommendation, L4 immediate).

### 1.1 Founder: first touch to outcome

| # | Stage (source state) | Today | Gap | Q proactive (level) |
|---|---|---|---|---|
| F-a | First touch: a Q Card link, GateQ link or referral (PADL #121) | `/` redirects to Home; no public Q Card; GateQ has a public API (`/v1/gateq/public/:publicId`) but no web page | Public card route, public GateQ page, `/@handle` | — |
| F-b | Sign-up, Level 0 → 1 contact verified | Supabase auth, check-email | Handle claim at sign-up (optional) | — |
| F-c | Onboarding F0–F11, "upload what you already have" (PADL #56, doc 10 §5.4) | Q-led interview workspace (ADR 0016); founder presence research (`q-presence`) | F4 in the ledger: no uploader in the typed workspace; Drive import (PADL #66) missing | Research the company's public presence the moment a website is known (L2), and show "Here's what I found; confirm" |
| F-d | First value: intelligence snapshot (F8) | Snapshot and Board objects | — | — |
| F-e | Brand: logo, palette, fonts, tone (R7) | Three fixed deck themes only | Brand kit entity, extraction from website/deck | Offer "I pulled your colours and logo from your site; use them?" (L3) |
| F-f | Pitch video (F9) | `/pitch`, resumable upload, Cloudflare Stream | "See it as investors will" preview | — |
| F-g | Profile and visibility (F10): `organisation_private` → `network_visible` | `/company/visibility`; `company.visibility.set` action (two scopes only) | Field-level scopes, `public_external`, a control centre, an editable profile page (R4 is broken because the page has no inputs) | Explain what each audience sees; Q previews "as an investor sees it" (L2) |
| F-h | Verification gate (F11, Level 2–4, PADL #57) | `/verification` standings; synthetic attestation worker; `OPERATOR_DECISION` reserved but no operator UI | Operator queue (R12) | Tell the founder exactly what is blocking discoverability (L3) |
| F-i | Marketplace readiness → discoverable | Eligibility and slates exist | Readiness explanation surface | — |
| F-j | Share the Q Card externally (URL, QR, vCard, NFC, email signature) | Missing | R5, R6 | Suggest adding the card to an email signature once live (L3, once) |
| F-k | Founder Discover investors, GateQ qualification, Q-structured intro (PADL #101–102) | Founder investor list; `find_prospective_investors`; GateQ qualification | Founder-initiated connection request action | Rank investors whose GateQ gate the company passes; explain mismatches (L2) |
| F-l | Interest received → accept/decline → Match (PADL #117) | `/company/interest`, `relationship.interest.respond` | Notification when interest arrives | "Apex expressed interest; here's their public focus and fit" (L4) |
| F-m | Schedule meeting (PADL #118, Spec 6.6.8) | Next-step vocabulary has `SCHEDULE_MEETING`; no meeting entity | Meetings, calendar connector, scheduling link | Propose times from the connected calendar (L3) |
| F-n | Meeting prep (CQ-Q-041) | None | Brief artifact type | Brief lands 24 h before (L3) plus a reminder at T−15 min (L4) |
| F-o | Q attends: silent notetaker with consent (PADL #64) | None | Meeting bot | Ask before each meeting "Should I attend and take notes?" (L3) |
| F-p | Post-meeting summary, requests, commitments (Spec 6.6.12) | None | Meeting artifacts, follow-up drafts | Draft follow-up and list requested documents (L3) |
| F-q | Diligence: Data Room share (Spec 6.7, CQ-DR-001/002, Q-040) | None | Data Room, share action | "Apex asked for the model; share view-only for 30 days?" (L3) |
| F-r | Commitment tracking (Spec 6.6.14, PADL #130) | Capital objective exists | Soft/confirmed commitment events, human confirmation | Detect "we could do $500K" in a transcript and ask for confirmation, never auto-count (L3) |
| F-s | Round close → Raise Record (PADL #131) | None | P2 | — |
| F-t | Relationship preserved → Existing Investor (PADL #132) | Relationship rows persist | P2 | — |

### 1.2 Investor: first touch to outcome

| # | Stage | Today | Gap | Q proactive |
|---|---|---|---|---|
| I-a | First touch: a founder's Q Card, or an invitation | No public card | Q Card conversion loop (FSR §19): value first, then sign-in for Ask Q / Save / Interest / Data Room / Meeting | — |
| I-b | Sign-up; organisation join or create (I0) | Organisation, representative | Organisation claim and affiliation verification (Spec 8.1.7) | — |
| I-c | **Research-first onboarding (R13)**: Q researches the firm (website, portfolio page, SEC Form D/ADV, Companies House) before asking | `research_public_web` accepts INVESTOR_ORGANISATION; `q-presence` supports INVESTOR_ORGANISATION and PERSON subjects; Bright Data LinkedIn lookup exists (legal caveat in §9) | A "we found this, confirm" mandate pre-fill; provenance per field; Art. 14 notice | Start the research at I0, as soon as the firm name and domain are known (L2), then pre-fill I2–I8 as recommendations (ADR 0016 `recommend` tool) that the investor accepts |
| I-d | Mandate I1–I11, synthesis, confirm | Interview loop, `confirm_mandate` | Commit failures J3, J8–J14, J18 in the walkthrough ledger | — |
| I-e | Public investment focus (ADR 0015, proposed) | Proposed, not built | Opt-in `network_visible` projection | Suggest publishing once a mandate is ACTIVE (L3) |
| I-f | GateQ configure (I10, PADL #101) | GateQ core and public API | Web page for the public gateway | — |
| I-g | First feed (I12) | Slates, feed, Save/Pass | UX-05 immersive layout | — |
| I-h | Ask Q / compare / "why this" | Explanations, `search_companies` | Compare page and Saved | Morning digest "3 new fits since yesterday" (L1, batched) |
| I-i | Express interest (unilateral) | `relationship.interest.express` action | Notification to founder | — |
| I-j | **Outreach by email (R9)**: "Shall I email the founder?" → draft → approve → send → reply detected | None | Gmail/Outlook connector, `email.send` action, reply-detection webhook | After Match, if no meeting within N days: "Want me to email Ada to propose times?" (L3) |
| I-k | Meeting, prep, notetaker, debrief | None | Same as the founder side, with investor-private analysis (Spec 6.9.6) | Separate private debriefs per side |
| I-l | Diligence requests and Data Room access | None | Data Room request action | — |
| I-m | Decision: pass with structured reason (PADL #122) or commit | Pass exists in the feed | Post-engagement pass feedback | Sample for pass reasons after a meeting (L3), never after a feed pass |
| I-n | CRM sync (Affinity, Attio, HubSpot) | None | Export projection (P2) | "Log this meeting to Affinity?" once delegated |

### 1.3 Capital Q operator (FDN), per PADL #051 and doc 10 §4

| # | Stage | Today | Gap |
|---|---|---|---|
| O-a | Operator identity: a platform role separate from organisation roles | Only `organisation_admin` and `organisation_member` exist; the `verification.decide` capability is granted to no role | A `platform_operator` principal, step-up authentication, audited |
| O-b | Verification queue (claims: FOUNDER_IDENTITY, ORGANISATION, DOMAIN_CONTROL, and later AFFILIATION) | `evidence.verification_claims` with PENDING, VERIFIED, EXPIRED, REVOKED; `OPERATOR_DECISION` method reserved | Queue UI, reason codes, evidence view, decision API |
| O-c | Company acceptance / marketplace activation (PADL #58) | Eligibility rules | An operator override that records the decision and its reason, never a silent flag |
| O-d | Reports, blocks, moderation (Spec 8.6; doc 10 §9 "basic block/report") | None | Report and block entities, a moderation queue, an intervention ladder (guidance → friction → restriction → review → suspension → termination) |
| O-e | Appeals (PADL #050) | None | P1: an appeal record on any enforcement decision |
| O-f | Platform health: slates, queues, provider quotas, connector errors, webhook inbox | Observability skeleton, usage ledger | An `/ops` health tab reading existing metrics |
| O-g | Audit search ("who did what under whose authority") | `audit.material_actions` exists | A read UI with filters, and export (P2) |
| O-h | Handle disputes and impersonation (Spec 8.6.6) | No handles | Reserve, release and transfer handles with audit |

## 2. Gap analysis against the code and R1–R17

Paths are relative to `C:/Users/DELL/Desktop/q`.

| R | Requirement | What exists (files) | Gap / root cause |
|---|---|---|---|
| R1 | Viewable and downloadable PDF/PPTX; the hosted build refused | `packages/deck-render/src/{layout,svg,pptx,pdf,theme}.ts` (pptxgenjs 4.0.1, pdf-lib 1.17.1, no Chromium); `apps/q-api/src/http/q-artifacts.ts` (`/:id/export/:format`); web relay `apps/web/app/api/q-artifact/[artifactId]/[format]/route.ts`; `apps/web/src/features/q/artifact-viewer.tsx:312-320` | **Most likely cause: only `PITCH_DECK` exports. An `INVESTMENT_BRIEF` export returns 409 "That document has no slides", and the PDF link appears only on deck cards.** Other routes to failure: 503 when `CQ_Q_API_URL` is unset; any other upstream error becomes 502; `THIN_RECORD` means no artifact (`packages/q-specialists/src/answer.ts:884`); no `TAVILY_API_KEY` means no research; the hosted DB may lack `20261005090000_q_artifacts` (ledger debt item 4). pdf-lib standard fonts drop non-WinAnsi characters (₦, €, smart quotes lose fidelity). |
| R2 | Q creates and edits images; users upload media Q reuses | `media.media_assets` is video only (FOUNDER_PITCH, PRODUCT_DEMO, OTHER); Model Gateway output kinds are TEXT and STRUCTURED only (`packages/contracts/src/model/index.ts:36`) | No image task class or provider, no image asset type, no asset library, no logo/avatar storage |
| R3 | Reports downloadable; edit history viewable and downloadable | `artifacts.artifact_versions` holds versioned revisions | No version diff or history UI, no history export, briefs are not downloadable (R1) |
| R4 | Profile redesign plus enrichment; editing is broken; editable by UI and by Q | `apps/web/app/(app)/profile/page.tsx` is a **display-only server component with no inputs**, which is why clicks do nothing. Q edits via `company.profile.update` and `person.profile.update` (`apps/q-api/src/composition/*-profile-action.ts`, `apps/q-api/src/voice/profile-edit.ts`) | No edit form; no company profile page for the founder's own company (ux-direction §13 "Missing"); no provenance display |
| R5 | Handles | `identity.organisations.slug` and `core.companies.slug` are unique *per tenant*, and no route resolves them; GateQ uses opaque public ids | No global handle namespace, reserved list, redirect or hold policy, or person handles |
| R6 | Digital business card as a brand identifier | `core.shareable_identities` is designed (doc 13 §97) but not migrated | No card, QR, vCard, OG image, public route or wallet pass |
| R7 | Brand settings used by Q and artifacts | Three fixed themes in `packages/deck-render/src/theme.ts` | No brand kit entity, no Q persona settings beyond voice choice |
| R8 | Visibility controls fully fleshed out | `marketplace_visibility` (two values), `permissions.disclosure_policies`, `/company/visibility`, `company.visibility.set` | No field-level scope, no `public_external` path, no "who can see this" inspector (Spec 8.3.10), no "view as" |
| R9 | Email via connectors: proactive draft → approve → send → reply tracked | `packages/q-connectors/src/mcp/*` (client defined, unused; server mounted only with `Q_MCP_SERVER=enabled`); `langchain/tools.ts`; Approval Engine `packages/q-actions` (payload hash `domain/binding.ts`, idempotency `q_action:<runId>:<actionId>`); `apps/q-api/src/main.ts` notes **no email, calendar, messaging or connector executor** | No integrations table, OAuth flow, token vault, EmailProvider adapter, `email.send` action, webhook inbox, or reply matching |
| R10 | In-app messaging later (COMM-001) | Q chat only (`q_runtime.conversations`) | Plan only (§11) |
| R11 | Alarms and reminders; meeting links; Q joins, summarises, speaks | Voice stack (Deepgram default, ElevenLabs; `apps/q-api/src/voice/*`); relationship next-step `SCHEDULE_MEETING` | No meetings, notifications or reminder scheduler, calendar adapter or meeting bot; speaking conflicts with PADL #64 (§12 C1) |
| R12 | Admin dashboard: accept and verify companies | `packages/verification` (claims, `decide-synthetic.ts`); `audit.material_actions` | No operator principal, no `/ops`, and `verification.decide` is granted to nobody |
| R13 | Investor research-first onboarding | `q-presence` (INVESTOR_ORGANISATION subject); `apps/q-api/src/composition/research.ts:229`; ADR 0016 `recommend` / `accept_recommendation` tools | Not wired into investor onboarding; no registry sources (SEC, Companies House); no per-field provenance on the mandate review |
| R14 | Product feels disjointed; everything reachable via Q | Tools: 13 reads, 2 relationship proposals, onboarding writes; actions: 5 (`company.profile.update`, `company.visibility.set`, `relationship.interest.express`, `relationship.interest.respond`, `person.profile.update`) | No capability registry; many UI actions have no Q tool (upload, pitch, verification request, GateQ publish, save/pass, artifact export); no navigation parity test |
| R15 | Deep journeys from PADL/specs | This document | — |
| R16 | An agent continuously improving Q intelligence | `packages/q-evals`, `docs/modules/q-evals.md`, walkthrough ledger | Needs a standing eval-driven improvement loop (§13, packet BIZ-011) |
| R17 | Deploy now and keep deploying | Railway (ADR 0014) for api, q-api, workers and web; hosted Supabase | Hosted migrations must be current; every packet ends in a deployed proof |

The ledger is stale too. `docs/execution/implementation-ledger.md` stops on 2026-09-21, while git shows QX-003/004, NET-010/011/012, VERIFY-001, QACT-001/002, QX-005/007/008 and UX-02/07 committed. Every packet below records its ledger row.

## 3. Integrations: email, calendar, CRM and documents, under the authority model

### 3.1 Architecture decision: typed connectors, with MCP as an adapter only

Q never sees a raw MCP server or an OAuth token. Every external capability is a **typed Capital Q tool** (Zod in and out, `authorize`, consequence class, idempotency) and, when consequential, a **Q action** in the Approval Engine. Behind it sits a provider adapter port (`EmailProvider`, `CalendarProvider`, `CrmProvider`, `DocumentSourceProvider`, `MeetingBotProvider`; doc 22 §140). An adapter may be implemented with a vendor SDK, a direct REST client, or an MCP client (`packages/q-connectors/src/mcp/source.ts`). The model's surface stays identical either way.

Reasons:

- The MCP 2026-07-28 spec forbids token passthrough and requires per-client consent against the confused deputy.
- Tool descriptions and tool outputs are untrusted input: a real case hijacked Gemini for Workspace through a calendar-invite title.
- The official Google Workspace MCP Gmail server needs restricted scopes and can only create drafts, not send.

Doc 12 §34.1 already says "MCP authorization does not replace Capital Q authorization", and this decision operationalises that. LangChain stays where it already is (`langchain/tools.ts` as a view of the registry, LangGraph in the orchestrator). The LangChain Gmail toolkit is single-user and file-credentialed, so it is unusable for multi-tenant work. If LangChain's `HumanInTheLoopMiddleware` is ever used, its "edit" must re-enter approval, because approval binds to the exact payload.

### 3.2 Data model (new migration, one owner)

- `integrations.connections`: `id, tenant_id, organisation_id, connected_by_user_id, provider, connection_type (EMAIL|CALENDAR|CRM|DOCUMENTS|MEETING_BOT), status (ACTIVE|REAUTH_REQUIRED|REVOKED|ERROR), granted_scopes[], credential_ref, provider_account_ref (email address / OID), connected_at, last_sync_at, last_error_code`. This follows doc 22 §144.
- `integrations.credentials`: server-only, envelope-encrypted token blobs (AES-GCM, key from the platform secret store), RLS forced with no policy and no grant. It is never in a prompt, a log or analytics (doc 15 §67).
- `integrations.oauth_transactions`: state, PKCE verifier, nonce, user/session, tenant, provider, return path, expiry (doc 22 §145–147; doc 15 §66).
- `events.webhook_inbox` (doc 13 §95, doc 22 §133): raw provider notification, signature check result, dedupe key, processing status.
- `communication.outbound_messages`: `id, tenant_id, relationship_id, action_id (q_runtime.actions), provider, from_connection_id, to[], subject, body_hash, rfc822_message_id, provider_message_id, provider_thread_id, reply_token, status (QUEUED|SENT|FAILED|RECONCILIATION_REQUIRED), sent_at`.
- `communication.inbound_messages`: the matched reply. It stores headers plus body in `relationship_shared` scope for the two parties only, and never feeds the other side's private Q.
- `communication.delegations` (Spec 5.5, 8.7.6): grantor, capability (`email.send_scheduling_reply`, `calendar.book_within_availability`, `crm.log_interaction`, …), scope (relationship / organisation), conditions, start, expiry, revoked_at.

Relationship events gain `outreach_sent`, `reply_received`, `meeting_requested`, `meeting_scheduled`, `meeting_completed`, each with `actor_type` (already includes `CONNECTED_SYSTEM`). The projector derives state from them. It never lets an LLM infer relationship state.

### 3.3 The R9 flow: proactive email with an approval bound to the exact message

1. **Trigger (proactive, L3).** A deterministic rule over the relationship projection fires, for example "Match ACTIVE for ≥ 3 days, no `meeting_requested`, investor has an EMAIL connection". It creates a Needs-you suggestion, not an action. Q says: "You matched with Vaultlyne on Monday and nothing has been scheduled. Want me to email Ada to propose times?" Rules live in a versioned config, not scattered constants.
2. **Prepare.** On "yes", Q runs with the relationship context the firewall permits: `relationship_shared` plus investor-private notes, never founder-private material. The specialist composes subject and body, and the application service creates the `email.send` action with this exact payload: from connection, to (the founder's *declared* contact email, taken from the relationship record and never model-supplied), cc, subject, body (plain text plus sanitised HTML), `inReplyTo`/`threadRef`, attachments by artifact version id, and a `relationship_id`. The binding hash covers all of it (`packages/q-actions/src/domain/binding.ts`).
3. **Show.** The Board renders an **Email draft object** as a typed component with no generated UI. It shows From, To, Subject and Body, and Edit / Approve & send / Discard controls. Any edit, by typing, by voice ("make it shorter") or by Q revising, **creates a new action version and voids the old approval**. Voice "yes" works through DECISION_READER (ADR 0012), but the approval is recorded against the exact version hash on screen, so modality is not authority.
4. **Execute.** `executeApproved` claims the action, then calls `EmailProvider.send` *outside* the DB transaction with idempotency key `q_action:<runId>:<actionId>`. The `outbound_messages` row stores the provider ids and the RFC 5322 `Message-ID` Capital Q generated, then emits `network.relationship.outreach_sent` through the outbox. Any ambiguity (timeout after send) → `RECONCILIATION_REQUIRED`, never a blind retry.
5. **Reply detection.** A reply matched to `provider_thread_id` or to `In-Reply-To` = our Message-ID becomes an `inbound_messages` row plus a `reply_received` event (actor CONNECTED_SYSTEM). Q surfaces it at L4 ("Ada replied: she can do Thursday at 3pm; want me to book it?"). Reply content is untrusted: it is fenced and summarised, and it can never trigger a tool call on its own.
6. **Audit.** `audit.material_actions` gets actor Q, authority = approver, object = relationship, outcome. Q can answer "What did Q send externally last week?" (Spec 8.7.10).

### 3.4 Provider choices and the verification wall

**Gmail.**
- `gmail.send` is a *sensitive* scope: app verification is needed, but no security assessment. `gmail.compose`, `gmail.readonly`, `gmail.metadata` and `gmail.modify` are *restricted*. Using any of them from a server means the CASA assessment (about $500–$4,500 a year (secondary), several weeks, re-assessed every 12 months).
- So **keep the draft inside Capital Q** and send with `gmail.send` only. Thread follow-ups by storing `threadId` and our own `Message-ID`.
- Reply detection through the Gmail API (`users.watch` + Pub/Sub + `history.list`) needs a restricted scope. Watches must be renewed within 7 days (Google recommends daily), are limited to one notification per second per user, and a missed renewal fails silently.
- Testing mode allows 100 test users, and refresh tokens expire after 7 days. That is acceptable for the founder's demo and not for customers.

**Two reply-detection paths:**
- (a) **Demo:** a Testing-mode Google app with `gmail.metadata` + watch/Pub/Sub, falling back to polling `history.list`. Headers only, which is enough to match `In-Reply-To`.
- (b) **Production without CASA:** `Reply-To: reply+<token>@replies.<domain>` handled by Postmark Inbound, which posts the full parsed message to a signed webhook. The trade-off is that a reply sent to the person's own address is missed. Pick before the first real users. Nylas's Shared GCP App, already through CASA Tier 3, is the managed alternative, but it is contract-only.

**Outlook / Microsoft Graph.**
- `Mail.Send` sends and saves to Sent Items.
- Reply detection needs `Mail.Read` (or Mail.ReadBasic) plus a `/messages` subscription. Outlook message subscriptions last up to 10,080 minutes, or 1,440 with resource data. Lifecycle notifications are required.
- Since November 2025 the Microsoft-managed default consent policy blocks *user* consent for Mail.Read, Mail.ReadWrite and Calendars.*, so enterprise tenants need admin consent. Outlook is P1.

**Calendar.**
- Google: `events.insert` with `conferenceDataVersion=1` and `createRequest.conferenceSolutionKey.type="hangoutsMeet"`, a unique `requestId` (the idempotency key), and `sendUpdates=all`.
- Calendar scopes are *sensitive*, not restricted, so no CASA. `freebusy.query` handles availability, and `events.watch` channels must be re-created.
- Graph: `isOnlineMeeting: true` + `teamsForBusiness`, which personal Outlook.com accounts cannot use.

**Scheduling links.**
- Build Capital Q's own: a signed, expiring slot-offer token on the relationship, with slots computed from free/busy.
- Calendly's Scheduling API can book (live since 2025-10-16) but needs a paid plan. Cal.com v2 `POST /v2/bookings` / Atoms is AGPL and self-hostable.
- Owning the link keeps the booking tied to the canonical relationship (FSR §6).

**CRM.**
- A CRM is an *export or projection target*, never a parallel truth. The canonical relationship row stays authoritative (FSR §5).
- Affinity uses an API key per firm (treat it as a tenant secret; API access only on some licences).
- Attio is OAuth (25 writes/s). HubSpot notes use `POST /crm/v3/objects/notes` (a remote MCP server has been GA since April 2026, usable as an adapter). Salesforce needs External Client Apps since Spring '26.
- The first CRM action is `crm.log_interaction`, delegable (Spec 5.5 CRM level 3).

**Documents (PADL #66).**
- Google Drive `drive.file` with the Picker (non-restricted), then OneDrive and Dropbox. Imports land in the Evidence pipeline (malware policy `CQ_MALWARE_POLICY=REQUIRE_CLEAN` still applies).

**Managed auth vendors.** Composio, Arcade and Pipedream Connect vault tokens and speed up connectors. However, a shared OAuth app shows *their* brand on consent screens, bringing your own app still leaves CASA with you, and tokens then live outside the Capital Q trust boundary. **Do not adopt them for mail or calendar.** Revisit for long-tail CRMs in P2.

### 3.5 Deliverability

- 1:1 mail from the person's own mailbox is not bulk sending, and it inherits their SPF/DKIM and reputation.
- Platform mail (reminders, digests, notifications) goes through Postmark or Resend from `notify.<domain>` with SPF, DKIM and DMARC aligned.
- One-click unsubscribe (RFC 8058, DKIM-covered headers) is required for marketing and digest mail, and not for transactional mail.
- Bulk-sender status (about 5,000 a day to Gmail) is permanent, so keep digests batched (PADL #67).
- **No open-tracking pixels.** Apple MPP makes them meaningless, they raise ePrivacy/consent risk, and "viewing is not interest" (Spec 6.7.12).

### 3.6 Security checklist for the connector packet

Every item needs a test:

- Authorization code + PKCE, exact redirect URIs, state bound to session, tenant and expiry.
- Tokens encrypted and never in prompts or logs; a redaction test using a marker token like the existing egress markers.
- Revoke on disconnect.
- Webhook signature verification plus dedupe.
- Inbound content treated as untrusted.
- A per-connection rate limit, and an outbound recipient allow-list: only a relationship counterparty's declared address, which is refused otherwise (anti-spam, PADL #152).
- Cross-tenant negative tests on connections and messages.

## 4. Meetings, reminders and the meeting agent

### 4.1 Smallest compliant path

PADL #133 sets the path: Capital Q owns Schedule → Calendar → Meeting → Q attendance → Intelligence → Follow-up → Relationship progression, and V1 uses Zoom, Meet or Teams. CLAUDE.md forbids native meetings and custom video. The path is therefore **a meeting-bot vendor behind `MeetingBotProvider`**, with no video infrastructure of our own.

**Vendor: Recall.ai.**
- $0.50 per recording hour pay-as-you-go (first 5 hours free); $0.25/h on the startup programme; transcription $0.15/h.
- Calendar V2 for Google and Outlook.
- A Send Chat Message endpoint for consent notices.
- **Output Media**, which lets a bot speak (for §4.4 later).
- Alternatives: Nylas Notetaker ($0.70/h), Skribby ($0.35/h), MeetingBaaS; Attendee is open source, but its licence and Meet/Teams support are unclear.

**Platform constraints (2026):**
- **Google Meet:** guest bots must be admitted by a host; signed-in invitee bots skip the lobby. Best for the demo.
- **Zoom:** since 2026-03-02, a bot joining an *external* account's meeting needs a Marketplace-reviewed app **plus an OBF token** from an authorising user who is present in the meeting. Zoom also shows an unsuppressible recording-consent prompt. P1.
- **Teams:** third-party bots are labelled in the lobby and must be admitted by the organiser (MC1251206, GA June 2026), and an admin policy can block them. P1/P2.

### 4.2 Data and flow

Tables follow doc 13 §35 exactly: `communication.meetings` (relationship_id, organiser, times, timezone, provider, provider_meeting_ref, join_url, status, purpose), `meeting_participants` (with `consent_q_assistant`), and `meeting_artifacts` (transcript, summary, requests, commitments), each with `visibility_scope`.

Add `communication.meeting_bot_sessions`: provider bot id, status, consent log, recording retention deadline.

1. **Schedule** (`meeting.schedule`, CONFIRM_REQUIRED): Q proposes slots from free/busy for both parties. The payload is attendees, time, timezone, provider, agenda and message. On approval, `CalendarProvider.createEvent` runs with a Meet link and `sendUpdates=all`, and a `meeting_scheduled` event is emitted. Reschedule and cancel are separate actions.
2. **Consent.** When the meeting is scheduled, each Capital Q participant is asked "Allow Q to attend as a silent notetaker?". External participants are told in the invite text. Q joins only if the organiser consented and no participant declined (PADL #64: "explicit consent of all participants").
3. **Join.** The bot's display name is "Capital Q notetaker (AI) for <name>". On joining, and again when anyone new joins, it posts a chat notice: what it records, who gets it, and how to remove it. This covers EU AI Act Art. 50(1), in force 2026-08-02, and US all-party-consent states (CA, DE, FL, IL, MD, MA, MT, NH, PA, WA; apply the strictest). The Otter.ai consolidated class action (N.D. Cal. 5:25-cv-06911) is the cautionary case.
4. **After.** A webhook delivers the transcript (in `webhook_inbox`, a worker job). Q produces **two separate debriefs**, `founder_private` and `investor_private`, plus one `relationship_shared` factual summary that neither side's private analysis enters (Spec 6.9.6). Q extracts requested documents, questions and commitment signals as *proposals*. A "$500K" statement never becomes committed capital without confirmation (PADL #130). Follow-up drafts go through §3.3.
5. **Retention.** Audio and video are not stored by default; only the transcript and derived artifacts are kept, with a retention period. Transcripts are never used for training (PADL #150 Layer 4).

### 4.3 Reminders and alarms

One `notifications` service (doc 13 §98: `communication.notifications` + `notification_deliveries`) handles everything. Scheduled reminders are rows in `communication.reminders` (subject, due_at, attention_level, channel set, created_by actor/Q, status), executed by a pgmq-scheduled worker job. The workers already use pgmq.

**Channels:**
- In-app: the dock pill and Needs you.
- Email: Postmark or Resend.
- Calendar-native reminders on events Capital Q creates: popup/email overrides, at most 5, private to the authenticated user.
- Web Push: VAPID. **iOS only from 16.4, and only for a Home-Screen-installed web app.** P1, after the PWA manifest (`apps/web/app/manifest.ts` exists).
- SMS: not in V1. US A2P 10DLC registration and fees apply.

**Q creates reminders:**
- "Remind me Friday to follow up with Apex" is a `reminder.create` action.
- It is internal and reversible, so it is `LOW_RISK_INTERNAL`, like onboarding writes (ADR 0016), and needs no approval (Spec 5.5 Level 3 lists "Managing reminders").
- Meeting T−15 min is L4. Everything else batches into digests per the user's Focus / Standard / Proactive mode (Spec 5.4).

### 4.4 Q speaking in meetings: conflict, and a bounded proposal

R11 asks that Q "can speak in them". This **conflicts with locked PADL #64** ("Q shall function solely as a silent meeting assistant … without participating in the conversation"), with Spec 6.9.4 ("not intended to behave as a speaking investment participant in V1") and with doc 10 §14.

**Proposal (ADR + PADL amendment, §12 C1).** Keep silent notetaking as the default. Add an opt-in **"Ask Q aloud"** mode:

- Q speaks only when its principal addresses it by name ("Q, what was our March revenue?"), in the principal's own voice session.
- It answers only from information already disclosed to everyone present, in `relationship_shared` or `public_external` scope. It never uses the principal's private context aloud.
- It announces itself as AI at the start.
- It never negotiates or commits.
- Mechanics: Recall Output Media plays the audio of the existing voice stack (Deepgram Aura-2 or ElevenLabs) into the meeting, and the Context Firewall scope is set to "audience = all participants".

Until the amendment is accepted, only silent attendance ships, and "Q speaks" is demoed as a private in-ear coach: the voice session on the principal's device, which is not in the meeting.

## 5. Identity and brand: handles, the Q Card, "my Q"

### 5.1 What best-in-class does, and what to take

- **Popl, Blinq and HiHello:** QR, link, NFC and widget sharing; brand colours and fonts; CRM sync; lead exchange. Blinq Business is about $4.99/user/month.
- **Linktree and Carrd:** vanity URLs and custom domains.
- **Contra:** a portfolio as identity.
- **LinkedIn:** a profile QR in the app.
- **Apple NameDrop:** exchanges only a name, a chosen number or email, and the poster, with a "Receive only" option. Web apps cannot trigger it.

Two cautionary tales. Read.cv (acquired by Perplexity, shut May 2025) and Bento (shut Feb 2026, redirected to Linktree) show that **profile URLs outlive products, so own the domain and the redirects**. X's paid badge shows that **a badge must never be purchasable**.

Capital Q's version is not a contact card with a logo. It is the **company's (or investor's) Q identity**: a compressed, evidence-aware, visibility-governed entry point into the canonical profile (FSR §8: "a distribution mechanism … not another company database"; PADL #121). Its difference from Blinq is that every fact on it carries its provenance axes and its scope.

### 5.2 Handles (R5)

- **Table `core.handles`:** `handle` (citext, globally unique, `^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$`), `subject_type (COMPANY|INVESTOR_ORGANISATION|PERSON)`, `subject_id`, `status (ACTIVE|HELD|RETIRED|RESERVED)`, `claimed_by`, `claimed_at`, `released_at`, `hold_until`.
- The handle is a **display route, never a foreign key** (doc 13 §72). The UUID stays canonical, and the existing per-tenant `slug` columns are left alone.
- **Reserved list** as reference data, not an enum: `admin, ops, q, capitalq, support, help, api, www, settings, verify, security, legal, fdn, …`, plus well-known fund and company names that are claimable only through verification.
- **Rename policy:** the old handle redirects (301) and is **held for 90 days**. A handle held by a *verified* organisation is **retired, never recycled** (the GitHub model). Renames are limited to one per 14 days (Instagram).
- **Claim rules:** a company or investor-org handle needs the organisation-admin role. A handle containing a verified brand name requires `DOMAIN_CONTROL` or `ORGANISATION` verification. Disputes go to the operator queue (O-h).
- **Q parity:** `handle.claim` / `handle.change` are CONFIRM_REQUIRED actions, because a handle is a public representation.

**GateQ's design note:** the migration comment chose opaque ids so gateways cannot be enumerated. That still holds for **private** links. The card therefore has two link types:
- (a) a vanity `/@handle`, opt-in, `public_external`;
- (b) an opaque `/c/<token>` share link (`core.shareable_identities.public_token`, doc 13 §97) that can be scoped to `network_visible` or a specific recipient, can expire, and can be revoked.

### 5.3 The Q Card (R6)

**Surfaces.** The data comes from the canonical profile through a projection filtered by scope. Nothing is copied.

| Surface | Contents | Scope rule |
|---|---|---|
| `/@handle` public page | Name, one-liner, logo, sector, stage, location, raise headline (if the founder marks it public), pitch poster + video (if `PUBLIC` playback policy), verification labels ("Organisation verified", "Domain verified": exact claims, Spec 8.9.3), CTA row | Only fields whose scope is `public_external`. A signed-in network participant additionally sees `network_visible` fields. Never `founder_private` |
| `/c/<token>` share link | The same page, scoped by the token (e.g. includes network-visible traction for a named recipient) | The token's `visibility_profile`, and the recipient if named |
| QR | Encodes the short first-party redirect `https://<domain>/c/<code>` (≤ 30 chars) | Dynamic, so the target can change and a code can be revoked |
| vCard | `/@handle.vcf`, **vCard 3.0** for device compatibility, representative name, title, org, URL, and email/phone **only if opted in**; `X-Robots-Tag: noindex` | The person's own contact fields are `personal_private` until opted in |
| NFC | NTAG215 holding the same short URL (never a static vCard) | — |
| Email signature | HTML snippet plus a PNG badge from the OG renderer | — |
| OG image | `opengraph-image.tsx` via `next/og` `ImageResponse`, rendered with brand-kit colours and the logo | Public fields only |
| Apple Wallet / Google Wallet pass | Generic pass with the QR and a pass web service for updates | P2: needs the Apple Developer Program ($99/yr) Pass Type ID certificate plus APNs web service; the Google Wallet Issuer account starts in Demo Mode until a publishing review |

**Conversion loop (FSR §19; doc 17 §92–94).** An external investor gets value before any sign-in prompt. Sign-in or verification is required only for Ask Q, Save, Express Interest, Request Data Room and Schedule Meeting. The page's "Ask Q" answers **only from `public_external` material**, with a firewall scope `PUBLIC_VISITOR`, and is rate-limited.

**Indexing.** Pages are `noindex` by default. Google recommends it for user-profile areas, which are spam targets. The owner can opt in to indexing, and then the page emits `ProfilePage` JSON-LD with `mainEntity` Organization/Person. `/@handle` and `.vcf` are rate-limited, and there are no third-party pixels. Scan and visit counts are first-party and **aggregate only**; a founder never sees "Sarah viewed your card" (Spec 6.7.12–6.7.14, PADL #128).

**Naming.** PADL #121 leaves the name open ("Q Card, Q Link, Q Code, Scan My Q"). Code uses `shareable_identity` until the founder chooses.

**Investor cards.** An investor organisation's card shows the public investment focus projection (ADR 0015) and the GateQ inbound mode, with an "Apply through GateQ" CTA linking to the public gateway page. This finally gives the existing public GateQ API a web page.

### 5.4 Brand kit and "my Q" (R7)

**Entity `core.brand_kits`** (per organisation, versioned; revisions appended):
- `logo_asset_ids` (primary, mark, on-dark)
- `palette` with roles (primary, accent, neutral-dark, neutral-light), each hex validated
- `font_pair` (heading and body; stored as family names with a licence note; only fonts we can legally embed; otherwise a mapped fallback)
- `tone` (closed set: formal / plain / warm; plus up to 3 do/don't phrases)
- `provenance` per field (`Q_INFERENCE` from website/deck, or `USER_CLAIM`)

**Capture.** This follows Canva's Brand Kit Builder pattern, extraction from a website or PDF. Q extracts from the declared website and the uploaded deck, and the result becomes a **recommendation** the person confirms (ADR 0016 `recommend` → `accept_recommendation`). A `brand.update` action handles later changes.

**Where it is used:**
- **deck-render:** a fourth theme `BRAND` derived from the kit. The contrast of text on the brand colours is checked, and the palette falls back if it fails WCAG AA.
- Brief and report PDFs, OG images, the Q Card, and email signatures.

**It never recolours the Capital Q application chrome.** Semantic `--cq-*` tokens stay the product's source of visual truth (ADR-001 D3), and brand colours appear only inside the user's artifacts and card.

**"My Q" persona, within limits.** People can already choose a voice (two Aura-2 voices; ElevenLabs male/female). Add:
- a pronounceable name for how Q addresses them (memory already stores pronunciations);
- verbosity (brief / standard / detailed);
- proactivity mode (Focus / Standard / Proactive, Spec 5.4);
- a tone preference.

**Not allowed:** renaming Q per user; personas that change Q's evidence discipline; "yes-man" settings. The founder asked that Q be "theirs and theirs only, but not a yes-man", and PADL #11 (Q works in the founder's best interest) plus #154 (Q may strongly challenge commercial decisions) already say this. The settings change *style*, never *judgement*. All of it lives in `q_knowledge.memory_items` as typed preferences (ADR 0012), set through `note_preference` / `q.preferences.update`.

## 6. Profile and visibility

### 6.1 The editable, enriched profile (R4)

**Why editing is broken.** `apps/web/app/(app)/profile/page.tsx` has no form at all; it is a definition list. The fix is not a bug patch but the missing surfaces the IA already names: **Account** (person), **Company** (Overview · Intelligence · Evidence · Visibility, doc 17 §146) and **Organisation** (Mandate · GateQ · Portfolio · Team, doc 17 §147).

**Field inventory** (sources: Spec 6.3.2, 6.3.4; GateQ spec Part II §1, §9; doc 10 §7):

| Profile | Layer 1: compressed (card) | Layer 2: structured story | Layer 3: permissioned |
|---|---|---|---|
| Company | Name, handle, logo, one-liner, founder(s), HQ, sector (taxonomy), stage, raise target + instrument, selected traction (2–3 metrics), pitch video, Q summary | Problem, Solution, Market, Business model, GTM, Traction, Team, Financials (headline), Fundraise, Use of funds, Website/links | Detailed financials, cap table, contracts, customer data; Data Room only |
| Investor organisation | Name, handle, logo, type (angel/VC/FO/CVC), one-line thesis, stages, sectors, geographies, cheque band, inbound mode (GateQ) | Thesis narrative, portfolio (ADR 0007 references), representatives, value-add, decision process | Declared mandate detail, hard exclusions, notes: `investor_private` always |
| Person | Display name, pronounced name, headline, role at org, photo (P1), links (declared) | Background, domain experience (founder team facts) | Contact details, `personal_private` unless opted in |

**Provenance display (ADR-001 D2).** Each material field shows a quiet line under its value, for example: "You said · 12 Sep" (USER_CLAIM + SELF_REPORTED), "From your deck, p.7 · 12 Sep" (DOCUMENT_SUPPORTED), "Companies House record · verified 3 Sep" (EXTERNALLY_VERIFIED), or "Q's reading of your website · unconfirmed" (Q_INFERENCE, CANDIDATE). Lifecycle badges appear only when not CURRENT (Stale, Disputed, Contradictory), in words, never colour alone. Unknown is shown as "Not stated", never as zero (CLAUDE.md invariant). There are no confidence percentages (ADR 0017 prohibitions).

**Who fills what:**
- **Q fills:** the Layer 2 narrative from the deck and interview, presence-research candidates, the brand kit, and investor pre-fill (§9). Every Q fill arrives as a *proposal row* with a Confirm / Edit / Reject control. Material facts need confirmation (doc 10 §5.1 "Review before commit").
- **The person edits:** everything, inline. Each field saves through the same owning-context service that `company.profile.update` uses, so **UI and Q share one write path** (§10). Direct UI edits by an authorised human are human actions (audited) and need no approval. Q-originated edits keep going through the Approval Engine (ADR 0011).
- **Not editable:** InvestIQ results (PADL #107: challenge, not edit), verification labels, and relationship history.
- **History:** every profile change appends a revision; "View history" lists who changed what, when and from where (Human / Q-approved-by / Connected system). It is exportable (R3).

### 6.2 The visibility control centre (R8)

One page, `/company/visibility` (and `/organisation/visibility` for investors), plus the same control **on every object** (Spec 8.9.5 "Who can see this?"). It has three parts:

1. **Audience preview:** tabs **Public (anyone with the link)** · **Capital Q network** · **A specific investor…** · **Only us**. Each tab renders the profile exactly as that audience sees it, through the real read path and firewall, not a client-side mock. This is the V1 form of "View As" (Spec 8.9.8; FSR §22 says full View-As UI is not V1, so the preview is a read-only projection, not impersonation).
2. **Field scope table:** each field or section with a scope selector limited to the scopes valid for it. Financials cannot be set to `public_external`. Sensitive fields default private and move outward deliberately (Spec 8.3.3 "Private → Shared").
3. **Sharing ledger:** active `specifically_shared` / `relationship_shared` grants (recipient, what, view / view+download, expiry), each with Revoke. The revocation wording is precise: "future access removed; downloaded copies can't be recalled" (Spec 8.9.2, 8.10.9).

**Storage.** Field-level scope uses the existing `permissions.disclosure_policies` (extend it with a `field_path` target) rather than a new mechanism. `marketplace_visibility` stays the coarse switch, and the discoverability rules (PADL #57/#58) still gate `network_visible` on verification and readiness.

**Q parity:**
- "Who can see our cap table?" uses the read tool `get_disclosure_state`.
- "Make the raise public" is a `disclosure.set_scope` action, CONFIRM_REQUIRED, with the Spec 8.9.7 sharing preview ("Apex will receive … will not receive …") rendered as the approval object.
- `company.visibility.set` today supports only two values; widen it to the full vocabulary with per-scope validity rules.

**Investor viewing privacy (PADL #129).** Full identity / organisation only / anonymous is a setting on the investor's account, applied at read time to any "who viewed" aggregate. V1 shows founders aggregates only.

## 7. Operator console (R12)

**Placement.** `/ops` is a separate route group with its own layout, never reachable from product navigation and never exposed as hidden normal-user UI (doc 17 §150). Build it in-app on the same authorised API rather than in Retool. Retool typically needs broad database credentials, which conflicts with "privileged access isolated and explicitly named", and its audit logs and SSO only start on the Business tier.

**Principal.** A new `platform_operator` role in the identity schema, separate from organisation roles, with capabilities `verification.decide`, `marketplace.override`, `report.triage`, `enforcement.apply`, `handle.administer` and `audit.read`.

- **Step-up:** WebAuthn re-authentication, freshness checked server-side against the authentication event, required for decide, suspend and badge changes (OWASP ASVS V4; Spec 8.9.11).
- **Four-eyes:** a second operator approves the exact decision payload for ORGANISATION verification and any suspension. This reuses the Approval Engine's binding model with a *platform* action class.
- Every decision writes `audit.material_actions` with actor, reason code and authority.

**V1 screens (minimal but real):**

1. **Verification queue.** Pending `verification_claims` sorted by age, with filters by claim type. The case view shows:
   - the subject;
   - submitted evidence;
   - automated checks: domain-control result; for UK companies the Companies House officers/PSC records and the `identity_verification_details` field (ECCTA, mandatory from 18 Nov 2025); for US investors SEC Form D/ADV matches;
   - prior history.

   Decisions: Verify / Reject / Request more / Escalate, each with a reason code (reference data). `OPERATOR_DECISION` is already a reserved method, so this finally uses it. Individual identity verification by document plus selfie through Stripe Identity ($1.50 per check, first 50 free) comes later, behind `IdentityVerificationProvider`.
2. **Company acceptance.** Marketplace readiness per company: verification standing, completeness, pitch present, open reports. It shows why the rules say eligible or not. An operator override is an explicit, reasoned, audited decision that expires, never a hidden flag.
3. **Reports and moderation.** User reports (scam, impersonation, spam, harassment, confidentiality misuse, misleading information; Spec 8.6.9) and system integrity signals (outreach-volume spikes, Data Room harvesting patterns) feed a queue.
   - Actions follow the intervention ladder; the reporter's identity is protected.
   - "Reports are signals, not guilt" (PADL #152). There are no trust scores (Spec 8.6.13).
   - Users get a block action in the product (doc 10 §9 requires block/report once contact exists).
4. **Handles.** Reserve, release and transfer, with dispute notes.
5. **Health.** Queue depths (pgmq), slate build failures, connector `REAUTH_REQUIRED` counts, webhook inbox backlog, model-gateway quota errors, meeting-bot failures. It reads existing telemetry and adds no new store.
6. **Audit search.** Filter by actor, object and action type; export in P2.

**Operator "view as"** is read-only, time-boxed and bannered, and it runs through the Context Firewall as the target's audience, never with elevated read. It is P1.

**Q in the console.** The operator can ask Q "summarise this case" over the case's own evidence (an operator-scoped firewall context). Q never decides a claim.

## 8. Artifacts and media

### 8.1 Fix R1 first (P0)

1. **Export briefs.** Give `INVESTMENT_BRIEF` a PDF renderer and a DOCX optional in P1. Stop returning 409; route by artifact type in `apps/q-api/src/http/q-artifacts.ts`, and show PDF (and PPTX where the type has slides) on *every* artifact card (`artifact-viewer.tsx`, `q-result-blocks.tsx:378`).
2. **Rendering fidelity.** Keep pdf-lib/pptxgenjs for decks: fast, no browser, native editable PPTX charts. Add **embedded Unicode fonts** (Inter or Source Serif via `@pdf-lib/fontkit`) so ₦, €, £ and smart quotes are not dropped. Long-form reports (briefs, memos, meeting summaries, the investment intelligence report of GateQ spec Part II §27) are rendered as print-HTML and turned into PDF by **Playwright in `apps/workers`** with `tagged: true, outline: true`, giving accessible tagged PDFs and bookmarks. The web tier never hosts Chromium.
3. **Honest failures.** The web relay maps each upstream failure to a sentence naming the cause (not configured / not enough on record / renderer failed, retry). Q never narrates a file it did not produce (vault 2026-09-22 rule).
4. **Proof on the deployed stack (R17).** Confirm the hosted DB has `20261005090000_q_artifacts`. Then a smoke script against the Railway URL creates a brief and a deck, downloads both formats, checks the MIME type, magic bytes (`%PDF`, `PK`) and non-zero page and slide counts, and runs in CI after deploy.

### 8.2 Artifact kinds and history (R3)

- Extend `Q_ARTIFACT_TYPES` with `MEETING_BRIEF`, `MEETING_SUMMARY`, `INVESTMENT_MEMO` (investor-private) and `INTELLIGENCE_REPORT`, with `ONE_PAGER` in P1.
- Each is typed content validated by Zod, rendered by one renderer per output format.
- **Version history** already exists in `artifact_versions`. Add:
  - a history panel: version, author (Q run id plus approving human, or human edit), time, change note;
  - a side-by-side text diff;
  - "Restore as new version";
  - **Download history**: a CSV/JSON of version metadata, plus a ZIP of all rendered versions for P1.
- A profile edit log and an approvals log (who approved which Q action with which payload hash) are exportable per organisation. This is "Q action history" (Spec 8.7.10), filtered to the requester's authority.
- **Sharing an artifact** outside the owner is Execute (ADR 0013). Share, send and attach-to-Data-Room are approval actions. Download by the owner is not an external disclosure.

### 8.3 Images and uploads Q can reuse (R2)

- **Asset library.** Extend `media.media_assets` with `kind IMAGE` and purposes `LOGO`, `BRAND_IMAGE`, `DECK_VISUAL`, `AVATAR` and `GENERATED`, with owner organisation and visibility scope. Uploads reuse the existing upload-session and malware pipeline. Images are served via Cloudflare Images or R2 with signed URLs for non-public assets. Q can list and attach assets (`list_assets` read tool) inside artifacts.
- **Generation through the Model Gateway.** Add task class `IMAGE_GENERATION` / `IMAGE_EDIT` with output kind `IMAGE` and an `ImageProvider` adapter.
  - **OpenAI gpt-image** first: gpt-image-1.5 / gpt-image-2, edits with masks, ZDR-eligible (otherwise 30-day abuse-monitoring retention), C2PA plus SynthID. About $0.03–0.05 per medium 1024² image (secondary).
  - **Gemini paid-tier image models** (3.1 Flash Image) second. **Never the free tier for private material**, because free-tier content is used to improve Google products.
  - This matches the demo policy "OpenAI first, Gemini fallback".
  - Ideogram (text in images) and Recraft (SVG, brand-style logo variations) are P2 adapters.
- **Rules:**
  - Charts are **never** generated. They are drawn from data (pptxgenjs native charts or SVG) so numbers trace to evidence.
  - No synthetic real people and no synthesised third-party logos. Logo work only composes around the uploaded logo.
  - Keep C2PA metadata through resizing, and label generated visuals "AI-generated". EU AI Act Art. 50 marking applies from 2 Aug 2026, with existing systems given until 2 Dec 2026.
  - A generated image is a private draft (Prepare) until used in a shared artifact.
  - Prompts carry only what the firewall permits. A deck visual prompt never includes private financials.

## 9. Investor onboarding: research first (R13)

**Principle.** Q works first, then the person confirms. Inferred never becomes declared (FSR §7: Declared Mandate ≠ Observed Behaviour ≠ Q Inference ≠ GateQ Rules). Doc 10 §5.5 wants the first feed fast, so research must *shorten* I1–I8, never add steps.

**Flow:**

1. **I0.** The person gives their name, firm and firm domain (or just the firm name). An **Art. 14-style notice** appears at that moment: "I'll look at public sources about you and your firm (your website, public filings) to save you typing. Nothing is used until you confirm." Because the person is the data subject and is told in context, the Bisnode lesson (a website notice is not enough) is avoided.
2. **Research job** (worker, `q-presence` with subject INVESTOR_ORGANISATION and PERSON, bounded by ADR 0009's egress firewall). Sources, in trust order:
   - **Firm website:** thesis page, portfolio page, team page, via the existing research port (Tavily; Exa, Parallel or Firecrawl as alternatives).
   - **SEC EDGAR:** `data.sec.gov/submissions`; Form D offering data and related persons; the Form ADV exempt-reporting-adviser rosters (most VCs file as ERAs). Free, with a 10 req/s fair-access limit and a declared User-Agent.
   - **UK Companies House:** officers, PSC and filing history; free, 600 requests per 5 min.
   - **Declared links** the person pastes (their LinkedIn URL). The existing Bright Data `lookup_public_profile` reads only a URL the person supplied. See the caveat below.
3. **What gets pre-built:**
   - investor type;
   - stage mix and sectors, **inferred from portfolio companies**, which are ADR 0007 portfolio references and themselves need confirmation;
   - geographies;
   - cheque-band hints (Form D minimums and fund size);
   - team members;
   - a thesis summary.
4. **Where it goes.** Each finding becomes an ADR 0016 `recommend` item on the matching onboarding step, carrying provenance: source URL, retrieval date, and a truth class of `Q_INFERENCE` (portfolio-derived stage mix) or `UNKNOWN`/`EXTERNALLY_VERIFIED` (a registry fact, for that fact only). The mandate review screen (I11) shows "Found: Seed–Series A · from your portfolio page · 12 companies" with Accept / Change / Skip. `accept_recommendation` is the only way a finding becomes a declared mandate value. **Hard exclusions are never pre-filled** (doc 10 §5.5), only asked.
5. **Time budget.** Research runs while the first questions are asked (the paused-answer mechanism already exists). Nothing blocks the first feed. If research finds nothing, Q says so ("Absence is a fact too", doc 26 §5) and asks normally.
6. **Founder alignment.** Founders already get presence research. Apply the same "found / confirm" object and the same provenance labels on both sides, so the experience is one pattern.

**Sources not to use:**
- **LinkedIn scraping.** hiQ v. LinkedIn made the anti-scraping terms enforceable in contract; Proxycurl was sued and shut in July 2025.
- The Bright Data LinkedIn dataset lookup that exists today is a **legal and terms risk to flag**, even for a user-supplied URL. Recommend limiting it to reading back what the person themselves pasted, and replacing it with **LinkedIn OIDC sign-in** for self-declared identity (P1). Decision for the founder: §12 C5.
- **Crunchbase and PitchBook** data may not be shown to users under their licences (no raw redistribution; attribution rules).
- **Scraping OpenVC or Signal.**
- **Dealroom, Harmonic or Specter** only under an enterprise licence that permits display.

## 10. "Q can do anything the app can do": capability parity (R14, the principle; PADL #39, #55)

**One registry, two faces.** Create a `capabilities` registry. It is not a new package: it lives in `packages/contracts` as data, since contracts already owns Zod shapes. Each entry has:

```
id                 e.g. "company.profile.update"
kind               READ | NAVIGATE | INTERNAL_WRITE | CONSEQUENTIAL
input / output     Zod schemas (existing contracts reused)
http               the /v1 route that performs it (or null + reason)
qTool              the Q tool name (READ/NAVIGATE/INTERNAL_WRITE) or
qAction            the Approval Engine action type (CONSEQUENTIAL)
uiSurface          route + control id that performs it in the GUI
authorize          capability name checked server-side
delegable          whether Spec 5.5 delegation may skip approval
exemption          { uiOnly | agentOnly, reason } if parity is deliberately broken
```

**Rules:**
- The HTTP handler, the Q tool and the UI all call **the same owning-service method**. Q tools are thin adapters over the service, never a second implementation. Duplicated implementations drift (the "agent-native" guidance; Shopify Sidekick action extensions stage changes for confirmation the same way).
- Navigation parity is covered by `NAVIGATE` capabilities that return typed navigation actions (doc 17 §141: "Open company", "Show comparison"), which the dock follows (ux-direction §12.4).

**Parity test** (deterministic, Vitest; no LLM judges an invariant, CLAUDE.md):
- (a) Every registry entry has `http` and (`qTool` or `qAction`), or an exemption with a reason.
- (b) Every `/v1` route in apps/api and q-api maps to a registry entry. The test walks the Fastify route table.
- (c) Every Q tool and action is in the registry.
- (d) Every `CONSEQUENTIAL` entry has a registered action definition whose payload schema equals the entry input.

**Separately:** a Q eval suite of spoken and typed requests ("share the model with Apex view-only for 30 days", "open Vaultlyne", "remind me Friday") asserts that the *right capability* is proposed. That is a probabilistic eval, kept apart from the contract test.

**Initial inventory of missing Q capabilities** (from the code survey):
- document upload/import (`evidence.document.attach`)
- pitch upload (a link to the studio; recording stays UI)
- verification request
- GateQ publish
- save/pass (`discovery.interaction.record`, optimistic, INTERNAL_WRITE)
- artifact export/share
- handle claim
- brand update
- disclosure scope
- reminder create
- meeting schedule/reschedule/cancel
- email send
- data-room share
- report/block

Each is added with its owning packet below, so parity grows with the product rather than as a retrofit.

## 11. Messaging (COMM-001) plan, for later (R10)

- **Gate.** A thread exists only on an ACTIVE match (PADL #117/#118; Spec 6.6.6: "basic messaging after a genuine Match should not be artificially Pro-gated"). The thread is `relationship_shared` between the two organisations. Pre-match contact stays the Q-structured intro (PADL #102). No open DMs (PADL #152).
- **Build, not buy.** Store in `communication.threads` / `messages` with tenant RLS, and deliver with **Supabase Realtime private channels** (RLS on `realtime.messages`, re-authorised on connect). Stream, Sendbird and TalkJS cost $279–499/month at 10k MAU and put confidential content in a vendor store.
- **No E2EE.** It would defeat retention, audit, abuse review and the integrity authority. Use TLS plus encryption at rest with retention rules.
- **Messages as relationship history.** Each message emits a `message_sent` relationship event (metadata only), so the projector and Q's "what happened with Apex" see it. Attachments go through Evidence/Data Room disclosure, never raw chat uploads.
- **Q in the thread.** Q drafts replies (`message.send` is CONFIRM_REQUIRED by default, delegable for scheduling replies) and summarises the thread for each side privately. Q never posts as a party.
- **Anti-surveillance.** No read receipts shown as interest; typing indicators are optional. Report and block are in-thread and feed the operator queue.
- **Email bridge.** When the counterparty is external (no account), the thread's outbound goes via the §3.3 email path, and replies come back via the reply matcher into the same thread.

## 12. Conflicts with locked sources and the ADRs they need

The rule is: flag it, don't redesign it, and propose the amendment. Nothing below is dropped. Each item waits on its decision.

| # | Conflict | Locked source | Proposal |
|---|---|---|---|
| C1 | R11 "Q can speak in meetings" | **PADL #64 (locked): "solely as a silent meeting assistant … without participating"**; Spec 6.9.4; doc 10 §14 lists "Q speaking inside investor meetings" as not V1 | **PADL amendment + ADR "Principal-invoked speech in meetings"**: silent stays the default. Opt-in "Ask Q aloud" speaks only when its principal addresses it, only from material disclosed to all present (`relationship_shared`/`public_external`), announces itself as AI (EU AI Act Art. 50(1)), never negotiates or commits, and all-party consent is recorded. Ships P2 after the silent notetaker. Until then, demo it as a private in-ear coach. |
| C2 | The external Q Card page shows "safe network-visible information" to unauthenticated visitors | Doc 17 §93 vs **ADR-001 D1** (`network_visible` = authenticated participants only) | **ADR "Q Card audiences"**: the unauthenticated page shows `public_external` fields only; a signed-in participant also sees `network_visible`; opaque share tokens may widen to a named recipient. Founders pick public fields at F10. Clarifies doc 17 and does not amend the PADL. |
| C3 | New internal writes by Q (reminders, save/pass, preferences, brand drafts) | ADR 0013 "Tool Registry stays read-only"; ADR 0016 added a `LOW_RISK_INTERNAL` write lane scoped to onboarding | **ADR extending the 0016 lane**: `INTERNAL_WRITE` capabilities that touch only the actor's own record, are reversible and are re-validated by the owning service may be Q tools without approval. Everything that leaves the owner stays CONFIRM_REQUIRED. |
| C4 | Pulling calendar, outreach email and meeting intelligence into the prototype | Doc 10 §6 lists them as extension points; doc 25 §137 defers calendar and messaging for the two-day MVP | **Release Definition scope amendment** (not the PADL, which *requires* them: #62, #63, #64, #118, #133). Record that the founder moved R9 and R11 into the prototype; the authority model is unchanged. |
| C5 | Bright Data LinkedIn lookup (built, doc 26 §5a) | Not a locked source, but a legal and terms risk (hiQ, Proxycurl); doc 26 §5 itself says "Scrape LinkedIn: we will not" | **Founder decision + ADR**: restrict the lookup to a URL the person supplied about *themselves*, labelled "their LinkedIn page says"; move to LinkedIn OIDC in P1; never look up third parties. |
| C6 | Platform operator crossing tenants | Doc 15 names support/security administrators but no principal exists; the permissions evaluator denies non-organisation principals | **Security ADR "Platform operator principal"**: separate role, WebAuthn step-up, four-eyes on organisation verification and suspension, every read and decision audited, view-as read-only through the firewall. |
| C7 | Autonomous email (delegated send) | PADL #120: consequential external comms human-approved **in V1**; Spec 5.5 allows delegation later | V1 approves every send. Delegation is only for *scheduling replies* and *reminders* (Spec 5.5 Communications/Calendar level 3), shipping P2 behind an explicit, revocable grant. No amendment needed; recorded so nobody widens it silently. |
| C8 | Brand colours vs design tokens | ADR-001 D3 / ADR 0017: `--cq-*` tokens are the visual truth | Not a conflict if brand colours apply **only inside user artifacts, cards and OG images**, never the app chrome. State it in the brand-kit packet. |
| C9 | Gmail restricted scopes for reply detection | Not a product source; Google policy (CASA) | Business decision before real users: CASA (about $500–4.5k/yr, weeks), or Postmark-inbound Reply-To, or Nylas Shared GCP (contract). Demo runs in Google Testing mode (100 users, 7-day tokens). |
| C10 | Image generation data posture | Doc 15 provider eligibility; PADL #150 | Demo: any configured provider (per the founder's demo model policy). Real customer data: OpenAI with ZDR or Gemini *paid* tier only. The gateway's posture mechanism already expresses this; no new rule. |
| C11 | Q Card name | PADL #121 "name TBD" | Founder choice; code uses `shareable_identity`. |
| C12 | PADL numbering collision | PADL uses "#66" twice (Ch3 collaborative workspaces; Ch4 evidence-acquisition connectors) | Editorial fix in the PADL; cite as "Ch4 #66" meanwhile. |

## 13. Phased packet plan

**Conventions:**
- Packets are `CQ-BIZ-*`. Each ends per CLAUDE.md Git Continuity: checks run, commit, push, remote SHA verified, ledger row written, and **deployed to Railway with a smoke proof (R17)**.
- Coordination-critical files (migrations, contracts, action definitions, the capability registry) have one owner at a time. Migration timestamps follow the latest (`20261009180000`).
- "Parity" in acceptance means the packet's capabilities are in the registry, each with its Q tool or action, and the parity test is green.

### P0: the prototype demo (founder can test end to end)

| Packet | Scope | Measurable acceptance | R |
|---|---|---|---|
| **BIZ-001 Artifact export fix + deployed proof** | PDF for `INVESTMENT_BRIEF`; download controls on every artifact; embedded Unicode font; honest error mapping; hosted migration check; post-deploy smoke script | On the Railway URL: brief → PDF and deck → PDF and PPTX all download (MIME correct, `%PDF`/`PK` magic, ≥ 1 page/slide); "₦2,000,000" survives in PDF text; asking Q "give me a PDF of my brief" by voice and by typing yields a file link and never a refusal (eval, 10/10 runs); 409 path removed | R1, R3, R17 |
| **BIZ-002 Profile editing, enriched** | Account, Company (Overview · Intelligence · Evidence · Visibility) and Organisation (Mandate · GateQ · Team) pages with inline edit through the same service as `company.profile.update`; provenance line per material field; append-only change log with "View history" + CSV download | Every editable field saves via keyboard only (Playwright); an edit made by Q and one made in the UI both appear in history with actor labels; unknown fields read "Not stated"; no field shows a percentage; cross-tenant edit returns 404 (test) | R4, R3, R14 |
| **BIZ-003 Visibility control centre v1** | Audience preview tabs (Public / Network / Specific investor / Only us) via real read paths; field-scope selectors for card/profile fields; `disclosure.set_scope` action with sharing preview; `get_disclosure_state` tool; `company.visibility.set` widened | For each audience tab, the rendered fields equal a server-side projection snapshot (test); `founder_private` never appears in the Public or Network previews (negative test with a private marker); "Who can see our raise?" answered from state (eval) | R8, R6, R14 |
| **BIZ-004 Handles + public Q Card** | `core.handles` (global, reserved list, 90-day hold, redirects); `core.shareable_identities`; `/@handle`, `/c/<token>`, QR (dynamic redirect), vCard 3.0, `opengraph-image`, noindex by default; the page's CTAs route to sign-in; `handle.claim` action; investor card shows GateQ inbound + public GateQ page | Unauthenticated `/@handle` shows only `public_external` fields (test with markers); renamed handle 301s for 90 days and is not claimable meanwhile; a reserved word is refused; QR scans to the page on iOS and Android camera; vCard imports into iOS Contacts and Google Contacts; the page LCP ≤ 2.5 s p75 on the deployed URL; no third-party requests on the page | R5, R6, R8 |
| **BIZ-005 Brand kit v1** | `core.brand_kits` (versioned); extraction from website and deck as recommendations; confirm UI + `brand.update`; `BRAND` deck theme with a contrast guard; brand on the card and OG image | A company with a website gets proposed palette and logo in ≤ 60 s; nothing applies before confirmation; a deck re-rendered with BRAND passes WCAG AA text contrast on every slide (automated check); app chrome tokens unchanged (visual test) | R7, R2 |
| **BIZ-006 Operator console v1** | `platform_operator` principal + WebAuthn step-up; `/ops` verification queue (reason codes, Companies House/SEC checks, `OPERATOR_DECISION`), company acceptance view, audit search, handle admin; security ADR (C6) | A founder's verification request appears in the queue; the operator verifies with a reason and the company becomes discoverable within one slate refresh; a non-operator hitting `/ops` or its API gets 404; every decision has an audit row with actor, reason and authority; a decision without fresh step-up is refused (test) | R12 |
| **BIZ-007 Integrations foundation + Google** | `integrations.*` tables, OAuth (PKCE, state), encrypted credentials, disconnect/revoke; Google connect (`gmail.send`, `calendar.events`, `gmail.metadata` in Testing mode); `EmailProvider` + `email.send` action; outbound/inbound message tables; Pub/Sub watch (or `history.list` polling) reply matcher; relationship events `outreach_sent` / `reply_received`; the proactive "email the founder?" rule; Email draft Board object | Demo script: investor matched 3 days ago → Q proposes an email (Needs you) → draft shown → the investor edits one word → the approval hash changes and the old approval is void (test) → approve → the founder receives it in Gmail threaded with our Message-ID → the founder replies → within 2 min the relationship timeline shows "Ada replied" and Q offers a next step. A token never appears in logs or prompts (redaction test); a recipient not on the relationship is refused; a duplicate approve sends once (idempotency test) | R9, R14, R15 |
| **BIZ-008 Meetings + reminders v1** | `communication.meetings/participants/artifacts`, `reminders`, `notifications`; `meeting.schedule/reschedule/cancel` actions with a Google Meet link; free/busy slot proposal; `reminder.create` INTERNAL_WRITE (ADR C3); in-app Needs-you + email reminders (Postmark/Resend); meeting prep brief artifact at T−24 h | "Q, set up a call with Ada next week" → 3 slots from both calendars → approve → the event exists in both calendars with a Meet link; a reminder email arrives at T−15 min ±1 min; a prep brief exists 24 h before; cancel removes the event and emits `meeting_cancelled`; reminders obey Focus mode (only L4 delivered) | R11, R14 |
| **BIZ-009 Investor research-first onboarding** | At I0 the notice + research job (website, SEC submissions/Form D/ADV, Companies House, declared links); findings as `recommend` items with provenance; I11 shows found/confirm; no hard-exclusion pre-fill; same object on the founder side | For a seeded real public firm, ≥ 4 of stage/sector/geography/cheque/portfolio are pre-proposed with source links; median investor onboarding turns drop ≥ 30% versus the baseline walkthrough; zero values become declared without `accept_recommendation` (test); first feed reachable with research still running | R13, R15 |
| **BIZ-010 Capability registry + parity test + proactive rules** | Registry in contracts; contract parity test (routes ↔ tools/actions ↔ registry); Q tools for save/pass, document attach, verification request, GateQ publish, artifact export; versioned proactive-rule config feeding Needs you (interest received, match without meeting, meeting tomorrow, verification blocked, stale Data Room grant) | The parity test fails when a route is added without a registry entry (demonstrated); ≥ 90% of P0 UI actions have a Q path, the rest carry exemptions with reasons; each proactive rule has a unit test and a suppression (no repeat within its window) | R14, R15, principle |
| **BIZ-011 Continuous Q-intelligence loop** | A standing improvement agent: nightly scripted walkthroughs (founder, investor, adversarial) on the deployed stack, graded by deterministic checks + evals; failures filed to the ledger with transcripts; prompt/reader fixes as their own packets | A nightly report exists for 7 consecutive days; each regression has a ledger row within 24 h; eval pass rate is tracked per prompt version | R16, R17 |
| **BIZ-012 Deploy train** | Every packet's migrations are applied to hosted Supabase before its code; the post-deploy smoke suite (auth, onboarding turn, feed, artifact export, Q Card, ops 404) runs on each Railway deploy | Smoke green after each deploy; hosted migration list equals repo list (checked in CI) | R17 |

### P1: next (depth and real-user readiness)

| Packet | Scope | Measurable acceptance | R |
|---|---|---|---|
| BIZ-101 Silent meeting notetaker | Recall.ai on Google Meet; consent capture per participant; named bot + chat disclosure on join and on new joiners; transcript webhook; separate founder/investor debriefs + shared factual summary; requests/commitment *proposals*; follow-up drafts via BIZ-007 | Bot never joins without organiser consent (test); disclosure posted within 10 s of admission; debriefs produced ≤ 5 min after the end; founder debrief text never appears in investor context (marker test); "$500K" becomes a confirmation request, not committed capital | R11 |
| BIZ-102 Images + asset library | `IMAGE` assets (logo, brand image, deck visual, avatar, generated); `ImageProvider` (OpenAI gpt-image first, Gemini paid second) via the Gateway task class; generate/edit/reuse tools; C2PA preserved, "AI-generated" label | A deck visual is generated, edited once, reused in a second deck; the C2PA manifest verifies after resize; charts are never image-generated (lint rule on the deck spec) | R2, R7 |
| BIZ-103 Reports + history exports | `MEETING_SUMMARY`, `INVESTMENT_MEMO`, `INTELLIGENCE_REPORT`; Playwright tagged PDF in workers; version diff, restore, ZIP of all versions; approvals log export | A PDF passes a tagged-structure check (has StructTreeRoot, outline); diff shows changed sections; ZIP contains every version | R1, R3 |
| BIZ-104 Outlook / Graph connector | Mail.Send, calendar with Teams link; subscriptions with lifecycle handling; admin-consent guidance | Same R9 demo script on an M365 test tenant | R9, R11 |
| BIZ-105 CASA-free reply path | Postmark inbound Reply-To tokens, signed webhook; production decision on C9 | A reply to the tokened address lands in the relationship within 1 min; a forged webhook is rejected | R9 |
| BIZ-106 Scheduling link | Signed, expiring slot-offer link for external counterparties; books into the canonical relationship | An external person books without an account; the meeting attaches to the right relationship; an expired link is refused | R11 |
| BIZ-107 Web Push + PWA reminders | VAPID, service worker, iOS Home-Screen guidance | A push is delivered on Android Chrome and installed iOS 16.4+ | R11 |
| BIZ-108 Reports, blocks, moderation | Report/block in product; moderation queue with the intervention ladder; appeals record | A block prevents new interest/contact (test); report → queue → action → audited | R12 |
| BIZ-109 Delegation centre | Per-capability grants (Spec 5.5), revoke/suspend, audit | A revoked grant stops the next delegated action (test) | R9, R14 |
| BIZ-110 Investor public focus | ADR 0015 accepted + built; the investor card shows it | Turning off removes it from every founder read at once (test) | R6, R8 |
| BIZ-111 LinkedIn OIDC + research hardening | Self-declared LinkedIn via OIDC; restrict the Bright Data lookup per C5 | No third-party LinkedIn lookup possible (test) | R13 |
| BIZ-112 Operator view-as + four-eyes | Read-only, time-boxed, bannered, firewall-scoped | View-as cannot read beyond the target's audience (marker test) | R12 |

### P2: later

| Packet | Scope | R |
|---|---|---|
| BIZ-201 COMM-001 messaging | Match-gated threads, Supabase Realtime private channels, relationship events, Q drafts, email bridge (§11) | R10 |
| BIZ-202 "Ask Q aloud" in meetings | Only after the C1 amendment; Recall Output Media + existing voice stack; audience-scoped firewall | R11 |
| BIZ-203 Wallet passes + NFC | Apple Pass Type ID, APNs pass web service; Google Wallet Issuer after publishing review; NFC tag URL writer | R6 |
| BIZ-204 CRM export | Affinity (key), Attio (OAuth), HubSpot notes; `crm.log_interaction` delegable | R9 |
| BIZ-205 Zoom + Teams bots | Zoom Marketplace app + OBF; Teams lobby admission guidance | R11 |
| BIZ-206 Document connectors | Google Drive Picker (`drive.file`), OneDrive, Dropbox into Evidence (PADL Ch4 #66) | R2, R9 |
| BIZ-207 Identity verification provider | Stripe Identity behind `IdentityVerificationProvider` | R12 |
| BIZ-208 Audit and data export | Organisation audit export; user data portability (PADL #151) | R3, R12 |
| BIZ-209 Specialist image providers | Recraft (SVG logo variations), Ideogram (text-in-image) | R2, R7 |
| BIZ-210 Raise record + existing-investor state | PADL #131, #132 | R15 |

**Coverage check:** R1 (001, 103) · R2 (005, 102, 206, 209) · R3 (001, 002, 103, 208) · R4 (002) · R5 (004) · R6 (003, 004, 110, 203) · R7 (005, 102, 209) · R8 (003, 004, 110) · R9 (007, 104, 105, 109, 204, 206) · R10 (201) · R11 (008, 101, 104, 106, 107, 202, 205) · R12 (006, 108, 112, 207, 208) · R13 (009, 111) · R14 (002, 003, 007, 008, 010, 109) · R15 (007, 009, 010, 210, and this document) · R16 (011) · R17 (001, 011, 012). Every R-item has at least one P0 packet except R10, which the founder scheduled as "later".

**Suggested P0 order:**
1. 001 and 012, in parallel: the founder sees a fix at once.
2. 002 → 003 → 004: profile, then scope, then card, all sharing the scope projection.
3. 006, which unblocks discoverability honestly.
4. 010, before 007 and 008 so they register their capabilities.
5. 007 → 008.
6. 009, alongside the others; it touches onboarding only.
7. 005.
8. 011, running continuously from day one.

## 14. Third-party accounts and keys the founder must provide

Secret values go into Railway variables by the founder. Agents never handle them in plain text.

**P0 (needed for the demo):**

| Account | What exactly | For |
|---|---|---|
| Google Cloud project | Gmail API, Calendar API and Pub/Sub enabled; OAuth Web client; consent screen in **Testing** with demo users added as test users (max 100; tokens expire every 7 days); Pub/Sub topic granting publish to `gmail-api-push@system.gserviceaccount.com` plus a push subscription to the API webhook | BIZ-007, BIZ-008 |
| A verified domain | Privacy policy + homepage (needed for Google verification later); subdomains `notify.` (sending) and optionally `replies.` (inbound) | BIZ-004, BIZ-007, BIZ-008 |
| Postmark (or Resend) | Server token; sending-domain DNS for SPF, DKIM and DMARC | Reminders and notifications (BIZ-008) |
| OpenAI | API key (already used); request **Zero Data Retention** for the organisation before real customer data | Images (BIZ-102), existing text |
| Web research | Tavily key (already supported) or Exa/Parallel | BIZ-009, BIZ-005 |
| SEC EDGAR | No key: a real contact User-Agent string ("Capital Q ops@<domain>") | BIZ-009, BIZ-006 |
| Companies House | Free REST API key | BIZ-009, BIZ-006 |
| Operator hardware | A passkey/WebAuthn authenticator for each operator | BIZ-006 |

**P1:**
- Recall.ai: API key, region, webhook secret; apply to the startup programme ($0.25/h).
- Microsoft Entra app registration (Mail.Send, Mail.Read, Calendars.ReadWrite, OnlineMeetings) plus an M365 test tenant.
- Gemini **paid** key.
- Postmark inbound domain (MX).
- LinkedIn Developer app for OIDC sign-in.
- VAPID key pair (generated, no vendor).
- Stripe account if Stripe Identity is chosen.

**P2:**
- Apple Developer Program ($99/yr) with Pass Type ID certificate and APNs key.
- Google Wallet Issuer account and service account (Demo Mode until publishing approval).
- Zoom Marketplace app (for OBF).
- Affinity/Attio/HubSpot app credentials per customer.
- Recraft and Ideogram keys.
- An optional Nylas contract (Shared GCP app) if the CASA route is rejected.

**Decisions only the founder can make:**
- C1: amend PADL #64 for speaking?
- C5: the LinkedIn lookup posture.
- C9: CASA vs reply-address vs Nylas.
- C11: the Q Card name.
- Which fields each company may make `public_external` by default: all off, with a recommended set.

## 15. Sources

**Product and architecture (repo):**
- PADL (#39, #50, #51, #55, #57, #58, #62–#67, Ch4 #66, #101, #102, #117–#121, #128–#133, #139, #140, #147–#155)
- Product Specification (5.4, 5.5, 5.6, 6.1–6.12, 8.1–8.11)
- Final System Review (§2–§35)
- GateQ spec (Parts I–IV)
- Doc 10 (§4–§15)
- Doc 12 §34–35
- Doc 13 §35, §72–73, §95, §97–98
- Doc 15 §65–67
- Doc 17 §6–9, §87–94, §102–104, §140–150
- Doc 22 §140–151
- Doc 25 §117–137
- Doc 26 §5–8
- ADR-001, ADRs 0009, 0010, 0011, 0012, 0013, 0015, 0016, 0017
- `docs/design/ux-direction-2026-09.md` §1, §12, §13
- Code survey of the repo (paths cited inline)

**Email, calendar, MCP, CRM, deliverability:**
- Gmail scopes: https://developers.google.com/workspace/gmail/api/auth/scopes
- Restricted-scope verification / CASA: https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
- CASA cost (secondary): https://deepstrike.io/blog/google-casa-security-assessment-2025
- Testing-mode limits: https://support.google.com/cloud/answer/15549945
- Unverified-app cap: https://support.google.com/cloud/answer/7454865
- Sending: https://developers.google.com/workspace/gmail/api/guides/sending
- Threads: https://developers.google.com/workspace/gmail/api/guides/threads
- Push: https://developers.google.com/workspace/gmail/api/guides/push
- users.watch: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/watch
- Graph createReply: https://learn.microsoft.com/en-us/graph/api/message-createreply?view=graph-rest-1.0
- Graph change notifications: https://learn.microsoft.com/en-us/graph/change-notifications-overview
- Outlook notifications: https://learn.microsoft.com/en-us/graph/outlook-change-notifications-overview
- Consent policy change (Nov 2025): https://blog-en.topedia.com/2025/11/microsoft-managed-default-app-consent-policy-now-blocks-20-additional-permissions/
- Graph delta: https://learn.microsoft.com/en-us/graph/delta-query-messages
- Calendar create events: https://developers.google.com/workspace/calendar/api/guides/create-events
- Calendar push: https://developers.google.com/workspace/calendar/api/guides/push
- Calendar reminders: https://developers.google.com/workspace/calendar/api/concepts/reminders
- Teams online meetings: https://learn.microsoft.com/en-us/graph/outlook-calendar-online-meetings
- Calendly Scheduling API: https://developer.calendly.com/schedule-events-with-ai-agents
- Cal.com bookings: https://cal.com/docs/api-reference/v2/bookings/create-a-booking
- Nylas pricing: https://www.nylas.com/pricing/
- Nylas Shared GCP: https://developer.nylas.com/docs/provider-guides/google/shared-gcp-app/
- Cronofy: https://www.cronofy.com/api-pricing
- MCP 2026-07-28 RC: https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/
- MCP security best practices: https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices
- Calendar-invite prompt injection: https://www.safebreach.com/blog/invitation-is-all-you-need-hacking-gemini/
- Workspace MCP servers: https://developers.google.com/workspace/guides/configure-mcp-servers
- HubSpot remote MCP: https://developers.hubspot.com/changelog/remote-hubspot-mcp-server-is-now-generally-available
- LangChain HITL: https://docs.langchain.com/oss/python/langchain/human-in-the-loop
- LangChain Gmail toolkit: https://docs.langchain.com/oss/python/integrations/tools/google_gmail
- Composio: https://composio.dev/pricing
- Arcade: https://www.arcade.dev/pricing/
- Pipedream: https://pipedream.com/pricing
- VC CRMs (secondary): https://www.4degrees.ai/blog/the-best-crm-platforms-for-venture-capital-firms-in-2026
- Affinity API: https://api-docs.affinity.co/
- Attio records: https://docs.attio.com/rest-api/endpoint-reference/records/create-a-record
- HubSpot notes: https://developers.hubspot.com/docs/api-reference/crm-notes-v3/guide
- Salesforce OAuth: https://developer.salesforce.com/docs/platform/api-rest/guide/intro-oauth-and-connected-apps.html
- DealCloud: https://api.docs.dealcloud.com/docs/data
- Google sender guidelines: https://support.google.com/a/answer/14229414
- Microsoft high-volume senders: https://techcommunity.microsoft.com/blog/microsoftdefenderforoffice365blog/strengthening-email-ecosystem-outlook%e2%80%99s-new-requirements-for-high%e2%80%90volume-senders/4399730
- RFC 8058: https://www.rfc-editor.org/rfc/rfc8058.html
- Postmark vs Resend: https://postmarkapp.com/compare/resend-alternative
- Postmark open tracking and Apple MPP: https://postmarkapp.com/support/article/1257-open-tracking-and-apple-mail

**Meetings, consent, voice, reminders:**
- Recall pricing: https://www.recall.ai/pricing
- Recall Output Media: https://docs.recall.ai/docs/stream-media
- Recall chat messages: https://docs.recall.ai/docs/sending-chat-messages
- Recall Calendar V2: https://docs.recall.ai/docs/calendar-v2-integration-guide
- Recall Desktop SDK: https://docs.recall.ai/docs/desktop-sdk
- Meeting-bot API comparison: https://www.nylas.com/blog/best-meeting-bot-apis/
- Zoom OBF FAQ: https://developers.zoom.us/docs/meeting-sdk/obf-faq/
- Zoom RTMS: https://developers.zoom.us/docs/rtms/
- Zoom consent prompt: https://www.recall.ai/blog/zoom-sdk-suppressing-consent-prompt
- Meet Media API: https://developers.google.com/workspace/meet/media-api/guides/overview
- Meet waiting room: https://docs.recall.ai/docs/troubleshooting-google-meet-waiting-room
- Teams third-party bots: https://office365itpros.com/2026/03/16/third-party-recording-bots/
- Teams compliance recording: https://learn.microsoft.com/en-us/microsoftteams/teams-recording-compliance
- Deepgram pricing: https://deepgram.com/pricing
- ElevenLabs agents pricing: https://elevenlabs.io/blog/weve-lowered-api-agents-pricing-and-introduced-pay-as-you-go
- Consent states: https://www.recordinglaw.com/party-two-party-consent-states/
- Otter.ai litigation: https://natlawreview.com/article/ai-notetaking-tools-under-fire-lessons-otterai-class-action-complaint
- GDPR and notetakers: https://measuredcollective.com/ai-note-taking-tools-and-gdpr-do-you-need-a-new-lawful-basis/
- EU AI Act Art. 50: https://artificialintelligenceact.eu/article/50/
- Art. 50 in effect: https://www.cooley.com/news/insight/2026/2026-08-03-eu-ai-act-transparency-obligations-take-effect-2-august-2026
- Consent practices: https://www.recall.ai/blog/5-ways-to-request-recording-consent-with-meeting-bots
- iOS Web Push: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- RFC 5545 VALARM: https://icalendar.org/iCalendar-RFC-5545/3-6-6-alarm-component.html
- Twilio 10DLC: https://help.twilio.com/articles/1260803965530

**Identity, brand, documents, images:**
- Read.cv shutdown: https://www.neowin.net/news/readcv-announces-acquisition-by-perplexity-as-it-begins-winding-down-operations/
- Bento shutdown: https://alternativeto.net/news/2025/12/bento-to-shut-down-in-2026-as-linktree-takes-over-and-offers-migration-path/
- Blinq comparison: https://blinq.me/blog/top-digital-business-cards-compared
- Contra: https://contra.com/how-it-works/independents
- Carrd: https://carrd.com/docs/pro/plans
- NameDrop: https://support.apple.com/guide/personal-safety/secure-namedrop-ips97e16d3b1/web
- RFC 6350 (vCard): https://datatracker.ietf.org/doc/html/rfc6350
- NTAG215: https://www.wakdev.com/en/knowledge-base/nfc-chips/nxp-ntag215.html
- Apple Wallet identifiers and certificates: https://developer.apple.com/help/account/capabilities/create-wallet-identifiers-and-certificates/
- Apple pass updates: https://developer.apple.com/documentation/WalletPasses/adding-a-web-service-to-update-passes
- Google Wallet issuer onboarding: https://developers.google.com/wallet/generic/getting-started/issuer-onboarding
- Next.js ImageResponse: https://nextjs.org/docs/app/api-reference/functions/image-response
- Google abuse prevention (noindex): https://developers.google.com/search/docs/monitor-debug/prevent-abuse
- ProfilePage structured data: https://developers.google.com/search/docs/appearance/structured-data/profile-page
- GitHub username changes: https://docs.github.com/en/account-and-profile/concepts/username-changes
- Instagram username hold: https://wersm.com/instagram-will-start-locking-old-usernames-for-14-days/
- Linktree terms: https://linktr.ee/s/terms
- X impersonation policy: https://help.twitter.com/en/rules-and-policies/x-impersonation-and-deceptive-identities-policy
- Canva Brand Kit Builder: https://www.canva.com/help/brand-kit-builder/
- Gamma developers: https://developers.gamma.app/
- Pitch export: https://help.pitch.com/en/articles/6713988-export-a-presentation-to-power-point
- Tome pivot: https://deckary.com/blog/tome-review
- PptxGenJS: https://gitbrent.github.io/PptxGenJS/
- Chrome PDF generation: https://blog.chromium.org/2020/07/using-chrome-to-generate-more.html
- Sparticuz Chromium: https://github.com/Sparticuz/chromium
- OpenAI data controls: https://developers.openai.com/api/docs/guides/your-data
- OpenAI content provenance: https://developers.openai.com/api/docs/guides/content-provenance
- OpenAI usage policies: https://openai.com/policies/usage-policies/
- Gemini pricing: https://ai.google.dev/gemini-api/docs/pricing
- Imagen 4: https://developers.googleblog.com/imagen-4-now-available-in-the-gemini-api-and-google-ai-studio/
- BFL pricing: https://bfl.ai/pricing
- Ideogram pricing: https://ideogram.ai/pricing
- Recraft API: https://www.recraft.ai/api
- EU transparency obligations FAQ: https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act

**Investor data, GDPR, trust and safety, parity, messaging:**
- Crunchbase licence: https://data.crunchbase.com/docs/license-agreement
- PitchBook API: https://pitchbook.com/products/direct-access-data/api
- Dealroom API: https://dealroom.co/products/dealroom-api/
- Harmonic: https://harmonic.ai/
- Specter API: https://www.tryspecter.com/api
- EDGAR access: https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data
- Form D data sets: https://www.sec.gov/data-research/sec-markets-data/form-d-data-sets
- RIA/ERA data: https://www.sec.gov/data-research/sec-markets-data/information-about-registered-investment-advisers-exempt-reporting-advisers
- Companies House rate limits: https://developer-specs.company-information.service.gov.uk/guides/rateLimiting
- Companies House officers: https://developer-specs.company-information.service.gov.uk/companies-house-public-data-api/reference/officers/list
- hiQ v. LinkedIn: https://www.zwillgen.com/alternative-data/hiq-v-linkedin-wrapped-up-web-scraping-lessons-learned/
- Proxycurl shutdown: https://nubela.co/blog/goodbye-proxycurl/
- Exa pricing: https://exa.ai/pricing
- Tavily credits: https://docs.tavily.com/documentation/api-credits
- Firecrawl pricing: https://www.firecrawl.dev/pricing
- Parallel pricing: https://docs.parallel.ai/getting-started/pricing
- GDPR Art. 14: https://gdpr-info.eu/art-14-gdpr/
- Bisnode fine: https://www.privacy-advice.com/en/news/polish-supervisory-authority-imposes-fine-for-breach-of-information-obligation-under-art-14-gdpr/
- EDPB legitimate interest guidelines: https://www.edpb.europa.eu/our-work-tools/documents/public-consultations/2024/guidelines-12024-processing-personal-data-based_en
- Apollo enrichment: https://docs.apollo.io/docs/enrich-people-data
- Stripe pricing: https://stripe.com/pricing
- Persona cases: https://withpersona.com/product/cases
- Middesk: https://www.middesk.com/solutions/verification
- OWASP ASVS access control: https://github.com/OWASP/ASVS/blob/master/4.0/en/0x12-V4-Access-Control.md
- Safe user impersonation: https://engineering.pigment.com/2026/04/08/safe-user-impersonation/
- Retool pricing: https://retool.com/pricing
- Agent-native guide: https://every.to/guides/agent-native
- Shopify Sidekick actions: https://shopify.dev/docs/apps/build/sidekick/build-app-actions
- Agentforce invocable methods: https://developer.salesforce.com/docs/ai/agentforce/guide/agent-invocablemethod.html
- Speakeasy OpenAPI-to-MCP: https://www.speakeasy.com/mcp/tool-design/generate-mcp-tools-from-openapi
- AI SDK tool approvals: https://ai-sdk.dev/docs/agents/tool-approvals
- Supabase Realtime authorization: https://supabase.com/docs/guides/realtime/authorization
- Stream Chat pricing: https://getstream.io/chat/pricing/
- Teams encryption: https://learn.microsoft.com/en-us/microsoftteams/teams-encryption
- Upwork circumvention: https://support.upwork.com/hc/en-us/articles/360052511133-Circumvention-and-why-it-s-against-the-rules

