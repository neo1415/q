---
title: PRESENCE — Q's particles follow what is said, heard and done
area: PRESENCE (no migrations)
owner: PRESENCE worker (branch build/presence)
status: spec, then build
---

# PRESENCE

## 0. Goal (founder's words, 2026-10-01)

"I love the particles but there's a disconnect between me speaking, Q
speaking and what the particles form. Constant shifting should be truly
continuous: never slow drift then a sudden bounce into a shape. Forming a
shape uses the same smooth motion, just a bit faster sometimes — variable
speed, sometimes fast, sometimes slow, never jumpy. [...] The face should
be more realistic (not cartoon; not hyper-defined either) and a bit bigger.
Hands moving: I've never seen it. When we're not talking to Q it doesn't
need to show the face; show the face only when Q itself is talking. 'Hey
Q' → a question mark or exclamation. Thinking → a face with head moving /
tilting sideways. Normal talk → just the face. Explaining or doing
something → shapes tied to what it is saying (money → dollar sign,
buildings for companies/property, clapping when impressed, head tilting
back when laughing). Doesn't need to be a fully formed face. Right now the
stuff is there but not connected to what we are saying or what it is
seeing."

## 1. What is wrong today (read from the code at 18ae9ace)

| Symptom                              | Cause                                                                                                                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Slow drift, then a bounce into shape | `swarm-engine.ts` re-targets every particle at once and a spring (k 4.2) pulls it across the frame: the first frames carry the largest velocity; nothing bounds speed.  |
| Not connected to speech              | `swarm-choreography.ts` plays a timed loop per state (face, galaxy, bloom, 👋 …) whatever is being said; the "cue" is a regex word list over Q's sentence (`CONCEPTS`). |
| Face when nobody talks               | IDLE / LISTENING sequences include FACE beats.                                                                                                                          |
| Hands never seen                     | Hands sit at y 0.72 (+0.8 when quiet): outside the drawn frame at the face scale.                                                                                       |
| Cartoon face                         | Flat alpha per part; no depth; the head "turn" is an x-shift.                                                                                                           |
| Perf                                 | Canvas2D `arc()` per particle per frame, per instance (up to 900 × several canvases).                                                                                   |

## 2. Research (sources)

| #   | Finding                                                                                                                                                                              | Source                                                                                                                                           | Applied                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| P1  | ElevenLabs UI Orb: a shader orb driven by an `agentState` (listening / thinking / talking) and two 0..1 volumes (input, output) read per frame; volumes are eased, never stepped.    | https://elevenlabs.io/blog/elevenlabs-ui ; Deepgram's equivalent Orb API https://developers.deepgram.com/docs/browser-agent-react-ui             | The presence reads the real voice state and mic/speaker levels per frame, eased with attack/release.      |
| P2  | Curl / flow-field noise gives divergence-free, endlessly continuous motion (Bridson et al., "Curl-noise for procedural fluid flow", SIGGRAPH 2007).                                  | https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph2007-curlnoise.pdf                                                                          | Idle is a flow field, always present under every figure (amplitude varies, never switches off).           |
| P3  | Reynolds' steering ("arrival"): speed is clamped and ramps down near the target — no overshoot.                                                                                      | Reynolds, "Steering Behaviors For Autonomous Characters", GDC 1999 https://www.red3d.com/cwr/steer/gdc99/                                        | Particles steer to targets with a bounded max speed and arrival; per-frame displacement has a hard bound. |
| P4  | Disney principles: slow-in/slow-out, anticipation, arcs, overlapping action.                                                                                                         | Thomas & Johnston, _The Illusion of Life_ (1981); summary https://en.wikipedia.org/wiki/Twelve_basic_principles_of_animation                     | Morph weights eased (smootherstep), per-particle stagger (overlap), variable bounded morph duration.      |
| P5  | Lip-sync without visemes: amplitude envelope with fast attack / slow release reads as speech; jaw drop ∝ RMS.                                                                        | Common practice (e.g. Oculus Lipsync "laughter/energy" fallback) https://developers.meta.com/horizon/documentation/unity/audio-ovrlipsync-unity/ | Mouth open = eased output level; width varies with level band; blinks every 2.5–6 s (~120 ms).            |
| P6  | `prefers-reduced-motion`: replace motion with a static or very slow equivalent; never remove information.                                                                            | WCAG 2.2 SC 2.3.3 https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions                                                        | Motion "off" draws one settled frame per state change; "calm" halves speeds.                              |
| P7  | WebGL2 `POINTS` with a gaussian sprite in the fragment shader draws thousands of particles in one call; one shared context blitted to 2D canvases avoids the per-page context limit. | MDN WebGL best practices https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices                                         | One shared WebGL2 context (as the aperture renderer already does); Canvas2D fallback.                     |

## 3. State machine (pure, `presence-machine.ts`)

Signals (all real, none inferred from words): the surface's `QApertureState`
(voice state / run state), mic level, speaker level, and the gesture queue.

