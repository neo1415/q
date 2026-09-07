import type { z } from "zod";

import type {
  ModelToolName,
  QActionClass,
  QKnowledgeScopeKind,
  QSensitivityClass,
  QTaskClass,
  QToolClassification,
  QToolName,
  QVisibleStage,
} from "@capital-q/contracts";
import type { QToolExecutionContext } from "@capital-q/q-runtime";
import type { Capability } from "@capital-q/security";

/**
 * A Capital Q tool (doc 12 §28.2, §33; doc 22 §83-87; doc 15 §49-52).
 *
 *   tool id + version   ≠ the name a model sees (a projection the registry chooses)
 *   offered             ≠ authorised   (every call is authorised on its own)
 *   authorised          ≠ executed     (execution is deterministic domain code)
 *   tool result         ≠ truth        (data the model reads, never instruction)
 *
 * Every field below is metadata doc 22 §84 requires, plus the two functions
 * the pipeline calls in order: `authorize` decides, against the actor, the
 * plan and the owning domains' authorization and disclosure layers, whether
 * THIS input may be served and at which sensitivity; `execute` then reads
 * through the owning context's public query port and nothing else. Neither
 * receives a credential, a connection string or a raw table name.
 */

export const Q_TOOL_STATUSES = ["ACTIVE", "DISABLED", "DEPRECATED"] as const;
export type QToolStatus = (typeof Q_TOOL_STATUSES)[number];

/** Stable denial and failure codes shared by every tool (UPPER_SNAKE_CASE). */
export const Q_TOOL_FAILURE_CODES = [
  /** The proposal named a tool the registry did not offer this run. */
  "TOOL_NOT_ELIGIBLE",
  /** Model-generated arguments failed the tool's input schema. */
  "INVALID_ARGUMENTS",
  /** The actor in the context does not match the plan the run was authorised under. */
  "ACTOR_MISMATCH",
  /** Absent, cross-tenant, unshared or outside the plan: one code for all of them. */
  "NOT_AVAILABLE",
  /** The tool's data class exceeds what the plan lets Q reason over. */
  "SENSITIVITY_NOT_PERMITTED",
  /** The run was cancelled before or during execution. */
  "CANCELLED",
  /** Domain code threw; the message stays in server logs. */
  "TOOL_INTERNAL_ERROR",
  /** The tool produced data its own output schema refuses. */
  "INVALID_TOOL_OUTPUT",
  /** The bounded result limit was exceeded. */
  "RESULT_TOO_LARGE",
] as const;
export type QToolFailureCode = (typeof Q_TOOL_FAILURE_CODES)[number];

/** The one wording for everything a person may not learn exists. */
export const NOT_AVAILABLE_MESSAGE =
  "Not available in this conversation's context.";

export type QToolAuthorization<G> =
  | {
      readonly outcome: "ALLOW";
      /** The sensitivity class of what `execute` will return for this input. */
      readonly sensitivity: QSensitivityClass;
      /** Facts resolved while authorising, handed to `execute` so nothing is re-derived. */
      readonly grant: G;
    }
  | {
      readonly outcome: "DENY";
      readonly code: QToolFailureCode;
      readonly safeMessage: string;
    };

export type QToolDefinition<I, O, G> = {
  /** Registry identity: dotted lower_snake_case, e.g. `company.get`. */
  readonly id: QToolName;
  readonly version: number;
  readonly status: QToolStatus;
  /** What the model sees. Flat identifier; unique among ACTIVE tools. */
  readonly providerName: ModelToolName;
  /** For the model: what the tool returns and when to call it. No policy text. */
  readonly description: string;
  readonly classification: QToolClassification;
  /** doc 12 §30 policy class. This packet registers SAFE_READ only. */
  readonly riskClass: QActionClass;
  /** Capabilities the owning side must hold; documentation and audit, enforced in `authorize`. */
  readonly requiredCapabilities: readonly Capability[];
  /** Task classes (the firewall's derived purpose) the tool may be offered for. */
  readonly supportedPurposes: readonly QTaskClass[];
  /** Offered only when the plan holds at least one of these scope kinds; empty = always. */
  readonly requiredScopeKinds: readonly QKnowledgeScopeKind[];
  readonly approval: "NONE";
  readonly idempotency: "SAFE_TO_REPEAT";
  readonly owner: string;
  /** Approved progress a person may see while it runs (doc 12 §9.2), or null. */
  readonly visibleStage: QVisibleStage | null;
  readonly input: z.ZodType<I>;
  readonly output: z.ZodType<O>;
  readonly authorize: (
    input: I,
    context: QToolExecutionContext,
  ) => Promise<QToolAuthorization<G>>;
  readonly execute: (
    input: I,
    context: QToolExecutionContext,
    grant: G,
  ) => Promise<O>;
};

/** Erased for the registry; per-tool types stay with the tool. */
export type AnyQToolDefinition = QToolDefinition<unknown, unknown, unknown>;

export function defineQTool<I, O, G>(
  definition: QToolDefinition<I, O, G>,
): AnyQToolDefinition {
  return definition as unknown as AnyQToolDefinition;
}

/**
 * Thrown by `execute` when an argument passes the schema but the domain
 * refuses it (an opaque cursor it never issued). The pipeline reports it
 * as INVALID_ARGUMENTS with this safe sentence; anything else thrown is an
 * internal error whose text never leaves the server.
 */
export class QToolArgumentError extends Error {
  readonly safeMessage: string;

  constructor(safeMessage: string) {
    super(safeMessage);
    this.name = "QToolArgumentError";
    this.safeMessage = safeMessage;
  }
}

export function deny<G>(
  code: QToolFailureCode,
  safeMessage: string = NOT_AVAILABLE_MESSAGE,
): QToolAuthorization<G> {
  return { outcome: "DENY", code, safeMessage };
}

export function allow<G>(
  sensitivity: QSensitivityClass,
  grant: G,
): QToolAuthorization<G> {
  return { outcome: "ALLOW", sensitivity, grant };
}
