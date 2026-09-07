import { Annotation } from "@langchain/langgraph";
import { z } from "zod";

import {
  CorrelationIdSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  QCapabilitySchema,
  QConversationIdSchema,
  QFailureDiagnosticCodeSchema,
  QKnowledgeScopeKindSchema,
  QRunIdSchema,
  QSensitivityClassSchema,
  QSubjectRefsSchema,
  QTaskClassSchema,
  UtcTimestampSchema,
  UuidSchema,
} from "@capital-q/contracts";
import { TenantIdSchema, UserIdSchema } from "@capital-q/security";

/**
 * The graph's working state (packet §14-15, §46, §64): what the engine
 * needs to know where an investigation is and how to continue it, and
 * nothing else.
 *
 * Identifiers, the capability, the typed subject references, coded
 * outcomes, and a bounded DESCRIPTOR of the permitted context plan — its
 * id, fingerprint, policy version, task class and scope kinds. Never the
 * plan's filters, never a permission row, never a document, a message, a
 * token, a prompt or a reasoning trace. The plan itself is re-derived from
 * live policy before any retrieval, so a checkpoint can never become
 * permission authority: what it remembers is what was decided, not a
 * right to act on it again.
 *
 * The actor's organisation and membership are carried so the firewall can
 * be asked on the actor's behalf while the engine runs detached; on resume
 * they are overwritten from the freshly authorised request, never trusted
 * from the checkpoint.
 */
export const Q_RETRIEVAL_OUTCOMES = [
  "NOT_CONFIGURED",
  "AUTHORISED_REFERENCES",
] as const;
export const Q_ANSWER_OUTCOMES = [
  "NOT_CONFIGURED",
  "ANSWERED",
  "FAILED",
] as const;
export const Q_CONTEXT_OUTCOMES = ["AUTHORISED", "DENIED"] as const;
/**
 * What the action seam concluded (CQ-Q-008). AWAITING_APPROVAL is where a
 * run stands after a proposal was persisted and the engine interrupted;
 * everything after it is the durable execution gate's answer, never a
 * model's. The identifiers are references into q_runtime.actions and
 * q_runtime.approvals — holding them in a checkpoint is not authority: the
 * gate re-verifies the approval, the hash and the actor's permission
 * before anything runs.
 */
export const Q_ACTION_OUTCOMES = [
  "NONE",
  "AWAITING_APPROVAL",
  "EXECUTED",
  "FAILED",
  "NOT_APPROVED",
  "BLOCKED",
  "ALREADY_EXECUTED",
  "IN_PROGRESS",
  "RECONCILIATION_REQUIRED",
] as const;

/** The bounded reference to a permitted context plan a checkpoint may hold. */
export const QContextPlanDescriptorSchema = z
  .object({
    planId: UuidSchema,
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    policyVersion: z.literal(Q_CONTEXT_FIREWALL_POLICY_VERSION),
    taskClass: QTaskClassSchema,
    scopeKinds: z.array(QKnowledgeScopeKindSchema).max(32),
    maxSensitivity: QSensitivityClassSchema,
    evaluatedAt: UtcTimestampSchema,
    revalidateAfter: UtcTimestampSchema,
  })
  .strict();
export type QContextPlanDescriptor = z.infer<
  typeof QContextPlanDescriptorSchema
>;

export const QGraphStateSchema = z
  .object({
    runId: QRunIdSchema,
    tenantId: TenantIdSchema,
    actorUserId: UserIdSchema,
    actorOrganisationId: UuidSchema.nullable(),
    actorMembershipId: UuidSchema.nullable(),
    conversationId: QConversationIdSchema.nullable(),
    capability: QCapabilitySchema,
    subjects: QSubjectRefsSchema.readonly(),
    orchestrationVersion: z.string().min(1).max(64),
    correlationId: CorrelationIdSchema,
    /** Set by the nodes as they complete; null until then. */
    preflight: z.literal("PASSED").nullable(),
    context: z.enum(Q_CONTEXT_OUTCOMES).nullable(),
    contextPlan: QContextPlanDescriptorSchema.nullable(),
    retrieval: z.enum(Q_RETRIEVAL_OUTCOMES).nullable(),
    answer: z.enum(Q_ANSWER_OUTCOMES).nullable(),
    /** The coded reason when `answer` is FAILED; never provider text. */
    answerFailure: QFailureDiagnosticCodeSchema.nullable(),
    /** The routing policy the answer ran under (ai_ops code), once answered. */
    modelPolicyVersion: z.string().min(1).max(64).nullable(),
    /** The prompt bundle the answer ran under (q-core), once answered. */
    promptBundleVersion: z.string().min(1).max(64).nullable(),
    /** The action seam's conclusion; null until it ran (CQ-Q-008). */
    action: z.enum(Q_ACTION_OUTCOMES).nullable(),
    /** References only: the proposal and the approval request this run is waiting on or executed. */
    actionId: UuidSchema.nullable(),
    approvalId: UuidSchema.nullable(),
    /** The gate's stable code when the action did not execute; never provider or executor text. */
    actionFailure: z.string().max(64).nullable(),
  })
  .strict();

export type QGraphState = z.infer<typeof QGraphStateSchema>;

/** The engine's channel definition: one last-value channel per field. */
export const QGraphAnnotation = Annotation.Root({
  runId: Annotation<QGraphState["runId"]>,
  tenantId: Annotation<QGraphState["tenantId"]>,
  actorUserId: Annotation<QGraphState["actorUserId"]>,
  actorOrganisationId: Annotation<QGraphState["actorOrganisationId"]>,
  actorMembershipId: Annotation<QGraphState["actorMembershipId"]>,
  conversationId: Annotation<QGraphState["conversationId"]>,
  capability: Annotation<QGraphState["capability"]>,
  subjects: Annotation<QGraphState["subjects"]>,
  orchestrationVersion: Annotation<QGraphState["orchestrationVersion"]>,
  correlationId: Annotation<QGraphState["correlationId"]>,
  preflight: Annotation<QGraphState["preflight"]>,
  context: Annotation<QGraphState["context"]>,
  contextPlan: Annotation<QGraphState["contextPlan"]>,
  retrieval: Annotation<QGraphState["retrieval"]>,
  answer: Annotation<QGraphState["answer"]>,
  answerFailure: Annotation<QGraphState["answerFailure"]>,
  modelPolicyVersion: Annotation<QGraphState["modelPolicyVersion"]>,
  promptBundleVersion: Annotation<QGraphState["promptBundleVersion"]>,
  action: Annotation<QGraphState["action"]>,
  actionId: Annotation<QGraphState["actionId"]>,
  approvalId: Annotation<QGraphState["approvalId"]>,
  actionFailure: Annotation<QGraphState["actionFailure"]>,
});

/** The allowlisted field names, for checkpoint inspection tests. */
export const Q_GRAPH_STATE_FIELDS = Object.keys(
  QGraphStateSchema.shape,
) as readonly (keyof QGraphState)[];
