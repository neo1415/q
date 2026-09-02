# 18 — Capital Q Visual Design System & Interaction Architecture

**Document type:** Visual Design System / Interaction Architecture  
**Status:** V1 / MVP Design Baseline  
**Audience:** Product Design, Design Engineering, Frontend Engineering, Product Architecture, Coding Agents  
**Primary implementation:** Next.js + React + Tailwind CSS v4 + shadcn/ui on Base UI + Motion for React where motion is required  
**Accessibility target:** WCAG 2.2 AA  
**Source authority:** Locked PADL → Product Specification → Final System Review → Documents 10–17 → this document

---

# 1. Purpose

This document defines the visual and interaction language of Capital Q.

Document 17 established:

- what users see;
- where they go;
- how founder and investor journeys work;
- how Q appears throughout the experience;
- how onboarding, discovery and capital execution fit together.

This document answers:

> **What should all of that look and feel like when implemented?**

The goal is not to produce a fashionable AI interface.

The goal is to create a durable visual system that communicates:

```text
intelligence
clarity
evidence
trust
focus
speed
institutional credibility
```

without making the product feel:

```text
bureaucratic
generic SaaS
generic fintech
generic AI
overdesigned
noisy
futuristic for the sake of futurism
```

---

# 2. Governing Visual Principle

The product principle:

> **Q manages complexity. The user sees clarity.**

must also govern visual design.

The interface may represent:

- evidence;
- knowledge;
- relationships;
- confidence;
- Q investigations;
- capital objectives;
- investor mandates;
- video;
- private/shared states;
- recommendations.

But the UI should not visually expose all of that complexity simultaneously.

The visual system therefore uses:

```text
Hierarchy before decoration
Typography before containers
Whitespace before separators
Structure before cards
Meaning before color
Motion before spectacle
```

---

# 3. Design Direction

The working Capital Q design direction is:

# Quiet Institutional Futurism

This means:

## Institutional

- serious enough for investment decisions;
- data legible;
- evidence inspectable;
- no gamified finance aesthetic;
- no crypto dashboard visual language.

## Contemporary

- fast;
- responsive;
- direct;
- strong typography;
- lightweight surfaces;
- polished transitions.

## Quiet

- restrained color;
- restrained radius;
- restrained shadow;
- visual emphasis only where useful.

## Futuristic

Not through neon or sci-fi graphics.

Through:

- Q understanding context;
- natural language;
- voice;
- responsive intelligence;
- fluid transitions;
- information appearing exactly when needed.

The intelligence itself should feel futuristic.

The decoration should not need to announce it.

---

# 4. Visual Anti-Pattern List

The following are explicitly prohibited unless a future brand decision deliberately overrides them.

## 4.1 AI Slop

Do not use:

```text
glowing AI brain
glowing shield
robot head
neural-network particles
floating hexagons
random circuit lines
purple-blue AI gradient
holographic dashboard
fake terminal
agent swarm visualization
```

## 4.2 Gradient Dependence

Do not use gradients as the default way to make something feel premium or AI-powered.

Allowed only where:

- subtle;
- functional;
- brand-approved;
- not required for legibility.

V1 core UI should function without gradients.

## 4.3 Glass Everywhere

Do not default to:

```text
backdrop-blur
semi-transparent glass card
thin glowing border
```

for every surface.

Transparency may be used selectively for overlays/navigation if it improves context.

## 4.4 Card Everything

A paragraph does not need a card.

A metric does not automatically need a card.

A section does not automatically need a card.

Use cards when the content is a discrete object.

## 4.5 Huge Radius Everywhere

Do not give every button/input/panel:

```text
24px / 32px corner radius
```

Capital Q should not look like a children's banking app.

## 4.6 Excessive Badges

Do not cover companies with:

```text
Verified
AI Checked
Hot
Trending
Top Match
Rising
Strong
94%
```

Badges must represent real semantic states.

## 4.7 Tiny Eyebrow Labels

Avoid decorative uppercase labels above every title.

Use labels only when they clarify hierarchy/context.

## 4.8 Fake AI Activity

Do not display:

```text
Research Agent
Matching Agent
Financial Agent
Diligence Agent
```

as animated workers.

The user experiences one Q.

## 4.9 Typewriter Everything

Q does not need theatrical character-by-character typing.

Stream content naturally if technically streamed.

Avoid fake typewriter animation for already-complete content.

## 4.10 Unnecessary Dark-Tech Theme

Do not assume AI = black background + neon lines.

Light mode is a first-class professional experience.

---

# 5. Design System Architecture

Visual values are implemented through semantic tokens.

Do not hardcode raw values across components.

Layers:

```text
Primitive Tokens
        ↓
Semantic Tokens
        ↓
Component Tokens
        ↓
Component Implementation
        ↓
Product Screens
```

---

# 6. Primitive vs Semantic Tokens

## Primitive

Examples:

```text
neutral-50
neutral-100
blue-500
green-600
space-4
radius-md
```

## Semantic

Examples:

```text
background
surface
text-primary
text-muted
border
accent
danger
positive
warning
```

Product components should primarily consume semantic tokens.

This permits brand evolution without component rewrites.

---

# 7. Tailwind CSS v4 Token Strategy

Use CSS-first theme variables.

Conceptual:

```css
@theme {
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);

  --radius-xs: 0.25rem;
  --radius-sm: 0.375rem;
  --radius-md: 0.625rem;
  --radius-lg: 0.875rem;

  --spacing-unit: 0.25rem;
}
```

Semantic application variables remain ordinary CSS custom properties:

```css
:root {
  --cq-bg: ...;
  --cq-surface: ...;
  --cq-text: ...;
  --cq-accent: ...;
}
```

Utilities map to them.

---

# 8. Initial V1 Color Direction

The exact brand palette can evolve.

The token structure is locked.

The following palette is the recommended V1 implementation baseline.

## Light

```css
:root {
  --cq-canvas: oklch(0.985 0.004 92);
  --cq-surface: oklch(0.995 0.002 92);
  --cq-surface-raised: oklch(1 0 0);
  --cq-surface-subtle: oklch(0.965 0.005 92);
  --cq-surface-strong: oklch(0.925 0.007 92);

  --cq-text-primary: oklch(0.19 0.012 258);
  --cq-text-secondary: oklch(0.43 0.012 258);
  --cq-text-tertiary: oklch(0.57 0.010 258);
  --cq-text-inverse: oklch(0.98 0.004 92);

  --cq-border-subtle: oklch(0.91 0.006 258);
  --cq-border: oklch(0.86 0.008 258);
  --cq-border-strong: oklch(0.71 0.012 258);

  --cq-accent: oklch(0.57 0.18 258);
  --cq-accent-hover: oklch(0.52 0.18 258);
  --cq-accent-soft: oklch(0.94 0.035 258);

  --cq-positive: oklch(0.55 0.13 151);
  --cq-positive-soft: oklch(0.95 0.035 151);

  --cq-warning: oklch(0.67 0.14 78);
  --cq-warning-soft: oklch(0.96 0.045 78);

  --cq-danger: oklch(0.56 0.20 27);
  --cq-danger-soft: oklch(0.95 0.04 27);

  --cq-info: var(--cq-accent);
}
```

The canvas is deliberately not pure white.

The result should feel closer to high-quality paper/neutral workspace than a sterile white SaaS dashboard.

---

# 9. Dark Mode Baseline

Dark mode should be supported by tokens even if V1 product launch emphasizes light mode.

