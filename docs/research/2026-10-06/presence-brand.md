# Q's presence and the black-and-gold brand (K1-K3)

Research agent M1, 2026-10-06. Feeds K1 (a freer, morphing presence), K2 (the face that looks like a demon) and K3 (black and gold, still changeable).

## 1. Summary for builders

- **K2: why the face reads as a demon.** Mori's uncanny valley: affinity rises with human likeness until near-human, then drops into eeriness, and **movement deepens the valley** ([Britannica](https://www.britannica.com/topic/uncanny-valley), [Open University](https://www.open.edu/openlearn/people-politics-law/politics-policy-people/society-matters/uncanny-valley-why-we-find-human-robots-and-dolls-so-creepy)). The eyes are the strongest trigger: mismatched eye size or texture against the face, and eyes that signal "looking at you" with nothing intentional behind them ([Twente face-eye mismatch thesis](https://essay.utwente.nl/essays/99820), [Praxis Berlin on AI faces](https://www.praxis-psychologie-berlin.de/wikiblog-english/articles/the-uncanny-why-ai-faces-make-us-shudder)). A particle face makes this worse in specific, fixable ways:
  1. **Dark hollow eye sockets and mouth**: particles form a bright surface with *empty* holes where eyes and mouth are, which is exactly a skull or mask.
  2. **Lighting from below / rim glow**: warm or red-orange glow from beneath (the current `--cq-q-ember`) is classic horror lighting.
  3. **Elongated or slightly asymmetric features** from point targets (stretched jaw, narrow eyes).
  4. **Micro-motion on a near-human face** (particle jitter, eyes that don't blink, mouth that doesn't sync with speech).
  5. **Pareidolia in noise**: dense particles with dark gaps produce faces (and grimaces) the brain completes.
