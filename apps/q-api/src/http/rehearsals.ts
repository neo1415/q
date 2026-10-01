import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  createProblemDetails,
  PROBLEM_CONTENT_TYPE,
  Q_INVESTOR_REHEARSALS_PATH,
  Q_REHEARSAL_FINISH_PATH,
  Q_REHEARSAL_MEETING_PATH,
  Q_REHEARSAL_PARTNERS_PATH,
  Q_REHEARSAL_PATH,
  Q_REHEARSAL_PERSONA_PATH,
  Q_REHEARSAL_SCREEN_PATH,
  Q_REHEARSAL_TURNS_PATH,
  Q_REHEARSALS_PATH,
  QRehearsalDtoSchema,
  QRehearsalListDtoSchema,
  QRehearsalMeetingDtoSchema,
  QRehearsalPartnersDtoSchema,
  QRehearsalPersonaDtoSchema,
  RehearsalCounterpartKindSchema,
  RehearsalScreenRequestSchema,
  RehearsalTurnRequestSchema,
  StartRehearsalRequestSchema,
} from "@capital-q/contracts";

import {
  billingAccountOf,
  FEATURE_REHEARSALS,
  type EntitlementService,
} from "@capital-q/billing";

import type {
  RehearsalImage,
  RehearsalResult,
  RehearsalService,
} from "../composition/rehearsals.js";
import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";
import { sendEntitlementRequired } from "./entitlement-problem.js";

/**
 * Rehearsals (C12, generalised by REHEARSE 2026-10-01). A person starts,
 * continues, finishes and reads their own rehearsals, and sees who they can
 * rehearse with. Ids are input: the service answers only for the
 * rehearsal's own person and tenant, so someone else's rehearsal is the
 * same 404 as none, and a counterpart they may not see is the same 404 too.
 */

export type RehearsalRoutesDependencies = ActorContextDependencies & {
  readonly rehearsals: RehearsalService;
  // BILLING block (ADR 0034): each rehearsal started draws one unit from
  // the plan, taken before any model work and given back if it does not
  // start. Absent: rehearsals are not plan-controlled (tests).
  readonly entitlements?:
    Pick<EntitlementService, "consume" | "release"> | undefined;
  // end BILLING block
};

const RehearsalParamsSchema = z
  .object({ rehearsalId: z.string().uuid() })
  .strict();
const InvestorParamsSchema = z
  .object({ investorOrganisationId: z.string().uuid() })
  .strict();
const PersonaParamsSchema = z
  .object({
    counterpartKind: RehearsalCounterpartKindSchema,
    counterpartId: z.string().uuid(),
  })
  .strict();
const MeetingParamsSchema = z.object({ meetingId: z.string().uuid() }).strict();

type ProblemCode =
  | "RESOURCE_NOT_FOUND"
  | "PERMISSION_DENIED"
  | "RESOURCE_CONFLICT"
  | "PROVIDER_UNAVAILABLE"
  | "INVALID_REQUEST";

function problem(
  request: FastifyRequest,
  reply: FastifyReply,
  code: ProblemCode,
  detail: string,
) {
  const body = createProblemDetails({ code, requestId: request.id, detail });
  return reply
    .status(body.status)
    .type(PROBLEM_CONTENT_TYPE)
    .header("Cache-Control", "no-store")
    .send(body);
}

const NOT_A_PARTICIPANT =
  "Rehearsals are for a company's founders and an investor's team.";
const Q_UNAVAILABLE =
  "Q couldn't get into character just now. Try again in a moment.";

