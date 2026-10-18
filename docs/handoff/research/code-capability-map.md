I finished the read-only survey. The repo root is `C:\Users\DELL\Desktop\q` and every path below is absolute. `docs\execution\implementation-ledger.md` stops on 2026-09-21. Later packets (artifacts/QX-004, NET-010/011/012, QX-007/008, VERIFY-001) are in git history, not in that ledger.

## A. Web routes (`C:\Users\DELL\Desktop\q\apps\web\app`)

**Pages**

- **Root:** `page.tsx` has no landing page and sends people to Home.
- **Auth:** `auth\sign-in`, `auth\sign-up`, `auth\check-email`, `auth\forgot-password` and `auth\update-password` each have a `page.tsx`.
- **Onboarding:**
  - `(onboarding)\onboarding\founder\page.tsx`
  - `(onboarding)\onboarding\investor\page.tsx`
  - Both render a Q-led conversation workspace in `apps\web\src\features\onboarding-conversation\q-onboarding-workspace.tsx`, which also contains the voice stage. The older step-form UIs are under `src\features\founder-onboarding` and `src\features\investor-onboarding`.
- **Welcome / Home (the Q page):**
  - `(app)\welcome\page.tsx` is where a new person first meets Q (`welcome-screen.tsx`, voice stage).
  - `(app)\home\page.tsx` is Home as the unified Q surface (`src\features\home\home-screen.tsx`, `src\features\q\*`). It accepts `?c=<conversationId>`.
- **Discover / feed:** `(app)\discover\page.tsx`. Investors see a company feed with pitch video and Save/Pass. Founders see a list of investors.
- **Founder:**
  - `(app)\pitch\page.tsx`: pitch video upload (resumable tus)
  - `(app)\company\visibility\page.tsx`: visibility for both sides (company or investor screen)
  - `(app)\company\interest\page.tsx`: inbox of incoming investor interest (accept/decline)
  - `(app)\verification\page.tsx`: founder only; request verification and see standings
  - `(app)\capital\page.tsx`: capital objective. Meetings and diligence are placeholder text only.
- **Investor / company view:** `(app)\company\[companyId]\page.tsx`. It reads the network-preview projection and shows Express Interest and the Evidence/Q deeper view. The URL uses the company UUID.
- **Profile:** `(app)\profile\page.tsx` (details below).
- **Dev (404 in production):** `dev\ui\page.tsx` and `dev\q-presence\page.tsx`.
- **Missing:** no settings route, no admin/operator route, no public profile route by handle or slug, and no public GateQ page (the API has `/v1/gateq/public/:publicId`, but no web page uses it).

**API route handlers**

- `api\q-artifact\[artifactId]\[format]\route.ts`: GET only, format is `slides`, `pptx` or `pdf`, forwarded to the Q API with the session token.
- `api\q-speech\route.ts`: POST text-to-speech, forwarded to `/v1/q/voice/speech`.
- `api\q-stream\v1\q\runs\[runId]\events\route.ts`: SSE relay for Q runs.
- `auth\callback\route.ts`: Supabase OAuth callback.

**Profile page (`C:\Users\DELL\Desktop\q\apps\web\app\(app)\profile\page.tsx`)**

- It is a server component that only displays values. It has no inputs, no form and no edit component.
- It shows account email, display name, organisation context, `ThemeToggle`, `QMotionToggle`, a "Manage visibility" link to `/company/visibility`, and sign-out.
- This is why typing or clicking there does nothing: there is nothing to edit. There is no disabled, readOnly or overlay bug.
- The only fixed full-screen overlay in the app is `voice-stage.tsx:168` (`fixed inset-0 z-(--cq-z-modal)`), and it is only used on welcome and onboarding.
- Profile editing exists only through Q, via approval actions:
  - `apps\q-api\src\voice\profile-edit.ts` reads spoken edits for `displayName`, `companyName`, `websiteUrl`, `headquartersCity` and `shortDescription`.
  - `apps\q-api\src\composition\person-profile-action.ts` and `company-profile-action.ts` apply them after approval.
  - The company deeper view (`src\features\company\company-deeper-view.tsx`) has an "Edit with Q" draft affordance.

**Admin, operator and verification UI**

- There is no admin or operator UI.
- Verification UI is founder-facing only: `src\features\verification\verification-standings.tsx` and `verification-actions.ts`.

**Other API servers**

