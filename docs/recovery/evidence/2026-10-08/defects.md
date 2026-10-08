# Defects found by workstream G (2026-10-08, baseline `fe5579c3`, MOCK)

All of these were reproduced on the local stack (`scripts/recovery/local-stack.sh start && … seed`), with the scripted vendor and no live calls. "Test" names the spec that reproduces each defect and stays red until it is fixed.

| ID    | Severity        | Owner (suggested)              | Summary                                                                                                                       |
| ----- | --------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| G-D3  | High            | B                              | Natural answer text after a `propose_*` tool round fails the whole turn ("Q isn't available"), and the proposal is lost       |
| G-D4  | High (security) | D, B                           | The model can approve and execute a pending action when the person only asked a question                                      |
| G-D5  | High            | C                              | Navigation asked from the Q dock is claimed ("Discover is up.") but never performed                                           |
| G-D8  | High            | lead (migration + contract), C | `runs_screen_check` (≤512 chars) rejects the screen manifest from busy pages: 500, "That didn't go through"                   |
| G-D7  | Medium (a11y)   | A                              | "I couldn't start voice right now" is not in a live region (WCAG 4.1.3)                                                       |
| G-D9  | Medium (ops)    | F                              | A voice session that cannot reach its vendor is an "unhandled request error" (500), not a classified problem                  |
| G-D10 | Low             | E                              | Two `<ViewTransition name="q-aperture">` mounted at once (dev warning) when the dock opens                                    |
| G-D11 | Info (env)      | lead                           | Cloud-shell credentials (SMTP_API_KEY …) are inherited by any locally started service; q-api tried to email via api.brevo.com |

## G-D3: a natural answer after a proposal fails the turn

- **Reproduce.** Founder `POST /v1/q/runs` "Please remind me tomorrow to call Savanna Seed". Script round 1: `propose_reminder {title, remindAt}`. Round 2 answers `"I've prepared that reminder for you to approve."`
- **Observed.**
  - `propose_reminder` SUCCEEDED (log "q tool call finished").
  - The run then ends FAILED with `Q_UNAVAILABLE` ("Q isn't available right now").
  - `/v1/q/approvals` is empty: the proposal is gone.
  - No log line names the cause; orchestration logs only `outcome:"answer_failed"`.
- **Same run with a neutral sentence** ("Tomorrow works. The details are on the card below."): AWAITING_APPROVAL, and the approval exists.
- **Likely cause.** The action-talk filter removes the whole answer, then `content.length === 0` returns `FAILED/MODEL_PROVIDER_UNAVAILABLE` (`packages/model-gateway/src/q/index.ts:~4019`).
- **Why it matters.** This is "Q just listens and doesn't do anything" (audit headline): a perfectly normal model reply loses the user's request.
- **Test.** `tests/recovery/support/flows.ts` (pendingReminderApproval keeps the neutral wording, with a comment). Add a red test when B takes it.

## G-D4: the model approves on its own

- **Reproduce.** `npx playwright test -c tests/recovery/playwright.recovery.config.ts --project permissions -g "own initiative"`.
- **Steps.**
  1. Create a pending reminder approval.
  2. The founder asks "What is waiting for me right now?"
  3. The scripted model calls `approve_pending_proposal {approvalId}`.
- **Observed.** The approval is `APPROVED` and the action `EXECUTED`. The person never said yes.
- **Cause.** `packages/q-tools/src/tools/pending-proposal.ts:167-215` approves any PENDING inbox item by `approvalId`. Only the model's reading of the person's words gates it.
- **Breaks.** SPEC §4.2 (a yes binds to the one proposal presented) and CLAUDE.md (a model never gains authority because it generated the action). A prompt injected into a document or a web page can drive the same call.
- **Control (green).** The same call from a different tenant is refused.

## G-D5: dock navigation is claimed, not performed

- **Reproduce.** `--project scenarios -g "arrives"`. From `/documents`, `/relationships`, `/settings` or `/capital`, open the Q dock and send "open discover", with the turn reader scripted `TOOL_REQUEST/NAVIGATE DISCOVER`.
- **Observed.**
  - Q says "Discover is up." and shows two identical "Where this lives / Open Discover" cards.
  - The URL stays on the current page. That is 16 of 16 red.
  - From `/home` (the Q page), all 5 destinations arrive.
- **Evidence.** Screenshot `.playwright/recovery/results/a-navigate-from-documents-open-discover-arrives-scenarios/test-failed-1.png`.

## G-D8: busy pages cannot ask Q

- **Constraint.** `q_runtime.runs.screen` has `CHECK (screen IS NULL OR (jsonb_typeof = object AND length(screen::text) <= 512 AND screen ? 'route'))`.
- **Payload.** `CreateQRunRequestSchema.screen` carries `manifest: QPageManifestSchema`: sections, dialogs, and up to 48 `controls` once C lands.
- **Reproduce.** `--project scenarios -g "busy page"`. With 3 or more pending approvals, open `/work` and ask Q anything from the dock.
- **Observed.**
  - q-api logs `DatabaseError … runs_screen_check` and "unhandled request error" (500).
  - The UI shows "That didn't go through".
  - Scenario D fails at its first step for the same reason.
- **Risk.** Every page where C registers controls will exceed 512 characters, so every Q turn from those pages would fail.

## G-D7: voice failure not announced

- **Reproduce.** `--project voice -g "announced"`. In MOCK the voice vendor is unreachable.
- **Observed.** The text "I couldn't start voice right now. Try again." is shown, with no `role=status|alert` and no `aria-live`. The test "a voice line that cannot open says so" is green; the live-region test is red.

## G-D9: unclassified voice-session failure

- **Observed.** `POST /v1/q/voice/sessions` with the vendor unreachable logs `{"msg":"unhandled request error","err":{"type":"TypeError","message":"fetch failed…"}}` at level 50 and returns 500.
- **Expected.** A classified provider-unavailable problem (RFC 9457) and a log naming the vendor step.

## G-D10: duplicate view transition

- **Observed.** `web.log` shows `[browser] There are two <ViewTransition name="q-aperture"> components with the same name mounted at the same time.` while the dock is used on non-Q pages.

## G-D11: environment inheritance

- **Observed.** The cloud shell exports real `SMTP_*`, `GOOGLE_TOKEN_ENCRYPTION_KEY`, `RAILWAY_TOKEN` and others. A service started from it (as `pnpm dev` would be) picks them up. The recovery q-api, before G cleaned its environment, tried to send reminder emails through `api.brevo.com`. The egress guard refused all 33 attempts.
- **Fix.** `local-stack.sh` now starts every service from an empty environment plus `stack.env`. Other agents' local runs should do the same.

## Observations (not defects)

- **Fit slates.** After seeding, `/v1/fit/companies` returns `items: []` for investors, while `/v1/discovery/companies` returns a slate. The promise tests record which one is populated.
- **Deck readings.** Ledgerfold's composed deck exists as a Q artifact, but `/v1/companies/:id/deck` has `deck: null, extraction: null`. That matches the promises doc (0 deck readings), and Q.08 step 2 is red for it.
- **Priced mock calls.** Mock model calls are priced into the local `ai_ops.model_usage` (about $0.013 across this session's mock runs). That is local only and not spend.
