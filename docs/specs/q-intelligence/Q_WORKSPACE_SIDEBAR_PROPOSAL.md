# Q Workspace Sidebar — a persistent Q panel beside every page

Status: PROPOSED (owner ask, 6 Nov 2026). Research only; no code changed.
Read with: `Q_PREMIUM_PLAN.md` (Step P4), ADR 0017, `docs/design/ux-direction-2026-09.md` §6, doc 18 §181 and §186.
Precedence: below the locked PADL, the CLAUDE.md invariants and ADRs. The shell change below amends ADR 0017 F1 and needs owner approval.

## 0. The ask and the short answer

The owner likes Talent Q's chat: a dark panel that is always there, resizable by dragging, where you type or talk and Q takes you to the right page while the chat stays put. The owner asks whether Capital Q can work like that, whether it breaks what exists, and whether the two can be merged.

**Short answer.**

- **Yes, it is possible, and most of the engine already exists in Capital Q.** Talent Q's navigation engine was copied _from_ Capital Q (`talent-q/docs/decisions/Q_REUSE_LEDGER.md`: "Universal page control … Adapted", "Code-only reader for stupid-fast navigation … Rebuilt on the same pattern").
- **What Talent Q has and Capital Q lacks is the shell, not the intelligence.** Capital Q opens Q beside a page as a _modal_ sheet over a dimmed page, plus a floating dock. Talent Q puts Q in a _permanent split column_.
- **It does not need to break the Q home, Chat/voice view, Board, Stage, offers or N3**, if the panel is hidden on `/home` (as the sheet is today) and reuses the one conversation store. Five specific things do change (§5.2).
- **Merge:** borrow the _pattern_ (about 50 lines of layout) and write it in Capital Q's tokens. No cross-repo code copy is needed.

## 1. How Talent Q does it (read-only, `/home/user/talent-q` @ `11e5836`)

### 1.1 The panel

| Concern             | How                                                                                                                                                  | Evidence                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Layout              | `Split` = thread column, separator, canvas. CSS grid `var(--thread-w) minmax(0,1fr)`.                                                                | `apps/web/src/ds/Workspace.tsx:21-49`; `styles/ds.css:68-70`            |
| Where it lives      | `AppShell` mounts `<Split thread={<QThread/>} canvas={page}>` on desktop. Every signed-in layout renders `AppShell`.                                 | `ds/AppShell.tsx:103-105`; `app/c/layout.tsx:17`; `app/q/layout.tsx:18` |
| Survives navigation | The shell is in the layout, so only `children` re-render. The conversation lives in `QProvider` in the root providers, above every layout.           | `app/providers.tsx:7`; `q/QProvider.tsx:38-59`                          |
| Resize              | Pointer drag on a `role="separator"` button; keyboard ←/→ (24 px), Home/End; double-click resets to 380. Clamped 300–640 px and ≤ 55% of the window. | `Workspace.tsx:27-41`                                                   |
| Width memory        | `localStorage` `tq.split.<id>.w` and `.mode` (open/collapsed), read in an effect after first paint.                                                  | `Workspace.tsx:13-14, 25-28`                                            |
| Collapse            | Collapsed = a 56 px strip with Q's mark and state line; one click reopens.                                                                           | `q/QThread.tsx:25-31`; `ds.css:69`                                      |
| Q can fold it       | The panel registers as control `shell.q` (DISCLOSURE), so "hide the chat" works by voice or text.                                                    | `ds/AppShell.tsx:138-141`                                               |
| Phone (≤ 860 px)    | No split. A bottom "ask bar" peeks Q's last line; tapping opens a full-height modal sheet. The sheet **closes on every route change**.               | `AppShell.tsx:42, 106-112, 150-161`; `ds.css:229`                       |
| "On <page>" line    | Built in the browser from the route registry's label, the person and their organisation: "On Explore talent · Daniel · Zino Aviation".               | `QThread.tsx:20-22`; `contracts/messages/en.ts:81`                      |

### 1.2 How Q decides to navigate