function answer(
  request: FastifyRequest,
  reply: FastifyReply,
  outcome: RehearsalResult,
) {
  switch (outcome.kind) {
    case "OK":
      void reply.header("Cache-Control", "no-store");
      return QRehearsalDtoSchema.parse(outcome.rehearsal);
    case "NOT_FOUND":
      return problem(request, reply, "RESOURCE_NOT_FOUND", "Not found.");
    case "NOT_A_PARTICIPANT":
      return problem(request, reply, "PERMISSION_DENIED", NOT_A_PARTICIPANT);
    case "FINISHED":
      return problem(
        request,
        reply,
        "RESOURCE_CONFLICT",
        "This rehearsal has finished.",
      );
    case "Q_UNAVAILABLE":
      return problem(request, reply, "PROVIDER_UNAVAILABLE", Q_UNAVAILABLE);
  }
}

/** `data:image/jpeg;base64,...` into the gateway's image shape. */
function imageOf(dataUrl: string): RehearsalImage | null {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl);
  if (match === null) return null;
  const mediaType = match[1];
  const dataBase64 = match[2];
  if (
    dataBase64 === undefined ||
    (mediaType !== "image/jpeg" &&
      mediaType !== "image/png" &&
      mediaType !== "image/webp")
  ) {
    return null;
  }
  return { mediaType, dataBase64 };
}

