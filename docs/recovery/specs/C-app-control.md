# Workstream C: universal application control (RECOVERY-2026-10)

Owner: workstream C. Branch: `build/rec-c`. TRACKING rows C1–C6. Governs: SPEC §2 (C ownership), §3 (lead contracts `ui-act.ts`, the seam), §4 (non-negotiables 1, 2, 3, 8), §5 (Scenarios A, B, C, E; the capability parity matrix).

Mission: whatever a signed-in person can do through Capital Q's own UI, Q can do through text or voice, through the same capability. The model picks a semantic act on a stable control id. Trusted page code performs it with the control's own handler and reports a receipt. Consequential changes stay app actions under Prepare → Approve.

## 1. Research

- **Accessibility-grounded control ids.** WAI-ARIA Authoring Practices: tabs (`role=tab`, `aria-selected`), disclosure (`aria-expanded`), menu button, dialog (<https://www.w3.org/WAI/ARIA/apg/patterns/>). Control kinds and states are read from those attributes, so registering a control never adds a parallel state model. A registered control acts through its own element's `click()`, which is the handler a pointer or a keyboard Enter runs.
- **LLM app control (SPEC §1).** The app declares its typed actions under stable ids, and the model chooses from the candidates the current page publishes. The page is re-observed after each act. Ids are invalidated across screens, and page-declared semantics never confer authority (the server decides). This matches the q.screen.v2 rule: ids and closed kinds travel, labels never do (`packages/contracts/src/q/screen-manifest.ts:6-17`).
- **Browser gesture rules.**
  - `window.open` and file pickers need transient user activation (HTML §6.4.3 "user activation"). `a[download]` with a same-origin or blob URL does not.
  - Downloads therefore go through the viewer's existing signed read and an anchor. The file picker (profile photo) cannot be opened by Q. Q opens the screen, focuses the control and says so; the photo stays an _offer_ (`packages/app-actions/src/actions/profile-images.ts:16-20`).
- **Next.js App Router.** `router.push` is asynchronous and the new page's client components mount after the RSC payload arrives. Any act chained after a navigation must therefore wait for the target to register, and must not run on the old page (<https://nextjs.org/docs/app/api-reference/functions/use-router>).
- **Server actions serialize per client** (audit C-08, `capital-q-audit/14-CONFIRMED-DEFECTS.md:31`). Receipts must not ride a server action. They go through a route handler (the `/api/q-room` precedent, `apps/web/app/api/q-room/route.ts:9-14`).

## 2. Current behaviour (base `fe5579c3`)

- **Seam.**
  - `apps/web/src/features/q/ui-act-controller.ts:13-53`: one handler per id, and `performUiAct` reports TARGET_MISSING when nothing is registered.
  - No page registers anything. No receipt leaves the browser (`onUiActReceipt` has no listener).
  - No act waits for navigation, and there are no built-in page acts (scroll, back, forward).
- **Client actions.**
  - `apps/web/src/features/q/client-actions.ts:381-384` performs UI_ACT fire-and-forget.
  - `SCREEN_ACT` (`:198-240`) scrolls by DOM id with no receipt.
  - `GO_BACK` only; there is no Forward.
- **Typed follow.**
  - `follow-navigation.ts:34-63` collects actions, then navigation.
  - `q-session.tsx:451-456` performs the actions _before_ `router.push`. A chained act would therefore run on the old page.
- **Voice follow.** `apps/q-api/src/voice/navigation.ts:23-43` keeps only the latest client action, so a chain of acts on the voice line collapses to its last step.
- **Tools.**
  - `packages/q-tools/src/tools/client-actions.ts`: `open_page` (`:564`), `control_screen` (`:1068`), `control_document` (`:1122`). All resolve to `SCREEN_WILL_DO_IT` with no receipt.
  - There is no `operate_screen` tool, although its name is reserved in `Q_CLIENT_ACTION_TOOLS` (`packages/contracts/src/q/ui-intent.ts:638`).
- **Manifest.**
  - `apps/web/src/features/q/manifest.ts:239-278` never fills `controls`.
  - The model-facing screen fact is `packages/model-gateway/src/q/manifest-fact.ts` (B). It does not render controls.
  - The tool context has no manifest (`packages/q-runtime/src/application/orchestration.ts:402-432`).
- **Documents.**
  - `document.rename` and `document.archive` exist (`packages/app-actions/src/actions/document-manage.ts`). The Q tool `delete_document` is the page's soft Delete, which can be undone (`apps/web/src/features/documents/document-library.tsx:553-575`).
  - The approval card does not name the document: the composition's `nameOf` returns null for DOCUMENT (`apps/q-api/src/main.ts:3110`). That breaks "destructive actions show the exact target".
- **Parity test.** `apps/q-api/test/route-capability-parity.test.ts:798-961` classifies routes and pages but not controls.

## 3. Design

### 3.1 Control registry (C1): `apps/web/src/features/q/control/`

- **`registry.ts`.** A per-tab store of registered controls `{id, kind, element(), state(), count(), onAct?, order}`.
  - It validates ids with the contract regex. A duplicate id replaces the older registration only while the newer one is mounted.
  - It publishes `manifestControls()`, bounded to `Q_MANIFEST_CONTROLS_MAX` (48). Ordering: dialogs, then tabs, sections, lists and the rest. Hidden controls (`[data-q-hidden]`) and disconnected elements are left out.
  - State is read live from ARIA: `aria-selected` or `aria-current` → SELECTED; `aria-expanded` → OPEN/CLOSED; `aria-pressed` or `aria-checked` → ON/OFF; `disabled` or `aria-disabled` → DISABLED.
- **`use-q-control.ts`.**
  - `useQControl({id, kind, ref, onAct?, count?})` for client components.
  - `<QControl id kind>` for server components. It is a `display: contents` wrapper that acts on its first focusable or boxed child, so there is no layout change.
- **Default acts by kind**, each the element's own click (registration only, no redesign):

  | Kind              | Acts                                                                                                                          |
  | ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
  | TAB               | SELECT_TAB, ACTIVATE → click (no-op DONE when already selected)                                                               |
  | SECTION           | SCROLL_TO → scrollIntoView; FOCUS                                                                                             |
  | LIST              | SELECT_ITEM n → the nth `[data-q-item]` (else `li` / `[role=listitem]`), clicking its first link or button; NEXT/PREVIOUS N/A |
  | DISCLOSURE / MENU | EXPAND/OPEN, COLLAPSE/CLOSE → click only when the state differs                                                               |
  | TOGGLE            | SET → click when it differs                                                                                                   |
  | BUTTON            | ACTIVATE → click (only non-consequential buttons are registered; see 3.6)                                                     |
  | INPUT             | FOCUS                                                                                                                         |
  | DIALOG            | CLOSE → `onAct`, or the dialog's own close button                                                                             |
  | FILTER, CAROUSEL  | via `onAct` only                                                                                                              |

  An act a kind does not support → NOT_APPLICABLE. A disabled control → NOT_APPLICABLE.

- **Verification.**
  - A TAB or TOGGLE reports DONE only once its state has changed (polled for at most 6 s). Otherwise it reports FAILED.
  - SELECT_ITEM reports DONE when the click ran and the URL changed or the item became selected or current.
  - Other acts report DONE when the handler returned.
- **Page acts** (no target): SCROLL_DOWN/UP/TOP/BOTTOM on the shell's scroller, BACK and FORWARD via `history`.
- **Manifest** (minimal edit to `manifest.ts`, which is not C-owned): `currentManifest()` adds `controls`, and the seq moves when controls change.

### 3.2 Act queue and receipts (C2): `ui-act-controller.ts`

- **Sequential queue.** Acts run in arrival order, so one answer's chain (navigate → tab → scroll) runs as steps. Each step waits for the previous receipt.
- **Navigation epochs.**
  - `goTo` and the typed and voice follow call `expectNavigation()`. The queue then holds until the route trail (`useQRouteTrail` in the shell) reports the new path, with a 6 s cap.
  - After a navigation, a step waits up to 4 s for its target to register (the new page mounting). Only then does it report TARGET_MISSING. This is the "wait for the new manifest" requirement, and it never runs on the old page.
- **Receipts.**
  - Every act yields exactly one receipt with the manifest seq after it.
  - The receipt is kept in a local ledger (the last 16), emitted to `onUiActReceipt` listeners, and posted in batches by `control/receipt-reporter.ts` → `POST /api/q-ui-acts` (a web route handler, not a server action, per C-08) → q-api `POST /v1/q/ui-act-receipts`.
  - The post carries `{intent, receipt}` pairs validated by the lead contracts, plus the fresh manifest.
- **q-api.**
  - `apps/q-api/src/http/ui-act-receipts.ts` (new): a protected route. The actor is resolved on the server, and receipts are keyed by tenant and user, never by anything the request names.
  - It writes to an in-process bounded ledger (32 per person, 10-minute TTL). This is ephemeral screen state, as with the Q room feed.
  - It exports `recentUiActReceipts(actor)` and `receiptFacts(receipts)`. The latter gives sentences like "Your last screen act: SELECT_TAB tab.mandate → TARGET_MISSING".
  - B puts those into the next turn's context, and A into the voice line (requests §5).
- **Visible honesty.** `control/receipt-notice.tsx` is an `aria-live=polite` line in the shell. For a non-DONE receipt it says, for example, "Q couldn't find that on this page." Q's answer text was phrased as intent (the tool description says so), and `screen-claims.ts` (B) already blocks unbacked "it's on your screen" claims.

### 3.3 `operate_screen` (C2): `packages/q-tools/src/tools/client-actions.ts`

- **Input.** `{act, target?, index?, value?}`.
  - `target` is a semantic id (`tab.mandate`) or a short name (`mandate`).
  - Resolution is against the **control catalog** (`packages/q-tools/src/tools/control-catalog.ts`). The catalog is generated by `scripts/recovery/control-catalog.mjs` from the literal registrations in `apps/web`.
  - When the run supplies the screen's controls (option `screenControls`, see the lead request), resolution is against those first.
- **Outcomes.**
  - Exactly one match → allowed: a UI_ACT intent with a fresh `actId` (`uia_` + 20 random characters).
  - Several matches → denied with "More than one matches: tab.mandate, section.mandate. Ask which one." This is the disambiguation path.
  - None → denied with the closest catalog ids.
  - An act the kind does not take → denied.
- **Same lane as the other client actions:** LOW_RISK_INTERNAL, own conversation, approval NONE. The description tells the model that the act happens after the answer and to phrase it as intent ("Opening the Mandate tab"), never as done.
- **Chains.** The model calls it once per step after `open_page`. The answer carries the UI_INTENT blocks in order (`model-gateway/src/q/index.ts:2765-2789` keeps order and distinct acts).
- **Typed follow.** `follow-navigation.ts` returns `steps` in answer order.
- **Voice.** `apps/q-api/src/voice/navigation.ts` adds `clientActions` (all, in order) beside `clientAction` (kept for compatibility). A consumes `clientActions` (request).
- **Capability registry.** A `tool("operate_screen", "NAVIGATION", …)` entry in `packages/q-tools/src/capabilities.ts` (a minimal edit).

### 3.4 Navigation (C3)

- Every route stays on the fixed route maps: `destinationPath`, `recordPagePath` and `settingsPath`. There are no model paths.
- BACK and FORWARD become UI acts.
- "Return to the page I was on": `useQRouteTrail` keeps the in-app trail. BACK is a real history step, so the person and Q share one history.
- Nested tabs are reached by `open_page` then `operate_screen SELECT_TAB`, or directly by the existing deep links (`/capital?tab=…`, `/company/<id>?tab=…`).
- Records are reached through `open_page` (existing, server-resolved ids).

### 3.5 Documents (C4)

Mapped in the matrix to existing capabilities:

| Need                          | Capability                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| Find                          | `list_uploaded_documents`, `list_my_documents`                                      |
| Open                          | `open_page` DATA_ROOM_DOCUMENT / DOCUMENT                                           |
| Read a section, search within | `read_document_pages` and `read_my_document` (B)                                    |
| Summarize                     | `control_document` SUMMARISE                                                        |
| Download                      | `control_document` DOWNLOAD: the viewer's signed read, an anchor download, no popup |
| Rename                        | `rename_document`                                                                   |
| Delete and restore            | `delete_document` with `restore`                                                    |

Change: `document.rename` and `document.archive` gain `counterpartOf`, which reads the document's title through the action's own port as the proposer. The approval card then names the exact target and consequence, for example: Delete "Seed deck.pdf". The page's Delete is a soft delete that can be undone, and that is what Q's `delete_document` does too.

**There is no permanent delete anywhere in the product.** SPEC §4.2 says archive and delete are distinct. Adding a hard delete is a product and migration decision, flagged to the lead and not invented here.

### 3.6 Forms (C5)

Every form field Q fills is an existing app action. The matrix maps each one:

| Form                | Action                                                                   | Lane                                       |
| ------------------- | ------------------------------------------------------------------------ | ------------------------------------------ |
| Company description | `company.profile.update` via `update_my_profile`                         |                                            |
| Target raise        | `capital.objective.change` (`change_my_raise`)                           | Prepare → Approve                          |
| Team member         | `team.invite`; `company.team.me.upsert`                                  |                                            |
| Profile picture     | `offer.profile_photo_upload`: the file picker needs the person's gesture | Q opens the screen and focuses the control |
| Save / unsave       | `save_company` / `unsave_company`                                        | instant                                    |
| Prepare a message   | `propose_chat_message`                                                   | approval                                   |
| Meeting             | `propose_meeting`                                                        | approval                                   |

- A registered BUTTON is never consequential. The catalog marks each BUTTON `consequential: false`. A control that commits a consequential change is not registered as a BUTTON; its capability is the app action.
- Persistence is confirmed by the action's own `done(out)` after `run` returns (`packages/q-tools/src/tools/app-actions.ts:334-338`), never by a click.

### 3.7 Capability Parity Matrix (C6)

- `scripts/recovery/capability-parity.mjs` reads:
  - the web pages (`app/**/page.tsx`);
  - the literal control registrations (`useQControl` / `<QControl`);
  - `APP_ACTIONS` and `PERSON_ACTIONS` (from the built package);
  - the route coverage in the parity test.
- It writes `docs/recovery/capability-parity.md` (control rows with the columns asked for) and the catalog `control-catalog.ts`.
- The parity test gains:
  1. Every control id registered in source is in the catalog, with a Q capability (`tool.operate_screen` for UI acts) whose act set covers its kind.
  2. Every catalog id is still registered (no stale rows).
  3. Every BUTTON in the catalog is non-consequential.
  4. The matrix on disk is current (regenerated, compared).

## 4. Files

**C-owned:**

- `apps/web/src/features/q/control/{registry.ts, use-q-control.ts, q-control.tsx, route-trail.ts, receipt-reporter.ts, receipt-notice.tsx, *.test.ts(x)}`
- `ui-act-controller.ts`, `client-actions.ts`, `follow-navigation.ts`
- `apps/q-api/src/voice/navigation.ts`
- `packages/q-tools/src/tools/{client-actions.ts, control-catalog.ts}`
- `packages/app-actions/src/actions/document-manage.ts`
- `apps/q-api/test/route-capability-parity.test.ts`
- `docs/recovery/capability-parity.md`, `scripts/recovery/{control-catalog,capability-parity}.mjs`
- Registrations in pages and features: Discover, Explore, Capital, the company page, the investor page, Relationships, Documents, Work, Settings, Profile, GateQ, Schedule.

**Minimal edits outside C, listed for the lead:**

- `apps/web/src/features/q/manifest.ts`: adds controls.
- `apps/web/src/features/q/q-section.tsx`: each QSection also registers `section.<id>`.
- `packages/q-tools/src/capabilities.ts`: one tool entry.
- `packages/q-tools/src/tools/index` exports.
- `packages/contracts/src/q/index.ts`: one export line for the new `ui-act-receipts.ts`.
- `apps/q-api/src/app.ts`: route registration.
- New `apps/web/app/api/q-ui-acts/route.ts`.

## 5. Requests to the lead

1. **Export** `packages/contracts/src/q/ui-act-receipts.ts`, which holds the report envelope and `Q_UI_ACT_RECEIPTS_PATH`. The frozen `ui-act.ts` is unchanged.
2. **Q runtime.** Add `screen?: { controls: QManifestControl[] }` to `QToolExecutionContext`, filled from the run request's manifest. `operate_screen` then resolves against what is on screen now, before the catalog.
3. **B.**
   - Render `manifest.controls` (id, kind, state, count) into the screen fact (`manifest-fact.ts`). Without this, the model learns ids only from the tool description and catalog.
   - Add `receiptFacts(recentUiActReceipts(actor))` to the next turn's context.
   - Offer `operate_screen` in the core tool set beside `control_screen`.
4. **A.** Perform `followOfAnswer(...).clientActions` in order on the voice line instead of the single `clientAction`, and say non-DONE receipts.
5. **E.** Optionally render the receipt line inside the Q conversation instead of the shell notice.
6. **Product.** Decide whether a permanent document delete exists (§3.5).

## 6. Tests

- **Web.**
  - `control/registry.test.ts`: register and unregister; manifest controls bounded and ordered; hidden controls dropped; ARIA state.
  - `ui-act-controller.test.ts`:
    - TARGET_MISSING;
    - NOT_APPLICABLE for a disabled control or a wrong kind;
    - FAILED when the handler throws;
    - sequential chain;
    - wait-for-registration after `expectNavigation`;
    - BACK and FORWARD;
    - one receipt per act.
  - `q-control.test.tsx` (React Testing Library): a tab registers, SELECT_TAB clicks the real element and DONE requires `aria-selected`; a list's SELECT_ITEM clicks the nth item; a section scrolls.
  - `follow-navigation.test.ts`: ordered steps.
  - `receipt-reporter.test.ts`: batching, and the post shape validated by the contract.
- **q-tools.** `operate-screen.test.ts`: exact id, short name, ambiguity, unknown id, kind/act mismatch, not their own conversation, and the screen controls preferred over the catalog.
- **q-api.**
  - `ui-act-receipts.test.ts`: auth required; receipts are keyed by the server-resolved actor (person A cannot read or write B's); bounds; TTL; invalid bodies get 400.
  - `voice/navigation.test.ts`: `clientActions` order.
  - The parity test extensions (3.7).
- **app-actions.** The card names the document (rename, delete and restore).

## 7. Risks

- **Registration coverage** across about 70 pages is wide. Priority goes to the scenario pages (Capital readiness, Discover, investor, company tabs, Documents). The matrix shows every page's control count, so a gap is visible rather than silent.
- **Receipts reach the model only after B wires them in** (request 3). Until then the shell notice is the visible truth and the next turn does not know.
- **Ledger.** In-process memory for the receipt ledger is acceptable for ephemeral screen state on one q-api instance. With several instances a receipt could land on another. Mitigation: the next turn's run request can also carry the browser's own last receipts, which is a later contract request if needed.
- **State verification** may report FAILED on a slow server-rendered tab after 6 s, even when the tab then opens. That is a bounded false negative, never a false DONE.

## 8. Acceptance checklist

| Item                                                                                      | SPEC / TRACKING       |
| ----------------------------------------------------------------------------------------- | --------------------- |
| Registry plus page registrations; controls in the manifest                                | C1; Scenarios A, B    |
| `operate_screen` with receipts, chains, disambiguation                                    | C2; Scenarios A, B, E |
| Navigation to every route, tab and record; Back, Forward; return                          | C3; Scenarios B, E    |
| Document find, open, read, search, download, rename, delete/restore with the exact target | C4; Scenario C        |
| Forms through app actions, persistence confirmed, approval-bound                          | C5                    |
| Generated parity matrix; the parity test fails on an uncovered control                    | C6; SPEC §5 matrix    |