| Concern               | How                                                                                                                                                                                              | Evidence                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| One route registry    | `ROUTES` drives the rail, the phone tabs, the ⌘K palette and Q's navigation reader. Each route has `id`, `label`, `side` and `words`.                                                            | `packages/contracts/src/routes.ts:1-2, 24`; `matchRoute` `:254`                    |
| Code-first reader     | "go to / open / show me / take me to X" is matched by code, no model.                                                                                                                            | `packages/q-runtime/src/reader.ts:98, 383-389`                                     |
| Model tool            | `navigate` tool takes a `routeId`, `roleId` or `personId`; only routes for the person's side; validated by `NavigateIntentSchema`.                                                               | `apps/api/src/modules/m15-q/model-turn.ts:175-186`; `contracts/src/actions.ts:551` |
| Intent to the browser | The reply carries `intents: [{ kind: 'NAVIGATE', path, confirm }]`; the thread says "Opening X…".                                                                                                | `m15-q/turn.ts:98-100`                                                             |
| Verified receipt      | The browser pushes the route, waits until the path has settled for 400 ms, then rewrites the line to "Opened X." After 12 s it says "That page didn't open". A newer move replaces an older one. | `q/QProvider.tsx:66-125`; `en.ts:105-106, 142`                                     |
| Page context to Q     | Every turn sends `{ path, search, routeId, recordId, controls }`. The controls are the page's registered `useControl` manifest.                                                                  | `QProvider.tsx:29-36, 142`                                                         |
| Prefill               | Through the query string. "Find a pilot in Lagos" goes to `/r/explore?q=…`; Explore reads `searchParams`.                                                                                        | `m15-q/turn.ts:179`; `app/r/explore/page.tsx:22-23`                                |
| Page → chat           | Pages register controls with the same handlers their own buttons run; Q acts through them and gets a receipt.                                                                                    | `q/controls.ts:1-31, 54-78`                                                        |

### 1.3 Hijacking rules

- Navigation is **direct**: Talent Q moves when asked and does not ask first. It does not distinguish "show me" from "take me to".
- Writes are **never** direct: the model can only `propose_action`, a button the person taps (`model-turn.ts:8, 187-195`).
- There is **no general unsaved-work guard**. Only the document editor keeps unsaved copies per tab (`screens/documents/useDocumentSave.ts:19, 71`).

## 2. What Capital Q has today (`fix/resume-asking-cv9ru3` @ `0a13cb2ac`)

| Piece                  | What it is                                                                                                                                                                           | Evidence                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| App shell              | Left `DesktopSidebar` (navigation only, collapsible) + body (header, `main`). Phone: header + main, no bottom nav except Discover.                                                   | `components/app-shell/app-shell.tsx:98-135`; `desktop-sidebar.tsx:38-43`                                             |
| One conversation store | `GlobalQProvider` → `QSessionProvider` in the `(app)` layout; shared by the dock, the side sheet and the Q home (ADR 0017 F1).                                                       | `global-q.tsx:125-293`; `app/(app)/layout.tsx`                                                                       |
| Q beside the page      | `GlobalQSheet` renders `QSheetConversation` in a **modal** `Sheet` (Base UI dialog with a backdrop), 420 px on desktop, a bottom sheet on a phone. Not resizable. Hidden on `/home`. | `global-q.tsx:204, 441-465`; `packages/ui/src/components/sheet.tsx:53, 79-81`                                        |
| Q Dock                 | Floating, draggable presence on every page but `/home`; six anchors; avoids controls; pressing it opens the sheet.                                                                   | `features/q-dock/q-dock.tsx:55-79`; `q-dock-lazy.tsx:17-19`                                                          |
| "Q can see" line       | Route words + page labels, shown in the sheet and on the Q page. Ids only go to Q.                                                                                                   | `features/q/q-can-see.tsx`; `q-sheet.tsx:138`                                                                        |
| Q home                 | ChatGPT-style home with a Q \| Chat switch; Board docked as an `aside` on desktop, a sheet on a phone.                                                                               | `q-conversation.tsx:723-725, 1827-1880`; commit `c90f269cd`                                                          |
| Navigation registry    | `Q_NAVIGATE_DESTINATIONS` (30+ named pages); `destinationPath`; `APP_ROUTE_PATTERNS` validated by a test that reads the app directory.                                               | `contracts/src/q/ui-intent.ts:117, 194-199`; `control/app-routes.ts:1-20`; `test/destination-routes.test.ts:118`     |
| Navigation lifecycle   | One owner of every move: REQUESTED → VALIDATED → EXECUTING → VERIFIED \| FAILED(reason); soft navigation keeps the voice line alive.                                                 | `control/navigation-lifecycle.ts` (header; `requestNavigation` `:592`); `control/router-registry.ts`                 |
| Navigation tools       | `open_page` (records), `show` (a card in place), `control_screen`, `operate_screen`; destination moves are HAND capabilities.                                                        | `q-tools/src/tools/client-actions.ts:662, 982, 1224, 1579`; `q-tools/src/capabilities.ts:356-375`                    |
| N1 offers              | GO ("take me to") moves; SHOW ("show me") answers in place and offers "Open page / Stay here". Only 2 destinations answer in place today.                                            | `q-specialists/src/page-request.ts:29-36, 327-330`; `answer.ts:1817-1836`; `contracts/src/q/result-block.ts:725-752` |
| N3                     | An offer settles on every surface and device once a later Q message exists.                                                                                                          | `features/q/navigation-offers.ts:6-27`; `navigation-offer-card.tsx`                                                  |
| Page control           | Pages register semantic controls; acts report DONE only when the effect shows.                                                                                                       | `control/registry.ts`; `control/perform.ts`                                                                          |
| Screen context         | `QScreenContext` with route, entity ids, manifest, and `surface` CHAT / DOCK / STAGE.                                                                                                | `contracts/src/q/request.ts:80, 93`; `features/q/screen.ts:248-283`                                                  |
| Page coverage          | Every page must register a manifest section or be exempt.                                                                                                                            | `apps/web/test/manifest-page-coverage.test.ts`                                                                       |
| Modals off the Q page  | `QShowModal` opens a modal for cards, tables and charts that Q shows away from the Q page.                                                                                           | `control/q-show-modal.tsx:40-75`; `q-session.tsx:846`                                                                |

