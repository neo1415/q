# Onboarding end-to-end test plan, root causes and defects

Prepared 7 Nov 2026 (Claude, lane W5) on `qa/onboarding-e2e`, from integration `1bd1875f8` plus `994e147f5` (DECISIONS 77). Production is `64d51b965`.

**Basis.** This was found by reading the code. **No live run was made** (DECISIONS 76: prepare now, run once navigation is finished). Every claim names its `file:line` on this branch. The live runner is `scripts/handoff/live/onboarding-e2e.mjs`.

**Governing decisions:**

- DECISIONS 39–41, 48, 51, 53, 65, 76 and 77;
- CLAUDE.md: "Material Q-extracted facts require confirmation before becoming authoritative"; "Skip is allowed; unknown is a valid state";
- the Product Specification §4.4 (`docs/product-sources/text/Real_CAPITAL_Q_PRODUCT_SPECIFICATION.txt:509-528`).

**Owner direction (7 Nov):** almost everything here already exists, so do not rebuild. Find why it fails in practice and fix the smallest thing.

## 1. Status of each requirement

Key: **EXISTS** (where it is), **WORKS** (by reading), **FAILS** (with the root cause), **MISSING**.

| #   | Requirement (DECISIONS 77 / brief)                                  | Status                       | Where / root cause                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | A conversation, not a questionnaire                                 | EXISTS, WORKS (default path) | The checklist says "topics, not a script", and one line answers several steps (`apps/q-api/src/voice/onboarding-conversation.ts:1457`). The guided path (`CQ_ONBOARDING_VOICE_CONVERSATION=off`, `apps/q-api/src/main.ts:7529`) still uses fixed questions per step (`packages/onboarding/src/application/spoken-questions.ts:14`). Typed and voice turns run different engines (G1, §3).                                                                                                                                                                                                                                                                                                                                                                                                                          |
| R2a | Long rambling answer → professional summary, "Is that right?"       | EXISTS, FAILS on judgement   | Summarising is decided by step type plus word count, not by Q's judgement. Every `long_text`/`voice_text` answer over 30 words is held as Q's summary (`onboarding-port.ts:3628-3660`, `SHORT_ANSWER_WORDS=30` at `:5737`, `shortWholeLine` at `:2941`). The checklist marks these "(say back)" by type (`onboarding-conversation.ts:1439-1442`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| R2b | A clear or typed answer kept whole, filler removed                  | MISSING                      | A clear 31-word typed answer is always summarised. A rambling 25-word answer is saved verbatim, filler included. No code removes filler from a saved answer; the only FILLER list is `voice/live/heard.ts:15`, which detects empty requests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| R2c | Summaries confirmed before they become authoritative                | EXISTS, WORKS                | Held as a Q_RECOMMENDATION and written only on acceptance (`packages/onboarding/src/application/q-recommendations.ts:31-43`; `holdParaphrase` at `onboarding-port.ts:2980-3040`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| R2d | Agreement read by meaning (DECISIONS 40)                            | FAILS                        | Whether a read-back was agreed is partly decided by regexes over the person's words: PERMISSION, WITHHELD, YES and CHANGING, and over 12 words counts as UNCLEAR (`paraphrase-confirmation.ts:97-130`, used at `onboarding-port.ts:2960, 4671, 5378`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| R3a | Optional can be skipped                                             | EXISTS, WORKS                | Form: Skip → `skipStep`; the server refuses a required step with STEP_REQUIRED (`packages/onboarding/src/application/use-cases.ts:1704`). Chat/voice: a declined optional step is set aside (`onboarding-conversation.ts:600-620`; `onboarding-port.ts:5563-5570`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| R3b | Required re-asked **with the reason** (verification)                | FAILS (chat/voice)           | The guided path gives the reason (`use-cases.ts:2839, 3349-3354`, `whyQAsks`). The conversation path, which is the default, only lists "Needed: <topic>" (`onboarding-conversation.ts:1443-1445`). `whyQAsks` never reaches Q's checklist, so Q re-asks without saying why.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| R3c | Cannot complete without the required answers                        | EXISTS, CONFLICT             | `completeSession` throws REQUIRED_STEPS_INCOMPLETE (`use-cases.ts:1984-1985`; `runtime/path.ts:127-135`). But "I don't know" on a required step is recorded deliberately as the step's "Not sure yet" or the text "I don't know", and counts as complete (`onboarding-port.ts:5571-5634`; `runtime/validate-response.ts:40-45, 146-149`). That follows CLAUDE.md ("unknown is a valid state") and conflicts with DECISIONS 77. **Owner decision needed (D-OWN-1).**                                                                                                                                                                                                                                                                                                                                                |
| R3d | The required set, cited from the spec                               | EXISTS, CONFLICT             | Definitions: founder v8, investor v3 (`packages/founder-onboarding/src/definition/index.ts:79-84`, `investor-onboarding/src/definition/index.ts:45`).<br>• Founder required: F0.intent, F1.company_name, F1.stage, F3.review, F4.founder_role, F4.founder_count, F4.full_time, F4.team_size, F5.signal, F5.revenue_status, F6.raising, F6.currency, F6.target_amount, F6.confirm, F8.snapshot.<br>• Investor required: I0.investor_type, I0.organisation_name, I1.deployment_status, I1.mandate_context, I2.stages, I2.currency, I9.discovery_mode, I10.inbound_preference, I11.review, I12.handoff.<br>The spec's Stage 1 lists industry, geography and website, and Stage 2 makes the deck mandatory (`…SPECIFICATION.txt:509-528`); all four are **optional** in the code. **Owner decision needed (D-OWN-2).** |
| R4a | Research starts in parallel once name + company + website are known | EXISTS                       | The q-api conversation path, used for both journeys (`voice/investor-research.ts`, composed at `main.ts:7240-7311`). It triggers on opening with the sign-up organisation, and after each save once the company/firm name and website are answered (`onboarding-conversation.ts:267-286, 800, 1553-1570`). Fire-and-forget (`investor-research.ts:586`). A second path runs in the worker on the name commit (`apps/workers/src/presence/dispatch.ts:149-260`).                                                                                                                                                                                                                                                                                                                                                    |
| R4b | Website normalised ("acme dot com", no scheme, www)                 | PARTLY                       | Form: `normaliseWebsite` adds the scheme, keeps www and rejects "acme dot com" (`packages/onboarding/src/application/website.ts:19-42`). Chat/voice: `spokenUrl` maps "dot", strips www and lowercases (`voice/interview-steps.ts:914-925`). The two channels store different forms of the same site.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| R4c | Findings presented for confirmation, never authoritative            | EXISTS, WORKS                | Held as a Q_RECOMMENDATION (`investor-research.ts:437-465`). The checklist shows "not confirmed yet; Q found: …" (`onboarding-conversation.ts:1436`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| R4d | It actually finds things for a real company                         | FAILS                        | Root causes RC1–RC5 in §2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| R4e | Nothing found → carry on quietly                                    | WORKS (too well)             | Failures are also silent and indistinguishable from "nothing found" (RC2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| R5  | Chat↔voice mid-interview: same context, no re-greeting              | FAILS (chat→voice)           | P0-1 in §3. Voice→chat keeps the context: a chat turn reads the server thread (`interview-agent.ts:1123`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| R6  | Form path, continue later, resume                                   | EXISTS, mostly WORKS         | The server cursor is the source of truth: `current_step_key` (`packages/onboarding/src/infrastructure/postgres-session-repository.ts:72`), `GET /v1/onboarding/sessions/current` (`apps/api/src/http/onboarding.ts:145`) and `resumeOpening` (`apps/q-api/src/voice/onboarding-conductor.ts:1000-1138`). Defects P1-7 and P2-1 (P1-6 withdrawn).                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| R7  | Q edits the profile after onboarding                                | EXISTS, PARTLY               | Investor: `change_my_mandate` (`packages/app-actions/src/actions/mandate.ts:453-620`, CONSEQUENTIAL), `propose_profile_answer_change` (`packages/q-tools/src/tools/record-changes.ts:143-179`, CONFIRM_REQUIRED) and `update_investor_profile` (`records.ts:856`). Founder: `update_company_profile` (`records.ts:593`), `change_my_raise` (`capital.ts:630`) and `propose_profile_answer_change`. Gaps: P1-8 and P2-4.                                                                                                                                                                                                                                                                                                                                                                                            |

## 2. Why research "keeps not working": root causes, strongest evidence first

- **RC1. It never runs in any test.**
  - Every `@fictional.capitalq.local` account is skipped before searching: `isFictionalAccount` at `main.ts:7203-7216`, which returns NOTHING_FOUND at `investor-research.ts:475-486`; the worker does the same at `dispatch.ts:197-205`. The skip is right, because the open web can only return real namesakes.
  - But the live harness may only use those accounts (`scripts/handoff/live/fictional-session.mjs:28`), and the unit tests use stubs that return the shapes the code expects. HANDOFF-LOG (30 Oct) notes the same pattern: "Why fixes keep passing tests and failing live".
  - There is no recorded-fixture case for onboarding research. The research-acceptance cases A–G (`apps/q-api/test/research-acceptance`) cover deep research only, and DECISIONS 48 asks for one.
- **RC2. Failures look like "nothing found".**
  - A rejected search is logged, but a non-OK search status (PROVIDER_UNAVAILABLE, NO_PUBLIC_IDENTITY, refused key or spent credit) is skipped with no log: `if (outcome.value.status !== "OK") continue;` (`apps/q-api/src/composition/presence.ts:156`).
  - `investor-research.ts:498-501` then sets NOTHING_FOUND with no reason, and the reader's catch returns null/[] (`composition/investor-research.ts:135-140, 437-446`).
  - On 30 Oct every search provider was refusing (HANDOFF-LOG, "Outage"), and onboarding said nothing about it, by design (DECISIONS 77: "don't mention a failure"). Logs must say it even when the person isn't told.
- **RC3. It rarely reads real page content.**
  - Onboarding reads are not marked `planned`, so each page gets the 3 s extract budget, not the planned 8 s (`packages/q-research/src/application/research-service.ts:339, 348, 934-935`; `presence.ts:104-117` passes no `planned`).
  - The company's own website is only a search term (`${name} ${websiteUrl}`, `presence.ts:86-88`), never fetched directly, and a young company's site is often not indexed.
- **RC4. The worker path is misconfigured.**
  - It sends `SERP_API_KEY` to the SerpApi adapter (`apps/workers/src/presence/composition.ts:437-443`). q-api already found that this key is a Serper.dev key and uses `createDetectingSerpProvider` (`apps/q-api/src/composition/research.ts:344-355`). The worker's search therefore fails authentication every time and falls back to whatever remains.
  - It researches once: only the name commit triggers it (`dispatch.ts:66-78`), and NOTHING_FOUND blocks a rebuild for 14 days (`packages/q-presence/src/contracts.ts:210`). A website given after the name never re-triggers it.
- **RC5. The q-api path is not durable.**
  - Research state is a per-process `Map` (`investor-research.ts:428`) started with `void run(...)`. It is lost on deploy or restart and not shared across replicas.
  - A person whose next turn lands on another replica, or after a deploy, never hears the findings. Findings already held as recommendations survive in the DB; an in-flight run does not.

## 3. Defects, ranked

Each **P0** gets a negative test that fails first, on `fix/onboarding`.

### P0: breaks an owner requirement on the main path

- **P0-1 Chat→voice re-greets mid-interview.**
  - `apps/q-api/src/voice/routes.ts:880-906`: the onboarding branch composes `firstMessage` through `onboardingConversation.opening()` with no `!resume` guard. The rehearsal (`:842`) and welcome (`:860`) branches have one.
  - `openingOf` then returns "Welcome back, <name>. I've kept everything from last time…" whenever the thread has a PERSON turn. With no person turn yet, it returns the full "Hi <name>, I'm Q…" introduction (`onboarding-conversation.ts:1497-1545`).
  - The client prefers the server's line over the question already on screen (`apps/web/src/features/voice/use-voice-interview.ts:702-705`). Its own comment says "on a resumed thread it composes none", so the server breaks the client's contract.
  - When the client sends no `resume` (the on-screen question doesn't match the prompt, `q-onboarding-workspace.tsx:1786-1796`), the server greets mid-session too.
  - Test blind spot: `apps/q-api/test/q-voice.test.ts:483-493` asserts no welcome on resume, but its app doesn't wire `onboardingConversation`; production does by default (`main.ts:7527`).
- **P0-2 Required steps re-asked without the reason** (DECISIONS 77) in the default conversation path (`onboarding-conversation.ts:1443-1445`). `whyQAsks` exists per step but never reaches Q's checklist.
- **P0-3 Research failures are invisible** (RC2). A non-OK provider status is dropped with no log, so "nothing found" and "every provider refused" can't be told apart in production.
- **P0-4 Worker research uses the wrong vendor for `SERP_API_KEY`** (RC4, `apps/workers/src/presence/composition.ts:437-443`).

### P1: wrong, or not as specified, but there is a workaround or an owner call is needed

- **P1-1 Summarise-or-keep is a 30-word rule, not Q's judgement** (R2a/R2b). The fix touches prompts and needs a model eval. DECISIONS 73 forbids trimming, not better instructions. Proposed: let the reader judge "rambling vs clear" and keep a clear answer whole, filler removed; measure with recorded transcripts (Anthropic, small).
- **P1-2 Read-back agreement by regex** over people's words (`paraphrase-confirmation.ts:97-130`), against DECISIONS 40.
- **P1-3 A website given after the name never re-triggers research**, in both the worker and the q-api trigger order (RC4). Research also starts on the sign-up organisation alone.
- **P1-4 Research runs are not durable** (RC5). It should be an idempotent job. This is a larger change; propose after P0.
- **P1-5 Onboarding research reads too little** (RC3): a 3 s extract budget, and the own website is never fetched.
- ~~**P1-6 Founder finish fails silently.**~~ **Withdrawn after checking (7 Nov):** a failed `complete()` sets the controller's error message (`apps/web/src/features/onboarding-kit/controller.ts:233-275`), and once the loop ends that shows as "Couldn't save" with Try again (`founder-onboarding-screen.tsx:350-366`). Not a defect. The investor finish makes one try (`investor-onboarding-screen.tsx:361-370`), which is a lesser retry than the founder's, not silence.
- **P1-7 Investor review link does nothing new.** `/profile` links to `/onboarding/investor?review=1` (`apps/web/src/features/profile/own-profile-view.tsx:449`), and the investor page ignores `review`. Founder `?review=1` calls `openStep("review")` on a complete session (`founder-onboarding-screen.tsx:154-164`); `goBack` needs an active session (`use-cases.ts:1915`), so it likely errors.
- **P1-8 Q's mandate edit doesn't show on /profile.** The investor `/profile` "Investment mandate" reads only onboarding answers (`own-profile-view.tsx:291-300`, `profile-data.ts:180`). A `change_my_mandate` edit shows on `/capital` (`data-mandate-summary`) but not there. Founders get a raise overlay; investors have none.
- **P1-9 Website stored differently by form and chat** (R4b). The form rejects a spoken "acme dot com".
- **P1-10 The voice opening line is never kept** to `interview_turns` (routes.ts composes it; nothing calls `keep()`), unlike the conductor (`onboarding-conductor.ts:1107, 1223`). Back in chat, `lastAskedStep` may point at an older line. To be verified live.
- **P1-11 Typed and voice turns run different engines** (`typedOnboarding` vs `interviewLoop` vs transcript reading; G1). It is the root of channel-specific behaviour.
- **D-OWN-1** "I don't know" completes a required step (R3c): CLAUDE.md and DECISIONS 77 disagree.
- **D-OWN-2** The spec's mandatory fields (industry, geography, website, deck) are optional in the definitions (R3d).
- **D-OWN-3** A figure or choice the person stated verbatim is written at once (`onboarding-port.ts:3800-3825`, `use-cases.ts:703-725`). It is their own claim (USER_CLAIM), not a Q extraction; CLAUDE.md is satisfied only if "stated in their words" counts as confirmation. Confirm the reading.

### P2: polish, consistency, or later

- **P2-1** The investor FORM "Continue later" goes to `/home`, but the conversation goes to `/discover`. `OnboardingShell` renders `<ContinueLater />` with no destination (`apps/web/src/features/onboarding-kit/components/onboarding-shell.tsx:100`).
- **P2-2** After 30 minutes away, the client's "Welcome back." can sit next to the server's "Picking up where we left off." (`conversation.ts:628` with `onboarding-conductor.ts:343`).
- **P2-3** Stale selectors:
  - `scripts/handoff/live/onboard-adaptive.mjs` and `persona-run.mjs` click "Continue as founder" and `/^Type$/`, which are gone. They are guarded by `isVisible`, so they skip silently.
  - `tests/e2e/onboarding-*.spec.ts` click "Set up as a founder/investor", which exists only on the visibility screen.
- **P2-4** Q can't edit the founder's target market geography (only HQ; `founder-v1.ts:172-177`), the investor's `I1.mandate_context` or `I10.inbound_preference`, or any answer before setup is complete.
- **P2-5** A prepared Q change is held in an in-process `Map` (`apps/q-api/src/composition/record-change-actions.ts:1032`).
- **P2-6** Onboarding server actions `parse` outside `run()` (`apps/web/src/features/onboarding-kit/api-actions.ts:229, 257, 291`), so bad input throws instead of returning an ActionResult.
- **P2-7** Untranslated legends (`capital-objective-step.tsx:94, 133-163`). Comments contradict the code (`q/context.ts:470-473`, `welcome-screen.tsx:97`, the layout's "Save & leave").

## 4. Journeys and steps (for `onboarding-e2e.mjs`)

**Accounts.**

- A fresh fictional account per run: `e2e-<journey>-<UTC stamp>-<rand>@fictional.capitalq.local`, created as `mkuser.mjs` does (Supabase admin API; `SB_URL`/`SB_KEY` from env, never printed).
- Company and firm names are invented and marked "(fictional)", never a real company.
- Two viewports, 1440×900 and 390×844, with a screenshot per step into `OUT`.
- Q's last question is read from `onboarding.interview_turns` with a read-only query, as `persona-run.mjs` does.

**Few Q turns.** Each journey uses dense answers (one line answers several topics), so it takes about 6–10 turns.

| J   | Journey (founder F / investor I)             | Steps and expected result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Code path                                                                                                              |
| --- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| J1  | Chat interview (F, I)                        | 1. Sign in → `/welcome` → `[data-q-welcome-type]` → persona `[data-persona]` → `/onboarding/<j>`.<br>2. Q opens with one greeting: exactly one "I'm Q" line in `interview_turns`.<br>3. One dense line answers several topics; Q doesn't ask any of them again (a step-key repeat check over Q's lines).<br>4. A conversational question, not a form label.                                                                                                                                                                              | `welcome-screen.tsx:97-192`; `q-onboarding-workspace.tsx:794-906, 1107`; `onboarding-conductor.ts:1158, 1251`          |
| J2  | Long answers (F)                             | 1. A ~80-word rambling spoken-style description → Q says back a short professional summary and asks "is that right?". Nothing is saved until the yes (no F1.description response before it).<br>2. A clear 35-word typed description → **expected by DECISIONS 77: kept whole**. Today it is summarised (P1-1), so it is recorded as a known failure, not a pass.                                                                                                                                                                        | `onboarding-port.ts:2941, 3628-3660`                                                                                   |
| J3  | Required vs optional (F)                     | 1. "Skip the website" → set aside, not asked again.<br>2. "I'd rather not say how many people" (F4.team_size, required) → asked again **with the reason** (P0-2).<br>3. "Continue later" → leaves; `/home` shows "Finish setup with Q".<br>4. Completing with a required step open → refused.                                                                                                                                                                                                                                            | `onboarding-conversation.ts:600-620, 1443`; `use-cases.ts:1984`                                                        |
| J4  | Chat → voice → chat (F, I)                   | 1. Mid-interview, open voice over HTTP (`POST /v1/q/voice/sessions` with `onboarding:{sessionId, journeyType}` and `resume:true`, as `talkWithQ` sends it). The first line has **no** "welcome", "I'm Q" or "Hi <name>" (P0-1) and continues with the open question.<br>2. Two voice turns through the think endpoint (as `voice-http.mjs` does). Q doesn't ask a topic already answered in chat.<br>3. Back to chat (reload): the thread shows the voice turns (`channel=VOICE`); the next question isn't a repeat; no second greeting. | `routes.ts:690, 880-906`; `use-voice-interview.ts:702`; `think.ts:143`; `turn.ts:1787-1821`; `interview-agent.ts:1123` |
| J5  | Continue later and resume (F, I, both paths) | 1. Conversation: `[data-continue-later]` → founder `/home`, investor `/discover`. Return through `/onboarding/<j>?from=home` → "Picking up where we left off." plus the same open question; no new greeting.<br>2. Form: "Use the form" (`[data-use-the-form]`) → answer one step → Continue later → return → the same step is shown, with the earlier answer kept (`data-save-status=saved`).<br>3. Investor form destination (P2-1).                                                                                                   | `continue-later.tsx:86-182`; `last-mode.ts:50-59`; `onboarding-conductor.ts:1000-1138`; `use-cases.ts:1128`            |
| J6  | Finish (F, I)                                | Founder: snapshot confirm → `/verification?from=setup&next=profile`. Investor: `/verification?from=setup&next=discover`. If finishing fails, a visible message (it exists; P1-6 withdrawn).                                                                                                                                                                                                                                                                                                                                              | `founder-onboarding-screen.tsx:383-400`; `investor-onboarding-screen.tsx:361-370`                                      |
| J7  | Q edits the profile (I)                      | From Home's Q:<br>1. "Change my cheque size to $250k–$1M and add Kenya to my geography."<br>2. Expect an approval card, not an instant write: `change_my_mandate` is CONSEQUENTIAL, `propose_profile_answer_change` is CONFIRM_REQUIRED.<br>3. Approve → `/capital` `[data-mandate-summary]` shows the new range; `/profile` mandate (P1-8, known).<br>4. "Rewrite my description as …" → `update_investor_profile` approval → `/profile` "In your words".                                                                               | `mandate.ts:453-620`; `record-changes.ts:143-179`; `records.ts:856`; `capital/mandate-summary.tsx:136-234`             |
| J8  | Q edits the profile (F)                      | 1. "Change our description to …", "We're based in Accra now", "Raise is $3M on a SAFE".<br>2. Each → an approval card → `/profile` `[data-profile-section="about"]`, "Your company" and `/capital` "Your raise".<br>3. A Q-extracted fact from a document stays a suggestion ("Confirm" / "Not right") until confirmed.                                                                                                                                                                                                                  | `records.ts:593`; `capital.ts:630`; `coverage-overview.tsx:212-221`                                                    |
| J9  | Research (fixtures only)                     | Not live on fictional accounts (RC1). Covered by a recorded-fixture test of the onboarding research path: a found case → a held suggestion said for confirmation; a provider refusal → logged, nothing said to the person; nothing found → silent. A live probe needs the integration owner's approval (paid search).                                                                                                                                                                                                                    | `investor-research.ts:470-501`; `presence.ts:104-160`                                                                  |

**What the runner asserts automatically:**

- one greeting per session;
- no Q question that names a step already ANSWERED;
- no "Welcome back" or "I'm Q" Q line after the first PERSON turn on a switch;
- the destination URLs;
- `data-save-status=saved` survives a return;
- approval cards appear for edits.

What it records for a person to judge: the wording of the summary read-back and of the reason on a re-asked required step.

## 5. Order of fixes (`fix/onboarding`)

1. P0-1, with a failing-first q-api test that wires `onboardingConversation`.
2. P0-2: the reason on required steps in Q's checklist, with a failing-first test of the checklist line.
3. P0-3: log the non-OK research status with its reason; keep the person-facing silence.
4. P0-4: the worker uses the detecting SERP provider, with a failing-first composition test.
5. Then P2-1 and P1-7, which are small web fixes. P1-1 and P1-2 need prompt work and an eval; P1-3, P1-4 and P1-5 need a design note. Each owner item (D-OWN-1..3) waits for a decision.

## 6. Fix status (`fix/onboarding`, from `994e147f5`)

Each fix has a test that fails before it and passes after.

| Item | Status    | Commit and test                                                                                                                                                                                                                                          |
| ---- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-1 | FIXED     | Every onboarding voice opening goes through the conductor (introduction only on an empty thread, and kept; otherwise resume). This also closes P1-10. Test: `apps/q-api/test/q-voice.test.ts` "switching chat → voice mid-interview never greets again". |
| P0-2 | FIXED     | Q's checklist (typed and voice) says why a needed topic is required and that it can wait. Test: `apps/q-api/test/onboarding-conversation.test.ts` "…asked again with the reason".                                                                        |
| P0-3 | FIXED     | Non-OK research statuses are logged with their failure class; the person still hears nothing. Test: `apps/q-api/test/presence-read-failures.test.ts`.                                                                                                    |
| P0-4 | FIXED     | The worker uses the detecting SERP provider. Test: `apps/workers/test/presence-research-vendor.test.ts`.                                                                                                                                                 |
| P2-1 | FIXED     | The investor form's Continue later goes to `/discover`. Test: `apps/web/test/continue-later.test.tsx`.                                                                                                                                                   |
| P1-6 | WITHDRAWN | Not a defect (see §3).                                                                                                                                                                                                                                   |

## 7. Research design (P1-3/4/5)

Written and implemented on `fix/onboarding-research` (from `e67014d79`). Built from what exists; no new provider, no new engine.

**What exists.** Research already has a durable trigger.

- `onboarding.response.committed` is written to the transactional outbox for every saved answer, typed, voice or form.
- The worker's domain-event consumer hands it to the presence dispatch (`apps/workers/src/presence/dispatch.ts`). The dispatch builds through `presence.build`, whose DB build log is already the cross-process guard: a build RUNNING is not started twice, and one done inside the refresh window is not repeated.
- Findings become pending ONBOARDING suggestions (`presenceCandidates`), which Q's checklist already reads as "not confirmed yet; Q found … (from a public page, not verified)" (`onboarding-port.ts` coverage proposals, source `PUBLIC_RESEARCH`). Nothing on that path depends on process memory.

What was missing:

- the read ran detached inside the consumer (`void`), so a deploy mid-read lost it;
- it ran once, on the name only;
- it never read the company's own site;
- it cut pages to a turn's 3 s budget.

**P1-4 Durable, idempotent job.**

- The consumer now only **enqueues** `presence.onboarding.research` v1 (`packages/q-presence/src/jobs.ts`, identifiers only), for a company or firm name, or a founder's website. It returns at once, so no other domain event waits on a web read. A queue refusal retries the event.
- A dedicated runner works the queue `presence-research` (`apps/workers/src/main.ts`):
  - visibility timeout 120 s; a build is bounded at 45 s by an `AbortSignal`;
  - 6 attempts with exponential backoff;
  - a dead letter, `presence-research-dead`.
- A deploy mid-read leaves the message to be delivered again, and the build log makes the redelivery idempotent.
- Only `BUILD_IN_PROGRESS` is retried: the same subject's build is still running, and this job's identity (a website given since) must still be read. A failed read is never retried, because its searches are paid. It is logged, never said (DECISIONS 77).
- **Migration `20261231430000_presence_research_queue.sql`:** the two pgmq queues, with browser roles locked out; pgTAP `430_presence_research_queue`. Additive. Not applied.

**P1-3 A website given late re-triggers.**

- `F1.website` is now a trigger step. Its job reads the company name from the current answers and builds with `force: true`.
  - A new website is a new identity. The 14-day `PRESENCE_REFRESH_AFTER_MS` skip would otherwise have kept it unread after a name-only build.
  - A build still running is never overtaken: the job retries until that build ends.
- A website before the name waits for the name's own job, which reads it.
- The q-api conversation trigger already re-runs on a new website, because its identity key includes the domain.

**P1-5 The company's own site, within the budget.**

- Both read ports, q-api `composition/presence.ts` and the worker's `createWorkerPresenceReadPort`, now read the website the person gave **directly**: `research.extract` with `personNamed`, bounded at `PLANNED_EXTRACT_BUDGET_MS` (8 s). This runs in parallel with the searches.
- The searches run as planned jobs: the 8 s page budget instead of 3 s, and at most 2 searches each. Nobody waits on them.
- Every non-OK status, for a search or a page read, is logged with its failure class.

**Not moved: the q-api in-session fast path** (`voice/investor-research.ts`, an in-process Map with `void run`).

- It reads more fields than the worker maps (website, description, country, stage, categories and team size, against the worker's description and role/mandate context). Retiring it would trade capability away (DECISIONS 73).
- It stays as the fast path within a session. The worker job is the durable floor: if q-api restarts mid-read, the worker's suggestions still reach the checklist.
- **Known cost:** both paths can read the same company, as they already did before this change.
- **Size of unifying them:** move `founder-research.ts` / `validateFounderReading` into a package the worker can use, and map their findings through `presenceCandidates`. That is about a day's work. It is not done here.

**Tests (failing first where behaviour changed):**

- `apps/workers/test/presence-dispatch.test.ts`: website re-trigger, awaited and bounded, RETRY only on IN_PROGRESS, failures DONE.
- `apps/workers/test/presence-research-job.test.ts`: enqueue only, a refused enqueue retries the event, and the job runner's outcomes.
- `apps/workers/test/presence-read-port.test.ts` and `apps/q-api/test/presence-read-failures.test.ts`: own-site read, planned budget, failure logging.
- `apps/workers/test/onboarding-research-replay.test.ts` (DECISIONS 48): synthetic recorded pages replayed through the real research service, read port, presence build and dispatch, in three cases: found, refused and nothing.

## 8. Proposed mandatory set (D-OWN-2, DECISIONS 78), for the owner's approval

**Status: proposed, not enforced.**

**The rule:** mandatory = what the profile needs, plus what creating the investor's mandate needs, plus what founder matching and verification need. Everything else is optional and kept as context for Q. "I don't know" to a mandatory question is recorded as unknown and counts as answered (D-OWN-1).

Two facts shape the list:

1. Activating a mandate needs no content: it checks only the status and version (`packages/investors/src/application/mandate-use-cases.ts:795-806`). So matching decides most of the investor's list.
2. The profile minimum already exists in code: name, description, stage and country (`packages/companies/src/domain/marketplace-readiness.ts:143-151`).

Short names used below:

- SPEC = `docs/product-sources/text/Real_CAPITAL_Q_PRODUCT_SPECIFICATION.txt`
- D17 = `docs/architecture/17_*.md`
- D19 = `docs/architecture/19_*.md`

### Founder (definition v8): proposed mandatory

| Step                                                     | Why / feature (code)                                                                                                                                                                                                                        | Spec                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| F1.company_name                                          | Profile: creates the company (`founder-onboarding/src/integration/write-targets.ts:622`), readiness name. Verification: KYB name (`verification/src/application/auto-request.ts:246,276`).                                                  | SPEC:514; D17:729            |
| F1.website **(optional today)**                          | Verification: email-domain match (`auto-request.ts:248,258-277`). DECISIONS 77 research needs it.                                                                                                                                           | SPEC:518 (D17:730: optional) |
| F1.country **(optional today)**                          | Profile: readiness (`marketplace-readiness.ts:149`). Matching: geography exclusion and fit (`discovery/src/eligibility/policy.ts:535-537`, `discovery/src/features/policy.ts:434-480`). Verification: jurisdiction (`auto-request.ts:250`). | SPEC:516; D17:731; D19 §13   |
| F1.stage                                                 | Profile: readiness. Matching: stage exclusion, stage fit and candidate search (`eligibility/policy.ts:526-528`, `features/policy.ts:400-430`, `candidates/service.ts:159-195`). "Not sure" exists.                                          | SPEC:517; D17:732; D19 §23   |
| F1.description **(optional today)**                      | Profile: readiness description (`marketplace-readiness.ts:146-147`).                                                                                                                                                                        | SPEC:519; D17:733            |
| F1.categories **(optional today)**                       | Matching: taxonomy fit, candidates and sector exclusion (`features/policy.ts:550`, `candidates/service.ts:211,260`, `eligibility/policy.ts:523`).                                                                                           | SPEC:515; D19 §23            |
| F4.founder_role                                          | Verification: membership and the founder identity claim (`write-targets.ts:680-700`, `auto-request.ts:118-126`).                                                                                                                            | SPEC:527                     |
| F6.raising                                               | Matching: gates the raise questions (`founder-v1.ts:322-326`).                                                                                                                                                                              | D19 §13                      |
| F6.currency, F6.target_amount, F6.confirm (when raising) | Matching: the capital objective gives the round target for cheque fit (`write-targets.ts:502-525,759`; `features/policy.ts:635-651`).                                                                                                       | D19 §13, §23                 |
| F8.snapshot                                              | Verification: a completed session triggers the automatic KYB request (`auto-request.ts:108-110`).                                                                                                                                           | DECISIONS 77                 |

- **Becomes optional:**
  - F0.intent: writes nothing; F6.raising carries the fact.
  - F3.review: proposed to be asked only when materials exist.
  - F4.founder_count, F4.full_time and F4.team_size: they feed the readiness score, not the profile minimum, matching or verification. This is a judgement call, because the profile's Team section shows them.
  - F5.signal and F5.revenue_status: they write nothing; they are context only.
- **Becomes mandatory:** F1.website, F1.country, F1.description and F1.categories.

### Investor (definition v3): proposed mandatory

| Step                                                                                            | Why / feature (code)                                                                                                                                            | Spec                              |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| I0.investor_type, I0.organisation_name                                                          | Profile and mandate: the firm is created once both are known (`investor-onboarding/src/integration/write-targets.ts:759-769,1007`). Verification: KYB name.     | SPEC:4929-4930; D17:1031-1032     |
| I0.website **(optional today)**                                                                 | Verification: email-domain match (`auto-request.ts:248,258`). Founder-side "profile complete" ranking (`discovery/src/domain/fit.ts:170-178`).                  | Final System Review:419           |
| I1.deployment_status                                                                            | Mandate: creates the first draft (`investor-v1.ts:455-460`; `write-targets.ts:1092`). Founder-side ranking (`domain/fit.ts:160-168`).                           | D17:1040-1052                     |
| I1.mandate_context                                                                              | Mandate: chooses the draft every later write goes to (`write-targets.ts:195-238`). It can be answered automatically when there is one.                          | D17:1040                          |
| I2.stages                                                                                       | Mandate and matching: stage range and a MUST constraint; candidate search and stage fit (`write-targets.ts:371-386`; `candidates/service.ts:159-195`).          | SPEC:4932; D17:1055-1066          |
| I2.currency + I2.cheque_min or I2.cheque_max **(the amounts are optional today; at least one)** | Matching: with neither end, cheque fit is always NO_RANGE (`discovery/src/features/cheque.ts:77`).                                                              | SPEC:4935; D17:1068-1074; D19 §13 |
| I3.geography **(optional today)**                                                               | Matching: taxonomy preference, candidates and geography fit (`write-targets.ts:411-416`; `candidates/service.ts:216-232`).                                      | SPEC:4934; D17:1080-1091          |
| I3.sectors **(optional today)**                                                                 | Matching: taxonomy fit, candidates and fit (`write-targets.ts:417-421`; `features/policy.ts:550`).                                                              | SPEC:4933; D19 §23                |
| I10.inbound_preference                                                                          | Profile: saved on the firm at confirmation; "not stated is never consent" (`write-targets.ts:1290-1316`). GateQ (`gateq/src/application/investor-gates.ts:88`). | SPEC:4938                         |
| I11.review                                                                                      | Mandate: the only step that activates it; matching ignores mandates that are not ACTIVE (`write-targets.ts:1319-1333`; `eligibility/policy.ts:500-512`).        | Final System Review:419           |

- **Becomes optional:**
  - I9.discovery_mode: written to the mandate, but no ranking, eligibility or candidate code reads it. See conflict 4.
  - I12.handoff: a closing screen that writes nothing.
- **Becomes mandatory:** I0.website, at least one cheque end, I3.geography and I3.sectors.

### For the owner to decide

1. **Pitch deck.** The spec makes it mandatory at Stage 2 (SPEC:525-526). The rule makes it optional, and so do code and docs: `marketplace-readiness.ts:164-167` ("V1 mandates no document"), D17:757, Final System Review:413.
2. **"Founder information" (SPEC:527).** Is the role enough, or do the team counts stay mandatory?
3. **Website mandatory** for pre-launch companies and for firms, with "no website yet" accepted as unknown?
4. **Discovery mode.** PADL #60 (`Real_PADL_…txt:1955`) says it is established during onboarding, but ranking doesn't read it. Keep it mandatory, or make it optional with a default?
5. **Industry** is Stage 1 in the spec and optional in code. The rule agrees with the spec. Suggested categories still need explicit confirmation (`write-targets.ts:428`).
6. **Gap: the investor's HQ country.** KYB jurisdiction and founder-side ranking read it (`auto-request.ts:250`, `domain/fit.ts:155,174`), but no investor step collects it. Adding one needs definition v4.
7. **Gap: semantic matching** reads only `short_description` (`discovery/src/semantic/service.ts:224-229`), so F1.description fills the profile minimum but not semantic matching.
8. **Gap: discovery visibility (the F10 choice)** is required by readiness but is not an onboarding step.
9. **D-OWN-1 needs an "unknown" answer on every mandatory step.** Steps without "Not sure" today: F1.country, F1.categories, F1.website, I3.geography, I3.sectors and the cheque amounts.
10. **The reason Q gives.** On a re-asked mandatory question, it should name the real use (the profile, matching, verification), not always "verification".
