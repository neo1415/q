# ADR 0017 — Founder design amendments: Q Dock, Q Aperture, Stage + Board, visible theme

## Status

Proposed — 2026-09-25. Founder-directed (F1–F4 are binding product
direction; this ADR records them so no locked document is overridden
silently). Amends doc 17 (UX / IA), doc 18 (Visual Design System),
`design/visual-direction.md` and the "Prohibited AI-slop visuals" line of
`CLAUDE.md`. The full design direction, with research, budgets and
acceptance criteria, is `docs/design/ux-direction-2026-09.md` (the spec).
Section numbers below prefixed "spec" refer to it.

## Context

Docs 17 and 18 describe a quiet, chrome-anchored Q: never a floating bubble
(doc 17 §9, §200.3), no glow, no animated light and no AI gradients (doc 18
§4.1, §4.2, §33, §35, §36, §38, §127, §130; `CLAUDE.md`), a thread-based Q
workspace (doc 17 §10–11) and appearance tucked into secondary Settings
(doc 17 §149). The code followed them, except for a particle-field presence
(`apps/web/src/features/q-presence/particle-field.ts`) that cited an
unrecorded "prototype brief" and contradicted doc 18, `visual-direction.md`
and the vault decision of 2026-09-15.

The founder reviewed the product and directed four changes (spec §2). They
go beyond docs 17/18, so they are recorded here together with the smaller
conflicts the spec found while applying them (spec §17.2).

## Decision

### F1 — Q Dock in addition to the Q page

- The dedicated Q page stays (route `/home`; its navigation label becomes
  "Q"). A floating, draggable **Q Dock** exists **in addition**, on every
  page except the Q page.
- The dock is a movable presence tied to the page's subject and to real
  state. It carries no promotional prompts and no unread nags. It never
  covers controls that register an avoid zone, and it is reachable and
  movable without dragging (WCAG 2.5.7 menu, 2.4.11 focus not obscured).
- The sidebar Q entry remains.
- **One conversation store** lives in the persistent `(app)` layout and is
  shared by the dock and the Q page; they hand off without losing the
  conversation, the running task or the voice session (spec §6.4). The
  server remains the source of truth and re-authorises every read.
- Amends doc 17 §9 (last line), §200.3 and the comments in
  `navigation.ts` / `global-q.tsx`.

### F2 — Q Aperture: glow and light, on Q only

- Q's presence is the **Q Aperture**: the ring-and-tail mark rendered as an
  aperture of light (spec §5). Glow, bloom, animated light, a shader mark
  and a one-hue ramp are allowed **on Q only** (the dock, the stage, the
  Q Lumen edge light while voice is open).
- **One hue family** (the accent hue plus a near-white core); no rainbow,
  no purple-blue multi-hue sweep. New tokens: `--cq-q-light`,
  `--cq-q-core`, `--cq-q-bloom`, `--cq-q-ember`, light and dark values.
- **Motion only for real state:** the idle bloom is a static render (zero
  animation frames); light moves only for live audio, running work or a
  single state change. After 5 s of work the sweep slows (WCAG 2.2.2).
- A visible **Q motion: Full · Calm · Off** setting sits beside the theme
  control. `prefers-reduced-motion` forces Calm; `prefers-reduced-transparency`
  and `prefers-contrast: more` remove bloom and edge light; forced colours
  render an SVG ring in system colours.
- The ring reaches **≥ 3:1** against its background in every state and
  theme (WCAG 1.4.11). **No text sits on the glow**; the state label sits
  beside it at ≥ 4.5:1 and always carries the meaning (doc 18 §34 holds).
- Budgets (spec §5.4): one shared WebGL2 context, shader + controller
  ≤ 8 KB gz, no three.js, DPR capped at 2, GPU ≤ 1.5 ms/frame at dock size
  and ≤ 4 ms/frame at stage size, loop paused when hidden or idle, SVG
  fallback in the shell so the presence never affects LCP. A 3D glass
  variant is optional and P2.
