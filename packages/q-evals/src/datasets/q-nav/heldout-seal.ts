/**
 * The q-nav held-out split, sealed (owner decision 78, 7 Nov 2026).
 *
 * The SHA-256 of the held-out cases as built (`heldout-third.ts`: the third
 * held-out set, written by a separate author from the app code only, never
 * seen while tuning; the decision-75 set was measured once and retired).
 * Sealed before any dev run on it. A test fails on any change to them: the
 * set is measured once. Resealing is an owner-visible event: say why in
 * the handoff log, never to make a number move.
 */
export const Q_NAV_HELDOUT_SEAL = {
  sha256: "a4e5a047857fec61df453bd482efc06b2427604e2d83cb5ab49318f994f8f1d2",
  turns: 385,
  sealedAt: "2026-11-07",
} as const;
