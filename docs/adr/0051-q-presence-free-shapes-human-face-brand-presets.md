# ADR 0051: Q presence: free shapes, a human face while speaking, and brand presets

- Status: Accepted (founder approval, 2026-10-06; overnight plan items K1, K2, K3 and I2; design B mockups on `build/design-b`, `docs/design/2026-10-06/b/presence.html`, `brand.html` and `sound.html`)
- Amends: ADR 0017 (the "no face" prohibition, for this one case only; Q keeps its own colour, except where a brand preset sets it), ADR 0049 (the presence's figures)
- Amended 2026-10-08 (founder, Zino: "Remove the human face from Q -- let it morph into everything else including the Q, but not the face"): K2 is withdrawn. The FACE figure, `presence-face.ts` and the `face` surface flag are removed; Q speaks as the wave on every surface, the Q page included. The free shapes, the Q moment, the states and the W7 performance work stay. ADR 0017's "no face" rule applies again without exception. Design: `docs/design/2026-10-08/q-presence-room/`.
- Implemented: build/presence2

## Context

The founder reviewed design B and approved it. In his words:

- presence: "freer… morphing into many shapes… not stuck in a ball";
- face: "the face looks like a demon… either scrap the face or a proper human being's face… I'll prefer that";
- brand: "Capital Q's colours are black and gold… make sure everything works… anybody should be able to change the branding at any time";
- sound: "sound effects… soft hum when thinking, pings when a result is ready… not too much".

The research for K1 to K3 (`docs/research/2026-10-06/presence-brand.md` on `build/research`) gives the reason the old face read as a demon. Its sampled portrait had hollow dark sockets and a dark mouth, bright staring eyes, and features traced as edges. Those are the uncanny-valley triggers. Particle jitter made them worse.

## Decision

1. **Free shapes (K1).** Q's presence keeps one swarm and one state machine. It now takes design B's shapes:
   - cloud: rest, breathing;
   - cloud, leaning in: listening;
   - spiral: thinking;
   - ring: working;
   - wave: speaking with no face;
   - the Q mark in knots of light: an answer is ready, shown once, then back to the cloud;
   - ribbon: briefly, when Q arrives on a surface it travels to.

   A change of shape is a staggered flow along a swirl. The swirl is zero at both ends, so a change starts and lands exactly. It is not a cut and not a straight slide. The existing bounds on speed and acceleration still hold. Reduced motion draws each shape still. The frame budget still lowers the particle count and DPR on slow devices.

2. **A human face only while Q speaks (K2).** The portrait-sampled face is removed: its data, its head, its tilt and its nod. The replacement is design B's option B, a warm human face drawn in particles:
   - an evenly lit skin surface with a painted tone map;
   - thin, dim lines of light for the lids, brows and lips;
   - a closed smile;
   - a faint iris and one catchlight;
   - a blink;
   - a lower lip and chin that move with Q's voice amplitude.

   It renders in finer points with a near-dark floor, so shade reads as shade.

   **ADR 0017's "no face" rule is amended for this case only.** The face shows only while Q is speaking, only on the Q page's own presence (the caller marks that surface), and only at 160 px or more. Every other surface and state has no face (option A). This includes the dock, the panel, inline marks, the landing hero, onboarding and every glyph or gesture. The face-borne gestures became shapes or hands: laugh is the ribbon, think-tilt the spiral, nod the Q mark, and explaining is two hands.

3. **Brand presets (K3).** A preset layer sits over the brand theme. A preset sets the page, the surfaces, the menu bar, the accent and Q's light together. The admin's own accent can still go on top.
   - **Black and gold** follows design B's brand board. Light theme: ivory paper and near-black text. Dark theme: near-black and ivory. The menu bar is black in both. Gold is a fill or a deep bronze for text: `#C9A227` on dark, and `#8A6A12` (hover `#6E5410`) on light, because classic gold fails on white at 2.4:1.
   - **Capital Q blue** is `tokens.css` unchanged.

   Black and gold is the platform default. A missing row means black and gold, and migration `20261207100000_brand_presets.sql` adds `platform_ops.brand_themes.preset_key` with default `black_gold`. The admin switches back at `/admin/brand` in two clicks, under the same permission and step-up as the brand colour, and every change is audited. Only the preset's key is stored. The palettes are code. Each preset's token pairs are tested against WCAG AA in both themes, and the style sheet is written only from values that re-check as hex.

   Q's light is the one exception to ADR 0017 F2's "Q keeps its colour". A preset may set it, and a custom accent never does.

4. **Sounds (I2).** Small sounds synthesised with WebAudio, with no audio files. They follow design B's sound board: wake, listening on and off, a thinking hum, a result ping, needs you, error, and sent. Rules:
   - sounds play only on real state changes;
   - never while Q speaks, and never in Discover's swipe path;
   - at most one every 0.6 s, with later ones dropped;
   - the hum plays only on the Q page, and stops by itself at 20 s;
   - there is no hum for anyone who asks the system for reduced motion or reduced transparency;
   - Settings → Appearance offers On, Quiet or Off for this device;
   - new devices start on Quiet, which keeps only Result ready, Needs you and errors;
   - the audio session is "ambient" where supported, so the OS mute switch wins.

## Consequences

- Every other ADR 0017 prohibition stands: no robot or character imagery, no neural particles, and no glow except on Q.
- The voice choice (female or male) no longer changes the presence. The single face belongs to Q, not to the voice.
- A tenant override row keeps working. It now also names a preset (default black and gold).
- Classic blue's own token pairs are tested in the same suite. Its field borders (`--cq-border-strong` on cards) were already below 3:1, so the border pair is asserted for black and gold only. This is a known gap in classic blue and is not changed here.

## Amendment, 2026-10-06 (P11): a deliberate, state-driven presence

The founder: "the Q presence is still very random... didn't even see the face, and what I did see was random at random times."

Root causes: the Q page's in-conversation presence (200 px, the one Q speaks from) never set `face`, so the face could only show before a conversation began; and the answer's gestures, the wake "!", the ready Q mark and the arrival ribbon each took over on their own timers, replacing the face mid-speech.

Change: the figure is now a pure function of the surface's state (`presenceFor` in `presence-machine.ts`): idle, done or error is the cloud (error dimmed), listening the lean, thinking the spiral, working the ring, speaking the face (Q page, 160 px or more) or else the wave, asking or approval the "?", and resting with answer cards up the Q mark. The shape changes only when the state does. Answer gestures no longer drive the presence (the event is still announced and validated, and the gesture figures remain for a later, state-bound use); wake, ready and arrival flourishes are removed. Morph durations are fixed per destination and each particle keeps its seeded stagger, so a change looks the same every time. Decision 2's surface rule is unchanged.
