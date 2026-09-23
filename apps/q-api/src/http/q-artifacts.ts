import type { ApplicationIdentityLookup } from "@capital-q/security/postgres";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  ListQArtifactsQuerySchema,
  ListQArtifactsResponseSchema,
  parseContract,
  Q_ARTIFACT_VERSIONS_SUFFIX,
  Q_ARTIFACTS_PATH,
  QArtifactDetailSchema,
  UuidSchema,
  type QArtifactDetail,
  type QDeck,
} from "@capital-q/contracts";
import {
  deckToPdf,
  deckToPptx,
  deckToSvg,
  layOutDeck,
} from "@capital-q/deck-render";
import {
  ArtifactNotFoundError,
  type ArtifactService,
} from "@capital-q/q-artifacts";

import {
  getActorContext,
  requireActorContextHook,
  requireActorContextOrPersonalHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * `/v1/q/artifacts` — reading what Q composed (QX-003E).
 *
 * Read-only, and deliberately so. Nothing here creates or revises an
 * artifact: that happens inside a Q run, through the answer seam, under
 * the run's own authorised plan (ADR 0013). A POST here would be a second
 * way to write with a different amount of authority behind it, which is
 * the shape this packet exists to avoid.
 *
 * Owner-only, like a conversation: the actor comes from the verified
 * session and the service answers "not found" for anything that is not
 * theirs. Knowing an artifact id grants nothing — an old card in an old
 * message re-resolves through these same checks, so a person who has lost
 * access to a company loses the brief about it at the same moment.
 *
 * Two of these routes draw a deck rather than describe one (QX-004 §5-§7).
 * They are reads for the same reason the others are: the bytes carry only
 * what the stored version already says, to the one person who could
 * already read it. ADR 0013 puts the consequential boundary at publish,
 * share and send, and nothing here does any of those — a founder
 * downloading their own private draft has sent it to nobody.
 *
 * Both drawings come from `layOutDeck`, so the slides on screen and the
 * slides in the file cannot disagree about what fits. The browser is not
 * given the deck to lay out itself: a second layout is a second opinion.
 */

export type QArtifactRoutesDependencies = ActorContextDependencies & {
  readonly artifacts: ArtifactService;
  /** As on the run routes: a person with no organisation yet still has a session. */
  readonly identity?: ApplicationIdentityLookup | undefined;
};

function artifactIdParam(request: FastifyRequest): string {
  const params = request.params as Record<string, unknown>;
  return parseContract(
    UuidSchema,
    params["artifactId"],
    "The artifact identifier is not valid.",
  );
}

function notFound(): {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
} {
  return {
    type: "about:blank",
    title: "Not found",
    status: 404,
    detail: "No such artifact.",
  };
}

/**
 * The artifact carries a deck, but this one does not.
 *
 * A separate answer from "no such artifact" on purpose: the caller is
 * already reading this artifact, so telling them it is a brief rather than
 * a deck discloses nothing they cannot see on the page.
 */
function notADeck(): {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
} {
  return {
    type: "about:blank",
    title: "Nothing to draw",
    status: 409,
    detail: "That document has no slides.",
  };
}

/**
 * Where a deck can be drawn from, and in what.
 *
 * `slides` is for the viewer and `export` is for everywhere else; the two
 * exist separately because one is a page and the other is a file somebody
 * attaches to an email.
 */
export const Q_ARTIFACT_SLIDES_SUFFIX = "/slides" as const;
export const Q_ARTIFACT_EXPORT_SUFFIX = "/export" as const;

/** What a deck may be written as, and what each one is on the wire. */
const EXPORT_FORMATS = {
  pptx: {
    contentType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    extension: "pptx",
  },
  pdf: { contentType: "application/pdf", extension: "pdf" },
} as const;
type ExportFormat = keyof typeof EXPORT_FORMATS;

function isExportFormat(value: unknown): value is ExportFormat {
  return value === "pptx" || value === "pdf";
}

/**
 * A file name a person can find again, from the title they already see.
 *
 * ASCII, because a download header is the wrong place to discover what a
 * browser does with a non-Latin filename, and the title is still on the
 * page. Never empty: a file called nothing is a file nobody finds.
 */
function fileNameFor(title: string, extension: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[^\p{ASCII}]/gu, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${base.length === 0 ? "deck" : base}.${extension}`;
}

/**
 * `?version=N`, or the current one.
 *
 * An unparseable version is not silently the current one: somebody asking
 * for V1 and being handed V3 would send the wrong slides.
 */
function versionQuery(request: FastifyRequest): number | null {
  const query = (request.query ?? {}) as Record<string, unknown>;
  const raw = query["version"];
  if (raw === undefined) {
    return null;
  }
  const version = Number(typeof raw === "string" ? raw : Number.NaN);
  return Number.isInteger(version) && version >= 1 ? version : Number.NaN;
}

export function registerQArtifactRoutes(
  app: FastifyInstance,
  dependencies: QArtifactRoutesDependencies,
): void {
  const identity = dependencies.identity;
  const withContext =
    identity === undefined
      ? requireActorContextHook(dependencies)
      : requireActorContextOrPersonalHook({ ...dependencies, identity });
  const artifacts = dependencies.artifacts;
  const artifactPath = `${Q_ARTIFACTS_PATH}/:artifactId`;

  app.get(
    Q_ARTIFACTS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const query = parseContract(
        ListQArtifactsQuerySchema,
        request.query ?? {},
        "The artifact listing request is not valid.",
      );
      const result = await artifacts.list(getActorContext(request), query);
      return reply.code(200).send(ListQArtifactsResponseSchema.parse(result));
    },
  );

  app.get(artifactPath, { onRequest: withContext }, async (request, reply) => {
    try {
      const detail = await artifacts.read(
        getActorContext(request),
        artifactIdParam(request),
      );
      return reply.code(200).send(QArtifactDetailSchema.parse(detail));
    } catch (error) {
      if (error instanceof ArtifactNotFoundError) {
        return reply.code(404).send(notFound());
      }
      throw error;
    }
  });

  /**
   * The version to draw, re-resolved through the service under this
   * person's own actor. A deck in an old card is not a grant.
   */
  const deckFor = async (
    request: FastifyRequest,
  ): Promise<
    | { readonly ok: true; readonly deck: QDeck; readonly title: string }
    | { readonly ok: false; readonly status: 404 | 409 }
  > => {
    const version = versionQuery(request);
    if (Number.isNaN(version)) {
      return { ok: false, status: 404 };
    }
    let detail: QArtifactDetail;
    try {
      detail =
        version === null
          ? await artifacts.read(
              getActorContext(request),
              artifactIdParam(request),
            )
          : await artifacts.readVersion(
              getActorContext(request),
              artifactIdParam(request),
              version,
            );
    } catch (error) {
      if (error instanceof ArtifactNotFoundError) {
        return { ok: false, status: 404 };
      }
      throw error;
    }
    const current = detail.current;
    const deck = current?.content.deck;
    if (current === undefined || deck === undefined) {
      return { ok: false, status: 409 };
    }
    return { ok: true, deck, title: current.title };
  };

  /**
   * The deck as slides the viewer can show, drawn from the same layout the
   * file is drawn from so the two cannot diverge.
   */
  app.get(
    `${artifactPath}${Q_ARTIFACT_SLIDES_SUFFIX}`,
    { onRequest: withContext },
    async (request, reply) => {
      const found = await deckFor(request);
      if (!found.ok) {
        return reply
          .code(found.status)
          .send(found.status === 404 ? notFound() : notADeck());
      }
      return reply
        .code(200)
        .header("cache-control", "no-store")
        .send({ slides: [...deckToSvg(layOutDeck(found.deck))] });
    },
  );

  /**
   * The deck as a file: what a founder attaches to an email, opens in
   * PowerPoint or Keynote, and keeps after they leave Capital Q.
   */
  app.get(
    `${artifactPath}${Q_ARTIFACT_EXPORT_SUFFIX}/:format`,
    { onRequest: withContext },
    async (request, reply) => {
      const params = request.params as Record<string, unknown>;
      const format = params["format"];
      if (!isExportFormat(format)) {
        return reply.code(404).send(notFound());
      }
      const found = await deckFor(request);
      if (!found.ok) {
        return reply
          .code(found.status)
          .send(found.status === 404 ? notFound() : notADeck());
      }
      const laid = layOutDeck(found.deck);
      const meta = { title: found.title };
      const bytes =
        format === "pptx"
          ? await deckToPptx(laid, meta)
          : await deckToPdf(laid, meta);
      const { contentType, extension } = EXPORT_FORMATS[format];
      return reply
        .code(200)
        .header("content-type", contentType)
        .header("cache-control", "no-store")
        .header(
          "content-disposition",
          `attachment; filename="${fileNameFor(found.title, extension)}"`,
        )
        .send(Buffer.from(bytes));
    },
  );

  app.get(
    `${artifactPath}${Q_ARTIFACT_VERSIONS_SUFFIX}/:version`,
    { onRequest: withContext },
    async (request, reply) => {
      const params = request.params as Record<string, unknown>;
      const raw = params["version"];
      const version = Number(typeof raw === "string" ? raw : Number.NaN);
      if (!Number.isInteger(version) || version < 1) {
        return reply.code(404).send(notFound());
      }
      try {
        const detail = await artifacts.readVersion(
          getActorContext(request),
          artifactIdParam(request),
          version,
        );
        return reply.code(200).send(QArtifactDetailSchema.parse(detail));
      } catch (error) {
        if (error instanceof ArtifactNotFoundError) {
          return reply.code(404).send(notFound());
        }
        throw error;
      }
    },
  );
}
