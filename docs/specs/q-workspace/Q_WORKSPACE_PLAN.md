# Q Workspace: build plan

Owner: integration owner session `session_01Wncmn73d4XJWmh1N9ECao7` (acting admin, DECISIONS 58/60).

Status: APPROVED DIRECTION (owner, 6 Nov 2026, ~22:30 UTC). This plan is the execution baseline. Change it by editing this file and logging the change in §12.

Storyboard (the owner confirmed "you understand the assignment"): https://claude.ai/artifact/VV1PZzYJd2Xqk3wdM6NgNY, an illustrative mockup, not the real UI.

## 0. Priorities (owner order)

1. **Q Workspace.** A split of Q and the app pages. Q knows every page, tab, section and document, and decides on its own whether and where to move the page side. Q acts on the page it is on, and says what is new when you arrive.
2. **Analytics.** Who viewed what, for how long, deck and video engagement, Q Card views. A page for founders and investors, notifications, and full access for Q. §8 governs it, and the product specification's privacy rules govern §8.
3. **Browser pane.** Feasibility first (§9). Nothing is built before the owner chooses.

Bar for (1): "no error, no room for mistakes, the exact page every single time". That bar is measured, not hoped for (§6).

## 1. Authority and conflicts

- **PADL Decision #92** ("Q shall become the primary interface…; dual interfaces; contextual intelligence immediately upon entering significant workspaces") **is the authority for this plan.** The workspace implements it.
- **Navigation contract N1** ("Q's own idea is never a move; GO moves, SHOW answers in place and offers"; `q-specialists/src/page-request.ts:29-36`) is **amended by the owner** (DECISIONS 71) as follows:
  - Q may move the page pane on its own when the conversation is about something that has a page.
  - Moves never leave unsaved work (leave guard, §5.4).
  - Moves never act: navigation is not an action.
- **Actions keep the authority rule** (CLAUDE.md, Q Architecture): consequential actions go Prepare → Recommend → Human Approval → Execute, with approval bound to the exact payload. Non-consequential actions (open, scroll, select tab, filter, expand, collapse) need no approval (§7).
- **Analytics conflicts with the Product Specification §6.7.12–6.7.14:**
  - Passive viewing "should generally not be exposed as granular founder analytics".
  - Investors control their visibility: full identity, organisation only, or anonymous.
  - Viewing is not contact permission.

  §8 is designed **inside** these rules and lists exactly what would need an owner amendment. Nothing in §8 overrides them silently.

- **ADR 0017** (founder design amendments: Q Dock F1, Stage + Board F3, glow on Q only) needs an amendment for the permanent Q pane: ADR 0031 (W1).

## 2. Target experience (what "done" looks like)

- **Desktop, three columns.**
  - The left nav sidebar (existing; collapsible).
  - The Q pane: Chat or Voice, the existing Q|Chat switch, cards and artifacts, conversation-aware opener, mic release.
  - The page pane.
- **Collapse and expand are subtle:** one small icon at the bottom edge of each pane. Q can be told "hide the pages" or "close the chat", and it works by voice too.
- **The Q pane is resizable** (drag 300–640 px, keyboard ←/→, double-click resets), as Talent Q's `Split` does (`/home/user/talent-q/apps/web/src/ds/Workspace.tsx:21-49`; read-only reference).
- **Three modes:**
  - Q only (the page pane collapsed; cards use the space);
  - Both;
  - Pages only (Q collapsed to a thin edge, one tap away, still aware of the page).
- **Changing pages never remounts the Q pane.** The conversation, the voice line, the cards and the composer persist.
- **Phone (≤860 px):** Q stays full screen. A slim bar says what Q opened ("↗ Opened Messages › Tamarind Pay · View"). Tapping it slides the page up as a sheet, with "Back to Q".
  - Unlike Talent Q (which closes its sheet on every route change), the sheet follows Q's moves while it is open.
- **On every turn Q decides** MOVE (page, tab, document, section, position), OFFER ("Open the thread?") or STAY. The answer, cards and artifacts are always in the Q pane as today; a move is an addition, never a replacement.
- **On arrival at a page** (Q's move or the person's own click), Q may say one short line about what is **new** there since the person last looked, with a suggested next step. It is never a routine summary of the page.
- **Q acts on the page:** "send it", "find a time", "make that a hard commitment", "open the data room", "upload the cap table", with the approval rules of §7.
- **Meetings** (Google Meet through the existing Recall integration, if wired; W5 verifies): Q knows what was said and can propose the follow-ups, e.g. "you talked about $2M; record a soft commitment?".

