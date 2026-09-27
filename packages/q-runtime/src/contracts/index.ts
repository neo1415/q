import { z } from "zod";

import {
  QMessageSchema,
  QRunHandleSchema,
  QRunSummarySchema,
  QStreamEventSchema,
  toPublicQFailure,
  type CorrelationId,
  type QCapability,
  type QConsequenceClass,
  type QConversationId,
  type QFailureDiagnosticCode,
  type QMessage,
  type QMessageId,
  type QMessageRole,
  type QRunHandle,
  type QRunId,
  type QRunStatus,
  type QRunSummary,
  type QStreamEvent,
  type QStreamEventId,
  type QStreamEventType,
  type QSubjectRef,
  type QVisibleStage,
  type UtcTimestamp,
  type QResultBlock,
} from "@capital-q/contracts";
import type { QScreenContext, QViewingMoment } from "@capital-q/contracts";
import type { OrganisationId, TenantId, UserId } from "@capital-q/security";

/**
 * Q runtime records (CQ-Q-002, doc 13 §34, §47).
 *
 * What the runtime holds durably, and how each is projected onto the public
 * Q contract. The records carry what the runtime needs — tenant, owner,
 * version, allocator, internal failure code — and the projections are built
 * by parsing into the public schemas, so nothing internal can reach a client
 * by accident.
 *
 *   Q conversation ≠ Q institutional memory
 *   Q message      ≠ canonical company truth
 *   Q run          ≠ Q Knowledge Object
 *   Q run event    ≠ domain event ≠ audit event
 */

/** Whether the owner was acting personally or for an organisation. */
export const Q_CONVERSATION_CONTEXT_TYPES = [
  "PERSONAL",
  "ORGANISATION",
] as const;
export type QConversationContextType =
  (typeof Q_CONVERSATION_CONTEXT_TYPES)[number];
export const QConversationContextTypeSchema = z.enum(
  Q_CONVERSATION_CONTEXT_TYPES,
);

export type QConversation = {
  readonly id: QConversationId;
  readonly tenantId: TenantId;
  /** The owner. The only person who may read or continue the conversation. */
  readonly userId: UserId;
  /** Acting context, not visibility. */
  readonly organisationId: OrganisationId | null;
  readonly contextType: QConversationContextType;
  readonly subjects: readonly QSubjectRef[];
  /** A few words naming it, once the memory extractor has run (ADR 0012). */
  readonly title: string | null;
  /** The conversation so far, rolled forward. Model-written working memory: untrusted text. */
  readonly summary: string | null;
  /** The newest message the summary covers. */
  readonly summaryThrough: UtcTimestamp | null;
  readonly lastMessageAt: UtcTimestamp | null;
  readonly createdAt: UtcTimestamp;
  readonly archivedAt: UtcTimestamp | null;
};

/** What the memory extractor writes back about a conversation. */
export type QConversationDigest = {
  readonly title: string | null;
  readonly summary: string;
  readonly summaryThrough: UtcTimestamp;
};

export type NewQConversation = {
  readonly tenantId: TenantId;
  readonly userId: UserId;
  readonly organisationId: OrganisationId | null;
  readonly subjects: readonly QSubjectRef[];
};

export type QRunRecord = {
  readonly id: QRunId;
  readonly tenantId: TenantId;
  readonly actorUserId: UserId;
  readonly actorOrganisationId: OrganisationId | null;
  readonly conversationId: QConversationId | null;
  readonly objective: string;
  readonly capability: QCapability;
  readonly consequenceClass: QConsequenceClass;
  readonly status: QRunStatus;
  readonly subjects: readonly QSubjectRef[];
  /**
   * R18: the pitch moment the person was viewing, only when the Q API
   * authorised it for them at creation; null (or absent) otherwise.
   */
  readonly viewing?: QViewingMoment | null | undefined;
  /**
   * R21: the screen the person asked from: the route, and only the
   * entities that resolved for them at creation; null when none was sent.
   */
  readonly screen?: QScreenContext | null | undefined;
  /** NULL until the orchestrator, prompt registry and model policy exist. */
  readonly orchestrationVersion: string | null;
  readonly promptBundleVersion: string | null;
  readonly modelPolicyVersion: string | null;
  readonly correlationId: CorrelationId;
  readonly createdAt: UtcTimestamp;
  /** When orchestration began; NULL for a run that was never picked up. */
  readonly startedAt: UtcTimestamp | null;
  readonly completedAt: UtcTimestamp | null;
  /** Internal diagnostic. Never serialised to a client as-is. */
  readonly failureCode: QFailureDiagnosticCode | null;
  readonly version: number;
  readonly lastEventSequence: number;
};

