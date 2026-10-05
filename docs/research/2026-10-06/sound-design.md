# Sound design for Q (I2)

Research agent M1, 2026-10-06. Feeds I2: subtle but epic sound effects (a soft hum while thinking, a ping when a result is ready, listening on and off, error), switchable off.

## 1. Principles

- **Few, distinct, consistent sounds.** Earcons add cognitive load; keep to a handful that are easy to tell apart, use them consistently so people learn them, and don't use one that needs explaining ([Google conversation design: earcons](https://developers.google.com/assistant/conversation-design/earcons), [Material: applying sound to UI](https://m2.material.io/design/sound/applying-sound-to-ui.html)). Research on earcons (Brewster) shows timbre, rhythm and pitch contour are what make earcons distinguishable ([Brewster guidelines](https://www.dcs.gla.ac.uk/~stephen/earcon_guidelines.shtml), [Brewster CHI'93](https://www.dcs.gla.ac.uk/~stephen/papers/CHI93.PDF)).
- **Brief.** Earcons should be as short as possible; a greeting can be longer ([Google](https://developers.google.com/assistant/conversation-design/earcons)). Most UI sounds 60-300 ms; the "ready" signature up to ~600 ms.
- **Pair with haptics and visuals, never replace them.** Apple pairs success sounds with subtle haptics and warns against overuse ([Uxcel on Apple HIG](https://app.uxcel.com/courses/apple-hig/accessibility-inclusion-standards-812/audio-and-haptic-feedback-0671)). Meaning must never depend on sound alone (deaf and hard-of-hearing users, muted phones).
- **Control.** Any audio that plays automatically for more than 3 seconds needs pause/stop/volume (WCAG 1.4.2) ([BOIA](https://www.boia.org/wcag2/cp/1.4.2?hsLang=en)); the thinking hum can last longer, so it must be stoppable and quiet by design, and stop when Q starts speaking.
- **Brand feel (Teenage Engineering, Apple)**: clean sine/triangle tones, soft attacks, short reverb tails, musical intervals (perfect fifth, major third) rather than buzzy synth sounds. "Epic" here means a small, warm, confident signature, not a cinematic swell. With the black-and-gold brand (presence-brand.md), choose warm timbres: sine + a little second harmonic, like a soft bell or struck glass.

## 2. The sound set (six sounds, no more for V1)

| Event | Sound | Duration | Peak level (relative to Q's voice) | Notes |
|---|---|---|---|---|
| **Listening on** (wake word or tap) | Rising two-note: E5 → B5 (perfect fifth up), soft sine | 140 ms | −18 dB | Universally read as "opening" (rising contour) |
| **Listening off** | Falling two-note: B5 → E5 | 120 ms | −20 dB | Mirror of on |
| **Thinking** (hum) | Low pad: A2 + E3, sine + slight detune (±3 cents), slow 0.3 Hz amplitude wobble, low-pass ~800 Hz | loops; fade in 400 ms after a 600 ms delay; fade out 200 ms | −30 dB | Only if thinking > 600 ms; stops the moment Q speaks or the result appears; never under Q's voice |
| **Result ready** (signature "ping") | Three-note arpeggio E5-G#5-B5 (major triad), bell-like (sine + 2nd and 3rd partial at −12/−20 dB), 2 ms attack, 350 ms exponential decay, light reverb tail | ~500 ms | −14 dB | The brand earcon; also used for "job done" in the workforce |
| **Needs you** (approval waiting) | Two soft taps at the same pitch, G5, 90 ms apart | 250 ms | −18 dB | Distinct by rhythm (repeat) not pitch |
| **Error / couldn't do it** | Single low muted tone, E4 → D4 slight downward bend, triangle wave, low-pass | 220 ms | −18 dB | Not harsh; never a buzzer |

Optional later: card expand / swipe ticks (very quiet, 30-50 ms noise bursts at −30 dB) for the Board and Stage; skip in V1 to avoid sound clutter.

Timing rules:
- Never play two earcons within 150 ms; the newer one wins.
- No earcon while Q is speaking except "Listening on" when the user barges in.
- Debounce "result ready" when several cards arrive: one ping per answer, not per card.

## 3. WebAudio synthesis recipes (no samples, no licensing)

All sounds are synthesised at runtime with the Web Audio API, so there are no third-party audio licences. One shared `AudioContext` created on the first user gesture (iOS/Safari require a gesture to start audio), resumed on `visibilitychange`. One master `GainNode` for the sound volume setting, then a gentle `DynamicsCompressorNode` to avoid clipping, then destination.

| Sound | Graph | Parameters |
|---|---|---|
| Listening on/off | 2 × (OscillatorNode sine → GainNode envelope) scheduled back-to-back | note length 60-70 ms each; envelope: 0 → peak in 5 ms, exponential ramp to 0.001 over note length; second note starts at +60 ms |
| Thinking hum | 2 OscillatorNodes (sine 110 Hz, sine 164.8 Hz detuned +3 cents) → BiquadFilter lowpass 800 Hz Q 0.7 → Gain (LFO: OscillatorNode 0.3 Hz → GainNode depth 0.15 → main gain.gain) | linearRamp gain 0 → target over 400 ms after 600 ms delay; on stop, ramp to 0 over 200 ms then stop oscillators |
| Result ready | For each of 3 notes: fundamental sine + partial 2 (×2 freq, −12 dB) + partial 3 (×3, −20 dB) → Gain envelope; notes staggered 70 ms; → ConvolverNode with a synthetic impulse (0.6 s exponentially decaying noise, generated in code) at 15% wet | attack 2 ms, exponential decay 350 ms |
| Needs you | 2 × sine G5 (784 Hz) blips, 40 ms each, 90 ms apart | attack 3 ms, decay 40 ms |
| Error | Triangle oscillator 329.6 Hz with frequency ramp to 293.7 Hz over 200 ms → lowpass 1.2 kHz → gain envelope | attack 5 ms, decay 220 ms |

Implementation notes:
- Use `setValueAtTime` + `exponentialRampToValueAtTime` (never ramp to exactly 0; use 0.0001) to avoid clicks.
- Precompute the reverb impulse once.
- Respect the system: if `document.hidden`, don't play. If the device is in silent mode (iOS), web audio may still play through some paths; keep defaults quiet.
- Mix with the realtime voice: duck earcons, not the voice; apply −6 dB to earcons when the voice line is active.
- Frequencies in Hz: E4 329.6, G4 392.0, E5 659.3, G#5 830.6, B5 987.8, A2 110.0, E3 164.8, G5 784.0.

## 4. Settings and accessibility

- Settings → Sound: **Sound effects** On/Off (default **On** for voice interactions, but the thinking hum default **Off** on mobile to save battery and avoid annoyance; founder can flip), **Volume** slider, **Thinking hum** On/Off separately.
- Respect `prefers-reduced-motion`? It is about motion, not sound; do not tie sound to it. But offer a single **"Calm mode"** that turns off hum and ticks, keeping only on/off/ready/error.
- Screen readers: earcons must not mask announcements; keep them short and quiet; always pair with `aria-live` text ("Result ready").
- Never communicate meaning by sound alone; the presence animation and text always show the same state.
- Store the preference per device (localStorage with try/catch) and also per user profile if signed in.

## 5. Gaps and recommendations

1. **One owner** for audio (a small sound controller), like the single voice-line owner and the single preload controller, so surfaces don't each create AudioContexts.
2. **Gesture unlock**: create/resume the AudioContext on the first tap (e.g. the Q dock) so the wake-word "Listening on" sound can play later without a gesture.
3. **Hum vs latency**: the hum signals waiting; if latency improves (L1), most answers won't need it (it starts after 600 ms). That's correct: the best hum is the one that never plays.
4. **Brand signature reuse**: the "result ready" triad can become Capital Q's sonic logo (short, warm, three notes) for onboarding complete and the first match.
5. **Testing**: unit-test the scheduler logic (debounce, no overlap, ducking) with a fake AudioContext; listen tests on phone speakers (most users) — low notes below ~150 Hz vanish on phone speakers, so the hum must include the E3 partial or a filtered harmonic to be audible at all.
6. **Cultural neutrality**: avoid sounds resembling notification tones of WhatsApp, iMessage or banking OTP alerts, which would cause confusion in African and Gulf markets where these are ubiquitous.