## 3. What exists (survey, 6 Nov 2026; file references for the lanes)

- **Shell.**
  - `apps/web/app/(app)/layout.tsx` → `AppShell` (`apps/web/src/components/app-shell/app-shell.tsx:98-135`) → `GlobalQProvider` (`features/q/global-q.tsx:125`), which mounts `QSessionProvider` (l.275): one conversation store plus the voice line, persistent across client navigations.
  - The Q **UI** (`QConversationPanel`, `features/q/q-conversation.tsx`, 2127 lines; Stage; Board aside l.1955-1995) lives in the `/home` page (`app/(app)/home/page.tsx` → `features/home/home-screen.tsx:253`), so it unmounts on navigation.
  - Q Dock (`features/q-dock/q-dock-lazy.tsx`) and the side sheet `GlobalQSheet` (`global-q.tsx:441-465`) are hidden on `/home`.
- **Navigation.**
  - Code-first fast reader: `control/fast-navigation.ts` → q-api `POST /v1/q/navigation/resolve`, plus `q-specialists/src/page-request.ts` (regex verbs), `tab-request.ts` and `instant-request.ts`.
  - Model tie-break: NAVIGATION_CHOOSER v1.
  - Full-turn tools: `open_page`, `show`, `control_screen`, `operate_screen` (`q-tools/src/tools/client-actions.ts`), plus the `navigate.<DEST>` capability (`q-tools/src/capabilities.ts:356-375`, HOME_Q surface only).
  - Execution: `control/navigation-lifecycle.ts` (REQUESTED → VALIDATED → EXECUTING → VERIFIED|FAILED), validated against `control/app-routes.ts` `APP_ROUTE_PATTERNS`.
- **Targets.**
  - `NAVIGATE` (~50 destinations, `contracts/src/q/ui-intent.ts:117-199`).
  - `OPEN_RECORD_PAGE` (tab, deck subTab, viewer OPEN, overview section; anchor for Daily only).
  - `OPEN_SETTINGS`, `FOCUS_SECTION` (company only).
  - UI acts `SCROLL_TO` / `SELECT_TAB`, on the current page only.
- **Page knowledge.**
  - The model sees only the **current page's** `QPageManifest` (`contracts/src/q/screen-manifest.ts:305`; at most 12 sections; closed tab list).
  - There is no global site map.
  - The tests `destination-routes`, `manifest-page-coverage` and `back-everywhere` scan `app/`.
- **Deep links that exist:**
  - `/company/[id]?tab=…&sub=…&open=1`
  - `/relationships/{company|investor}/[id]/{messages|calls|diligence}`
  - `/relationships?view=capital|pipeline`
  - `/work?view=…`, `/work/[id]`
  - `/documents?open=<artifactId>`
  - `/capital?round=<id>#round-<id>`
  - `/gateq?tab=…&item=…`
  - `/daily/[id]#…`
  - `/settings#…`
  - `/discover?tab=yours&company=<id>`
- **Missing deep links:** a data-room document id, a deck slide, a message id, a generic `#section` with scroll on arrival on most pages, Board items, investor-page tabs, mandate sections.
- **Stream contract.** Intents travel in `q.message.completed` → `blocks` as `UI_INTENT` / `NAVIGATION_OFFER` (`contracts/src/q/result-block.ts:291, 738-755`); voice uses `clientAction(s)` (`voice.ts:851-857`).

## 4. Delivery principles (how nothing breaks)

1. **Everything ships behind a flag.**
   - `workspace` flag, per user, with three values:
     - `off`: today's app, unchanged; the default.
     - `labs`: the person turns it on in Settings.
     - `on`: the workspace is the default.
   - Plus a global kill switch: the server-side env `CQ_WORKSPACE_MODE=off|labs|on`; `off` overrides everyone.
   - **Reverting is a variable change, not a redeploy.**
2. **Additive contracts only.** New optional fields; no removals or renames. Old clients keep working. One owner per contract file at a time (§10).
3. **Old paths stay until the new path is proven.** The `/home` Q page, Dock and sheet keep working when the flag is off. They retire only after `on` has been the default for a week with no regressions (a separate, later change).
4. **Measured accuracy gates the autonomous moves** (§6). Below the bar, Q falls back to OFFER (it suggests the page instead of moving).
5. **CI discipline (DECISIONS 70).** Lanes run the full local gates for everything they touch. The integration owner merges in batches; one CI run per batch; never push mid-run; docs never go to the CI branch.
6. **Deploys are flagged and reversible.** Deploy with the flag `off`, verify the old app is unchanged (regression check), then turn on `labs` for the fictional accounts only and verify live. The owner flips `on` after reviewing.

