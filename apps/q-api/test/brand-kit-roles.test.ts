import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import { registerQDocumentRoutes } from "../src/http/q-documents.js";

/**
 * ORG-SECTIONS (decision 110): the organisation's brand is read by every
 * member and changed only by its owners and admins, refused by the API
 * itself, not only hidden by the page. Brand kit rows are always the
 * session actor's own organisation's: nothing in a request names another.
 */

const ORG_A = OrganisationIdSchema.parse(
  "d0000000-0000-4000-8000-00000000000a",
);
const ADMIN: ActorContext = {
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000001"),
  tenantId: TenantIdSchema.parse("c0000000-0000-4000-8000-00000000000a"),
  organisationId: ORG_A,
  membershipId: MembershipIdSchema.parse(
    "e0000000-0000-4000-8000-000000000001",
  ),
  actorType: "HUMAN",
};
const MEMBER: ActorContext = {
  ...ADMIN,
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000002"),
  membershipId: MembershipIdSchema.parse(
    "e0000000-0000-4000-8000-000000000002",
  ),
};

const KIT = {
  version: 1,
  status: "CONFIRMED" as const,
  source: "PERSON" as const,
  palette: { primary: "#112233" },
  hasLogo: false,
  createdAt: "2026-11-21T10:00:00.000Z",
};

function harness(actor: ActorContext, admins: readonly string[]) {
  const writes: { readonly who: string; readonly org: string | undefined }[] =
    [];
  const app = Fastify();
  registerQDocumentRoutes(app, {
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
        Promise.resolve({ status: "RESOLVED", context: actor }),
    },
    brandKit: {
      state: () => Promise.resolve({ effective: KIT }),
      set: (who) => {
        writes.push({ who: who.userId, org: who.organisationId });
        return Promise.resolve(KIT);
      },
      suggest: (who) => {
        writes.push({ who: who.userId, org: who.organisationId });
        return Promise.resolve(KIT);
      },
      answer: (who) => {
        writes.push({ who: who.userId, org: who.organisationId });
        return Promise.resolve(KIT);
      },
      logo: () => Promise.resolve(null),
      effective: () => Promise.resolve(null),
    } as never,
    artifacts: {} as never,
    suggestFromWebsite: () =>
      Promise.resolve({
        status: "FOUND",
        companyId: "f0000000-0000-4000-8000-000000000001",
        suggestion: {
          sourceUrl: "https://example.test",
          palette: { primary: "#112233" },
          pairing: undefined,
          logo: null,
        },
      } as never),
    runMessages: () => Promise.resolve([]),
    mayManageBrand: (who) => Promise.resolve(admins.includes(who.userId)),
  });
  return { app, writes };
}

const SET = { palette: { primary: "#445566" } };

describe("the organisation's brand kit: owners and admins change it", () => {
  it("an owner or admin saves, has Q suggest, and answers a suggestion", async () => {
    const { app, writes } = harness(ADMIN, [ADMIN.userId]);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/q/brand-kit",
          payload: SET,
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (await app.inject({ method: "POST", url: "/v1/q/brand-kit/suggest" }))
        .statusCode,
    ).toBe(201);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/q/brand-kit/confirm",
          payload: { version: 1, decision: "CONFIRM" },
        })
      ).statusCode,
    ).toBe(201);
    // Always their own organisation's rows: the session actor, nothing else.
    expect(writes).toEqual([
      { who: ADMIN.userId, org: ORG_A },
      { who: ADMIN.userId, org: ORG_A },
      { who: ADMIN.userId, org: ORG_A },
    ]);
    await app.close();
  });

  it("a member reads it, and every write is refused by the API", async () => {
    const { app, writes } = harness(MEMBER, [ADMIN.userId]);
    const read = await app.inject({ method: "GET", url: "/v1/q/brand-kit" });
    expect(read.statusCode).toBe(200);
    for (const [url, payload] of [
      ["/v1/q/brand-kit", SET],
      ["/v1/q/brand-kit/suggest", undefined],
      ["/v1/q/brand-kit/confirm", { version: 1, decision: "CONFIRM" }],
    ] as const) {
      const response = await app.inject({ method: "POST", url, payload });
      expect(response.statusCode, url).toBe(403);
      expect(response.json<{ code: string }>().code).toBe(
        "ORGANISATION_ADMIN_REQUIRED",
      );
    }
    expect(writes).toEqual([]);
    await app.close();
  });

  it("an admin of another organisation is not an admin of this one", async () => {
    const elsewhere: ActorContext = {
      ...ADMIN,
      tenantId: TenantIdSchema.parse("c0000000-0000-4000-8000-00000000000b"),
      organisationId: OrganisationIdSchema.parse(
        "d0000000-0000-4000-8000-00000000000b",
      ),
    };
    // The authorization answers for the session actor's own organisation;
    // here it does not grant organisation.admin there.
    const { app, writes } = harness(elsewhere, []);
    const response = await app.inject({
      method: "POST",
      url: "/v1/q/brand-kit",
      payload: SET,
    });
    expect(response.statusCode).toBe(403);
    expect(writes).toEqual([]);
    await app.close();
  });
});
