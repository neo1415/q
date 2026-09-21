import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  ApplicationSummaryDtoSchema,
  ApplicationTurnRequestSchema,
  ApplicationTurnResponseSchema,
  GATEQ_APPLY_SESSION_PATH,
  GATEQ_APPLY_START_PATH,
  GATEQ_APPLY_SUBMIT_PATH,
  GATEQ_APPLY_TURN_PATH,
  parseContract,
  StartApplicationRequestSchema,
  StartApplicationResponseSchema,
  SubmitApplicationRequestSchema,
  SubmitApplicationResponseSchema,
} from "@capital-q/contracts";
import {
  IntakeRefusedError,
  type ApplicantTurnResult,
  type ConversationService,
  type IntakeService,
} from "@capital-q/gateq-intake";
import { randomUUID } from "node:crypto";

/**
 * `/v1/gateq/apply` — the public applicant surface (CQ-GATE-002R §2–§5).
 *
 * Every route here is anonymous. There is no `onRequest` context hook
 * anywhere below, deliberately and visibly: a GateQ applicant has no
 * Capital Q account, and the whole point of the packet is that they never
 * need one. Authority is a bearer credential that names exactly one
 * application at exactly one gateway and carries no capability at all.
 *
 * Three things the routes do rather than trust.
 *
 * **Nothing about identity comes from the body.** There is no tenant, no
 * investor organisation, no gateway version, no company id and no
 * qualification outcome in any request schema. The server derives all of
 * them from the credential and the frozen policy, because a field a
 * browser fills is a field a browser can forge.
 *
 * **Every refusal is the same refusal.** A forged credential, an expired
 * one, a revoked one and a valid one naming somebody else's application
 * are one 404. So are an unknown gateway, an unpublished one and a
 * malformed id. An endpoint that distinguishes them is an endpoint that
 * answers questions nobody asked.
 *
 * **What comes back is the deterministic answer.** The reply is the
 * model's; the applicant's standing is GATE-001's, recomputed after the
 * turn's facts were recorded. A model sentence saying "looks like you
 * qualify" changes nothing in the payload beside it.
 */

export type GateQApplyRoutesDependencies = {
  readonly intake: IntakeService;
  readonly conversation: ConversationService;
};

/**
 * The credential, from the Authorization header.
 *
 * A header rather than a cookie because an embedded gateway is a
 * third-party context, and a product that works only where third-party
 * cookies do is already broken in Safari.
 */
function credential(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (typeof header !== "string") return "";
  const [scheme, value] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" ? (value ?? "") : "";
}

function summaryDto(result: ApplicantTurnResult): unknown {
  return ApplicationSummaryDtoSchema.parse({
    reference: result.view.reference,
    status: result.view.status,
    declaredName: result.view.declaredName,
    // Their own words back, rendered for a person. The stored shape, the
    // dimension vocabulary and the internal ids stay on the server.
    facts: result.view.facts.map((fact) => ({
      dimension: fact.dimension,
      summary:
        fact.value.kind === "TEXT"
          ? fact.value.text
          : fact.value.kind === "CODE"
            ? fact.value.code
            : fact.value.kind === "AMOUNT"
              ? `${fact.value.amount} ${fact.value.currency}`
              : fact.value.kind === "PHRASES"
                ? fact.value.phrases.join(", ")
                : "not known yet",
      provenance: fact.provenance,
    })),
    documentCount: result.view.documentCount,
    submittedAt: result.view.submittedAt,
    access: result.access,
    // Labels the investor published, never the configuration behind them.
    unmet: result.unmet,
    stillNeeded: result.stillNeeded,
  });
}

export function registerGateQApplyRoutes(
  app: FastifyInstance,
  dependencies: GateQApplyRoutesDependencies,
): void {
  const { intake, conversation } = dependencies;

  /** One answer for every way a guest request can be wrong. */
  const refuse = (
    error: unknown,
    reply: { callNotFound: () => void },
  ): undefined => {
    if (error instanceof IntakeRefusedError) {
      reply.callNotFound();
      return undefined;
    }
    throw error;
  };

  app.post(GATEQ_APPLY_START_PATH, async (request, reply) => {
    const input = parseContract(
      StartApplicationRequestSchema,
      request.body,
      "No such gateway.",
    );
    try {
      const started = await intake.start({
        gatewayPublicId: input.gatewayPublicId,
      });
      const opening = await conversation.openingFor({
        token: started.token,
        correlationId: randomUUID(),
      });
      const summary = await conversation.summary(started.token);
      void reply.code(201).header("Cache-Control", "no-store");
      return StartApplicationResponseSchema.parse({
        // Shown once. The server kept only its verifier, so this is the
        // only moment it exists anywhere but the applicant's browser.
        sessionToken: started.token,
        expiresAt: started.expiresAt,
        application: summaryDto(summary),
        reply: opening,
      });
    } catch (error: unknown) {
      return refuse(error, reply);
    }
  });

  app.get(GATEQ_APPLY_SESSION_PATH, async (request, reply) => {
    try {
      const summary = await conversation.summary(credential(request));
      void reply.header("Cache-Control", "no-store");
      return summaryDto(summary);
    } catch (error: unknown) {
      return refuse(error, reply);
    }
  });

  app.post(GATEQ_APPLY_TURN_PATH, async (request, reply) => {
    const input = parseContract(
      ApplicationTurnRequestSchema,
      request.body,
      "The message is not valid.",
    );
    try {
      const outcome = await conversation.turn({
        token: credential(request),
        message: input.message,
        clientTurnId: input.clientTurnId,
        ...(input.channel === undefined ? {} : { channel: input.channel }),
        correlationId: randomUUID(),
      });
      void reply.header("Cache-Control", "no-store");
      return ApplicationTurnResponseSchema.parse({
        reply: outcome.reply,
        deduplicated: outcome.deduplicated,
        application: summaryDto(outcome),
      });
    } catch (error: unknown) {
      return refuse(error, reply);
    }
  });

  app.post(GATEQ_APPLY_SUBMIT_PATH, async (request, reply) => {
    const input = parseContract(
      SubmitApplicationRequestSchema,
      request.body,
      "The request is not valid.",
    );
    const token = credential(request);
    try {
      const submitted = await intake.submit({
        token,
        clientRequestId: input.clientRequestId,
      });
      const summary = await conversation.summary(token);
      void reply.header("Cache-Control", "no-store");
      return SubmitApplicationResponseSchema.parse({
        submittedAt: submitted.submittedAt,
        deduplicated: submitted.deduplicated,
        application: summaryDto(summary),
      });
    } catch (error: unknown) {
      return refuse(error, reply);
    }
  });
}
