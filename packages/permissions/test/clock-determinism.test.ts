import { describe, expect, it } from "vitest";

import type { AuthorizationService } from "@capital-q/security";

import {
  createDisclosurePolicyManager,
  type DisclosurePolicyManagerDependencies,
} from "../src/application/policy-manager.js";
import type {
  DisclosurePolicyRepository,
  NewDisclosurePolicy,
} from "../src/application/ports.js";
import type { UtcTimestamp } from "@capital-q/contracts";
import {
  DisclosurePolicyIdSchema,
  isPolicyActiveAt,
  policyStatusAt,
  type DisclosurePolicy,
} from "../src/contracts/index.js";

/**
 * One clock per policy lifecycle (CQ-REC-002R Part B).
 *
 * A disclosure policy's creation, expiry validation, revocation and status
 * evaluation all read the injected DisclosureClock. PostgreSQL's `now()`
 * is not consulted for any of them, so the host clock being ahead of or
 * behind the database changes nothing: `revoked_at >= created_at` and
 * `expires_at > created_at` are properties of one monotonic clock, not of
 * two machines agreeing. No sleeps, no tolerance windows.
 */

const TENANT = "11111111-0000-4000-8000-000000000011";
const ORG = "11111111-0000-4000-8000-000000000012";
const USER = "11111111-0000-4000-8000-000000000014";
const RECIPIENT_ORG = "22222222-0000-4000-8000-000000000022";
const RESOURCE = {
  type: "company",
  id: "33333333-0000-4000-8000-000000000033",
} as const;
const T0 = "2026-09-18T12:00:00.000Z";
const T1 = "2026-09-18T12:00:00.250Z";

const ACTOR = {
  userId: USER,
  tenantId: TENANT,
  organisationId: ORG,
  membershipId: "11111111-0000-4000-8000-000000000015",
  actorType: "HUMAN",
} as unknown as DisclosurePolicyManagerDependencies["clock"] extends never
  ? never
  : Parameters<
      ReturnType<typeof createDisclosurePolicyManager>["grant"]
    >[0]["actor"];

function policyFrom(input: NewDisclosurePolicy): DisclosurePolicy {
  return {
    id: input.id,
    tenantId: input.tenantId,
    ownerUserId: input.ownerUserId,
    ownerOrganisationId: input.ownerOrganisationId,
    resource: input.resource,
    scopeType: input.scopeType,
    recipient: input.recipient,
    accessLevel: input.accessLevel,
    expiresAt: input.expiresAt,
    createdByUserId: input.createdByUserId,
    createdAt: input.createdAt,
    revokedAt: null,
  };
}

/** A repository that records what it was asked to stamp and by which instant. */
function fakeRepository(state: {
  policy: DisclosurePolicy | null;
  stamps: string[];
}) {
  const repository: DisclosurePolicyRepository = {
    insert: (_tx: unknown, input: NewDisclosurePolicy) => {
      state.stamps.push(`created:${input.createdAt}`);
      state.policy = policyFrom(input);
      return Promise.resolve(state.policy);
    },
    findById: (_e, id) =>
      Promise.resolve(state.policy?.id === id ? state.policy : null),
    lockById: (_tx, id) =>
      Promise.resolve(state.policy?.id === id ? state.policy : null),
    lockResource: () => Promise.resolve(),
    findUnrevokedForResource: () =>
      Promise.resolve(
        state.policy === null || state.policy.revokedAt !== null
          ? []
          : [state.policy],
      ),
    findUnrevokedForResources: () => Promise.resolve([]),
    findAllForResource: () =>
      Promise.resolve(state.policy === null ? [] : [state.policy]),
    revoke: (_tx: unknown, id: string, revokedAt: UtcTimestamp) => {
      state.stamps.push(`revoked:${revokedAt}`);
      if (
        state.policy === null ||
        state.policy.id !== id ||
        state.policy.revokedAt !== null
      ) {
        return Promise.resolve(null);
      }
      state.policy = { ...state.policy, revokedAt };
      return Promise.resolve(state.policy);
    },
  };
  return repository;
}

