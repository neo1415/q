# GateQ gateway self-service (B6 branding, B7 embed, pause/reopen): live verification, 14 Nov 2026

- **Production:** d2ce8c91e on Railway; migration `20261231570000_gateq_gateway_appearance` applied.
- **Account:** `investor.kilima-angels.njeri-kamau@fictional.capitalq.local` (organisation_owner and organisation_admin of Kilima Angel Network (fictional)). Signed in through the web form with `CQ_SEED_ACCOUNT_PASSWORD`.
- **Browser:** Playwright with `/opt/pw-browsers/chromium`, deviceScaleFactor 1, desktop 1440×900 and phone 390×844.
- **Gateway:** `1b4dfdfb-8b5f-48a6-833d-0df9fce2b42f`, publicId `gq_7aekqs9vfk8kvavm8k7tcacryn`, organisation `68ecc541-…`, tenant `a27357f9-…`.
- **Starting state:** the gateway was ACTIVE. `gateq.gateway_appearances` had no rows (no accent, no embed origins). The embed sent `frame-ancestors *`.
- **Ending state:**
  - The gateway is ACTIVE.
  - Revision 2 holds no accent and no origins (`82e0eec4-b019-4905-b263-5aa9ce3b89fc`).
  - The embed sends `frame-ancestors *` again.
  - No Q approval is pending.
- **Evidence:** screenshots and scripts are in `/tmp/claude-0/-home-user/baac2e44-f461-5146-93f5-14f30f7b1f41/scratchpad/b67live/` (`shots/`). The scratchpad is not durable.

## Results

| Step                       | Verdict              | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Accent and embed origin | **PASS**             | The panel is on `/gateq?tab=gate` and its buttons are "Pause gateway" and "Save".<br><br>Steps taken:<br>1. Entered `#0f766e` as the accent. The preview showed contrast of 5.2:1 for fill and 5.5:1 for text.<br>2. Entered `https://kilima.example` as the embed site.<br>3. Saved. The panel showed "Saved. Your public gateway shows it now."<br>4. Reloaded. The values were kept.<br><br>Public `/g/<publicId>`:<br>- The light theme uses `--cq-accent:#0f766e` (already AA, so not changed) and hover `#00675f`.<br>- The dark theme adjusts it to `#469e95`.<br><br>Hosted read: revision 1 is `9fbffebe-025b-446e-983d-83c512ea7373` (`#0f766e`, `{https://kilima.example}`), created by Njeri. It is append-only: the restore added revision 2 and changed nothing in revision 1.                                                                                                                                                                                                                                                                                                                                                                                   |
| 2. CSP frame-ancestors     | **PASS**             | `curl /g/<publicId>/embed` returned `content-security-policy: frame-ancestors 'self' https://kilima.example`.<br><br>Non-embed paths keep the default policy, `x-frame-options: DENY` and no frame-ancestors override:<br>- `/g/<publicId>`<br>- `/gateq`<br><br>Unknown publicId embed: `frame-ancestors 'self'` (fails closed).<br><br>After the restore, the embed returns `frame-ancestors *` again.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 3. Pause and reopen        | **PASS (with note)** | Pausing showed "Your gateway is paused. Its page and embed no longer take applications." The status changed to Paused and the button to "Reopen gateway", and both survived a reload.<br><br>While paused:<br>- `/g/<publicId>` and `/embed` both return **HTTP 404**, showing the generic "This page isn't here".<br>- There is no form and no start button, so an applicant cannot start. The server's `public-projection.ts` returns null for a gateway that isn't ACTIVE.<br>- The embed's CSP falls back to `'self'`.<br><br>Reopening showed "Your gateway is open again." The page and embed returned 200 with the "Apply to Kilima…" form, and the embed's CSP was its allowlist again. The gateway was left ACTIVE.<br><br>The applicant start was checked through the UI and code; the API start endpoint was not called directly.                                                                                                                                                                                                                                                                                                                                   |
| 4. Non-admin read-only     | **NOT TESTABLE**     | Kilima has two active memberships:<br>- Njeri: owner and admin.<br>- Juma Abdi (`investor-team.kilima-angels.juma-abdi@…`): his `organisation_member` role ended on 2026-10-15 09:22:47 and he is `organisation_admin` now.<br><br>So no non-admin member exists, and no account was created. The read-only branch ("Only admins of your firm can change how your gateway looks.", no Save or Pause) is covered only by `apps/web/test/gateq-gateway-appearance.test.tsx`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 5. Q turn                  | **PASS**             | The Q dock was opened on `/gateq?tab=gate` and asked "make my gateway's colour teal and only allow kilima.example to embed it". Q answered in about 72s.<br><br>Q showed a card, "Brand your gateway #008080", with "Only these websites may embed it: https://kilima.example." and the buttons Approve, Change it, Keep it with me and Drop.<br><br>Records:<br>- Action `ca220f25-c9ac-4307-bfd9-d086d2eb1321` has type `app.gateway.appearance.set` and status AWAITING_APPROVAL. Its payload is `{gatewayId:1b4dfdfb…, organisationId:68ecc541…, input:{accentHex:"#008080", embedOrigins:["https://kilima.example"]}}` with hash `sha256:97748de18…`.<br>- Approval `9c65b123-4e35-463b-92d7-01f0d13d4574` was PENDING.<br><br>Q turned "teal" into CSS teal `#008080`, not `#0f766e`. That is reasonable, and the card shows the hex before approval. The card was not approved: it was **dropped** afterwards (approval and action are now REJECTED), so no other live test can approve it.<br><br>`q_runtime.approvals.approval_payload_hash` is null on the pending row. The hash is on the action. This is noted for whoever owns approval binding, not as a defect. |