- `apps\api\src\http\*` covers companies, company-team, capital-objectives, discovery, documents, gateq and gateq-apply, investor-mandates, investors, me, media and media-webhooks, network-interests, onboarding, organisations, recommendation-interactions, taxonomy and verification.
- `apps\q-api\src\http\*` covers `/v1/q/runs`, conversations, events (SSE), approvals, artifacts, recommendation-explanations and `/v1/mcp`. `apps\q-api\src\voice\routes.ts` covers `/v1/q/voice/sessions|speech|think|ws|speak` and `/v1/q/interview`.

## B. Q tools, Q actions and approvals

Every tool has `approval: "NONE"` and `idempotency: "SAFE_TO_REPEAT"` (`C:\Users\DELL\Desktop\q\packages\q-tools\src\definition.ts`). Tools that lead to a consequential change only prepare a proposal for the Approval Engine. Tool files are in `C:\Users\DELL\Desktop\q\packages\q-tools\src\tools\`.

**Read tools (SAFE_READ)**

| Tool                         | What it does                                                       |
| ---------------------------- | ------------------------------------------------------------------ |
| `get_company`                | Canonical company profile                                          |
| `get_capital_objective`      | Company's current capital objective                                |
| `get_investor_mandate`       | Investor organisation's declared mandate                           |
| `search_companies`           | Network-visible companies by name, stage, country                  |
| `discovery_slate`            | The person's current discovery slate (if discovery is composed)    |
| `find_prospective_investors` | Investors from their declared public profiles                      |
| `recommendation_explanation` | Why a company was recommended                                      |
| `research_public_web`        | Tavily-backed search (only if a research provider is configured)   |
| `extract_public_web`         | Reads pages that `research_public_web` already found               |
| `lookup_public_profile`      | Public LinkedIn person/company lookup via a provider (Bright Data) |
| `get_relationship`           | State of the relationship with one counterparty                    |
| `list_incoming_interest`     | Investor interest in the founder's company                         |
| `get_onboarding_state`       | The person's onboarding as it stands                               |

**Write tools (LOW_RISK_INTERNAL)**

- `propose_express_interest` and `propose_interest_answer` (in `relationships.ts`) do not write. They call `relationships.prepareForApproval(...)` and return `WAITING_FOR_APPROVAL`. The action types are `relationship.interest.express` and `relationship.interest.respond`.
- The onboarding tools write onboarding state directly, with no approval: `record_answers`, `recommend`, `accept_recommendation`, `correct_answer`, `confirm_and_finish`.
- `note_preference` saves communication preferences to memory.
- The onboarding tools and `note_preference` are composed only in the interview agent (`C:\Users\DELL\Desktop\q\apps\q-api\src\voice\interview-agent.ts`), not in the default catalogue (`default-tools.ts`).

**Q actions** (registry in `C:\Users\DELL\Desktop\q\apps\q-api\src\main.ts` around lines 700–750; definitions in `apps\q-api\src\composition\`)

| Action type                     | What it changes                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| `company.profile.update`        | Company profile, via `companyService` with a `company.edit` check and a version check |
| `company.visibility.set`        | `organisation_private` or `network_visible` only                                      |
| `relationship.interest.express` | Express interest (CQ-NET-010)                                                         |
| `relationship.interest.respond` | Accept or decline (CQ-NET-011)                                                        |
| `person.profile.update`         | Display name only                                                                     |

- A comment in `main.ts` confirms there is no email, calendar, messaging, data room, connector or MCP executor.

**How approval binds to the payload** (`C:\Users\DELL\Desktop\q\packages\q-actions\src\domain\binding.ts`)

- SHA-256 over canonical JSON of an envelope: tenant, organisation, run, action id, type, version, risk class, targets and payload. The result is stored as `sha256:<hex>` and compared in constant time.
- Authorisation is checked again at execution time.
- Lifecycle is in `domain\lifecycle.ts`:
  - Actions: PROPOSED → AWAITING_APPROVAL → APPROVED → EXECUTING … FAILED, EXPIRED or WITHDRAWN.
  - Approvals: PENDING → APPROVED, REJECTED, EXPIRED or REVOKED, and they have an expiry time.

**Idempotency**

- The key is `q_action:<runId>:<actionId>` (`application\service.ts:208`). It has a unique constraint, and there is a unique index allowing one pending approval per action (migration `20260908090000_q_actions_approvals.sql`).
- The network interest tables add their own idempotency tables (`interest_requests`, `interest_response_requests`) keyed on idempotency-key and request hashes.

## C. Artifacts and deck rendering

**Kinds and storage**

- Two kinds: `Q_ARTIFACT_TYPES = ["INVESTMENT_BRIEF", "PITCH_DECK"]` in `C:\Users\DELL\Desktop\q\packages\contracts\src\q\artifact.ts`. There is no memo or report type.
- Stored in `artifacts.artifacts` and `artifacts.artifact_versions` (migration `20261005090000_q_artifacts.sql`), with status PREPARING, READY or FAILED, a visibility scope, and versioned revisions.
- Service code: `C:\Users\DELL\Desktop\q\packages\q-artifacts\src\*`. Composition: `apps\q-api\src\composition\artifacts.ts`. Preparation: `packages\q-specialists\src\company\prepare-artifact.ts`, `pitch-deck.ts` and `investment-brief.ts`.

**Rendering** (`C:\Users\DELL\Desktop\q\packages\deck-render\src\`)

- There is no Chromium or Playwright. It uses one layout (`layout.ts`) and three outputs:
  - SVG slides for the viewer (`svg.ts`)
  - PPTX via `pptxgenjs` 4.0.1 (`pptx.ts`, `write({outputType:"nodebuffer"})`)
  - PDF via `pdf-lib` 1.17.1 with the standard fonts (`pdf.ts`). Characters outside WinAnsi are removed rather than throwing.
- Three themes in `theme.ts`: MINIMAL_INSTITUTIONAL, DARK_TECHNICAL and WARM_GROWTH.

**Download routes**

- Q API (`C:\Users\DELL\Desktop\q\apps\q-api\src\http\q-artifacts.ts`):
  - `GET /v1/q/artifacts`, `/:id`, `/:id/versions/:v`
  - `/:id/slides`
  - `/:id/export/:format` (pptx or pdf)
- Web relay: `apps\web\app\api\q-artifact\[artifactId]\[format]\route.ts`.
- UI links: `apps\web\src\features\q\artifact-viewer.tsx:312-320` and `q-result-blocks.tsx:378`.

**Why PDF/PPTX could fail on the hosted stack**

- Only `PITCH_DECK` can be exported. An `INVESTMENT_BRIEF` returns 409, which the web shows as "That document has no slides." The PDF link only appears on deck cards.
- If `CQ_Q_API_URL` is not set for web, the route returns 503 "Q isn't connected on this build yet." Railway sets it in `C:\Users\DELL\Desktop\q\.railway\railway.ts:252`.
- Any upstream error other than 401, 403, 404 or 409 becomes 502 "I couldn't prepare that file."
- A thin company record gives `THIN_RECORD` and no artifact: "There isn't enough on record…" (`packages\q-specialists\src\answer.ts:884`). A deck about a public company depends on `TAVILY_API_KEY`; without a research provider the research tools don't exist.
- The ledger (debt item 4, line ~2150) says some migrations were applied locally but not on hosted Supabase. I did not check whether the hosted database has `20261005090000_q_artifacts`.
- Prompt history: before TURN_READER v3 (CQ-QACT-002), Q described a deck instead of making one (comment at `packages\q-core\src\prompts\schemas\turn-reader.ts:116-127`). The current reader has `PREPARE_DOCUMENT` covering "PDF deck". I found no explicit "can't create files" refusal text.
- Acceptance ledger F10, F11 and F13 record deck revision and routing failures.

## D. Connectors, MCP and LangChain

**`C:\Users\DELL\Desktop\q\packages\q-connectors\src\`**

- `mcp\source.ts` and `mcp\remote-tool.ts`: Q as an MCP client (`createMcpToolSource`, `defineMcpTool`). They are defined, but nothing outside the package's tests uses them. No remote server is registered.
- `mcp\server.ts`: Q as an MCP server. It is mounted at `POST /v1/mcp` by `apps\q-api\src\http\q-mcp.ts` only when `config.connectors.mcpServer` is set (`Q_MCP_SERVER=enabled`). It is off by default.
- `langchain\tools.ts`: `toLangChainTools`, a LangChain view of the tool registry.
- Dependencies: `@modelcontextprotocol/sdk` 1.30.0 and `@langchain/core` 1.2.9.

**Elsewhere**

- LangGraph: `packages\q-orchestrator` (`StateGraph`, postgres checkpointer); migration `20260906150000_q_orchestration_checkpoints.sql`.
- There are no email, calendar or messaging connectors anywhere (no Resend/SMTP/Gmail/Calendar code).
- The only "web" connectors are the research providers in `packages\q-research\src\providers\`: Tavily, SerpAPI, Bright Data, cached, fallback, fake.

## E. Domain packages (all under `C:\Users\DELL\Desktop\q\packages\`)

- **network:** One canonical Company↔Investor Organisation relationship with an append-only event history (`network.relationships`, `network.relationship_events`).
  - Events: `discovered`, `interest_expressed`, `connection_accepted`, `interest_declined` (`src\domain\event-registry.ts`). Every event carries one of 8 visibility scopes; the interest events are `relationship_shared`.
  - `network.interests` (EXPRESSED/WITHDRAWN), `interest_responses` (ACCEPTED/DECLINED) and `matches` (ACTIVE/ENDED).
  - A deterministic relationship-state projector (`state-projector.ts`, worker `apps\workers\src\network\relationship-projection-handler.ts`). Its next-step vocabulary includes `SCHEDULE_MEETING`, but there is no meeting entity.
  - Service calls: `expressInterest`, `getOwnInterest`, `mayExpressInterest`, `listIncomingInterest`, `respondToInterest`, `mayRespondToInterest`.
  - No messaging, conversation threads or notifications.
- **verification:** `evidence.verification_claims` with claim types FOUNDER_IDENTITY, ORGANISATION and DOMAIN_CONTROL.
  - States: PENDING, VERIFIED, EXPIRED, REVOKED; the standing also has NOT_REQUESTED.
  - Methods: `SYNTHETIC_DEMO_ATTESTATION` (a worker decides deterministically, synthetic accounts and non-production only; `decide-synthetic.ts`, worker `verification/decide-handler`) and `OPERATOR_DECISION`.
  - `OPERATOR_DECISION` is reserved but there is no operator principal, route or UI. The `verification.decide` capability is granted to no role.
  - Service calls: `getCompanyVerification`, `requestCompanyVerification`. No review-queue UI.
- **media:** `media.media_assets`, owned by COMPANY only.
  - Purposes: FOUNDER_PITCH, COMPANY_PRODUCT_DEMO, OTHER (MEETING_RECORDING deliberately excluded).
  - Providers: Cloudflare Stream or UNASSIGNED. Playback policy PRIVATE/AUTHORISED/PUBLIC; moderation, caption and transcript states.
  - Pitch create/get/delete, resumable upload sessions, playback authorisation, webhooks.
  - Video only: no images, logos or avatars.
  - Document uploads are a separate path: evidence `document_upload_sessions` (`20260905180000`). On Railway the workers set `CQ_MALWARE_POLICY=REQUIRE_CLEAN`, so uploads are held and not parsed until a scanner exists.
- **gateq:** An investor's versioned inbound gateway policy (`gateq.gateways`, `gateway_versions`, `gateway_criteria`).
  - Calls: `createGateway`, `listGateways`, `getPolicy`, `createDraft`, `replaceDraft`, `publishVersion`, `qualifyCompany`, `publicGateway`.
  - Deterministic qualification against the policy. The gateway has an opaque, unguessable public id, not a slug.
- **gateq-intake:** A guest applicant's session and application (`gateq.applications`, `application_sessions`, `application_facts`, `application_submissions`, `application_documents`).
  - Calls: `start`, `resume`, `recordFacts`, `attachDocument`, `qualification`, `submit`. Includes an interviewer, throttling and session credential.
  - Open debt: guests can't use the Evidence pipeline (CQ-GATE-EVIDENCE-GUEST-001).
- **q-presence:** Reads the public web about a subject (COMPANY, PERSON, INVESTOR_ORGANISATION) on arrival and proposes understandings through the Knowledge Write Gate. Tracked in `q_knowledge.presence_builds`; worker `apps\workers\src\presence\*`. It owns no store of its own.
- **q-research:** A provider-neutral search-and-extract port, plus control over what text may leave in a query, URL safety, bounded excerpts, and public-vs-recorded comparison. Providers: Tavily, SerpAPI, Bright Data.
  - Investor public research: `research_public_web` accepts INVESTOR_ORGANISATION subjects (`apps\q-api\src\composition\research.ts:229`), and `find_prospective_investors` uses declared public profiles (ADR 0015).
- **investor-onboarding:** Definition v1 (I0–I12), interview cues and utterance aliases. Writes to Organisation, Investor Organisation, Representative, Mandate (stage/cheque, taxonomy preferences, exclusions, green flags, founder preferences) and Taxonomy. Includes mandate review and synthesis.
- **founder-onboarding:** Definitions v1 and v2 (F0–F8). Writes to Organisation, Company (with website normalisation), team facts, Capital Objective and Taxonomy. Includes document review, extraction, planner and suggestions.

**Cross-cutting**

- **Handles/slugs:** `identity.organisations.slug` and `core.companies.slug` exist, unique per tenant (`packages\companies\src\domain\slug.ts`, `packages\organisations\src\domain\slug.ts`). No route resolves them, and there are no person handles.
- **Public profile URLs:** none. `/company/[companyId]` needs a session and uses the UUID.
- **Visibility:**
  - `marketplace_visibility` on companies and investor organisations (organisation_private or network_visible).
  - `permissions.disclosure_policies`.
  - The 8-scope vocabulary appears on relationship events, artifacts and documents.
- **Not found anywhere:** reminders, notifications, meetings, direct messaging, brand settings (only the three deck themes), image generation.

## F. Relevant migrations (`C:\Users\DELL\Desktop\q\supabase\migrations\`)

| Area                                  | Migrations                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Profiles / identity                   | `20260902144606_identity_organisation_foundation.sql` (user_profiles, organisations with slug, memberships), `20260903120000_canonical_company.sql` (company slug, marketplace_visibility), `20260903150000_founder_team_domain.sql` (founder_profiles), `20260903180000_investor_organisation_domain.sql`, `20260903210000_investor_mandate_domain.sql` |
| Handles                               | Slug columns in the two migrations above; opaque public ids in `20261001090000_gateq_core.sql` and `20261002090000_gateq_applications.sql`                                                                                                                                                                                                               |
| Visibility                            | `20260904150000_disclosure_visibility_foundation.sql`, `20260923090000_investor_visibility.sql`                                                                                                                                                                                                                                                          |
| Verification                          | `20261007090000_verification_claims.sql`                                                                                                                                                                                                                                                                                                                 |
| Relationships / interest / connection | `20260904120000_relationship_foundation.sql`, `20261009140000_network_interests.sql`, `20261009160000_network_interest_responses.sql` (includes matches), `20261009170000_network_relationship_projection.sql`, `20260930090000_recommendation_interactions.sql`                                                                                         |
| Meetings                              | None                                                                                                                                                                                                                                                                                                                                                     |
| Messages / conversations              | Q chat only: `20260906120000_q_runtime_foundation.sql` (q_runtime.conversations, conversation_messages), `20260925090000_q_conversations_listing.sql`, `20261004090000_q_message_result_blocks.sql`, `20260925091000_q_memory_items.sql`                                                                                                                 |
| Notifications / reminders             | None; only `20260902190411_events_outbox_foundation.sql` (events.outbox)                                                                                                                                                                                                                                                                                 |
| Artifacts                             | `20261005090000_q_artifacts.sql`                                                                                                                                                                                                                                                                                                                         |
| Approvals                             | `20260908090000_q_actions_approvals.sql`                                                                                                                                                                                                                                                                                                                 |
| Media / documents                     | `20260906090000_media_domain.sql`, `20260905180000_document_upload.sql`, `20260905210000_document_processing.sql`, `20260905150000_evidence_foundation.sql`                                                                                                                                                                                              |
| Brand                                 | None                                                                                                                                                                                                                                                                                                                                                     |
| Audit                                 | `20260902213959_audit_infrastructure.sql` (audit.material_actions, audit.security_events)                                                                                                                                                                                                                                                                |
| Roles                                 | `20260902144826_identity_permissions_rls.sql`. Only `organisation_admin` and `organisation_member` roles exist; there is no platform operator or admin role                                                                                                                                                                                              |

## G. Model Gateway (`C:\Users\DELL\Desktop\q\packages\model-gateway\src\`)

- **Providers:** `providers\google.ts` (Gemini), `groq.ts`, `openai.ts`, `fake.ts`. Routing policies are in the `ai_ops` schema (several migrations; the latest is `20261008130000_ai_ops_openai_primary.sql`, making OpenAI primary).
- **Task classes** (`C:\Users\DELL\Desktop\q\packages\contracts\src\model\index.ts:36`): FAST_CLASSIFICATION, STRUCTURED_EXTRACTION, TAXONOMY_MAPPING, NORMAL_DIALOGUE, EVIDENCE_SYNTHESIS, COMPARISON, DEEP_INVESTIGATION, REALTIME_VOICE, GUARDRAIL, EMBEDDING.
- Output kinds are only TEXT and STRUCTURED. **There is no image generation task class or provider.**
- Embeddings run through a separate TEI runtime (`packages\q-embeddings`, `infra\embeddings`).

## H. Voice

- **Docs:** `C:\Users\DELL\Desktop\q\docs\modules\q-voice.md` and `docs\adr\0010-realtime-voice-through-a-speech-engine.md` (Accepted 2026-09-15).
- **Server** (`C:\Users\DELL\Desktop\q\apps\q-api\src\voice\`):
  - Providers: Deepgram Voice Agent (default when `DEEPGRAM_API_KEY` is set; Flux speech-to-text, Aura-2 text-to-speech) and ElevenLabs Speech Engine (`Q_VOICE_PROVIDER=elevenlabs`).
  - Routes: `/v1/q/voice/sessions`, `/speech` (TTS), `/think/chat/completions` (an OpenAI-style endpoint the provider calls), `/ws`, `/speak`.
  - Also: interview agent, turn handling, pronunciation, vocabulary, spoken profile edits.
- **Browser** (`C:\Users\DELL\Desktop\q\apps\web\src\features\voice\`): Deepgram and ElevenLabs session adapters, `voice-stage.tsx`, `voice-panel.tsx`, `use-q-speech.ts`; the `/api/q-speech` TTS relay.
- Live-audio acceptance items V3 and V4 are marked "DEFERRED TO DEPLOYED".

## I. Ledgers

**`C:\Users\DELL\Desktop\q\docs\execution\implementation-ledger.md`**

- **Verified:**
  - Waves 0–3 (FOUND, CON, SEC, DATA, AUTH, WEB-010/011, ORG, COMP, INV, CAP, NET-001, PERM, TAX, ONB, EVD, MEDIA-001)
  - Wave 4–5: CQ-Q-001..010, RAG-001..004, KNW-001..003, Q-020
  - The REC-001..009 recommendation series
  - PERM-ORG-VIEW-001, which was blocked and then marked CLOSED
  - GATE-001, GATE-002/002R, GATE-002S
  - QX-001
- **Partial:** CQ-Q-021, CQ-Q-022, C5-R1/R2A/R2B.
- **QX-002/003 (last entry, 2026-09-21):** A (first run) and C (structured results) are done. B (research-assisted onboarding) and D (artifact foundation) are marked NOT STARTED.
- **Stated next:** QX-002B, QX-003, then QX-004 Pitch Deck Studio.
- **Open debt:**
  - CQ-GATE-EVIDENCE-GUEST-001, DEV-WATCH-SCOPE-001, TEST-SSE-TEARDOWN-001, Q-BLOCKS-HISTORY-001
  - From the REC sweep (line ~2150): hosted migrations not applied, no scheduled slate rebuild, no "why am I seeing this" UI, cheque compatibility never computed, verification not implemented (at that time)
- **Stale:** git history shows QX-003/004 (artifacts, decks), VERIFY-001, MEDIA-011/012, NET-010/011/012, QACT-001/002, QX-005/007/008, Q-030, WEB-023/024 and UX-02/07 are committed. None of these has a ledger row.

**`C:\Users\DELL\Desktop\q\docs\acceptance\walkthrough-ledger.md`** (CQ-ACCEPT-001)

- Contains investor, founder, adversarial, feed and voice rounds, plus the C7 canonical checkpoint (feed → video → Save/Pass → company → Back), which PASSED.
- **Failures recorded:**
  - Interview commit issues on investor passes: J3, J8–J14, J18 (geography mismatch)
  - Founder F4: no uploader in the typed workspace
  - F10/F11: deck revision problems
  - F13: "make my company visible" created a deck instead
  - F14: Q claimed a website change was proposed, but no proposal existed
  - F15: no navigation from typed Home
  - R2, R6: interview wording and skip failures
- **Fixed:** several items, e.g. R7 and A5 (OpenAI streaming adapter).
- **Deferred:** voice V3/V4 need live audio on a deployed URL.
