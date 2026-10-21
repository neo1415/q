import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import {
  AuditEventConflictError,
  type MaterialActionAuditInput,
} from "@capital-q/audit";
import { defineAppAction, type AppActionContext } from "@capital-q/app-actions";
import {
  CorrelationIdSchema,
  QCapitalObjectiveSubjectSchema,
  UuidSchema,
} from "@capital-q/contracts";
import { createOrganisationAdminService } from "@capital-q/organisations";
import { MemoryOrganisationAdminDb } from "@capital-q/organisations/testing";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  createAuthorizationService,
  type ActorContext,
} from "@capital-q/security";

import {
  createScreenActionAudit,
  screenActionAuditEntry,
  screenActionEventId,
} from "../src/http/app-action-audit.js";
import { registerAppActionRoutes } from "../src/http/app-actions.js";

/**
 * A person's consequential screen action is recorded once, at the one
 * place every generated app-action route runs (app-actions.ts), as that
 * person, under their own authority, for their active organisation; and
 * their admin then sees it in the organisation's activity feed.
 */

const TENANT = "00000000-0000-4000-8000-0000000000a3";
const ORG = "00000000-0000-4000-8000-0000000000a4";
const ADMIN = "00000000-0000-4000-8000-00000000d002";
const MEMBER = "00000000-0000-4000-8000-00000000d003";
const OBJECTIVE = "00000000-0000-4000-8000-0000000000d9";

const actorOf = (userId: string, membershipId: string): ActorContext => ({
  userId: UserIdSchema.parse(userId),
  tenantId: TenantIdSchema.parse(TENANT),
  organisationId: OrganisationIdSchema.parse(ORG),
  membershipId: MembershipIdSchema.parse(membershipId),
  actorType: "HUMAN",
});
const MEMBER_ACTOR = actorOf(MEMBER, "00000000-0000-4000-8000-0000000ed003");
const ADMIN_ACTOR = actorOf(ADMIN, "00000000-0000-4000-8000-0000000ed002");

function fakeAction(classification: "CONSEQUENTIAL" | "INSTANT") {
  let runs = 0;
  type In = { kind: "CAPITAL_OBJECTIVE"; capitalObjectiveId: string };
  const action = defineAppAction<In, In>({
    name: "capital.objective.change",
    area: "capital",
    classification,
    does: "Changes the raise (test double).",
    input: QCapitalObjectiveSubjectSchema,
    output: QCapitalObjectiveSubjectSchema,
    authorize: () => Promise.resolve({ ok: true as const }),
    run: (_ports, _context, input) => {
      runs += 1;
      return Promise.resolve(input);
    },
    targets: (input) => [input],
    card: () => ({ summary: "Change the raise", preview: "" }),
    done: () => "Done.",
    http: {
      method: "POST",
      path: "/v1/test/objectives/:objectiveId/change",
      fromRequest: (params) => ({
        kind: "CAPITAL_OBJECTIVE",
        capitalObjectiveId: params["objectiveId"],
      }),
      respond: (out) => out,
    },
  });
  return { action, runs: () => runs };
}

const context = (over: Partial<AppActionContext> = {}): AppActionContext => ({
  actor: MEMBER_ACTOR,
  idempotencyKey: "intent-0001",
  correlationId: CorrelationIdSchema.parse(
    "cor_00000000-0000-4000-8000-00000000cc01",
  ),
  surface: "SCREEN",
  ...over,
});

