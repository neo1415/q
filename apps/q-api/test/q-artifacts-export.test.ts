import { describe, expect, it } from "vitest";

import { parseQApiConfig } from "@capital-q/config/q-api";
import type { QArtifactDetail,
  QRunIdSchema,
} from "@capital-q/contracts";
import {
  ArtifactNotFoundError,
  type ArtifactService,
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

/**
 * Drawing a deck a founder can send (QX-004 §5-§7).
 *
 * The composer, the store and the viewer all existed; nothing joined them
 * to the renderer, so a deck Q composed could be read on one screen and
 * could not leave the building. What this pins:
 *
 *   - the slides and the file come from the same stored version, so the
 *     picture on screen cannot disagree with the attachment;
 *   - the bytes are really a PPTX and really a PDF, because a route that
 *     returns a plausible content type and an unopenable file is worse
 *     than one that fails;
 *   - an artifact with no deck is a 409 and not an empty deck — an
 *     investment brief is not a slide that failed to draw;
 *   - the actor comes from the verified session, and anything that is not
 *     theirs is the same 404 as one that does not exist.
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

const ARTIFACT = "11111111-0000-4000-8000-000000000001";
const RUN = QRunIdSchema.parse("22222222-0000-4000-8000-000000000001");
const NOW = "2026-09-23T10:00:00.000Z";

function detail(withDeck: boolean): QArtifactDetail {
  return {
    artifact: {
      artifactId: ARTIFACT,
      type: withDeck ? "PITCH_DECK" : "INVESTMENT_BRIEF",
      status: "READY",
      title: "Northstar Logistics — investor deck",
      summary: "What Q composed from what Capital Q holds on record.",
      currentVersion: 1,
      createdAt: NOW,
      updatedAt: NOW,
    },
    current: {
      artifactId: ARTIFACT,
      version: 1,
      title: "Northstar Logistics — investor deck",
      summary: "What Q composed from what Capital Q holds on record.",
      composedByRunId: RUN,
      createdAt: NOW,
      content: {
        sections: [
          {
            heading: "What we do",
            body: "Northstar moves freight between Lagos, Abuja and Kano.",
            findings: [],
          },
        ],
        gaps: ["Financial performance and runway"],
        ...(withDeck
          ? {
              deck: {
                direction: "MINIMAL_INSTITUTIONAL",
                markIsDraft: false,
                slides: [
                  {
                    layout: "TITLE",
                    title: "Northstar Logistics",
                    subtitle: "Freight between Lagos, Abuja and Kano.",
                    bullets: [],
                    bulletsRight: [],
                    section: 0,
                  },
                  {
                    layout: "BULLETS",
                    title: "What we do",
                    bullets: [
                      "Sells spare capacity on trucks already running.",
                    ],
                    bulletsRight: [],
                    section: 0,
                  },
                ],
              },
            }
          : {}),
      },
    },
    history: [
      {
        version: 1,
        title: "Northstar Logistics — investor deck",
        createdAt: NOW,
      },
    ],
  };
}

function buildApp(options: {
  readonly withDeck?: boolean | undefined;
  readonly missing?: boolean | undefined;
  readonly principal?: AuthenticatedPrincipal | null | undefined;
}) {
  const actors: ActorContext[] = [];
  const read = (actor: ActorContext): Promise<QArtifactDetail> => {
    actors.push(actor);
    if (options.missing === true) {
      return Promise.reject(new ArtifactNotFoundError());
    }
    return Promise.resolve(detail(options.withDeck ?? true));
  };
  const artifacts = {
    read: (actor: ActorContext) => read(actor),
    readVersion: (actor: ActorContext) => read(actor),
    list: () => Promise.resolve({ items: [] }),
    summarise: () => Promise.reject(new ArtifactNotFoundError()),
    prepareArtifact: () => Promise.reject(new Error("not used")),
    reviseArtifact: () => Promise.reject(new Error("not used")),
  } as unknown as ArtifactService;

  const security: QApiSecurityDependencies = {
    authenticator: {
      authenticate: () =>
        Promise.resolve(
          options.principal === undefined ? PRINCIPAL : options.principal,
        ),
    },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve({ status: "RESOLVED", context: CONTEXT }),
    },
  };
  const { app } = createApp(parseQApiConfig({ NODE_ENV: "test" }), security, {
    artifacts,
  });
  return { app, actors };
}

describe("drawing a stored deck", () => {
  it("serves the slides as SVG for the session's actor", async () => {
    const { app, actors } = buildApp({});
    const response = await app.inject({
      method: "GET",
      url: `/v1/q/artifacts/${ARTIFACT}/slides`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body: { readonly slides: readonly string[] } = response.json();
    expect(body.slides).toHaveLength(2);
    expect(body.slides[0]).toMatch(
      /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/,
    );
    // The words on the slide are the composed deck's, not the renderer's.
    expect(body.slides[0]).toContain("Northstar Logistics");
    // The actor is resolved from the session, never read from the path.
    expect(actors[0]).toEqual(CONTEXT);
    await app.close();
  });

  it("writes a PPTX a founder can open, named from the title they can see", async () => {
    const { app } = buildApp({});
    const response = await app.inject({
      method: "GET",
      url: `/v1/q/artifacts/${ARTIFACT}/export/pptx`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    expect(response.headers["content-disposition"]).toBe(
      'attachment; filename="Northstar-Logistics-investor-deck.pptx"',
    );
    // A real OOXML package is a zip; a plausible header over junk is not.
    expect(response.rawPayload.subarray(0, 4)).toEqual(
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    );
    await app.close();
  });

  it("writes a PDF a founder can open", async () => {
    const { app } = buildApp({});
    const response = await app.inject({
      method: "GET",
      url: `/v1/q/artifacts/${ARTIFACT}/export/pdf`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("application/pdf");
    expect(response.headers["content-disposition"]).toBe(
      'attachment; filename="Northstar-Logistics-investor-deck.pdf"',
    );
    expect(response.rawPayload.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    await app.close();
  });

  it("refuses to draw a document that has no slides", async () => {
    const { app } = buildApp({ withDeck: false });
    for (const url of [
      `/v1/q/artifacts/${ARTIFACT}/slides`,
      `/v1/q/artifacts/${ARTIFACT}/export/pptx`,
    ]) {
      const response = await app.inject({ method: "GET", url });
      // Not an empty deck, and not a 404: they are already reading this
      // artifact, so "it is not a deck" tells them nothing new.
      expect(response.statusCode).toBe(409);
    }
    await app.close();
  });

  it("answers the same 404 for a format nobody offers and an artifact that is not theirs", async () => {
    const unknown = buildApp({});
    const bad = await unknown.app.inject({
      method: "GET",
      url: `/v1/q/artifacts/${ARTIFACT}/export/keynote`,
    });
    expect(bad.statusCode).toBe(404);
    // A format that does not exist reaches no service call at all.
    expect(unknown.actors).toHaveLength(0);
    await unknown.app.close();

    const missing = buildApp({ missing: true });
    const gone = await missing.app.inject({
      method: "GET",
      url: `/v1/q/artifacts/${ARTIFACT}/export/pdf`,
    });
    expect(gone.statusCode).toBe(404);
    await missing.app.close();
  });

  it("requires an authenticated session before it draws anything", async () => {
    const { app, actors } = buildApp({ principal: null });
    const response = await app.inject({
      method: "GET",
      url: `/v1/q/artifacts/${ARTIFACT}/export/pptx`,
    });
    expect(response.statusCode).toBe(401);
    expect(actors).toHaveLength(0);
    await app.close();
  });
});
