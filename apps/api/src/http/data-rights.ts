import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  ACCOUNT_DELETION_CANCEL_PATH,
  ACCOUNT_DELETION_PATH,
  AccountDeletionRequestSchema,
  AccountDeletionScheduledDtoSchema,
  createProblemDetails,
  DATA_EXPORT_LINK_PATH,
  DATA_EXPORTS_PATH,
  DATA_RIGHTS_PATH,
  DataExportLinkDtoSchema,
  DataExportRequestedDtoSchema,
  DataRightsDtoSchema,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  PROBLEM_CONTENT_TYPE,
  type KnownErrorCode,
} from "@capital-q/contracts";
import type { DataRightsService, StepUpProof } from "@capital-q/data-rights";
import {
  ActorContextDeniedError,
  type AuthenticatedPrincipal,
} from "@capital-q/security";
import type { ApplicationIdentityLookup } from "@capital-q/security/postgres";

import type { RequestAuthenticator } from "../security/actor-context.js";
import {
  getPrincipal,
  requireAuthenticationHook,
} from "../security/authentication.js";

/**
 * "Your data" (owner decision 107). Person-scoped: served to anyone signed
 * in, with or without an organisation, and the person is the verified
 * session's profile, never an id in the request.
 *
 * Deletion needs a re-authentication made moments ago: the page signs the
 * person in again (password or emailed code) and sends that session's
 * access token, which is verified with the Auth server here; the newest
 * authentication in its signed `amr` claim must be recent. Q has no route
 * to it.
 */

export type DataRightsRoutesDependencies = {
  readonly authenticator: RequestAuthenticator;
  readonly identities: ApplicationIdentityLookup;
  readonly dataRights: DataRightsService;
  /** Verifies a fresh re-authentication's access token with the Auth server. */
  readonly freshTokens?:
    | {
        readonly authenticate: (
          accessToken: string,
        ) => Promise<AuthenticatedPrincipal | null>;
      }
    | undefined;
  /** Reads the newest authentication in a verified token's `amr` claim. */
  readonly freshAuthenticationOf: (accessToken: string) => {
    readonly method: StepUpProof["method"];
    readonly at: number;
  } | null;
};

function send(
  request: FastifyRequest,
  reply: FastifyReply,
  code: KnownErrorCode,
  detail: string,
) {
  const problem = createProblemDetails({ code, requestId: request.id, detail });
  return reply
    .status(problem.status)
    .type(PROBLEM_CONTENT_TYPE)
    .header("Cache-Control", "no-store")
    .send(problem);
}

