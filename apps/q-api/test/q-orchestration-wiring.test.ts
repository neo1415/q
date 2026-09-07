import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { parseQApiConfig } from "@capital-q/config/q-api";
import type {
  QConversationMessage,
  QOrchestrator,
  QRunRecord,
  QRuntimeService,
} from "@capital-q/q-runtime";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
  type AuthenticatedPrincipal,
} from "@capital-q/security";

import { createApp } from "../src/app.js";

/**
 * The orchestration boundary at the HTTP layer (CQ-Q-003). What is proven:
 * a created run is handed to the orchestrator exactly once with the
 * server-resolved actor, a replayed retry is not, the boundary can be off,
 * an engine failure never changes the 202, and no route exists for
 * resuming — that is not a client operation yet.
 */

const PRINCIPAL: AuthenticatedPrincipal = {
  authUserId: AuthUserIdSchema.parse("a0000000-0000-4000-8000-000000000001"),
};
const CONTEXT: ActorContext = {
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000001"),
  tenantId: TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001"),
  organisationId: OrganisationIdSchema.parse(
    "d0000000-0000-4000-8000-000000000001",
  ),
  membershipId: MembershipIdSchema.parse(
    "e0000000-0000-4000-8000-000000000001",
  ),
  actorType: "HUMAN",
};

const RUN_ID = "f0000000-0000-4000-8000-000000000001";
const NOW = "2026-09-06T09:00:00.000Z";

const RUN = {
  id: RUN_ID,
  conversationId: "f0000000-0000-4000-8000-000000000002",
  status: "RECEIVED",
  createdAt: NOW,
} as unknown as QRunRecord;

function runtime(created: boolean): QRuntimeService {
  const notUnderTest = () => Promise.reject(new Error("not under test"));
  return {
    createRun: () =>
      Promise.resolve({
        run: RUN,
        conversation: {} as never,
        message: {} as unknown as QConversationMessage,
        created,
      }),
    getRun: notUnderTest,
    appendMessage: notUnderTest,
    cancelRun: notUnderTest,
  };
}

function orchestrator(behaviour: "resolve" | "reject") {
  const starts: unknown[] = [];
  const engine: QOrchestrator = {
    start: (input) => {
      starts.push(input);
      return behaviour === "resolve"
        ? Promise.resolve({
            runId: RUN_ID,
            status: "FAILED",
            createdAt: NOW,
          } as never)
        : Promise.reject(
            new Error("engine down: PRIVATE-Q-GRAPH-STATE-DO-NOT-EMIT"),
          );
    },
    resume: () => Promise.reject(new Error("not under test")),
    cancel: () => Promise.reject(new Error("not under test")),
  };
  return { engine, starts };
}

function buildApp(options: {
  readonly created: boolean;
  readonly orchestration?:
    { orchestrator: QOrchestrator; autostart: boolean } | undefined;
}): FastifyInstance {
  return createApp(
    parseQApiConfig({ NODE_ENV: "test" }),
    {
      authenticator: { authenticate: () => Promise.resolve(PRINCIPAL) },
      resolver: {
        resolveHumanContext: () =>
          Promise.resolve({ status: "RESOLVED", context: CONTEXT }),
      },
    },
    {
      qRuntime: runtime(options.created),
      orchestration: options.orchestration,
    },
  ).app;
}

const BODY = {
  capability: "INVESTIGATE",
  message: { text: "How much runway does Apex have?" },
  modality: "TEXT",
};

async function post(app: FastifyInstance) {
  return app.inject({
    method: "POST",
    url: "/v1/q/runs",
    headers: { "idempotency-key": "wiring-key-0001" },
    payload: BODY,
  });
}

/** Detached starts settle on a later tick; give them one. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("POST /v1/q/runs orchestration boundary", () => {
  it("starts orchestration once for a created run, with the resolved actor", async () => {
    const { engine, starts } = orchestrator("resolve");
    const app = buildApp({
      created: true,
      orchestration: { orchestrator: engine, autostart: true },
    });
    const response = await post(app);
    await settle();

    expect(response.statusCode).toBe(202);
    expect(response.json<{ status: string }>().status).toBe("RECEIVED");
    expect(starts).toHaveLength(1);
    const input = starts[0] as { actor: ActorContext; runId: string };
    expect(input.actor).toEqual(CONTEXT);
    expect(input.runId).toBe(RUN_ID);
    await app.close();
  });

  it("does not start orchestration for a replayed retry", async () => {
    const { engine, starts } = orchestrator("resolve");
    const app = buildApp({
      created: false,
      orchestration: { orchestrator: engine, autostart: true },
    });
    const response = await post(app);
    await settle();
    expect(response.statusCode).toBe(202);
    expect(starts).toHaveLength(0);
    await app.close();
  });

  it("does not start orchestration when the boundary is off or absent", async () => {
    const { engine, starts } = orchestrator("resolve");
    for (const orchestration of [
      { orchestrator: engine, autostart: false },
      undefined,
    ]) {
      const app = buildApp({ created: true, orchestration });
      const response = await post(app);
      await settle();
      expect(response.statusCode).toBe(202);
      await app.close();
    }
    expect(starts).toHaveLength(0);
  });

  it("keeps the 202 and the response clean when the engine rejects", async () => {
    const { engine, starts } = orchestrator("reject");
    const app = buildApp({
      created: true,
      orchestration: { orchestrator: engine, autostart: true },
    });
    const response = await post(app);
    await settle();
    expect(response.statusCode).toBe(202);
    expect(response.body).not.toContain("PRIVATE-Q-GRAPH-STATE-DO-NOT-EMIT");
    expect(response.body).not.toContain("engine down");
    expect(starts).toHaveLength(1);
    await app.close();
  });

  it("exposes no resume, thread or checkpoint route", async () => {
    const { engine } = orchestrator("resolve");
    const app = buildApp({
      created: true,
      orchestration: { orchestrator: engine, autostart: true },
    });
    for (const url of [
      `/v1/q/runs/${RUN_ID}/resume`,
      `/v1/q/runs/${RUN_ID}/state`,
      `/v1/q/threads/${RUN_ID}`,
      `/v1/q/checkpoints/${RUN_ID}`,
    ]) {
      const response = await app.inject({ method: "POST", url });
      expect(response.statusCode, url).toBe(404);
    }
    await app.close();
  });
});
