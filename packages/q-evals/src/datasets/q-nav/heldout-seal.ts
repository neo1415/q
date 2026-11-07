/**
 * The q-nav held-out split, sealed (owner decision 75, 7 Nov 2026).
 *
 * The SHA-256 of the held-out cases as built (`heldout-fresh.ts`, written
 * by a separate author from each place's purpose, never seen while
 * tuning). A test fails on any change to them: the set is measured once,
 * after dev reaches the gate. Resealing is an owner-visible event: say
 * why in the handoff log, never to make a number move.
 */
export const Q_NAV_HELDOUT_SEAL = {
  sha256: "3c613a4641be6e4ff6acde44b2b36c7f736ffe30b9d3af3ecce269bf9e255297",
  turns: 264,
  sealedAt: "2026-11-07",
} as const;