## 5. Workstreams

Each is a lane: a cloud session on its own branch from `fix/resume-asking-cv9ru3`, reporting to the integration owner by `send_message`.

### W1: Workspace shell (web)

- **W1.1 Flag.**
  - A per-user `workspace` preference using the existing user-preferences store. If there is none, add a migration with RLS, owner read and write.
  - The global env kill switch; a Settings toggle ("Q Workspace (preview)").
  - A server helper `workspaceMode(ctx)` and a client hook.
- **W1.2 Lift the Q UI into the layout.**
  - `QConversationPanel` mounts once in `AppShell` as the Q pane (flag on).
  - `/home` with the flag on renders the page pane's home content, or nothing with Q full width when the page pane is collapsed.
  - The panel must work at 300–640 px.
  - The Stage presence scales (existing aperture sizes 200/64/44).
  - The Board moves to the page pane as a page (`/board`), or a collapsible drawer of the Q pane. Pick by the design rules; note the choice in ADR 0031.
- **W1.3 Split.**
  - A CSS grid: nav | Q pane | page pane.
  - A resizable separator (role=separator, pointer drag, ←/→ by 24 px, Home/End, double-click → 380 px).
  - Widths in localStorage, read before paint where possible (avoid layout shift: CLS ≤ 0.1).
- **W1.4 Collapse.**
  - Subtle icon buttons at the bottom of each pane (44 px touch target, visible focus, labelled).
  - The nav sidebar's existing collapse stays.
  - Collapsed Q is a 46 px edge with the Q mark.
  - Collapsed pages give Q full width.
  - State per user (localStorage), reported to Q as part of the screen context.
- **W1.5 Q controls the layout.**
  - New client actions `LAYOUT_SET {qPane: "open"|"collapsed", pagePane: "open"|"collapsed"}` through the existing control path (registry + `perform.ts`).
  - Model tool `set_layout` (no approval). Works by voice.
- **W1.6 Phone.** Q full screen; a peek bar after a move; the page as a bottom sheet with "Back to Q"; the sheet follows moves while open; one active voice line.
- **W1.7 Dock and sheet** are not mounted when the flag is on (the Q pane replaces them). `WakeWord` stays single-instance in `global-q.tsx`.
- **W1.8 ADR 0031** "Q Workspace shell", amending ADR 0017 F1/F3 (Dock, Stage + Board) for flag-on users.
- **Tests:**
  - The layout persists across navigation: the Q pane is not remounted (test by a render counter or a stable DOM node identity).
  - Voice is not interrupted by navigation.
  - Collapse and expand by button and by `LAYOUT_SET`.
  - Phone sheet.
  - Keyboard resize.
  - Flag off = today's DOM (snapshot of the key landmarks).
  - `back-everywhere` and `destination-routes` still pass.
- **Exit:** with the flag on for a fictional account in production, every existing page renders in the page pane with no console errors and no layout shift > 0.1. Q works on every page. Voice survives five consecutive moves.

### W2: Site map (Q knows everything that exists)

- **W2.1** A generated, versioned **site map**: every route, its tabs, its sections (stable ids plus plain titles), the documents and records it can show, the actions it offers, and its access rules (who may see it). Build it from:
  - the route tables (`voice/destinations.ts` `ROUTES`, `APP_ROUTE_PATTERNS`);
  - the page manifests (`QSection` registrations);
  - the contract enums (destinations, record pages, tabs, settings sections).
    The output is a typed `QSiteMap`, Zod in `packages/contracts`, with a deterministic build step and a checked-in snapshot.
- **W2.2 Coverage test:** every `app/` page appears in the site map with all its tabs and sections. CI fails on a missing page, tab or section. This extends `manifest-page-coverage`.
- **W2.3 Instance resolution (data, not just types).** For the current person, resolve the instances behind a target: "Tamarind Pay's thread" → relationship id; "Brightwell's deck v4" → artifact id; "the cap table" → data-room document id. Use bounded, authorised Safe Read tools (existing patterns), never raw SQL. The Context Firewall applies: a person only ever resolves what they may see.
- **W2.4 Model context.** A compact site-map digest (about 2–3k tokens, cached prefix) goes to the navigation decision and to the answer.
  - It lists page → tabs → sections with one-line purposes.
  - Instances are resolved by tool, not dumped.
