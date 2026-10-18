# Spec audit: MVP promises vs code, 2026-09-27

Monday definition-of-done item 10. Sources: doc 10 (MVP/V1 Release Definition) §2.1 demo story,
§3 foundations, §5 onboarding, §6 Q scope, §7-§10, §12, §13, §15 and §15.1; the product sources
(PADL, Product Specification, Final System Review) were skimmed for invariants only, since doc 10
is their MVP cut. Status comes from the code at `2c866df` (routes in `apps/web/app`, Q tools in
`packages/q-tools/src/capabilities.ts` and `tools/`, `supabase/migrations`) and from the deploy
lines in `docs/handoff/research/ledger.md`. LIVE means built and deployed (per the ledger). PARTLY
means part of the promise is built or it is built but not wired or deployed. MISSING means nothing
serves it. This audit read the code. It did not click through staging.

## Demo story and relationship loop (§2.1, §9, §15.1)

| #   | Promise                                                              | Status  | Evidence / gap                                                                                                                            |
| --- | -------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Founder signs up, picks role, option-led onboarding with save/resume | LIVE    | `/auth/sign-up`, `/onboarding/founder`, onboarding-conversation resume; `get_onboarding_state`                                            |
| 2   | Deck upload; Q extracts facts, asks only gaps, reviewable summary    | LIVE    | founder-onboarding extraction, F3 review, `read_my_record` PROFILE_FINDINGS; E3 completion merged                                         |
| 3   | Voice or text answers during onboarding                              | LIVE    | VN2/VN3 deployed (Deepgram/ElevenLabs behind adapters)                                                                                    |
| 4   | Pitch video upload, CDN playback, captions                           | LIVE    | `/pitch`, VID deployed 2fff276; pitch-player captions; 12 narrated seed videos (R19)                                                      |
| 5   | Marketplace eligibility; verification only near activation           | LIVE    | `reassess_marketplace_readiness`, `/verification`, R43 auto-verify live                                                                   |
| 6   | Investor mandate: stages, cheque, flags, discovery mode, summary     | LIVE    | `/onboarding/investor` steps (red-flags, mandate-review), `get_investor_mandate`, `propose_mandate_change`                                |
| 7   | Portfolio import or manual examples                                  | PARTLY  | Only optional prose in `narrative-step.tsx`. No structured portfolio examples feed ranking                                                |
| 8   | Vertical feed, fast first video, conservative preload, data saver    | LIVE    | Discover = home (cc8c5d5), `use-feed-budget.ts` honours `saveData`, cursor slates                                                         |
| 9   | Save / Pass optimistic, Pass frictionless, pass reason sampled       | LIVE    | discovery interactions (`pass_reason`), `save_company`/`pass_company` Q tools                                                             |
| 10  | "Why this" per investor                                              | LIVE    | feed-card reason codes; `recommendation_explanation`                                                                                      |
| 11  | Open profile / Ask Q from the feed without losing context            | LIVE    | Discover carries active pitch moment (fa2b57d); global Q `askAbout`                                                                       |
| 12  | "Five strongest fits": ranked cards with reasons and confidence      | LIVE    | `discovery_slate` + COMPANY_REFERENCE blocks; deterministic ranking (no LLM in path)                                                      |
| 13  | Compare 2-5 selected companies; absent stays absent                  | PARTLY  | Q COMPARISON block renders. **Built today:** tick 2-5 on Saved, then "Compare with Q" (849c9cd). There is still no compare page outside Q |
| 14  | Express interest (unilateral, server-confirmed)                      | LIVE    | `POST express-interest`, `propose_express_interest`                                                                                       |
| 15  | Q prepares introduction; human approval before send                  | LIVE    | `propose_email` (Gmail, BIZ-007), approval cards + approve by conversation (LIVE-A)                                                       |
| 16  | Founder accepts/declines; bilateral state                            | LIVE    | `/company/interest`, NET-011/012 projector, `propose_interest_answer`                                                                     |
| 17  | Minimal private thread after connection                              | LIVE    | R34 relationship chat (8dc6192). ADR 0019 is still PROPOSED                                                                               |
| 18  | Meeting request with purpose/times, external conferencing            | LIVE    | BIZ-008 Meet + reminders (2c97fea). Only the organiser's calendar is used                                                                 |
| 19  | Basic block / report                                                 | MISSING | No table, route or UI. Doc 10 §9/§10 calls messaging without it unsafe, and R34 chat is live                                              |
| 20  | Relationship events appended; state derived deterministically        | LIVE    | `relationship_events` + projector (NET-012)                                                                                               |

## Company intelligence and discovery (§7, §8)

| #   | Promise                                                     | Status | Evidence / gap                                                                                                      |
| --- | ----------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------- |
| 21  | Living Company Profile (pitch, snapshot, raise, team, cues) | LIVE   | `/company/[companyId]`, `/profile` (R25), company-deeper-view                                                       |
| 22  | Claims show self-reported vs supported/verified and recency | LIVE   | evidence-status labels in company-deeper-view; truth/evidence/lifecycle axes kept separate                          |
| 23  | Founder asks Q what is missing / how Q sees the company     | LIVE   | own-mandate/own-record notes, `read_my_record`                                                                      |
| 24  | Simple public / network / private visibility                | LIVE   | `/company/visibility`, `hand.set_visibility`; `network_visible` and `public_external` kept distinct (`/u/[handle]`) |
| 25  | Minimal gated document area ("only if needed")              | PARTLY | `list_uploaded_documents` (metadata) and evidence uploads exist. There is no gated data-room view (optional in §7)  |
| 26  | Search: basic structured filters plus Q discovery           | PARTLY | Q `search_companies` / `discovery_slate` work. Discover has no structured filter control                            |
| 27  | Cold start: onboarding profile drives first slate           | LIVE   | slates from mandate. Unknown never excludes (ADR 0020)                                                              |
| 28  | Web research with sources on tap                            | LIVE   | `research_public_web`. **Built today:** answer first, PUBLIC_SOURCE blocks under Sources (a88c5e9)                  |

