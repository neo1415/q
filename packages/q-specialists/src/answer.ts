import type { QResponseMessage, QVisibleStage } from "@capital-q/contracts";
import { withoutRecommendationClaims } from "@capital-q/q-core";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { Logger } from "@capital-q/observability";
import {
  appendRunEvent,
  toQMessage,
  type QAnswerOutcome,
  type QAnswerPort,
  type QAnswerRequest,
  type QRuntimeRepositories,
} from "@capital-q/q-runtime";

import type { QSpecialist, QSpecialistProbe } from "./contracts.js";
import type {
  CompanyIntelligenceRequest,
  CompanyIntelligenceResult,
} from "./company/contracts.js";
import { asksAboutGaps } from "./company/dimensions.js";

/**
 * How a specialist reaches Q (CQ-Q-020 §11, §53, §56, §91).
 *
 * This implements the runtime's existing answer seam, so the investigation
 * graph, the Context Firewall, the run lifecycle and the stream are all
 * untouched. Q asks for an answer; if the Company Intelligence specialist
 * is the right one for the request it produces findings and a synthesis,
 * and Q writes the message. If it is not, the request goes to the
 * delegate — today the conversational answer path — exactly as before.
 *
 *   QOrchestrator → answer seam → supports()? → specialist → findings
 *                                            ↘ no → delegate
 *
 * A person never learns any of this happened. Nothing written here carries
 * the specialist's id, its version, the provider, the prompt bundle or a
 * word of reasoning: those live in the trace and the telemetry, which is
 * where explainability belongs and where a person's message does not (§55,
 * §57, §91, §103).
 */

export type SpecialistQAnswerDependencies = {
  readonly specialist: QSpecialist<
    CompanyIntelligenceRequest,
    CompanyIntelligenceResult
  >;
  /** Where a request this specialist does not support goes. */
  readonly delegate: QAnswerPort;
  readonly repositories: QRuntimeRepositories;
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly logger?: Logger | undefined;
};

export type SpecialistQAnswer = QAnswerPort & {
  /** The last investigation, for developer smokes and evals. Never a public path. */
  readonly lastResult: () => CompanyIntelligenceResult | null;
};

const ANSWER_LIMIT_CHARS = 32_000;

/**
 * What a person reads when the specialist could not produce findings.
 *
 * Plain English, and specific enough to be useful without naming a
 * provider, a schema, a policy code or a table (§105). "No eligible route"
 * is deliberately not phrased as an outage: refusing to send private
 * material to an unsuitable provider is Capital Q working, not failing.
 */
function publicBlockedMessage(
  reason: NonNullable<CompanyIntelligenceResult["blocked"]>,
): string {
  switch (reason) {
    case "NO_AUTHORISED_SUBJECT":
      return "I don't have access to that company's information in this conversation, so I can't analyse it.";
    case "NO_ELIGIBLE_MODEL_ROUTE":
      return "Some of the information involved is too sensitive to send for analysis with the options available right now, so I've stopped rather than work around it. I can still answer from what's already recorded if you'd like to ask something narrower.";
    case "MODEL_UNAVAILABLE":
      return "I couldn't get a full review through just now. I can still answer from what's already recorded, read a website you point me at, or you can ask again in a moment.";
    case "MODEL_OUTPUT_REJECTED":
      return "I couldn't put together a reliable answer from the available information this time.";
    case "CANCELLED":
      return "I stopped before finishing that analysis.";
  }
}

/**
 * A last-resort answer built from findings alone, for the case where the
 * model produced findings but no usable prose.
 *
 * Deterministic and dull on purpose: it is better for Q to state what it
 * found in flat sentences than to say nothing, and better still that this
 * path is obviously not the normal one.
 */
function synthesisFromFindings(result: CompanyIntelligenceResult): string {
  const lines: string[] = [];
  const byType = (type: string): readonly string[] =>
    result.findings
      .filter((finding) => finding.type === type)
      .map((finding) => `- ${finding.statement}`);
  const sections: readonly (readonly [string, readonly string[]])[] = [
    ["What the evidence shows", [...byType("FACT"), ...byType("OBSERVATION")]],
    ["What looks strong", byType("STRENGTH")],
    ["What needs attention", byType("RISK")],
    ["What is uncertain", byType("UNCERTAINTY")],
    ["What we don't know", byType("GAP")],
  ];
  for (const [heading, items] of sections) {
    if (items.length > 0) {
      lines.push(`**${heading}**`, ...items, "");
    }
  }
  return lines.length === 0
    ? "I don't have enough information about this company to say anything useful yet."
    : lines.join("\n").trim();
}

