import type { ApplicationIdentityLookup } from "@capital-q/security/postgres";
import type { FastifyInstance } from "fastify";
import {
  ConfirmQBrandKitRequestSchema,
  CreateQAnswerExportRequestSchema,
  parseContract,
  Q_ANSWER_EXPORTS_PATH,
  Q_BRAND_KIT_CONFIRM_SUFFIX,
  Q_BRAND_KIT_LOGO_SUFFIX,
  Q_BRAND_KIT_PATH,
  Q_BRAND_KIT_SUGGEST_SUFFIX,
  QArtifactDetailSchema,
  QBrandKitSchema,
  QBrandKitStateSchema,
  SetQBrandKitRequestSchema,
  type QMessage,
} from "@capital-q/contracts";
import {
  BrandKitAlreadyAnsweredError,
  BrandKitAuthorityError,
  BrandKitNotFoundError,
  BrandLogoInvalidError,
  type ArtifactService,
  type BrandKitService,
} from "@capital-q/q-artifacts";
import {
  ANSWER_DOCUMENT_ARTIFACT_TYPE,
  composeAnswerDocument,
} from "@capital-q/q-specialists";
import type { ActorContext } from "@capital-q/security";

import {
  getActorContext,
  requireActorContextHook,
  requireActorContextOrPersonalHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";
import type { WebsiteBrandSuggestion } from "../composition/brand-from-website.js";

/**
 * Documents outside a Q run (DOCS spec §3 F4, F5).
 *
 * The brand kit: read it, set one's own values (a declaration, confirmed
 * as given), ask Q to read the company website for a suggestion, and
 * confirm or decline exactly that suggestion. And one Q answer filed as a
 * PDF document, exactly as written.
 *
 * Every route resolves the actor from the verified session; nothing in a
 * body names a tenant, an organisation or a company. Brand kit rows are
 * the actor's own organisation's (the service's where clause).
 */

export type QDocumentRoutesDependencies = ActorContextDependencies & {
  readonly identity?: ApplicationIdentityLookup | undefined;
  readonly brandKit: BrandKitService;
  readonly artifacts: ArtifactService;
  /** The actor's own company and what its website suggests, or null. */
  readonly suggestFromWebsite: (actor: ActorContext) => Promise<
    | { readonly status: "NO_WEBSITE" }
    | { readonly status: "UNREADABLE" }
    | {
        readonly status: "FOUND";
        readonly companyId: string;
        readonly suggestion: WebsiteBrandSuggestion;
      }
  >;
  /** Messages of a run, read as its owner; throws when not theirs. */
  readonly runMessages: (
    actor: ActorContext,
    runId: string,
  ) => Promise<readonly QMessage[]>;
};

type Problem = {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly code?: string;
};

const problem = (
  status: number,
  title: string,
  detail: string,
  code?: string,
): Problem => ({
  type: "about:blank",
  title,
  status,
  detail,
  ...(code === undefined ? {} : { code }),
});

function decodeBase64(raw: string): Uint8Array | null {
  const clean = raw.replace(/^data:image\/(?:png|jpeg);base64,/, "").trim();
  if (!/^[A-Za-z0-9+/=\s]+$/.test(clean)) return null;
  return new Uint8Array(Buffer.from(clean, "base64"));
}

/** The words of one Q answer: its text, or its TEXT blocks. */
function answerText(message: QMessage): string {
  if (message.role !== "Q") return "";
  const blocks = (message.blocks ?? [])
    .map((block) => (block.kind === "TEXT" ? block.text : ""))
    .filter((text) => text.length > 0);
  return [message.text ?? "", ...blocks]
    .filter((text) => text.trim().length > 0)
    .join("\n\n");
}

export function registerQDocumentRoutes(
  app: FastifyInstance,
  dependencies: QDocumentRoutesDependencies,
): void {
  const identity = dependencies.identity;
  const withContext =
    identity === undefined
      ? requireActorContextHook(dependencies)
      : requireActorContextOrPersonalHook({ ...dependencies, identity });
  const { brandKit, artifacts } = dependencies;

  const noOrganisation = () =>
    problem(
      409,
      "No organisation",
      "A brand kit belongs to a company or firm workspace.",
      "NO_ORGANISATION",
    );

  app.get(
    Q_BRAND_KIT_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      try {
        const state = await brandKit.state(getActorContext(request));
        return reply
          .header("cache-control", "no-store")
          .send(QBrandKitStateSchema.parse(state));
      } catch (error) {
        if (error instanceof BrandKitAuthorityError) {
          return reply.send(QBrandKitStateSchema.parse({}));
        }
        throw error;
      }
    },
  );

  app.post(
    Q_BRAND_KIT_PATH,
    { onRequest: withContext, bodyLimit: 1_024 * 1_024 },
    async (request, reply) => {
      const body = parseContract(
        SetQBrandKitRequestSchema,
        request.body,
        "The brand kit is not valid.",
      );
      let logo: Uint8Array | null | undefined;
      if (body.removeLogo === true) {
        logo = null;
      } else if (body.logoBase64 !== undefined) {
        const decoded = decodeBase64(body.logoBase64);
        if (decoded === null) {
          return reply
            .code(422)
            .send(
              problem(
                422,
                "Logo not readable",
                "Upload a PNG or JPEG of at most 512 KB.",
                "LOGO_INVALID",
              ),
            );
        }
        logo = decoded;
      }
      try {
        const kit = await brandKit.set(getActorContext(request), {
          palette: body.palette,
          ...(body.pairing === undefined ? {} : { pairing: body.pairing }),
          ...(logo === undefined ? {} : { logo }),
        });
        return reply.code(201).send(QBrandKitSchema.parse(kit));
      } catch (error) {
        if (error instanceof BrandLogoInvalidError) {
          return reply
            .code(422)
            .send(
              problem(
                422,
                "Logo not readable",
                "Upload a PNG or JPEG of at most 512 KB.",
                "LOGO_INVALID",
              ),
            );
        }
        if (error instanceof BrandKitAuthorityError) {
          return reply.code(409).send(noOrganisation());
        }
        throw error;
      }
    },
  );

  app.post(
    `${Q_BRAND_KIT_PATH}${Q_BRAND_KIT_SUGGEST_SUFFIX}`,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      if (actor.organisationId === undefined) {
        return reply.code(409).send(noOrganisation());
      }
      const found = await dependencies.suggestFromWebsite(actor);
      if (found.status !== "FOUND") {
        return reply
          .code(422)
          .send(
            problem(
              422,
              "Nothing to read",
              found.status === "NO_WEBSITE"
                ? "Your company has no website on record."
                : "Your website could not be read for colours or a logo.",
              found.status,
            ),
          );
      }
      const kit = await brandKit.suggest(actor, {
        source: "WEBSITE",
        sourceUrl: found.suggestion.sourceUrl,
        companyId: found.companyId,
        palette: found.suggestion.palette,
        pairing: found.suggestion.pairing,
        logo: found.suggestion.logo,
      });
      return reply.code(201).send(QBrandKitSchema.parse(kit));
    },
  );

  app.post(
    `${Q_BRAND_KIT_PATH}${Q_BRAND_KIT_CONFIRM_SUFFIX}`,
    { onRequest: withContext },
    async (request, reply) => {
      const body = parseContract(
        ConfirmQBrandKitRequestSchema,
        request.body,
        "The confirmation is not valid.",
      );
      try {
        const kit = await brandKit.answer(getActorContext(request), body);
        return reply.code(201).send(QBrandKitSchema.parse(kit));
      } catch (error) {
        if (error instanceof BrandKitNotFoundError) {
          return reply
            .code(404)
            .send(problem(404, "Not found", "No such suggestion."));
        }
        if (error instanceof BrandKitAlreadyAnsweredError) {
          return reply
            .code(409)
            .send(
              problem(
                409,
                "Already answered",
                "That suggestion was already answered.",
                "ALREADY_ANSWERED",
              ),
            );
        }
        if (error instanceof BrandKitAuthorityError) {
          return reply.code(409).send(noOrganisation());
        }
        throw error;
      }
    },
  );

  app.get(
    `${Q_BRAND_KIT_PATH}${Q_BRAND_KIT_LOGO_SUFFIX}`,
    { onRequest: withContext },
    async (request, reply) => {
      const query = (request.query ?? {}) as Record<string, unknown>;
      const raw = query["version"];
      const version = Number(typeof raw === "string" ? raw : Number.NaN);
      if (!Number.isInteger(version) || version < 1) {
        return reply.code(404).send(problem(404, "Not found", "No logo."));
      }
      try {
        const logo = await brandKit.logo(getActorContext(request), version);
        if (logo === null) {
          return reply.code(404).send(problem(404, "Not found", "No logo."));
        }
        return reply
          .header("content-type", logo.contentType)
          .header("cache-control", "private, max-age=300")
          .header("x-content-type-options", "nosniff")
          .send(Buffer.from(logo.bytes));
      } catch (error) {
        if (error instanceof BrandKitAuthorityError) {
          return reply.code(404).send(problem(404, "Not found", "No logo."));
        }
        throw error;
      }
    },
  );

  app.post(
    Q_ANSWER_EXPORTS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const body = parseContract(
        CreateQAnswerExportRequestSchema,
        request.body,
        "The answer export request is not valid.",
      );
      const actor = getActorContext(request);
      // Read as the run's owner: a run id that is not theirs throws a
      // not-found from the runtime, the same as one that does not exist.
      const messages = await dependencies.runMessages(actor, body.runId);
      const answers = messages.filter((message) => message.role === "Q");
      const chosen =
        body.messageId === undefined
          ? answers[answers.length - 1]
          : answers.find((message) => message.messageId === body.messageId);
      const question = (() => {
        if (chosen === undefined) return undefined;
        const at = messages.indexOf(chosen);
        for (let index = at - 1; index >= 0; index -= 1) {
          const message = messages[index];
          if (message?.role === "USER") return message.text;
        }
        return undefined;
      })();
      const document =
        chosen === undefined
          ? null
          : composeAnswerDocument({ answer: answerText(chosen), question });
      if (document === null) {
        return reply
          .code(422)
          .send(
            problem(
              422,
              "Nothing to file",
              "That answer has no words to put in a document.",
              "NOTHING_TO_FILE",
            ),
          );
      }
      if (actor.organisationId === undefined) {
        return reply.code(409).send(noOrganisation());
      }
      const detail = await artifacts.fileOwnAnswer({
        actorContext: actor,
        qRunId: body.runId,
        artifactType: ANSWER_DOCUMENT_ARTIFACT_TYPE,
        content: document,
      });
      return reply.code(201).send(QArtifactDetailSchema.parse(detail));
    },
  );
}
