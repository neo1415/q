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

/**
 * The fourth held-out set (batch 8, 7 Nov 2026): `heldout-fourth.ts`,
 * written by a separate author from the app code only, after
 * NAVIGATION_DECISION v10, on conversation-driven placement and tabs.
 * Sealed before it is run; measured once.
 */
export const Q_NAV_HELDOUT4_SEAL = {
  sha256: "882fffbfefc2dc3ad75de1179ceca504c189804aa9584e13e2425a6a6e6c407f",
  turns: 120,
  sealedAt: "2026-11-07",
} as const;

/**
 * The fifth held-out set (Q-NAV, 20 Nov 2026): `heldout-fifth.ts`, for the
 * destinations added after the third and fourth sets were sealed (the
 * organisation admin, its sections and the pipeline import). Sealed when
 * written; the earlier seals are unchanged.
 */
export const Q_NAV_HELDOUT5_SEAL = {
  sha256: "19e5bc116fdfe49e7aaccb92149f587d98f12efd639c0630e3d08496baf5875a",
  turns: 14,
  sealedAt: "2026-11-20",
} as const;
