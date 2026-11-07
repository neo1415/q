# ADR 0077 — Q Workspace shell

## Status

Proposed — 2026-11-06. Owner-directed (DECISIONS 71; `docs/specs/q-workspace/Q_WORKSPACE_PLAN.md` §5 W1). Implements PADL Decision #92 ("Q shall become the primary interface…").

For people with the Q Workspace flag on, this ADR amends ADR 0017:

- F1: Q Dock beside the Q page.
- F3: Stage + Board on the Q page.

With the flag off, ADR 0017 is unchanged. The plan named this ADR 0031, but 0031 was already taken (`0031-document-studio-brand-kit-and-design-choices.md`), so it takes the next free number.

## Context

Today Q's conversation UI (`QConversationPanel`) lives in the `/home` page. Leaving Home unmounts it. Elsewhere, Q appears as:

- the floating Q Dock;
- a side sheet (`GlobalQSheet`);
- the answer chip and arrival dock.

All of these share one store (`QSessionProvider` in `GlobalQProvider`), so the conversation and voice line survive. The surface the person was looking at does not.

The owner directed a split: nav | Q pane | page pane. Q is beside every page, and moving pages never remounts it.

## Decision

1. **Flag (W1.1).** Two inputs decide whether the split shows:
   - `CQ_WORKSPACE_MODE=off|labs|on`, read per request on the server. `off` (also when unset or unrecognised) is a kill switch for everyone.
   - The person's own preference, `user_metadata.cq_workspace = on|off`. It is read from the verified session token's claims (no extra round trip) and written by the Settings row "Q Workspace (preview)" through their own session, then a session refresh.

   The modes are:
   - `labs`: on only for a person who turned it on.
   - `on`: on for everyone except a person who turned it off.

   It is a display preference. It grants nothing, so it needs no table and no migration. Reverting is a variable change.

2. **One Q, lifted into the layout (W1.2).** With the flag on, `AppShell` renders `WorkspaceQPane` with `QConversationPanel` (`workspace` prop). The `(app)` layout renders that panel once, and Next.js does not re-render a layout on client navigation.
   - There is still exactly one `QSessionProvider`, one voice line and one `WakeWord`.
   - `/home?c=`, `?new=1`, `?ask=` and `?board=1` are sent to the pane as requests (`WorkspaceHomeDirective`), never as a second panel.
   - `/home`'s page pane shows the person's work board, the same reads as `/board`.

3. **Board: a drawer of the Q pane** (the plan offered `/board` or a drawer). The pane is 300–640 px, so the panel never docks the results Board beside the stage. It always opens as the existing sheet over the pane. We chose the drawer because:
   - the Board belongs to the conversation (what Q made in it);
   - `/board` is already the person's work board, a different object, and the two must not be conflated.

4. **Layout (W1.3/W1.4).** The page keeps the window's scroll, so every page behaves exactly as today. The nav and the Q pane are sticky full-height columns.
   - **Separator:** `role="separator"`. Drag, ←/→ in 24 px steps, Home/End for the limits, double-click for 380 px.
   - **Collapse controls:** one subtle 44 px icon at the foot of each pane.
     - Collapsed Q is a 46 px edge with Q's mark.
     - Collapsed pages give Q the full width.
     - Both are never collapsed at once.
   - **Storage:** layout state lives in `localStorage` (`cq-workspace-layout`).
   - **No layout shift:** an inline boot script writes it to `<html>` attributes before the first paint, and CSS lays the panes out from those attributes.

5. **Phone (W1.6, ≤860 px).**
   - Q is full screen. The page pane becomes a bottom sheet with "Back to Q".
   - When Q moves the page, a slim bar reads "↗ Opened <page> · View".
   - The person's own link press or Back opens the sheet directly.
   - An open sheet follows Q's moves.

6. **Retired while the flag is on (W1.7):** Q Dock, `GlobalQSheet`, the answer chip and the arrival dock. Opening Q from anywhere (sidebar trigger, Ctrl/Cmd+K, "Hey Q", a page's "Ask Q about…") opens the Q pane, and a draft is typed into its composer, never sent.

7. **Q controls the layout (W1.5).** A `LAYOUT_SET {qPane?, pagePane?}` client action and a `set_layout` tool, approval class NONE (plan §7). The contract is additive and owned by W3. The schema was proposed to the integration owner before any contract edit.

## Consequences

- **Flag off:** today's DOM, which a landmark test checks (`test/workspace-shell.test.tsx`).
- **Old paths:** `/home`'s full-screen stage, Dock and sheet stay until `on` has been the default for a week with no regressions (plan §4.3).
- **Narrow pane:** inside the pane the panel runs narrower than the viewport, and some viewport-based `lg:` classes inside it still see the viewport width. Those are visual follow-ups, found with the 1440/390 screenshots. Container queries are the long-term fix.
- **Phone scrolling:** on a phone the page sheet is its own scroll container. A page that listens to window scroll for infinite loading must also accept its nearest scroll container; this is verified live per page in W6.
- **Glow:** ADR 0017's glow-on-Q-only rule still holds. The collapsed edge shows only Q's aperture.