```css
.dark {
  --cq-canvas: oklch(0.16 0.010 258);
  --cq-surface: oklch(0.19 0.010 258);
  --cq-surface-raised: oklch(0.22 0.011 258);
  --cq-surface-subtle: oklch(0.24 0.010 258);
  --cq-surface-strong: oklch(0.30 0.010 258);

  --cq-text-primary: oklch(0.95 0.005 92);
  --cq-text-secondary: oklch(0.75 0.008 258);
  --cq-text-tertiary: oklch(0.61 0.008 258);
  --cq-text-inverse: oklch(0.17 0.010 258);

  --cq-border-subtle: oklch(0.28 0.010 258);
  --cq-border: oklch(0.34 0.011 258);
  --cq-border-strong: oklch(0.47 0.012 258);

  --cq-accent: oklch(0.72 0.15 258);
  --cq-accent-hover: oklch(0.76 0.14 258);
  --cq-accent-soft: oklch(0.27 0.06 258);

  --cq-positive: oklch(0.72 0.12 151);
  --cq-warning: oklch(0.79 0.12 78);
  --cq-danger: oklch(0.70 0.16 27);
}
```

All final values require contrast testing.

---

# 10. Accent Philosophy

One primary accent.

The accent communicates:

- primary action;
- selected state;
- Q interactive state;
- active navigation;
- information emphasis.

Do not assign a unique bright color to every module.

Capital Q should feel like one product.

---

# 11. Semantic Color Rules

## Accent

Interaction / Q / primary selection.

## Positive

Confirmed positive result/state.

Not:

```text
good company
good founder
```

by default.

## Warning

Needs attention / conflicting / approaching deadline.

## Danger

Destructive / security / error / hard failure.

## Neutral

Most investment intelligence.

A company being "fit" is not inherently green.

A pass is not inherently red.

---

# 12. Never Communicate Meaning With Color Alone

Every important state also uses one or more of:

- label;
- icon;
- text;
- shape;
- position.

Examples:

```text
Conflicting information  ⚠
```

not merely amber text.

---

# 13. Typography

Recommended V1 family:

```text
Geist Sans
```

for interface/product text.

```text
Geist Mono
```

only for:

- selected numerical/data contexts;
- IDs/dev/internal tools;
- code.

Why Geist:

- open/free;
- designed for screen clarity;
- strong Next.js integration;
- broad weight range;
- neutral enough not to dominate brand;
- easily replaceable behind tokens.

Capital Q should not become visually dependent on the font.

---

# 14. Typography Personality

Typography should feel:

```text
precise
modern
quiet
confident
```

Avoid:

- ultra-light display type;
- excessive bold;
- excessive tracking;
- all-caps interfaces;
- decorative serif everywhere.

A future brand may introduce a display face selectively.

V1 needs one strong UI family more than a typography spectacle.

---

# 15. Type Scale

Recommended responsive baseline:

| Token | Desktop | Mobile | Line Height | Use |
|---|---:|---:|---:|---|
| display | 40px | 34px | 1.08 | rare first-value moments |
| title-xl | 32px | 28px | 1.15 | major page title |
| title-lg | 26px | 24px | 1.20 | section/page |
| title-md | 21px | 20px | 1.30 | section |
| body-lg | 17px | 17px | 1.55 | important prose |
| body | 15px | 16px | 1.50 | default |
| body-sm | 14px | 14px | 1.45 | compact UI |
| label | 13px | 13px | 1.35 | controls/meta |
| caption | 12px | 12px | 1.35 | supporting only |

Mobile body defaults to 16px where normal text entry/reading benefits.

---

# 16. Font Weights

Use approximately:

```text
400 normal
500 medium
600 semibold
```

Rarely use:

```text
700
```

Avoid 800/900 in application UI unless branding requires.

Strong hierarchy should not depend on every title being black/bold.

---

# 17. Numeric Typography

Use:

```css
font-variant-numeric: tabular-nums;
```

for:

- monetary figures;
- metrics;
- tables;
- progress;
- comparisons.

This reduces visual jitter.

---

# 18. Financial Figures

Large financial figures should use high legibility.

Example:

```text
$2.4M
```

Supporting:

```text
Current raise
```

Do not reduce legibility by applying:

- tiny caption;
- weak gray;
- novelty font.

---

# 19. Text Measure

Long-form Q/evidence prose:

```text
~62–78 characters per line
```

Typical maximum reading width:

```text
680–760px
```

Do not stretch Q answers across a 1440px desktop.

---

# 20. Spacing System

Base:

```text
4px
```

Recommended scale:

```text
2
4
6
8
12
16
20
24
32
40
48
64
80
96
```

Use tokens.

Avoid random:

```text
17px
27px
43px
```

unless a component mathematically requires it.

---

# 21. Layout Density

Capital Q uses **comfortable institutional density**.

It is not:

- ultra-spacious marketing site;
- cramped financial terminal.

Deep review surfaces can become denser than onboarding/discovery.

Density should follow task.

---

# 22. Page Widths

Recommended:

```text
--layout-full: 1440px
--layout-wide: 1240px
--layout-content: 1040px
--layout-reading: 760px
--layout-narrow: 600px
```

Pages choose based on content.

---

# 23. Grid

Desktop content grid:

```text
12 columns
24px typical gutters
```

Tablet:

```text
8 columns
```

Mobile:

```text
4 columns
16px outer padding
```

No screen needs to visibly obey a strict grid if the content needs another composition.

---

# 24. Mobile Edge Padding

Default:

```text
16px
```

Important spacious onboarding may use:

```text
20px
```

Avoid overly narrow content inside 3 nested card paddings.

---

# 25. Border Radius

Recommended:

```text
xs: 4px
sm: 6px
md: 10px
lg: 14px
xl: 18px
full: 999px
```

Usage:

- buttons: 8–10px;
- inputs: 8–10px;
- normal panels: 10–14px;
- sheets/dialogs: 14–18px;
- chips: full or 8px.

Avoid 24–32px default panels.

---

# 26. Borders

Borders are preferred over shadows for normal grouping.

Default:

```text
1px subtle border
```

Use stronger border for:

- selected;
- focus;
- explicit container hierarchy.

---

# 27. Shadows

Normal application surfaces use almost no shadow.

Recommended:

```text
shadow-none
shadow-xs
shadow-sm
overlay shadow
```

Shadows primarily communicate elevation:

- popover;
- floating sheet;
- dropdown;
- modal.

Not every card.

---

# 28. Surface Hierarchy

Use:

```text
Canvas
↓
Section
↓
Surface
↓
Raised Overlay
```

Do not alternate 8 different gray backgrounds.

---

# 29. Cards

A card should represent a discrete object/action.

Good:

- company result;
- investor result;
- approval proposal;
- notification bundle.

Bad:

- title card;
- paragraph card;
- individual metric card repeated 12 times.

---

# 30. Dividers

Use subtle dividers for sequential information.

Often preferable to separate cards.

Examples:

- evidence list;
- relationship timeline;
- company facts.

---

# 31. Iconography

Use a consistent simple line-icon system.

Recommended:

```text
Lucide
```

or equivalent wrapped behind Capital Q icon components.

Defaults:

```text
16px compact
18px standard
20px prominent
1.75px stroke approximately
```

Do not mix filled emoji-like icons with thin line icons.

---

# 32. Brand Icon vs UI Icons

The Q brand mark is separate.

Do not use the Q mark as every:

- info icon;
- button icon;
- loading icon.

Preserve its significance.

---

# 33. Q Visual Identity

Q should be recognizable without becoming a mascot.

Recommended V1 representation:

```text
Q word/mark
+
restrained accent state
```

No:

- face;
- robot;
- brain;
- sphere;
- character.

---

# 34. Q States

Q visual state system:

