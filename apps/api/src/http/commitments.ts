import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  CapitalObjectiveNotFoundError,
  isRoundNotFound,
  type CapitalRoundService,
  type CapitalService,
} from "@capital-q/capital";
import { CompanyIdSchema } from "@capital-q/companies";
import {
  CapitalLedgerDtoSchema,
  COMPANY_CAPITAL_LEDGER_PATH,
  MyCommitmentsDtoSchema,
  NETWORK_MY_COMMITMENTS_PATH,
  createProblemDetails,
  FundraisingDtoSchema,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  NETWORK_COMMITMENT_ADOPT_PATH,
  NETWORK_COMMITMENT_CONFIRM_PATH,
  NETWORK_COMMITMENT_DISPUTE_PATH,
  NETWORK_COMMITMENT_WITHDRAW_PATH,
  NETWORK_COMPANY_FUNDRAISING_PATH,
  NETWORK_RELATIONSHIP_COMMITMENTS_PATH,
  parseContract,
  PROBLEM_CONTENT_TYPE,
  RelationshipCommitmentsDtoSchema,
  StateCommitmentRequestSchema,
  UuidSchema,
} from "@capital-q/contracts";
import type {
  CommitmentLedger,
  CommitmentOutcome,
  CommitmentService,
} from "@capital-q/network";

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
  /** The company's rounds (2026-10-04), for the Capital page's book. */
  readonly capitalRounds?: Pick<CapitalRoundService, "listRounds"> | undefined;
};

type Sums = { raised: string; confirmed: string; pledged: string };
const ZERO: Sums = { raised: "0", confirmed: "0", pledged: "0" };

/**
 * Per-currency totals over the ledger's per-round sums. Exact: integer
 * minor units (amounts carry at most two decimals), never floats.
 */
export function totalsOf(
  sums: CommitmentLedger["sums"],
): (Sums & { currencyCode: string })[] {
  const minor = (value: string) => {
    const [whole = "0", fraction = ""] = value.split(".");
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
  };
  const text = (value: bigint) =>
    value % 100n === 0n
      ? (value / 100n).toString()
      : `${(value / 100n).toString()}.${(value % 100n).toString().padStart(2, "0")}`;
  const by = new Map<string, [bigint, bigint, bigint]>();
  for (const sum of sums) {
    const at = by.get(sum.currencyCode) ?? [0n, 0n, 0n];
    by.set(sum.currencyCode, [
      at[0] + minor(sum.received),
      at[1] + minor(sum.confirmed),
      at[2] + minor(sum.pledged),
    ]);
  }
  return [...by.entries()].map(
    ([currencyCode, [raised, confirmed, pledged]]) => ({
      currencyCode,
      raised: text(raised),
      confirmed: text(confirmed),
      pledged: text(pledged),
    }),
  );
}

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

  // Money Q heard in a call: a party adopts it as their side's statement
  // (the other side then confirms) or disputes it. Never deleted.
  app.post(
    NETWORK_COMMITMENT_ADOPT_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const commitmentId = paramOf(request, "commitmentId");
      if (commitmentId === null) return reply.callNotFound();
      const rawKey = request.headers[IDEMPOTENCY_KEY_HEADER];
      const idempotencyKey = parseContract(
        IdempotencyKeyHeaderSchema,
        typeof rawKey === "string" ? rawKey : undefined,
        "An Idempotency-Key header is required to adopt a commitment.",
      );
      return answer(
        request,
        reply,
        await commitments.adopt(
          getActorContext(request),
          commitmentId,
          idempotencyKey,
        ),
      );
    },
  );

  app.post(
    NETWORK_COMMITMENT_DISPUTE_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const commitmentId = paramOf(request, "commitmentId");
      if (commitmentId === null) return reply.callNotFound();
      return answer(
        request,
        reply,
        await commitments.dispute(getActorContext(request), commitmentId),
      );
    },
  );

  // The Capital page's book (2026-10-04): the company's rounds with what
  // each raised (RECEIVED money only), the all-time totals, every live
  // commitment with this side's next step. Rounds are the raise's own
  // capability; the book is the company's own relationship listing.
  app.get(
    COMPANY_CAPITAL_LEDGER_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const rawCompanyId = paramOf(request, "companyId");
      if (rawCompanyId === null || dependencies.capitalRounds === undefined) {
        return reply.callNotFound();
      }
      const actor = getActorContext(request);
      const companyId = CompanyIdSchema.parse(rawCompanyId);
      let rounds: Awaited<ReturnType<CapitalRoundService["listRounds"]>>;
      try {
        rounds = await dependencies.capitalRounds.listRounds({
          actor,
          companyId,
        });
      } catch (error: unknown) {
        if (isRoundNotFound(error)) return reply.callNotFound();
        throw error;
      }
      const ledger = await commitments.ledger({
        actor,
        side: "COMPANY",
        companyId,
      });
      void reply.header("Cache-Control", "no-store");
      return CapitalLedgerDtoSchema.parse({
        rounds: rounds.map((round) => {
          const sum = ledger.sums.find(
            (item) =>
              item.roundId === round.id &&
              item.currencyCode === round.target.currency,
          );
          return {
            ...round,
            sums:
              sum === undefined
                ? ZERO
                : {
                    raised: sum.received,
                    confirmed: sum.confirmed,
                    pledged: sum.pledged,
                  },
          };
        }),
        currentRoundId: rounds.find((round) => round.isCurrent)?.id ?? null,
        totals: totalsOf(ledger.sums),
        commitments: ledger.commitments,
      });
    },
  );

  // An investor's own commitments across companies, and what they invested.
  app.get(
    NETWORK_MY_COMMITMENTS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const ledger = await commitments.ledger({
        actor: getActorContext(request),
        side: "INVESTOR",
      });
      void reply.header("Cache-Control", "no-store");
      return MyCommitmentsDtoSchema.parse({
        totals: totalsOf(ledger.sums),
        commitments: ledger.commitments,
      });
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