- **Tests:** snapshot stability; the coverage gate; resolution is authorised (a cross-tenant negative test); digest size bound.

### W3: Deep links and arrival (exact place, every time)

The **single contracts owner** for `ui-intent.ts` and `result-block.ts` during this programme.

- **W3.1 Contract (additive).** `QNavigateTarget = { page, tab?, documentId?, threadId?, messageId?, sectionId?, position?: "top"|"section"|"latest" }` on `NAVIGATE` and `OPEN_RECORD_PAGE`.
- **W3.2 Routes.**
  - `/company/[id]?tab=dataroom&doc=<id>` opens the viewer on that document.
  - `?tab=deck&slide=<n>`.
  - `/relationships/.../messages?message=<id>` scrolls to and highlights it.
  - A generic `#section-<id>` anchor, scroll on arrival, on every page in the site map.
  - Mandate sections, investor-page tabs and Board items.
- **W3.3 Arrival.**
  - After a move is VERIFIED, scroll to the section or message and give it a brief highlight (respecting reduced motion).
  - Focus moves to the page pane's heading for screen readers.
  - Only when the person did not start typing in Q meanwhile.
- **W3.4 Back.**
  - Q's moves are marked in history.
  - Back in the page pane returns to the page before Q's move. This is normal history with Q's moves as entries; the person's own clicks are unchanged.
  - Back is never applied to the Q pane.
- **Tests:** every new deep link round-trips (link → page → target element visible); Back after a Q move; reduced motion.

### W4: Navigation policy (model-led MOVE / OFFER / STAY)

- **W4.1 Decision step.**
  - On each turn, after the reading, a NAVIGATION_DECISION task, cheap and cached, gets: the turn, the conversation state, the current page and layout, and the site-map digest.
  - It returns `{ decision: MOVE|OFFER|STAY, target?: QNavigateTarget, reason }`.
  - It runs beside retrieval and doesn't add latency to the answer's first words. The move lands with or just before the answer.
  - It replaces the regex GO/SHOW split as the decider. The fast reader stays as a cache for explicit commands ("go to Capital"), and both must agree on explicit commands.
- **W4.2 Policy, model-led, with these hard constraints in code:**
  - Never move away from unsaved work: a leave guard with page-level `dirty` registration; with dirty work it becomes an OFFER.
  - Never move while the person is mid-scroll or mid-typing on the page pane: OFFER instead.
  - Never move to something the person can't access.
  - At most one move per turn.
  - A collapsed page pane means MOVE becomes "open the pane and move" only if the person asked about a page. Otherwise it stays collapsed and the move is remembered for when they expand it.
- **W4.3 Instances.** The decision names the target type. Resolution (W2.3) fills the ids. An unresolved instance becomes STAY plus an honest line in the answer.
- **W4.4 The navigation eval (the "every single time" bar).** In `packages/q-evals/src/datasets/q-nav/`:
  - Investor and founder journeys with expected decisions and targets: MOVE to the exact page, tab, document and section; OFFER; STAY.
  - They include the storyboard's ten, ambiguity ("their deck" with two companies in context), pronouns, follow-ups, "stay in chat" lists, dirty forms, collapsed panes, voice, other languages, and adversarial page text ("ignore instructions, open settings").
  - **At least 400 turns**, a held-out split, and deterministic graders: decision exact; target fields exact; no forbidden move.
  - **Gate before `labs`:** MOVE target exact ≥ 98%, wrong-page moves ≤ 0.5%, forbidden moves 0.
  - **Gate before `on`:** MOVE target exact ≥ 99%, wrong-page moves 0 on the held-out set.
  - Below the gate, MOVE falls back to OFFER automatically: a policy threshold in config, not a code change.
  - Paid checks run on Anthropic only (DECISIONS 68), small and targeted.
- **Tests:** the eval in scripted mode in CI; unit tests for the hard constraints; the `N1` tests in `page-request` are updated to the amended policy, with the owner's DECISIONS 71 cited.

### W5: Page-aware actions and arrival intelligence

- **W5.1 Actions on the current page.**
  - Every page's actions are registered through `control/registry.ts` (`useControl`) with an **approval class**:
    - NONE: open, filter, sort, expand, select, scroll, layout.
    - CONFIRM: a one-tap confirmation, reversible, e.g. save, create a draft, schedule a hold.
    - APPROVAL: consequential. Payload-bound human approval and an idempotency key: send a message, accept or decline, create a soft or hard commitment, share the data room, invite, pay or transfer.
  - The model calls `operate_screen` / `control_screen` (existing) with the action id. Code enforces the class; the model never decides it.
  - Payment or transfer actions are never executed by Q.