```text
IDLE
LISTENING
WORKING
NEEDS_INPUT
NEEDS_APPROVAL
COMPLETE
ERROR
```

State should be understandable from label/context, not animation alone.

---

# 35. Q Idle

Static.

No permanent breathing/pulsing animation.

Q is available without demanding attention.

---

# 36. Q Listening

Use:

- clear "Listening";
- simple waveform/audio level;
- accent state;
- Stop/Cancel.

Waveform reacts to audio.

Do not render an abstract glowing blob.

---

# 37. Q Working

Use an understated stage indicator.

Example:

```text
Q
Reviewing evidence…
```

Optional:

```text
• Reviewing company
• Comparing mandate
• Preparing response
```

Only approved high-level stages.

---

# 38. Q Working Motion

Possible:

- subtle moving progress line;
- 3-dot opacity rhythm;
- stage fade;
- border accent shift.

Avoid:

- orbiting particles;
- complex morphing logo;
- spinning network map.

---

# 39. Q Needs Approval

Visual emphasis increases.

Example:

```text
Ready for your approval
```

Show:

- exact proposed action;
- recipient;
- consequence;
- approve/reject.

Not just a glowing button.

---

# 40. Q Complete

Do not celebrate routine completion with confetti.

Use:

- check;
- stable result;
- next action.

---

# 41. Q Error

Q error should remain calm.

Example:

```text
I couldn't finish this analysis because the document is still processing.
```

Use danger color only where appropriate.

---

# 42. Component Foundation

For a new Capital Q implementation, recommended:

```text
shadcn/ui
on Base UI primitives
```

with Capital Q-owned component wrappers.

Why:

- accessible headless behavior;
- current shadcn default for new projects as of July 2026;
- composable;
- styling remains fully Capital Q-owned;
- no vendor look imposed.

Do not style raw Base UI primitives differently throughout product code.

Wrap them in `packages/ui`.

---

# 43. Base UI vs Radix

Radix remains acceptable and supported.

If the implementation has already begun on Radix:

> Do not migrate merely because a newer default exists.

For a greenfield 2026 build, Base UI is the recommended default.

This avoids churn.

---

# 44. Component Wrapper Rule

Application code imports:

```text
@capital-q/ui/button
@capital-q/ui/dialog
@capital-q/ui/combobox
```

rather than directly importing Base UI everywhere.

This allows underlying primitive migration later.

---

# 45. Required Core Components

V1 design system:

```text
Button
IconButton
Link
Input
Textarea
NumberInput
Select
Combobox
Checkbox
RadioGroup
Switch
Slider/Range
Chip
SegmentedControl
Tabs
Dialog
AlertDialog
Drawer
Sheet
Popover
Tooltip
Dropdown
Command/Search
Toast
Skeleton
Progress
Avatar
Badge
Table
DataList
Disclosure
EmptyState
InlineNotice
QComposer
QResponse
EvidenceLink
ConfidenceState
CompanyResult
InvestorResult
ApprovalCard
```

---

# 46. Buttons

Variants:

```text
primary
secondary
quiet
danger
```

Avoid 8 button variants.

---

# 47. Primary Button

Use accent fill.

One dominant primary action per local decision area.

Do not make both:

```text
Continue
Skip
Upload
Ask Q
```

all primary.

---

# 48. Secondary Button

Neutral surface/border.

Used for alternative valid action.

---

# 49. Quiet Button

Text/icon style.

Used for:

- Back;
- edit;
- secondary utility.

---

# 50. Danger Button

Reserved for destructive/serious irreversible actions.

Do not use red for "Pass" in discovery.

---

# 51. Button Height

Recommended:

```text
compact: 32px
standard: 40px
large/mobile primary: 44–48px
```

Pointer/touch targets must still meet accessibility target.

---

# 52. Input Height

Standard:

```text
42–44px
```

Mobile:

```text
44–48px
```

Textarea natural based on content.

---

# 53. Focus Ring

Every interactive element has visible focus.

Recommended:

```text
2px outer focus ring
accent or high-contrast semantic focus token
offset 2px where needed
```

Focus should remain visible over all backgrounds.

---

# 54. Hover

Hover is enhancement.

Never the only way to reveal required action/information.

---

# 55. Disabled State

Disabled:

- reduced contrast;
- still readable;
- no misleading hover;
- reason offered where useful.

For unavailable GateQ contact:

do not simply gray out without explanation.

---

# 56. Chips

Use chips for:

- taxonomy;
- selected preferences;
- statuses with compact semantics.

Do not turn every metadata field into a colorful pill.

Most chips remain neutral.

---

# 57. Badges

Badge categories:

```text
status
verification
scope
exception
```

Examples:

```text
Organisation verified
View only
Conflicting
```

Avoid:

```text
AI powered
Hot
Trending
```

---

# 58. Verification Visual Language

Verification uses:

- check icon;
- neutral/positive semantic;
- exact label.

Examples:

```text
Organisation verified
Affiliation verified
```

Do not create a universal blue check implying endorsement.

---

# 59. Confidence Visual Language

Confidence differs from verification.

Recommended:

```text
High confidence
Moderate
Low
Conflicting
Insufficient evidence
```

Primarily textual.

Optional neutral indicator.

Do not use bright green for "High confidence" because confidence ≠ positive outcome.

---

# 60. Evidence Visual Language

Evidence uses a small consistent provenance affordance.

Example:

```text
Supported by 3 sources
```

Click opens:

- source;
- locator;
- status;
- recency.

Evidence should feel inspectable, not decorative.

---

# 61. Truth-State Language

Possible labels:

```text
Verified
Source-supported
Founder-provided
Estimated
Q inference
Unknown
Conflicting
```

These should be visually related but not identical.

---

# 62. Data Tables

For detailed diligence/comparison:

- sticky headers where useful;
- zebra stripes only if needed;
- horizontal scroll mobile;
- row hover subtle;
- tabular numbers;
- no heavy grid lines.

Prefer whitespace + subtle horizontal separators.

---

# 63. Charts

Charts should use:

- one primary accent;
- neutral comparison colors;
- semantic colors only for semantic states.

Avoid rainbow palettes.

No:

- 3D;
- shadows;
- unnecessary donuts;
- gauges for every score.

---

# 64. Chart Labels

Data should be directly labelable where practical.

Avoid legends requiring constant color decoding.

---

# 65. Sparklines

Useful selectively for:

- metric trend;
- fundraising progress;
- interaction trend.

Never without accessible text/summary.

---

# 66. Money / Metric Blocks

Do not build twelve dashboard tiles.

Prefer contextual metric rows/groups.

Example:

```text
Revenue      $2.4M ARR
Growth       63% YoY
Customers    42 enterprise
```

---

# 67. Risk/Strength Presentation

Use:

```text
Strength
Risk
Gap
Unknown
```

as semantic labels.

Do not paint entire screen green/red.

---

# 68. Onboarding Canvas

Onboarding should feel calm and focused.

Recommended composition:

```text
Top: progress / back
Center: question
Below: choices/input
Bottom: primary action
Optional Q help/voice
```

No dashboard chrome unless necessary.

---

# 69. Onboarding Width

Desktop:

```text
560–720px core interaction width
```

Some selection grids can expand to:

```text
880px
```

Mobile:

full available width minus 16–20px margins.

---

# 70. Onboarding Background

Use canvas.

Avoid giant decorative illustrations on every step.

A limited brand/visual moment can occur at:

- welcome;
- first-value result.

---

# 71. Onboarding Choice Cards

Selectable options can use compact bordered tiles when choice benefits from description/icon.

Do not use full card grid when plain chips/list is enough.

---

# 72. Onboarding Selected State

Selected:

- border/accent;
- subtle accent-soft fill;
- check where useful.

No bouncing glow.

---

# 73. Onboarding Transition

Default:

```text
opacity
+
8–16px directional translation
```

Duration:

```text
180–240ms
```

Do not slide entire screen 100vw for each question.

---

# 74. Onboarding Progress

Use:

- slim progress bar;
- semantic stage name;
- `3 of 5` optionally.

Do not use 15 tiny dots.

---

# 75. Q Analysis During Onboarding

When deck processing:

```text
Q is reviewing your deck
```

show real status.

If async:

allow user to continue.

Do not make fake scanning animation block the user.

---

# 76. First-Value Reveal

When Q completes first analysis:

use a slightly stronger transition.

Possible:

- surface reveals;
- key insight fades in;
- one small accent motion.

No confetti.

The intelligence is the reward.

---

# 77. Voice Onboarding

Mic button is visible near the text input.

Listening state:

- clear waveform;
- transcript area;
- timer optional;
- stop.

The rest of screen remains calm.

---

# 78. Investor Feed — Visual Architecture

Investor feed is visually distinct from the rest of the app because video is dominant.

Mobile:

```text
full-height or near-full-height video
+
bottom/side decision information
+
actions
```

But information must remain legible and not buried in overlay noise.

---

# 79. Feed Background

Video can sit on:

- near-black media stage;
- neutral surrounding surface.

This does not mean the whole application uses dark mode.

---

# 80. Feed Video Ratio

Founder pitches should generally target:

```text
9:16
```

for mobile-first feed.

Provider handles responsive variants.

Desktop may display within fixed portrait media frame.

---

# 81. Feed Text Overlay

Keep overlay limited.

Immediate:

```text
Company
one-line description
stage
raise
fit reason
```

Detailed intelligence appears in adjacent panel/sheet.

Do not overlay a mini pitch deck over the video.

---

# 82. Feed Legibility

Use controlled media scrim only when text overlays video.

A scrim is functional transparency, not decorative gradient branding.

Ensure contrast on unpredictable video.

---

# 83. Feed Actions

Mobile action cluster should be:

- visually clear;
- reachable;
- not TikTok-cloned.

Potential arrangement:

```text
Save
Pass
Ask Q
More
```

with:

```text
View Company
Express Interest
```

prominent in information region.

---

# 84. Feed Gestures

Vertical swipe moves feed.

Gestures have explicit controls.

Do not use hidden horizontal swipes for critical actions without visible alternatives.

---

# 85. Feed Transition

Use direct gesture-linked movement.

No exaggerated spring bounce.

Motion should feel:

```text
responsive
physical
controlled
```

---

# 86. Feed Pass Motion

Pass:

- immediate;
- perhaps brief directional transition;
- no red explosion/X animation.

This is an investment decision state, not dating UX.

---

# 87. Feed Save Motion

Use small icon fill/check transition.

~120–180ms.

No modal.

---

# 88. Ask Q from Feed

Recommended desktop:

Q panel opens alongside video/company context.

Mobile:

bottom/full-height sheet with company context preserved.

Transition should show contextual relationship.

---

# 89. Company Profile Visual Hierarchy

Top:

```text
Company
description
stage / location
raise
primary actions
pitch
```

Then:

```text
Why it matters
Business
Traction
Team
Raise
Q Intelligence
Evidence
```

Avoid an immediate wall of cards.

---

# 90. Company Hero

Use typography and spacing.

Not oversized marketing hero.

This is application content.

---

# 91. Company Logo

Logo is supporting identity.

Do not force every company to have perfect brand art.

Fallback uses:

- initials;
- neutral tile.

---

# 92. Investor Profile

Organisational identity dominates.

Avoid repeating five partner avatars as primary fund identity.

Representatives appear in relationship/contact areas.

---

# 93. Comparison Surface

Desktop:

table/grid with sticky company headers.

Mobile:

horizontal comparison or one-dimension-at-a-time view.

Highlight differences through typography/symbols, not rainbow backgrounds.

---

# 94. Comparison Recommendation

Q conclusion sits above or alongside comparison.

Example:

```text
For your current mandate, Acme is the closer fit.
```

Then:

- reasons;
- evidence;
- unknowns.

---

# 95. Capital Objective Surface

Should feel like an operating workspace.

Use:

- clear objective header;
- progress;
- relationships;
- actions.

Avoid Kanban-first generic CRM look unless a specific view benefits from it.

---

# 96. Relationship Timeline

Visual:

```text
time
event
actor/context
```

Use vertical rhythm + subtle line.

Important milestones can have stronger marker.

No social-media activity-feed styling.

---

# 97. Meeting Surface

Before meeting:

focused prep.

After:

structured output.

Use sections:

```text
What changed
Questions
Requests
Next actions
```

Transcript is secondary/detail.

---

# 98. Data Room

Visual language should emphasize control.

File rows include:

```text
document
updated
visibility/access
```

Recipient panel:

```text
Apex Ventures
View only
Expires 30 Sep
```

Access state must be clearer than file aesthetics.

---

# 99. Sharing Dialog

High-consequence dialog.

Hierarchy:

1. document;
2. recipient;
3. access level;
4. expiry;
5. consequence explanation;
6. approve.

Do not bury access level in dropdown afterthought.

---

# 100. Q Composer

The composer should be visually important but not gigantic.

States:

```text
empty
typing
attachments
voice
sending
```

Supports:

- text;
- mic;
- contextual attachment reference;
- send.

---

# 101. Q Composer Placeholder

Contextual.

Examples:

```text
Ask Q about your raise…
Ask Q about this company…
Ask Q about Apex…
```

Better than generic:

```text
Ask anything
```

---

# 102. Q Response Typography

Q answers use normal readable prose.

Avoid chat bubbles for every assistant paragraph.

Recommended:

- user message can be compact bubble/aligned item;
- Q response uses open document-like surface.

This makes Q feel like an analytical workspace rather than consumer messenger.

---

# 103. Q Structured Blocks

Within Q response:

- evidence block;
- company results;
- comparison;
- action proposal.

These can be components.

Do not wrap every paragraph in a card.

---

# 104. Q Citations

Evidence reference appears:

```text
[1]
```

or:

```text
Supported by July accounts
```

depending on context.

Hover/click reveals source.

---

# 105. Q Approval Component

Distinct from ordinary Q response.

Use:

- subtle boundary;
- action summary;
- consequence;
- primary approve;
- secondary edit/reject.

Do not use urgent red unless dangerous.

---

# 106. Search / Command Interface

Search uses a strong combobox/command pattern.

Results grouped:

```text
Companies
Investors
Recent
```

Q natural-language action appears separately.

Do not mix command and chat semantics invisibly.

---

# 107. Command Palette

Optional power-user enhancement.

Potential shortcut:

```text
Cmd/Ctrl + K
```

Use for:

- navigate;
- search;
- common actions.

Not required for MVP.

---

# 108. Popovers

Use for small contextual content.

Do not use popovers for long Q analysis.

---

# 109. Drawers / Sheets

Use:

- filters;
- Ask Q on mobile;
- quick company detail;
- evidence.

Desktop should not overuse right drawers for every detail.

---

# 110. Dialogs

Use only when the task must interrupt.

Examples:

- confirmation;
- dangerous action;
- short create action.

Long onboarding/editing lives on page/sheet.

---

# 111. Toasts

Toasts confirm low-complexity outcome:

```text
Saved
Access revoked
```

Do not put complex errors/instructions in disappearing toast.

---

# 112. Skeletons

Skeleton approximates actual layout.

Avoid:

- full-screen shimmer wall;
- endless loading shimmer.