- Amends `CLAUDE.md` prohibited visuals ("glowing …", "purple-blue AI
  gradients" as applied to Q) and doc 18 §4.1, §4.2, §33, §35, §36, §38,
  §127, §130.

### F3 — Stage + Board, not a chat

- The Q page is a **Stage + Board** layout (spec §7): a voice-first stage
  with an ambient transcript of the live exchange only, answers as **typed
  objects** on a Board (fixed components chosen by Q, never model-generated
  code), a **Now / Needs you** task view, and one command bar.
- History (the chats list) is a secondary drawer; a linear **Transcript
  view** is the accessible equivalent, not the default layout.
- Amends doc 17 §10–11 (thread-based workspace) and the "Q presence
  surface" recipe in `design/visual-direction.md`.

### F4 — A theme switcher people can find

- **Light · Device · Dark** is visible in the desktop sidebar footer, the
  first row of the mobile account menu and the auth header (spec §11).
- Storage and boot stay as they are (`localStorage["cq.theme"]`, cross-tab
  sync, the inline boot script before paint; no cookie, which would make
  the shell request-bound). `<meta name="theme-color">` follows a manual
  choice; transitions are suppressed for the frame of a switch.
- Stage surfaces (`--cq-stage-*`) are unchanged by the theme.
- Amends doc 17 §149 (appearance only under secondary Settings).

### Other conflicts resolved (spec §17.2)

| #   | Decision                                                                                                                                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C3  | The particle-field presence is superseded by F2 and retired in UX-02. The unrecorded "prototype brief" it cited has no authority.                                                                                                                                                                                                           |
| C4  | Discover may use a right-hand action rail **with text labels**, no counters and no like/share semantics. Amends doc 18 §83 ("not TikTok-cloned") to that extent only.                                                                                                                                                                       |
| C5  | On mobile Discover the header may hide; the bottom navigation stays, on stage tokens. Minor amendment to doc 17 §7.                                                                                                                                                                                                                         |
| C6  | Motion for React (already in the locked stack) is installed in `apps/web` by the first packet that needs it (dock physics, feed gestures).                                                                                                                                                                                                  |
| C7  | A semantic `--cq-z-presence` layer sits between navigation and popover for the dock and Q Lumen. Amends doc 18 §177–178.                                                                                                                                                                                                                    |
| C8  | A prerendered static shell (Cache Components) is approved **in principle** but needs its own security ADR before UX-01b: the shell carries no session, tenant or user data (enforced by a test), the guard runs at the proxy and again at every data leaf, and no `'use cache'` on a read that uses a token. Doc 15 §9.4 stands until then. |
| C9  | Page View Transitions still use no blur. F2 relaxes glow and bloom for Q only. Doc 18 §127 otherwise holds.                                                                                                                                                                                                                                 |
| C10 | Reduced motion and feed video are already resolved by ADR-001 (poster plus explicit Play).                                                                                                                                                                                                                                                  |
| C11 | A voice session may persist across pages, with an always-visible mic-live indicator on the dock and a one-tap Stop (doc 17 §55). Compatible with ADR 0010: the binding is to the actor and thread, not to a page, and navigation changes neither.                                                                                           |

### Prohibitions that still hold (spec §14.4)

Relaxed **for Q only**: glow and bloom; animated light; a shader or 3D
mark; a hue ramp within the accent family; the side light leak; motion
while Q is working.

Still in force everywhere:

- Glow anywhere except Q (buttons, cards, headings, charts, hover).
- Badge spam; "Hot / Top match / 94%"; confidence percentages; fit meters.
- Cards around paragraphs; card-in-card; metric-card grids; three-feature-card heroes.
- Robot, face, brain or character imagery; neural-network particles;
  hexagons; circuit lines; holographic dashboards; fake terminals.
- Rainbow or purple-blue multi-hue gradients; gradient headings.
- Fake agent activity; typewriter or scramble text; "typing…" when nothing
  is running.
- Glass and `backdrop-blur` on reading surfaces (the scrim is for video only).
- Cursor-following glow; parallax; bouncing notification bells; confetti.
- Red Pass; colour-only meaning.
- Uppercase tracking-widest eyebrows; weights of 700 and above.
- Sparkles as the Q icon (the aperture is the mark).

## Consequences

- `CLAUDE.md`'s Design section points to this ADR and the spec as
  superseding the conflicting prohibitions for Q only; the rest of that
  list is unchanged.
- The presence becomes a shared component with a clean state API that the
  dock (UX-03), the Q page (UX-04) and Discover (UX-05) consume; none of
  them draws its own light.
- New tokens (`--cq-q-*`, `--cq-z-presence`, `--cq-stage-scrim`,
  `--cq-spring-snap`, `--cq-motion-gesture`) are added in `packages/ui`
  by the packet that first needs each.
- Acceptance for each packet is the measurable list in spec §15; the
  aperture's budgets are checked, not assumed.
- C8 remains open until its security ADR is accepted.
