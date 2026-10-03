# ADR 0045: Q's presence keeps the particle swarm

- Status: Accepted (founder decision, 2026-10-03)
- Amends: ADR 0017 C3 ("the particle-field presence is superseded by F2 and
  retired in UX-02") and, to that extent, F2's description of the Q
  Aperture as a ring of light
- Implemented: build/demo-1

## Context

ADR 0017 C3 retired the particle-field presence in favour of the Q Aperture,
a ring-and-tail mark rendered as light. The shipped Aperture renders Q as a
particle swarm (`features/q-swarm`), as does the cold-start splash (ADR
0026). The 2026-10-03 demo audit flagged the swarm against C3 and against
`CLAUDE.md`'s "neural particles" prohibition. The founder decided to keep
it: the swarm is Q's mark.

## Decision

1. The particle swarm is Q's presence on the Q page, the dock, chat and the
   splash. C3's retirement is withdrawn.
2. Everything else in F2 holds: light and motion on **Q only**; one hue
   family (no purple-blue multi-hue sweep); motion only for real state;
   Q motion Full · Calm · Off with reduced motion forcing Calm; no text on
   the glow; the state label beside it at ≥ 4.5:1.
3. The swarm is never used as decoration anywhere else (backgrounds,
   cards, empty states, charts). `CLAUDE.md`'s "neural particles"
   prohibition still holds for everything that is not Q.
4. The swarm is never cropped by its container: the stage gives it room
   on every viewport (fixed on mobile Home, 2026-10-03).

## Consequences

- No rework of the presence to a ring is planned.
- Reviews judge the swarm against the F2 limits above, not against C3.
