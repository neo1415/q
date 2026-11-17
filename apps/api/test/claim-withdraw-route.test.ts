import { randomUUID } from "node:crypto";

import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { WITHDRAW_CLAIM, type AppActionPorts } from "@capital-q/app-actions";
import { WithdrawClaimResponseSchema } from "@capital-q/contracts";
import { ClaimNotFoundError, type Claim } from "@capital-q/evidence";
import { createLogger } from "@capital-q/observability";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import { createActionReplayGuard } from "../src/http/app-action-replay.js";
import { registerAppActionRoutes } from "../src/http/app-actions.js";
import { registerProblemHandling } from "../src/http/problem-handler.js";

/**
 * `POST /v1/claims/:claimId/withdraw` (hygiene audit 2026-11-16 §4.2):
 * the real declaration against an in-memory Evidence service that keeps
 * the real one's fence -- a claim is read only in the actor's tenant and
 * only by the organisation that owns its subject. Each test reads the
 * service's state back.
 */

const TENANT = "c0000000-0000-4000-8000-000000000001";
const ORG = "d0000000-0000-4000-8000-000000000001";
const COMPANY = "a0000000-0000-4000-8000-000000000001";

const actor = (overrides: {
  readonly tenantId?: string;
  readonly organisationId?: string | null;
  readonly userId?: string;
}): ActorContext => ({
  userId: UserIdSchema.parse(
    overrides.userId ?? "b0000000-0000-4000-8000-000000000001",
  ),
  tenantId: TenantIdSchema.parse(overrides.tenantId ?? TENANT),
  ...(overrides.organisationId === null
    ? {}
    : {
        organisationId: OrganisationIdSchema.parse(
          overrides.organisationId ?? ORG,
        ),
        membershipId: MembershipIdSchema.parse(
          "e0000000-0000-4000-8000-000000000001",
        ),
      }),
  actorType: "HUMAN",
});

const FOUNDER = actor({});
/** Another company's founder, in their own tenant. */
const OTHER_TENANT = actor({
  tenantId: "c0000000-0000-4000-8000-000000000002",
  organisationId: "d0000000-0000-4000-8000-000000000002",
});
/** Signed in, in this tenant, but no member of the owning organisation. */
const NON_MEMBER = actor({ organisationId: null });
/** An investor firm's member, in the investor's own tenant. */
const INVESTOR = actor({
  tenantId: "c0000000-0000-4000-8000-000000000003",
  organisationId: "d0000000-0000-4000-8000-000000000003",
  userId: "b0000000-0000-4000-8000-000000000003",
});

type Revision = {
  readonly number: number;
  readonly lifecycle: string;
  readonly reason: string | null;
};

function evidence() {
  const id = randomUUID();
  let current = {
    id,
    tenantId: TENANT,
    subjectType: "COMPANY",
    subjectId: COMPANY,
    claimKey: "financial.mrr",
    statement: "The company's MRR of USD 42,000 for October 2026.",
    structuredValue: null,
    lifecycleStatus: "CURRENT",
    currentRevisionNumber: 1,
  } as unknown as Claim;
  const revisions: Revision[] = [
    { number: 1, lifecycle: "CURRENT", reason: null },
  ];
  const visible = (who: ActorContext, claimId: string) => {
    if (
      claimId !== id ||
      who.tenantId !== TENANT ||
      who.organisationId !== ORG
    ) {
      throw new ClaimNotFoundError();
    }
    return current;
  };
  const port: NonNullable<AppActionPorts["claimWithdrawals"]> = {
    getClaim: (query) =>
      Promise.resolve().then(() => ({
        claim: visible(query.actor, query.claimId),
        revisions: [],
        evidence: [],
      })),
    reviseClaim: (command) =>
      Promise.resolve().then(() => {
        const claim = visible(command.actor, command.input.claimId);
        current = {
          ...claim,
          lifecycleStatus:
            command.input.lifecycleStatus ?? claim.lifecycleStatus,
          currentRevisionNumber: claim.currentRevisionNumber + 1,
        };
        revisions.push({
          number: current.currentRevisionNumber,
          lifecycle: current.lifecycleStatus,
          reason: command.input.changeReason,
        });
        return current;
      }),
    listClaims: () => Promise.resolve([current]),
  };
  return {
    id,
    port,
    revisions,
    state: () => current,
  };
}