Note: the stage view default reads `presence` on a desktop and `chat` on a phone unless the person chose (`q-conversation.tsx:1962-1971`). The owner describes Chat as the default. Check which is live before building; it does not change this proposal.

## 3. Gap and conflict analysis

### 3.1 Equivalent already (reuse, do not rebuild)

| Talent Q                       | Capital Q equivalent                                     | Verdict                                               |
| ------------------------------ | -------------------------------------------------------- | ----------------------------------------------------- |
| `QProvider` above layouts      | `GlobalQProvider` / `QSessionProvider` in `(app)` layout | Same. Capital Q's is richer (voice, runs, approvals). |
| `ROUTES` registry              | `Q_NAVIGATE_DESTINATIONS` + `APP_ROUTE_PATTERNS` + tests | Same idea, stronger tests.                            |
| NAVIGATE intent + 12 s receipt | Navigation lifecycle with VERIFIED/FAILED(reason)        | Capital Q's is stronger.                              |
| `useControl` manifest          | Control registry + `perform`                             | Talent Q copied this from Capital Q.                  |
| Context line                   | `QCanSee`                                                | Same.                                                 |
| Collapsed strip                | Q Dock (minimal/compact)                                 | Same role.                                            |

### 3.2 Missing in Capital Q

1. **A non-modal, persistent, resizable column.** Today Q beside a page is a modal: the page is dimmed and cannot be clicked while Q is open. This is the main gap. Doc 18 §186 already asks for it: "Q can become side-by-side with current entity. Use split view … `Company | Q`" (`docs/architecture/18_…md:3330`). §181 gives 480–640 px.
2. **Width and open state remembered**, without a layout jump on load.
3. **Page prefill or focus as part of a move.** `QNavigateIntent` has only `destination` (`ui-intent.ts:194-199`). Today Q moves, then a second act sets a filter or tab. A typed `focus` (search words, tab, section, record) would land in one step.
4. **Offers for every page**, not 2 (`page-request.ts:327-330`). This is already Premium Plan P4.
5. **"Opening… → Opened" lines in the thread.** The lifecycle has the receipt; the thread should show it as one line that updates, like Talent Q.
6. **An unsaved-work guard.** Neither product has one. Capital Q has forms (mandate, profile, pitch, GateQ, settings).
7. **"Show it on the page" instead of a modal.** `QShowModal` draws a modal off the Q page. With a panel, if a registered page already shows that thing, Q should offer or open the page.

### 3.3 Conflicts and how to resolve them