export function createSpecialistQAnswer(
  dependencies: SpecialistQAnswerDependencies,
): SpecialistQAnswer {
  const { specialist, delegate, repositories, sql, transactions, logger } =
    dependencies;
  let last: CompanyIntelligenceResult | null = null;

  /** Approved progress only; best effort, never a reason to fail the answer. */
  async function showStage(
    request: QAnswerRequest,
    stage: QVisibleStage,
  ): Promise<void> {
    try {
      await transactions.run((tx) =>
        appendRunEvent(
          repositories,
          tx,
          { id: request.runId, tenantId: request.tenantId },
          { type: "q.stage.changed", data: { stage } },
        ),
      );
    } catch (error: unknown) {
      logger?.warn(
        { err: error, qRunId: request.runId },
        "q specialist stage event not recorded",
      );
    }
  }

  return {
    lastResult: () => last,
    answer: async (request: QAnswerRequest): Promise<QAnswerOutcome> => {
      const history = await repositories.messages.listForRun(
        sql,
        request.tenantId,
        request.runId,
        64,
      );
      const conversationId = history[0]?.conversationId;
      const latest = [...history].reverse().find((m) => m.role === "USER");
      if (conversationId === undefined || latest === undefined) {
        return { kind: "FAILED", diagnosticCode: "INTERNAL_ERROR" };
      }

      const probe: QSpecialistProbe = {
        capability: request.capability,
        subjects: request.subjects,
        question: latest.content,
      };
      if (!specialist.supports(probe)) {
        return delegate.answer(request);
      }
      const company = request.subjects.find(
        (subject) => subject.kind === "COMPANY",
      );
      if (company === undefined || company.kind !== "COMPANY") {
        return delegate.answer(request);
      }

      last = null;
      const result = await specialist.investigate(
        {
          company,
          question: latest.content,
          // A gap question changes what is emphasised, never what is read.
          ...(asksAboutGaps(latest.content)
            ? { focus: ["GAPS"] as const }
            : {}),
        },
        {
          actor: request.actor,
          runId: request.runId,
          correlationId: request.correlationId,
          capability: request.capability,
          plan: request.plan,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
          showStage: (stage) => showStage(request, stage),
        },
      );
      last = result;

      if (result.blocked === "CANCELLED") {
        return { kind: "FAILED", diagnosticCode: "RUN_CANCELLED" };
      }
      // Last surface before a person reads it (CQ-Q-023). Capital Q has no
      // deterministic recommendation factors yet, so a sentence explaining
      // why something was recommended, ranked or matched was invented — and
      // the prompt forbidding it is not what stops it reaching an investor.
      // A model route that is out is not the end of the answer: what the
      // deterministic pass computed still stands, and saying it beats an
      // apology. Only when nothing was computed does the person hear why.
      const degraded =
        result.blocked === "MODEL_UNAVAILABLE" && result.findings.length > 0;
      const guarded = withoutRecommendationClaims(
        degraded
          ? `${synthesisFromFindings(result)}\n\nThat is what's on record; the fuller review didn't come through this time, so ask again in a moment for more.`
          : result.blocked !== null
            ? publicBlockedMessage(result.blocked)
            : (result.synthesis ?? synthesisFromFindings(result)),
      );
      if (guarded.removed > 0) {
        logger?.warn(
          { qRunId: request.runId, removed: guarded.removed },
          "recommendation claims removed from a Q answer",
        );
      }
      // What the person stated about their own company was recorded as
      // their claim (CQ-Q-RESEARCH-001 §21, §40); the answer says so, in
      // Capital Q's words, deterministically.
      const acknowledgement =
        result.recordedStatements.length === 0
          ? ""
          : `\n\nNoted as your statement: ${result.recordedStatements
              .map((statement) => `\u201c${statement}\u201d`)
              .join(
                "; ",
              )}. Capital Q records it as what you told me, not as verified fact; say so if it needs correcting.`;
      const content = `${guarded.text}${acknowledgement}`
        .slice(0, ANSWER_LIMIT_CHARS)
        .trim();
      if (content.length === 0) {
        return { kind: "FAILED", diagnosticCode: "MODEL_PROVIDER_UNAVAILABLE" };
      }

      // The message and its durable completion event commit together
      // (CQ-Q-009 §16-§18), so a client that missed every live delta
      // converges on this text.
      const message = await transactions.run(async (tx) => {
        const stored = await repositories.messages.insert(tx, {
          tenantId: request.tenantId,
          conversationId,
          runId: request.runId,
          role: "Q",
          content,
        });
        await appendRunEvent(
          repositories,
          tx,
          { id: request.runId, tenantId: request.tenantId },
          {
            type: "q.message.completed",
            data: { message: toQMessage(stored) as QResponseMessage },
          },
        );
        return stored;
      });

      logger?.debug(
        {
          qRunId: request.runId,
          findings: result.findings.length,
          blocked: result.blocked,
        },
        "specialist answer recorded",
      );

      return {
        kind: "ANSWERED",
        messageId: message.id,
        modelPolicyVersion: result.telemetry.routingPolicyCode ?? "none",
        promptBundleVersion: result.telemetry.promptBundleVersion ?? "none",
      };
    },
  };
}