function manager(
  clock: { now: () => string },
  state: { policy: DisclosurePolicy | null; stamps: string[] },
) {
  const tx = { sql: {} } as unknown as Parameters<
    DisclosurePolicyManagerDependencies["transactions"]["run"]
  >[0] extends (tx: infer T) => unknown
    ? T
    : never;
  const dependencies = {
    sql: {} as DisclosurePolicyManagerDependencies["sql"],
    transactions: { run: (work) => work(tx) },
    authorization: {
      requireCapability: () => Promise.resolve(),
    } as unknown as AuthorizationService,
    outbox: {
      enqueue: () => Promise.resolve(),
    } as unknown as DisclosurePolicyManagerDependencies["outbox"],
    audit: {
      record: () => Promise.resolve(),
    } as unknown as DisclosurePolicyManagerDependencies["audit"],
    clock: { now: () => clock.now() },
    policies: fakeRepository(state),
    resolvers: {
      has: () => true,
      types: () => ["company"],
      resolve: () =>
        Promise.resolve({
          resource: RESOURCE,
          tenantId: TENANT,
          ownerOrganisationId: ORG,
          intrinsicScope: "organisation_private",
        }),
    } as unknown as DisclosurePolicyManagerDependencies["resolvers"],
    relationshipParties: {
      resolve: () => Promise.resolve(null),
    } as unknown as DisclosurePolicyManagerDependencies["relationshipParties"],
  } satisfies DisclosurePolicyManagerDependencies;
  return createDisclosurePolicyManager(dependencies);
}

const grantCommand = (correlation: string) => ({
  actor: ACTOR,
  disclosurePolicyId: DisclosurePolicyIdSchema.parse(
    "44444444-0000-4000-8000-000000000044",
  ),
  resource: RESOURCE,
  scopeType: "specifically_shared" as const,
  recipient: { type: "ORGANISATION" as const, id: RECIPIENT_ORG },
  accessLevel: "view" as const,
  correlationId: `cor_${correlation}`,
});

describe("policy status at the boundary (pure)", () => {
  const base: Pick<DisclosurePolicy, "expiresAt" | "revokedAt"> = {
    expiresAt: null,
    revokedAt: null,
  };

  it("active before revocation; REVOKED at the boundary and after it", () => {
    expect(policyStatusAt({ ...base, revokedAt: T1 }, T0)).toBe("ACTIVE");
    expect(policyStatusAt({ ...base, revokedAt: T1 }, T1)).toBe("REVOKED");
    expect(policyStatusAt({ ...base, revokedAt: T0 }, T1)).toBe("REVOKED");
    expect(isPolicyActiveAt({ ...base, revokedAt: T1 }, T1)).toBe(false);
  });

  it("EXPIRED at the boundary, never a grace period after it", () => {
    expect(policyStatusAt({ ...base, expiresAt: T1 }, T0)).toBe("ACTIVE");
    expect(policyStatusAt({ ...base, expiresAt: T1 }, T1)).toBe("EXPIRED");
    expect(policyStatusAt({ ...base, expiresAt: T0 }, T1)).toBe("EXPIRED");
  });
});

describe("one clock per policy lifecycle (manager)", () => {
  it.each([
    ["host ahead of the database", "2026-09-18T12:00:03.000Z"],
    ["host behind the database", "2026-09-18T11:59:57.000Z"],
  ])(
    "%s: creation and revocation are both stamped from the injected clock, so revoked_at >= created_at holds",
    async (_label, databaseNow) => {
      // The database's own idea of now is deliberately never read.
      void databaseNow;
      let instant = T0;
      const clock = { now: () => instant };
      const state = {
        policy: null as DisclosurePolicy | null,
        stamps: [] as string[],
      };
      const m = manager(clock, state);

      const granted = await m.grant(
        grantCommand("11111111-1111-4111-8111-111111111111"),
      );
      expect(granted.outcome).toBe("CREATED");
      expect(state.policy?.createdAt).toBe(T0);

      instant = T1;
      const revoked = await m.revoke({
        actor: ACTOR,
        disclosurePolicyId: DisclosurePolicyIdSchema.parse(
          "44444444-0000-4000-8000-000000000044",
        ),
        correlationId: "cor_22222222-2222-4222-8222-222222222222",
      });
      expect(revoked.outcome).toBe("REVOKED");
      expect(state.stamps).toEqual([`created:${T0}`, `revoked:${T1}`]);
      expect(Date.parse(state.policy?.revokedAt ?? "")).toBeGreaterThanOrEqual(
        Date.parse(state.policy?.createdAt ?? ""),
      );
      // Evaluated with the same clock: revoked from the instant it was revoked.
      const final = state.policy;
      expect(final).not.toBeNull();
      if (final === null) throw new Error("policy vanished");
      expect(policyStatusAt(final, T1)).toBe("REVOKED");
      expect(policyStatusAt(final, T0)).toBe("ACTIVE");
    },
  );

  it("an expiry that is not after the grant instant is refused, on the same clock", async () => {
    const clock = { now: () => T1 };
    const state = {
      policy: null as DisclosurePolicy | null,
      stamps: [] as string[],
    };
    const m = manager(clock, state);
    await expect(
      m.grant({
        ...grantCommand("33333333-3333-4333-8333-333333333333"),
        expiresAt: T0,
      }),
    ).rejects.toThrow();
    expect(state.stamps).toEqual([]);
  });
});
