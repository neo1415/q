# Capital Q — Visual Direction (prototype sprint)

One page every UI agent follows. Derived from doc 17 (§§3–8, 60–63, 105–107) and doc 18 (§§3–4, 13–31, 33–41, 46–61, 100–124, 182–191, 199–202). Where this brief and a doc disagree, the doc wins; where a doc is silent, this brief decides.

## The character, in one line

**Quiet institutional futurism.** Calm, fast, intelligent, deliberate. The intelligence is the futurism; the decoration never announces it. A person should perceive four things — Q → Company Intelligence → Capital Network → Capital Execution — never 25 modules.

The test for any screen: would a partner at a serious fund read this at 7am on a phone and trust it? If a screen looks like a chat app, a SaaS dashboard, a crypto terminal or a "powered by AI" landing page, it is wrong.

## Tokens are the only visual truth

`packages/ui/src/tokens/tokens.css` (`@capital-q/ui/styles.css`). Prefix `--cq-*` only. No raw hex/oklch in a component, no `--color-*` aliases, no Tailwind colour utilities (`bg-white`, `text-slate-500`, `bg-white/10`). Utilities read tokens directly: `bg-(--cq-surface)`, `text-(--cq-text-secondary)`, `border-(--cq-border-subtle)`, `duration-(--cq-motion-fast)`, `z-(--cq-z-popover)`.

### Surfaces (light is first-class; dark is structurally complete)

```
--cq-canvas            page background (warm off-white paper, never pure white)
--cq-surface           a panel, a composer, a row that needs its own ground
--cq-surface-raised    popover, sheet, dialog, composer (with --cq-shadow-xs)
--cq-surface-subtle    hover ground, selected navigation ground with accent-soft
--cq-surface-strong    skeletons, progress track
--cq-surface-sunken    NEW  a person's own message; a well an answer sits in
```

Hierarchy is `canvas → section → surface → raised overlay`. Never alternate greys to make structure; use hairlines (`--cq-border-subtle`) and spacing.

### Text

`--cq-text-primary` for content, `--cq-text-secondary` for supporting prose and labels, `--cq-text-tertiary` for meta/provenance/timestamps only. Tertiary is never used for something the person must read to act.

### Accent and semantics

One accent (`--cq-accent`, `-hover`, `-soft`): primary action, selected state, active navigation, Q's interactive state. Nothing else is blue for being important. `--cq-positive` / `--cq-warning` / `--cq-danger` (+ `-soft`) are for confirmed states, attention/conflict, and destructive/security — **never** for "good company", "high confidence" or "Pass". Unknown is neutral text ("Not enough information"). Meaning is always a label or icon as well as a colour.

### Typography (Geist Sans; Geist Mono for IDs/code only)

