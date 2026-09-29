import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  CapitalObjectiveNotFoundError,
  type CapitalService,
} from "@capital-q/capital";
import { CompanyIdSchema } from "@capital-q/companies";
import {
  createProblemDetails,
  FundraisingDtoSchema,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  NETWORK_COMMITMENT_CONFIRM_PATH,
  NETWORK_COMMITMENT_WITHDRAW_PATH,
  NETWORK_COMPANY_FUNDRAISING_PATH,
  NETWORK_RELATIONSHIP_COMMITMENTS_PATH,
  parseContract,
  PROBLEM_CONTENT_TYPE,
  RelationshipCommitmentsDtoSchema,
  StateCommitmentRequestSchema,
  UuidSchema,
} from "@capital-q/contracts";
import type { CommitmentOutcome, CommitmentService } from "@capital-q/network";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * Commitments and the raise (Product Specification 6.6.14-6.6.15).
 *
 * Ids are input; Network decides whether the caller is a party and for
 * which side, so a relationship or commitment that is not theirs is the same
 * 404 as one that does not exist. Stating money is a consequential POST
 * and carries an Idempotency-Key; only the other side can confirm.
 */

export type CommitmentRoutesDependencies = ActorContextDependencies & {
  readonly commitments: CommitmentService;
  /** The company's active raise, for the target and what remains. */
  readonly capital?:
    Pick<CapitalService, "getCurrentCapitalObjective"> | undefined;
};

function paramOf(request: FastifyRequest, name: string): string | null {
  const params = request.params as Readonly<Record<string, unknown>>;
  const parsed = UuidSchema.safeParse(params[name]);
  return parsed.success ? parsed.data : null;
}

const REFUSED = {
  NOT_FOUND: { status: 404, code: "RESOURCE_NOT_FOUND", detail: "Not found." },
  NOT_CONNECTED: {
    status: 409,
    code: "RESOURCE_CONFLICT",
    detail: "Commitments open once you're connected.",
  },
  NOT_ALLOWED: {
    status: 409,
    code: "RESOURCE_CONFLICT",
    detail: "Only the other side can confirm this, and only while it stands.",
  },
} as const;

function answer<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  outcome: CommitmentOutcome<T>,
) {
  if (outcome.outcome === "REFUSED") {
    const refusal = REFUSED[outcome.code];
    const problem = createProblemDetails({
      code: refusal.code,
      requestId: request.id,
      detail: refusal.detail,
    });
    return reply
      .status(problem.status)
      .type(PROBLEM_CONTENT_TYPE)
      .header("Cache-Control", "no-store")
      .send(problem);
  }
  void reply.header("Cache-Control", "no-store");
  return RelationshipCommitmentsDtoSchema.parse(outcome.value);
}

export function registerCommitmentRoutes(
  app: FastifyInstance,
  dependencies: CommitmentRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const { commitments, capital } = dependencies;

  app.get(
    NETWORK_RELATIONSHIP_COMMITMENTS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const relationshipId = paramOf(request, "relationshipId");
      if (relationshipId === null) return reply.callNotFound();
      const found = await commitments.view(
        getActorContext(request),
        relationshipId,
      );
      return answer(
        request,
        reply,
        found === null
          ? { outcome: "REFUSED", code: "NOT_FOUND" }
          : { outcome: "OK", value: found },
      );
    },
  );

  app.post(
    NETWORK_RELATIONSHIP_COMMITMENTS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const relationshipId = paramOf(request, "relationshipId");
      if (relationshipId === null) return reply.callNotFound();
      const rawKey = request.headers[IDEMPOTENCY_KEY_HEADER];
      const idempotencyKey = parseContract(
        IdempotencyKeyHeaderSchema,
        typeof rawKey === "string" ? rawKey : undefined,
        "An Idempotency-Key header is required to record a commitment.",
      );
      const body = parseContract(
        StateCommitmentRequestSchema,
        request.body,
        "The commitment is not valid.",
      );
      return answer(
        request,
        reply,
        await commitments.state({
          actor: getActorContext(request),
          relationshipId: relationshipId,
          request: body,
          idempotencyKey,
        }),
      );
    },
  );

  app.post(
    NETWORK_COMMITMENT_CONFIRM_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const commitmentId = paramOf(request, "commitmentId");
      if (commitmentId === null) return reply.callNotFound();
      return answer(
        request,
        reply,
        await commitments.confirm(getActorContext(request), commitmentId),
      );
    },
  );

  app.post(
    NETWORK_COMMITMENT_WITHDRAW_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const commitmentId = paramOf(request, "commitmentId");
      if (commitmentId === null) return reply.callNotFound();
      return answer(
        request,
        reply,
        await commitments.withdraw(getActorContext(request), commitmentId),
      );
    },
  );

  app.get(
    NETWORK_COMPANY_FUNDRAISING_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const rawCompanyId = paramOf(request, "companyId");
      if (rawCompanyId === null) return reply.callNotFound();
      const actor = getActorContext(request);
      const companyId = CompanyIdSchema.parse(rawCompanyId);
      let target: { amount: string; currencyCode: string } | null = null;
      if (capital !== undefined) {
        try {
          const objective = await capital.getCurrentCapitalObjective({
            actor,
            companyId,
          });
          target = {
            amount: objective.target.amount,
            currencyCode: objective.target.currency,
          };
        } catch (error: unknown) {
          // No active raise: the view still shows what is committed.
          if (!(error instanceof CapitalObjectiveNotFoundError)) throw error;
        }
      }
      const view = await commitments.fundraising({
        actor,
        companyId,
        target,
      });
      void reply.header("Cache-Control", "no-store");
      return FundraisingDtoSchema.parse(view);
    },
  );
}