export type NewQRun = {
  readonly tenantId: TenantId;
  readonly actorUserId: UserId;
  readonly actorOrganisationId: OrganisationId | null;
  readonly conversationId: QConversationId;
  readonly objective: string;
  readonly capability: QCapability;
  readonly consequenceClass: QConsequenceClass;
  readonly subjects: readonly QSubjectRef[];
  /** R18: already authorised for the actor; never a client's word. */
  readonly viewing?: QViewingMoment | null | undefined;
  /** R21: the route plus only the on-screen entities that resolved. */
  readonly screen?: QScreenContext | null | undefined;
  readonly correlationId: CorrelationId;
};

export type QConversationMessage = {
  readonly id: QMessageId;
  readonly tenantId: TenantId;
  readonly conversationId: QConversationId;
  readonly runId: QRunId;
  readonly role: QMessageRole;
  readonly content: string;
  readonly contentType: "TEXT";
  /**
   * The objects Q's answer referred to (CQ-Q-BLOCKS-HISTORY-001).
   *
   * Exactly what the browser received live, so reopening a conversation
   * shows the same cards rather than the prose alone. Parsed through the
   * public contract on the way in and on the way out: a block that does
   * not satisfy it is not stored and not served, which is what keeps
   * internal state, a provider payload and a private evidence reference
   * out of history by construction rather than by review.
   */
  readonly blocks?: readonly QResultBlock[] | undefined;
  /**
   * The spoken utterance this person's turn is a form of, when it came by
   * voice (`domain/utterances.ts`). Stored as the reserved provider message
   * reference: an opaque id, never a payload. Server-internal; never sent
   * to a client.
   */
  readonly utteranceRef?: string | undefined;
  readonly createdAt: UtcTimestamp;
};

export type NewQConversationMessage = {
  /**
   * Optional, server-generated by the caller. A streaming answer names the
   * message before its text exists, so the live deltas and the persisted
   * message share one identity (CQ-Q-009 §18, §79).
   */
  readonly id?: QMessageId | undefined;
  readonly tenantId: TenantId;
  readonly conversationId: QConversationId;
  readonly runId: QRunId;
  readonly role: QMessageRole;
  readonly content: string;
  /** Q's own turns only; a person's turn is what they typed. */
  readonly blocks?: readonly QResultBlock[] | undefined;
  /** A person's spoken turn only: the utterance it is a form of. */
  readonly utteranceRef?: string | undefined;
};

export type QRunEventRecord = {
  readonly id: QStreamEventId;
  readonly tenantId: TenantId;
  readonly runId: QRunId;
  readonly sequence: number;
  readonly eventType: QStreamEventType;
  readonly visibleStage: QVisibleStage | null;
  /** The event's `data`, exactly as the stream contract defines it. */
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: UtcTimestamp;
};

/**
 * An event to append, expressed in the public stream vocabulary so the
 * writer validates it against the contract before it is stored. The
 * runtime never stores a payload the stream could not later emit.
 */
export type NewQRunEvent = {
  readonly tenantId: TenantId;
  readonly runId: QRunId;
  readonly sequence: number;
  readonly eventType: QStreamEventType;
  readonly visibleStage: QVisibleStage | null;
  readonly payload: Readonly<Record<string, unknown>>;
};

// ---------------------------------------------------------------------------
// Public projections. Each parses into the public schema: the schema is the
// allowlist, and a record field that is not in it cannot leak.
// ---------------------------------------------------------------------------

export function toQRunHandle(run: QRunRecord): QRunHandle {
  return QRunHandleSchema.parse({
    runId: run.id,
    ...(run.conversationId === null
      ? {}
      : { conversationId: run.conversationId }),
    status: run.status,
    createdAt: run.createdAt,
  });
}

