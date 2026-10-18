# ADR 0049: Q's presence is a 3D particle swarm

- Status: Accepted (founder approval, 2026-10-04: "I want it to be 3D like that... you have full approval and reign")
- Amends: ADR 0045 (the presence keeps the particle swarm)
- Implemented: build/p11-presence

## Decision

Q's presence is drawn as a true 3D swarm: a depth-shaded cloud with a
brighter core, turned towards the cursor, as in the 2026-10 landing reference.

## Kept from ADR 0045

- The swarm is Q's presence on the Q page, the dock, voice, chat, loaders and the landing hero.
- Light and motion on Q only; one hue family; the warm-white core and the halo appear only on Q, on dark surfaces.
- Motion only for real state: idle drift, listening (mic level), thinking, working (the ring), speaking (output level) and the answer's gestures, all from the unchanged presence machine and figures.
- Q motion Full, Calm and Off, with reduced motion forcing Calm; the state label sits beside the mark, never on the glow; the canvas stays hidden from assistive technology.
- Never decoration elsewhere; never cropped by its container.

## Changed

- The cloud is a real sphere and the working ring is tilted in depth; the renderer projects them in perspective with depth-attenuated size and brightness and additive blending (`features/q-swarm/presence-3d.ts`, raw WebGL2, about 2.5 KB gz, loaded by dynamic import).
- The swarm leans towards the cursor or touch on a critically damped spring.
- Reduced motion shows one still 3D frame (a fixed turned pose), not a flat one.
- Point count scales with the device (cores, DPR capped at 2), and a frame-budget guard drops points, then DPR, when frames run long.
- The 2D swarm remains only as the fallback: no WebGL2, a lost context, or a device asking for light work.
