import { createHash } from "node:crypto";

import {
  QArtifactIdSchema,
  QArtifactTypeSchema,
  QMessageIdSchema,
  QPlanBlockSchema,
  QRunIdSchema,
  type QResponseMessage,
  type QResultBlock,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { Logger } from "@capital-q/observability";
import {
  appendRunEvent,
  toQMessage,
  type QRuntimeRepositories,
} from "@capital-q/q-runtime";
import { TenantIdSchema, UserIdSchema } from "@capital-q/security";
import { z } from "zod";

import type { WorkforcePorts } from "./jobs.js";
import type { WorkRow } from "./queue.js";
import { doneOutputs, filedDocumentIds } from "./results.js";
import type { Owner } from "./store.js";

/**
 * Owner 2026-10-23: when deep work finishes, its document lands where it
 * was asked for -- in the conversation, as a card, with Q's summary of the
 * conclusion and the top three recommendations -- and as a notice. A job is
 * durable work, so a conversation that has moved on still gets it; it is
 * said once (the message's id is derived from the job).
 *
 * Every word is the document's own (its summary and recommendations, as
 * its author wrote them and the reviewer passed them) inside a fixed
 * sentence; nothing here is a new model call.
 */

const DeliverySchema = z.object({
  artifactId: z.string().uuid(),
  delivery: z.object({
    title: z.string().min(1).max(200),
    artifactType: z.string().min(1).max(48),
    summary: z.string().min(1).max(600),
    topRecommendations: z.array(z.string().min(1).max(300)).max(3),
    passed: z.boolean(),
    openIssues: z.number().int().min(0),
    reducedResearch: z.string().min(1).max(400).optional(),
  }),
});
export type DeliveredDocument = z.infer<typeof DeliverySchema>;

/** The finished job's analysis document, if it made one. */
export function deliveredDocument(
  row: Pick<WorkRow, "results">,
): DeliveredDocument | null {
  for (const outputs of doneOutputs(row)) {
    const parsed = DeliverySchema.safeParse(outputs);
    if (parsed.success) return parsed.data;
  }
  return null;
}

/**
 * Situation-first planning (S4): a finished plan job's result -- the plan
 * card and Q's line (code's words), or, when planning failed, the answer
 * Q gave from what it holds.
 */
const PlanDeliverySchema = z.union([
  z.object({
    plan: z.object({
      block: QPlanBlockSchema,
      line: z.string().min(1).max(2_000),
    }),
  }),
  z.object({
    answer: z.object({ line: z.string().min(1).max(4_000) }),
  }),
]);
export type DeliveredPlan = z.infer<typeof PlanDeliverySchema>;

export function deliveredPlan(
  row: Pick<WorkRow, "results">,
): DeliveredPlan | null {
  for (const outputs of doneOutputs(row)) {
    const parsed = PlanDeliverySchema.safeParse(outputs);
    if (parsed.success) return parsed.data;
  }
  return null;
}

const FailedPlanStepSchema = z.object({
  status: z.literal("FAILED"),
  outputs: z.object({
    answer: z.object({ line: z.string().min(1).max(4_000) }),
  }),
});

/**
 * A plan job that FAILED to make a plan, with the answer Q gave from what
 * it holds instead (addendum 3 rule 3): said once, as Q's answer, while
 * the job's own card shows where it stopped.
 */
export function failedPlanAnswer(
  row: Pick<WorkRow, "results" | "state">,
): DeliveredPlan | null {
  if (row.state !== "FAILED") return null;
  const parsed = FailedPlanStepSchema.safeParse(row.results["plan"]);
  return parsed.success ? { answer: parsed.data.outputs.answer } : null;
}

/**
 * Owner 2026-10-28: "it's done, here it is" -- the line that opens the
 * delivery says so, and the screen opens the document beside it.
 */
export function readyLine(title: string): string {
  return `Your ${title.replace(/[.\s]+$/u, "")} is ready — here it is.`;
}

/** What Q says when the document lands: 4-6 lines. */
export function deliveryText(document: DeliveredDocument): string {
  const { delivery } = document;
  const lines = [readyLine(delivery.title), delivery.summary.trim()];
  // Said before the conclusion is read as a full investigation.
  if (delivery.reducedResearch !== undefined)
    lines.push(delivery.reducedResearch.trim());
  if (delivery.topRecommendations.length > 0) {
    lines.push(
      `What I'd do first:\n${delivery.topRecommendations
        .map((one, index) => `${String(index + 1)}. ${one.trim()}`)
        .join("\n")}`,
    );
  }
  if (!delivery.passed && delivery.openIssues > 0) {
    lines.push(
      `${delivery.openIssues === 1 ? "One point" : `${String(delivery.openIssues)} points`} from my review ${delivery.openIssues === 1 ? "is" : "are"} still open; I've noted ${delivery.openIssues === 1 ? "it" : "them"} in the document.`,
    );
  }
  return lines.join("\n\n");
}

const PlanSummarySchema = z.object({
  summary: z.string().trim().min(1).max(400),
});

/**
 * F11 (coordinator 2026-10-25): a job that ended with no document said
 * nothing; the conversation kept "it moves to Done, with its document".
 * One short line: what did not get done and why, in plain words, and what
 * happens next. Its reason is the job's own (a step's summary or the
 * runner's), never a model's new words.
 */
export function endedWithoutDocumentText(
  row: Pick<WorkRow, "state" | "reason" | "plan">,
): string | null {
  // Only its one-line summary is needed; an older stored plan still has it.
  const plan = PlanSummarySchema.safeParse(row.plan);
  const what = plan.success
    ? plan.data.summary.trim().replace(/[.\s]+$/u, "")
    : "";
  const work =
    what.length === 0
      ? "That work"
      : `${what.charAt(0).toUpperCase()}${what.slice(1)}`;
  const why = (row.reason ?? "").trim().replace(/[.\s]+$/u, "");
  switch (row.state) {
    case "FAILED":
      return why.length === 0
        ? `${work} didn't finish: a step of the work failed, so there's no document. Ask me to try again, or ask for a shorter version I can answer here.`
        : `${work} didn't finish: ${why.charAt(0).toLowerCase()}${why.slice(1)}. There's no document; ask me to try again, or ask for a shorter version I can answer here.`;
    case "CANCELLED":
      return `${work} was stopped, so there's no document. Ask me again whenever you want it.`;
    case "BLOCKED":
      // Never started: its plan's limit, or a plan that couldn't run.
      return why.length === 0
        ? `${work} couldn't go ahead, so there's no document. Ask me again and I'll plan it afresh.`
        : `${work} couldn't go ahead: ${why.charAt(0).toLowerCase()}${why.slice(1)}.`;
    case "NEEDS_DECISION":
      return why.length === 0
        ? `${work} is on hold, waiting for you. Open it in Work to see what it needs.`
        : `${work} is on hold, waiting for this: ${why.charAt(0).toLowerCase()}${why.slice(1)}.`;
    case "PLANNED":
    case "AWAITING_AUTHORIZATION":
    case "QUEUED":
    case "RUNNING":
    case "RECOVERING":
    case "COMPLETED":
      // Not ended, or ended with its document: nothing to say here.
      return null;
  }
}

function messageIdFor(jobId: string, ending?: string) {
  const hex = createHash("sha256")
    .update(
      ending === undefined
        ? `workforce-delivery:${jobId}`
        : `workforce-ending:${jobId}:${ending}`,
    )
    .digest("hex");
  return QMessageIdSchema.parse(
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`,
  );
}

export function createWorkforceDelivery(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly runtime: Pick<
    QRuntimeRepositories,
    "runs" | "runEvents" | "messages"
  >;
  readonly notify: WorkforcePorts["notify"];
  readonly logger?: Logger | undefined;
  /**
   * Job 4d1a8b04 (QA 25 Oct): a plain document step records only its
   * artifact id, so it never had an analysis delivery and the thread was
   * told nothing. The filed documents, read as the job's owner (READY
   * only); absent, a plain document is not announced.
   */
  readonly filed?:
    | ((
        owner: Owner,
        organisationId: string | null,
        artifactIds: readonly string[],
      ) => Promise<
        readonly { artifactId: string; type: string; title: string }[]
      >)
    | undefined;
}) {
  /** One Q message on the job's own run, deduplicated by its id. */
  const post = async (
    owner: Owner,
    row: WorkRow,
    id: ReturnType<typeof messageIdFor>,
    text: string,
    blocks: readonly QResultBlock[] | undefined,
  ): Promise<boolean> => {
    const runId = QRunIdSchema.safeParse(row.trace.runId);
    if (!runId.success) return false;
    try {
      // The run is read as its owner: someone else's run is not found.
      const run = await dependencies.runtime.runs.findForActor(
        dependencies.sql,
        TenantIdSchema.parse(owner.tenantId),
        UserIdSchema.parse(owner.userId),
        runId.data,
      );
      if (run === null || run.conversationId === null) return false;
      const conversationId = run.conversationId;
      await dependencies.transactions.run(async (tx) => {
        const stored = await dependencies.runtime.messages.insert(tx, {
          id,
          tenantId: run.tenantId,
          conversationId,
          runId: run.id,
          role: "Q",
          content: text,
          ...(blocks === undefined ? {} : { blocks }),
        });
        await appendRunEvent(
          dependencies.runtime,
          tx,
          { id: run.id, tenantId: run.tenantId },
          {
            type: "q.message.completed",
            data: {
              message: {
                ...(toQMessage(stored) as QResponseMessage),
                ...(blocks === undefined ? {} : { blocks: [...blocks] }),
              },
            },
          },
        );
      });
      return true;
    } catch (error: unknown) {
      // Most often: already said (the message id is the job's).
      dependencies.logger?.info(
        { err: error, jobId: row.job_id },
        "workforce delivery not posted to the conversation",
      );
      return false;
    }
  };

  /** A finished job's plain document: one line and its card. */
  const announceFiled = async (owner: Owner, row: WorkRow) => {
    const ids = filedDocumentIds(row);
    if (dependencies.filed === undefined || ids.length === 0) return false;
    const filed = (
      await dependencies
        .filed(owner, row.trace.organisationId ?? null, ids)
        .catch(() => [])
    )[0];
    const type = QArtifactTypeSchema.safeParse(filed?.type);
    if (filed === undefined || !type.success) return false;
    const title = filed.title.slice(0, 160);
    const text = readyLine(title);
    const posted = await post(owner, row, messageIdFor(row.job_id), text, [
      {
        kind: "ARTIFACT_REFERENCE",
        artifactId: QArtifactIdSchema.parse(filed.artifactId),
        type: type.data,
        status: "READY",
        title,
      },
      { kind: "WORK_IN_PROGRESS", jobId: row.job_id, title },
    ]);
    await dependencies
      .notify(owner, {
        key: `wf:${row.job_id}:delivered`,
        title: `${title.slice(0, 150)} is ready`,
        body: text,
      })
      .catch(() => undefined);
    dependencies.logger?.info(
      { jobId: row.job_id, posted },
      "workforce document delivered",
    );
    return posted;
  };

  /** A plan job's card (or its answer from what Q holds), said once. */
  const announcePlan = async (
    owner: Owner,
    row: WorkRow,
    delivered: DeliveredPlan,
  ): Promise<boolean> => {
    const title =
      "plan" in delivered ? delivered.plan.block.title : "Where things stand";
    const text =
      "plan" in delivered ? delivered.plan.line : delivered.answer.line;
    const blocks: QResultBlock[] = [
      ...("plan" in delivered ? [delivered.plan.block] : []),
      {
        kind: "WORK_IN_PROGRESS",
        jobId: row.job_id,
        title: title.slice(0, 160),
      },
    ];
    const posted = await post(
      owner,
      row,
      messageIdFor(row.job_id),
      text,
      blocks,
    );
    await dependencies
      .notify(owner, {
        key: `wf:${row.job_id}:delivered`,
        title:
          "plan" in delivered ? "Your plan is ready" : "Q's answer is ready",
        body: text.slice(0, 600),
      })
      .catch(() => undefined);
    dependencies.logger?.info({ jobId: row.job_id, posted }, "plan delivered");
    return posted;
  };

  return async (owner: Owner, row: WorkRow): Promise<boolean> => {
    const plan =
      row.state === "COMPLETED" ? deliveredPlan(row) : failedPlanAnswer(row);
    if (plan !== null) return announcePlan(owner, row, plan);
    const document = deliveredDocument(row);
    if (document === null && row.state === "COMPLETED") {
      return announceFiled(owner, row);
    }
    if (document === null) {
      const ended = endedWithoutDocumentText(row);
      if (ended === null) return false;
      const posted = await post(
        owner,
        row,
        messageIdFor(row.job_id, row.state),
        ended,
        undefined,
      );
      await dependencies
        .notify(owner, {
          key: `wf:${row.job_id}:${row.state.toLowerCase()}`,
          title: ended.split(":")[0]?.slice(0, 150) ?? "Q's work",
          body: ended.slice(0, 600),
        })
        .catch(() => undefined);
      dependencies.logger?.info(
        { jobId: row.job_id, state: row.state, posted },
        "workforce job ended without a document; said so",
      );
      return posted;
    }
    const text = deliveryText(document);
    const block: QResultBlock = {
      kind: "ARTIFACT_REFERENCE",
      artifactId: QArtifactIdSchema.parse(document.artifactId),
      type: QArtifactTypeSchema.parse(document.delivery.artifactType),
      status: "READY",
      title: document.delivery.title.slice(0, 160),
    };
    // Owner 2026-10-24: the same job's card, so the screen turns the card
    // that followed the work into this document instead of showing two.
    // The document reference stays first: what reads Q's last answer for
    // its document (save it, break it into tasks) reads it unchanged.
    const blocks: readonly QResultBlock[] = [
      block,
      {
        kind: "WORK_IN_PROGRESS",
        jobId: row.job_id,
        title: document.delivery.title.slice(0, 160),
      },
    ];
    const posted = await post(
      owner,
      row,
      messageIdFor(row.job_id),
      text,
      blocks,
    );
    await dependencies
      .notify(owner, {
        key: `wf:${row.job_id}:delivered`,
        title: `${document.delivery.title.slice(0, 150)} is ready`,
        body: document.delivery.summary.slice(0, 600),
      })
      .catch(() => undefined);
    dependencies.logger?.info(
      { jobId: row.job_id, posted },
      "workforce document delivered",
    );
    return posted;
  };
}

export type WorkforceDelivery = ReturnType<typeof createWorkforceDelivery>;