describe("screen action audit entry", () => {
  it("is the person, under their own authority, for their active organisation", () => {
    const { action } = fakeAction("CONSEQUENTIAL");
    const entry = screenActionAuditEntry(
      action,
      context(),
      { kind: "CAPITAL_OBJECTIVE", capitalObjectiveId: OBJECTIVE },
      true,
    );
    expect(entry).toMatchObject({
      actorType: "HUMAN",
      actorId: MEMBER,
      authorityUserId: MEMBER,
      organisationId: ORG,
      tenantId: TENANT,
      actionType: "app.capital.objective.change",
      resourceType: "capital_objective",
      resourceId: OBJECTIVE,
      outcome: "SUCCEEDED",
      metadata: { surface: "SCREEN" },
    });
    // The same intent is the same record; another intent is another.
    const again = screenActionAuditEntry(
      action,
      context(),
      { kind: "CAPITAL_OBJECTIVE", capitalObjectiveId: OBJECTIVE },
      true,
    );
    expect(again?.auditEventId).toBe(entry?.auditEventId);
    const other = screenActionAuditEntry(
      action,
      context({ idempotencyKey: "intent-0002" }),
      { kind: "CAPITAL_OBJECTIVE", capitalObjectiveId: OBJECTIVE },
      true,
    );
    expect(other?.auditEventId).not.toBe(entry?.auditEventId);
    expect(UuidSchema.safeParse(screenActionEventId(["x"])).success).toBe(true);
  });

  it("records nothing for instant actions, Q's surface or no organisation", () => {
    expect(
      screenActionAuditEntry(
        fakeAction("INSTANT").action,
        context(),
        {
          kind: "CAPITAL_OBJECTIVE",
          capitalObjectiveId: OBJECTIVE,
        },
        true,
      ),
    ).toBeNull();
    const { action } = fakeAction("CONSEQUENTIAL");
    expect(
      screenActionAuditEntry(
        action,
        context({ surface: "Q" }),
        {
          kind: "CAPITAL_OBJECTIVE",
          capitalObjectiveId: OBJECTIVE,
        },
        true,
      ),
    ).toBeNull();
  });

  it("a retried intent already recorded is not a failure", async () => {
    const audit = createScreenActionAudit({
      transactions: {
        run: () => Promise.reject(new AuditEventConflictError("x")),
      },
      audit: { record: () => Promise.reject(new Error("unreachable")) },
    });
    const { action } = fakeAction("CONSEQUENTIAL");
    const entry = screenActionAuditEntry(
      action,
      context(),
      { kind: "CAPITAL_OBJECTIVE", capitalObjectiveId: OBJECTIVE },
      true,
    );
    if (entry === null) throw new Error("expected an entry");
    await expect(audit.record(entry)).resolves.toBeUndefined();
  });
});

describe("a person's screen action reaches their admin's feed", () => {
  it("records once per intent at the route, and the admin sees the person", async () => {
    const recorded: MaterialActionAuditInput[] = [];
    const { action, runs } = fakeAction("CONSEQUENTIAL");
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
          Promise.resolve({
            status: "RESOLVED" as const,
            context: MEMBER_ACTOR,
          }),
      },
      ports: {},
      actions: [action],
      audit: {
        record: (entry) => {
          recorded.push(entry);
          return Promise.resolve();
        },
      },
    });
    for (let i = 0; i < 2; i += 1) {
      const response = await app.inject({
        method: "POST",
        url: `/v1/test/objectives/${OBJECTIVE}/change`,
        headers: {
          authorization: "Bearer test",
          "idempotency-key": "intent-0001",
        },
        payload: {},
      });
      expect(response.statusCode).toBe(200);
    }
    expect(runs()).toBe(1);
    expect(recorded).toHaveLength(1);

    // The record, as the audit table holds it, read by the member's admin.
    const db = new MemoryOrganisationAdminDb();
    db.people.set(MEMBER, { userId: MEMBER, name: "James Okoro", email: null });
    for (const [userId, membershipId, roles] of [
      [MEMBER, MEMBER_ACTOR.membershipId, ["organisation_member"]],
      [ADMIN, ADMIN_ACTOR.membershipId, ["organisation_admin"]],
    ] as const) {
      db.memberships.push({
        membershipId: membershipId ?? "",
        organisationId: ORG,
        userId,
        status: "active",
        joinedAt: "2026-10-01T09:00:00.000000Z",
        leftAt: null,
        roleCodes: roles,
        roleHistory: [],
      });
    }
    const [entry] = recorded;
    if (entry === undefined) throw new Error("expected a record");
    db.audit.push({
      key: 1,
      eventId: entry.auditEventId,
      tenantId: entry.tenantId,
      organisationId: entry.organisationId ?? null,
      occurredAt: entry.occurredAt,
      actorType: "human",
      actorId: entry.actorId ?? null,
      authorityUserId: entry.authorityUserId ?? null,
      actionType: entry.actionType,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      outcome: entry.outcome,
      metadata: entry.metadata ?? {},
      correlationId: entry.correlationId?.slice(4) ?? null,
    });
    const service = createOrganisationAdminService({
      authorization: createAuthorizationService({
        getPolicyFacts: (request) =>
          Promise.resolve({
            grants:
              request.actor.userId === ADMIN
                ? [
                    {
                      capability: request.capability,
                      scope: {
                        kind: "ORGANISATION" as const,
                        tenantId: request.actor.tenantId,
                        organisationId: OrganisationIdSchema.parse(ORG),
                      },
                    },
                  ]
                : [],
            denials: [],
            unmetRequirements: [],
          }),
      }),
      store: db.store(),
    });
    const page = await service.activity(ADMIN_ACTOR, {});
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      actor: { type: "PERSON", userId: MEMBER, display: "James Okoro" },
      action: { code: "capital.objective.change" },
    });
  });
});
