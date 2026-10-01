import { describe, expect, it } from "vitest";

import { parseApiConfig } from "@capital-q/config/api";
import type { ResultsDto } from "@capital-q/contracts";
import type { ResultsReader } from "@capital-q/results";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import { createApp } from "../src/app.js";

const ORG = OrganisationIdSchema.parse("d0000000-0000-4000-8000-000000000001");
const OTHER_ORG = "d0000000-0000-4000-8000-000000000009";

const FOUNDER: ResultsDto = {
  side: "FOUNDER",
  organisationName: "Nixo",
  window: { from: "2026-09-02", to: "2026-10-01", label: "Last 30 days" },
  raise: null,
  pipeline: { byState: [], rows: [] },
  engagement: {
    interestsReceived: 0,
    connections: 0,
    meetingsHeld: 0,
    profileOpens: { value: 0, belowFloor: false },
    pitchWatches: { value: null, belowFloor: true },
  },
  rehearsals: [],
  documents: [],
};

function build(answer: ResultsDto, authenticated = true) {
  const seen: ActorContext[] = [];
  const reader: ResultsReader = {
    read: (actor) => {
      seen.push(actor);
      return Promise.resolve(answer);
    },
  };
  const app = createApp(
    parseApiConfig({ NODE_ENV: "test" }),
    {
      authenticator: {
        authenticate: () =>
          Promise.resolve(
            authenticated
              ? {
                  authUserId: AuthUserIdSchema.parse(
                    "a0000000-0000-4000-8000-000000000001",
                  ),
                }
              : null,
          ),
      },
      resolver: {
        resolveHumanContext: () =>
          Promise.resolve({
            status: "RESOLVED",
            context: {
              userId: UserIdSchema.parse(
                "b0000000-0000-4000-8000-000000000001",
              ),
              tenantId: TenantIdSchema.parse(
                "c0000000-0000-4000-8000-000000000001",
              ),
              organisationId: ORG,
              membershipId: MembershipIdSchema.parse(
                "e0000000-0000-4000-8000-000000000001",
              ),
              actorType: "HUMAN",
            },
          }),
      },
      identities: { lookup: () => Promise.resolve(null) },
    },
    { results: reader },
  ).app;
  return { app, seen };
}

describe("GET /v1/results", () => {
  it("is 401 without a session", async () => {
    const { app } = build(FOUNDER, false);
    const response = await app.inject({ method: "GET", url: "/v1/results" });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("reads the server-resolved organisation, never one from the request", async () => {
    const { app, seen } = build(FOUNDER);
    const response = await app.inject({
      method: "GET",
      url: `/v1/results?range=90d`,
      headers: { "x-organisation-id": ORG },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ side: string }>().side).toBe("FOUNDER");
    expect(seen[0]?.organisationId).toBe(ORG);
    const smuggled = await app.inject({
      method: "GET",
      url: `/v1/results?organisationId=${OTHER_ORG}`,
    });
    expect(smuggled.statusCode).toBe(422);
    await app.close();
  });

  it("refuses a malformed range", async () => {
    const { app } = build(FOUNDER);
    const response = await app.inject({
      method: "GET",
      url: "/v1/results?from=yesterday",
    });
    expect(response.statusCode).toBe(422);
    await app.close();
  });
});

describe("GET /v1/results/report", () => {
  it("downloads a CSV and a PDF with a dated file name", async () => {
    const { app } = build(FOUNDER);
    const csv = await app.inject({
      method: "GET",
      url: "/v1/results/report?format=csv&range=30d",
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.headers["content-disposition"]).toMatch(
      /capital-q-results-nixo-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv/,
    );
    expect(csv.body).toContain(
      '"Investor firms that watched your pitch","Fewer than 3"',
    );
    const pdf = await app.inject({
      method: "GET",
      url: "/v1/results/report?format=pdf",
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(pdf.rawPayload.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    await app.close();
  });

  it("is a 404 when there is nothing to report", async () => {
    const { app } = build({ side: "NONE" });
    const response = await app.inject({
      method: "GET",
      url: "/v1/results/report?format=csv",
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
