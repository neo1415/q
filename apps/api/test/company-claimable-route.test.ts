import { describe, expect, it } from "vitest";

import { parseApiConfig } from "@capital-q/config/api";
import { COMPANY_CLAIMABLE_PATH } from "@capital-q/contracts";
import type { CompanyClaims } from "@capital-q/companies";
import {
  AuthUserIdSchema,
  UserIdSchema,
  type AuthenticatedPrincipal,
} from "@capital-q/security";

import { createApp, type ApiSecurityDependencies } from "../src/app.js";

/**
 * F8: "Find my startup" answers a person who belongs nowhere yet (exactly
 * who joins a team); it used to answer 400 "not working inside an
 * organisation", which the page showed as a dropped connection.
 */

const PRINCIPAL: AuthenticatedPrincipal = {
  authUserId: AuthUserIdSchema.parse("a0000000-0000-4000-8000-000000000001"),
};
const PERSON = UserIdSchema.parse("b0000000-0000-4000-8000-000000000001");

describe("GET /v1/companies/claimable for a person with no organisation", () => {
  it("searches as the person, with no organisation", async () => {
    const seen: unknown[] = [];
    const companyClaims = {
      search: (actor: unknown, text: string) => {
        seen.push({ actor, text });
        return Promise.resolve([
          {
            companyId: "11111111-0000-4000-8000-000000000001",
            organisationId: "22222222-0000-4000-8000-000000000001",
            name: "Ledgerline",
            website: "https://ledgerline.example",
            city: "Lagos",
            country: "NG",
            members: 4,
            yours: false,
            requested: false,
          },
        ]);
      },
      request: () => Promise.resolve(null),
    } as unknown as CompanyClaims;
    const security: ApiSecurityDependencies = {
      authenticator: { authenticate: () => Promise.resolve(PRINCIPAL) },
      resolver: {
        resolveHumanContext: () =>
          Promise.resolve({ status: "CONTEXT_REQUIRED" }),
      },
      identities: {
        lookup: () => Promise.resolve({ userId: PERSON, displayName: "Emeka" }),
      },
    };
    const { app } = createApp(parseApiConfig({ NODE_ENV: "test" }), security, {
      gateq: {} as never,
      companyClaims,
    });
    const response = await app.inject({
      method: "GET",
      url: `${COMPANY_CLAIMABLE_PATH}?q=ledgerline.example`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(
      response.json<{ companies: { organisationId: string }[] }>(),
    ).toMatchObject({
      companies: [{ organisationId: "22222222-0000-4000-8000-000000000001" }],
    });
    expect(seen).toEqual([
      {
        actor: {
          userId: PERSON,
          tenantId: undefined,
          organisationId: undefined,
        },
        text: "ledgerline.example",
      },
    ]);
  });
});

describe("POST /v1/companies/:companyId/claim-requests for a newcomer (F2, 2026-10-08)", () => {
  const COMPANY = "11111111-0000-4000-8000-000000000001";
  const security: ApiSecurityDependencies = {
    authenticator: { authenticate: () => Promise.resolve(PRINCIPAL) },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve({ status: "CONTEXT_REQUIRED" }),
    },
    identities: {
      lookup: () => Promise.resolve({ userId: PERSON, displayName: "Kelvin" }),
    },
  };

  it("takes the claim from the person, with no organisation of their own", async () => {
    const seen: unknown[] = [];
    const companyClaims = {
      search: () => Promise.resolve([]),
      request: (requester: unknown, companyId: string, input: unknown) => {
        seen.push({ requester, companyId, input });
        return Promise.resolve({ status: "REQUESTED" });
      },
    } as unknown as CompanyClaims;
    const { app } = createApp(parseApiConfig({ NODE_ENV: "test" }), security, {
      gateq: {} as never,
      companyClaims,
    });
    const response = await app.inject({
      method: "POST",
      url: `/v1/companies/${COMPANY}/claim-requests`,
      payload: {
        method: "REGISTRY_DOCUMENT",
        clientRequestId: "claim-test-0001",
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ status: "REQUESTED" });
    expect(seen).toEqual([
      {
        requester: {
          userId: PERSON,
          tenantId: undefined,
          organisationId: undefined,
        },
        companyId: COMPANY,
        input: {
          method: "REGISTRY_DOCUMENT",
          clientRequestId: "claim-test-0001",
        },
      },
    ]);
  });

  it("issues a document upload only on the person's own claim", async () => {
    const companyClaims = {
      search: () => Promise.resolve([]),
      request: () => Promise.resolve(null),
      evidenceUpload: (requester: { userId: string }) =>
        Promise.resolve(
          requester.userId === PERSON
            ? {
                status: "READY",
                upload: {
                  method: "PUT",
                  url: "https://storage.example/upload/sign/x",
                  headers: { "content-type": "application/pdf" },
                  expiresAt: "2026-10-08T10:00:00.000Z",
                },
              }
            : { status: "NOT_FOUND" },
        ),
      evidenceComplete: () => Promise.resolve({ status: "NOT_FOUND" }),
    } as unknown as CompanyClaims;
    const { app } = createApp(parseApiConfig({ NODE_ENV: "test" }), security, {
      gateq: {} as never,
      companyClaims,
    });
    const upload = await app.inject({
      method: "POST",
      url: `/v1/companies/${COMPANY}/claim-requests/evidence`,
      payload: {
        fileName: "certificate.pdf",
        contentType: "application/pdf",
        sizeBytes: 2048,
      },
    });
    expect(upload.statusCode).toBe(200);
    expect(upload.json<{ status: string }>().status).toBe("READY");
    const html = await app.inject({
      method: "POST",
      url: `/v1/companies/${COMPANY}/claim-requests/evidence`,
      payload: { fileName: "x.html", contentType: "text/html", sizeBytes: 10 },
    });
    expect(html.statusCode).toBe(422);
    const done = await app.inject({
      method: "POST",
      url: `/v1/companies/${COMPANY}/claim-requests/evidence/complete`,
      payload: {},
    });
    expect(done.statusCode).toBe(404);
  });
});