For Q, use streaming/status instead.

---

# 113. Empty States

Use minimal illustration only if it helps.

Preferred:

```text
title
explanation
action
```

No generic astronaut/rocket illustration.

---

# 114. Error States

Visual hierarchy:

```text
what happened
impact
what user can do
```

Avoid raw red technical stack.

---

# 115. Motion Architecture

Motion exists to communicate:

```text
cause/effect
hierarchy
continuity
state
progress
```

Not to decorate every interaction.

---

# 116. Motion Library

Recommended:

```text
Motion for React
```

for interactions requiring:

- gesture;
- layout continuity;
- presence transitions;
- spring physics;
- reduced-motion integration.

Use plain CSS transitions for simple hover/color/opacity.

Do not use Motion for every element.

---

# 117. Motion Performance Rule

Prefer animation of:

```text
transform
opacity
```

Avoid repeated layout-heavy properties where possible.

Do not animate giant blur filters.

---

# 118. Motion Timing Tokens

Recommended:

```css
--motion-instant: 90ms;
--motion-fast: 140ms;
--motion-standard: 200ms;
--motion-emphasis: 280ms;
--motion-slow: 360ms;
```

Rarely exceed:

```text
400ms
```

inside core app interactions.

---

# 119. Easing

Recommended default:

```css
--ease-standard: cubic-bezier(0.22, 1, 0.36, 1);
--ease-exit: cubic-bezier(0.4, 0, 1, 1);
--ease-linear: linear;
```

The exact curves can be tuned during implementation.

---

# 120. Springs

Use spring only where physical relationship matters:

- feed gesture;
- drawer;
- draggable/reorder.

Avoid spring bounce on:

- text;
- normal buttons;
- every onboarding transition.

---

# 121. Microinteraction Amplitude

Keep movement small:

```text
2–4px button feedback
8–16px content transition
```

Large movement only for actual spatial navigation.

---

# 122. Hover Motion

Hover should not:

- float card 12px;
- scale to 1.05;
- glow.

Possible:

```text
border strengthens
background changes slightly
icon shifts 1–2px where direction matters
```

---

# 123. Button Press

Subtle:

```text
scale 0.98–0.99
```

optional.

Must not compromise accessibility or feel childish.

---

# 124. Reduced Motion

Globally respect:

```text
prefers-reduced-motion
```

Use Motion's reduced-motion configuration.

When reduced:

- remove large transforms;
- remove parallax;
- reduce spring motion;
- use opacity/color transitions;
- disable decorative autoplay motion.

---

# 125. Reduced Motion and Video

Do not automatically disable the investor pitch video itself merely because reduced motion is enabled if the user intentionally navigated to a video feed.

But avoid autoplay behavior that conflicts with user preference where practical.

Provide pause.

Decorative/background videos should not autoplay under reduced-motion.

---

# 126. No Parallax V1

Capital Q does not need parallax.

Reject unless future deliberate design calls for it.

---

# 127. No Animated Blur V1

Avoid blur-in/blur-out transitions.

They:

- cost performance;
- can cause visual discomfort;
- quickly become AI-aesthetic cliché.

---

# 128. No Scramble Text

Do not use hacker-style text scramble for Q.

Q intelligence is not represented by glitch effects.

---

# 129. No Cursor-Following Glow

Prohibited for product UI.

---

# 130. Q Motion Vocabulary

Q has only a few motion signatures:

## Listening

Audio waveform.

## Working

Subtle progress/stage change.

## Context transition

Related panel/sheet movement.

## Completion

Small settle/check.

Consistency builds identity.

---

# 131. Q Investigation Visualization

If we want to make Q's work visible:

use a **high-level investigation trail**, e.g.:

```text
Company
   ↓
Evidence
   ↓
Mandate
   ↓
Result
```

with restrained line/progress.

Never expose hidden chain-of-thought.

Never show fake agent nodes.

---

# 132. Q Intelligence Graph Visualizations

The Intelligence Graph is mostly infrastructure.

Do not make an interactive graph visualization the default UX.

Graph views may later support:

- internal/admin;
- relationship exploration;
- evidence lineage.

But ordinary users need conclusions, evidence and actions.

---

# 133. Animation During Q Streaming

Do not animate every text token.

The text naturally appears as stream.

Structured blocks can fade/settle once available.

---

# 134. Notification Motion

Badge counts update subtly.

Toast enters/exits quickly.

No bouncing notification bell.

---

# 135. Success Motion

No confetti for:

- onboarding complete;
- match;
- document upload;
- meeting scheduled.

Potential restrained celebratory moment only for truly meaningful milestone:

```text
raise closed
investment completed
```

and even there, brand should remain controlled.

---

# 136. Design for Trust

Trust is partly visual.

Capital Q should avoid visual manipulation patterns:

- fake scarcity;
- countdown pressure;
- attention-red badges;
- social-proof spam;
- "95% match" without calibration;
- bright green endorsement.

---

# 137. Privacy Visual System

Privacy appears where relevant.

Possible scope indicators:

```text
Private to you
Private to Company A
Shared with Apex
Network visible
```

Use neutral lock/people icons.

Do not put locks everywhere.

---

# 138. Privacy Context Placement

Place near:

- Q composer/context;
- document/share surface;
- sensitive note;
- relationship context.

Not globally repeated on every row.

---

# 139. View vs Download Visual

Use distinct icons and exact labels.

```text
View only
View + download
```

Do not use obscure permission icon without text.

---

# 140. Destructive Visual

Red reserved for:

- delete;
- revoke where high consequence;
- critical error;
- security danger.

A normal investor Pass remains neutral.

---

# 141. GateQ Visual

Statuses:

```text
Open
Qualified
Closed
```

Use text + small neutral/semantic indicator.

Do not use:

- green / orange / red stoplight alone.

Closed is preference, not failure.

---

# 142. Match Visual

Match is bilateral relationship state.

Use:

- clear wording;
- relationship icon;
- next action.

No hearts/fireworks.

---

# 143. Investor Suitability Visual

Use explanation.

Example:

```text
Strong fit with your mandate
```

with factors.

Do not create opaque circular 92 score as primary visual.

---

# 144. InvestIQ Visual

Readiness can use:

- dimension list;
- strengths;
- gaps;
- evidence.

If a summary score exists, it is secondary to interpretation.

Avoid gamified progress rings unless methodology justifies.

---

# 145. Unknown Visual

Unknown is neutral.

Use:

```text
Not enough information
```

not warning/red.

---

# 146. Contradiction Visual

Use warning semantic sparingly.

Example:

```text
Conflicting information
```

with two values side by side.

The user needs clarity, not alarm.

---

# 147. Loading Visual

Never show Q "thinking" for work already complete.

UI states are driven by real runtime state.

---

# 148. Design Token Naming

Use semantic names.

Good:

```text
--color-bg-canvas
--color-bg-surface
--color-text-primary
--color-border-subtle
--color-action-primary
```

Bad:

```text
--gray-thing
--blue-button
--ai-purple
```

---

# 149. Component Variant Naming

Semantic.

Good:

```text
primary
secondary
quiet
danger
```

Bad:

```text
blue
gray
red
gradient
```

---

# 150. Theme Swapping

Brand palette can change by replacing root token values.

Component code should not require widespread edits.

This is the visual equivalent of provider abstraction.

---

# 151. Responsive Design Tokens

Spacing/type can use `clamp()` where beneficial.

Example:

```css
--page-title-size: clamp(1.75rem, 2vw, 2rem);
```

Avoid dozens of breakpoint-only magic values.

---

# 152. Container Queries

Use container queries for reusable components where component width, not viewport width, determines layout.

