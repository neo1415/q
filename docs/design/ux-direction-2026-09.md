---
title: Capital Q — UX and design direction (research)
project: capital-q
date: 2026-09-25
status: adopted as the design direction; the founder-directed amendments (section 2) and the conflicts in section 17 are recorded in docs/adr/0017-founder-design-amendments.md.
---

> Lead decisions on section 18 (2026-09-25): (1) install Motion for React in `apps/web` when a packet needs it; (2) the static shell (UX-01b) is approved subject to a security ADR that the prerendered shell carries no session, tenant or user data, enforced by a test; (3) ship the 2.5D WebGL2 shader plus SVG fallback now, the 3D glass mark is P2; (4) the Q page's navigation label becomes "Q" (the route stays `/home`).

# Capital Q — UX and design direction

This document answers the founder's brief. It covers the best flow, when to use 3D, a futuristic Q presence that floats, can be moved, and glows, a Q page that is not a chat, a TikTok-style Discover, navigation with almost no delay, a theme switcher users can find, and every page.

It draws on docs 17, 18, 20 and 26, ADR-001, `design/visual-direction.md`, `design/visual-debt.md`, the vault decisions and a reading of every route in `apps/web/app`. The outside sources are listed in section 19.

Section 2 restates the founder's four binding amendments. Wherever a request goes beyond docs 17/18 or CLAUDE.md, the ADR it needs is named in section 17. This document does not override anything silently.

---

## 1. What the code does today

1. **Every click waits for the server.** `(app)/layout.tsx` and almost every page export `dynamic = "force-dynamic"`. The layout awaits `requireSessionUser()` and `resolveOwnContext()`. There is **no `loading.tsx`, `error.tsx` or `not-found.tsx` anywhere**, so a click shows nothing until a full server round trip (session → context → page data) completes. Next `~16.3.4` is installed, and 16.3 ships Instant Navigations (Cache Components plus Partial Prefetching) [30][31]. `resolveOwnContext` is already wrapped in React `cache()`.
2. **Discover is not immersive.** The investor feed sits inside `PageContainer` and `PageHeader`, at reading width, showing one card at a time. The preload controller underneath is solid: `FeedPreloadPolicy` covers NONE through ACTIVE, `maxBufferLength` is 10, and ↓/J keys work. The layout is the problem, not the engine.
3. **Q's presence is disputed.** `particle-field.ts` draws a particle annulus and cites an unrecorded "prototype brief". It contradicts `visual-direction.md` lines 74 and 124, doc 18 §4.1, §33 and §36, and the vault decision of 2026-09-15. The founder is still not impressed with it. Amendment F2 now wants glow and futurism, but a _distinctive_ and premium one, not generic particles (section 5).
4. **Q lives in the chrome and on Home.** `navigation.ts` and `global-q.tsx` rule out "a floating bubble" (doc 17 §9, §200.3). Home is the full Q surface: `home-screen.tsx` says "Home is Q". The sheet (`q-sheet.tsx`) already has an "Open in Home" link that carries the conversation across. That link is the seed of the hand-off in section 6.4.
5. **The theme system is already correct underneath.** `THEME_BOOT_SCRIPT` sets `data-theme` before first paint from `localStorage`, `ThemeToggle` offers system, light and dark, tabs stay in sync, and the tokens set `color-scheme`. The gaps are that the toggle lives **only on `/profile`**, and that `<meta name="theme-color">` follows the media query, not a manual choice (section 11).
6. **Motion for React is not installed,** even though CLAUDE.md lists it. The dock's drag physics and the feed gestures are the first features that genuinely need it.
7. **Pages the information architecture needs are missing:** Saved, Compare, Search, relationship detail, the investor's organisation and mandate, the founder's own Company intelligence page, Settings, Notifications, and the external Q Card.

---

## 2. Founder-directed amendments (binding)

| #      | Amendment                                                                                                                                         | What it overrides                                                                                      | How this document applies it                                                                                                                                                                                  |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F1** | **Keep the dedicated Q page.** The floating, draggable Q is _in addition to_ the page. The two hand off without losing the conversation           | Doc 17 §9 (last line) and §200.3 on floating Q                                                         | Dock and Q page share one conversation store in the persistent layout. They hand off through shared-element transitions (§6.4)                                                                                |
| **F2** | **AI glow is wanted; Q should feel futuristic** with light, glow, fluid motion, and possibly shaders or 3D. It must stay premium and professional | CLAUDE.md prohibited visuals (glowing …, purple-blue gradients); doc 18 §4.1, §33, §35, §36, §38, §127 | "Q Aperture", a light-based Q identity (§5). Glow is allowed **on Q only**, within performance, reduced-motion, reduced-transparency and WCAG AA limits. The prohibitions that still hold are listed in §14.4 |
| **F3** | **No ChatGPT-style chat.** The Q page is not a message list above a composer                                                                      | Doc 17 §10–11 describe a "Q workspace" but assume a thread; `visual-direction.md` recipe               | The Q page is a **Stage + Board** layout: a voice-first stage, an ambient transcript, results as objects on a board, a "Q is working" task view, and history as a secondary drawer (§7)                       |
| **F4** | **Theme switcher**: light, dark and system, easy to find, persisted, no flash of the wrong theme                                                  | Doc 17 §149 puts appearance in secondary Settings                                                      | A visible control in the sidebar footer, the mobile account menu and the auth header, built on the existing boot script, plus a fix to theme-color (§11)                                                      |

---

## 3. Principles

1. **One Q, always tied to real state.** The light moves only for real audio, real work or a real request for the user. That is what separates a futuristic presence from a novelty bubble. NN/g found that users often cannot tell what a floating bot is _for_ [11], so the dock always shows what it is about and what it is doing.
2. **Q may glow; the product may not.** The glow belongs to Q alone. Everything else stays quiet and institutional: Geist type, hairlines, one accent. Linear's 2026 refresh [15] and Mercury [16] show how much calm chrome makes the few luminous things read as special. If everything glows, nothing is special, and the result looks cheap.
3. **Q produces objects, not transcripts.** A company, a comparison, a deck or an approval is a thing you can open, pin, compare, share or act on. Conversation is how Q is asked; it is not how its work is stored (§7).
4. **The video carries the cinema in Discover.** The UI around the pitch stays out of its way.
5. **No spinners between you and a page.** The app shell paints in 100 ms or less, data streams in, and safe actions are optimistic. Consequential actions show server-confirmed feedback in place (doc 17 §175).
6. **Continuity over transition.** The same object moves between places: poster → profile hero, dock → Q page stage, sheet → page.
7. **Every gesture has a visible, keyboard-reachable equivalent.** This covers WCAG 2.5.7, 2.1.4 and 2.4.11, and ≥ 44 px targets [7][8][9].
8. **Unknown stays visibly unknown.** Readiness, quality, fit, interest and match are never drawn alike (UXA-028).

---

## 4. Reference products and what we take

### 4.1 Presence

| Product                       | What it does                                                                                                                                                                                                                                                                                                                                         | What we take / leave                                                                                                                                                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Siri, iOS 18 → 27**         | A rainbow edge glow around the whole screen (iOS 18). In iOS 27 Siri grows out of the Dynamic Island as a glowing pill, then results cards, then chat [3]. Implementation: a rotating angular gradient stroke with a blur-layered bloom, or a Metal shader for non-uniform flow. It is tied to a real thinking state and respects Reduce Motion [34] | **Take:** light tied to state; the glow as a _place_, not a blob; the Dynamic Island's compact / minimal / expanded presentations [4]. **Leave:** the full-perimeter rainbow. Ours comes from one side, the dock's side, in one hue family |
| **Gemini Live (Apr 2026)**    | Full screen became a floating component with a central waveform. It shrinks to a small circle while you use other apps [2]                                                                                                                                                                                                                           | **Take:** collapse to a floating control while the user keeps working                                                                                                                                                                      |
| **ChatGPT voice**             | The 2024 animated blue orb [35]; from Nov 2025 voice runs inside the chat with a live transcript, and the orb mode became an opt-in setting [1]                                                                                                                                                                                                      | **Take:** one thread across voice and text; the full-screen stage is optional. **Leave:** a sphere. It is now generic                                                                                                                      |
| **Copilot "Mico" (Oct 2025)** | An abstract blob that changes colour, size and expression by state. It is optional and can be turned off [36]                                                                                                                                                                                                                                        | **Take:** nonverbal feedback during voice; a user switch for the effect. **Leave:** a character or face, which suits consumer products but undermines institutional trust                                                                  |
| **Sesame / Hume**             | Presence comes from prosody and timing; Hume reads expression from the voice [5][37]                                                                                                                                                                                                                                                                 | Most of presence is audio (doc 26). The light confirms it                                                                                                                                                                                  |
| **Humane / Rabbit**           | Novel form without reliable utility, then shutdown [12]                                                                                                                                                                                                                                                                                              | A presence with nothing behind it is worthless                                                                                                                                                                                             |