/**
 * The blocks a stored answer may hand back to a client
 * (CQ-Q-BLOCKS-HISTORY-001 §A5).
 *
 * An evidence reference is only identifiers, and whether a reader may see
 * the document behind one is disclosure's decision at render time — never
 * something a message projection may pre-empt. That rule was already
 * enforced, but only in the browser's own projection, which meant one
 * client remembering to filter was the whole of the protection. Making
 * history durable would have made that the wrong place for it: a row read
 * by anything else would have carried the identifiers straight out.
 *
 * So it is enforced here, where every client reads through. A block that
 * carries evidence references is dropped and the rest of the answer is
 * served; the count a reader is entitled to already travels with the
 * findings.
 */
function disclosable(
  blocks: readonly QResultBlock[] | undefined,
): readonly QResultBlock[] {
  if (blocks === undefined) return [];
  return blocks.filter((block) => {
    switch (block.kind) {
      case "EVIDENCE":
        return false;
      case "UI_INTENT":
        // The same references under another name.
        return block.intent.kind !== "SHOW_EVIDENCE";
      case "FINDING":
        // A finding's own references are equally not the browser's to
        // hold. The projection that produces them already sends an empty
        // list; a row that somehow holds otherwise is dropped rather
        // than trimmed, because a half-stripped finding is a finding
        // somebody stopped checking.
        return block.finding.evidenceRefs.length === 0;
      // Prose and objects. None of them carries an evidence identifier,
      // and each is listed rather than defaulted so that adding a block
      // kind forces somebody to decide what history may hand back.
      // ARTIFACT_REFERENCE among them: it names something Q composed and
      // grants nothing, because knowing an identifier has never been
      // permission to see what it names.
      case "TEXT":
      case "COMPANY_REFERENCE":
      case "INVESTOR_REFERENCE":
      case "COMPARISON":
      case "UNCERTAINTY":
      case "CLARIFICATION_REQUEST":
      case "ACTION_PROPOSAL":
      case "ARTIFACT_REFERENCE":
        return true;
    }
  });
}

export function toQMessage(message: QConversationMessage): QMessage {
  return QMessageSchema.parse(
    message.role === "USER"
      ? {
          messageId: message.id,
          runId: message.runId,
          role: "USER",
          text: message.content,
          createdAt: message.createdAt,
        }
      : {
          messageId: message.id,
          runId: message.runId,
          role: "Q",
          text: message.content,
          // Restored from the store, re-validated on read and filtered to
          // what a reader may actually be handed.
          ...(() => {
            const blocks = disclosable(message.blocks);
            return blocks.length === 0 ? {} : { blocks };
          })(),
          createdAt: message.createdAt,
        },
  );
}

/**
 * The run as a client reads it. The failure, when there is one, is the
 * public projection of the internal code — the code itself never travels.
 */
export function toQRunSummary(
  run: QRunRecord,
  messages: readonly QConversationMessage[],
  visibleStage: QVisibleStage | null,
): QRunSummary {
  return QRunSummarySchema.parse({
    runId: run.id,
    ...(run.conversationId === null
      ? {}
      : { conversationId: run.conversationId }),
    capability: run.capability,
    status: run.status,
    visibleStage,
    subjects: run.subjects,
    messages: messages.map(toQMessage),
    ...(run.status === "FAILED" && run.failureCode !== null
      ? {
          failure: toPublicQFailure(
            { diagnosticCode: run.failureCode },
            { runId: run.id },
          ),
        }
      : {}),
    correlationId: run.correlationId,
    createdAt: run.createdAt,
    ...(run.startedAt === null ? {} : { startedAt: run.startedAt }),
    ...(run.completedAt === null ? {} : { completedAt: run.completedAt }),
  });
}

/** A stored event back in its stream form, validated against the contract. */
export function toQStreamEvent(event: QRunEventRecord): QStreamEvent {
  return QStreamEventSchema.parse({
    contractVersion: 1,
    eventId: event.id,
    runId: event.runId,
    sequence: event.sequence,
    occurredAt: event.occurredAt,
    type: event.eventType,
    data: event.payload,
  });
}
