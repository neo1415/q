import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  DISCOVERY_COMPANY_PASS_PATH,
  DISCOVERY_COMPANY_SAVE_PATH,
  DISCOVERY_COMPANY_UNSAVE_PATH,
  DISCOVERY_COMPANY_UNPASS_PATH,
  DISCOVERY_PASSED_PATH,
  DISCOVERY_INTERACTIONS_PATH,
  DISCOVERY_SAVED_PATH,
  InteractionRecordedDtoSchema,
  parseContract,
  PassCompanyRequestSchema,
  RecordInteractionRequestSchema,
  SaveCompanyRequestSchema,
  SavedCompaniesDtoSchema,
  UuidSchema,
} from "@capital-q/contracts";
import type {
  InteractionCommand,
  InteractionOutcome,
  InteractionSignalService,
} from "@capital-q/discovery";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * `/v1/discovery` interactions (CQ-REC-008 D; doc 19 §66–§69).
 *
 * Decisions get explicit commands on a named company, so a request cannot
 * change its own meaning: `/save`, `/unsave`, `/pass`. Observations get one
 * bounded ingest whose `type` admits exactly four values.
 *
 * What is deliberately not here is a single `POST /interactions` taking an
 * open type plus the caller's own tenant, organisation and rank. That
 * endpoint is how an analytics dump becomes an authorisation hole, and
 * there is no field on any request below for an organisation, a position
 * or a ranking version — the server resolves all three.
 *
 * Every refusal is the same 404. A slate that is not yours, a company you
 * may no longer see and a company that never existed must be
 * indistinguishable, or the endpoint becomes a way to ask which is which.
 */

export type RecommendationInteractionRoutesDependencies =
  ActorContextDependencies & {
    readonly interactions: InteractionSignalService;
  };

const SAVED_DEFAULT_LIMIT = 50;

function companyIdOf(request: FastifyRequest): string {
  return parseContract(
    UuidSchema,
    (request.params as { companyId?: string }).companyId,
    "The company id is not valid.",
  );
}

/** One shape for every answer, so no route leaks what another refuses. */
function answer(
  outcome: InteractionOutcome,
  reply: { callNotFound: () => void },
): unknown {
  if (outcome.kind !== "RECORDED") {
    reply.callNotFound();
    return undefined;
  }
  return InteractionRecordedDtoSchema.parse({
    recorded: true,
    deduplicated: outcome.deduplicated,
    // Only what the person can already see on their own screen. No rank,
    // no ranking version, no score: telling a caller what the server
    // resolved hands them the vocabulary to forge it next time.
    state:
      outcome.state === undefined
        ? null
        : { saved: outcome.state.saved, passed: outcome.state.passed },
  });
}

export function registerRecommendationInteractionRoutes(
  app: FastifyInstance,
  dependencies: RecommendationInteractionRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const interactions = dependencies.interactions;

  const commandFrom = (
    request: FastifyRequest,
    companyId: string,
    body: {
      readonly clientEventId: string;
      readonly sessionId?: string | undefined;
      readonly slateId?: string | undefined;
      readonly surface:
        | "RECOMMENDATION_FEED"
        | "COMPANY_PROFILE"
        | "SAVED_LIST"
        | "SEARCH"
        | "Q_CONVERSATION";
    },
  ): InteractionCommand => ({
    actor: getActorContext(request),
    companyId,
    surface: body.surface,
    clientEventId: body.clientEventId,
    ...(body.sessionId === undefined ? {} : { sessionId: body.sessionId }),
    ...(body.slateId === undefined ? {} : { slateId: body.slateId }),
  });

  // Observations: what the client saw. Bounded by the schema, and the four
  // types it admits are the four a client is allowed to report.
  app.post(
    DISCOVERY_INTERACTIONS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const input = parseContract(
        RecordInteractionRequestSchema,
        request.body,
        "The interaction is not valid.",
      );
      const outcome = await interactions.observe(input.type, {
        ...commandFrom(request, input.companyId, input),
        ...(input.mediaAssetId === undefined
          ? {}
          : { mediaAssetId: input.mediaAssetId }),
        ...(input.watchMilestone === undefined
          ? {}
          : { watchMilestone: input.watchMilestone }),
      });
      void reply.header("Cache-Control", "no-store");
      return answer(outcome, reply);
    },
  );

  // Decisions: each on its own path, so the verb is in the URL and not in
  // a field the body could change.
  for (const [path, type] of [
    [DISCOVERY_COMPANY_SAVE_PATH, "SAVE"],
    [DISCOVERY_COMPANY_UNSAVE_PATH, "UNSAVE"],
    // Undo pass (doc 19 §68): an interaction event like UNSAVE, idempotent
    // by its client event id; it never changes the mandate.
    [DISCOVERY_COMPANY_UNPASS_PATH, "UNPASS"],
  ] as const) {
    app.post(path, { onRequest: withContext }, async (request, reply) => {
      const input = parseContract(
        SaveCompanyRequestSchema,
        request.body,
        "The request is not valid.",
      );
      const outcome = await interactions.decide(
        type,
        commandFrom(request, companyIdOf(request), input),
      );
      void reply.header("Cache-Control", "no-store");
      return answer(outcome, reply);
    });
  }

  app.post(
    DISCOVERY_COMPANY_PASS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const input = parseContract(
        PassCompanyRequestSchema,
        request.body,
        "The request is not valid.",
      );
      const outcome = await interactions.decide("PASS", {
        ...commandFrom(request, companyIdOf(request), input),
        // Optional, always: doc 17 forbids demanding a reason.
        ...(input.reason === undefined ? {} : { passReason: input.reason }),
      });
      void reply.header("Cache-Control", "no-store");
      return answer(outcome, reply);
    },
  );

  // The Saved section. Identities only: a company that has since become
  // private must not leak because it was once saved, so the caller reads
  // it back through the ordinary company path, which re-checks disclosure.
  app.get(
    DISCOVERY_SAVED_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const companyIds = await interactions.savedCompanyIds({
        actor: getActorContext(request),
        limit: SAVED_DEFAULT_LIMIT,
      });
      void reply.header("Cache-Control", "no-store");
      return SavedCompaniesDtoSchema.parse({ companyIds: [...companyIds] });
    },
  );

  // The Passed section (doc 19 §68), for Undo pass. Same shape and the same
  // rule as Saved: identities only, read back through the company path.
  app.get(
    DISCOVERY_PASSED_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const companyIds = await interactions.passedCompanyIds({
        actor: getActorContext(request),
        limit: SAVED_DEFAULT_LIMIT,
      });
      void reply.header("Cache-Control", "no-store");
      return SavedCompaniesDtoSchema.parse({ companyIds: [...companyIds] });
    },
  );
}
