import type { ActorContext } from "../actor-context/actor-context.js";

/**
 * K Test 6 as a reusable check (docs/recovery/specs/K-security.md §5).
 *
 * Every layer that keeps prepared Q context between turns plugs in here:
 * Tier A snapshots (B), Tier B projections and search indexes (D), GPT-Live
 * context packages and `thinking.append` updates (V), and Q memory
 * retrieval. The check is the founder's scenario:
 *
 *   1. warm a founder-private context as the founder who may see it;
 *   2. the same process is now asked by an investor with no access;
 *   3. nothing the investor can obtain carries the founder-private marker;
 *   4. after the founder's own access is revoked (or the content's
 *      visibility narrows), the founder no longer gets the warmed copy.
 *
 * It returns violations instead of asserting, so it runs under any test
 * runner and a layer's own test states `expect(violations).toEqual([])`.
 */

export type IsolationLayer = {
  readonly name: string;
  /** Prepare whatever this layer caches, as this actor. */
  readonly warm: (actor: ActorContext) => Promise<void>;
  /**
   * Everything this actor can obtain from the layer now, serialised (a
   * snapshot, a projection row set, a Live package, search hits).
   */
  readonly read: (actor: ActorContext) => Promise<string>;
  /**
   * Revoke the founder's access the way production would (a grant
   * revoked, a membership ended, a visibility narrowed), including the
   * invalidation the layer is expected to receive.
   */
  readonly revokeFounder: () => Promise<void>;
};

export type IsolationScenario = {
  readonly founder: ActorContext;
  readonly investor: ActorContext;
  /** A string present only in the founder-private content. */
  readonly marker: string;
};

export async function checkContextIsolation(
  layer: IsolationLayer,
  scenario: IsolationScenario,
): Promise<string[]> {
  const violations: string[] = [];
  const { founder, investor, marker } = scenario;

  await layer.warm(founder);
  const founderView = await layer.read(founder);
  if (!founderView.includes(marker)) {
    // Not an isolation failure, but the check would prove nothing.
    violations.push(
      `${layer.name}: the founder's warm context lacks the marker`,
    );
  }

  const investorView = await layer.read(investor);
  if (investorView.includes(marker)) {
    violations.push(
      `${layer.name}: an investor without access obtained founder-private context`,
    );
  }
  // The investor warming their own context must not pull the founder's in.
  await layer.warm(investor);
  if ((await layer.read(investor)).includes(marker)) {
    violations.push(
      `${layer.name}: an investor's own warm-up surfaced founder-private context`,
    );
  }

  await layer.revokeFounder();
  if ((await layer.read(founder)).includes(marker)) {
    violations.push(
      `${layer.name}: founder-private context survived the revocation of the founder's access`,
    );
  }
  return violations;
}