export function registerDataRightsRoutes(
  app: FastifyInstance,
  dependencies: DataRightsRoutesDependencies,
): void {
  const authenticated = requireAuthenticationHook({
    authenticator: dependencies.authenticator,
  });
  const { dataRights } = dependencies;

  /** The signed-in person's profile id; a closed or absent profile is "no access". */
  const personOf = async (request: FastifyRequest): Promise<string> => {
    const identity = await dependencies.identities.lookup(
      getPrincipal(request),
    );
    if (identity === null) throw new ActorContextDeniedError();
    return identity.userId;
  };

  app.get(
    DATA_RIGHTS_PATH,
    { onRequest: authenticated },
    async (request, reply) => {
      const userId = await personOf(request);
      void reply.header("Cache-Control", "no-store");
      return DataRightsDtoSchema.parse(await dataRights.overview(userId));
    },
  );

  app.post(
    DATA_EXPORTS_PATH,
    { onRequest: authenticated },
    async (request, reply) => {
      const userId = await personOf(request);
      const key = IdempotencyKeyHeaderSchema.safeParse(
        request.headers[IDEMPOTENCY_KEY_HEADER],
      );
      if (!key.success) {
        return send(
          request,
          reply,
          "VALIDATION_FAILED",
          "An Idempotency-Key header is required.",
        );
      }
      const outcome = await dataRights.requestExport({
        userId,
        idempotencyKey: key.data,
      });
      if (outcome.kind === "RATE_LIMITED") {
        void reply.header("Retry-After", String(outcome.retryAfterSeconds));
        return send(
          request,
          reply,
          "RATE_LIMITED",
          "You can ask for your data three times a day. Try again tomorrow.",
        );
      }
      if (outcome.kind === "NOT_AVAILABLE") {
        return send(
          request,
          reply,
          "RESOURCE_CONFLICT",
          "A download isn't available for this account.",
        );
      }
      void reply.header("Cache-Control", "no-store");
      return reply.status(202).send(
        DataExportRequestedDtoSchema.parse({
          export: outcome.export,
          alreadyRequested: outcome.kind === "ALREADY_REQUESTED",
        }),
      );
    },
  );

  app.post<{ Params: { exportId: string } }>(
    DATA_EXPORT_LINK_PATH,
    { onRequest: authenticated },
    async (request, reply) => {
      const userId = await personOf(request);
      const exportId = request.params.exportId;
      if (!/^[0-9a-f-]{36}$/u.test(exportId)) {
        return send(request, reply, "RESOURCE_NOT_FOUND", "Not found.");
      }
      const link = await dataRights.createDownloadLink({ userId, exportId });
      if (link.kind === "NOT_FOUND") {
        return send(
          request,
          reply,
          "RESOURCE_NOT_FOUND",
          "That download has expired or isn't yours.",
        );
      }
      void reply.header("Cache-Control", "no-store");
      return DataExportLinkDtoSchema.parse({
        url: link.url,
        expiresAt: link.expiresAt,
      });
    },
  );

  app.post(
    ACCOUNT_DELETION_PATH,
    { onRequest: authenticated },
    async (request, reply) => {
      const userId = await personOf(request);
      const parsed = AccountDeletionRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return send(
          request,
          reply,
          "VALIDATION_FAILED",
          "Confirm it's you, then type the words shown.",
        );
      }
      const fresh =
        dependencies.freshTokens === undefined
          ? null
          : await dependencies.freshTokens
              .authenticate(parsed.data.accessToken)
              .catch(() => null);
      const authentication =
        fresh === null
          ? null
          : dependencies.freshAuthenticationOf(parsed.data.accessToken);
      const stepUp: StepUpProof | null =
        fresh === null || authentication === null
          ? null
          : {
              authUserId: fresh.authUserId,
              method: authentication.method,
              at: authentication.at,
            };
      const outcome = await dataRights.requestDeletion({
        userId,
        stepUp,
        confirmation: parsed.data.confirmation,
        organisationsToClose: parsed.data.organisationsToClose,
      });
      switch (outcome.kind) {
        case "SCHEDULED":
        case "ALREADY_SCHEDULED":
          void reply.header("Cache-Control", "no-store");
          return reply.status(outcome.kind === "SCHEDULED" ? 201 : 200).send(
            AccountDeletionScheduledDtoSchema.parse({
              deletion: outcome.deletion,
            }),
          );
        case "STEP_UP_REQUIRED":
          return send(
            request,
            reply,
            "STEP_UP_REQUIRED",
            "Confirm it's you again, then try once more.",
          );
        case "CONFIRMATION_MISMATCH":
          return send(
            request,
            reply,
            "VALIDATION_FAILED",
            "Type the words exactly as shown.",
          );
        case "TRANSFER_REQUIRED":
          return send(
            request,
            reply,
            "RESOURCE_CONFLICT",
            `Make someone else an owner of ${outcome.organisations.map((o) => o.name).join(", ")} first.`,
          );
        case "ORGANISATIONS_CHANGED":
          return send(
            request,
            reply,
            "RESOURCE_CONFLICT",
            "Your organisations changed while this page was open. Review them again.",
          );
        case "NOT_AVAILABLE":
          return send(
            request,
            reply,
            "RESOURCE_CONFLICT",
            "This account can't be deleted from here.",
          );
      }
    },
  );

  app.post(
    ACCOUNT_DELETION_CANCEL_PATH,
    { onRequest: authenticated },
    async (request, reply) => {
      const userId = await personOf(request);
      const outcome = await dataRights.cancelDeletion(userId);
      if (outcome.kind === "TOO_LATE") {
        return send(
          request,
          reply,
          "RESOURCE_CONFLICT",
          "The deletion has already started.",
        );
      }
      if (outcome.kind === "NOTHING_TO_CANCEL") {
        return send(
          request,
          reply,
          "RESOURCE_NOT_FOUND",
          "No deletion is scheduled.",
        );
      }
      return reply.status(204).send();
    },
  );
}