## Q scope (§6, §15 "Q")

| #   | Promise                                                        | Status | Evidence / gap                                                                                                                                                           |
| --- | -------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 29  | Typed gateway/API with actor, tenant, context, objective       | LIVE   | `apps/q-api`, `@capital-q/contracts` q/\*                                                                                                                                |
| 30  | Context firewall before model context                          | LIVE   | `packages/q-firewall` (plan admits scopes before retrieval)                                                                                                              |
| 31  | Answers from authorised facts + evidence with provenance       | LIVE   | analyst v8, `citeAuthorisedFacts`, Sources disclosure (ADR 0018)                                                                                                         |
| 32  | Tools: read/search/compare/navigate/prepare intro              | LIVE   | ~48-64 tools. **Built today:** TURN_READER v13 names every navigate destination (60257a7), so Settings, Verification, Pitch and Company interest can be reached by voice |
| 33  | Text + realtime voice                                          | LIVE   | voice stage on `/home`                                                                                                                                                   |
| 34  | Every run traceable; golden evals (factuality/permission/tool) | PARTLY | `q_runs` / run events plus `packages/q-evals` exist. R20 live eval still open (CLOUD-START follow-ups); evals are not in CI gates                                        |
| 35  | Streamed text and high-level stages, no chain-of-thought       | LIVE   | stream events, neutral "Looking into it" stage (R38)                                                                                                                     |

## Trust, privacy, security (§3, §10, §15)

| #   | Promise                                                       | Status | Evidence / gap                                                                                                          |
| --- | ------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| 36  | Person ≠ Organisation ≠ Membership; one canonical company/org | LIVE   | organisations, companies, investors packages; UNIQUE relationship                                                       |
| 37  | RLS + grants tested, cross-tenant fails closed                | LIVE   | 1412 pgTAP pass at last deploy                                                                                          |
| 38  | Founder-private never reaches investor ranking or Q           | LIVE   | firewall + discovery disclosure checks; trust demo on `/company/visibility` ("who can see")                             |
| 39  | Audit of material Q/permission/relationship actions           | LIVE   | `packages/audit`, approvals bound to payload + idempotency                                                              |
| 40  | File ingestion: allowlist, size, scanning hook                | PARTLY | Allowlist and size limits are in place and `CQ_MALWARE_POLICY` exists. No scanner is attached on staging (founder item) |
| 41  | Rate limits, action throttles, abuse signals                  | PARTLY | Guest throttle, model-gateway limits and auth limits exist. The authenticated `/v1` API has no general rate limit       |
| 42  | Secrets server-side only; short-lived realtime creds          | LIVE   | voice tokens minted server-side; no service-role key in web                                                             |
| 43  | Sign-in                                                       | PARTLY | Email/password works (Brevo SMTP). Google sign-in fails with `redirect_uri_mismatch` (founder item)                     |

## Performance and instrumentation (§12, §13)

| #   | Promise                                                                   | Status | Evidence / gap                                                                                                              |
| --- | ------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| 44  | Precomputed slate, no synchronous LLM in feed, cursor pagination          | LIVE   | discovery slates reader                                                                                                     |
| 45  | Optimistic save/pass with rollback                                        | LIVE   | feed-state                                                                                                                  |
| 46  | Degraded Q/voice keeps browsing working                                   | LIVE   | truthful empty states (8dc6192)                                                                                             |
| 47  | Discovery events (impression, watch milestones, profile open, Ask Q)      | LIVE   | `ObservedInteractionTypeDtoSchema`                                                                                          |
| 48  | Named events `why_this_opened`, `q_evidence_opened`, `block_created` etc. | PARTLY | Covered by domain events, audit and run events. There is no analytics taxonomy for why-this, evidence opens or trust events |

## Counts

LIVE 38 · PARTLY 9 · MISSING 1 (48 rows). The PARTLY count includes #13, which is closer to
done after today's work.

## Ranked remaining work (Monday demo impact)

1. **#19 Block / report** (MISSING). Chat is live, so this is a trust gap a reviewer will ask about.
   Scope: additive migration `communication.participant_blocks` + `integrity_reports` (RLS, pgTAP
   positive/cross-tenant/revoked), a send-path check (a blocked party cannot message or express
   interest), two chat menu items, and an audit event. About 3-4h. It touches migrations and
   contracts, so the lead should own it.
2. **#43 Google sign-in** (founder: register the Supabase callback on the OAuth client). 5 minutes,
   but only the founder can do it.
3. **#40 Malware scanner** on staging (founder decision: provider or `ALLOW_UNSCANNED` for the
   demo). Chat uploads are blocked while the policy is REQUIRE_CLEAN with no scanner.
4. **#26 Discover filters** (stage/sector/country chips over the existing slate query). The slate API takes no
   filter parameters today, so this needs a contracts change as well as the UI. About 3h.
5. **#41 API rate limit** (`@fastify/rate-limit` keyed by user on `/v1` POSTs). About 1h plus a
   dependency review.
6. **#34 R20 live eval run** (needs lead approval for provider spend).
7. #7 structured portfolio examples, #25 gated document view, #48 analytics taxonomy: after Monday.