## Phone (390px)

- The panel spans x 16–374 and the document scroll width is 390, so nothing overflows horizontally.
- These controls are 44px tall:
  - Pause gateway
  - Pick a colour (44×44)
  - the hex input
  - Use Capital Q's colour
  - Save
- See `shots/phone-panel.png`.

## Defects and notes

1. **P3: a paused gateway reads as "page not found".**
   - What happens: `/g/<publicId>` and `/embed` return a 404 with the generic "This page isn't here. The address may be mistyped…".
   - Why it matters: a founder who follows the link or uses an investor's embed is told the address is wrong, not that the gateway is paused and taking no applications.
   - Likely files:
     - `packages/gateq/src/domain/public-projection.ts:32`, which returns null when the gateway isn't ACTIVE;
     - the public `/g/[publicId]` page and the embed page's not-found branch.
   - Product call: should a paused page give a paused notice? The applicant still can't start, so this is not a security issue.
2. **P3: the "Preview your public gateway" link is 20px tall** on desktop and phone. It is a standalone link, not inline text. It is below the ≥44px touch-target rule and only meets WCAG 2.5.8 through spacing.
   - Fix in `apps/web/src/features/gateq/page/gateway-appearance.tsx` around line 122: give it `min-h-11 inline-flex items-center`.
3. **P4: the panel says "Saving…" while pausing.**
   - What happens: during the pause transition the Save button reads "Saving…".
   - Cause: `pending` comes from one `useTransition` that both `toggle` and `save` use, and it stays pending through `router.refresh()`.
   - It is cosmetic. Fix it with a separate transition, or with a label that depends on which action is running, in `gateway-appearance.tsx`.

## Cost

- One Q turn: 5 `ai_ops.model_usage` rows for Njeri since 17:14Z, **$0.0590** in total.
- Budget reservation `b20953b7` (ceiling $0.15) was recorded with `test-budget.mjs record b20953b7 0.059 …`.

## Panel fixes live 14 Nov (06910b145)

Re-check of `2fbe7065c` on production `06910b145`, same account and browser settings (deviceScaleFactor 1). No Q turns and no model calls. Save was not pressed, so the appearance is unchanged. Script: `b67live/s6.cjs`, screenshots `shots/pf-*.png` (scratchpad, not durable).

| Check                          | Verdict  | Evidence                                                                                                                                                                                                   |
| ------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Preview link ≥44px          | **PASS** | "Preview your public gateway" is 189.8×44 on desktop (1440×900) and on phone (390×844). Document scroll width equals the viewport on both.                                                                 |
| 2a. No "Saving…" while pausing | **PASS** | Panel buttons sampled every 50–250 ms from the click: only `["Pause gateway","Save"]` then `["Reopen gateway","Save"]`. Save never read "Saving…". Same on reopen. (Pause/reopen run at 390px.)            |
| 2b. New paused copy            | **PASS** | While paused the panel reads "While paused, your link shows founders that the page isn't available, and nobody can apply. Your rules and applications are kept." Status "Paused", which survived a reload. |
| 2c. Public page while paused   | **PASS** | `/g/gq_7aekqs9vfk8kvavm8k7tcacryn` and `/embed` both return HTTP 404 with "This page isn't here…", matching the new copy. The P3 product question (a dedicated paused notice) stays open.                  |
| 3. Reopen                      | **PASS** | "Your gateway is open again."; status "Open to applications". The page and embed return 200 with "Apply to Kilima Angel Network (fictional)". **The gateway was left open.**                               |

No page errors, console errors or 5xx responses were recorded. Defects 2 and 3 above are fixed live; defect 1 remains a product call.
