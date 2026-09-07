import { randomUUID } from "node:crypto";

import {
  QStreamEventSchema,
  type QStreamEvent,
  type QVisibleStage,
} from "@capital-q/contracts";
import type { TransactionContext } from "@capital-q/database";

import type { QRunEventRecord, QRunRecord } from "../contracts/index.js";
import { QRunNotFoundError } from "../domain/errors.js";
import type { QRuntimeRepositories } from "./ports.js";

/**
 * A run event to append, in the public stream vocabulary minus what the
 * runtime assigns (identity, sequence, time).
 */
export type QRunEventInput = {
  readonly [T in QStreamEvent["type"]]: {
    readonly type: T;
    readonly data: Extract<QStreamEvent, { type: T }>["data"];
  };
}[QStreamEvent["type"]];

/**
 * Append one durable run event.
 *
 * Sequence first, under the run's row lock, then the row: two concurrent
 * appends to one run serialise on that lock and receive consecutive
 * numbers, and the unique (run_id, sequence) constraint is the final
 * arbiter if anything else ever tried to write one.
 *
 * The event is assembled as a complete stream event and parsed against the
 * contract before it is written, so the store can never hold a payload the
 * stream could not later replay, and nothing outside the stream vocabulary
 * — a reasoning trace, a prompt, a message body — has a place to go.
 */
export async function appendRunEvent(
  repositories: Pick<QRuntimeRepositories, "runs" | "runEvents">,
  tx: TransactionContext,
  run: Pick<QRunRecord, "id" | "tenantId">,
  input: QRunEventInput,
): Promise<QRunEventRecord> {
  const sequence = await repositories.runs.allocateEventSequence(
    tx,
    run.tenantId,
    run.id,
  );
  if (sequence === null) {
    throw new QRunNotFoundError();
  }

  const event = QStreamEventSchema.parse({
    contractVersion: 1,
    eventId: randomUUID(),
    runId: run.id,
    sequence,
    occurredAt: new Date().toISOString(),
    type: input.type,
    data: input.data,
  });

  const visibleStage: QVisibleStage | null =
    event.type === "q.stage.changed" ? event.data.stage : null;

  return repositories.runEvents.append(tx, {
    tenantId: run.tenantId,
    runId: run.id,
    sequence: event.sequence,
    eventType: event.type,
    visibleStage,
    payload: event.data,
  });
}
