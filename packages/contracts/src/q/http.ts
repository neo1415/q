import { z } from "zod";

import { QUserMessageSchema } from "./message.js";
import { QRunHandleSchema } from "./run.js";

/**
 * The V1 Q HTTP surface as implemented by CQ-Q-002 (doc 22 §66-68, §77-78)
 * and CQ-Q-009 (the resumable stream, doc 22 §69-76).
 */
export const Q_RUNS_PATH = "/v1/q/runs" as const;
export const Q_RUN_MESSAGES_SUFFIX = "/messages" as const;
export const Q_RUN_CANCEL_SUFFIX = "/cancel" as const;

/**
 * `GET /v1/q/runs/:runId/events` — Server-Sent Events (AEC-018). The
 * `event:` field is the QStreamEvent `type`, `data:` is the event's JSON,
 * and `id:` is the durable per-run sequence (AEC-020) — present on durable
 * events only, so a browser's Last-Event-ID never names a delta the server
 * does not keep. Heartbeats are SSE comments, never events.
 */
export const Q_RUN_EVENTS_SUFFIX = "/events" as const;
export const Q_SSE_CONTENT_TYPE = "text/event-stream" as const;
/** The standard reconnect header; the only cursor the stream accepts. */
export const LAST_EVENT_ID_HEADER = "last-event-id" as const;
/**
 * A Last-Event-ID is a durable sequence the client has processed: a
 * non-negative integer, bounded well below anything a run can reach. "0"
 * means "from the beginning" and is the same as sending no header.
 */
export const LastEventIdHeaderSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,9})$/, "expected a non-negative event sequence")
  .transform((value) => Number(value));
export const Q_SSE_MAX_LAST_EVENT_ID = 9_999_999_999;

/**
 * The approval surface (CQ-Q-008). Addressed by approval id, as the
 * `q.approval.required` run event names it. A decision is a POST with a
 * minimal body against the existing server-side proposal; no route accepts
 * a payload, a hash or an approver.
 */
export const Q_APPROVALS_PATH = "/v1/q/approvals" as const;
export const Q_APPROVAL_APPROVE_SUFFIX = "/approve" as const;
export const Q_APPROVAL_REJECT_SUFFIX = "/reject" as const;

/**
 * PUBLIC. `POST /v1/q/runs` answers 202 Accepted with the run handle: work
 * was durably accepted, nothing has been analysed. There is no
 * `eventStreamUrl` until a stream exists.
 */
export const CreateQRunResponseSchema = QRunHandleSchema;

export type CreateQRunResponse = z.infer<typeof CreateQRunResponseSchema>;

/**
 * PUBLIC. `POST /v1/q/runs/:runId/messages` returns the message as stored.
 * Persisted is not understood: the runtime has recorded the turn and
 * nothing more.
 */
export const AppendQRunMessageResponseSchema = z
  .object({ message: QUserMessageSchema })
  .strict();

export type AppendQRunMessageResponse = z.infer<
  typeof AppendQRunMessageResponseSchema
>;
