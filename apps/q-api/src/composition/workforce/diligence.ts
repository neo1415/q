import { randomUUID } from "node:crypto";

import {
  CorrelationIdSchema,
  isMatchedRelationshipState,
  QRunIdSchema,
  type QSubjectRef,
  type QConversationId,
} from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import type { QActionService } from "@capital-q/q-actions";
import { DILIGENCE_QUESTION_SENT_MAX_LENGTH } from "@capital-q/q-core";
import {
  runRef,
  type ContextFirewallPort,
  type QOrchestrationRuntime,
  type QRuntimeService,
} from "@capital-q/q-runtime";
import type { ArtifactPreparation } from "@capital-q/q-specialists";
import type { ActorContext } from "@capital-q/security";

import { critiqueText } from "./documents.js";
import type { WorkforceModels } from "./models.js";

/**
 * A workforce card's run: begun under its own version, never the
 * conversational engine's, so the approval goes straight through the
 * Approval Engine's execution gate (as standing instructions' cards do).
 */
export const WORKFORCE_CARD_ORCHESTRATION_VERSION = "q-workforce-card-v1";
/** Rewrite rounds for questions over the send limit: the first, and one for any still over. */
export const DILIGENCE_SHORTEN_ROUNDS = 2;

export type WorkforceDiligenceInput = {
  readonly canContinue: () => Promise<boolean>;
  readonly goal: string;
  readonly qRunId: string;
  readonly jobId: string;
  readonly stepKey: string;
  readonly runId: string;
  readonly organisationId: string;
  /** The document the questions draw on, from the step it waits on. */
  readonly source: { readonly artifactId: string; readonly companyId: string };
  /** The critic's missing-information and risk findings, when there was one. */
  readonly critique: readonly string[];
};

export type WorkforceDiligenceResult =
  | {
      readonly status: "CARDED";
      readonly questions: readonly string[];
      readonly qActionId: string;
    }
  | {
      /** Prepared, kept with the job: no connection to send them through yet. */
      readonly status: "PREPARED";
      readonly questions: readonly string[];
    }
  | { readonly status: "FAILED" | "UNAVAILABLE"; readonly message: string };

/**
 * DILIGENCE (2026-10-12): founder questions from a prepared document's
 * gaps and its critique, filed as the person's own approval card for the
 * existing diligence.questions.send action. Q never sends them: the card
 * does, once they approve exactly these words, through the action's own
 * authorize step. Every read is authorised again as the person.
 */