Useful:

- company card;
- result card;
- Q structured response;
- comparison panel.

---

# 153. Responsive Navigation

Desktop:

sidebar/top utility.

Mobile:

bottom navigation.

Navigation selection uses:

- text;
- accent;
- icon.

No giant animated pill that slides across the whole nav.

---

# 154. Mobile Bottom Navigation

Recommended:

```text
Home
Discover
Capital
Profile
```

Q remains a central Home/context action.

If Q becomes a dedicated nav action later, do not increase total primary choices excessively.

---

# 155. Safe Areas

Mobile fixed UI respects:

```css
env(safe-area-inset-bottom)
```

especially:

- feed;
- bottom nav;
- Q composer.

---

# 156. Virtual Keyboard

Mobile sheets/composers must handle virtual keyboard correctly.

Avoid composer being hidden behind keyboard.

Base UI Drawer currently includes mobile virtual-keyboard support features; use tested primitives instead of custom viewport hacks where possible.

---

# 157. Touch Targets

Normal mobile target goal:

```text
44×44px or larger
```

WCAG 2.2 AA minimum is lower in some circumstances, but Capital Q should target comfortable use.

---

# 158. Desktop Pointer Density

Desktop compact icon controls may be smaller visually while retaining sufficient click target/padding.

---

# 159. Accessibility Contrast

Meet WCAG AA contrast minimums.

Use automated checks plus visual testing.

Do not assume OKLCH lightness guarantees accessible contrast.

---

# 160. Focus Not Obscured

Sticky:

- nav;
- composer;
- media controls;

must not hide focused content.

WCAG 2.2 adds explicit focus-not-obscured requirements.

---

# 161. Focus Appearance

Aim beyond bare browser minimum.

Strong visible ring.

No outline removal unless replaced with an equal or better focus indicator.

---

# 162. Typography Zoom

Layout must survive:

```text
200% text zoom
```

without blocking essential functionality.

Avoid fixed-height text containers.

---

# 163. High Contrast

Semantic boundaries must remain understandable if:

- background colors shift;
- user enables higher contrast.

Use borders/labels.

---

# 164. Screen Reader Live Regions

Q streaming:

Do not announce every token.

Announce:

```text
Q response available
```

or meaningful segments.

Status changes such as:

```text
Upload complete
Approval required
```

can use polite live regions.

---

# 165. Captions

Pitch video supports captions.

Caption presentation:

- readable;
- non-obstructive;
- user-controllable.

Do not bake captions permanently into video if separate track is available.

---

# 166. Icons and Accessible Names

Icon-only control:

```text
aria-label
```

Tooltips supplement but do not substitute accessible name.

---

# 167. Dragging Alternatives

Feed and reorder interactions must have non-drag equivalents, consistent with WCAG 2.2.

---

# 168. Component Accessibility Testing

Headless primitives help, but Capital Q still owns:

- labels;
- focus styling;
- contrast;
- content order;
- error messages;
- semantics.

A headless library does not make an inaccessible design automatically accessible.

---

# 169. Design System Folder

Recommended:

```text
packages/ui/
├── src/
│   ├── primitives/
│   ├── components/
│   ├── patterns/
│   ├── tokens/
│   ├── icons/
│   └── motion/
```

---

# 170. Primitive Layer

Wrappers around:

- Base UI;
- native elements.

No Capital Q domain logic.

---

# 171. Component Layer

Styled reusable interface components.

Examples:

```text
Button
Input
Dialog
Chip
```

---

# 172. Pattern Layer

Capital Q-specific compositions.

Examples:

```text
QComposer
CompanyDiscoveryItem
EvidenceSummary
ApprovalProposal
RelationshipTimeline
MandateSummary
```

---

# 173. Product Screen Layer

Screens compose patterns.

Do not put screen-specific conditional mess into generic UI primitives.

---

# 174. Storybook / Component Workshop

Recommended once implementation volume grows.

Could use:

- Storybook;
- Ladle;
- internal route.

Purpose:

- states;
- accessibility;
- visual regression;
- responsive review.

Not a blocker for first demo.

---

# 175. Token Documentation

Tokens should be human-readable and documented.

A coding agent should not invent `#7C3AED` because it needs another purple.

---

# 176. No Raw Hex in Components

Lint/review rule:

Raw color values should be extremely rare outside token definitions/data visualizations.

---

# 177. No Arbitrary Z-Index

Define layers:

```text
base
sticky
nav
popover
sheet
modal
toast
```

Avoid `z-[9999]`.

---

# 178. Z-Index Tokens

Conceptual:

```text
0 base
10 sticky
20 navigation
40 popover
50 sheet
60 modal
70 toast
```

Exact values implementation detail.

---

# 179. Overlay Backdrop

Use:

- neutral dark transparent backdrop;
- no colored glow.

Reduced-transparency accessibility can use more opaque surface.

---

# 180. Dialog Width

Small:

```text
400–480px
```

Medium:

```text
560–640px
```

Large complex content should become page/sheet.

---

# 181. Drawer Width

Desktop contextual:

```text
420–560px
```

Q deeper panel may be:

```text
480–640px
```

based on content.

---

# 182. Feed Desktop Layout

Recommended:

```text
left/center:
portrait video stage

right:
compressed company intelligence
actions
Q context
```

Do not stretch portrait video to desktop full width.

---

# 183. Feed Mobile Layout

Media dominates.

Information anchored in predictable lower region.

Actions remain reachable one-handed where possible.

---

# 184. Feed Scrim

Use only enough contrast.

Avoid heavy black gradient covering half video.

---

# 185. Feed Captions

Captions should not collide with:

- bottom company info;
- action buttons;
- OS controls.

Define safe media regions.

---

# 186. Q Panel Desktop

Q can become side-by-side with current entity.

Use split view rather than navigating away when context benefits.

Example:

```text
Company | Q
```

---

# 187. Q Mobile Sheet

Use sheet/full screen depending depth.

Preserve:

- company reference;
- back path;
- safe area;
- keyboard.

---

# 188. Evidence Drawer

Evidence opens without losing current analytical context.

Desktop:

drawer/popover depending size.

Mobile:

sheet.

---

# 189. First-Value Result Design

Use a focused report-like surface.

Example:

```text
Here's what stands out

Strength
Gap
Next
```

Not a dashboard of six metric cards.

---

# 190. Founder Home Composition

Possible desktop:

```text
Q Workspace              Capital Objective
                          Next Actions
Relationship Activity    Recent Intelligence
```

But keep dominant hierarchy centered on Q/current objective.

Not everything needs equal visual weight.

---

# 191. Investor Home Composition

Possible:

```text
Q / Search
Relevant opportunities
Qualified inbound
Active relationships
```

Feed may be entered from Home or directly through Discover.

---

# 192. Notification Design

Notification rows:

- simple;
- importance;
- object;
- time.

High priority uses semantic icon/text.

No red dot overload.

---

# 193. Status Dot Policy

Do not use unlabeled colored dots for important state.

Status dots can be secondary visual reinforcement.

---

# 194. Avatar Policy

Human avatars only where identity matters:

- representative;
- founder;
- message;
- meeting.

Do not show avatar stacks decoratively on every relationship.

---

# 195. Company Image Policy

Product should not depend on generic stock imagery.

Use:

- founder pitch;
- company logo;
- real product/company visuals where provided.

No AI-generated office/hacker imagery as default application art.

---

# 196. Illustrations

V1 should use illustration sparingly.

If needed:

- abstract but simple;
- brand-specific;
- functional.

No generic 3D SaaS character art.

---

# 197. Marketing vs Product

Marketing site may use more visual storytelling.

