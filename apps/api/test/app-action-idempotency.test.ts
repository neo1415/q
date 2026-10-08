import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import {
  RENAME_DOCUMENT,
  type DocumentChangePort,
  type ManagedDocument,
} from "@capital-q/app-actions";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import {
  createActionReplayGuard,
  idempotencyKeyOf,
} from "../src/http/app-action-replay.js";
import { registerAppActionRoutes } from "../src/http/app-actions.js";

/**
 * RECOVERY-2026-10 (lead security fix 1): a generated action route runs
 * its service call once per Idempotency-Key -- a client retry with the
 * same key replays the first result -- and a key reused for a different
 * input is refused, never run. The real rename declaration runs against
 * an in-memory documents service, and each test reads the service's
 * state back: one change, one new version.
 */

const ACTOR: ActorContext = {
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
const OTHER: ActorContext = {
  ...ACTOR,
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000002"),
};
const DOC = "f0000000-0000-4000-8000-000000000001";

function documents(fail = false) {
  const state: { doc: ManagedDocument; runs: string[] } = {
    doc: { id: DOC, title: "Deck v1", status: "ACTIVE", version: 1 },
    runs: [],
  };
  const port: DocumentChangePort = {
    getDocument: () => Promise.resolve(state.doc),
    changeDocument: async (command) => {
      state.runs.push(command.change.kind);
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (fail) throw new Error("service down");
      if (command.change.kind === "RENAME") {
        state.doc = {
          ...state.doc,
          title: command.change.title,
          version: state.doc.version + 1,
        };
      }
      return state.doc;
    },
  };
  return { state, port };
}

function server(as: () => ActorContext, port: DocumentChangePort) {
  const app = Fastify();
  registerAppActionRoutes(app, {
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
        Promise.resolve({ status: "RESOLVED", context: as() }),
    },
    ports: { documentChanges: port },
    actions: [RENAME_DOCUMENT],
    replay: createActionReplayGuard(),
  });
  return app;
}

const rename = (
  app: ReturnType<typeof server>,
  key: string | undefined,
  title = "Seed deck",
) =>
  app.inject({
    method: "PATCH",
    url: `/v1/documents/${DOC}`,
    headers: {
      authorization: "Bearer token",
      ...(key === undefined ? {} : { "idempotency-key": key }),
    },
    payload: { title },
  });

describe("an action runs once per Idempotency-Key (RECOVERY security fix)", () => {
  it("a retry with the same key replays the first result without running again", async () => {
    const { state, port } = documents();
    const app = server(() => ACTOR, port);
    const first = await rename(app, "intent-0001-aaaa");
    const retry = await rename(app, "intent-0001-aaaa");
    expect(first.statusCode).toBe(200);
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual(first.json());
    expect(retry.headers["idempotent-replayed"]).toBe("true");
    // The service's state, read back: one rename, one new version.
    expect(state.runs).toEqual(["RENAME"]);
    expect(state.doc).toMatchObject({ title: "Seed deck", version: 2 });
  });

  it("a retry while the first is still running waits for it, never runs twice", async () => {
    const { state, port } = documents();
    const app = server(() => ACTOR, port);
    const [one, two] = await Promise.all([
      rename(app, "intent-0002-bbbb"),
      rename(app, "intent-0002-bbbb"),
    ]);
    expect([one.statusCode, two.statusCode]).toEqual([200, 200]);
    expect(state.runs).toHaveLength(1);
    expect(state.doc.version).toBe(2);
  });

  it("the same key with a different input is a conflict, not a second run", async () => {
    const { state, port } = documents();
    const app = server(() => ACTOR, port);
    await rename(app, "intent-0003-cccc", "Seed deck");
    const reused = await rename(app, "intent-0003-cccc", "Board pack");
    expect(reused.statusCode).toBe(409);
    expect(state.runs).toHaveLength(1);
    expect(state.doc.title).toBe("Seed deck");
  });

  it("keys are per person: another person's same key is their own intent", async () => {
    const { state, port } = documents();
    let who = ACTOR;
    const app = server(() => who, port);
    await rename(app, "intent-0004-dddd");
    who = OTHER;
    await rename(app, "intent-0004-dddd");
    expect(state.runs).toHaveLength(2);
  });

  it("a failed run is not replayed: trying again runs again", async () => {
    const { state, port } = documents(true);
    const app = server(() => ACTOR, port);
    const first = await rename(app, "intent-0005-eeee");
    expect(first.statusCode).toBe(500);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await rename(app, "intent-0005-eeee");
    expect(state.runs).toHaveLength(2);
  });

  it("a malformed key is refused; no key runs each time, as before", async () => {
    const { state, port } = documents();
    const app = server(() => ACTOR, port);
    const bad = await rename(app, "short");
    expect(bad.statusCode).toBe(422);
    expect(state.runs).toHaveLength(0);
    await rename(app, undefined);
    await rename(app, undefined);
    expect(state.runs).toHaveLength(2);
    expect(idempotencyKeyOf({ "idempotency-key": "has space here" })).toEqual({
      kind: "INVALID",
    });
    expect(idempotencyKeyOf({ "idempotency-key": "x".repeat(256) })).toEqual({
      kind: "INVALID",
    });
  });
});
