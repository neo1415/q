import { describe, expect, it } from "vitest";

import {
  checkContextIsolation,
  ContextCacheScopeError,
  contextCacheKey,
  createContextCache,
  type ContextCacheScope,
  type IsolationLayer,
} from "../src/context-cache/index.js";
import type { ActorContext } from "../src/index.js";

/** RECOVERY K Part 11: cache keys, invalidation, and Test 6. */

const EPOCH_1 = "0".repeat(32);
const EPOCH_2 = "1".repeat(32);
const SUBJECT_EPOCH = "a".repeat(32);

const FOUNDER = {
  userId: "b0000000-0000-4000-8000-000000000001",
  tenantId: "c0000000-0000-4000-8000-000000000001",
  organisationId: "d0000000-0000-4000-8000-000000000001",
  membershipId: "e0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
} as unknown as ActorContext;
const INVESTOR = {
  userId: "b0000000-0000-4000-8000-000000000002",
  tenantId: "c0000000-0000-4000-8000-000000000002",
  organisationId: "d0000000-0000-4000-8000-000000000002",
  membershipId: "e0000000-0000-4000-8000-000000000002",
  actorType: "HUMAN",
} as unknown as ActorContext;
const COMPANY = "f0000000-0000-4000-8000-000000000001";

function scope(
  actor: ActorContext,
  overrides: Partial<ContextCacheScope> = {},
): ContextCacheScope {
  return {
    actor,
    authzEpoch: EPOCH_1,
    kind: "tierA.snapshot",
    sensitivity: "CONFIDENTIAL",
    subject: { type: "COMPANY", id: COMPANY, accessEpoch: SUBJECT_EPOCH },
    policyVersion: "firewall.v3",
    ...overrides,
  };
}

describe("context cache keys (K-security §2)", () => {
  it("differ on every isolation dimension", () => {
    const base = contextCacheKey(scope(FOUNDER));
    const variants = [
      scope(INVESTOR),
      scope({ ...FOUNDER, tenantId: INVESTOR.tenantId }),
      scope({
        ...FOUNDER,
        organisationId: INVESTOR.organisationId,
        membershipId: INVESTOR.membershipId,
      }),
      scope(FOUNDER, { authzEpoch: EPOCH_2 }),
      scope(FOUNDER, { sensitivity: "HIGHLY_CONFIDENTIAL" }),
      scope(FOUNDER, { kind: "live.package" }),
      scope(FOUNDER, {
        subject: { type: "COMPANY", id: COMPANY, accessEpoch: "b".repeat(32) },
      }),
      scope(FOUNDER, { subject: undefined }),
      scope(FOUNDER, { policyVersion: "firewall.v4" }),
    ].map(contextCacheKey);
    expect(new Set([base, ...variants]).size).toBe(variants.length + 1);
  });

  it("cannot be made to collide by moving text between fields", () => {
    const a = contextCacheKey(
      scope(FOUNDER, {
        subject: { type: "COMPANY", id: "x:y", accessEpoch: SUBJECT_EPOCH },
      }),
    );
    const b = contextCacheKey(
      scope(FOUNDER, {
        subject: { type: "COMPANY", id: "x", accessEpoch: SUBJECT_EPOCH },
        policyVersion: "y:firewall.v3",
      }),
    );
    expect(a).not.toBe(b);
  });

  it("names the kind but never the actor in clear", () => {
    const key = contextCacheKey(scope(FOUNDER));
    expect(key.startsWith("ctx:v1:tierA.snapshot:")).toBe(true);
    expect(key).not.toContain(FOUNDER.userId);
    expect(key).not.toContain(FOUNDER.tenantId);
  });

  it("refuses a scope without an epoch, or an organisation without its membership", () => {
    expect(() => contextCacheKey(scope(FOUNDER, { authzEpoch: "" }))).toThrow(
      ContextCacheScopeError,
    );
    expect(() =>
      contextCacheKey(scope({ ...FOUNDER, membershipId: undefined })),
    ).toThrow(ContextCacheScopeError);
  });
});

