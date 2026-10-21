# Q Story S4: presence figures (evidence, 2026-10-21)

Branch `qstory/presence-figures`. Captured on `/dev/presence?state=SPEAKING&stage=1` (local `next dev`, headless Chromium, WebGL2 through SwiftShader, so the 3D renderer is in software). Each figure was cued with `cq:q-figure` (`presence.form(figure, { holdMs: 2600 })`). The frame was taken 1.5 s after the cue, and the state's wave flows back when the hold ends.

- `figures-dark.mp4`: every figure forming and releasing, on the night, one after another. It was recorded with video capture running, which slows software GL, so some morphs in it finish late. See the limitation below.
- `dark/*.png`, `light/*.png`: each figure fully formed (the stage aperture, 224 px). All 16 are legible in both themes, in one hue (`--cq-q-colour`, falling back to `--cq-accent`).
- `reduced-{dark,light}-{CLOCK,HOUSE,LETTER_Q}.png`: reduced motion. The still SVG (`PresenceFigureStill`) is drawn instead of the morph, from the same paths the particles are sampled from.
- `timing-novideo.json`: main-thread milliseconds per `requestAnimationFrame` callback while each figure holds, without video capture. This is the work the loop itself measures, including WebGL command submission. The mean is 0.18–0.33 ms and p95 is ≤ 0.9 ms for every figure; the wave baseline is 0.25 / 0.9. That is inside the stage budget of ≤ 4 ms/frame. The dock (40 px) never forms figures. True GPU time could not be measured: SwiftShader exposes no `EXT_disjoint_timer_query_webgl2`. Per-frame cost does not change with the figure, because every figure has the same particle count.
- `timing.json`: the same measurements taken during the video run.

**Limitation.** A hold is counted in real time, so a cue stays aligned with speech. The morph runs on the presence's own clock, which slows when frames run long. On a heavily loaded device, a short hold can therefore end before the figure has fully formed.
