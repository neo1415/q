import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  ApplicationAnswersRequestSchema,
  ApplicationAnswersResponseSchema,
  GATEQ_APPLY_ANSWERS_PATH,
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
  factsFromAnswers,
  IntakeRefusedError,
  type ApplicantTurnResult,
  type ConversationService,
  type GateQGuestOperation,
  type GuestThrottle,
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
  /**
   * How much one credential may do (CQ-GATE-002S §8). Absent, the routes
   * serve unthrottled, which is what GATE-002R shipped and what this
   * closes; the composition root always supplies one.
   */
  readonly throttle?: GuestThrottle | undefined;
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
  const { intake, conversation, throttle } = dependencies;

  /** One answer for every way a guest request can be wrong. */
  const refuse = (
    error: unknown,
    reply: { callNotFound: () => void },
  ): undefined => {
    // A spent allowance is the one refusal that is not a 404. Telling an
    // honest founder their application had vanished, when it is simply
    // their turn budget that ran out, would be a lie that costs them the
    // application. It goes to the central problem handler, which owns the
    // public wording.
    if (
      error instanceof IntakeRefusedError &&
      error.refusal !== "TOO_MANY_REQUESTS"
    ) {
      reply.callNotFound();
      return undefined;
    }
    throw error;
  };

  /**
   * Verify the credential, then charge this operation to the session it
   * names.
   *
   * The order is the security property, and getting it backwards was a
   * real defect here: charging first meant a forged token could fill the
   * bucket table and learn a 429, which tells an attacker the endpoint
   * counted them. A credential earns a quota by being real. An
   * unverifiable one is refused exactly as it always was, costs nothing,
   * and leaves no trace to probe.
   *
   * Keyed on the session id, which is server-issued and not derived from
   * the secret at all, so nothing replayable as a session ever reaches a
   * counter, a log line or a metric label.
   *
   * Throwing TOO_MANY_REQUESTS rather than calling `callNotFound` is
   * deliberate: a 404 would tell an honest founder their application had
   * vanished when only their turn budget ran out. The problem handler
   * turns it into a plain 429 that names nobody.
   */
  const charge = async (
    credential: string,
    operation: GateQGuestOperation,
  ): Promise<void> => {
    if (throttle === undefined) return;
    // Throws IntakeRefusedError for anything forged, expired or revoked,
    // which the caller already turns into the same 404 as every other way
    // a guest request can be wrong.
    const guest = await intake.authorise(credential);
    if (!throttle.charge({ sessionId: guest.sessionId, operation })) {
      throw new IntakeRefusedError("TOO_MANY_REQUESTS");
    }
  };

  app.post(GATEQ_APPLY_START_PATH, async (request, reply) => {
    const input = parseContract(
      StartApplicationRequestSchema,
      request.body,
      "No such gateway.",
    );
    try {
      // Before any row or model call. Keyed on the gateway, because a
      // stranger has no session yet; the web tier adds a per-visitor limit.
      if (
        throttle !== undefined &&
        !throttle.charge({
          sessionId: `start:${input.gatewayPublicId}`,
          operation: "START",
        })
      ) {
        throw new IntakeRefusedError("TOO_MANY_REQUESTS");
      }
      const started = await intake.start({
        gatewayPublicId: input.gatewayPublicId,
      });
      // F1: the form needs no opening line, so it reaches no model.
      const opening =
        input.mode === "form"
          ? ""
          : await conversation.openingFor({
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
      const token = credential(request);
      await charge(token, "RESUME");
      const summary = await conversation.summary(token);
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
    const token = credential(request);
    try {
      // Before the model call, not after it: a refused turn must cost
      // nothing but the request that made it.
      await charge(token, "TURN");
      const outcome = await conversation.turn({
        token,
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

  /**
   * F1: the GateQ form's answers. Recorded as applicant-provided facts, then
   * the deterministic answer comes back, exactly as after a turn -- but no
   * model is reached. A founder's "I'd rather not say" arrives as DECLINED
   * and is recorded as asked-and-unknown, never as a no.
   */
  app.post(GATEQ_APPLY_ANSWERS_PATH, async (request, reply) => {
    const input = parseContract(
      ApplicationAnswersRequestSchema,
      request.body,
      "The answers are not valid.",
    );
    const token = credential(request);
    try {
      await charge(token, "ANSWERS");
      await intake.recordFacts({ token, facts: factsFromAnswers(input) });
      const summary = await conversation.summary(token);
      void reply.header("Cache-Control", "no-store");
      return ApplicationAnswersResponseSchema.parse({
        application: summaryDto(summary),
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
      await charge(token, "SUBMIT");
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
