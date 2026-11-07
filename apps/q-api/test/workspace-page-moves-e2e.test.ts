import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseQApiConfig } from "@capital-q/config/q-api";
import type { QScreenContext, QSubjectRef } from "@capital-q/contracts";
import { createQPageMoves } from "@capital-q/model-gateway/q";
import { createContextFirewall } from "@capital-q/q-firewall";
import {
  createQRuntimeService,
  type QAnswerRequest,
  type QOrchestrator,
  type QRunRecord,
  type QRuntimeDependencies,
} from "@capital-q/q-runtime";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import { createApp } from "../src/app.js";

/**
 * Owner live test, 7 Nov 2026 (R1): 0 of 36 production runs carried
 * screen.workspace, so Q's page-move decision (D78) never ran. This follows
 * one labs person's question end to end through the real seams -- q-api's
 * workspace gate and run route, the run as the runtime records it, the
 * Context Firewall's plan of it, and the answer path's page moves -- and
 * asserts the decision starts. A person who did not opt in never reaches it.
 */

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

const token = (metadata: Record<string, unknown>): string => {
  const part = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `Bearer ${part({ alg: "ES256" })}.${part({
    sub: "a0000000-0000-4000-8000-000000000001",
    user_metadata: metadata,
  })}.signature`;
};

const WORKSPACE = { qPane: "open", pagePane: "open", at: "/home" } as const;

/** The runtime's own run creation, over in-memory rows. */
function runtimeOverMemory() {
  const runs: QRunRecord[] = [];
  const dependencies = {
    sql: {} as never,
    transactions: { run: (work: (tx: unknown) => unknown) => work({}) },
    subjects: {
      supports: () => true,
      resolve: (_actor: ActorContext, ref: QSubjectRef) =>
        Promise.resolve({
          ref,
          tenantId: CONTEXT.tenantId,
          organisationId: null,
        }),
    },
    repositories: {
      runCreationRequests: {
        lock: () => Promise.resolve(),
        find: () => Promise.resolve(null),
        record: () => Promise.resolve(),
      },
      conversations: {
        insert: (_tx: unknown, input: object) =>
          Promise.resolve({ id: randomUUID(), ...input }),
        setSubjects: () => Promise.resolve(),
        findForOwner: () => Promise.resolve(null),
      },
      runs: {
        insert: (_tx: unknown, input: object) => {
          const run = {
            id: randomUUID(),
            tenantId: CONTEXT.tenantId,
            actorUserId: CONTEXT.userId,
            status: "RECEIVED",
            createdAt: "2026-11-07T16:00:00.000Z",
            ...input,
          } as unknown as QRunRecord;
          runs.push(run);
          return Promise.resolve(run);
        },
        allocateEventSequence: () => Promise.resolve(1),
      },
      messages: {
        insert: (_tx: unknown, input: object) =>
          Promise.resolve({ id: randomUUID(), ...input }),
      },
      runEvents: {
        append: (_tx: unknown, input: unknown) => Promise.resolve(input),
      },
    },
  } as unknown as QRuntimeDependencies;
  return { service: createQRuntimeService(dependencies), runs };
}

describe("a labs person's question reaches Q's page-move decision (R1, end to end)", () => {
  const before = process.env["CQ_WORKSPACE_MODE"];
  beforeEach(() => {
    process.env["CQ_WORKSPACE_MODE"] = "labs";
  });
  afterEach(() => {
    if (before === undefined) delete process.env["CQ_WORKSPACE_MODE"];
    else process.env["CQ_WORKSPACE_MODE"] = before;
  });

  async function ask(authorization: string) {
    const { service, runs } = runtimeOverMemory();
    const firewall = createContextFirewall({
      authorization: {} as never,
      disclosure: {} as never,
      resolvers: {} as never,
      relationshipParties: {} as never,
      documents: {} as never,
      capital: {} as never,
      clock: { now: () => "2026-11-07T16:00:00.000Z" },
    });
    const decided: string[] = [];
    const pageMoves = createQPageMoves({
      decider: {
        decide: (input) => {
          decided.push(input.utterance);
          return Promise.resolve(null);
        },
      },
      config: { movesAllowed: true },
    });
    let started: Promise<void> = Promise.resolve();
    // The orchestrator's part, in miniature: plan the stored run through
    // the real firewall, then start the answer path's page moves with it.
    const orchestrator: QOrchestrator = {
      start: (input) => {
        started = (async () => {
          const run = runs.find((r) => r.id === input.runId);
          if (run === undefined) throw new Error("run not stored");
          const decision = await firewall.plan({
            actor: input.actor,
            runId: run.id,
            correlationId: run.correlationId,
            capability: run.capability,
            subjects: run.subjects,
            screen: run.screen ?? null,
          });
          if (decision.outcome !== "AUTHORISED")
            throw new Error(`firewall: ${decision.reason}`);
          const request = {
            runId: run.id,
            tenantId: run.tenantId,
            actorUserId: run.actorUserId,
            correlationId: run.correlationId,
            plan: decision.plan,
          } as unknown as QAnswerRequest;
          pageMoves.start(request, {
            utterance: "show me tensorgate's pitch deck",
            recentTurns: [],
            pageText: null,
          });
          await pageMoves.settle(request, []);
        })();
        return Promise.resolve({ runId: input.runId } as never);
      },
      resume: () => Promise.reject(new Error("not under test")),
      cancel: () => Promise.reject(new Error("not under test")),
    };
    const { app } = createApp(
      parseQApiConfig({ NODE_ENV: "test" }),
      {
        authenticator: {
          authenticate: () =>
            Promise.resolve({
              authUserId: AuthUserIdSchema.parse(
                "a0000000-0000-4000-8000-000000000001",
              ),
            }),
        },
        resolver: {
          resolveHumanContext: () =>
            Promise.resolve({ status: "RESOLVED", context: CONTEXT }),
        },
      },
      {
        qRuntime: service,
        orchestration: { orchestrator, autostart: true },
      },
    );
    const screen: QScreenContext = {
      route: "HOME",
      surface: "DOCK",
      workspace: WORKSPACE,
    };
    const response = await app.inject({
      method: "POST",
      url: "/v1/q/runs",
      headers: { authorization, "idempotency-key": randomUUID() },
      payload: {
        capability: "ANSWER",
        message: { text: "show me tensorgate's pitch deck" },
        modality: "TEXT",
        screen,
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    await started;
    await app.close();
    return { status: response.statusCode, runs, decided };
  }

  it("opted in: the run keeps screen.workspace and the decision starts", async () => {
    const out = await ask(token({ cq_workspace: "on" }));
    expect(out.status).toBe(202);
    expect(out.runs[0]?.screen?.workspace).toEqual(WORKSPACE);
    expect(out.decided.length).toBeGreaterThan(0);
  });

  it("not opted in: the hint is dropped at q-api and the decision never runs", async () => {
    const out = await ask(token({}));
    expect(out.status).toBe(202);
    expect(out.runs[0]?.screen?.workspace).toBeUndefined();
    expect(out.decided).toEqual([]);
  });
});
