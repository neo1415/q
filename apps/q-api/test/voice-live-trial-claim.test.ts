import { describe, expect, it, vi } from "vitest";

import {
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import { createPostgresLiveTrialClaims } from "../src/voice/live/trial-claim.js";

const actor: ActorContext = {
  tenantId: TenantIdSchema.parse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
  userId: UserIdSchema.parse("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
  actorType: "HUMAN",
};

function world(result: unknown) {
  // Only the tagged query surface is used; no driver lifecycle or helpers.
  const query = vi.fn<Parameters<typeof createPostgresLiveTrialClaims>[0]>();
  query.mockImplementation(() => Promise.resolve(result));
  return {
    query,
    store: createPostgresLiveTrialClaims(query),
  };
}

describe("durable voice trial claim adapter", () => {
  it("uses actor ownership and the database's global remaining allowance", async () => {
    const { query, store } = world([{ remaining: "10.00" }]);
    const claim = await store.claim({
      actor,
      allowanceSeconds: 300,
      voiceSessionId: "line",
    });
    expect(claim?.remainingSeconds).toBe(10);
    expect(claim?.claimId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(query.mock.calls[0]?.slice(1, 3)).toEqual([
      actor.tenantId,
      actor.userId,
    ]);
  });
  it("does not create a session when another instance holds the account", async () => {
    const { store } = world([{ remaining: null }]);
    expect(
      await store.claim({
        actor,
        allowanceSeconds: 300,
        voiceSessionId: "line",
      }),
    ).toBeNull();
  });
  it.each([0, 301, NaN, Infinity, 1.5])(
    "refuses invalid allowance %s before SQL",
    async (allowanceSeconds) => {
      const { query, store } = world([]);
      await expect(
        store.claim({ actor, allowanceSeconds, voiceSessionId: "line" }),
      ).rejects.toThrow();
      expect(query).not.toHaveBeenCalled();
    },
  );
  it.each(["bad", "0", "301"])(
    "fails closed for malformed database result %s",
    async (remaining) => {
      const { store } = world([{ remaining }]);
      await expect(
        store.claim({ actor, allowanceSeconds: 300, voiceSessionId: "line" }),
      ).rejects.toThrow();
    },
  );
  it("never releases without durable database confirmation", async () => {
    const { query, store } = world([{ released: false }]);
    const input = {
      actor,
      claimId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      providerSessionId: "session",
      finalSeconds: 8,
      providerTerminated: true as const,
    };
    expect(await store.release(input)).toBe(false);
    expect(query.mock.calls[0]?.slice(1)).toEqual([
      actor.tenantId,
      actor.userId,
      input.claimId,
      "session",
      8,
      true,
    ]);
  });
  it("refuses a null-provider release that claims consumed speech", async () => {
    const { query, store } = world([{ released: true }]);
    expect(
      await store.release({
        actor,
        claimId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        providerSessionId: null,
        finalSeconds: 8,
        providerTerminated: true,
      }),
    ).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });
});
