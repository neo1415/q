import { randomUUID } from "node:crypto";

import {
  QStreamEventSchema,
  type QStreamEvent,
  type QVisibleStage,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";

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
 * S2: one run event in ONE statement, on the request client, when the store
 * can append atomically (`appendNext`); no transaction around it. Returns
 * null when the store cannot, so the caller falls back to a transaction and
 * `appendRunEvent`. The same contract parse as `appendRunEvent` runs first.
 */
export async function appendRunEventAtomic(
  repositories: Pick<QRuntimeRepositories, "runEvents">,
  executor: DatabaseExecutor,
  run: Pick<QRunRecord, "id" | "tenantId">,
  input: QRunEventInput,
): Promise<QRunEventRecord | null | "UNSUPPORTED"> {
  const appendNext = repositories.runEvents.appendNext;
  if (appendNext === undefined) return "UNSUPPORTED";
  const event = QStreamEventSchema.parse({
    contractVersion: 1,
    eventId: randomUUID(),
    runId: run.id,
    sequence: 1,
    occurredAt: new Date().toISOString(),
    type: input.type,
    data: input.data,
  });
  return appendNext(
    { sql: executor },
    {
      tenantId: run.tenantId,
      runId: run.id,
      eventType: event.type,
      visibleStage: event.type === "q.stage.changed" ? event.data.stage : null,
      payload: event.data,
    },
  );
}

/**
 * Append one durable run event.
 *
 * Sequence first, under the run's row lock, then the row (in one
 * statement where the store offers `appendNext`): two concurrent
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
  const appendNext = repositories.runEvents.appendNext;
  if (appendNext !== undefined) {
    // R5: one statement. The contract parse runs first, exactly as below;
    // the sequence it is parsed with is a stand-in (any valid one) because
    // the database assigns the real one under the run's row lock.
    const event = QStreamEventSchema.parse({
      contractVersion: 1,
      eventId: randomUUID(),
      runId: run.id,
      sequence: 1,
      occurredAt: new Date().toISOString(),
      type: input.type,
      data: input.data,
    });
    const appended = await appendNext(tx, {
      tenantId: run.tenantId,
      runId: run.id,
      eventType: event.type,
      visibleStage: event.type === "q.stage.changed" ? event.data.stage : null,
      payload: event.data,
    });
    if (appended === null) {
      throw new QRunNotFoundError();
    }
    return appended;
  }

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
