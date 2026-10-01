import type { ApplicationIdentityLookup } from "@capital-q/security/postgres";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  ListQArtifactsQuerySchema,
  ListQArtifactsResponseSchema,
  parseContract,
  Q_ARTIFACT_EXPORT_SUFFIX,
  Q_ARTIFACT_VERSIONS_SUFFIX,
  Q_ARTIFACTS_PATH,
  QArtifactDetailSchema,
  QArtifactExportFormatSchema,
  UuidSchema,
  type QArtifactDetail,
  type QArtifactExportFormat,
  type QArtifactExportRefusal,
  type QArtifactVersion,
} from "@capital-q/contracts";
import {
  deckToSvg,
  layOutDeck,
  renderArtifactFile,
  type ArtifactFile,
  type BrandInput,
  type BrandLogo,
} from "@capital-q/deck-render";
import type { ActorContext } from "@capital-q/security";
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
 * Two of these routes draw an artifact rather than describe one (QX-004
 * §5-§7; BIZ-001 for every type, not only decks). They are reads for the
 * same reason the others are: the bytes carry only
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
  /**
   * DOCS: the logo of the brand kit version a deck was drawn with, read
   * as the actor (their own organisation's kit only). Absent: no logos.
   */
  readonly brandLogo?:
    | ((actor: ActorContext, version: number) => Promise<BrandLogo | null>)
    | undefined;
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
 * This artifact has no drawing of that kind.
 *
 * A separate answer from "no such artifact" on purpose: the caller is
 * already reading this artifact, so telling them it is a brief rather than
 * a deck discloses nothing they cannot see on the page. The `code` says
 * which refusal it is, so the web can say the right sentence.
 */
function refused(
  code: QArtifactExportRefusal,
  detail: string,
): {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly code: QArtifactExportRefusal;
} {
  return {
    type: "about:blank",
    title: "Not available",
    status: 409,
    detail,
    code,
  };
}

const notReady = () =>
  refused("ARTIFACT_NOT_READY", "That document isn't ready yet.");
const noSlides = () =>
  refused("FORMAT_NOT_AVAILABLE", "That document has no slides.");
const pdfOnly = () =>
  refused(
    "FORMAT_NOT_AVAILABLE",
    "PowerPoint is for decks; that document downloads as a PDF.",
  );

/**
 * Where an artifact can be drawn from, and in what.
 *
 * `slides` is for the viewer and `export` is for everywhere else; the two
 * exist separately because one is a page and the other is a file somebody
 * attaches to an email.
 */
export const Q_ARTIFACT_SLIDES_SUFFIX = "/slides" as const;

function isExportFormat(value: unknown): value is QArtifactExportFormat {
  return QArtifactExportFormatSchema.safeParse(value).success;
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

  /** The brand a stored deck names, with its logo, for drawing it. */
  const brandFor = async (
    request: FastifyRequest,
    version: QArtifactVersion,
  ): Promise<BrandInput | undefined> => {
    const kitVersion = version.content.deck?.brand?.kitVersion;
    if (kitVersion === undefined || dependencies.brandLogo === undefined) {
      return undefined;
    }
    try {
      const logo = await dependencies.brandLogo(
        getActorContext(request),
        kitVersion,
      );
      return logo === null ? undefined : { logo };
    } catch {
      // A logo that cannot be read leaves the cover without it.
      return undefined;
    }
  };

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
   * person's own actor. An artifact id in an old card is not a grant.
   */
  const versionFor = async (
    request: FastifyRequest,
  ): Promise<
    | {
        readonly ok: true;
        readonly type: string;
        readonly version: QArtifactVersion;
      }
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
    if (current === undefined) {
      // Still being prepared, or preparing failed: nothing to draw yet.
      return { ok: false, status: 409 };
    }
    return { ok: true, type: detail.artifact.type, version: current };
  };

  /**
   * A deck as slides the viewer can show, drawn from the same layout the
   * file is drawn from so the two cannot diverge. A brief has no slides:
   * the viewer shows its prose, and its file is the document PDF.
   */
  app.get(
    `${artifactPath}${Q_ARTIFACT_SLIDES_SUFFIX}`,
    { onRequest: withContext },
    async (request, reply) => {
      const found = await versionFor(request);
      if (!found.ok) {
        return reply
          .code(found.status)
          .send(found.status === 404 ? notFound() : notReady());
      }
      const deck = found.version.content.deck;
      if (deck === undefined) {
        return reply.code(409).send(noSlides());
      }
      return reply
        .code(200)
        .header("cache-control", "no-store")
        .send({
          slides: [
            ...deckToSvg(
              layOutDeck(deck, await brandFor(request, found.version)),
            ),
          ],
        });
    },
  );

  /**
   * Any artifact as a file (BIZ-001): what a founder attaches to an email,
   * opens in PowerPoint or a PDF reader, and keeps after they leave
   * Capital Q. Every type is a PDF — a deck one page per slide, anything
   * else a printed document — and a deck is also a PowerPoint.
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
      const found = await versionFor(request);
      if (!found.ok) {
        return reply
          .code(found.status)
          .send(found.status === 404 ? notFound() : notReady());
      }
      let file: ArtifactFile | null;
      try {
        file = await renderArtifactFile({
          type: found.type,
          version: found.version,
          format,
          brand: await brandFor(request, found.version),
        });
      } catch (error) {
        // The stored version is intact and nothing was written: a renderer
        // failed. Said as that, so the person retries rather than assumes
        // the document is gone; the cause goes to the operator's log.
        request.log.error(
          { err: error, artifactType: found.type, format },
          "artifact export failed to render",
        );
        return reply.code(500).send({
          type: "about:blank",
          title: "Could not draw the file",
          status: 500,
          detail: "The file could not be drawn. Please try again.",
        });
      }
      if (file === null) {
        return reply.code(409).send(pdfOnly());
      }
      return reply
        .code(200)
        .header("content-type", file.contentType)
        .header("cache-control", "no-store")
        .header(
          "content-disposition",
          `attachment; filename="${fileNameFor(found.version.title, file.extension)}"`,
        )
        .send(Buffer.from(file.bytes));
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