Application remains restrained.

Do not import marketing hero gradients/illustrations into core product screens.

---

# 198. Brand Flexibility

This document locks interaction and design-system structure more strongly than exact brand hue.

If future Capital Q brand identity changes:

Can change:

- accent hue;
- logo;
- typography;
- selected visual details.

Should remain:

- spacing discipline;
- hierarchy;
- semantic color logic;
- restrained radius/shadow;
- Q state model;
- motion rules;
- accessibility;
- no AI slop.

---

# 199. Design Quality Audit

Before screen completion:

## Typography

- hierarchy clear?
- line lengths readable?
- unnecessary uppercase?
- too many weights?

## Color

- semantic?
- contrast tested?
- too many accents?

## Surfaces

- card overload?
- unnecessary shadow?
- unnecessary radius?

## Motion

- useful?
- reduced motion?
- latency/performance?

## Accessibility

- keyboard?
- focus?
- labels?
- touch targets?

## Product

- Q central but not forced?
- evidence distinct from inference?
- privacy visible when relevant?
- investor/founder semantics accurate?

---

# 200. AI-Generated UI Review

Coding agents often produce recognizable patterns:

```text
gradient heading
three feature cards
tiny uppercase eyebrow
rounded-2xl everywhere
backdrop-blur
purple glow
random Sparkles icon
AI badge
huge empty whitespace
```

Capital Q review should actively reject these unless deliberately required.

---

# 201. Utility Class Anti-Patterns

Review suspicious repetition:

```text
rounded-2xl
shadow-xl
backdrop-blur-xl
bg-gradient-to-r
from-purple
to-blue
text-xs uppercase tracking-widest
```

Their existence is not automatically wrong.

Their repeated default use is.

---

# 202. Q Sparkles Icon

Avoid making Sparkles the universal Q icon.

It is overused across generic AI products and conveys little.

Use Capital Q's own Q mark/state.

---

# 203. AI Disclosure

If model-generated/inferred content needs labeling:

Use semantic language:

```text
Q inference
Q recommendation
```

not glitter icons.

---

# 204. Motion and Perceived Performance

Animation must never slow interaction.

If navigation data is ready:

do not wait 500ms for the transition.

Fast UI > elaborate motion.

---

# 205. Layout Shift

Reserve space for:

- media;
- avatars;
- known response blocks.

Avoid Q result blocks causing dramatic cumulative shift when avoidable.

---

# 206. Loading Transition

Skeleton → content:

simple opacity crossfade.

Do not animate every child individually.

---

# 207. Onboarding Async Extraction

When Q analysis finishes while user is on another step:

use subtle notification/progress update.

Do not forcibly navigate user.

---

# 208. Haptic-Like Web Feedback

No requirement for actual device haptics V1.

Visual press feedback sufficient.

Native/mobile future may add haptics carefully.

---

# 209. Desktop Hover Details

Tooltip delay should avoid noisy appearance.

Useful for:

- unfamiliar icon;
- truncated data;
- evidence provenance.

Not every labeled button.

---

# 210. Tooltip Content

Short.

If explanation needs paragraphs, use popover/help.

---

# 211. Help Text

Place difficult domain explanations near relevant controls.

Example:

```text
Hard exclusion
Companies outside this criterion won't appear in standard discovery.
```

Don't send users to documentation for every investment concept.

---

# 212. Form Validation

Inline.

Error:

```text
Enter a target amount greater than 0.
```

Not:

```text
Invalid input.
```

---

# 213. Financial Input Formatting

Display:

```text
$2,000,000
```

while storing exact numeric amount/currency.

Support paste.

Do not require users to type commas manually.

---

# 214. Range Inputs

Cheque range uses:

- numeric fields;
- presets;
- optional slider.

Do not use slider only.

---

# 215. Searchable Taxonomy Control

Combobox:

- Q suggested first;
- search;
- selected chips;
- custom phrase pathway.

Avoid mega dropdown.

---

# 216. Long Lists

Virtualize when necessary.

Do not render thousands of taxonomy entries.

---

# 217. Data Density on Mobile

Collapse secondary metadata.

Prioritize:

- decision;
- value;
- action.

Allow drill-in.

---

# 218. Safe Truncation

Truncate only low-priority metadata.

Never truncate:

- critical financial figures;
- approval recipient;
- security warning;
- company/investor identity in consequential action.

---

# 219. Copy

UI language:

```text
plain
precise
short
institutional without jargon
```

Avoid:

```text
Leverage AI-powered insights to supercharge...
```

---

# 220. Button Copy

Use verbs:

```text
Continue
Save
Ask Q
Express interest
Schedule meeting
Share
Approve
```

Avoid:

```text
Proceed
Execute Workflow
Submit Action
```

unless legal/technical context requires.

---

# 221. Destructive Copy

Use exact object:

```text
Delete financial model
Revoke Apex access
```

not generic:

```text
Confirm
```

---

# 222. Q Voice

Q text should not visually imitate a human colleague through avatar/headshot.

Q has institutional identity.

---

# 223. Q Citations and Inline Sources

Source links should remain quiet until user wants evidence.

Use superscript/inline indicators.

No colorful source card carousel unless source comparison needs it.

---

# 224. Relationship Colors

Do not assign colors to stages like a CRM rainbow.

Use:

- neutral timeline;
- accent for active/current;
- semantic warning only where risk.

---

# 225. Progress Bars

Progress bars should represent actual measurable progress.

Do not convert subjective readiness into a 73% progress bar without methodology.

---

# 226. Onboarding Progress Is Measurable

Onboarding steps have actual completion.

Progress bar appropriate.

---

# 227. Raise Progress

Capital committed / target is quantitative.

Progress bar appropriate, with exact numbers.

---

# 228. Confidence Is Not a Progress Bar

Do not visually present confidence as completion percentage.

---

# 229. Recommendation Fit Is Not a Gauge

No speedometer/gauge.

Use:

- factors;
- fit language;
- evidence.

---

# 230. Empty Profile Fields

Do not show:

```text
Revenue: N/A
Customers: N/A
...
```

for 20 fields.

Hide or group:

```text
Information still needed
```

---

# 231. Locked / Restricted Content

Show why unavailable where appropriate.

Example:

```text
Financial model is available after Data Room access.
```

Do not use blur paywall-style fake content.

---

# 232. Restricted Founder-Private Content

Do not hint at existence to unauthorized investor.

Backend disclosure policy drives UI.

---

# 233. Security States

Security warnings should stand apart from commercial advice.

Example:

```text
Security
This link is no longer valid.
```

not Q recommendation color.

---

# 234. Responsive Tables

On mobile:

- stacked rows;
- horizontal scroll;
- comparison carousel;

choose based task.

Do not squeeze 8 columns to 40px.

---

# 235. Responsive Charts

Prefer simplified view over illegible compressed chart.

---

# 236. Print / Export

Later investor reports may require print styling.

Design tokens should support:

- white background;
- strong text;
- no interaction-only indicators.

Not MVP blocker.

---

# 237. Accessibility Theme Testing

Test:

- light;
- dark if shipped;
- Windows high contrast where possible;
- increased text;
- reduced motion;
- browser zoom.

---

# 238. Browser Support

Support modern browsers targeted by Next.js/Base UI baseline.

Test especially:

- Chrome;
- Safari;
- Firefox;
- Edge;
- mobile Safari;
- Android Chrome.

---

# 239. Design Reference Principle

Use references for principles, not copying aesthetics.

Capital Q should not look like:

```text
Linear clone
Vercel clone
Notion clone
OpenAI clone
Stripe clone
```

Borrow:

- clarity;
- hierarchy;
- interaction rigor.