| Conflict                                           | Why                                                                                                                 | Resolution                                                                                                                                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR 0017 F1: the dock is on every page but `/home` | A panel and a dock together are two presences of one Q.                                                             | When the panel is open, the dock hides. When collapsed, the dock _is_ the collapsed state. Record as an ADR 0017 F1 amendment.                                                            |
| Full-page Q home vs a sidebar                      | Two copies of the same chat on one screen.                                                                          | No panel on `/home`, as today (`global-q.tsx:204`). "Open Q" in the panel goes to `/home` in the same conversation (`q-sheet.tsx:375-379`).                                               |
| Board is also a right panel                        | Only on `/home`.                                                                                                    | No clash: the panel never shows on `/home`.                                                                                                                                               |
| Stage and cards                                    | The panel has no stage.                                                                                             | Cards render inline in the panel (as the sheet does). Large objects (P4 "stage" placement) offer "Open in Q" or open the real page.                                                       |
| Discover desktop                                   | Doc 18 §182 puts intelligence on the right; `dossier-q.tsx:51` embeds its own inline Q.                             | On Discover the panel starts collapsed, and the inline Q yields to the panel when it is open (one composer on screen).                                                                    |
| Narrow desktops (1024–1280 px)                     | Rail + panel + page can squeeze the page below its minimum.                                                         | The panel auto-collapses when the page column would drop below about 640 px.                                                                                                              |
| Mobile                                             | No room for a split.                                                                                                | Keep the bottom sheet. Owner decides whether it stays open across a move (§7).                                                                                                            |
| Voice view                                         | A voice line must survive moves (ADR 0017 C11).                                                                     | Already true: soft navigation through the router registry. The panel shows the mic-live mark and Stop.                                                                                    |
| "UI hiding is not authorization"                   | Q could offer a page the person may not open.                                                                       | Unchanged: offers and moves are validated against the viewer's shell context early (`app-routes.ts`), and every page and API authorises again. The panel adds no route and no permission. |
| Approval rules                                     | Moving must not become a backdoor to acting.                                                                        | Navigation stays INSTANT and non-consequential. Every action still goes Prepare → Recommend → Approve → Execute, bound to the exact payload. Navigating never approves anything.          |
| Never lose unsaved work                            | A Q move could drop a half-filled form.                                                                             | New leave guard (§4.4). A GO move to a dirty page becomes an offer: "You have unsaved changes on Mandate. Open Discover anyway / Stay here".                                              |
| ADR 0017 F3 "not a chat"                           | The panel is a chat.                                                                                                | F3 is about the Q page and was already relaxed by the owner's ChatGPT-style home (5 Nov). Record both in the same ADR amendment.                                                          |
| Performance (LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1) | Today the sheet's code loads only after idle (`global-q.tsx:231-245`, P9). A visible panel loads it on first paint. | Server-render the panel frame at the stored width (cookie), stream the conversation in after LCP. Collapsed panels load nothing new.                                                      |

## 4. Recommended design for Capital Q

### 4.1 Shape

