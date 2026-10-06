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
