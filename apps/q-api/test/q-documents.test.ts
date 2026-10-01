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
import { createDocumentStudioPort } from "../src/composition/documents.js";
import { createVettedHttp } from "../src/composition/vetted-http.js";
import type { DocumentImages } from "../src/composition/document-images.js";

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
const IMAGE = "44444444-0000-4000-8000-000000000001";
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
            {
              layout: "BULLETS",
              title: "Product",
              bullets: ["A booking app for spare truck space."],
              bulletsRight: [],
              section: 0,
              image: {
                url: `cq-image:${IMAGE}`,
                alt: "Illustration for Product (AI-generated)",
                credit: "AI-generated image · Capital Q",
                provenance: "AI_GENERATED",
              },
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
      images: {
        bytesFor: (actor, imageId) => {
          calls.push({ name: "imageBytes", input: { actor, imageId } });
          return Promise.resolve(new Uint8Array(PNG));
        },
        signedUrlFor: (_actor, imageId) =>
          Promise.resolve(
            `https://project.supabase.co/storage/v1/object/sign/cq-document-images/o/${imageId}.png?token=t`,
          ),
      },
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
    // RFC 9457, as every Capital Q client reads one.
    expect(response.headers["content-type"]).toContain(
      "application/problem+json",
    );
    expect(response.json()).toHaveProperty("requestId");
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

describe("generated images in a deck", () => {
  it("the viewer gets a signed storage URL to draw over the slide, never bytes through the app", async () => {
    const { app } = build();
    const response = await app.inject({
      method: "GET",
      url: `/v1/q/artifacts/${ARTIFACT}/slides`,
    });
    const body: {
      images: { slide: number; url: string; credit: string }[];
    } = response.json();
    expect(body.images).toEqual([
      expect.objectContaining({
        slide: 1,
        url: expect.stringContaining(
          "/storage/v1/object/sign/cq-document-images/",
        ) as unknown,
        credit: "AI-generated image · Capital Q",
      }),
    ]);
    expect(JSON.stringify(body)).not.toContain(`cq-image:${IMAGE}"`);
    await app.close();
  });

  it("a PDF or PowerPoint embeds the generated image, read as the actor", async () => {
    const { app, calls } = build();
    const response = await app.inject({
      method: "GET",
      url: `/v1/q/artifacts/${ARTIFACT}/export/pptx`,
    });
    expect(response.statusCode).toBe(200);
    expect(calls.find((call) => call.name === "imageBytes")?.input).toEqual({
      actor: CONTEXT,
      imageId: IMAGE,
    });
    expect(response.rawPayload.toString("latin1")).toContain("ppt/media/");
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

  /** The vetted client over a fake public DNS and a fake transport. */
  const httpFrom = (
    routes: Record<
      string,
      {
        status?: number;
        location?: string;
        type: string;
        body: Uint8Array | string;
      }
    >,
  ) =>
    createVettedHttp({
      resolve: () => Promise.resolve([{ address: "93.184.216.34", family: 4 }]),
      transport: (input) => {
        const found = routes[input.url.href];
        return Promise.resolve(
          found === undefined
            ? {
                status: 404,
                location: null,
                contentType: "",
                body: new Uint8Array(),
              }
            : {
                status: found.status ?? 200,
                location: found.location ?? null,
                contentType: found.type,
                body:
                  typeof found.body === "string"
                    ? new TextEncoder().encode(found.body)
                    : found.body,
              },
        );
      },
    });

  it("suggests the declared colour and the logo; Q's pairing by sector", async () => {
    const suggestion = await suggestBrandFromWebsite({
      websiteUrl: "northstar.example.com",
      sectorCodes: ["logistics"],
      http: httpFrom({
        "https://northstar.example.com/": { type: "text/html", body: page },
        "https://northstar.example.com/touch.png": {
          type: "image/png",
          body: new Uint8Array(PNG),
        },
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
      http: httpFrom({
        "https://northstar.example.com/": {
          status: 302,
          location: "http://169.254.169.254/latest/meta-data",
          type: "",
          body: "",
        },
      }),
    });
    expect(offSite).toBeNull();
    const local = await suggestBrandFromWebsite({
      websiteUrl: "http://127.0.0.1:54321",
      sectorCodes: [],
      http: createVettedHttp({
        resolve: () => Promise.reject(new Error("must not be called")),
        transport: () => Promise.reject(new Error("must not be called")),
      }),
    });
    expect(local).toBeNull();
  });
});

describe("the document studio's Q tools port", () => {
  const plan = {} as never;
  const studioWith = (effective: boolean, images?: DocumentImages) => {
    const revised: unknown[] = [];
    const artifacts = {
      read: () => Promise.resolve(deckDetail()),
      reviseArtifact: (input: unknown) => {
        revised.push(input);
        return Promise.resolve({
          ...deckDetail(),
          artifact: { ...deckDetail().artifact, currentVersion: 2 },
        });
      },
    } as unknown as ArtifactService;
    const port = createDocumentStudioPort({
      artifacts,
      studio: {
        brandKit: {
          effective: () =>
            Promise.resolve(
              effective
                ? {
                    kitVersion: 5,
                    palette: { primary: "#0b6e4f" },
                    pairing: "INTER_ONLY",
                    hasLogo: true,
                  }
                : null,
            ),
        } as unknown as BrandKitService,
        suggestFromWebsite: () => Promise.resolve({ status: "NO_WEBSITE" }),
        runMessages: () => Promise.resolve([]),
        images,
      },
    });
    return { port, revised };
  };

  it("illustrates a deck as a new version, cover only when asked for it", async () => {
    const asked: string[] = [];
    const images: DocumentImages = {
      enabled: true,
      illustrationsFor: () => ({
        illustrate: (input) => {
          asked.push(input.purpose);
          return Promise.resolve({
            url: "cq-image:55555555-0000-4000-8000-000000000001",
            alt: input.alt,
            credit: "AI-generated image · Capital Q",
            provenance: "AI_GENERATED" as const,
          });
        },
      }),
      bytesFor: () => Promise.resolve(null),
      signedUrlFor: () => Promise.resolve(null),
    };
    const { port, revised } = studioWith(false, images);
    const outcome = await port.illustrate({
      actor: CONTEXT,
      plan,
      runId: RUN,
      artifactId: ARTIFACT,
      slides: [1],
    });
    expect(outcome).toMatchObject({ status: "APPLIED", currentVersion: 2 });
    expect(asked).toEqual(["COVER"]);
    expect(revised[0]).toMatchObject({
      instruction: "Add illustrations",
      content: {
        content: {
          deck: {
            slides: [
              { image: { provenance: "AI_GENERATED" } },
              expect.anything() as unknown,
            ],
          },
        },
      },
    });
  });

  it("says images are off, and writes nothing", async () => {
    const { port, revised } = studioWith(false);
    expect(
      await port.illustrate({
        actor: CONTEXT,
        plan,
        runId: RUN,
        artifactId: ARTIFACT,
        slides: undefined,
      }),
    ).toEqual({ status: "IMAGES_OFF" });
    expect(revised).toEqual([]);
  });

  it("applies the confirmed brand as a new version, re-audited", async () => {
    const { port, revised } = studioWith(true);
    const outcome = await port.applyBrand({
      actor: CONTEXT,
      plan,
      runId: RUN,
      artifactId: ARTIFACT,
    });
    expect(outcome).toMatchObject({ status: "APPLIED", currentVersion: 2 });
    expect(revised[0]).toMatchObject({
      actorContext: CONTEXT,
      artifactId: ARTIFACT,
      instruction: "Apply my brand",
      content: {
        content: {
          deck: {
            accent: "#0b6e4f",
            brand: { kitVersion: 5, pairing: "INTER_ONLY" },
          },
          audit: { passed: true },
        },
      },
    });
  });

  it("says when there is no confirmed brand, and writes nothing", async () => {
    const { port, revised } = studioWith(false);
    expect(
      await port.applyBrand({
        actor: CONTEXT,
        plan,
        runId: RUN,
        artifactId: ARTIFACT,
      }),
    ).toEqual({ status: "NO_BRAND" });
    expect(revised).toEqual([]);
  });
});