function server(
  as: ActorContext,
  port: NonNullable<AppActionPorts["claimWithdrawals"]>,
  extra: Partial<AppActionPorts> = {},
) {
  const app = Fastify();
  registerProblemHandling(
    app,
    createLogger(
      { serviceName: "api-test", environment: "test" },
      { level: "silent" },
    ),
  );
  registerAppActionRoutes(app, {
    authenticator: {
      authenticate: () =>
        Promise.resolve({
          authUserId: AuthUserIdSchema.parse(
            "a0000000-0000-4000-8000-000000000009",
          ),
        }),
    },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve({ status: "RESOLVED", context: as }),
    },
    ports: { claimWithdrawals: port, ...extra },
    actions: [WITHDRAW_CLAIM],
    replay: createActionReplayGuard(),
  });
  return app;
}

const withdraw = (
  app: ReturnType<typeof server>,
  claimId: string,
  key: string | undefined,
  payload: unknown = { reason: "Its only evidence was an archived QA deck." },
) =>
  app.inject({
    method: "POST",
    url: `/v1/claims/${claimId}/withdraw`,
    headers: {
      authorization: "Bearer token",
      ...(key === undefined ? {} : { "idempotency-key": key }),
    },
    payload: payload as Record<string, unknown>,
  });

describe("a founder withdraws their company's claim", () => {
  it("answers WITHDRAWN and leaves a SUPERSEDED revision with the reason, history kept", async () => {
    const store = evidence();
    const response = await withdraw(
      server(FOUNDER, store.port),
      store.id,
      "intent-withdraw-0001",
    );
    expect(response.statusCode).toBe(200);
    expect(WithdrawClaimResponseSchema.parse(response.json())).toEqual({
      claimId: store.id,
      outcome: "WITHDRAWN",
      lifecycleStatus: "SUPERSEDED",
      revisionNumber: 2,
    });
    expect(store.revisions).toEqual([
      { number: 1, lifecycle: "CURRENT", reason: null },
      {
        number: 2,
        lifecycle: "SUPERSEDED",
        reason:
          "Withdrawn by the company: Its only evidence was an archived QA deck.",
      },
    ]);
  });

  it("a retry with the same key replays; a fresh key finds it already withdrawn; one revision either way", async () => {
    const store = evidence();
    const app = server(FOUNDER, store.port);
    const first = await withdraw(app, store.id, "intent-withdraw-0002");
    const retry = await withdraw(app, store.id, "intent-withdraw-0002");
    expect(retry.statusCode).toBe(200);
    expect(retry.headers["idempotent-replayed"]).toBe("true");
    expect(retry.json()).toEqual(first.json());
    const again = await withdraw(app, store.id, "intent-withdraw-0003");
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ outcome: "ALREADY_WITHDRAWN" });
    expect(store.revisions).toHaveLength(2);
  });

  it("where the composition knows their company, a claim about another company is not theirs", async () => {
    const store = evidence();
    const response = await withdraw(
      server(FOUNDER, store.port, {
        ownCompanyId: () =>
          Promise.resolve("a0000000-0000-4000-8000-00000000000f"),
      }),
      store.id,
      "intent-withdraw-0004",
    );
    expect(response.statusCode).toBe(404);
    expect(store.state().lifecycleStatus).toBe("CURRENT");
  });

  it.each([
    ["another tenant's founder", OTHER_TENANT],
    ["a signed-in person with no membership of the company", NON_MEMBER],
    ["an investor", INVESTOR],
  ])("%s gets the one 404 and nothing is written", async (_who, as) => {
    const store = evidence();
    const response = await withdraw(
      server(as, store.port),
      store.id,
      "intent-withdraw-0005",
    );
    expect(response.statusCode).toBe(404);
    expect(store.revisions).toHaveLength(1);
    expect(store.state().lifecycleStatus).toBe("CURRENT");
  });

  it("an unknown claim id is the same 404", async () => {
    const store = evidence();
    const response = await withdraw(
      server(FOUNDER, store.port),
      randomUUID(),
      "intent-withdraw-0006",
    );
    expect(response.statusCode).toBe(404);
  });

  it("refuses a request without a reason, or with extra fields, as a problem, writing nothing", async () => {
    const store = evidence();
    const app = server(FOUNDER, store.port);
    const empty = await withdraw(app, store.id, "intent-withdraw-0007", {
      reason: "  ",
    });
    const extra = await withdraw(app, store.id, "intent-withdraw-0008", {
      reason: "Wrong.",
      lifecycleStatus: "CURRENT",
    });
    for (const response of [empty, extra]) {
      expect(response.statusCode).toBe(422);
      expect(response.headers["content-type"]).toContain(
        "application/problem+json",
      );
    }
    expect(store.revisions).toHaveLength(1);
  });
});