- **Recommendation**: remove the face as the default. Make Q an **abstract, free-morphing presence** (K1) whose motion carries emotion (breathing, attention, speaking), like ChatGPT's voice orb and Siri's glow ([Futurism on OpenAI's orb](https://futurism.com/openai-posts-orb), [OpenAI community: voice mode visuals](https://community.openai.com/t/voice-mode-visual-improvements/1386614), [Yanko Design: Siri on Vision Pro](https://www.yankodesign.com/2025/09/02/siri-gets-a-dedicated-avatar-in-vision-pro-thanks-to-this-ui-concept/amp/)). If the founder still wants a human face, use a **stylised, warm, fully lit human face shown rarely** (e.g. a still portrait in onboarding), never a live particle face. Section 3 gives both options and rules.
- **K3: gold must be used differently on dark and light.** Classic gold (#C9A227) passes AA on near-black (8.1:1) but **fails on white (2.4:1)**. On light backgrounds gold text needs to be a deep bronze (#8A6A12 at 5.1:1 on white, or #6E5410 at 7.2:1). Full table in section 4 (computed with the WCAG 2.x relative-luminance formula).
- Tokens already exist (`--cq-accent`, `--cq-q-core`, `--cq-q-ember`, `--cq-q-bloom`, `--cq-qcard-*`, `--cq-stage-accent`...) in `packages/ui`; the brand switch is a token change, which also satisfies "the brand must stay changeable at any time".

## 2. K1: a freer presence that morphs

References (abstract AI presences): OpenAI's voice orb (a black dot that morphs into ovals as waveforms; flowing colour in advanced mode), Siri's glass orb with a glowing waveform, Apple Intelligence's edge glow, Humane / Rabbit minimal light motifs, generative "fluid" particle systems (curl noise, flocking). Avoid the CLAUDE.md prohibited list: glowing brains, robot heads, neural particles that look like networks, circuit lines, purple-blue AI gradients, holographic dashboards, Sparkles as the Q icon. Glow is allowed on Q only (ADR-0017).

Design system for the presence:
- **Vocabulary of forms**, chosen by state, morphing between them (the existing `presence-figures.ts` / `presence-machine.ts` are the place):

| State | Form | Motion |
|---|---|---|
| Idle | Soft sphere or "seed" of gold dust | Slow breathing (4-6 s cycle), very low amplitude |
| Listening | Opens into a ring / halo facing the user | Responds to mic level (amplitude → radius) |
| Thinking | Loose swirling cloud, fluid (curl noise) | Steady flow, no flicker; pairs with the hum (sound-design.md) |
| Speaking | Wave ribbon or pulsing core | Driven by Q's output audio envelope (lip-sync for an abstract form) |
| Result ready | Particles stream toward the card that appeared, then settle | One gesture, 400-600 ms |
| Working (agents) | Several small orbiting motes (one per running job) | Subtle; count is meaningful |
| Error | Contracts slightly, dims | No red flash |
| Shapes on topic (K1 "many shapes") | Q of the logo, a rising line for growth, a globe dot-map for geography, stacked bars for comparisons | Morph only at state changes, max one morph per 2 s; never cartoonish |

- **Performance budget**: GPU particles, ≤ 20k points on desktop, ≤ 6k on mid phones, 60 fps target, drop to 30 fps and fewer points on low battery or `prefers-reduced-motion` (reduced motion: a static glyph that changes colour and size only). Pause when off-screen or tab hidden. The existing `presence-budget.ts` should own this.
- **Generate pictures first** (K1): produce stills for each state in both themes before coding; the founder approves forms, then motion.

## 3. K2: face options

| Option | What | Pros | Cons | Recommendation |
|---|---|---|---|---|
| A. Abstract only | No face; emotion through motion, light, sound | No uncanny risk; fits "institutional"; cheap to render | Less "personal" | **Default** |
| B. Abstract with eyes-only hint | Two soft light points that "look" toward the user while listening | Attention cue without a face | Can still trigger pareidolia; keep them non-anatomical (round, no sockets) | Optional micro-detail |
| C. Stylised human face (illustrated, not photoreal) | A warm, well-lit, front-facing illustrated face, consistent identity | Human warmth the founder wants | Gendered/ethnic identity choices; risk of mascot feel | Use only in specific moments (onboarding, empty states), static or minimal motion |
| D. Photoreal human avatar (talking head) | Video avatar with lip sync | Most human | Deepest uncanny-valley risk with motion (Mori); expensive; trust concerns (looks like a real person; CLAUDE.md forbids impersonation) | Not recommended |

If the founder insists on a face in the presence itself (C, animated):
- **Fully lit from the front/top**, warm neutral light; **no under-lighting, no red/orange rim**.
- **Eyes**: filled irises with catch-lights consistent with the light source; never empty sockets; blink every 3-6 s; gaze toward the user only while listening.
- **Proportions**: realistic or gently stylised, symmetric; no elongation.
- **Mouth** driven by viseme data from the realtime audio, or closed and still (a static mouth is better than a wrong one).
- **Density**: if particles, render the face as a filled surface (high density, soft shading), not as a point cloud with gaps.
- **Test** with 10 people: show stills and a 10-second clip; ask "describe this face in one word". Ship only if no one says creepy/scary/demon.
- Diversity: pick a face that reads warm across Lagos, Nairobi, Johannesburg, Dubai, London audiences; or avoid a single ethnicity by staying abstract (another reason for option A).

## 4. K3: black and gold palette with contrast

Contrast ratios computed with the WCAG 2.x formula (AA: 4.5:1 body text, 3:1 large text and UI components; AAA: 7:1).

### 4.1 Base colours

| Token proposal | Hex | Use |
|---|---|---|
| canvas-dark | #0B0B0C | Dark theme page |
| surface-dark | #121214 | Cards (dark) |
| raised-dark | #1A1A1D | Raised / sheets (dark) |
| canvas-light | #FAF7F0 | Light theme page (warm ivory, "not full black" per K3) |
| surface-light | #FFFFFF | Cards (light) |
| sunken-light | #F4EFE4 | Wells (light) |
| ink | #141414 | Text on light |
| ivory | #F5F1E8 | Text on dark |
| gold-300 champagne | #E8CF8E | Highlights on dark, Q glow |
| gold-400 | #D9B45A | Accent text/icons on dark |
| gold-500 classic | #C9A227 | Primary accent on dark (buttons, focus) |
| gold-600 | #A8841B | Large text / UI on light only (3:1+) |
| gold-700 bronze | #8A6A12 | Accent text on light (AA) |
| gold-800 deep bronze | #6E5410 | Accent text on light (AAA), button fill on light with white text |

### 4.2 Contrast table (gold vs backgrounds)

| Foreground | on #0B0B0C | on #121214 | on #1A1A1D | on #FFFFFF | on #FAF7F0 | on #F4EFE4 |
|---|---|---|---|---|---|---|
| #E8CF8E gold-300 | 12.88 AAA | 12.25 AAA | 11.37 AAA | 1.53 fail | 1.43 fail | 1.33 fail |
| #D9B45A gold-400 | 9.96 AAA | 9.47 AAA | 8.79 AAA | 1.98 fail | 1.85 fail | 1.72 fail |
| #D4AF37 "metallic gold" | 9.36 AAA | 8.90 AAA | 8.26 AAA | 2.10 fail | 1.97 fail | 1.83 fail |
| #C9A227 gold-500 | 8.13 AAA | 7.73 AAA | 7.18 AAA | 2.42 fail | 2.26 fail | 2.11 fail |
| #B8860B dark goldenrod | 6.05 AA | 5.75 AA | 5.34 AA | 3.25 large/UI only | 3.04 large/UI only | 2.84 fail |
| #A8841B gold-600 | 5.60 AA | 5.33 AA | 4.95 AA | 3.51 large/UI only | 3.28 large/UI only | 3.06 large/UI only |
| #8A6A12 gold-700 | 3.89 large/UI only | 3.70 large/UI only | 3.43 large/UI only | **5.06 AA** | **4.73 AA** | 4.41 large/UI only |
| #6E5410 gold-800 | 2.75 fail | 2.62 fail | 2.43 fail | **7.15 AAA** | **6.68 AA** | 6.23 AA |
| #5A440C gold-900 | 2.12 fail | 2.02 fail | 1.87 fail | 9.26 AAA | 8.66 AAA | 8.08 AAA |
| #F5F1E8 ivory | 17.45 AAA | 16.60 AAA | 15.40 AAA | — | — | — |
| #141414 ink | — | — | — | 18.42 AAA | 17.22 AAA | 16.07 AAA |

Button pairs:
- Dark theme primary: **#0B0B0C text on #C9A227** = 8.13:1 (AAA); on #D9B45A = 9.96:1.
- Light theme primary: **#FFFFFF text on #6E5410** = 7.15:1 (AAA). Do **not** use ivory #F5F1E8 on #8A6A12 (4.49:1, just fails AA for body text).
- Ink #141414 on champagne #E8CF8E = 12.06:1 (for gold "badge" fills in either theme).
- Muted text: #A1A1AA on #0B0B0C = 7.68:1; #5C5C66 on #FAF7F0 = 6.18:1.

Rules:
1. **Gold text on light backgrounds uses gold-700 or darker.** Bright gold on light is only for large decorative shapes, never text or essential icons.
2. Gold is an **accent**, not a surface: ≤ 10% of any screen; most UI stays neutral (ink/ivory/greys). Luxury reads as restraint.
3. Status colours (positive, danger, info) stay distinct from gold so gold never means "warning" (yellow-ish). Use words and icons with status, never colour alone.
4. Pass stays neutral (CLAUDE.md), not red and not gold.
5. Metallic feel: subtle linear gradient only on the Q presence and the logo (glow on Q only, ADR-0017); no gradient headings (prohibited).
6. Focus ring: gold-500 on dark (7.18:1 against #1A1A1D), gold-800 on light, 2 px + 2 px offset.

### 4.3 Changeable brand (K3)

- Map these to existing semantic tokens (`--cq-accent`, `--cq-accent-hover`, `--cq-accent-soft`, `--cq-focus-ring`, `--cq-q-core`, `--cq-q-bloom`, `--cq-q-ember` → rename meaning to "q-warm", `--cq-stage-accent`, `--cq-qcard-*`) per theme. No raw hex in components (CLAUDE.md).
- Keep a **brand file** (one token set per brand) so switching brand = switching a token set; keep the previous brand as an alternative set for quick rollback.
- Run an automated contrast check over every text/background token pair in both themes in CI (deterministic test), failing below 4.5:1 for text pairs and 3:1 for UI pairs.

## 5. Gaps and recommendations

1. **Retire `--cq-q-ember` as an under-light**: ember/orange under-glow is a demon cue; replace with a top-down champagne light.
2. **Logo and favicon in gold-on-black** need a light-mode variant in deep bronze; test at 16 px.
3. **Charts**: gold as the "you / this company" series, neutrals for others; never rely on gold vs yellow distinction.
4. **Photography/illustration**: if any human imagery is used (founder profiles are real photos), keep it separate from Q's identity so Q never looks like a specific person.
5. **Cultural note**: black and gold reads premium in Nigeria, Kenya, South Africa and the Gulf; avoid excessive gold that reads as "luxury retail" rather than "institutional finance". Pair with a serious serif or a clean sans for headings (`--cq-font-editorial`).
6. **Dark mode default?** Black-and-gold invites dark-by-default, but light mode is first-class (CLAUDE.md); keep the visible theme switcher (ADR-0017) and make sure light mode has the bronze accents above.
7. **Mockups (N1)**: generate stills: presence in 6 states × 2 themes; Discover card, profile tabs, Q card in both themes, with the contrast pairs above annotated.