describe("the scoped cache (K-security §3)", () => {
  it("loads once for concurrent misses (single-flight)", async () => {
    const cache = createContextCache<string>();
    let loads = 0;
    const load = () => {
      loads += 1;
      return Promise.resolve("snapshot");
    };
    const [a, b] = await Promise.all([
      cache.getOrLoad(scope(FOUNDER), load),
      cache.getOrLoad(scope(FOUNDER), load),
    ]);
    expect([a, b, loads]).toEqual(["snapshot", "snapshot", 1]);
    expect(cache.get(scope(FOUNDER))).toBe("snapshot");
  });

  it("drops an actor's entries at once on logout or a role change", async () => {
    const cache = createContextCache<string>();
    await cache.getOrLoad(scope(FOUNDER), () => Promise.resolve("f"));
    await cache.getOrLoad(scope(INVESTOR), () => Promise.resolve("i"));
    expect(cache.invalidateActor(FOUNDER.userId)).toBe(1);
    expect(cache.get(scope(FOUNDER))).toBeUndefined();
    expect(cache.get(scope(INVESTOR))).toBe("i");
  });

  it("drops entries about a subject when its visibility changes, for every viewer", async () => {
    const cache = createContextCache<string>();
    await cache.getOrLoad(scope(FOUNDER), () => Promise.resolve("f"));
    await cache.getOrLoad(scope(INVESTOR), () => Promise.resolve("i"));
    expect(cache.invalidateSubject("COMPANY", COMPANY)).toBe(2);
    expect(cache.size()).toBe(0);
  });

  it("drops an organisation's entries on an org switch or team change", async () => {
    const cache = createContextCache<string>();
    await cache.getOrLoad(scope(FOUNDER), () => Promise.resolve("f"));
    expect(cache.invalidateOrganisation(FOUNDER.organisationId ?? "")).toBe(1);
  });

  it("never stores a load that was in flight when the actor was invalidated", async () => {
    const cache = createContextCache<string>();
    let release: (value: string) => void = () => undefined;
    const pending = cache.getOrLoad(
      scope(FOUNDER),
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    cache.invalidateActor(FOUNDER.userId); // the revocation lands mid-load
    release("the old view");
    await expect(pending).resolves.toBe("the old view");
    expect(cache.get(scope(FOUNDER))).toBeUndefined();
  });

  it("expires entries", async () => {
    let now = 0;
    const cache = createContextCache<string>({ ttlMs: 1_000, now: () => now });
    await cache.getOrLoad(scope(FOUNDER), () => Promise.resolve("f"));
    now = 1_000;
    expect(cache.get(scope(FOUNDER))).toBeUndefined();
  });
});

describe("K Test 6: founder-private context never reaches an investor", () => {
  const MARKER = "FOUNDER-PRIVATE-RUNWAY-7-MONTHS";

  /**
   * The world the cached layer sits on: who may see the founder-private
   * note, and the access fingerprints the database would return.
   */
  function world() {
    const state = { founderMayRead: true, founderEpoch: EPOCH_1 };
    const authority = {
      epochOf: (actor: ActorContext) =>
        actor.userId === FOUNDER.userId ? state.founderEpoch : EPOCH_1,
      contextFor: (actor: ActorContext) =>
        actor.userId === FOUNDER.userId && state.founderMayRead
          ? `snapshot: ${MARKER}`
          : "snapshot: public facts only",
    };
    return { state, authority };
  }

  it("holds for the scoped cache (Tier A shape)", async () => {
    const { state, authority } = world();
    const cache = createContextCache<string>();
    const scopeFor = (actor: ActorContext) =>
      scope(actor, { authzEpoch: authority.epochOf(actor) });
    const layer: IsolationLayer = {
      name: "createContextCache",
      warm: async (actor) => {
        await cache.getOrLoad(scopeFor(actor), () =>
          Promise.resolve(authority.contextFor(actor)),
        );
      },
      read: (actor) =>
        cache.getOrLoad(scopeFor(actor), () =>
          Promise.resolve(authority.contextFor(actor)),
        ),
      revokeFounder: () => {
        // The grant is revoked: the database's fingerprint moves. No
        // explicit invalidation is sent, to prove the key alone suffices.
        state.founderMayRead = false;
        state.founderEpoch = EPOCH_2;
        return Promise.resolve();
      },
    };
    await expect(
      checkContextIsolation(layer, {
        founder: FOUNDER,
        investor: INVESTOR,
        marker: MARKER,
      }),
    ).resolves.toEqual([]);
  });

  it("catches a cache keyed by subject alone (the check has teeth)", async () => {
    const { state, authority } = world();
    const naive = new Map<string, string>();
    const layer: IsolationLayer = {
      name: "keyed-by-subject",
      warm: (actor) => {
        if (!naive.has(COMPANY))
          naive.set(COMPANY, authority.contextFor(actor));
        return Promise.resolve();
      },
      read: (actor) =>
        Promise.resolve(naive.get(COMPANY) ?? authority.contextFor(actor)),
      revokeFounder: () => {
        state.founderMayRead = false;
        return Promise.resolve();
      },
    };
    const violations = await checkContextIsolation(layer, {
      founder: FOUNDER,
      investor: INVESTOR,
      marker: MARKER,
    });
    expect(violations).toContain(
      "keyed-by-subject: an investor without access obtained founder-private context",
    );
    expect(violations).toContain(
      "keyed-by-subject: founder-private context survived the revocation of the founder's access",
    );
  });
});
