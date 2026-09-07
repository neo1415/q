import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import {
  QMessageIdSchema,
  type QResponseMessage,
  type QVisibleStage,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import {
  appendRunEvent,
  toQMessage,
  type QAnswerOutcome,
  type QAnswerPort,
  type QLiveDeltaBus,
  type QRuntimeRepositories,
} from "@capital-q/q-runtime";

/**
 * DEV AND TEST ONLY. A Q answer that streams (CQ-Q-009 §88, §103).
 *
 * No configured provider streams today and the real answer is a
 * structured call, so nothing in production publishes a delta. This port
 * shows what the transport does when something does: it names the message
 * up front, publishes its text as live deltas through the delta bus, then
 * persists the message together with its durable `q.message.completed`
 * event in one transaction — exactly the shape a streaming-capable seam
 * would follow. The text is labelled synthetic; it is never Q's judgment.
 */

export const SYNTHETIC_STREAM_TEXT =
  "This is a synthetic Q answer produced for the stream smoke. It arrives " +
  "as live text, then as one persisted message. Nothing here is analysis of " +
  "a real company, and no model was called.";

export type SyntheticStreamAnswerOptions = {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly repositories: Pick<
    QRuntimeRepositories,
    "messages" | "runs" | "runEvents"
  >;
  readonly deltas?: QLiveDeltaBus | undefined;
  readonly text?: string | undefined;
  /** Pause between deltas, so a watcher can see text arrive. */
  readonly deltaDelayMs?: number | undefined;
  /** Number of deltas the text is cut into. */
  readonly chunks?: number | undefined;
  /** An approved stage recorded before the text, as a tool run would. */
  readonly stage?: QVisibleStage | null | undefined;
  /** Test-only: text held in the port's own state, never emitted. */
  readonly internalNote?: string | undefined;
};

export type SyntheticStreamAnswer = QAnswerPort & {
  /** How many answers were produced; one per run, whatever the subscriber count. */
  readonly calls: () => number;
};

export function createSyntheticStreamAnswer(
  options: SyntheticStreamAnswerOptions,
): SyntheticStreamAnswer {
  const { sql, transactions, repositories, deltas } = options;
  const text = options.text ?? SYNTHETIC_STREAM_TEXT;
  const delay = options.deltaDelayMs ?? 120;
  const chunkCount = Math.max(1, options.chunks ?? 6);
  const stage =
    options.stage === undefined ? "REVIEWING_COMPANY" : options.stage;
  const internal = { note: options.internalNote ?? "" };
  let calls = 0;

  return {
    calls: () => calls,
    answer: async (request): Promise<QAnswerOutcome> => {
      calls += 1;
      void internal;
      const history = await repositories.messages.listForRun(
        sql,
        request.tenantId,
        request.runId,
        8,
      );
      const conversationId = history[0]?.conversationId;
      if (conversationId === undefined) {
        return { kind: "FAILED", diagnosticCode: "INTERNAL_ERROR" };
      }
      if (stage !== null) {
        await transactions.run((tx) =>
          appendRunEvent(
            repositories,
            tx,
            { id: request.runId, tenantId: request.tenantId },
            { type: "q.stage.changed", data: { stage } },
          ),
        );
      }
      const messageId = QMessageIdSchema.parse(randomUUID());
      const size = Math.ceil(text.length / chunkCount);
      for (let i = 0; i < text.length; i += size) {
        if (request.signal?.aborted === true) {
          return { kind: "FAILED", diagnosticCode: "RUN_CANCELLED" };
        }
        deltas?.publish({
          runId: request.runId,
          tenantId: request.tenantId,
          messageId,
          text: text.slice(i, i + size),
        });
        await sleep(delay);
      }
      if (request.signal?.aborted === true) {
        return { kind: "FAILED", diagnosticCode: "RUN_CANCELLED" };
      }
      const message = await transactions.run(async (tx) => {
        const stored = await repositories.messages.insert(tx, {
          id: messageId,
          tenantId: request.tenantId,
          conversationId,
          runId: request.runId,
          role: "Q",
          content: text,
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
      return {
        kind: "ANSWERED",
        messageId: message.id,
        modelPolicyVersion: "synthetic-stream",
        promptBundleVersion: "synthetic-stream",
      };
    },
  };
}
