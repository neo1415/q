import { describe, expect, it } from "vitest";

import { parseQApiConfig } from "@capital-q/config/q-api";
import type { QArtifactContent, QSlideImage } from "@capital-q/contracts";
import {
  type ArtifactService,
  type StoredArtifactVersion,
} from "@capital-q/q-artifacts";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import { createApp, type QApiSecurityDependencies } from "../src/app.js";

/**
 * Q room W5 (R8): the room's two routes. A picture dropped on a slide's
 * placeholder is read as the person (their own upload), filed for the
 * document and written as a new version of the version they were looking
 * at; still being checked is 409 UPLOAD_NOT_READY (the room retries); not
 * a picture is 422; a stale version is CHANGED_SINCE. Progress is the
 * person's own job, in plain words. Fakes only: no database or storage.
 */

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
const UPLOAD = "33333333-0000-4000-8000-000000000001";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CONTENT: QArtifactContent = {
  sections: [{ heading: "Team", body: "Three founders.", findings: [] }],
  gaps: [],
  deck: {
    direction: "MINIMAL_INSTITUTIONAL",
    markIsDraft: false,
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
        title: "Team",
        bullets: ["Three founders."],
        bulletsRight: [],
        section: 0,
        placeholder: { kind: "IMAGE", label: "Team photo: drop yours here" },
      },
    ],
  },
};

function build(options: {
  readonly upload?: "PNG" | "NOT_READY" | "NONE";
  readonly current?: number;
  readonly progress?: boolean;
}) {
  const filed: unknown[] = [];
  const written: {
    instruction: string;
    base: number;
    content: QArtifactContent;
  }[] = [];
  let current = options.current ?? 1;
  const artifacts = {
    read: () =>
      Promise.resolve({
        artifact: {
          artifactId: ARTIFACT,
          type: "PITCH_DECK",
          status: "READY",
          title: "Northstar deck",
          summary: "s",
          currentVersion: current,
          createdAt: "2026-10-07T00:00:00.000Z",
          updatedAt: "2026-10-07T00:00:00.000Z",
        },
        history: [],
      }),
    documentProgress: () =>
      Promise.resolve(
        options.progress === true
          ? {
              artifactId: ARTIFACT,
              stage: "FINDING_ASSETS",
              status: "RUNNING",
              updatedAt: "2026-10-07T00:00:00.000Z",
            }
          : null,
      ),
    editOwnDocument: async (
      input: Parameters<ArtifactService["editOwnDocument"]>[0],
    ) => {
      if (input.baseVersion !== current) return { status: "STALE" as const };
      const base: StoredArtifactVersion = {
        artifactId: ARTIFACT,
        version: current,
        title: "Northstar deck",
        summary: "s",
        content: CONTENT,
        instruction: null,
        composedByRunId: null,
        createdByUserId: CONTEXT.userId,
        createdAt: "2026-10-07T00:00:00.000Z",
      };
      const composed = await input.compose(base);
      if (composed === null) return { status: "NOT_EDITABLE" as const };
      written.push({
        instruction: input.instruction,
        base: input.baseVersion,
        content: composed.content,
      });
      current += 1;
      return {
        status: "EDITED" as const,
        detail: {
          artifact: { artifactId: ARTIFACT, currentVersion: current },
        } as never,
      };
    },
  } as unknown as ArtifactService;
  const security: QApiSecurityDependencies = {
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
        Promise.resolve({ status: "RESOLVED", context: CONTEXT }),
    },
  };
  const { app } = createApp(parseQApiConfig({ NODE_ENV: "test" }), security, {
    artifacts,
    ownPictures: {
      read: (_actor, documentId) =>
        Promise.resolve(
          documentId !== UPLOAD || options.upload === "NONE"
            ? null
            : options.upload === "NOT_READY"
              ? "NOT_READY"
              : {
                  bytes: PNG,
                  contentType: "image/png" as const,
                  title: "Team photo",
                },
        ),
      file: (input) => {
        filed.push(input.sourceDocumentId);
        const picture: QSlideImage = {
          url: "cq-image:44444444-0000-4000-8000-000000000001",
          alt: input.alt,
          credit: "Your upload",
          provenance: "OWN_UPLOAD",
        };
        return Promise.resolve(picture);
      },
    },
  });
  return { app, filed, written };
}

const fill = (body: Record<string, unknown>) => ({
  method: "POST" as const,
  url: `/v1/q/artifacts/${ARTIFACT}/placeholders`,
  headers: { authorization: "Bearer t" },
  payload: body,
});

describe("a picture dropped on a placeholder", () => {
  it("is filed from their own upload and written as a new version of the version on screen", async () => {
    const { app, filed, written } = build({ upload: "PNG" });
    const response = await app.inject(
      fill({ version: 1, slide: 2, documentId: UPLOAD }),
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "FILLED", version: 2 });
    expect(filed).toEqual([UPLOAD]);
    expect(written[0]?.instruction).toBe("Slide 2: your picture");
    const team = written[0]?.content.deck?.slides[1];
    expect(team?.image?.provenance).toBe("OWN_UPLOAD");
    expect(team?.placeholder).toBeUndefined();
  });

  it("still being checked: 409 UPLOAD_NOT_READY, nothing filed", async () => {
    const { app, filed } = build({ upload: "NOT_READY" });
    const response = await app.inject(
      fill({ version: 1, slide: 2, documentId: UPLOAD }),
    );
    expect(response.statusCode).toBe(409);
    expect(response.headers["content-type"]).toContain(
      "application/problem+json",
    );
    expect(response.json()).toMatchObject({ code: "UPLOAD_NOT_READY" });
    expect(filed).toEqual([]);
  });

  it("not their picture (or not a picture): 422, nothing filed", async () => {
    const { app, filed } = build({ upload: "NONE" });
    const response = await app.inject(
      fill({ version: 1, slide: 2, documentId: UPLOAD }),
    );
    expect(response.statusCode).toBe(422);
    expect(filed).toEqual([]);
  });

  it("a version that is no longer current: CHANGED_SINCE, and the picture is never filed", async () => {
    const { app, filed } = build({ upload: "PNG", current: 3 });
    const response = await app.inject(
      fill({ version: 1, slide: 2, documentId: UPLOAD }),
    );
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "CHANGED_SINCE" });
    expect(filed).toEqual([]);
  });

  it("a slide with no space for a picture: NOT_FILLABLE", async () => {
    const { app } = build({ upload: "PNG" });
    const response = await app.inject(
      fill({ version: 1, slide: 1, documentId: UPLOAD }),
    );
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "NOT_FILLABLE" });
  });

  it("refuses a body outside the contract", async () => {
    const { app } = build({ upload: "PNG" });
    const response = await app.inject(
      fill({ version: 1, slide: 2, documentId: UPLOAD, url: "https://x" }),
    );
    expect(response.statusCode).toBe(422);
  });
});

describe("progress of a document being made", () => {
  it("is their job's stage, in plain words; 404 when none", async () => {
    const running = build({ progress: true });
    const response = await running.app.inject({
      method: "GET",
      url: `/v1/q/artifacts/${ARTIFACT}/progress`,
      headers: { authorization: "Bearer t" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      stage: "FINDING_ASSETS",
      line: "Finding pictures and drawing charts from your numbers",
    });
    const none = build({});
    expect(
      (
        await none.app.inject({
          method: "GET",
          url: `/v1/q/artifacts/${ARTIFACT}/progress`,
          headers: { authorization: "Bearer t" },
        })
      ).statusCode,
    ).toBe(404);
  });
});