### 4.2 Conversation beyond chat (F3)

| Product / idea                                      | What it does                                                                                            | What we take                                                                                                                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Wattenberger, "Why chatbots are not the future"** | A text box gives no affordances. Every user has to discover what works; interfaces should carry it [38] | Each result carries its own next actions (Compare, Why, Open, Prepare intro). Suggested actions come from state, not prompt tips                                                                  |
| **Gemini generative UI / dynamic view (Nov 2025)**  | The model builds an interactive interface per answer instead of prose [39]                              | Q answers as **typed result blocks** (company, comparison, metric, evidence, approval, deck). These are fixed components chosen by Q, never model-generated code, per the tool and security rules |
| **Arc Search "Browse for Me"**                      | Answers by building a _page_ from six sources [40]                                                      | A research answer lands as a **brief** (an artifact page), not a long message                                                                                                                     |
| **tldraw computer / spatial canvas**                | Work laid out spatially as connected nodes [41]                                                         | The Board is a light spatial arrangement of Q's objects. It is not an infinite canvas, which would be too much for V1                                                                             |
| **Granola**                                         | The notes are the product; the transcript and chat are secondary [42]                                   | History is provenance attached to each object, and the transcript is a secondary view                                                                                                             |
| **Dia**                                             | The assistant sits in a sidebar with the page's context; the panel can be detached and moved [14]       | Split view on entity pages, and the movable dock                                                                                                                                                  |
| **ChatGPT canvas / Claude artifacts**               | The artifact sits beside the conversation                                                               | The artifact viewer is beside the Board, not below the thread                                                                                                                                     |

### 4.3 Discover and chrome

TikTok web (Feb 2025) uses a centred full-height video, a left navigation rail and interactions down the right [17]. Loom and iOS picture-in-picture show snapping, stashable floating objects [18]. Linear, Mercury and Robinhood Legend show calm chrome, tabular figures and keyboard-first use [15][16][19]. Rauno Freiberg shows that interactions feel right when they borrow physical metaphors [20].

---

## 5. The Q presence: "Q Aperture"

### 5.1 Concept

Q's mark is a ring with a tail. The distinctive idea is to treat that ring as an **aperture of light**, a lens. The metaphor is exact for this product: Q _looks_ at evidence, _focuses_ on what matters and _projects_ a conclusion. Neither Siri (an edge rainbow), ChatGPT (an orb), Copilot (a creature) nor Gemini (a waveform pill) owns it. It stays a brand mark, never a face, brain or blob, while giving the founder light, glow and fluid motion.

| State                        | The aperture                                                                                   | Light behaviour                                                    | Label (always visible or announced)                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------ |
| **IDLE**                     | A thin luminous ring, still                                                                    | A **static** soft bloom rendered once (glow at rest, no animation) | "Q"                                                          |
| **LISTENING**                | The aperture **opens**: the ring widens by up to 6% and the inner field fills with faint light | Brightness and aperture follow microphone level in real time       | "Listening" + mic-live dot + Stop                            |
| **THINKING**                 | The aperture **focuses**: the ring tightens and a bright "focus sweep" travels around it       | Sweep period 1.4 s; a faint refraction shimmer inside              | The approved stage: "Reviewing company", "Checking evidence" |
| **WORKING** (a durable task) | The focus sweep becomes a **ring of light showing progress** (determinate when known)          | The glow advances with progress                                    | Task + stage ("Deck for Acme · Drafting slides")             |
| **SPEAKING**                 | Light **projects** from the Q's tail outward                                                   | Tail brightness and length follow the output level                 | "Speaking" + Stop                                            |
| **NEEDS_INPUT**              | A steady, slightly brighter ring                                                               | Static                                                             | "Q has a question"                                           |
| **NEEDS_APPROVAL**           | A steady ring with a warm-white core highlight                                                 | Static, one settle on entry                                        | "Approval needed: {action}"                                  |
| **COMPLETE**                 | A single "shutter": a short bright flash, then back to IDLE                                    | 240 ms, once                                                       | "Done: {result}"                                             |
| **ERROR**                    | The light dims to a low ember                                                                  | Static                                                             | "Paused. Tap to see why" (never red)                         |

**The side glow ("Q Lumen").** While a voice session is open, a soft light leak glows along the viewport edge **on the dock's side only**. It is ≤ 24 px deep and its intensity follows the audio. It answers "Q is here and listening" at a glance, like Siri's edge, without covering the screen or using rainbow colour. It never overlaps text: it sits under the safe-area inset and fades out behind any content with a registered avoid zone.

### 5.2 Colour and light in both themes

- **Hue.** The whole light comes from **one hue family**: the `--cq-accent` hue (258) and a near-white core. There is **no multi-hue rainbow** and **no purple-blue sweep**. New tokens: `--cq-q-light` (accent at high chroma), `--cq-q-core` (a warm near-white), `--cq-q-bloom` (the accent at low alpha), and `--cq-q-ember` (a desaturated low-light tone). Each has light and dark values, and none uses a raw hex.
- **Dark theme and stage.** True additive glow.
- **Light theme.** Additive glow on paper looks muddy, so there the ring is an **ink-and-light** rendering: a deeper accent stroke with a tight coloured bloom and a white inner highlight. It reads as light _on_ paper, not a haze.
- **Contrast.** The ring, as a non-text state indicator, must reach **≥ 3:1** against its background in every state and theme (WCAG 1.4.11). **No text ever sits on the glow.** Labels sit on the surface beside it at ≥ 4.5:1. The glow carries no meaning by itself (doc 18 §34), because the label always does.

### 5.3 Motion limits and accessibility

- **Zero animation frames when idle** (the bloom is a static render). Motion runs only while audio is live, work is running, or during a single state change.
- **WCAG 2.2.2 (Pause, Stop, Hide)** [6]: work can run for longer than 5 s next to other content. Three things cover it:
  - (a) after 5 s the sweep slows to a long 6 s period at low amplitude;
  - (b) a visible "**Q motion: Full · Calm · Off**" control sits in the same appearance menu as the theme switcher (§11). Calm is static light with the label only; Off shows the static mark with no glow;
  - (c) Stop ends the work, and with it the motion.
- **`prefers-reduced-motion`** forces Calm: static light, no sweep, no audio-driven scale. State is still carried by brightness steps and the label (doc 17 §114, ADR-001).
- **`prefers-reduced-transparency`** and **`prefers-contrast: more`** turn off the bloom and side glow, leaving a solid ring [22].
- **Forced colours (Windows High Contrast)** fall back to an SVG ring in `CanvasText` / `Highlight`.

### 5.4 Rendering and budgets

- **One WebGL2 context** is shared by every Q presence on the page: a single canvas covering both the dock and the stage, drawn with scissor rects. Browsers cap live WebGL contexts, so per-component canvases are not an option. The ring is a signed distance field (SDF) ring with a tail. Bloom comes from a cheap two-tap kernel in the fragment shader, **not** CSS `filter: blur` animation.
- **Budgets:**
  - shader + controller ≤ **8 KB gz**, with **no three.js** (about 155 KB gz [24]);
  - GPU ≤ **1.5 ms/frame** at dock size and ≤ **4 ms/frame** at stage size on a mid-tier Android;
  - 60 fps at dock size and 30–60 fps at stage size;
  - device pixel ratio capped at 2;
  - the loop pauses on `document.hidden`, inside a hidden `<Activity>`, and when idle.
