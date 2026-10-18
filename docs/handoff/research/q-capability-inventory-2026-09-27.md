# Q capability inventory: 2026-09-27 (R20, R21, R33)

Every user-facing action in Capital Q, checked against what Q can do. The machine-checked copy is
`apps/q-api/test/route-capability-parity.test.ts`. Every API route call site in `apps/api` and
`apps/q-api`, and every web page, maps there to a capability id in
`packages/q-tools/src/capabilities.ts` or to an exemption with a reason. A new route or page with
neither fails CI.

**Approval classes**

- **INSTANT-R**: an instant read.
- **INSTANT-A**: an instant, reversible action on the person's own things. It happens at their
  word, through the same service or the page's own control.
- **P→A**: the change is prepared, then waits for the person's approval in the Approval Engine,
  which binds the exact payload and uses an idempotency key.
- **OFFER**: UI-only. Q offers the screen that has the control and takes the person there. It never
  claims it did the action.
- **EXEMPT**: not a person's action.

**Who** is the signed-in person acting for themselves. Every tool re-authorises as that actor: the
own-conversation scope plus the service's own checks.

Counts (pass 2, 2026-09-27):

- **API routes:** 151 call sites. 90 map to a capability, 61 are exempt with a reason (transport,
  webhooks, public surfaces, reference data, onboarding setup, file downloads, GateQ with no page).
  **0 backlog**; the parity test now fails on any backlog entry.
- **Web pages:** 25. 13 map to a capability, 12 are exempt.
- **Pass 1 tools (9):** `set_q_motion`, `set_voice`, `sign_out`, `save_company`, `unsave_company`,
  `pass_company`, `decline_pending_proposal`, `list_pending_approvals`, `list_my_documents`.
- **Pass 2 tools (10):** `open_page`; Prepare → Approve `propose_raise_change`,
  `propose_mandate_change`, `propose_team_change`, `propose_q_card_change`,
  `propose_investor_visibility`; reads `read_my_record`, `list_uploaded_documents`,
  `read_relationship_email`; instant `reassess_marketplace_readiness`.
- **New Approval Engine action types (6, lead-owned):** `capital.objective.change`,
  `investor.mandate.change`, `company.team.change`, `investor.representative.update`,
  `q_card.update`, `investor.visibility.set`.
- **Screens added (4):** Settings, Verification, Pitch & media, Investor interest.
- **OFFER entries (4):** Gmail connect/disconnect, pitch video, document upload, verification
  request.

## Navigation: every page

| Page                                                                     | Who                    | Class     | Q today                                                                                                         |
| ------------------------------------------------------------------------ | ---------------------- | --------- | --------------------------------------------------------------------------------------------------------------- |
| /home, /profile, /capital, /discover, /relationships                     | any member             | INSTANT-A | `navigate.*` (hand)                                                                                             |
| /company/visibility, /company/interest, /pitch, /verification            | a company's own people | INSTANT-A | `navigate.*` (hand), eligible only when a company is the subject (Interest, Pitch and Verification are **new**) |
| /settings                                                                | any                    | INSTANT-A | `navigate.SETTINGS` **new**                                                                                     |
| /company/[id], /relationships/company/[id], /relationships/investor/[id] | viewer with access     | INSTANT-A | `open_page` **new** (pass 2): client action; the page authorises the read                                       |
| /onboarding/founder, /onboarding/investor                                | new user               | n/a       | exempt: this is Q's own onboarding loop. Voice already has the INTERVIEW_* destinations.                        |
| /, /auth/_, /welcome, /u/[handle], /dev/_                                | n/a                    | EXEMPT    | signed-out, public or development pages                                                                         |

## Settings and session

| Action                     | Entry                                                   | Class            | Q today                                                                                 |
| -------------------------- | ------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------- |
| Theme light/dark/system    | ThemeToggle                                             | INSTANT-A        | `set_theme`                                                                             |
| Q motion full/calm/off     | QMotionToggle                                           | INSTANT-A        | `set_q_motion` **new**                                                                  |
| Q's voice female/male      | VoiceSetting                                            | INSTANT-A        | `set_voice` **new**                                                                     |
| Reload page                | browser                                                 | INSTANT-A        | `reload_page`                                                                           |
| Open own website           | n/a                                                     | INSTANT-A        | `open_website` (only their own site)                                                    |
| Sign out                   | SignOutButton → `signOutAction`                         | INSTANT-A        | `sign_out` **new**. Same server action as the button; ends this browser's session only. |
| Connect / disconnect Gmail | Settings → GmailConnection (`/v1/integrations/google*`) | OFFER → Settings | `offer.gmail_connect`. The OAuth consent happens in Google's own window.                |
| Notifications              | Settings shows "Coming soon"                            | n/a              | nothing to do yet                                                                       |
| Change password            | /auth/update-password                                   | EXEMPT           | A password never passes through Q.                                                      |

