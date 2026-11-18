import { z } from "zod";

import {
  WithdrawClaimRequestSchema,
  WithdrawClaimResponseSchema,
  type WithdrawClaimResponse,
} from "@capital-q/contracts";
import {
  ClaimIdSchema,
  STATED_FIGURE_METRIC_CODES,
  statedFigureClaimWords,
  statedFigurePeriod,
  withdrawableFigureClaims,
  withdrawClaim,
  type ClaimWithdrawalOutcome,
} from "@capital-q/evidence";
import type { ActorContext } from "@capital-q/security";

import {
  defineAppAction,
  portMissing,
  refusal,
  type AppActionContext,
  type OwnStatementDelegation,
} from "../define.js";
import type { AppActionPorts } from "../ports.js";

/**
 * A founder withdraws one of their own company's claims, with a reason
 * (hygiene audit 2026-11-16 §4.2). One declaration: the screen's route
 * (`POST /v1/claims/:claimId/withdraw`) and Q's tool, which only prepares
 * a card the founder approves exactly (Prepare -> Recommend -> Human
 * Approval -> Execute).
 *
 * Withdrawing writes a new SUPERSEDED revision with the reason through the
 * Evidence services, which authorise (evidence.record on the subject),
 * audit and emit. Nothing is deleted; the earlier revisions stay, and
 * investor-facing reads, which keep current claims only, stop showing it.
 * Only a claim about the actor's own company is theirs to withdraw: any
 * other claim id is the one 404, whatever the reason.
 */

const withdrawals = (ports: AppActionPorts) =>
  ports.claimWithdrawals ?? portMissing("claimWithdrawals");

const WithdrawInput = z
  .object({
    claimId: z.string().uuid(),
    reason: WithdrawClaimRequestSchema.shape.reason,
    /**
     * The company the claim is about, set by Q's path from their own
     * company so the approval card binds to it; the screen omits it. When
     * present it must be the claim's own subject.
     */
    companyId: z.string().uuid().optional(),
  })
  .strict();
type WithdrawInput = z.infer<typeof WithdrawInput>;

const PERIOD = /^(\d{4})-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?$/u;

const WithdrawTool = z
  .object({
    metric: z
      .enum(STATED_FIGURE_METRIC_CODES)
      .describe(
        "Which of their company's recorded figures: MRR, ARR, REVENUE, BURN, CASH, RUNWAY, GROSS_MARGIN, CUSTOMERS, USERS or CHURN.",
      ),
    period: z
      .string()
      .regex(PERIOD)
      .nullable()
      .describe(
        "The month (YYYY-MM) or day (YYYY-MM-DD) the figure is for, null when they did not say.",
      ),
    amount: z
      .number()
      .finite()
      .min(0)
      .optional()
      .describe(
        "The recorded value as a plain number (42000), when they named it; omit otherwise.",
      ),
    reason: z
      .string()
      .trim()
      .min(1)
      .max(400)
      .describe("Why they are withdrawing it, in their own words."),
    undoesRecorded: z
      .boolean()
      .optional()
      .describe(
        "True only when their latest message asks to undo or take back a figure you said you recorded from their own words earlier in this conversation.",
      ),
  })
  .strict();
type WithdrawToolInput = z.infer<typeof WithdrawTool>;

async function ownCompany(
  ports: AppActionPorts,
  actor: ActorContext,
): Promise<string | null> {
  return ports.ownCompanyId === undefined
    ? null
    : await ports.ownCompanyId(actor).catch(() => null);
}

/**
 * The claim, read as the actor, when it is about their own company.
 * Evidence reads a claim only inside the actor's tenant and only when the
 * actor's organisation owns its subject; where the composition knows their
 * company, it must also be that company.
 */
async function ownClaim(
  ports: AppActionPorts,
  actor: ActorContext,
  claimId: string,
  companyId?: string,
): Promise<{ readonly statement: string } | null> {
  const port = ports.claimWithdrawals;
  if (port === undefined) return null;
  const read = await Promise.resolve()
    .then(() => port.getClaim({ actor, claimId: ClaimIdSchema.parse(claimId) }))
    .then((found) => found.claim)
    .catch(() => null);
  if (read === null || read.subjectType !== "COMPANY") return null;
  if (companyId !== undefined && companyId !== read.subjectId) return null;
  if (ports.ownCompanyId === undefined) return read;
  return (await ownCompany(ports, actor)) === read.subjectId ? read : null;
}

const respond = (out: ClaimWithdrawalOutcome): WithdrawClaimResponse =>
  WithdrawClaimResponseSchema.parse({
    claimId: out.claimId,
    outcome: out.outcome,
    lifecycleStatus: out.lifecycleStatus,
    revisionNumber: out.revisionNumber,
  });

const quoted = (statement: string | null | undefined) =>
  statement === null || statement === undefined
    ? "this claim"
    : `"${statement.length > 140 ? `${statement.slice(0, 137)}...` : statement}"`;

/** How Q opens its line for a figure it recorded at once (ADR 0081). */
const RECORDED_PREFIX = "Recorded your ";

/**
 * ADR 0081 (owner decision 105): "undo" right after Q recorded the
 * founder's own figure with no card. Only that figure: a claim of their
 * own company, still current, recorded from their statement, which Q's
 * own stored words in this conversation say it recorded ("Recorded your
 * MRR of USD 120,000 for October 2026"). It is withdrawn through the same
 * path as the card's (a SUPERSEDED revision with their reason, audited);
 * any other claim is withdrawn on a card, as before.
 */
function undoOwnStatement(): OwnStatementDelegation<
  WithdrawInput,
  ClaimWithdrawalOutcome,
  WithdrawToolInput