- **Fallback path** (no WebGL2, Save-Data, `deviceMemory < 4`, or motion Off): an SVG ring with a **pre-rendered** static bloom (an SVG filter rasterised once). Only `opacity` and `transform` are animated. It is identical in composition.
- **Loading.** The fallback SVG renders in the shell, so the dock is visible at first paint and never affects Largest Contentful Paint (LCP). The shader module loads after LCP via `requestIdleCallback`.
- **Retire** `particle-field.ts`.

---

## 6. The dock (floating Q) and hand-off to the Q page

### 6.1 Presentations (the Dynamic Island model [4])

| Presentation | Where                                                                                          | Size                         | Contents                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------- |
| **Minimal**  | Floating, every page except the Q page                                                         | 44 px target, 36 px aperture | Aperture only; the label appears on hover or focus, or as a chip when the state changes     |
| **Compact**  | A pill while a task runs or an approval waits                                                  | 44 px tall, ≤ 320 px wide    | Aperture · task · stage · progress                                                          |
| **Expanded** | Desktop side panel, 480–640 px (doc 18 §181, §186); mobile bottom sheet with 50% and 92% stops | —                            | The Q conversation store rendered as a compact Board (§7), with the page's subject attached |
| **Stage**    | The Q page and the voice-first onboarding                                                      | 160–240 px                   | The full aperture and the ambient transcript                                                |

### 6.2 Placement, dragging and "moving around on one side"

- **Desktop.** Default is the right edge, lower third (NN/g: users expect assistants at the lower right [11]). The dock can be dragged **along that edge** or thrown to the left edge. There are six snap anchors (top, middle and bottom on each side), inset by the page gutter.
- **Mobile.** Four corner anchors inside the safe areas, clear of the header and bottom navigation. Default is bottom-right, above the navigation.
- **Throw physics.** The release velocity is projected about 150 ms forward, and the dock springs to the nearest anchor (stiffness ≈ 420, damping ≈ 40, overshoot ≤ 2 px). Built with Motion for React `drag` plus a custom snap [21], or about 2 KB of hand-written pointer handling.
- **Stash.** Throwing the dock past an edge stashes it as a 12 × 44 px tab showing a sliver of the light. Tap to restore.
- **Moves only for a reason:**
  - (a) **Avoid zones.** The composer, primary CTA bars, video controls, open sheets and the Discover action rail register with `useDockAvoid(ref)`. The dock glides to a free anchor in 280 ms when it would overlap one.
  - (b) **It follows the conversation.** When Q refers to an on-screen object, a thin light line can briefly connect the aperture to that object (a P2 experiment).
  - **Ambient wandering is rejected.** It would be distracting next to a pitch video and would need a pause mechanism under 2.2.2.
- **Persistence.** The anchor is saved per breakpoint class in `localStorage` (inside try/catch) and can be reset from the dock menu.
- **Per route:**
  - **Q page:** the dock is hidden, because the stage _is_ Q.
  - **Discover, mobile:** the dock **merges into the action rail** as the Ask Q slot.
  - **Discover, desktop:** the dock sits in the header of the intelligence panel.
  - **Onboarding:** the stage size is used.

### 6.3 Accessibility

- The dock is a `<button>` of at least 44 × 44 px, named "Q, {state}, about {subject}". It is reachable with F6 landmark cycling. ⌘/Ctrl+K opens Q (doc 17 §164) and Esc closes it.
- **Drag alternative (WCAG 2.5.7)** [7]: the context menu (right-click, long-press or Shift+F10) offers "Move to top / middle / bottom / other side" and "Hide until next visit".
- **Focus not obscured (WCAG 2.4.11)** [9]: at the default anchor, the dock covers no focusable control on any route. This is enforced by the avoid zones and checked by a Playwright tab-through.
- **Voice indicator:** a mic-live indicator stays on the dock on every page while voice is open (doc 17 §55).
- **Announcements:** state changes are announced through **one** polite live region, debounced to 1 s.

### 6.4 Hand-off between the dock and the Q page (F1)

- **One conversation store.** The conversation store, the active task, the voice session and the aperture renderer live in the persistent `(app)` layout. The sheet and the Q page are two _views_ of the same store. The server remains the source of truth (conversation id, re-authorised on each read), as it is today with `/home?c=`.
- **Dock → page.** In the expanded sheet or panel, **"Open Q"** (or dragging the mobile sheet past its 92% stop) navigates to the Q page, carrying the conversation id. Two shared elements make the move: the dock aperture becomes the stage aperture, and the panel's result list becomes the Board (`<ViewTransition name="q-aperture">`, `name="q-board"` [25]). There is no refetch, no remount and no interruption to voice.
- **Page → elsewhere.** Navigating away shrinks the stage aperture into the dock anchor with the same shared element. A running task continues as the dock's compact pill, and Back returns to the page exactly as it was (Activity preservation [32]).
- **Deep links.** `/home?c=<id>` (as today) plus `/q/artifacts/<id>` for objects.

---

## 7. The Q page: Stage + Board, not chat (F3)

### 7.1 Layout (desktop ≥ 1024 px)

```
┌─ sidebar ─┬──────────────────────────────────────────────────────────┐
│ Home = Q  │  STAGE (compact once work exists)                        │
│ Discover  │   (aperture)   "Here are five companies that fit your     │
│ Capital   │                mandate. Two have thin evidence."          │
│           │                ▸ ambient transcript: current exchange only│
│           │                  in large type; older lines fade out      │
│           ├───────────────────────────────┬──────────────────────────┤
│           │ BOARD                         │ NOW / NEEDS YOU          │
│           │ ┌ Result: 5 companies ───────┐│ ● Deck for Acme          │
│           │ │ row · row · row  [Compare] ││   Drafting slides · 3/6  │
│           │ └────────────────────────────┘│ ◆ Approve intro to Apex  │
│           │ ┌ Comparison: 1 vs 3 ┐┌ Brief┐│   [Review]               │
│           │ └────────────────────┘└──────┘│ ? Q asks: which round?   │
│           │ (pinned objects stay; newest  │                          │
│           │  first; each has "Show        │ History ▸ (drawer)       │
│           │  exchange" provenance)        │                          │
│  ☀ ◐ ☾   ├───────────────────────────────┴──────────────────────────┤
│  profile  │ COMMAND BAR  [🎙 hold/tap to talk]  Ask Q or say anything… │
└───────────┴──────────────────────────────────────────────────────────┘
```