## Profile, handle, Q Card

| Action                                       | Route                                     | Class     | Q today                                                                     |
| -------------------------------------------- | ----------------------------------------- | --------- | --------------------------------------------------------------------------- |
| Edit own name/headline                       | PATCH /v1/me, /v1/me/profile              | P→A       | `propose_profile_change` (PERSON)                                           |
| Edit company profile                         | PATCH /v1/companies/:id                   | P→A       | `propose_profile_change` (COMPANY)                                          |
| Edit investor org profile                    | PATCH /v1/investors/:id                   | P→A       | `propose_profile_change` (INVESTOR_ORGANISATION)                            |
| Founder profile, team membership, team facts | /v1/companies/:id/team/*, founder-profile | P→A       | `propose_team_change` **new** → `company.team.change`                       |
| Investor representative record               | /v1/investors/:id/representative/me       | P→A       | `propose_team_change` (MY_INVESTOR_ROLE) → `investor.representative.update` |
| Claim handle / make Q Card                   | PUT /v1/…/card/handle                     | P→A       | `propose_handle_claim`                                                      |
| Read own Q Card                              | GET card                                  | INSTANT-R | `get_q_card`                                                                |
| Q Card details (indexable, contact fields)   | PATCH card                                | P→A       | `propose_q_card_change` **new** → `q_card.update`                           |
| vCard / QR                                   | on the Q Card screen                      | INSTANT-R | `get_q_card` + the card's own download                                      |

## Visibility and disclosure

| Action                            | Route                             | Class     | Q today                                                                |
| --------------------------------- | --------------------------------- | --------- | ---------------------------------------------------------------------- |
| Company discoverable or not       | POST /v1/companies/:id/visibility | P→A       | `hand.set_visibility`                                                  |
| Who sees the raise                | GET visibility state              | INSTANT-R | `get_disclosure_state`                                                 |
| Share raise / revoke              | POST shares, revoke               | P→A       | `propose_share_raise`, `propose_revoke_share`                          |
| Audience preview, network preview | GET preview routes                | INSTANT-R | `read_my_record` **new** (COMPANY_AUDIENCE_PREVIEW, *_NETWORK_PREVIEW) |
| Investor org visibility           | POST /v1/investors/:id/visibility | P→A       | `propose_investor_visibility` **new** → `investor.visibility.set`      |

## Capital and raise

| Action                                | Route                         | Class     | Q today                                                     |
| ------------------------------------- | ----------------------------- | --------- | ----------------------------------------------------------- |
| Read raise                            | GET capital-objectives        | INSTANT-R | `get_capital_objective`                                     |
| Create / edit / close / replace raise | POST/PATCH capital-objectives | P→A       | `propose_raise_change` **new** → `capital.objective.change` |

## Discovery

| Action                                       | Route                       | Class     | Q today                                                                                                                                                              |
| -------------------------------------------- | --------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Feed / what to look at                       | GET /v1/discovery/companies | INSTANT-R | `discovery_slate`                                                                                                                                                    |
| Prospective investors                        | GET /v1/discovery/investors | INSTANT-R | `find_prospective_investors`                                                                                                                                         |
| Why recommended                              | GET explanation             | INSTANT-R | `recommendation_explanation`                                                                                                                                         |
| Save / Unsave                                | POST save, unsave           | INSTANT-A | `save_company`, `unsave_company` **new**. They run through the same interaction service, with surface `Q_CONVERSATION`. The idempotency key is derived from the run. |
| Pass                                         | POST pass                   | INSTANT-A | `pass_company` **new**                                                                                                                                               |
| Saved list                                   | GET saved                   | INSTANT-R | `discovery_slate` (its decisions)                                                                                                                                    |
| Observations (impressions, watch milestones) | POST interactions           | EXEMPT    | reported by the feed, never asked for                                                                                                                                |

## Relationships, interest, email

| Action                             | Route                 | Class     | Q today                                                                |
| ---------------------------------- | --------------------- | --------- | ---------------------------------------------------------------------- |
| Express interest                   | POST express-interest | P→A       | `propose_express_interest`                                             |
| Answer interest (accept/decline)   | POST respond          | P→A       | `propose_interest_answer`                                              |
| Where we stand                     | GET relationship      | INSTANT-R | `get_relationship`                                                     |
| Incoming interest                  | GET incoming          | INSTANT-R | `list_incoming_interest`                                               |
| Relationship lists                 | GET relationships     | INSTANT-A | `navigate.RELATIONSHIPS`                                               |
| Email the other side               | Gmail send            | P→A       | `propose_email`                                                        |
| Read a relationship's email thread | GET relationship mail | INSTANT-R | `read_relationship_email` **new**: own mailbox, own relationships only |
| Chat (R34)                         | n/a                   | n/a       | owned by the CHAT worker                                               |

## Approvals

| Action                                      | Route               | Class             | Q today                                                                                                                 |
| ------------------------------------------- | ------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| List what waits for me                      | GET /v1/q/approvals | INSTANT-R         | `list_pending_approvals` **new**                                                                                        |
| Approve                                     | POST …/approve      | person's decision | `approve_pending_proposal`: the one waiting change in this conversation                                                 |
| Decline                                     | POST …/reject       | person's decision | `decline_pending_proposal` **new**: any waiting change of theirs in this conversation. It calls the engine's reject.    |
| Edit email draft words                      | POST …/email-draft  | EXEMPT            | This is the card's own edit. Asked of Q, Q prepares a new draft.                                                        |
| Approve something from another conversation | card                | person's decision | `approve_pending_proposal` / `decline_pending_proposal` with `approvalId` from `list_pending_approvals` (lead decision) |

## Documents and media

| Action                                                  | Route                      | Class                 | Q today                                                                                  |
| ------------------------------------------------------- | -------------------------- | --------------------- | ---------------------------------------------------------------------------------------- |
| Prepare deck / brief / one-pager / own mandate          | Q artifacts                | INSTANT (private doc) | `document.*` hands                                                                       |
| List my documents, versions                             | GET /v1/q/artifacts        | INSTANT-R             | `list_my_documents` **new**                                                              |
| Export PDF / PPTX, slides, a version                    | GET export/slides/versions | EXEMPT                | Downloads come from the document's card.                                                 |
| Revise a document                                       | n/a                        | INSTANT               | Covered by preparing again: a new version.                                               |
| Upload a document for Q                                 | upload sessions            | OFFER → Home          | `offer.document_upload` (file picker)                                                    |
| List / read uploaded evidence documents                 | GET /v1/documents          | INSTANT-R             | `list_uploaded_documents` **new**: metadata only; the plan must admit EVIDENCE_DOCUMENTS |
| Pitch video upload / replace / remove / playback policy | /v1/…/pitch media          | OFFER → Pitch         | `offer.pitch_video_upload` (file picker, direct to the CDN)                              |
| What's said in the pitch                                | GET transcript             | INSTANT-R             | `get_pitch_moment`                                                                       |
| Playback, captions, sync                                | player                     | EXEMPT                | the player's own signed playback                                                         |

## Records, verification, onboarding

| Action                                                | Route                      | Class                         | Q today                                                                                                                                              |
| ----------------------------------------------------- | -------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Company / mandate reads, search                       | GET companies, mandates    | INSTANT-R                     | `get_company`, `get_investor_mandate`, `search_companies`                                                                                            |
| Edit / activate mandate outside onboarding            | PATCH/POST mandates        | P→A                           | `propose_mandate_change` **new** → `investor.mandate.change` (create, update, activate, close). Constraints and sector preferences stay on the form. |
| Marketplace readiness read / re-assess                | GET/POST readiness         | INSTANT-R / INSTANT-A         | `read_my_record` (MARKETPLACE_READINESS), `reassess_marketplace_readiness` **new**                                                                   |
| Verification status                                   | GET verification           | INSTANT-R                     | `read_my_record` (VERIFICATION_STATUS)                                                                                                               |
| Ask for verification                                  | POST verification requests | OFFER → Verification          | `offer.verification_request`: an attestation the person submits                                                                                      |
| Profile findings (what Q found)                       | GET profile findings       | INSTANT-R                     | `read_my_record` (PROFILE_FINDINGS)                                                                                                                  |
| Onboarding answer / correct / skip / confirm / finish | /v1/onboarding/*           | INSTANT (ADR 0016 delegation) | `record_answers`, `correct_answer`, `set_aside`, `accept_recommendation`, `confirm_and_finish`, `get_onboarding_state`                               |
| Research public web                                   | n/a                        | INSTANT-R                     | `research_public_web`, `extract_public_web`, `lookup_public_profile`                                                                                 |

## Remaining

Nothing a person does is backlog. Limits, stated:

- The mandate's constraints and sector preferences are edited on the mandate form. Q offers the
  profile page for those.
- A verification request stays an OFFER, because it is an attestation the person submits.
- When more than `MODEL_TOOLS_MAX` (48) tools are eligible in one run, the executor keeps the first
  48 in registry order and logs the dropped ones, so the gateway never refuses the whole turn. Up to
  43 are eligible today before scope filtering. CHAT's tools will add to that count.
