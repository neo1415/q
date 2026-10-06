import { describe, expect, it } from "vitest";

import { parseApiConfig } from "@capital-q/config/api";
import {
  GATEQ_INBOX_VIEWS,
  GATEQ_INBOX_PACK_PATH,
  GATEQ_INBOX_PASS_PATH,
  GATEQ_INBOX_PATH,
  GATEQ_INBOX_STAR_PATH,
  gateqInboxPath,
} from "@capital-q/contracts";
import type { InboxService } from "@capital-q/gateq-intake";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
  type AuthenticatedPrincipal,
} from "@capital-q/security";

import { createApp, type ApiSecurityDependencies } from "../src/app.js";

/**
 * F4 over HTTP: the inbox's reads are GETs on the gateway, its writes are
 * routes generated from the declared actions. A gateway or application
 * that is not the caller's is one 404; a pass without a reason never
 * reaches the service.
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
const OURS = "11111111-0000-4000-8000-000000000001";
const THEIRS = "11111111-0000-4000-8000-000000000002";
const APP = "22222222-0000-4000-8000-000000000001";

function build() {
  const calls: { op: string; args: unknown[] }[] = [];
  const refused = { ok: false as const };
  const changed = { ok: true as const, changed: 1, deduplicated: false };
  const ours = (gatewayId: string) => gatewayId === OURS;
  const service = {
    list: (_actor: ActorContext, gatewayId: string) =>
      Promise.resolve(
        ours(gatewayId)
          ? {
              gateway: {
                id: OURS,
                name: "Seed gate",
                publicId: "gq_seed",
                replyWithinDays: 10,
              },
              viewer: { userId: CONTEXT.userId, canDecide: true, solo: false },
              view: "INBOX",
              counts: Object.fromEntries(
                GATEQ_INBOX_VIEWS.map((view) => [view, 0]),
              ),
              items: [],
              labels: [],
              members: [],
            }
          : refused,
      ),
    detail: () => Promise.resolve(refused),
    pack: (_actor: ActorContext, gatewayId: string) =>
      Promise.resolve(
        ours(gatewayId)
          ? {
              ok: true as const,
              fileName: "Sunline-2026-10-06.zip",
              bytes: new Uint8Array([0x50, 0x4b, 3, 4]),
            }
          : refused,
      ),
  } as unknown as InboxService;
  const port = {
    star: (...args: unknown[]) => {
      calls.push({ op: "star", args });
      return Promise.resolve(ours(args[1] as string) ? changed : refused);
    },
    pass: (...args: unknown[]) => {
      calls.push({ op: "pass", args });
      return Promise.resolve(ours(args[1] as string) ? changed : refused);
    },
  };
  const security: ApiSecurityDependencies = {
    authenticator: { authenticate: () => Promise.resolve(PRINCIPAL) },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve({ status: "RESOLVED", context: CONTEXT }),
    },
    identities: { lookup: () => Promise.resolve(null) },
  };
  const { app } = createApp(parseApiConfig({ NODE_ENV: "test" }), security, {
    gateq: {} as never,
    gateqInboxService: service,
    gateqInboxActions: port as never,
  });
  return { app, calls };
}

describe("the GateQ inbox over HTTP (F4)", () => {
  it("reads the caller's own gateway's inbox, and 404s anyone else's", async () => {
    const { app } = build();
    const ok = await app.inject({
      method: "GET",
      url: `${gateqInboxPath(GATEQ_INBOX_PATH, { gatewayId: OURS })}?view=FITS`,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["cache-control"]).toBe("no-store");
    const theirs = await app.inject({
      method: "GET",
      url: gateqInboxPath(GATEQ_INBOX_PATH, { gatewayId: THEIRS }),
    });
    expect(theirs.statusCode).toBe(404);
  });

  it("downloads the pack as a zip attachment, never cached", async () => {
    const { app } = build();
    const response = await app.inject({
      method: "GET",
      url: gateqInboxPath(GATEQ_INBOX_PACK_PATH, {
        gatewayId: OURS,
        applicationId: APP,
      }),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("application/zip");
    expect(response.headers["content-disposition"]).toBe(
      'attachment; filename="Sunline-2026-10-06.zip"',
    );
    expect(response.headers["cache-control"]).toBe("no-store");
    const other = await app.inject({
      method: "GET",
      url: gateqInboxPath(GATEQ_INBOX_PACK_PATH, {
        gatewayId: THEIRS,
        applicationId: APP,
      }),
    });
    expect(other.statusCode).toBe(404);
  });

  it("stars in bulk through the declared action, and a foreign gateway is a 404", async () => {
    const { app, calls } = build();
    const response = await app.inject({
      method: "POST",
      url: gateqInboxPath(GATEQ_INBOX_STAR_PATH, { gatewayId: OURS }),
      payload: {
        applicationIds: [APP, "22222222-0000-4000-8000-000000000002"],
        starred: true,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ changed: 1, deduplicated: false });
    expect(calls[0]?.args[2]).toEqual({
      applicationIds: [APP, "22222222-0000-4000-8000-000000000002"],
      starred: true,
    });
    const foreign = await app.inject({
      method: "POST",
      url: gateqInboxPath(GATEQ_INBOX_STAR_PATH, { gatewayId: THEIRS }),
      payload: { applicationIds: [APP], starred: true },
    });
    expect(foreign.statusCode).toBe(404);
  });

  it("refuses a pass without a reason before the service is reached", async () => {
    const { app, calls } = build();
    const response = await app.inject({
      method: "POST",
      url: gateqInboxPath(GATEQ_INBOX_PASS_PATH, {
        gatewayId: OURS,
        applicationId: APP,
      }),
      payload: { message: "No thanks.", clientRequestId: "pass-00000001" },
    });
    expect([400, 422]).toContain(response.statusCode);
    expect(calls).toEqual([]);
    const sent = await app.inject({
      method: "POST",
      url: gateqInboxPath(GATEQ_INBOX_PASS_PATH, {
        gatewayId: OURS,
        applicationId: APP,
      }),
      payload: {
        reasonCode: "TIMING",
        message: "Not this year, thank you.",
        clientRequestId: "pass-00000001",
      },
    });
    expect(sent.statusCode).toBe(201);
    expect(calls[0]?.args[3]).toEqual({
      reasonCode: "TIMING",
      message: "Not this year, thank you.",
      clientRequestId: "pass-00000001",
    });
  });
});