Build Capital Q identity.

---

# 240. Current Implementation Validation

## Tailwind CSS

Tailwind v4 theme variables provide a clean token-to-utility architecture.

Reference:

- https://tailwindcss.com/docs/theme

## shadcn / Base UI

As of July 2026, shadcn uses Base UI by default for new projects while continuing Radix support.

References:

- https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default
- https://base-ui.com/react/overview/about
- https://base-ui.com/react/overview/accessibility

Base UI is unstyled and accessibility-focused, which allows Capital Q to own its visual language.

## Motion

Motion for React provides:

- production React animation;
- layout/gesture animation;
- reduced-motion APIs.

Current releases remain active in August 2026.

References:

- https://motion.dev/
- https://motion.dev/docs/react
- https://motion.dev/docs/react-use-reduced-motion

## Geist

Geist is an open typeface designed around precision, clarity and functionality with strong Next.js integration.

Reference:

- https://vercel.com/font

Using Geist does not imply copying Vercel's broader aesthetic.

---

# 241. Accessibility Validation

## WCAG 2.2

Important V1 requirements include:

- Focus Not Obscured;
- Target Size;
- Dragging alternatives;
- Redundant Entry;
- Accessible Authentication.

References:

- https://www.w3.org/TR/WCAG22/
- https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/

## Apple Accessibility Guidance

Current Apple guidance emphasizes:

- sufficient contrast;
- appropriately sized controls;
- alternatives to audio-only communication;
- reduced automatic/repetitive motion;
- replacing large transforms with fades for reduced-motion users.

References:

- https://developer.apple.com/design/human-interface-guidelines/accessibility
- https://developer.apple.com/help/app-store-connect/manage-app-accessibility/reduced-motion-evaluation-criteria

Capital Q applies these principles to web/PWA interaction without attempting to imitate native Apple styling.

---

# 242. Visual Design Decisions Locked by This Document

## VDA-001

Capital Q's design direction is Quiet Institutional Futurism.

## VDA-002

The intelligence itself creates the futuristic feeling; decorative AI imagery does not.

## VDA-003

No default glowing brains, orbs, neural particles, agent swarms, fake terminals or generic purple-blue AI gradients.

## VDA-004

Semantic design tokens are the source of visual truth.

## VDA-005

Product components consume semantic tokens rather than hardcoded raw colors.

## VDA-006

Tailwind CSS v4 theme variables are the recommended implementation mechanism.

## VDA-007

The initial V1 palette uses warm-neutral light surfaces, near-black text and one restrained signal accent.

## VDA-008

Dark mode is represented at token level even if launch prioritizes light mode.

## VDA-009

Color is used sparingly and never alone for critical meaning.

## VDA-010

Geist Sans is the recommended V1 UI typeface; typography remains replaceable through tokens.

## VDA-011

Most UI uses weights 400–600 rather than excessive bold.

## VDA-012

Financial/numeric data uses tabular numbers where relevant.

## VDA-013

The spacing system uses a 4px base scale.

## VDA-014

Border radii remain moderate; 24–32px rounded panels are not the default.

## VDA-015

Borders and whitespace are preferred over decorative shadows for normal grouping.

## VDA-016

Cards represent discrete objects rather than becoming the universal layout container.

## VDA-017

One consistent simple line icon system is used through a wrapper abstraction.

## VDA-018

Q is represented by its own restrained brand/state system rather than generic Sparkles/robot imagery.

## VDA-019

Q has explicit visual states: idle, listening, working, needs input, needs approval, complete and error.

## VDA-020

Q idle state has no permanent attention-seeking animation.

## VDA-021

Q working visualization exposes only approved high-level work stages, never chain-of-thought or fake agents.

## VDA-022

New V1 builds use shadcn/ui on Base UI unless an existing implementation already has a stable primitive choice.

## VDA-023

Application code imports Capital Q UI wrappers rather than raw primitive library APIs broadly.

## VDA-024

Motion for React is used only for interactions where animation/gesture/layout continuity provides real value.

## VDA-025

Simple transitions use CSS rather than unnecessary animation-library components.

## VDA-026

Most core motion is 90–280ms; >400ms is exceptional.

## VDA-027

Reduced-motion preferences are honored globally.

## VDA-028

Parallax, animated blur, scramble text and cursor-following glows are not part of V1.

## VDA-029

Onboarding uses focused single-purpose composition and subtle directional transitions.

## VDA-030

Founder/investor first-value moments are visually stronger through hierarchy, not confetti or spectacle.

## VDA-031

Investor Discover is media-forward but avoids direct TikTok visual imitation.

## VDA-032

Pitch videos use functional scrims only as needed for text contrast.

## VDA-033

Pass is visually neutral and not treated as failure/red.

## VDA-034

Match is institutional/bilateral and receives no dating-app celebration language.

## VDA-035

Confidence, verification, readiness, fit, interest and outcome have distinct visual semantics.

## VDA-036

Unknown information is visually neutral.

## VDA-037

Contradictions are clearly visible but not sensationalized.

## VDA-038

Q answers use readable document-like presentation rather than putting every response in chat bubbles.

## VDA-039

Q action approvals are visually distinct and show exact consequence/recipient.

## VDA-040

Private/shared context indicators appear where consequential rather than being repeated everywhere.

## VDA-041

Data Room permissions use exact View Only / View + Download language.

## VDA-042

Accessibility target is WCAG 2.2 AA.

## VDA-043

Primary mobile controls generally target at least 44×44px comfortable interaction areas.

## VDA-044

Keyboard focus is always visibly styled and must not be obscured by sticky UI.

## VDA-045

Pitch video includes caption support and never requires autoplay audio.

## VDA-046

Gesture interactions always have accessible explicit alternatives.

## VDA-047

No raw color values should be spread through application components.

## VDA-048

Z-index uses named/layered tokens rather than arbitrary large values.

## VDA-049

Visual branding can evolve centrally without forcing screen/component rewrites.

## VDA-050

AI-generated interface output is explicitly reviewed for generic SaaS/AI visual patterns before acceptance.

---

# 243. Coding-Agent Visual Preflight

Before implementing a UI slice, the coding agent must state:

1. screen/pattern;
2. user type;
3. primary task;
4. hierarchy;
5. existing design-system components used;
6. semantic tokens used;
7. responsive behavior;
8. loading/empty/error;
9. interaction states;
10. motion;
11. reduced-motion behavior;
12. keyboard/focus;
13. touch targets;
14. private/shared context;
15. evidence/confidence states;
16. visual anti-pattern risks.

---

# 244. Coding-Agent Visual Postflight

Review:

```text
no arbitrary raw colors
no unnecessary gradients
no repeated rounded-2xl default
no shadow-heavy card grid
no generic Sparkles AI icon
no fake agent visuals
no accessibility regression
no hidden gesture-only action
no unreadable overlay on video
no focus obstruction
no motion without reduced-motion alternative
no chat-bubble overload
no random typography scale
no inconsistent spacing
```

Then test:

```text
mobile
desktop
keyboard
reduced motion
200% zoom
light theme
dark theme if shipped
real long company names
real large currency values
empty data
conflicting data
private/restricted states
```

---

# 245. Final Visual Rule

Capital Q should not look impressive because it uses more visual effects.

It should look impressive because:

```text
information appears at the right time,
hierarchy is obvious,
Q feels present without being theatrical,
video feels immediate,
evidence feels trustworthy,
actions feel controlled,
and complex investment workflows feel unusually simple.
```

The desired reaction is not:

> "This looks like an AI app."

It is:

> "This feels like serious investment software that somehow understands what I need."

That is Capital Q's visual advantage.