| Presence   | When                                                    | Figure                                                                                         |
| ---------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| FLOW       | IDLE, COMPLETE, ERROR (dim)                             | Flow field cloud, no face.                                                                     |
| ATTENTIVE  | LISTENING (incl. user speaking)                         | Cloud leans toward the person (down/forward), swells with mic level. No face.                  |
| WAKE       | entering LISTENING from IDLE ("Hey Q", session opens)   | EXCLAIM `!` for ~1.6 s, then ATTENTIVE.                                                        |
| ASKING     | NEEDS_INPUT, NEEDS_APPROVAL                             | QUESTION `?` (held, breathing).                                                                |
| THINKING   | THINKING, WORKING                                       | Head (soft, partial face) with slow sideways tilt and glance; WORKING keeps a slow orbit flow. |
| SPEAKING   | SPEAKING                                                | Face: mouth from speaker level, blinks, subtle head motion; larger (0.62 of frame vs 0.52).    |
| GESTURE(g) | a gesture is due (voice: at its sentence; text: queued) | Its figure for ~2.2 s (LAUGH 2.8 s), then back to the state's figure.                          |

Gestures (closed set, contract `QPresenceGesture`): QUESTION `?`, EXCLAIM
`!`, MONEY `$`, BUILDINGS skyline, CHART_UP rising line + arrow, CLAP two
hands meeting, LAUGH face pitched back + open mouth + shake, THINK_TILT
face tilted, NOD face nodding, HANDS_EXPLAIN face (smaller, higher) + two
open hands gesturing in frame. Below 72 px no face and no gesture figure:
FLOW/ATTENTIVE only (a face cannot be read there).

## 4. Motion — one continuous dynamic

- Every frame the target of particle i is `lerp(from_i, to_i, e(w_i))` +
  flow(x, t) · A, where `w` advances over a morph duration chosen per
  transition in [0.55, 1.6] s (seeded, so variable but bounded), `e` is
  smootherstep, and each particle has a stagger offset ≤ 0.35 of the
  duration (overlapping action). A new transition mid-morph starts from
  where the targets currently are, so nothing ever jumps.
- Flow amplitude `A` itself eases between the per-figure values.
- Particles steer to their target with arrival (Reynolds) and a hard speed
  cap `MAX_STEP` (0.045 frame-units per 1/60 s, scaled by dt and capped at
  dt = 1/30): **no frame moves any particle further than the cap** (tested).
- Face is pseudo-3D: points get a depth from an ellipsoid; yaw / pitch /
  roll rotate in 3D with mild perspective; depth drives size and alpha so
  the face reads as shaded volume, not lines.

## 5. Gesture channel (contract — lead-owned files, labelled commits)

- `packages/contracts/src/q/presence.ts`: `Q_PRESENCE_GESTURES`,
  `QPresenceGestureSchema`, `QSentenceGestureSchema { sentence 0..11,
gesture }`, `QSentenceGesturesSchema` (≤ 4).
- `QResponseMessageSchema.gestures?` — on the durable completion event only
  (not stored in the messages table: presentation, not history).
- `QVoiceTurnStateSchema.presence? { answerId, gestures }` — voice turns.
- `QInterviewTurnResponseSchema.gestures?` — typed onboarding.
- Model side: COMPANY_ANALYST v14 and INTERVIEW_AGENT v16 add an optional
  `gestures` field beside the reply (sentence index + gesture from the
  closed set; default `[]`). Code clamps indexes to the reply's sentence
  count, drops duplicates, keeps ≤ 4. A speech reaction LAUGH (CQ-VOICE-010)
  also yields a LAUGH gesture. No regex or word list decides a gesture;
  the old `CONCEPTS` list is deleted.
- Browser: `announceQGestures({ answerId, text, gestures, spoken })` raises
  `cq:q-gestures`; every presence on the page schedules them. Spoken: at the
  sentence's share of the reply × estimated speech time from the moment Q
  starts speaking; typed: one after another as the answer lands.

Authority: presentation only. No action, no write, no approval class.
Context Firewall: a gesture is a closed enum chosen by a model that already
ran under the request's firewall; it carries no content. Nothing stored.

## 6. Rendering & performance

- `presence-gl.ts`: one shared WebGL2 context, `gl.POINTS`, gaussian sprite
  in the fragment shader, premultiplied blending, blitted to each surface's
  2D canvas; Canvas2D fallback (`fillRect` sprites) when WebGL2 is missing
  or lost.
- Particle counts: ≥300 px 1100, ≥150 px 800, ≥72 px 420, else 160.
- Paused off-screen (IntersectionObserver) and when the tab is hidden.
- Reduced motion (`useQMotion` "off"): no loop; one settled frame per state.

## 7. Surfaces wired

Home Q (q-conversation: typed answers → gestures; voice → turn board
presence), dock (same session + presence state), onboarding (voice via the
turn board; typed via interview response), `/dev/presence` playground with
every state and gesture, synthetic levels, motion toggle, theme toggle.

## 8. Tests

- Machine: every state → presence, wake on IDLE→LISTENING, ASKING on
  NEEDS_INPUT, gesture precedence and expiry, small sizes never show face.
- Gesture mapping: each gesture → figure; contract parse; model clamp/dedupe;
  scheduling times (spoken vs typed).
- No snapping: simulate every pair of states/gestures 4 s at 60 fps and 30
  fps; assert max per-frame displacement ≤ cap and no velocity spike at a
  transition.
- Playwright (one browser, background): screenshots of every state at
  /dev/presence, light and dark.

## 9. Edge cases

Interrupted (barge-in) → ATTENTIVE at once (the morph still eases). Voice
drops mid-gesture → gesture finishes, then FLOW. Gestures arriving after
speech ended → played as typed. Unknown gesture from an older/newer server
→ dropped by the schema. WebGL context lost → Canvas2D fallback next frame.
