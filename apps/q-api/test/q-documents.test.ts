import { describe, expect, it } from "vitest";

import { parseQApiConfig } from "@capital-q/config/q-api";
import {
  QArtifactIdSchema,
  QMessageIdSchema,
  QRunIdSchema,
  type QArtifactDetail,
  type QBrandKit,
  type QMessage,
} from "@capital-q/contracts";
import {
  BrandKitAlreadyAnsweredError,
  type ArtifactService,
  type BrandKitService,
} from "@capital-q/q-artifacts";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
  type AuthenticatedPrincipal,
} from "@capital-q/security";

import { createApp, type QApiSecurityDependencies } from "../src/app.js";
import { suggestBrandFromWebsite } from "../src/composition/brand-from-website.js";

/**
 * DOCS: the brand kit routes, filing one answer as a PDF, and a deck's
 * logo reaching the drawn slides. The actor comes from the session; a
 * body never names an organisation.
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
const ARTIFACT = QArtifactIdSchema.parse(
  "11111111-0000-4000-8000-000000000001",
);
const RUN = QRunIdSchema.parse("22222222-0000-4000-8000-000000000001");
const NOW = "2026-10-01T10:00:00.000Z";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const kit = (over: Partial<QBrandKit> = {}): QBrandKit => ({
  version: 1,
  status: "RECOMMENDED",
  source: "WEBSITE",
  palette: { primary: "#0b6e4f" },
  hasLogo: false,
  createdAt: NOW,
  ...over,
});

function deckDetail(): QArtifactDetail {
  return {
    artifact: {
      artifactId: ARTIFACT,
      type: "PITCH_DECK",
      status: "READY",
      title: "Northstar — investor deck",
      currentVersion: 1,
      createdAt: NOW,
      updatedAt: NOW,
    },
    current: {
      artifactId: ARTIFACT,
      version: 1,
      title: "Northstar — investor deck",
      summary: "Composed from the record.",
      createdAt: NOW,
      content: {
        sections: [{ heading: "Summary", body: "Freight.", findings: [] }],
        gaps: [],
        deck: {
          direction: "MINIMAL_INSTITUTIONAL",
          markIsDraft: false,
          brand: { kitVersion: 3 },
          slides: [
            {
              layout: "TITLE",
              title: "Northstar",
              bullets: [],
              bulletsRight: [],
              section: 0,
            },
          ],
        },
      },
    },
    history: [
      { version: 1, title: "Northstar — investor deck", createdAt: NOW },
    ],
  };
}

function build(options: { readonly messages?: readonly QMessage[] } = {}) {
  const calls: { readonly name: string; readonly input: unknown }[] = [];
  const brandKit: BrandKitService = {
    state: () => Promise.resolve({ suggestion: kit() }),
    suggest: (_actor, input) => {
      calls.push({ name: "suggest", input });
      return Promise.resolve(kit({ palette: input.palette }));
    },
    set: (_actor, input) => {
      calls.push({ name: "set", input });
      return Promise.resolve(
        kit({ status: "CONFIRMED", source: "PERSON", palette: input.palette }),
      );
    },
    answer: (_actor, input) => {
      calls.push({ name: "answer", input });
      if (input.version === 9) {
        return Promise.reject(new BrandKitAlreadyAnsweredError());
      }
      return Promise.resolve(kit({ status: "CONFIRMED", version: 2 }));
    },
    logo: (actor, version) => {
      calls.push({ name: "logo", input: { actor, version } });
      return Promise.resolve(
        version === 3
          ? { bytes: new Uint8Array(PNG), contentType: "image/png" as const }
          : null,
      );
    },
    effective: () => Promise.resolve(null),
  };
  const filed: unknown[] = [];
  const artifacts = {
    read: () => Promise.resolve(deckDetail()),
    readVersion: () => Promise.resolve(deckDetail()),
    list: () => Promise.resolve({ items: [] }),
    fileOwnAnswer: (input: unknown) => {
      filed.push(input);
      return Promise.resolve({
        ...deckDetail(),
        artifact: { ...deckDetail().artifact, type: "Q_REPORT" },
      });
    },
  } as unknown as ArtifactService;
  const security: QApiSecurityDependencies = {
    authenticator: { authenticate: () => Promise.resolve(PRINCIPAL) },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve({ status: "RESOLVED", context: CONTEXT }),
    },
  };
  const { app } = createApp(parseQApiConfig({ NODE_ENV: "test" }), security, {
    artifacts,
    documentStudio: {
      brandKit,
      suggestFromWebsite: () => Promise.resolve({ status: "NO_WEBSITE" }),
      runMessages: (actor, runId) => {
        calls.push({ name: "runMessages", input: { actor, runId } });
        return Promise.resolve(options.messages ?? []);
      },
    },
  });
  return { app, calls, filed };
}

describe("brand kit routes", () => {
  it("reads the state for the session's actor", async () => {
    const { app } = build();
    const response = await app.inject({
      method: "GET",
      url: "/v1/q/brand-kit",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ suggestion: { version: 1 } });
    await app.close();
  });

  it("sets their own values, refusing a body that names an organisation", async () => {
    const { app, calls } = build();
    const refused = await app.inject({
      method: "POST",
      url: "/v1/q/brand-kit",
      payload: {
        palette: { primary: "#112233" },
        organisationId: "d0000000-0000-4000-8000-000000000002",
      },
    });
    expect(refused.statusCode).toBe(422);
    const ok = await app.inject({
      method: "POST",
      url: "/v1/q/brand-kit",
      payload: {
        palette: { primary: "#112233" },
        logoBase64: PNG.toString("base64"),
      },
    });
    expect(ok.statusCode).toBe(201);
    const set = calls.find((call) => call.name === "set");
    expect(set?.input).toMatchObject({ palette: { primary: "#112233" } });
    await app.close();
  });

  it("confirms by version, and says when it was already answered", async () => {
    const { app } = build();
    const ok = await app.inject({
      method: "POST",
      url: "/v1/q/brand-kit/confirm",
      payload: { version: 1 },
    });
    expect(ok.statusCode).toBe(201);
    const twice = await app.inject({
      method: "POST",
      url: "/v1/q/brand-kit/confirm",
      payload: { version: 9 },
    });
    expect(twice.statusCode).toBe(409);
    expect(twice.json()).toMatchObject({ code: "ALREADY_ANSWERED" });
    await app.close();
  });

  it("says plainly when there is no website to read", async () => {
    const { app } = build();
    const response = await app.inject({
      method: "POST",
      url: "/v1/q/brand-kit/suggest",
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: "NO_WEBSITE" });
    await app.close();
  });

  it("draws the deck's brand logo into its slides, read as the actor", async () => {
    const { app, calls } = build();
    const response = await app.inject({
      method: "GET",
      url: `/v1/q/artifacts/${ARTIFACT}/slides`,
    });
    expect(response.statusCode).toBe(200);
    const body: { slides: string[] } = response.json();
    expect(body.slides[0]).toContain("data:image/png;base64,");
    expect(calls.find((call) => call.name === "logo")?.input).toEqual({
      actor: CONTEXT,
      version: 3,
    });
    await app.close();
  });
});

describe("filing one answer as a PDF", () => {
  const messages: QMessage[] = [
    {
      messageId: QMessageIdSchema.parse("33333333-0000-4000-8000-000000000001"),
      runId: RUN,
      role: "USER",
      text: "How do I come across?",
      createdAt: NOW,
    },
    {
      messageId: QMessageIdSchema.parse("33333333-0000-4000-8000-000000000002"),
      runId: RUN,
      role: "Q",
      text: "## How you come across\n\nClear on the problem; thin on numbers.",
      createdAt: NOW,
    },
  ];

  it("files exactly the answer's words, read as the run's owner", async () => {
    const { app, calls, filed } = build({ messages });
    const response = await app.inject({
      method: "POST",
      url: "/v1/q/answer-exports",
      payload: { runId: RUN },
    });
    expect(response.statusCode).toBe(201);
    expect(calls.find((call) => call.name === "runMessages")?.input).toEqual({
      actor: CONTEXT,
      runId: RUN,
    });
    expect(filed[0]).toMatchObject({
      actorContext: CONTEXT,
      qRunId: RUN,
      artifactType: "Q_REPORT",
      content: {
        title: "How you come across",
        content: {
          sections: [
            {
              heading: "How you come across",
              body: "Clear on the problem; thin on numbers.",
            },
          ],
        },
      },
    });
    await app.close();
  });

  it("refuses an answer with no words", async () => {
    const { app } = build({ messages: [] });
    const response = await app.inject({
      method: "POST",
      url: "/v1/q/answer-exports",
      payload: { runId: RUN },
    });
    expect(response.statusCode).toBe(422);
    await app.close();
  });
});

describe("reading a brand from the company's own website", () => {
  const page = `<html><head><meta name="theme-color" content="#0b6e4f">
    <link rel="apple-touch-icon" href="/touch.png"></head><body></body></html>`;

  const fetchFrom =
    (routes: Record<string, Response | (() => Response)>) =>
    (input: string | URL | Request): Promise<Response> => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const found = routes[url];
      if (found === undefined)
        return Promise.resolve(new Response("", { status: 404 }));
      return Promise.resolve(typeof found === "function" ? found() : found);
    };

  it("suggests the declared colour and the logo; Q's pairing by sector", async () => {
    const suggestion = await suggestBrandFromWebsite({
      websiteUrl: "northstar.example.com",
      sectorCodes: ["logistics"],
      fetchImpl: fetchFrom({
        "https://northstar.example.com/": () =>
          new Response(page, { headers: { "content-type": "text/html" } }),
        "https://northstar.example.com/touch.png": () =>
          new Response(PNG, { headers: { "content-type": "image/png" } }),
      }),
    });
    expect(suggestion?.palette.primary).toBe("#0b6e4f");
    expect(suggestion?.logo?.contentType).toBe("image/png");
    expect(suggestion?.pairing).toBe("PLEX_SANS_PLEX_SERIF");
    expect(suggestion?.pairingFromSite).toBe(false);
  });

  it("never follows a redirect off the site or to a private address", async () => {
    const offSite = await suggestBrandFromWebsite({
      websiteUrl: "https://northstar.example.com",
      sectorCodes: [],
      fetchImpl: fetchFrom({
        "https://northstar.example.com/": () =>
          new Response("", {
            status: 302,
            headers: { location: "http://169.254.169.254/latest/meta-data" },
          }),
      }),
    });
    expect(offSite).toBeNull();
    const local = await suggestBrandFromWebsite({
      websiteUrl: "http://127.0.0.1:54321",
      sectorCodes: [],
      fetchImpl: (() => {
        throw new Error("must not be called");
      }),
    });
    expect(local).toBeNull();
  });
});