export function createWorkforceDiligence(dependencies: {
  readonly freshActor: (actor: ActorContext) => Promise<ActorContext | null>;
  readonly firewall: ContextFirewallPort;
  readonly currentVersion: ArtifactPreparation["port"]["currentVersion"];
  readonly questions: WorkforceModels["diligenceQuestions"];
  /** The one bounded repair for drafted questions over the send limit. */
  readonly shorten: WorkforceModels["shortenDiligenceQuestions"];
  readonly logger?: Pick<Logger, "info" | "warn"> | undefined;
  readonly relationshipWith: (
    actor: ActorContext,
    companyId: string,
  ) => Promise<{
    readonly relationshipId: string;
    readonly state: string;
  } | null>;
  readonly runtime: Pick<QRuntimeService, "createRun">;
  /** Owned runtime read; a background card remains in its original Q conversation. */
  readonly conversationForRun: (
    actor: ActorContext,
    runId: string,
  ) => Promise<QConversationId>;
  readonly orchestration: Pick<
    QOrchestrationRuntime,
    "begin" | "advanceThrough" | "fail" | "complete"
  >;
  readonly actions: Pick<QActionService, "propose">;
}) {
  async function file(
    actor: ActorContext,
    input: WorkforceDiligenceInput,
    card: {
      readonly relationshipId: string;
      readonly questions: readonly string[];
      readonly about: readonly string[];
      readonly companyName: string;
    },
  ): Promise<string> {
    const key = `workforce:${input.jobId}:${input.stepKey}`.slice(0, 200);
    const correlationId = CorrelationIdSchema.parse(`cor_${randomUUID()}`);
    const conversationId = await dependencies.conversationForRun(
      actor,
      input.qRunId,
    );
    const created = await dependencies.runtime.createRun({
      actor,
      input: {
        conversationId,
        capability: "PREPARE_ACTION",
        message: {
          text: `Questions for ${card.companyName}, prepared by Q for your approval.`.slice(
            0,
            1_000,
          ),
        },
        modality: "TEXT",
      },
      idempotencyKey: key,
      correlationId,
    });
    const ref = runRef(created.run);
    try {
      if (created.created) {
        await dependencies.orchestration.begin(
          ref,
          WORKFORCE_CARD_ORCHESTRATION_VERSION,
        );
        await dependencies.orchestration.advanceThrough(ref, [
          "CONTEXT_RESOLUTION",
          "POLICY_CHECK",
          "PLANNING",
          "SYNTHESIS",
        ]);
      }
      const proposed = await dependencies.actions.propose({
        actor,
        runId: created.run.id,
        correlationId,
        actionType: "app.diligence.questions.send",
        payload: {
          relationshipId: card.relationshipId,
          // One send per approved card: a retry of the approval sends once.
          idempotencyKey: `${key}:send`,
          input: {
            questions: [...card.questions],
            // What each settles, so the founder sees why it is asked.
            about: card.about.map((label, index) => ({
              assumptionId: `MEMO_GAP:${String(index)}`,
              label: label.slice(0, 120),
            })),
          },
        },
      });
      if (
        created.created &&
        (proposed.existing === true || proposed.alreadyDone !== undefined)
      ) {
        await dependencies.orchestration.complete(ref).catch(() => undefined);
      }
      return proposed.action.id;
    } catch (error: unknown) {
      await dependencies.orchestration
        .fail(ref, "INTERNAL_ERROR")
        .catch(() => undefined);
      throw error;
    }
  }

  return async (
    input: WorkforceDiligenceInput & { readonly actor: ActorContext },
  ): Promise<WorkforceDiligenceResult> => {
    const unavailable = (message: string): WorkforceDiligenceResult => ({
      status: "UNAVAILABLE",
      message,
    });
    if (
      input.actor.organisationId !== input.organisationId ||
      !(await input.canContinue())
    )
      return unavailable("Diligence work stopped before it started.");
    const actor = await dependencies.freshActor(input.actor);
    if (
      actor === null ||
      actor.userId !== input.actor.userId ||
      actor.tenantId !== input.actor.tenantId ||
      actor.organisationId !== input.organisationId
    )
      return unavailable("This can no longer be done as you.");
    const subject: Extract<QSubjectRef, { kind: "COMPANY" }> = {
      kind: "COMPANY",
      companyId: input.source.companyId,
    };
    const decision = await dependencies.firewall.plan({
      actor,
      runId: QRunIdSchema.parse(input.qRunId),
      correlationId: CorrelationIdSchema.parse(`cor_${randomUUID()}`),
      capability: "ANSWER",
      subjects: [subject],
    });
    if (decision.outcome !== "AUTHORISED")
      return unavailable("This company can no longer be read as you.");
    const current = await dependencies.currentVersion(
      actor,
      input.source.artifactId,
    );
    if (current === null)
      return unavailable("The document can no longer be read as you.");
    const companyName = current.title.split(/\s+[—–-]\s+/u)[0] ?? current.title;
    const drafted = await dependencies.questions(
      { tenantId: actor.tenantId, userId: actor.userId },
      { jobId: input.jobId, runId: input.runId },
      {
        companyName: companyName.slice(0, 120) || "the company",
        purpose: input.goal.slice(0, 600),
        gaps:
          current.content.gaps
            .map((gap) => `- ${gap}`)
            .join("\n")
            .slice(0, 4_000) || "(none stated)",
        critique:
          input.critique
            .map((line) => `- ${line}`)
            .join("\n")
            .slice(0, 4_000) || "(no critique)",
        document: critiqueText(current.content).slice(0, 16_000),
      },
    );
    const notDrafted: WorkforceDiligenceResult = {
      status: "FAILED",
      message: "The questions could not be drafted; nothing was filed.",
    };
    if (drafted === null) return notDrafted;
    const questions = drafted.questions.map((one) => one.question);
    const about = drafted.questions.map((one) => one.about);
    // A question over the send limit is never cut and never filed: those
    // questions alone are rewritten shorter with the same meaning. A
    // rewrite still over the limit is asked for once more on its own
    // (live 2026-10-29: one still-long rewrite refused the whole object
    // twice, and the step lost every question). At most two rounds.
    const overLimit = () =>
      questions.flatMap((question, index) =>
        question.length > DILIGENCE_QUESTION_SENT_MAX_LENGTH ? [index] : [],
      );
    const drafted0 = overLimit().length;
    let rounds = 0;
    for (
      let tooLong = overLimit();
      tooLong.length > 0 && rounds < DILIGENCE_SHORTEN_ROUNDS;
      tooLong = overLimit()
    ) {
      rounds += 1;
      const shortened = await dependencies.shorten(
        { tenantId: actor.tenantId, userId: actor.userId },
        { jobId: input.jobId, runId: input.runId },
        {
          companyName: companyName.slice(0, 120) || "the company",
          questions: tooLong.map((index) => questions[index] ?? ""),
        },
      );
      // One rewrite per question asked, or none: a merged or dropped
      // question would change what the investor approves.
      if (shortened === null || shortened.length !== tooLong.length) break;
      tooLong.forEach((index, at) => {
        const rewrite = shortened[at];
        // Only a rewrite that is shorter replaces the question.
        if (
          rewrite !== undefined &&
          rewrite.length < (questions[index] ?? "").length
        ) {
          questions[index] = rewrite;
        }
      });
    }
    if (drafted0 > 0) {
      // Counts only: never a question's words.
      const counts = {
        jobId: input.jobId,
        drafted: questions.length,
        overLimit: drafted0,
        rounds,
        repaired: overLimit().length === 0,
      };
      if (!counts.repaired) {
        dependencies.logger?.warn(
          counts,
          "diligence questions over the send limit could not be shortened",
        );
        return notDrafted;
      }
      dependencies.logger?.info(
        counts,
        "diligence questions over the send limit rewritten shorter",
      );
    }
    // The send action's own limit, checked again before anything is filed.
    if (
      questions.some(
        (question) =>
          question.length < 3 ||
          question.length > DILIGENCE_QUESTION_SENT_MAX_LENGTH,
      )
    )
      return notDrafted;
    if (!(await input.canContinue()))
      return unavailable("Diligence work stopped before the card was filed.");
    const relationship = await dependencies
      .relationshipWith(actor, input.source.companyId)
      .catch(() => null);
    if (
      relationship === null ||
      !isMatchedRelationshipState(relationship.state)
    )
      return { status: "PREPARED", questions };
    const qActionId = await file(actor, input, {
      relationshipId: relationship.relationshipId,
      questions,
      about,
      companyName,
    });
    return { status: "CARDED", questions, qActionId };
  };
}