- **Desktop (≥ 1024 px): a Q column on the right**, beside the page: `Sidebar | Page | Q`. Right, because the navigation rail is on the left, the dock already lives on the right edge (`ux-direction` §6), and doc 18 §186 draws `Company | Q`. Talent Q uses the left only because it has a slim rail.
- **Always there, never modal.** The page stays usable. Focus is not trapped. `aside` landmark labelled "Q".
- **Resizable** with a separator: drag, ←/→, Home/End, double-click to reset. 360–640 px, default 420 px (today's sheet width), ≤ 45% of the window.
- **Collapsible** to the Q Dock. The dock opens it again; ⌘K focuses its composer; the panel registers as control `shell.q` so "hide Q" works by voice.
- **Remembered** per viewer in a cookie (`cq.qpanel` = width + open/collapsed), read on the server so the first paint has the right width and no shift. This is a per-viewer convenience, so browser-side state is allowed (CLAUDE.md); it never decides anything.
- **Not on** `/home` (Q is the page), onboarding, or full-screen surfaces (Discover's immersive feed, a chat thread, Q Pitch tour). On Discover it starts collapsed.
- **Phone:** unchanged bottom sheet with a peek line. Owner decision on whether it closes after a move (§7).

### 4.2 Same conversation everywhere

- The panel renders the existing `QSheetConversation` from the existing store. Nothing new on the server. N3 holds: an offer settled in the panel is settled on the Q home and on the phone.
- `screen.surface` stays `DOCK` for the panel (it is the dock's expanded view); add `PANEL` only if Q needs to tell them apart.
- The header keeps `QCanSee` ("Q can see: Relationships · Acme"), updated on each route change.

### 4.3 Navigation from the panel

- **Engine:** the existing navigation lifecycle and destination registry. No new navigation tool. `open_page`, the HAND `NAVIGATE` capability, `operate_screen` and N1 offers already cover it.
- **Rules (as N1 today, extended by P4):**
  - "Take me to / open X" (GO): move at once, with an "Opening X…" line that becomes "Opened X." or a reason.
  - "Show me X" (SHOW): answer in the panel, then offer "Open X / Stay here" for **every** page (P4).
  - Q's own idea that a page would help: always an offer, never a move.
  - Leave guard: a GO move from a page with unsaved changes becomes an offer.
- **Prefill and focus:** add an optional typed `focus` to `QNavigateIntent` (closed per destination: Discover filters, search words, a tab, a section id from the manifest, a record id). The browser builds the URL or runs the registered control after VERIFIED. Validated by Zod and by the destination's own page. It is a request, never authority.
- **Modals:** when Q "shows" something a registered page already displays, prefer an offer to open that page. Keep `QShowModal` only for things with no page (a comparison, a chart from this answer).

### 4.4 Leave guard (new, small)

- `useLeaveGuard(dirty: boolean, label)` registers the page's unsaved state in a module store, like the control registry.
- `requestNavigation` checks it before EXECUTING. If dirty, the move becomes a local offer card in the thread. It never discards work silently.
- The same guard handles the person's own clicks with a `beforeunload` prompt for hard reloads only.

### 4.5 What to reuse, what to borrow

| From Capital Q (reuse as is)                                       | From Talent Q (borrow the pattern, rewrite in Capital Q tokens)             |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `GlobalQProvider`, `QSessionProvider`, `QSheetConversation`        | `Split`: grid column + separator + clamp + keyboard (`Workspace.tsx:21-49`) |
| Navigation lifecycle, router registry, `app-routes.ts`             | The "Opening… → Opened" single updating line (`QProvider.tsx:66-125`)       |
| `Q_NAVIGATE_DESTINATIONS`, `destinationPath`, N1 offers, N3 settle | The panel as a Q-operable control `shell.q` (`AppShell.tsx:138-141`)        |
| Control registry, `perform`, `QCanSee`, manifest coverage test     | Query-string prefill idea, made typed (`turn.ts:179`)                       |
| Q Dock (as the collapsed state)                                    | Peek line on the phone ask bar (`AppShell.tsx:150-161`)                     |

No code needs to be copied across repos. The borrowed layout is about 50 lines and must use `--cq-*` tokens, Base UI and Capital Q's i18n anyway. Both repos have the same owner and no LICENSE file, so a trivial copy would also be allowed, with a header naming the source.

## 5. Phased plan

| Step                                       | What changes                                                                                                                                                                                                                                                                     | Effort        | Tests and pass bars                                                                                                                                                                                                                                                                                                                        | Risks                                                                           |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| **W1. Docked panel**                       | New `QPanel` column in `app-shell.tsx` (desktop only) replacing the modal `GlobalQSheet` there; separator; cookie width and open state read in `(app)/layout.tsx`; dock hides while open; dock-avoid measures the panel (`q-dock.tsx` `measureViewport`). Phone keeps the sheet. | M, 2–3 days   | Playwright: panel stays through 3 moves with the same conversation id; width survives reload; page clickable while open; separator by keyboard; axe clean; voice line survives a move. CLS ≤ 0.1, LCP ≤ 2.5 s, INP ≤ 200 ms on Discover, Relationships, Profile with panel open. Existing dock and sheet unit tests updated, none deleted. | Width squeeze at 1024–1280 px; dock and panel both showing; first-paint cost.   |
| **W2. Moves from the panel**               | "Opening… → Opened" line wired to lifecycle receipts; leave guard store + `requestNavigation` check; register guards on mandate, profile, pitch, GateQ and settings forms.                                                                                                       | S–M, 1–2 days | Unit: dirty page turns GO into an offer; clean page moves. Playwright: half-filled mandate + "take me to Discover" keeps the form. No FAILED receipt on a verified move.                                                                                                                                                                   | Missing a form that should be guarded.                                          |
| **W3. Offers for every page + focus**      | P4's "NAVIGATION_OFFER for every page"; typed `focus` on `QNavigateIntent`; offer words for each destination in code.                                                                                                                                                            | M, 2–3 days   | `destination-routes.test.ts` extended: every destination has offer words and a valid focus schema. Q-IQ navigation category ≥ 95%; no category drops.                                                                                                                                                                                      | Contract change: one owner with P4/P6 for `result-block.ts` and `ui-intent.ts`. |
| **W4. Page instead of modal**              | `QShowModal` prefers an offer to the page that already shows the object; modal only for page-less objects.                                                                                                                                                                       | S, 1 day      | Playwright: "show me Acme's profile" from the panel offers the profile page; a comparison still opens in place.                                                                                                                                                                                                                            | Owner may prefer the modal for speed.                                           |
| **W5. Discover, narrow screens, inline Q** | Panel starts collapsed on Discover; `dossier-q` yields when the panel is open; auto-collapse under a minimum page width.                                                                                                                                                         | S, 1 day      | One composer on screen in every state; Discover feed layout unchanged with panel collapsed; INP on swipe unchanged.                                                                                                                                                                                                                        | Discover is the demo's heart; regressions there are expensive.                  |
| **W6. Phone polish** (owner decision)      | Peek line; optional "stay open after a move" at the 50% detent.                                                                                                                                                                                                                  | S, 1 day      | Phone Playwright at 390 px; touch targets ≥ 44 px; reduced motion.                                                                                                                                                                                                                                                                         | Covering the page on small screens.                                             |

**Total:** about 8–11 engineer-days. **First useful slice:** W1, 2–3 days.

**Order and lanes.** W1, W2 and W5 touch the web shell only and can run in parallel with P3/P4. W3 belongs inside P4 (same files, one owner). W4 follows P4's placement decision. Nothing needs a migration. ADR 0017 F1/F3 amendment is written with W1.

### 5.1 Will it break existing work?

**No, if built as above.** The Q home, the Q/Chat switch, the voice view, the Board, the Stage, cards, N1 offers and N3 are untouched, because the panel never shows on `/home` and uses the same store and the same navigation lifecycle.

### 5.2 What does change (expected, not breakage)

1. On desktop, the modal side sheet goes. Tests that expect `role="dialog"` for "Q beside the page" are updated to the `aside`.
2. The dock hides while the panel is open (ADR 0017 F1 amendment).
3. Pages get narrower when the panel is open; layouts need a check at 1024–1440 px.
4. Discover's inline "Ask about…" yields to the panel when it is open.
5. Panel code loads earlier for people who keep it open (measured in W1's bars).

### 5.3 Does it fit Premium Plan Step P4?

**Yes, and they need each other.** P4 decides _how_ an answer is shown. The panel decides _where_ the conversation lives. Three links:

- P4's "NAVIGATION_OFFER for every page" is W3. Build it once, inside P4.
- P4's placement ("big table to the stage, one-line fact in the thread") needs one more value for a panel: **page** (open or offer the page that shows it) besides **thread** and **stage/modal**. Add it to P4's closed list now, so P4 is not redone.
- P4's rule "Q offers; navigates directly only when asked" is exactly the panel's rule. No conflict.

## 6. Top risks

1. **Discover regression.** It is the main demo surface. Mitigation: panel collapsed there by default; feed INP measured.
2. **Layout squeeze** on 13-inch laptops. Mitigation: auto-collapse below a page minimum.
3. **First-paint cost.** Mitigation: server-rendered frame, conversation streamed after LCP; bars in W1.
4. **Two presences.** The dock and the panel showing together would confuse. Mitigation: one rule, recorded in the ADR.
5. **Lost work on a Q move.** Mitigation: the W2 leave guard before any wider auto-navigation.
6. **Contract contention** on `ui-intent.ts` / `result-block.ts` with P4 and P6. Mitigation: W3 inside P4, one owner.

## 7. Owner decisions

1. **Side:** right (recommended: rail on the left, dock on the right, doc 18 §186) or left like Talent Q.
2. **Default state:** panel open by default on interior pages, or collapsed until first use? (Recommended: open, except Discover.)
3. **Moves:** keep N1 (GO moves at once; SHOW and Q's own ideas are offers), or always ask, or always move? (Recommended: keep N1.)
4. **Phone:** after Q moves you, does the sheet close (Talent Q) or stay at half height?
5. **Dock:** hide the dock while the panel is open (recommended), or keep both?
6. **Modals:** prefer opening the real page over a modal when one exists (W4)?
7. **Approve the ADR 0017 F1/F3 amendment** that records the panel and the ChatGPT-style home.