export function registerRehearsalRoutes(
  app: FastifyInstance,
  dependencies: RehearsalRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const { rehearsals } = dependencies;

  app.post(
    Q_REHEARSALS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const body = StartRehearsalRequestSchema.safeParse(request.body);
      if (!body.success) {
        return problem(request, reply, "INVALID_REQUEST", "Invalid request.");
      }
      const counterpart =
        body.data.counterpart ??
        (body.data.investorOrganisationId === undefined
          ? null
          : {
              kind: "INVESTOR_ORGANISATION" as const,
              id: body.data.investorOrganisationId,
            });
      if (counterpart === null) {
        return problem(request, reply, "INVALID_REQUEST", "Invalid request.");
      }
      const actor = getActorContext(request);
      // BILLING block: one unit per start request (a retried request with
      // the same Idempotency-Key is the same unit).
      const { entitlements } = dependencies;
      const header = request.headers["idempotency-key"];
      const meter = {
        account: billingAccountOf(actor),
        feature: FEATURE_REHEARSALS,
        idempotencyKey: `rehearsal-start:${
          typeof header === "string" && /^[\x21-\x7e]{8,128}$/.test(header)
            ? header
            : request.id
        }`,
      };
      if (entitlements !== undefined) {
        const decision = await entitlements.consume({
          ...meter,
          actorUserId: actor.userId,
          surface: "Q_API",
        });
        if (!decision.allowed) {
          return sendEntitlementRequired(request, reply, decision.refusal);
        }
      }
      // end BILLING block
      let started: RehearsalResult;
      try {
        started = await rehearsals.start(actor, {
          kind: counterpart.kind,
          id: counterpart.id,
          meetingId: body.data.meetingId,
          voice: body.data.voice,
          difficulty: body.data.difficulty,
        });
      } catch (error: unknown) {
        await entitlements
          ?.release({ ...meter, reason: "The rehearsal did not start." })
          .catch(() => false);
        throw error;
      }
      if (started.kind !== "OK") {
        await entitlements
          ?.release({ ...meter, reason: "The rehearsal did not start." })
          .catch(() => false);
      }
      return answer(request, reply, started);
    },
  );

  app.get(
    Q_REHEARSALS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      void reply.header("Cache-Control", "no-store");
      return QRehearsalListDtoSchema.parse(
        await rehearsals.list(getActorContext(request)),
      );
    },
  );

  app.get(
    Q_REHEARSAL_PARTNERS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      void reply.header("Cache-Control", "no-store");
      return QRehearsalPartnersDtoSchema.parse(
        await rehearsals.partners(getActorContext(request)),
      );
    },
  );

  app.get(
    Q_REHEARSAL_PERSONA_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const params = PersonaParamsSchema.safeParse(request.params);
      if (!params.success) return reply.callNotFound();
      const result = await rehearsals.persona(
        getActorContext(request),
        params.data.counterpartKind,
        params.data.counterpartId,
      );
      switch (result.kind) {
        case "OK":
          void reply.header("Cache-Control", "no-store");
          return QRehearsalPersonaDtoSchema.parse(result.persona);
        case "NOT_FOUND":
          return problem(request, reply, "RESOURCE_NOT_FOUND", "Not found.");
        case "NOT_A_PARTICIPANT":
          return problem(
            request,
            reply,
            "PERMISSION_DENIED",
            NOT_A_PARTICIPANT,
          );
        case "Q_UNAVAILABLE":
          return problem(request, reply, "PROVIDER_UNAVAILABLE", Q_UNAVAILABLE);
      }
    },
  );

  app.get(
    Q_REHEARSAL_MEETING_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const params = MeetingParamsSchema.safeParse(request.params);
      if (!params.success) return reply.callNotFound();
      const counterpart = await rehearsals.meeting(
        getActorContext(request),
        params.data.meetingId,
      );
      if (counterpart === null) {
        return problem(request, reply, "RESOURCE_NOT_FOUND", "Not found.");
      }
      void reply.header("Cache-Control", "no-store");
      return QRehearsalMeetingDtoSchema.parse({ counterpart });
    },
  );

  app.get(
    Q_INVESTOR_REHEARSALS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const params = InvestorParamsSchema.safeParse(request.params);
      if (!params.success) return reply.callNotFound();
      void reply.header("Cache-Control", "no-store");
      return QRehearsalListDtoSchema.parse(
        await rehearsals.list(getActorContext(request), {
          kind: "INVESTOR_ORGANISATION",
          id: params.data.investorOrganisationId,
        }),
      );
    },
  );

  app.get(
    Q_REHEARSAL_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const params = RehearsalParamsSchema.safeParse(request.params);
      if (!params.success) return reply.callNotFound();
      return answer(
        request,
        reply,
        await rehearsals.get(getActorContext(request), params.data.rehearsalId),
      );
    },
  );

  app.post(
    Q_REHEARSAL_TURNS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const params = RehearsalParamsSchema.safeParse(request.params);
      if (!params.success) return reply.callNotFound();
      const body = RehearsalTurnRequestSchema.safeParse(request.body);
      if (!body.success) {
        return problem(request, reply, "INVALID_REQUEST", "Invalid request.");
      }
      return answer(
        request,
        reply,
        await rehearsals.say(
          getActorContext(request),
          params.data.rehearsalId,
          body.data,
        ),
      );
    },
  );

  app.post(
    Q_REHEARSAL_SCREEN_PATH,
    // A downscaled frame; the schema bounds it again.
    { onRequest: withContext, bodyLimit: 600_000 },
    async (request, reply) => {
      const params = RehearsalParamsSchema.safeParse(request.params);
      if (!params.success) return reply.callNotFound();
      const body = RehearsalScreenRequestSchema.safeParse(request.body);
      const image = body.success ? imageOf(body.data.image) : null;
      if (image === null) {
        return problem(request, reply, "INVALID_REQUEST", "Invalid frame.");
      }
      const result = await rehearsals.screen(
        getActorContext(request),
        params.data.rehearsalId,
        image,
      );
      if (result === "NOT_FOUND") {
        return problem(request, reply, "RESOURCE_NOT_FOUND", "Not found.");
      }
      if (result === "FINISHED") {
        return problem(
          request,
          reply,
          "RESOURCE_CONFLICT",
          "This rehearsal has finished.",
        );
      }
      void reply.header("Cache-Control", "no-store");
      return { accepted: true };
    },
  );

  app.post(
    Q_REHEARSAL_FINISH_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const params = RehearsalParamsSchema.safeParse(request.params);
      if (!params.success) return reply.callNotFound();
      return answer(
        request,
        reply,
        await rehearsals.finish(
          getActorContext(request),
          params.data.rehearsalId,
        ),
      );
    },
  );
}
