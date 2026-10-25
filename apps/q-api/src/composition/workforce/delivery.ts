import { createHash } from "node:crypto";

import {
  QArtifactIdSchema,
  QArtifactTypeSchema,
  QMessageIdSchema,
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

/** What Q says when the document lands: 4-6 lines. */
export function deliveryText(document: DeliveredDocument): string {
  const { delivery } = document;
  const lines = [
    `Your ${delivery.title.replace(/[.\s]+$/u, "")} is ready.`,
    delivery.summary.trim(),
  ];
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

/**
 * The one line a job's end leaves in the conversation when it filed no
 * analysis: the document's name, or why there is none; "" when they
 * stopped it themselves (they know).
 */
export function followUpLine(
  row: Pick<WorkRow, "state" | "reason">,
  documentTitle: string | null,
): string {
  const why = row.reason?.trim().replace(/\.$/u, "") ?? "";
  switch (row.state) {
    case "COMPLETED":
      return documentTitle === null
        ? "That work is done."
        : `Your ${documentTitle.replace(/[.\s]+$/u, "")} is ready.`;
    case "NEEDS_DECISION":
    case "BLOCKED":
      return why === ""
        ? "That work is waiting for you before it can go on."
        : `That work is waiting for you: ${why}.`;
    case "FAILED":
      return why === ""
        ? "I couldn't finish that work, so there is no document."
        : `I couldn't finish that work, so there is no document: ${why}.`;
    // Stopped by the person (they know), or not ended yet: nothing to say.
    case "CANCELLED":
    case "QUEUED":
    case "PLANNED":
    case "AWAITING_AUTHORIZATION":
    case "RUNNING":
    case "RECOVERING":
      return "";
  }
}

function messageIdFor(jobId: string) {
  const hex = createHash("sha256")
    .update(`workforce-delivery:${jobId}`)
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
   * QA F-117: the READY documents a finished job filed that are not an
   * analysis delivery, as the owner may read them. Absent: none found.
   */
  readonly filed?:
    | ((
        owner: Owner,
        organisationId: string | null,
        artifactIds: readonly string[],
      ) => Promise<
        readonly {
          readonly artifactId: string;
          readonly type: string;
          readonly title: string;
        }[]
      >)
    | undefined;
}) {
  /** One message for the job, in the conversation its run belongs to. */
  const post = async (
    owner: Owner,
    row: WorkRow,
    text: string,
    blocks: readonly QResultBlock[],
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
          id: messageIdFor(row.job_id),
          tenantId: run.tenantId,
          conversationId,
          runId: run.id,
          role: "Q",
          content: text,
          blocks,
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
                blocks: [...blocks],
              },
            },
          },
        );
      });
      return true;
    } catch (error: unknown) {
      // Most often: already delivered (the message id is the job's).
      dependencies.logger?.info(
        { err: error, jobId: row.job_id },
        "workforce delivery not posted to the conversation",
      );
      return false;
    }
  };

  /**
   * QA F-117 (25 Oct 2026): "On it. Starting now" was followed by neither
   * a document nor a clear failure when the job filed a plain document or
   * stopped. Every job that ends says so, once, in the conversation: the
   * document it filed, or in plain words why there is none.
   */
  const followUp = async (owner: Owner, row: WorkRow): Promise<boolean> => {
    const card: QResultBlock = {
      kind: "WORK_IN_PROGRESS",
      jobId: row.job_id,
      title: "Q's work",
    };
    if (row.state === "COMPLETED") {
      const ids = filedDocumentIds(row);
      const [document] =
        ids.length === 0 || dependencies.filed === undefined
          ? []
          : await dependencies
              .filed(owner, row.trace.organisationId ?? null, ids)
              .catch(() => []);
      const type = QArtifactTypeSchema.safeParse(document?.type);
      if (document !== undefined && type.success) {
        const title = document.title.slice(0, 160);
        return post(owner, row, followUpLine(row, title), [
          {
            kind: "ARTIFACT_REFERENCE",
            artifactId: QArtifactIdSchema.parse(document.artifactId),
            type: type.data,
            status: "READY",
            title,
          },
          { ...card, title },
        ]);
      }
    }
    const line = followUpLine(row, null);
    return line === "" ? false : post(owner, row, line, [card]);
  };

  return async (owner: Owner, row: WorkRow): Promise<boolean> => {
    const document = deliveredDocument(row);
    if (document === null) return followUp(owner, row);
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
    const posted = await post(owner, row, text, blocks);
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