| role              | mobile / desktop | use                                                      |
| ----------------- | ---------------- | -------------------------------------------------------- |
| `cq-display`      | 34 / 40          | rare first-value moments only                            |
| `cq-title-xl`     | 28 / 32          | the one page title                                       |
| `cq-title-lg`     | 24 / 26          | Q headline, snapshot headline                            |
| `cq-title-md`     | 20 / 21          | section header                                           |
| `cq-title-sm` NEW | 17 / 18          | an item title in a list or panel (a company in Discover) |
| `cq-body-lg`      | 17               | important prose (Q's opening line)                       |
| `cq-body`         | 16 / 15          | default, including Q answers                             |
| `cq-body-sm`      | 14               | compact UI, descriptions under headers                   |
| `cq-label`        | 13 / 500         | controls, definition terms, meta headers                 |
| `cq-caption`      | 12               | supporting only: provenance, timestamps                  |
| `cq-numeric`      |                  | every money figure, metric, count, date column           |
| `cq-prose` NEW    | 70ch, 1.6        | Q answers and evidence reading                           |

Weights 400/500/600 only. No uppercase tracking-widest eyebrows, no gradient headings, no 700+ in the application, no ultra-light display.

### Spacing, radius, borders, shadows

- 4 px base; use Tailwind's scale (`gap-2/3/4/5/6/8/10`). Page rhythm: sections `gap-10`, inside a section `gap-3`–`gap-5`, rows `py-3`–`py-4`.
- Page edge: `--cq-page-gutter` (16 → 24 → 32 px). `PageContainer` already does this; anything full-bleed (feed, composer dock) aligns to the same gutter.
- Radius: controls `rounded-md` (10), panels `rounded-lg` (14), sheets/dialogs `rounded-xl` (18), chips and status pills `rounded-full`. Never `rounded-2xl`/`rounded-3xl` on panels.
- Borders before shadows. Default `1px --cq-border-subtle`; `--cq-border` for controls; `--cq-border-strong` for focus-within, hover on a control, selected containers.
- Shadows communicate elevation only: `--cq-shadow-xs` resting composer/dossier, `--cq-shadow-sm` NEW menus/popovers, `--cq-shadow-overlay` sheets/dialogs. A card at rest has no shadow.

### Motion (CSS transitions; Motion for React is not installed and is not needed this sprint)

```
--cq-motion-instant   90ms   colour/opacity feedback on press
--cq-motion-fast     140ms   hover, focus, chip select, colour changes
--cq-motion-base     200ms   popover, menu, dialog fade/scale 0.98
--cq-motion-emphasis 280ms   content arriving (.cq-arrive), step change, Q answer block
--cq-motion-slow     360ms   sheet/drawer spatial move only
--cq-ease            standard (0.22, 1, 0.36, 1)      --cq-ease-exit  (0.4, 0, 1, 1)
```

Amplitude: 2–4 px for controls, 8–16 px for content (`.cq-arrive` = 10 px rise). Animate `transform` and `opacity` only. Nothing exceeds 400 ms. Q working = the three-dot opacity rhythm (`.cq-working-dot`) or a stage label change — never particles, orbits, typewriter, blur-in, scramble, or a breathing halo. **Reduced motion**: the global rule in tokens.css stills every animation and transition; do not opt anything out of it, and never disable access to content or video because of it (poster + explicit Play).

### Icons

Lucide, re-exported from `@capital-q/ui/icons` (`ICON_SIZE.compact 16 / regular 18 / prominent 20`, `ICON_STROKE 1.75`). Add an icon to that file rather than importing `lucide-react` in an app. `Sparkle` is only for "Q inferred" evidence; the Q mark (`QMark`) is Q's identity and is not a generic icon, loader or button glyph. No emoji, no filled icon sets, no illustrations.

### Layout grid and density

Desktop: sidebar 240 + workspace; content capped at `--cq-layout-content` 1040 (reading 760, narrow 600). Q prose never exceeds 70ch. Mobile: single column, 16 px gutter, bottom navigation reserves its height. Density is "comfortable institutional": review surfaces may be denser than onboarding and Discover; nothing is a marketing site and nothing is a terminal.

### Responsive rules

Mobile is the base; desktop enlarges titles and relaxes 44 px controls to 40 px (`Button` already does). Touch targets ≥ 44 px everywhere on mobile including chips and icon buttons. Sticky/fixed things use the shell tokens (`--cq-header-height`, `--cq-bottom-nav-height`, safe-area insets) — never a magic number.

## Recipes (copy these)

**Page frame** — `PageContainer` + `PageHeader` from `@/components/app-shell/page-container`. One `cq-title-xl` per page, a `cq-body` secondary description capped at reading width. Home is the exception: Q is the page and has no "Home" heading.

**Section header** — `PageSection` (`cq-title-md` + optional `cq-body-sm` secondary). Sections are separated by space (`gap-10`), not by cards or rules.

**Primary / secondary actions** — `Button variant="primary"` for exactly one action per decision area; `secondary` for the alternative; `quiet` for Back/Edit/Dismiss; `danger` only for irreversible/security. Pass and Skip are `secondary` or `quiet`, never danger. Use `buttonClassName()` on a `Link`, never a hand-rolled `h-12 bg-(--cq-accent)` anchor.

**Dossier panel** (a company, a mandate, an approval, a snapshot):

```html
<section class="cq-panel">
  <header class="cq-panel-header">
    <h3 class="cq-title-sm text-(--cq-text-primary)">Northbank Capital</h3>
    <span class="cq-status-line">Updated 2 days ago</span>
  </header>
  <div class="cq-panel-body cq-panel-rows">
    <div class="flex justify-between gap-4 py-3">
      <dt class="cq-label text-(--cq-text-secondary)">Stage</dt>
      <dd class="cq-body cq-numeric">Seed – Series A</dd>
    </div>
    …
  </div>
</section>
```

Rows are hairline-divided (`cq-panel-rows` or `divide-y divide-(--cq-border-subtle)`); no card inside a card; no shadow at rest.

**Quiet status line** — `<p class="cq-status-line"><Icon size={16}/> Supported by 3 sources · from your deck, p.4</p>`. Tertiary colour, caption size, an icon or the Q mark for meaning. When it needs attention it becomes an `InlineNotice`, not a louder status line.

**Inline evidence / confidence reveal** — `EvidenceStatus` (`from_document`, `from_founder`, `inferred`, `needs_confirmation`, `needs_evidence`, `uncertain`) directly under the fact it qualifies, in a `cq-panel-rows` row. Confidence is textual ("High confidence", "Conflicting", "Not enough information"), never a percentage bar or a green tick. The reveal on tap/click is a `Popover` (desktop) or `Sheet side="bottom"` (mobile) listing source, locator, status and recency — the analytical context underneath stays put.

**Q presence surface** — the `QMark` at `md` beside a `cq-body-lg` line in Q's own words, a `QStateIndicator` for state (label is the meaning; dots are decoration), and the `QComposer` on `--cq-surface-raised` with `--cq-shadow-xs`. Q's answer is open, document-like prose (`cq-prose`) with `EvidenceStatus` lines and structured blocks (findings, next steps) as hairline-divided sections; the person's own turn is a compact `--cq-surface-sunken` block capped at narrow width, right-aligned is fine, but it is not a messenger bubble with a tail. Q's voice stage may be an inverted field (`--cq-stage-*` tokens) but Q's presence there is the mark, its state label and a level-driven ring (scale ≤ 1.04, opacity) or waveform — never a blurred halo, a radial glow, a gradient orb or a purple cast.

## What NOT to do

- No glowing orbs, halos, `blur-2xl`, radial "aura" gradients, purple-blue AI gradients, particles, neural lines, holographic panels, robot/brain imagery, agent-swarm activity, "Research Agent is thinking".
- No `bg-white/10`, `text-white/60` or any literal colour in an app file; the stage uses `--cq-stage-*`.
- No card around a paragraph, a title, or a single metric; no metric-card grids; no three-feature-card heroes.
- No badge spam: "Verified", "Hot", "Top match", "94%". Badges are status, verification, scope, exception, with an exact label.
- No confidence percentages, gauges, fit meters or score rings. Readiness ≠ quality ≠ fit ≠ interest — do not render them alike.
- No red Pass, no green "fit", no colour-only meaning.
- No chat bubbles with tails for Q, no typewriter, no "Q is typing…" when nothing is running, no confetti on completion.
- No `rounded-2xl` panels, no `shadow-xl`, no `backdrop-blur` except a navigation/overlay that genuinely benefits, no arbitrary `z-[999]`.
- No uppercase eyebrows, no letter-spaced labels, no 700+ weights, no gradient text.
- No dashboards: Home is Q; Discover is a ranked list/feed; Capital is the objective and its relationships; Profile is a definition list. Counters reading zero, empty activity feeds and "0 matches" panels are not content.
- No new design system, no new package, no `@theme` colours in `globals.css`, no component that duplicates one in `packages/ui`. A missing primitive two agents need goes into `packages/ui` via the design director.