> {
  return {
    companyOf: (input) => input.companyId ?? null,
    stated: async (input, tool, turn, ports, context) => {
      if (tool.undoesRecorded !== true || turn.qWords.length === 0) {
        return false;
      }
      const port = ports.claimWithdrawals;
      if (port === undefined) return false;
      const claim = await Promise.resolve()
        .then(() =>
          port.getClaim({
            actor: context.actor,
            claimId: ClaimIdSchema.parse(input.claimId),
          }),
        )
        .then((found) => found.claim)
        .catch(() => null);
      if (
        claim === null ||
        claim.subjectType !== "COMPANY" ||
        claim.subjectId !== input.companyId ||
        claim.lifecycleStatus !== "CURRENT" ||
        claim.truthClass !== "USER_CLAIM" ||
        claim.evidenceStatus !== "SELF_REPORTED"
      ) {
        return false;
      }
      const words = statedFigureClaimWords(claim);
      return (
        words !== null &&
        turn.qWords.some((said) => said.includes(`${RECORDED_PREFIX}${words}`))
      );
    },
    keyOf: (input) => ({ claimId: input.claimId, undo: true }),
    recorded: (out) => {
      const words = statedFigureClaimWords({ statement: out.statement });
      const what = words === null ? "that figure" : `your ${words}`;
      return out.outcome === "ALREADY_WITHDRAWN"
        ? `${what[0]?.toUpperCase() ?? ""}${what.slice(1)} was already withdrawn, so nothing changed.`
        : `Undone: ${what} is withdrawn. It stays in your company's history as withdrawn, with your reason; it is no longer treated as your company's figure.`;
    },
  };
}

export const WITHDRAW_CLAIM = defineAppAction<
  WithdrawInput,
  ClaimWithdrawalOutcome,
  WithdrawToolInput
>({
  name: "company.claim.withdraw",
  short: "withdraw a company claim",
  area: "records",
  classification: "CONSEQUENTIAL",
  does: "Withdraws one of their own company's recorded claims (a figure no longer right, or whose only evidence was a document they archived), with their reason. It stays in the history as withdrawn; investors stop seeing it. Nothing is deleted.",
  input: WithdrawInput,
  output: z.custom<ClaimWithdrawalOutcome>(),
  authorize: async (ports, context, input) =>
    (await ownClaim(ports, context.actor, input.claimId, input.companyId)) ===
    null
      ? { ok: false, reason: "That isn't one of your company's claims." }
      : { ok: true },
  run: (ports, context, input) =>
    withdrawClaim(withdrawals(ports), {
      actor: context.actor,
      claimId: input.claimId,
      reason: input.reason,
      correlationId: context.correlationId,
    }),
  targets: (input) =>
    input.companyId === undefined
      ? []
      : [{ kind: "COMPANY", companyId: input.companyId }],
  counterpartOf: async (ports, actor, input) =>
    (await ownClaim(ports, actor, input.claimId))?.statement ?? null,
  card: (input, names) => ({
    summary: `Withdraw ${quoted(names?.counterpart)}`,
    preview: `Your reason: "${input.reason}". It stays in your company's history as withdrawn, with this reason; investors and Q stop treating it as your company's word. Nothing is deleted.`,
  }),
  done: (out) =>
    out.outcome === "ALREADY_WITHDRAWN"
      ? "That claim was already withdrawn, so nothing changed."
      : "Withdrawn. It stays in your history with your reason; investors no longer see it.",
  ownStatement: undoOwnStatement(),
  http: {
    method: "POST",
    path: "/v1/claims/:claimId/withdraw",
    fromRequest: (params, body) => ({
      ...(typeof body === "object" && body !== null ? body : {}),
      claimId: params["claimId"],
    }),
    respond,
  },
  tool: {
    name: "propose_withdraw_company_claim",
    description:
      'For a founder, about their own company: when they ask to withdraw, retract or take back a figure on their company\'s record ("withdraw the October MRR of 42,000, it came from a test deck"), prepare it for their approval with their reason. Never for a figure they are correcting with a new value (use propose_company_figure for that), never for another company. Nothing changes until they approve exactly this card; it is never deleted, only marked withdrawn. When they say undo (or take back) a figure you said you recorded from their words in this conversation, set undoesRecorded: Capital Q may then withdraw it at once (status DONE); say only what the tool returned.',
    input: WithdrawTool,
    references: {},
    scopes: ["COMPANY_PROFILE"],
    // Their own company's turn (the bound per request is full elsewhere).
    purposes: ["OWN_COMPANY_QUESTION"],
    eval: {
      say: [
        "Withdraw our October MRR figure, it came from a test deck.",
        "Take back the MRR of 42,000 for October; it was wrong.",
      ],
    },
    toCanonical: async (tool, context: AppActionContext, ports) => {
      const companyId = await ownCompany(ports, context.actor);
      if (companyId === null) return null;
      const { asOf } = statedFigurePeriod(tool.period);
      if (tool.period !== null && asOf === null) {
        return refusal("Which month is that figure for?");
      }
      const found = await withdrawableFigureClaims(
        withdrawals(ports),
        context.actor,
        companyId,
        { metric: tool.metric, asOf, amount: tool.amount },
      ).catch(() => null);
      if (found === null || found.length === 0) {
        return refusal(
          "I couldn't find that figure on your company's record, so there is nothing to withdraw.",
        );
      }
      const [only, ...others] = found;
      if (only === undefined || others.length > 0) {
        return refusal(
          `More than one figure matches: ${found
            .slice(0, 4)
            .map((claim) => quoted(claim.statement))
            .join("; ")}. Which one?`,
        );
      }
      return { claimId: only.id, reason: tool.reason, companyId };
    },
  },
});

export const CLAIM_WITHDRAW_ACTIONS = [WITHDRAW_CLAIM];