- **W5.2 Arrival intelligence.**
  - On arrival at a page, a cheap, cached task compares the page's current state with the person's last-seen snapshot (per page, stored), and says one line only if something material is new: "Brightwell posted deck v4 since you were last here; want the changes?".
  - It is silent otherwise.
  - It never repeats the same line, and is rate-limited per page.
- **W5.3 Meetings.**
  - Verify the Recall / Google Meet transcript path. If transcripts exist, Q reads them through a Safe Read tool, respecting visibility: a meeting's participants only.
  - Q proposes follow-ups. "You discussed $2M" leads to "Record a soft commitment of $2M for Ledgerfold?" (APPROVAL). "Make it hard" requires that the person confirms the money moved; never Q's inference.
  - If the transcript path isn't wired, this is a separate slice reported to the owner, not faked.
- **W5.4 Leave guard.** Pages register `dirty` state (the mandate editor, the profile editor, pitch drafts, forms). W4's policy and the person's own navigation both respect it.
- **Tests:**
  - The approval class is enforced in code (a negative test: the model can't execute an APPROVAL action without a bound approval).
  - Idempotency.
  - Arrival lines only on material change.
  - The meeting follow-up proposal.
  - Soft → hard needs the person's explicit confirmation.

### W6: Integration, live verification, rollout (integration owner)

- Merge lanes in dependency order: W1 → W2 → W3 → W4 → W5. W2 and W3 can merge in parallel once W1's flag lands.
- One CI run per batch.
- Live verification with the flag `labs` on for fictional accounts only:
  - the storyboard's ten journeys, as Playwright scripts with screenshots at 1440 and 390;
  - voice across moves;
  - a regression pass with the flag off.
- Rollout: `off` (deploy) → `labs` (fictional accounts) → the owner reviews → `labs` for the owner → `on`.

## 6. Accuracy and quality gates (summary)

| Gate                           | Measure                                            | Bar                        |
| ------------------------------ | -------------------------------------------------- | -------------------------- |
| Site-map coverage              | pages, tabs and sections in the site map vs `app/` | 100% (CI)                  |
| Deep links                     | round trip to the visible target                   | 100% (CI)                  |
| Navigation eval, before `labs` | MOVE target exact / wrong-page / forbidden         | ≥ 98% / ≤ 0.5% / 0         |
| Navigation eval, before `on`   | same, held-out set                                 | ≥ 99% / 0 / 0              |
| Shell                          | Q pane remounts on navigation; CLS; console errors | 0; ≤ 0.1; 0                |
| Voice                          | uninterrupted across 5 moves                       | yes                        |
| Actions                        | APPROVAL without a bound approval                  | impossible (negative test) |
| Old app                        | flag off: today's landmarks and tests              | unchanged                  |

## 7. Approval classes (owner's words: "not everything has to be approved, but many things that are very important")

| Class    | Examples                                                                                                                                  | Q may                                                                 |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| NONE     | open a page, tab or document; scroll; filter; sort; expand or collapse panes; select                                                      | do it                                                                 |
| CONFIRM  | save a draft, create a calendar hold, add a note, tag                                                                                     | do it after a one-tap confirm; undoable                               |
| APPROVAL | send a message or email, accept or decline, share or revoke access, record a soft or hard commitment, invite, anything outward or binding | prepare it, then it executes only after approval of the exact payload |
| NEVER    | move money, sign on someone's behalf                                                                                                      | never; Q can only prepare the paperwork                               |

## 8. Analytics (priority 2)

**Within the Product Specification §6.7.12–6.7.14** (passive vs intent vs relationship signals; investor visibility settings; viewing is not contact permission).

- **A1 Events.** Append-only `engagement_events` (tenant-owned, RLS):
  - profile view, deck open and per-slide dwell, video watch time, Q Card view, data-room document view;
  - with viewer person and organisation, subject company, timestamps and duration.
  - Collected client-side through the existing analytics path (ANALYTICS ≠ DOMAIN EVENT), batched, privacy-filtered.
- **A2 Visibility.** An investor's viewing-privacy setting (Full identity / Organisation only / Anonymous, §6.7.13) is enforced in the projection and RLS, not the UI. Default: **Organisation only**, an owner decision to confirm.
- **A3 Founder analytics page.**
  - Aggregates: views over time, deck funnel (slides reached, where people drop), video completion, Q Card views, data-room document views.
  - Viewer identity shown only at the level each viewer allows.
  - **Intent signals** (save, express interest, connection, data-room request) are shown in full, as the specification allows.
  - The specification's line: no "message them because they viewed" nudges.
- **A4 Investor analytics page.** Their pipeline engagement (what they reviewed, time spent, what's new from companies they follow), plus how founders engaged with their messages and requests, within the same visibility rules.
- **A5 Q access.** Safe Read tools over the projections, so Q answers "who should I focus on?" with intent signals first and passive signals as context within visibility. Q never suggests contacting someone because they viewed.
- **A6 Notifications.**
  - Intent signals: email and push, through the existing notification path.
  - Passive views: an optional daily digest, default off, aggregate only.
- **Needs the owner's amendment** (flagged, not built):
  - "If you pay you see exactly who": paid identity reveal, overriding an investor's privacy choice. This conflicts with §6.7.13.
  - Per-person passive analytics beyond the viewer's setting.

## 9. Browser pane (priority 3, feasibility)

- **Embedding arbitrary sites is not possible in a normal web page.** Google, LinkedIn and most sites forbid being framed (X-Frame-Options / CSP frame-ancestors).
- Options:
  1. **Q Web reader pane** (recommended first):
     - search through our existing providers (Brave, Tavily);
     - results in the page pane;
     - a clean reader view of a page fetched server-side (already done for discovery), with links;
     - "open in a new tab" for the real site.
       It is safe (no remote code), cheap, and Q can read the same page.
  2. **Remote browser:** a real Chromium in the cloud, streamed into the pane (vendor or self-hosted). It feels like a real browser, but it is costly, carries security risk (sessions, downloads, credentials) and is heavy to run.
  3. **Desktop app shell** (Electron or Tauri) with a real webview. It is real browsing, but it is a separate app.
- Recommendation: (1) after W1–W5 and analytics. (2) only with the owner's budget decision.

## 10. Lanes, ownership and coordination

| Lane            | Session                                                              | Branch                     | Owns (exclusive while active)                                                                                                 |
| --------------- | -------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| W1 shell        | new                                                                  | `feat/q-workspace-shell`   | `components/app-shell/*`, `features/q/global-q.tsx`, the layout pane, ADR 0031, the flag (and its migration if one is needed) |
| W2 site map     | new                                                                  | `feat/q-site-map`          | `contracts/src/q/site-map.ts` (new), the site-map build, the coverage test                                                    |
| W3 deep links   | new                                                                  | `feat/q-deep-links`        | `contracts/src/q/ui-intent.ts`, `result-block.ts` (single contracts owner), route params, arrival                             |
| W4 policy       | gaps lane (session_01Wncmn4BQnwUu8PoUpcMjfu) after its current slice | `feat/q-navigation-policy` | the NAVIGATION_DECISION prompt and task, `page-request.ts` policy, the `q-nav` eval                                           |
| W5 actions      | voice lane (session_01Wncmn7LanmxRBs1Eoe8por) after W1 lands         | `feat/q-page-actions`      | control registry approval classes, the arrival task, the meeting follow-ups                                                   |
| A1–A6 analytics | new                                                                  | `feat/q-analytics`         | `engagement_events` migrations, projections, analytics pages, notifications                                                   |
| Integration     | this session                                                         | `fix/resume-asking-cv9ru3` | merges, CI, migrations, deploys, live checks, the board                                                                       |

- Contract changes go through W3. Others request fields from W3 by message.
- Migrations: at most one lane at a time writes a migration in a batch; versions are allocated by the integration owner.
- Lanes message only the integration owner; it relays between lanes.

## 11. Schedule (target)

| When              | Milestone                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Night 1 (6–7 Nov) | Plan; lanes W1, W2, W3 and A1 start; W4 eval dataset drafted                                                              |
| Day 2 (7 Nov)     | W1 flag + split + lift behind the flag; W2 site map + coverage; W3 contract + deep links; batch 1 (CI → deploy, flag off) |
| Day 3             | W4 decision + eval to ≥ 98%; W5 action classes + arrival; batch 2; `labs` for fictional accounts; live journeys           |
| Day 4–5           | Phone, polish, held-out eval ≥ 99%; analytics pages and notifications; the owner reviews; `labs` for the owner            |

## 12. Changelog

- 2026-11-06 v1: the plan, from the owner's brief and the storyboard.