- **Stage.** The aperture sits beside Q's _current_ line, set in `cq-title-lg`. The **ambient transcript** shows only the live exchange (the person's words in secondary text, Q's words in primary) and fades out older lines. It is a caption, not a log. When voice starts, the stage expands to fill the viewport height on the `--cq-stage-*` field (the voice-first mode). When talking ends, it collapses back.
- **Board.** Every Q answer lands as a **typed object** from the approved result blocks (doc 17 §10): result set, company, comparison, metric with evidence, brief or deck (artifact), action proposal. Objects appear newest first. The user can pin one, dismiss it, or ask about it ("Why #1?" scopes Q to that object). A short text answer appears as a slim **note object**, not a message bubble. Cards are legitimate here, because each one is a discrete object (doc 18 §29).
- **Now / Needs you.** This column is the task view. Running work shows approved stages and progress (doc 17 §13); approvals show the exact payload with Approve and Reject (doc 18 §105); Q's open questions appear with option chips. It matches the dock's compact pill, so it is the same task in two places.
- **Command bar.** This is the only text input. The microphone is the primary affordance, with typing and attach beside it. Suggestions come from state (the three most relevant next actions), not from generic prompt tips (Wattenberger [38]).
- **History is secondary.** A "History" drawer lists past conversations (today's `chats-list`). Each object's "Show exchange" reveals the turns that produced it. A **Transcript view** toggle renders the whole conversation as one linear, accessible log. That view is the screen-reader-friendly equivalent, not the default layout.

### 7.2 Mobile (< 768 px)

The top of the screen holds a compact stage: the aperture plus the current line. Below it are a "Now" strip (at most one running task and one "needs you" item), then the Board as a vertical stack of objects. The command bar sits at the bottom with a centred microphone, and the bottom navigation stays. Tapping the microphone turns the screen into the full voice stage, with the ambient transcript and results collecting beneath as small cards. Swiping down returns to the Board.

### 7.3 Artifacts

A deck or brief appears on the Board as an object showing the first slide (the server-drawn SVG, as today), its title and its status. It opens **beside the Board** on desktop and full screen on mobile, using the existing `artifact-viewer.tsx`. Download and Share are separate, explicit actions (doc 17 §91). Deep link: `/q/artifacts/[id]`, re-authorised on every read.

### 7.4 Returning user

The stage line is a one-sentence "since you were away" (a new interest, a finished deck, a waiting approval). **Needs you** is populated, and the Board keeps pinned objects from last time. There is no dashboard (UXA-004).

---

## 8. Where 3D and shaders belong (with F2)

| Surface                                                   | Verdict                                                                                                                          | Budget                                                     |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **Q Aperture (dock + stage)**                             | **Shader, yes** (a 2.5D SDF light ring, §5.4). A true 3D glass ring on the stage (refraction, depth of field) is optional and P2 | ≤ 8 KB gz shader; stage 3D variant ≤ 20 KB gz; no three.js |
| **Q Lumen side glow**                                     | Shader or CSS gradient on transform/opacity only; audio-driven only while voice is open                                          | ≤ 0.5 ms/frame                                             |
| First-run hand-off (stage → dock)                         | Shared-element plus light trail: the one choreographed moment, as frontend-design recommends [33]                                | ≤ 400 ms; instant under reduced motion                     |
| Route / page transitions                                  | **No 3D** (no cube, flip or perspective zoom)                                                                                    | View Transitions ≤ 400 ms                                  |
| Feed → company                                            | 2.5D shared-element morph (poster → hero)                                                                                        | —                                                          |
| Charts, evidence, relationships                           | **Never 3D.** It distorts magnitude, and doc 18 §132 applies                                                                     | —                                                          |
| Public Q Card / future landing                            | A pre-rendered film, not real-time 3D                                                                                            | Poster ≤ 60 KB AVIF, video after LCP                       |
| Third-party orbs (e.g., ElevenLabs UI Orb, three.js [26]) | **Do not adopt.** Generic, heavy, not distinctive                                                                                | —                                                          |

---

## 9. Discover

### 9.1 Mobile: full screen (≤ 767 px)

```
┌──────────────────────────┐
│   9:16 pitch, cover       │  item height 100svh [27], stage tokens
│                   [Save] │  right action rail: labelled, ≥44 px,
│                   [Pass] │  no counters, no like/share
│                   [ Q  ] │  ← Q Aperture merges here (Ask Q)
│                   [More] │
│ Acme Health · Seed · $1.2M│  info region on --cq-stage-scrim
│ Claims automation for …   │
│ Fits: B2B health, Lagos   │  fit reason in declared vocabulary
│ [View company] [Interest] │
├──────────────────────────┤
│ Home Discover Capital Me  │  bottom nav on stage tokens
└──────────────────────────┘
```

The header is hidden, and the overlay follows doc 17 §65 and doc 18 §81. The seek bar is a 2 px track that grows to a 24 px target when pressed. Captions sit in a safe region above the info block.

### 9.2 Desktop: full height (≥ 1024 px)

The sidebar collapses to a 64 px rail. The 9:16 stage is centred at `100dvh − 2 × gutter` and never stretched (doc 18 §182), with ▲/▼ buttons beside it. On the right, an **intelligence panel** (400–480 px) holds the company, why it is here, traction in `cq-numeric`, "Evidence: 3 sources ›", Save / Pass / Ask Q, and View company / Express Interest. The aperture sits in the panel header. **Ask Q** swaps the panel for the Q panel with the company attached (split view). The video keeps playing, ducked while Q speaks. On tablet, the panel becomes a drawer.

### 9.3 Inputs

| Input                         | Action                                                       | Equivalent                                                                                   |
| ----------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Swipe up/down                 | Next/previous item, gesture-linked, 280 ms settle, no bounce | ▲/▼ buttons; "Next company" in More                                                          |
| Wheel / trackpad              | One item per gesture (accumulated delta, 350 ms lockout)     | —                                                                                            |
| ↑/↓, J/K, Space, M, C, S, P   | Navigate · pause · mute · captions · save · pass             | Active **only while the feed has focus**, and can be turned off in Settings (WCAG 2.1.4 [8]) |
| Double-tap / horizontal swipe | Nothing. No hidden critical gestures (doc 18 §84)            | —                                                                                            |

### 9.4 Actions

- **Save** is optimistic (`useOptimistic`), with a 120–180 ms icon fill.
- **Pass** is optimistic and neutral: never red, no X animation.
- **Express Interest** is confirmed by the server: a dialog with the doc 17 §70 wording, then a pending state in place.
- **View company** morphs the poster into the profile hero (`<ViewTransition name="pitch-{id}">`). Back restores the exact item and time, via Activity [32]. The player pauses in the cleanup effect.

### 9.5 Playback and preload

This is the existing controller plus:

1. The item-0 poster is an `<img fetchpriority="high">` in the shell, and it is the LCP element.
2. A video becomes ACTIVE only at ≥ 70% visibility **and** a settled snap. At most **3 `<video>` elements** exist, recycled.
3. The next item gets a STARTUP_BUFFER (4–8 s via `autoStartLoad:false` then `startLoad()` [29]) only on 4g, with Save-Data off and ≥ 6 s already buffered. Otherwise it gets a POSTER. The item after that gets a POSTER; anything further gets NONE (doc 20 §50).
4. Playback pauses when the tab is hidden, when Activity is hidden, while Q is speaking, and when the mobile Q sheet is ≥ 92% open.
5. Under reduced motion (ADR-001): no autoplay; the user sees the poster and an explicit Play button.
6. Targets: warmed swipe-to-first-frame p75 < 500 ms; active start < 1.0 s on Wi-Fi and < 2.0 s on mobile; Save/Pass visual response < 100 ms.

### 9.6 Founder Discover

A ranked investor list. Rows use hairline dividers, with "Ask Q about fit". No scores and no badges, as today.

---

## 10. Navigation and latency

### 10.1 Target model

- A **persistent layer** that never re-renders on navigation: the shell, the dock, the Q store, the voice session, the feed player controller and toasts.
- A **static app shell** with **zero session data**: chrome plus skeletons whose geometry matches the final layout.
- **Streamed, session-bound reads** inside `<Suspense>`.

### 10.2 Steps

1. **Immediately:** add Suspense shells or `loading.tsx` for every app route, plus global `not-found`, `error` (or 16.3 `catchError` with `retry()` [30]) and `global-error`. Run awaits in parallel with `Promise.all`.
2. **Adopt Cache Components and Partial Prefetching** [30][31]. Remove every `export const dynamic` (it errors under the flag [32]) and use the `cache-components-instant-false` codemod to migrate route by route. Keep `prefetch={true}` for high-intent links only.
3. **Security (doc 15 §9.4):** the shell carries no session data. The guard stays in the proxy and runs again in every Suspense leaf that holds data. Never put `'use cache'` on a read that uses a token. `'use cache: private'` [31] is allowed only after review. This needs an ADR (C8).
4. **Activity preservation** [32]: the feed position, Board scroll and drafts survive Back. Close popovers and pause players in cleanup effects.
5. **View Transitions** [25]: `nav-forward`/`nav-back` for list → detail. Primary tabs swap instantly or crossfade in ≤ 140 ms. Header, sidebar and dock are anchored. `::view-transition{pointer-events:none}`. Zero duration under reduced motion.
6. **Optimistic and pending UI**: `useOptimistic` for Save, Pass and notification reads. `useTransition` pending state on the control for server-confirmed actions. The Q panel opens from client state.
7. **Guards:** `@next/playwright` `instant()` tests [31] on the main navigations, Instant Insights in development, and real-user monitoring (INP, LCP, CLS, plus the doc 20 §62 feed metrics).

### 10.3 Budgets (p75)

| Measure                | Budget                           |
| ---------------------- | -------------------------------- |
| Click → shell painted  | ≤ 100 ms                         |
| Shell → content (warm) | ≤ 600 ms                         |
| LCP                    | ≤ 2.5 s                          |
| INP                    | ≤ 200 ms                         |
| CLS                    | ≤ 0.1 overall, 0 for shell swaps |
| Q panel visible        | ≤ 100 ms                         |
| First Q token          | ≤ 1.5 s                          |
| Discover initial JS    | ≤ 150 KB gz                      |
| Aperture shader        | ≤ 8 KB gz, loaded after LCP      |

---

## 11. Theme switcher (F4)

- **Where it lives (easy to spot):**
  - (1) **Desktop sidebar footer:** a three-segment icon control (sun · monitor · moon) beside the profile entry. Each segment has an `aria-label` and a tooltip ("Light", "Match device", "Dark"), and is at least 40 px on desktop.
  - (2) **Mobile:** the first row of the account menu in the header, plus Profile.
  - (3) **Auth pages:** the same control in the auth header, so the choice is available before sign-in.
  - (4) The same menu holds **"Q motion: Full · Calm · Off"** (§5.3).
- **Persistence.** Keep what exists: `localStorage["cq.theme"]`, cross-tab `storage` sync, and `system` meaning no attribute, so the media query keeps deciding. Syncing the choice to the account for other devices is P2. A cookie would make the shell request-bound and defeat the static shell, so do not switch to one.
- **No flash of the wrong theme.**
  - The existing inline `THEME_BOOT_SCRIPT` already sets `data-theme` before paint. Keep it in `<head>` before the stylesheets. It is static, so when the CSP lands it can be allowed by **hash** and needs no nonce, which suits a static shell.
  - **Fix:** the boot script and `applyTheme` must also update `<meta name="theme-color">`. Today it follows only `prefers-color-scheme`, so a person who chose dark on a light device gets a light browser bar.
  - **Add** a one-frame `data-theme-switching` attribute that sets `transition: none !important` during the swap, so hundreds of hover and colour transitions do not cascade (the next-themes `disableTransitionOnChange` pattern [43]).
  - An optional finishing touch: a 280 ms View Transition crossfade, or a circular reveal from the control, with zero duration under reduced motion.
- **Stage surfaces** (Discover, the voice stage) stay on `--cq-stage-*` in both themes. The theme changes the app, not the cinema.

---

## 12. Flows

### 12.1 First run

1. Sign up → check email → `/welcome`.
2. The aperture appears at stage size, still (idle). Q's introduction is on screen immediately and also spoken.
3. **Start** is the only primary action. The aperture opens (listening) and Q asks the one deciding question. The founder and investor options stay visible, so the user can answer by voice, tap or typing.
4. **The one choreographed moment:** once the conversation settles into onboarding, the stage aperture travels into the dock anchor, leaving a brief trail of light (≤ 400 ms). It shows the user where Q will live from now on.
5. Mic permission is requested only on Talk (doc 17 §54).

### 12.2 Returning user

`/welcome` redirects to the Q page (Home). The stage line reads "since you were away". **Needs you** is populated, and any running task shows in the dock pill on every page.

### 12.3 Founder

1. Drop a deck into the conversation. Q shows "Reading your deck" as a Now task.
2. Proposals come back as objects with confirm rows (UXA-011).
3. Q asks only for the gaps, using chips. "Review as form" is always available.
4. **First value:** an intelligence snapshot object, in `cq-display`. Unknowns are shown as unknown.
5. `/pitch` studio: guidance → record or upload → **"See it as investors will"**, the real feed frame.
6. Visibility preview and an explicit opt-in.
7. Incoming interest appears in the dock pill, under Needs you, and in Capital.

### 12.4 Investor

1. Mandate conversation (about 4 minutes, doc 17 §143) → a mandate object to confirm, with hard exclusions explained.
2. Immediate full-screen feed.
3. Save / Pass / Ask Q (split view).
4. Company profile.
5. Express Interest (server-confirmed). The canonical relationship is created once.
6. In Capital, the timeline runs Discovered → Interest → Match ("Both sides agreed to connect", no celebration) → Meeting → Diligence → Decision. The primary action is **Schedule meeting** (doc 17 §83–86).
7. **The money shot** (doc 17 §145) plays on the Board:
   - a five-company result object;
   - "Why #1?" scopes Q to that object;
   - "Compare 1 and 3" produces a comparison object;
   - "Show me #3" navigates, and the dock follows;
   - "Start an introduction" puts an approval under Needs you, showing the exact payload.

### 12.5 Relationships and settings

- **Relationship detail:** the timeline, shared-visibility markers, Q's "Prepare me for this meeting" and "Draft follow-up". The human always sends (doc 17 §87).
- **Settings** (secondary): Account, Organisation, Q preferences (voice, dock, Q motion, feed shortcuts), Notifications, Privacy, Security.

---

## 13. Page-by-page inventory

P0 = needed for the demo slice. P1 = next. P2 = later.

| Route / surface                                           | Today                                                                | Verdict             | Direction                                                                                  | Pri          |
| --------------------------------------------------------- | -------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------ | ------------ |
| `/`                                                       | Redirects to `/home`                                                 | Keep                | Public film landing later                                                                  | P2           |
| `/auth/*` (sign-in, sign-up, check-email, forgot, update) | Solid                                                                | Polish              | Static aperture in the header, **theme control**, styled secondary actions, instant shells | P1           |
| `/welcome`                                                | Intro + persona choice; stage used an orb/gradient                   | **Rework**          | Aperture stage, a single Start, visible choice, stage → dock moment                        | **P0**       |
| `/onboarding/founder`, `/onboarding/investor`             | Conversation-first plus form fallback; every choice is a card (debt) | **Rework**          | Stage + Board grammar: proposals as objects, `ChoiceList` rows, document drop              | **P0**       |
| `/home` = **the Q page**                                  | Thread + composer + chats                                            | **Rebuild (F3)**    | Stage + Board + Now/Needs you + command bar; history in a drawer; transcript view          | **P0**       |
| Q dock + panel/sheet                                      | Chrome presence + sheet                                              | **Rebuild (F1/F2)** | Q Aperture, dock physics, shared-element hand-off                                          | **P0**       |
| `/discover` (investor)                                    | A card in a page container                                           | **Rebuild layout**  | §9                                                                                         | **P0**       |
| `/discover` (founder)                                     | Investor list                                                        | Polish              | Hairline rows, Ask Q about fit, a single empty state                                       | P1           |
| `/company/[companyId]`                                    | Network preview + deeper view                                        | **Rework**          | Hero pitch (shared element), dossier, evidence drawer, Ask Q split, action bar             | **P0**       |
| `/capital`                                                | Objective; relationships "none yet"                                  | Extend              | Objective + relationship timeline list                                                     | P1           |
| `/pitch`                                                  | Resumable upload                                                     | Extend              | Studio + "See it as investors will"                                                        | P1           |
| `/company/visibility`                                     | Both-sides visibility                                                | Polish              | Preview as the other side; fix the status-word spacing                                     | P1           |
| `/verification`                                           | Standings                                                            | Keep                | Plain status list                                                                          | P2           |
| `/profile`                                                | Definition list + theme                                              | Keep                | Entry to Settings; the theme also moves to the chrome                                      | P2           |
| `/dev/q-presence`, `/dev/ui`                              | Dev galleries                                                        | Extend              | Every aperture state × theme × size × motion setting, for acceptance                       | P0 (tooling) |
| Global loading / error / not-found                        | **Missing**                                                          | **Add**             | Geometry-matched skeletons, calm retry, a plain 404                                        | **P0**       |
| Saved                                                     | **Missing**                                                          | Add                 | Poster grid, "Compare selected"                                                            | P1           |
| Compare                                                   | **Missing**                                                          | Add                 | Side-by-side dossier plus Q recommendation with uncertainty; also a Board object           | P1           |
| Relationship detail                                       | **Missing**                                                          | Add                 | §12.5                                                                                      | P1           |
| Organisation / mandate                                    | **Missing**                                                          | Add                 | Declared mandate, GateQ inbound state, portfolio                                           | P1           |
| Company (founder's own)                                   | **Missing**                                                          | Add                 | Overview · Intelligence · Evidence · Visibility                                            | P1           |
| `/q/artifacts/[id]`                                       | Viewer inside the thread only                                        | Add                 | A shareable, re-authorised route                                                           | P1           |
| Settings                                                  | **Missing**                                                          | Minimal             | §12.5                                                                                      | P2           |
| Notifications / Action Centre                             | **Missing**                                                          | Minimal             | Material actions only; feeds Needs you                                                     | P2           |
| External Q Card (public)                                  | **Missing**                                                          | Later               | Value before sign-in (UXA-033)                                                             | P2           |

---

## 14. Motion, typography, colour — and which prohibitions stay

### 14.1 Motion

- Use the existing `--cq-motion-*` scale (90–360 ms) and easings.
- Add `--cq-spring-snap` for the dock and feed settle, and `--cq-motion-gesture` at 280 ms.
- Q's own motion vocabulary: open (listening), focus (thinking), project (speaking), shutter (complete).
- Everything outside Q stays transform- and opacity-only at small amplitude (doc 18 §121).

### 14.2 Typography

- Geist Sans throughout. The cinematic feel comes from scale contrast: `cq-display` for first value and the name on the company hero, and `cq-title-lg` for Q's stage line.
- `cq-numeric` (tabular figures) on every figure [16][19].
- Weights 400, 500 and 600 only.

### 14.3 Colour

- Light mode is first-class.
- The stage family (`--cq-stage-*`) is used for Discover and voice.
- New Q light tokens are in §5.2. Also add `--cq-stage-scrim` and `--cq-z-presence` (a layer between navigation and popover).
- The accent is reserved for interactive elements, Q-active and selected states.

### 14.4 Which of the old prohibitions still hold (F2)

**Relaxed, for Q only:**

- glow and bloom;
- animated light;
- a shader or 3D mark;
- a hue ramp within the accent family;
- the side light leak;
- motion while Q is working.

**Still in force**, because each protects trust, legibility or speed:

| Keep                                                                                                                               | Why                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Glow anywhere except Q** (buttons, cards, headings, charts, hover)                                                               | Q only glows because nothing else does                                                         |
| Badge spam; "Hot / Top match / 94%"; confidence percentages; fit meters                                                            | Evidence before opinion; invented numbers                                                      |
| Cards around paragraphs; card-in-card; metric-card grids; three-feature-card heroes                                                | Structure is information; cards are for objects                                                |
| Robot, face, brain or character imagery; neural-network particles; hexagons; circuit lines; holographic dashboards; fake terminals | Undermines institutional trust; generic                                                        |
| **Rainbow or purple-blue multi-hue gradients**, and gradient headings                                                              | Now the most common AI cliché. Our distinction is one-hue light                                |
| Fake agent activity ("Research Agent…"); typewriter; scramble text; "typing…" when nothing is running                              | One Q; honesty about work (doc 18 §4.8, §128)                                                  |
| Glass and `backdrop-blur` on reading surfaces                                                                                      | Liquid Glass showed the legibility cost [13]. Opaque surfaces; the scrim is used only on video |
| Cursor-following glow; parallax; bouncing notification bells; confetti                                                             | Distraction, vestibular risk, gamification                                                     |
| Red Pass; colour-only meaning                                                                                                      | Neutral decision; WCAG 1.4.1                                                                   |
| Uppercase tracking-widest eyebrows; 700+ weights                                                                                   | Template tells                                                                                 |
| Sparkles as the Q icon                                                                                                             | The aperture _is_ the mark                                                                     |

---

## 15. Phased plan

Sizes: S ≈ half a day, M ≈ 1 day, L ≈ 2 days.

| Packet                                            | Scope                                                                                                                                          | Size   |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **UX-01 Instant shell**                           | Suspense shells, global error / not-found, parallel awaits, persistent-layer audit, `instant()` tests. UX-01b: Cache Components (after ADR C8) | M (+M) |
| **UX-02 Q Aperture**                              | Shared WebGL2 renderer + SVG fallback, the nine states, Q Lumen, Q-motion setting, light tokens; retire the particle field                     | L      |
| **UX-03 Dock + hand-off**                         | Drag, snap and stash; avoid zones; menu move; persistence; compact pill; shared conversation store; dock ↔ page shared elements                | M      |
| **UX-04 Q page (Stage + Board)**                  | Stage, ambient transcript, Board objects, Now / Needs you, command bar, history drawer, transcript view, inline artifacts, `/q/artifacts/[id]` | L      |
| **UX-05 Discover immersive**                      | §9 layouts, rail and dock merge, intelligence panel, inputs, 3-player recycling, poster LCP, reduced-motion policy                             | L      |
| **UX-06 Feed → company**                          | Morph, profile rework, Activity-preserved Back                                                                                                 | M      |
| **UX-07 Theme switcher**                          | Chrome placement, auth header, theme-color fix, transition suppression, optional crossfade                                                     | S      |
| **UX-08 First run + onboarding**                  | Welcome stage, stage → dock moment, Board grammar in onboarding                                                                                | M      |
| **UX-09 Capital + relationships + Saved/Compare** | §12.4–12.5                                                                                                                                     | M      |
| **UX-10 Secondary surfaces**                      | Organisation/mandate, founder Company page, Settings, Notifications                                                                            | M      |

### Acceptance criteria (measurable)

**UX-01**

- `instant()` passes for Q page → Discover, Discover → company → Back, Discover → Capital, and → Profile.
- Click → shell ≤ 100 ms at 4× CPU throttle.
- CLS = 0 across every shell swap.
- No `force-dynamic` remains after 01b.
- A negative test proves the static shell contains no session data.

**UX-02**

- `/dev/q-presence` has snapshots of every state × {light, dark, stage} × {dock, stage} at 390×844 and 1440×900.
- **Zero** requestAnimationFrame callbacks in IDLE over 10 s.
- Sweep amplitude drops by 5.0 s.
- The Q-motion control and `prefers-reduced-motion` both give static output (computed-style and trace check).
- Ring contrast is ≥ 3:1 against its background in every state and theme (automated sample), and no label text sits on the glow.
- GPU ≤ 1.5 ms/frame (dock) and ≤ 4 ms/frame (stage) on a mid-tier Android trace.
- Shader ≤ 8 KB gz and loaded after LCP.
- Exactly one WebGL context on the page.
- Forced-colours mode renders the SVG ring.

**UX-03**

- The dock can be moved by the keyboard menu (WCAG 2.5.7).
- A tab-through of 8 routes finds no focused element fully hidden behind the dock at its default anchor (2.4.11).
- Target ≥ 44 × 44 px.
- A voice session survives Q page → Discover → company with the mic indicator visible.
- Dock → Q page makes **no new network request** for the conversation, and voice audio keeps playing.
- Page → dock keeps a running task visible in the pill.

**UX-04**

- There is no scrolling message list on the default layout.
- Each Q answer renders as a typed object.
- The transcript view gives a complete linear log and passes axe with 0 violations.
- An artifact opens ≤ 100 ms after tapping its object, and its first slide appears ≤ 1 s.
- Download and Share are separate controls.
- A revoked user is denied the artifact route.
- The money-shot script (doc 17 §145) completes on the Board.

**UX-05**

- The stage fills 100svh at 390×844 and 360×740 with no horizontal scroll.
- On desktop, stage height = viewport − 2 × gutter at 1440×900 and 1280×720.
- At most 3 `<video>` elements exist.
- Swipe-to-first-frame p75 < 500 ms (warmed).
- Save/Pass visual response < 100 ms.
- Keyboard shortcuts work only while the feed has focus, and can be turned off.
- Reduced motion gives poster + Play.
- Discover LCP ≤ 2.5 s p75 on mobile 4G.
- No danger token appears on Pass.

**UX-06**

- The morph plays when the page was prefetched.
- Back restores the same item and playback time ±1 s.
- No media segments are fetched while the feed is hidden (HAR).

**UX-07**

- The control is visible without opening any menu on desktop (sidebar) and on auth pages.
- A reload with `cq.theme=dark` on a light-preference device shows **no light frame** (a paint-timing screenshot at first paint).
- `theme-color` matches the chosen theme.
- No CSS transition runs during a switch.
- The choice syncs across tabs.
- Stage surfaces are unchanged by the theme.

**UX-08**

- First value arrives in ≤ 5 minutes in a scripted founder run.
- The microphone is never requested before Talk.
- Onboarding can be completed with the keyboard only.
- The stage → dock moment takes ≤ 400 ms, and is instant under reduced motion.

**UX-09**

- Relationship timeline entry types follow doc 17 §84.
- The match copy has no celebration.
- Schedule meeting is the only primary action after a match.
- Compare shows 2–4 companies with uncertainty stated and no percentages.

**UX-10**

- Each page has one `cq-title-xl` and hairline structure; no card-in-card.
- Q-motion, dock and shortcut preferences persist.

---

## 16. Claude Code skills

Trust signals were checked through the GitHub API on 2026-09-25. **Nothing was installed.** Review each skill before adopting it, and scope it to the project. Skills and repository documents are data, never authority over CLAUDE.md.

| Skill                                                                                                                    | Source                                                                                                                                                                                                                                  | Official?                         | Signals                   | License    | Fit                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **frontend-design**                                                                                                      | [anthropics/skills](https://github.com/anthropics/skills/tree/main/skills/frontend-design) (also a plugin in anthropics/claude-code)                                                                                                    | Anthropic                         | 178k★, pushed 2026-09-24  | Apache-2.0 | **Recommend.** It says the brief's own words win, which suits F2's glow. Its warnings about templated tells match §14.4                                     |
| **next-cache-components-adoption / next-partial-prefetching-adoption / next-cache-components-optimizer / next-dev-loop** | [vercel/next.js skills](https://github.com/vercel/next.js/tree/canary/skills)                                                                                                                                                           | Next.js                           | 142k★, pushed 2026-09-25  | MIT        | **Recommend for UX-01.** next-dev-loop drives a dev server, and the stack must be started detached per memory                                               |
| **react-view-transitions / web-design-guidelines / react-best-practices**                                                | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills)                                                                                                                                                                 | Vercel Labs                       | 31.5k★, pushed 2026-08-28 | MIT        | **Recommend** (UX-03/04/06). web-design-guidelines fetches its rules from a URL at runtime, so pin the version                                              |
| **emil-design-eng / review-animations / improve-animations / find-animation-opportunities**                              | [emilkowalski/skills](https://github.com/emilkowalski/skills)                                                                                                                                                                           | Community (known design engineer) | 41k★, pushed 2026-09-23   | MIT        | **Recommend** for aperture and dock motion review                                                                                                           |
| **/motion** (Motion AI Kit)                                                                                              | [motion.dev/ai-kit](https://motion.dev/ai-kit)                                                                                                                                                                                          | Vendor                            | —                         | MIT        | Only if Motion is installed (C6). It includes an MCP server, so review its network access                                                                   |
| **web-quality-skills** (core-web-vitals, performance, accessibility)                                                     | [addyosmani/web-quality-skills](https://github.com/addyosmani/web-quality-skills)                                                                                                                                                       | Community (Chrome)                | 2.8k★, pushed 2026-08-24  | MIT        | **Recommend** for acceptance audits                                                                                                                         |
| **ui-skills** (baseline-ui, fixing-accessibility, fixing-motion-performance)                                             | [ibelick/ui-skills](https://github.com/ibelick/ui-skills)                                                                                                                                                                               | Community                         | 9k★, pushed 2026-09-22    | MIT        | Optional                                                                                                                                                    |
| **impeccable**                                                                                                           | [pbakaus/impeccable](https://github.com/pbakaus/impeccable)                                                                                                                                                                             | Community                         | 70.8k★, pushed 2026-09-25 | Apache-2.0 | Use the **CLI detector read-only**. `init` writes PRODUCT.md/DESIGN.md and agent config (not to be committed). Some rules will flag F2's glow, so tune them |
| **shadcn**                                                                                                               | [shadcn-ui/ui](https://ui.shadcn.com/docs/skills)                                                                                                                                                                                       | shadcn                            | 124k★                     | MIT        | Low value: no `components.json`, and `packages/ui` wraps Base UI directly                                                                                   |
| **ui-ux-pro-max**                                                                                                        | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)                                                                                                                                         | Community                         | 130k★, pushed 2026-09-21  | MIT        | **Do not adopt.** Its generated design systems (79 styles, Python) fight the locked `--cq-*` tokens                                                         |
| Awesome lists                                                                                                            | [ComposioHQ](https://github.com/ComposioHQ/awesome-claude-skills) (75.6k★), [travisvn](https://github.com/travisvn/awesome-claude-skills) (15k★), [wilwaldon toolkit](https://github.com/wilwaldon/Claude-Code-Frontend-Design-Toolkit) | Community                         | —                         | Mixed      | Discovery only                                                                                                                                              |
| Already here                                                                                                             | `design:accessibility-review`, `design:design-critique`, `design:design-handoff`, `design:ux-copy`                                                                                                                                      | Anthropic plugin                  | —                         | —          | Use now for reviews                                                                                                                                         |

**Recommendation:** frontend-design, the Next.js adoption and optimizer skills, react-view-transitions, emil-design-eng + review-animations, and web-quality-skills. Use impeccable's detector read-only. Skip ui-ux-pro-max.

---

## 17. Conflicts needing an ADR

### 17.1 Founder-directed amendments (binding; record as ADRs amending docs 17/18 and CLAUDE.md)

| #      | Amendment                                                                                      | Amends                                                                                                                      | ADR content                                                                                                                                                                                                                                                                                                             |
| ------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F1** | Dedicated Q page **plus** a floating, draggable Q, with a hand-off that keeps the conversation | Doc 17 §9 (last line), §200.3; `navigation.ts` / `global-q.tsx` comments                                                    | "Q Dock": a movable presence tied to the page subject and real state, with no promotional prompts or unread nags. It never covers registered controls, and the sidebar Q entry remains. One conversation store is shared by the dock and the page                                                                       |
| **F2** | Futuristic Q with glow, light, fluid motion and shader or 3D                                   | CLAUDE.md "Prohibited AI-slop visuals" (glowing…, purple-blue gradients); doc 18 §4.1, §4.2, §33, §35, §36, §38, §127, §130 | "Q Aperture": glow allowed **on Q only**, one hue family, idle bloom static, motion only for real audio or work, Q-motion setting (Full/Calm/Off), reduced-motion, reduced-transparency and forced-colours fallbacks, ring contrast ≥ 3:1, no text on glow, the budgets in §5.4. §14.4 lists the prohibitions that stay |
| **F3** | No chat-style Q page                                                                           | Doc 17 §10–11 (thread-based workspace), `visual-direction.md` "Q presence surface" recipe                                   | "Stage + Board": answers as typed objects, a Now / Needs you task view, ambient transcript, history and a linear transcript as secondary, accessible views                                                                                                                                                              |
| **F4** | A visible theme switcher                                                                       | Doc 17 §149 (appearance under secondary Settings)                                                                           | Chrome placement (sidebar footer, account menu, auth header), existing storage and boot script, theme-color follows the choice, transitions suppressed during a switch                                                                                                                                                  |

### 17.2 Other conflicts

| #   | Conflict                                                           | Locked source                                                                                    | Proposal                                                                                                             |
| --- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| C3  | The existing particle presence                                     | Doc 18 §4.1; `visual-direction.md`; vault 2026-09-15; code cites an unrecorded "prototype brief" | Superseded by the F2 ADR; retire in UX-02                                                                            |
| C4  | TikTok-style action rail                                           | Doc 18 §83 ("not TikTok-cloned")                                                                 | Allow a right rail with text labels, no counters and no like/share semantics                                         |
| C5  | Header hidden on mobile Discover                                   | Doc 17 §7                                                                                        | Minor amendment: the bottom nav stays, on stage tokens                                                               |
| C6  | Motion for React not installed                                     | CLAUDE.md vs `visual-direction.md`                                                               | Lead decides whether to install `motion` or hand-roll the physics                                                    |
| C7  | z-index layer for the dock and Q Lumen                             | Doc 18 §177–178                                                                                  | Add `--cq-z-presence`                                                                                                |
| C8  | Prerendered static shell vs "session-bound HTML never prerendered" | Doc 15 §9.4                                                                                      | Security ADR: zero session data in the shell, guard at the proxy and at data leaves, no `'use cache'` on token reads |
| C9  | View Transition recipes use blur                                   | Doc 18 §127                                                                                      | F2 relaxes glow for Q only. Page transitions still use no blur                                                       |
| C10 | Reduced motion and feed video                                      | Doc 18 §125 vs ADR-001                                                                           | Already resolved by ADR-001 (poster + Play)                                                                          |
| C11 | Voice persisting across pages                                      | Doc 17 §55, ADR 0010                                                                             | Allowed with an always-visible mic indicator on the dock plus a one-tap Stop. Confirm against ADR 0010               |

---

## 18. Open questions for the lead

1. Install Motion for React now (C6)?
2. Does security accept the static-shell posture (C8) before UX-01b?
3. Is the stage 3D glass variant of the aperture (§8) wanted for the demo, or is the 2.5D shader enough?
4. Should the nav label for the Q page stay "Home", or become "Q"? The route stays `/home` either way, which keeps `?c=` deep links working.

---

## 19. Sources

1. ChatGPT voice moved into chat (Nov 2025): [TechCrunch](https://techcrunch.com/2025/11/25/chatgpts-voice-mode-is-no-longer-a-separate-interface/), [MacRumors](https://www.macrumors.com/2025/11/26/chatgpt-voice-mode-update-seamless-chat/)
2. Gemini overlay and Live redesign (Apr 2026): [9to5Google](https://9to5google.com/2026/04/07/gemini-live-redesign-android/), [Android Authority](https://www.androidauthority.com/gemini-overlay-live-neural-design-apk-teardown-3690991/)
3. Siri in iOS 27: [9to5Mac](https://9to5mac.com/2026/04/19/apple-has-already-teased-siris-new-design-coming-in-ios-27/), [MacRumors](https://www.macrumors.com/2026/05/12/ios-27-siri-redesign/), [Beebom](https://gadgets.beebom.com/news/apple-unveils-siri-ai-at-wwdc-2026)
4. Apple HIG, Live Activities: [developer.apple.com](https://developers.apple.com/design/human-interface-guidelines/components/system-experiences/live-activities)
5. Sesame, voice presence: [sesame.com](https://www.sesame.com/research/crossing_the_uncanny_valley_of_voice)
6. WCAG 2.2 SC 2.2.2: [w3.org](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)
7. WCAG 2.2 SC 2.5.7: [w3.org](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)
8. WCAG SC 2.1.4: [w3.org](https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html)
9. WCAG 2.2 SC 2.4.11: [w3.org](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)
10. (unused)
11. NN/g on site AI chat: [site-ai-chatbot](https://www.nngroup.com/articles/site-ai-chatbot/), [discoverability](https://www.nngroup.com/articles/discoverability-ai-amazon/)
12. Humane / Rabbit: [VAExperience](https://blog.vaexperience.com/the-ux-fails-of-ai-tech-rabbit-r1-humane-ai-pin/), [Bossa Research](https://medium.com/@bossaresearch/anatomy-of-a-failure-the-humane-ai-pin-and-the-misfit-future-of-wearable-ai-04feedd82903)
13. Liquid Glass legibility: [NN/g](https://www.nngroup.com/articles/liquid-glass/), [Wikipedia](https://en.wikipedia.org/wiki/Liquid_Glass)
14. Dia: [The Browser Company](https://browsercompany.substack.com/p/the-strategy-behind-dias-design), [Wikipedia](<https://en.wikipedia.org/wiki/Dia_(web_browser)>)
15. Linear refresh: [linear.app/now](https://linear.app/now/behind-the-latest-design-refresh), [changelog](https://linear.app/changelog/2026-03-12-ui-refresh)
16. Mercury analysis: [Refero](https://styles.refero.design/style/3172cd4d-118a-4a16-a259-6b634d32322e), [blakecrosley.com](https://blakecrosley.com/guides/design/mercury)
17. TikTok desktop: [TechCrunch](https://techcrunch.com/2025/02/27/in-challenge-to-youtube-tiktok-revamps-its-desktop-platform), [Tubefilter](https://www.tubefilter.com/2025/02/28/tiktok-desktop-platform-redesign-new-screen/)
18. Loom bubble: [Atlassian](https://support.atlassian.com/loom/docs/make-your-camera-bubble-visible-in-loom-recordings/)
19. Robinhood Legend: [robinhood.com](https://robinhood.com/us/en/legend/)
20. Rauno Freiberg: [rauno.me](https://rauno.me/craft/interaction-design)
21. Motion drag: [motion.dev](https://motion.dev/docs/react-drag), [PiP example](https://janessagarrow.com/blog/framer-motion-pip/)
22. prefers-reduced-transparency: [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-transparency), [Chrome](https://developer.chrome.com/blog/css-prefers-reduced-transparency)
23. Stripe minigl: [Bram.us](https://www.bram.us/2021/10/13/how-to-create-the-stripe-website-gradient-effect/)
24. three.js size and TBT: [R3F #812](https://github.com/pmndrs/react-three-fiber/discussions/812), [Utsubo](https://www.utsubo.com/blog/threejs-best-practices-100-tips)
25. Next.js view transitions (16.3): [nextjs.org](https://nextjs.org/docs/app/guides/view-transitions); React 19.3: [react.dev](https://react.dev/blog/2026/09/09/react-19-3)
26. ElevenLabs UI Orb: [ui.elevenlabs.io](https://ui.elevenlabs.io/docs/components/orb)
27. Viewport units: [web.dev](https://web.dev/blog/viewport-units)
28. (see 32)
29. hls.js API: [GitHub](https://github.com/video-dev/hls.js/blob/master/docs/API.md), [preload window](https://dev.to/masonwritescode/build-a-directional-preload-window-for-a-scrolling-video-feed-with-hlsjs-310o)
30. Next.js 16.3: [nextjs.org/blog/next-16-3](https://nextjs.org/blog/next-16-3)
31. Instant navigation: [nextjs.org](https://nextjs.org/docs/app/guides/instant-navigation)
32. Migrating to Cache Components (incl. Activity state preservation): [nextjs.org](https://nextjs.org/docs/app/guides/migrating-to-cache-components)
33. frontend-design SKILL.md: [GitHub](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md)
34. Apple Intelligence glow implementations: [jacobamobin/AppleIntelligenceGlowEffect](https://github.com/jacobamobin/AppleIntelligenceGlowEffect), [VP0 Journal](https://vp0.com/blogs/apple-intelligence-glow-border-effect-code-ios-free-ios-template-vibe-coding-gui), [DEV](https://dev.to/vector4wang/i-recreated-iphones-apple-intelligence-edge-glow-effect-on-mac-57f5)
35. ChatGPT Advanced Voice orb: [TechCrunch](https://techcrunch.com/2024/11/19/openai-brings-chatgpts-advanced-voice-mode-to-the-web), [OpenAI help](https://help.openai.com/en/articles/8400625-voice-mode-faq)
36. Copilot Mico: [Windows Forum](https://windowsforum.com/threads/mico-microsofts-non-human-avatar-for-copilot-voice-mode.386895/), [AlternativeTo](https://alternativeto.net/news/2025/7/microsoft-introduces-its-first-copilot-appearance-avatar-with-real-time-animated-reactions)
37. Hume EVI: [hume.ai](https://www.hume.ai/empathic-voice-interface)
38. Wattenberger, "Why Chatbots Are Not the Future": [wattenberger.com](https://wattenberger.com/thoughts/boo-chatbots/), [Simon Willison](https://simonwillison.net/2023/May/15/why-chatbots-are-not-the-future/)
39. Google generative UI: [Google Research](https://research.google/blog/generative-ui-a-rich-custom-visual-interactive-user-experience-for-any-prompt/), [9to5Google](https://9to5google.com/2025/11/25/gemini-generative-uis-apps/)
40. Arc Search "Browse for Me": [arc.net](https://arc.net/blog/arc-search), [9to5Mac](https://9to5mac.com/2024/01/29/arc-search/)
41. tldraw computer / spatial AI: [tldraw docs](https://tldraw.dev/docs/ai), [Google AI Studio case study](https://aistudio.google.com/case-studies/tldraw)
42. Granola: [docs](https://docs.granola.ai/help-center/taking-notes/ai-enhanced-notes)
43. Theme flash prevention: [next-themes](https://github.com/pacocoursey/next-themes), [DEV](https://dev.to/137foundry/how-to-prevent-the-flash-of-wrong-theme-when-implementing-dark-mode-2pg1)
44. Skills ecosystem: [Firecrawl](https://www.firecrawl.dev/blog/best-claude-code-skills), [shadcn skills](https://ui.shadcn.com/docs/skills), [Motion AI Kit](https://motion.dev/ai-kit), [Emil Kowalski](https://github.com/emilkowalski/skills), [Vercel web-design-guidelines](https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines)
