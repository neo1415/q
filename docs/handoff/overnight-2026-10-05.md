# Overnight build, 2026-10-04 → 2026-10-05

Live on production since **06:38 UTC, 5 Oct**. All four services report SUCCESS on commit `e0934ef4`, which is on all three branches. The hosted database is at 145 migrations, with none missing.

---

## Executive summary

Every item on the overnight list is built, merged, tested and deployed. The two later requests (the landing page from the video, and the 3D Q presence) are live too.

| #   | What you asked for                                                      | What you'll see now                                                                                                                                                                                                                                                                                                                                                         |
| --- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Relationships** UX: next steps unclear, plain text list, search first | Search comes first. Each relationship is a card with its **next step as a button** (Answer, Reply, Upload & share, Review files, Rehearse…), ordered by what needs you.                                                                                                                                                                                                     |
| 1b  | **Diligence**: upload on the request, requester downloads, Q reads it   | The founder uploads **on the request itself** (one step). The investor sees "Viewed" status and downloads, and **Q reads the file and sends the requester a one-line summary** in a notification.                                                                                                                                                                           |
| 2   | **Capital**: cards, rounds, money confirmed sent/received               | Capital is cards: **current round** (raised, confirmed and pledged against its target), **total raised**, other rounds, and commitments grouped by next step. Each commitment moves **Detected → Confirmed → Transfer sent → Received**, the other side is told at every step, and Q can do it too ("Nixo sent the money").                                                 |
| 3   | **Work** page: 4 duplicate "call ended, send the recap?" cards          | **Fixed at the root.** One card per counterpart ("2 calls with X · Send recaps?"). There's no card once you've followed up. "Not now" holds until a newer call.                                                                                                                                                                                                             |
| 4   | **Documents**: view toggle, better UX, pagination everywhere            | Grid/list toggle, search, sort, filters, previews, "Q has read it" labels, drag-and-drop upload with progress, rename, delete with undo, and "Show more" paging. Notifications page by cursor too.                                                                                                                                                                          |
| 5   | **Q failures**: "read my website", "can't access the internet"          | **Both root-caused and fixed.** Q's research tools were being dropped by the tool limit. Website addresses are normalised (bare domain → https, http fallback). Q can now read a site you name directly.                                                                                                                                                                    |
| 5b  | "Increase the tool limit… at the speed of light"                        | The per-turn tool cap went from 40 to 127, the per-request cap is now 128 (the providers' maximum), and **`use_capability`** lets Q load any permitted tool mid-turn. Research and URL tools are always kept in focus.                                                                                                                                                      |
| 6   | **Results** ("a toy") and **Rehearsals** redesign                       | Results is a real dashboard: headline cards, activity charts, investor pipeline by stage (tap to drill down), commitments, response time, and a 7d/30d/all-time picker. Rehearsals leads with "Start a rehearsal", people as avatar cards, and a score trend.                                                                                                               |
| 7   | **Settings, Usage, Billing**                                            | Settings is grouped cards with a section index. Usage has headline cards, a spend chart and a breakdown. Unknown shows "None yet", never $0. Billing has plan cards (Founder $49 / Investor $149 / Fund $990, marked _Preview pricing_), all in one file so they're easy to change.                                                                                         |
| 8   | **Admin brand theming** in a few clicks                                 | **Admin → Brand**: quick-pick swatches or any hex, live light/dark preview with contrast ratios, Save and Reset. The whole app recolours, kept readable (WCAG AA) automatically. Admin-only, enforced on the server.                                                                                                                                                        |
| 9   | **Landing page** exactly like the video                                 | It's live at `/` for signed-out web visitors after the splash. It matches the video section by section at 1440. It measured LCP ≈ 0.5 s, no layout shift and 50–58 fps while scrolling. PWA and signed-in users skip it.                                                                                                                                                    |
| 10  | **Captions** on all videos                                              | Root cause: captions were never requested. **All 13 pitches now have captions ready at Cloudflare Stream** (backfilled; $0, since Stream AI captions are free). New pitches get them automatically within about 90 s of publishing.                                                                                                                                         |
| 11  | **Voice** breaks on a bad network                                       | Duplex voice watches packet loss, jitter and round-trip time. It rides out short drops (2.5 s) and falls back to standard voice with a visible "Weak connection" note. A dead mic, an unplugged device or a backgrounded tab are repaired in place. Standard voice reconnects on the **same conversation**.                                                                 |
| 12  | **GateQ as "Tavus for Q"**                                              | A one-line script for any fund's website adds a **"Do we fit? Ask Q"** button. Q interviews the founder and gives _fits / partial / not a fit_ with the mandate's reasons, then shares with the fund **only with consent**. Investors get a **Gateway** page: paste or upload the mandate, Q drafts the rules, they edit and publish, then copy the snippet and preview it. |
| 13  | **3D Q presence**                                                       | Q is now a real 3D particle swarm (WebGL2, 2.7 KB), wherever Q appears in the app: the Q page, the Dock, voice and loaders. It keeps every state and gesture. It leans toward the cursor and falls back to the 2D swarm on weak devices.                                                                                                                                    |

### Check these before the demo

1. **GateQ inside a real embed.** Put the snippet on any page and press "Start with Q". This worked in the direct page, but in the worker's test harness the swarm didn't draw inside the iframe. If it's blank, the conversation still works.
2. **Captions.** Open any pitch on Discover with captions on.
3. **Brand colour.** Change it in Admin → Brand, then press **Reset** before the demo, unless you want to show it live.
4. **Capital.** Your $1M and $500K from the Nixo call are both DETECTED. A relationship holds **one open pledge**, so confirming the second replaces the first. Confirm the one you want to present.

---

## Technical details

### How the night ran

The work was split into nine packets, each built by its own worker on a separate git worktree and branch. The lead merged each branch, ran the full gates, applied migrations to the hosted database in order, and pushed. Railway auto-deploys from `recovery/2026-09-12`.

- **Worker outage:** every worker died at about 23:00 UTC on the session usage limit. They were resumed with their worktrees intact.
- **Container restart:** one container restart (out of memory during gates) stopped the GateQ worker; it was resumed from its pushed commits.
- **Disk:** it filled at about 05:20. Eleven merged worktrees were removed, freeing about 7 GB.

### Merges (first-parent, on `recovery/2026-09-12-8y2j4w`)

| Commit     | Packet                                                                |
| ---------- | --------------------------------------------------------------------- |
| `fed03c9b` | DB fix: bench-account interest notices on Nixo and Ajopot marked read |
| `c02e54e4` | **P1** Relationships and Diligence                                    |
| `625b63c1` | Test fixtures carry the pitch-download field                          |
| `8fce5350` | **P2** Capital rounds and commitment lifecycle                        |
| `e74a4f29` | **P11** 3D Q presence                                                 |
| `ec8bcd60` | **P4** Work dedupe, Results, Rehearsals                               |
| `ec8207d4` | **P6** Captions and voice resilience                                  |
| `95681b32` | **P3** Documents, pagination, Q research and tools                    |
| `d2416714` | **P9** Landing page                                                   |
| `0746abc3` | Test classification updates after the merges                          |
| `a1b0019c` | **P5** Settings, Usage, Billing, brand theming                        |
| `ac46f1e1` | **P7** GateQ embed and Gateway                                        |
| `e0934ef4` | Formatting                                                            |

In total, 294 files changed, with 31,200 insertions and 4,911 deletions.

### Migrations applied to hosted (in order)

| Version                                                 | What it does                                                                                                                                                   |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261205100000`                                        | Bench notices marked read. Bench relationships were **kept**, since deleting relationship history is forbidden.                                                |
| `20261206090000_network_diligence_views_and_summaries`  | `network.diligence_document_views` and `network.diligence_document_summaries`. Server-only: RLS on, no grants.                                                 |
| `20261206100000_capital_rounds_and_commitment_receipts` | `core.capital_rounds`; commitment round, transfer-sent and receipt columns; commitment notices.                                                                |
| `20261206110000_documents_page`                         | Three indexes for document paging and search.                                                                                                                  |
| `20261206120000_brand_theme`                            | `platform_ops.brand_themes`: a platform default plus at most one per tenant, server-only, lowercase `#rrggbb` only.                                            |
| `20261206130000_gateq_embed`                            | `gateq.policy_extractions`: stores a hash of the mandate and the proposed rules, **never the mandate text**. Tenant-enforcing triggers; no updates or deletes. |

### P1: Relationships and Diligence

- **Relationships list.** Search is first. Each card shows the person's photo and the next step as a labelled action, mapped from the notification kind (`relationships-view.ts` → `actionFor`). Ordering puts what needs you first. There are loading, empty and error states.
- **Diligence, founder side.** Upload and share is one step on the request. A "Viewed" status is recorded per document view.
- **Diligence, Q summary.** When a shared document is ready, a worker handler (`withDiligenceSummary`) has Q read it through the Model Gateway. Q writes the requester one line, stored in `diligence_document_summaries` and delivered as a named notice.
- **Pages.** New Diligence and Calls pages are classified for route parity (ADR 0040).

### P2: Capital

- **Rounds.** `core.capital_rounds` holds the round target, raised and confirmed amounts. The current round's target follows the raise objective by default.
- **Commitment lifecycle.** Each commitment moves `DETECTED → CONFIRMED → TRANSFER_SENT → RECEIVED`:
  - each step is an idempotent, declared app action;
  - the new Q tool `commitment_step` lets Q move it on request, with approval;
  - each step tells the other side through `withCommitmentNotices` (workers) and the new notification kind `COMMITMENT`, which opens `/capital`.
- **Money** is `numeric` plus currency, end to end.
- **Web.** `capital-book.tsx`, `round-card.tsx`, `commitment-card.tsx`, `open-round.tsx`; the old `fundraising-panel.tsx` was removed.
- **Rule:** one open pledge per relationship. Confirming a new amount replaces the old one; both are kept in history.

### P3: Q research, tools, Documents, pagination

- **Root cause (run 13955ca2).** For an own-company question, 81 tools were ranked and the three public-web tools sat at positions 42–44, past the 40-tool cap. Fixes:
  - research and URL tools are pinned when the reader says the turn is research, or the message contains a URL or domain;
  - the caps are now 127 per turn and 128 per request;
  - the new always-on `use_capability` tool loads any plan-permitted tool for the next step and logs `q.capability_loaded`. It never returns a tool the plan forbids;
  - "Try again" keeps the previous turn's tools.
- **Websites.** `extract_public_web` now also accepts an address the person wrote themselves (ADR **0048**). Addresses are normalised to https with one http fallback. Private IPs, `javascript:` and `file:` are still refused (`q-research/src/domain/url-safety.ts`).
- **Embeddings.** The embedding runtime isn't configured in production, so retrieval falls back to keyword search. It now warns once instead of logging an error on every turn. A paid external embedding provider was deliberately not wired, for privacy.
- **Documents.**
  - Rename, soft delete with undo, and restore. A deleted deck stops being downloadable immediately; restoring it doesn't re-share it.
  - Q can do the same through `rename_document` and `delete_document`, with approval.
  - Cursor paging, and a 60-second owner download link.
  - The page has grid and list views (remembered per device), search, sort, filter chips, a menu and drag-and-drop upload.
  - New event: `evidence.document.details_changed`.
- **Pagination.** Fixed for documents and notifications. Results, Relationships (newest 200) and the admin queues are capped, not unbounded. See `docs/handoff/pagination-audit.md`.

### P4: Work, Results, Rehearsals

- **Duplicate cards.** The meeting query joined participant rows, so a person listed twice got two cards. Now:
  - each meeting is read once;
  - it is "followed up" if you wrote to that side after the call, or Q proposed that call's follow-ups (matched on the `meet:<meetingId>:` keys);
  - calls with the same counterpart group into one card.
- **Results.** The read now also returns: a 7-day range, an activity series, response time (median, answered and waiting), diligence asked and answered, investors engaged, commitments by status per currency, and the pipeline by stage. All of it is deterministic, with no model involved.
- **Rehearsals.** UI only: a 0–100 score trend, and filtering by person showing the change from one rehearsal to the next.

### P5: Settings, Usage, Billing, brand theming

- **Settings.** Seven cards: Account, Appearance, Q, Notifications, Connections, Plan and billing, Privacy. Every existing control is kept, and no fake controls were added.
- **Usage.**
  - Voice minutes aren't tracked yet, so the page says "Minutes not measured yet".
  - Model-call counts aren't shown to people (design-48).
- **Billing.**
  - Plans live in `apps/web/src/features/billing/plan-tiers.ts`, one versioned file with prices as decimal strings.
  - The payment card says online payment isn't switched on yet and has no card form.
  - The real "Manage billing" button appears only when a payment-provider account exists.
- **Brand theming.**
  - Routes: `GET /v1/brand-theme` for any signed-in member; `GET`/`POST /v1/admin/brand-theme` gated on the existing `flags.write` admin permission with step-up. Anyone else gets 404.
  - The layout rewrites only the three accent tokens.
  - Colour math keeps the hue and moves lightness until button text and links reach AA.
  - Q's presence colours are untouched.
- **Parity test.** Operations-console routes are excluded from the hand-written write-route count (ADR 0040 already exempts them), and the limit was lowered to 77.
- **Limitation:** the admin page sets the platform-wide colour. Per-tenant colours exist in the database and API but have no UI yet.

### P6: Captions and voice

- **Captions.**
  - The API checks every 90 seconds for published pitches without captions and requests them from Stream.
  - The playback route waits up to 3 seconds to collect captions Stream has just finished.
  - Failed captions aren't retried forever.
  - The backfill script is `scripts/handoff/live/caption-backfill.mjs` (dry run by default). After `--apply`, all 13 pitches show 13/13 ready.
- **Duplex (realtime) voice.**
  - It watches WebRTC stats (loss, jitter, RTT) and switches to standard voice after about 2 seconds of a bad line, with a visible message.
  - A brief disconnect gets 2.5 seconds to recover.
  - A dead mic or a device change gets a fresh track swapped into the same call.
  - The jitter buffer is 150 ms.
- **Standard voice.**
  - A stalled socket (2 seconds of unsent audio) is closed and retried.
  - A connection that fails to open is retried.
  - A silent mic is restarted within about 2.5 seconds.
  - It shows "Reconnecting…" and resumes the same conversation id, with backoff of 1.2 s, 3 s and 8 s.

### P7: GateQ "Do we fit? Ask Q"

- **Snippet:**

  ```html
  <script
    src="https://capital-qweb-production.up.railway.app/gateq.js"
    data-gate="gq_…"
    async
  ></script>
  ```

  The snippet draws a launcher in a closed shadow root. The first press opens `/g/<id>/embed` in a sandboxed iframe, full-screen on phones. It reads nothing from the host page, sets no cookies and stores nothing.

- **Fit decision.** GateQ's deterministic rule engine decides (fits / not a fit / partial when rules are still unknown). The model only phrases the interview, through the Model Gateway.
- **Consent.** "Share with <fund>" first shows exactly what the fund will see. Nothing is sent before that press.
- **No canonical relationship is created for anonymous founders.** The locked GATE-002 rule forbids creating a company for them, so shares land in the investor's GateQ inbox. Turning a share into a relationship would need an account-claim step. That is a deliberate follow-up, not a bug.
- **Investor Gateway page** (`/gateway`).
  - Paste the mandate or upload a .txt/.md file. PDF isn't supported yet.
  - A **rule-based reader** over the reference taxonomy drafts the rules, with no model call. Anything it can't find stays unknown.
  - The investor edits Required/Preferred and the values, then presses Publish (admin-only).
  - The page also shows the snippet with a copy button, a live preview and "Founders who shared".
- **Rate limits:** 60 new conversations per gateway per 10 minutes (API), 8 per visitor per 10 minutes (web), and the existing per-session limits.

### P9: Landing

- **Build.** Server-rendered and prerendered. Only the animated scenes are client code, and they load as they near the viewport. Hanken Grotesk is self-hosted. `--cq-landing-*` tokens. The old landing was deleted.
- **GateQ try-it.** It runs the real `packages/gateq` engine against the fictional Demo Ridge policy.
- **Fidelity.** Nine passes. Every section at 1440 matches the reference pixel for pixel, except where the random particles land.
- **Phone layout.** At 390 the demo window holds its tallest height, so cards opening don't shift the page (CLS 0.0024 instead of about 0.17).
- **Hero swarm.** The landing keeps the prototype's own swarm, because it is what the video shows. Switching to the shared 3D component is a one-file change in `landing/swarm-slot.tsx`.
- **Live check.** Screenshots of production at 1440 and 390 showed no console errors.

### P11: 3D presence (ADR 0049)

- **Rendering.** Raw WebGL2 point sprites, one draw call, 5.6 KB (2.7 KB gzipped), behind a dynamic import. three.js was not used.
- **Fallback.** The 2D swarm draws when WebGL2 is missing, the context is lost, or the device asks for light work (Save-Data, low memory).
- **Performance.** The point count scales with CPU cores and DPR is capped at 2. A frame-budget guard sheds points, then DPR. It never animates offscreen or in a hidden tab.
- **Reduced motion:** one still 3D frame.

### Gates on the final head (`e0934ef4`)

- **Packages:** build 51/51.
- **Typecheck:** root `tsc` and per-app `tsc` (api, q-api, workers, web) clean.
- **Unit tests:** **762 files / 8,629 tests passed** (`--maxWorkers=1`), run after P5. GateQ's merge was then covered by targeted tests (162 passed) and its worker's 1,358.
- **Integration:** **89 files / 664 tests passed**, 6 skipped.
- **pgTAP:** 1,893+ tests. Two fail **only locally**, `320_ai_ops` #21 and `730_model_usage_voice_realtime` #7. Both count today's rows, and a worker left 6 synthetic `ai_ops.model_usage` rows in the local database today (append-only, so they can't be deleted). No code changed.
- **Web build:** `pnpm build` passed.
- **Lint and format:** eslint clean on every TS file changed tonight; prettier clean on changed files. The repo-wide `format:check` warnings are pre-existing.
- **Deploy:** Railway shows api, q-api, workers and web all SUCCESS at 06:38 UTC. `/health/live` returns 200 on api and q-api.

**Earlier failures:** the delegated-work integration test failed three times while five workers loaded the machine. It passed three times in a row afterwards, and no code in its path changed.

### Known limitations and follow-ups

1. **GateQ:**
   - Confirm the iframe on staging, and the swarm inside it.
   - PDF mandate upload.
   - Adding values in the rules editor.
   - An account-claim step to turn a share into a relationship.
   - A Q tool that drafts rules itself.
2. **Brand theming:** per-tenant UI.
3. **Documents:**
   - Rename and Delete appear only on uploaded files, not on documents Q made.
   - Previews draw the title, not the real first page.
   - Search, sort and filters cover only documents already loaded.
4. **Pagination:** Results, Relationships and the admin queues are capped, not cursor-paged.
5. **Embeddings:** not configured in production, so retrieval uses keyword search.
6. **Usage:** voice minutes aren't tracked.
7. **Captions:** confirm $0 on the Cloudflare invoice.
