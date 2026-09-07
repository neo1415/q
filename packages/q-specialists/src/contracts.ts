import type {
  CorrelationId,
  PermittedContextPlan,
  QCapability,
  QInternalFinding,
  QRunId,
  QSubjectRef,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

/**
 * The Q specialist contract (CQ-Q-020 §7-§11; doc 12 §12).
 *
 * A specialist is a bounded capability Q reaches for, not an agent a person
 * talks to. There is one Q; specialists are never user-selectable, never
 * named in anything a person reads, and never speak to each other. What one
 * returns is structured findings for Q to synthesise — not an answer, not a
 * persona, not authority.
 *
 *   QOrchestrator → Context Firewall → specialist → findings → Q → person
 *
 * Three properties this shape exists to guarantee:
 *
 *   - A specialist receives an already-authorised plan. It does not decide
 *     what it may see and cannot widen its own reach, because nothing here
 *     carries a tenant, an organisation, a visibility scope or a grant that
 *     a caller could set (§9, §46).
 *   - A specialist is versioned and the version is attributable. "latest"
 *     is not a version: a finding that cannot be traced to the code that
 *     produced it cannot be explained later (§8).
 *   - A specialist is analytical. There is no execute, no approval and no
 *     write anywhere in this contract, so a specialist cannot become
 *     consequential by being asked nicely (§51).
 */

/** What Q asks a specialist about, to decide whether it is the right one. */
export type QSpecialistProbe = {
  readonly capability: QCapability;
  readonly subjects: readonly QSubjectRef[];
  /**
   * The person's message. DATA: a specialist may read it to decide whether
   * the question is its kind of question, and must never treat it as an
   * instruction about what it is permitted to do.
   */
  readonly question: string;
};

/**
 * Everything a specialist run is given. The plan is the authority; the
 * actor is the server-resolved one the runtime re-validated on this
 * (re)start, never a client field and never recovered from a checkpoint.
 */
export type QSpecialistExecutionContext = {
  readonly actor: ActorContext;
  readonly runId: QRunId;
  readonly correlationId: CorrelationId;
  readonly capability: QCapability;
  readonly plan: PermittedContextPlan;
  /** Cooperative cancellation, propagated to reads and to the model call (§101). */
  readonly signal?: AbortSignal | undefined;
};

/**
 * What a specialist produces. `QInternalFinding` is the repository's
 * existing finding contract (four independent axes, opaque evidence
 * references, sensitivity and visibility for the disclosure layer);
 * nothing new was invented, because a second finding shape would drift
 * from the one the firewall already knows how to project.
 */
export type QSpecialistFinding = QInternalFinding;

export type QSpecialist<TInput, TOutput> = {
  /** Stable identity, e.g. "company-intelligence". Never shown to a person. */
  readonly id: string;
  /** Immutable version, e.g. "v1". Never "latest". */
  readonly version: string;
  /** Whether this specialist is the right one for the request. */
  readonly supports: (probe: QSpecialistProbe) => boolean;
  readonly investigate: (
    input: TInput,
    context: QSpecialistExecutionContext,
  ) => Promise<TOutput>;
};

/** `company-intelligence/v1` — what a trace, an eval or a run record carries. */
export function specialistVersionId(
  specialist: Pick<QSpecialist<unknown, unknown>, "id" | "version">,
): string {
  return `${specialist.id}/${specialist.version}`;
}

/**
 * Why a specialist could not produce findings. Coded, so a public error can
 * be plain English without a provider string, a schema message or a
 * database code reaching a person (§105).
 *
 * NO_ELIGIBLE_MODEL_ROUTE is deliberately distinct from
 * MODEL_UNAVAILABLE: the first means the context is too sensitive for any
 * configured provider and the honest answer is that Capital Q will not send
 * it, not that something broke (§45).
 */
export const Q_SPECIALIST_BLOCKED_REASONS = [
  "NO_AUTHORISED_SUBJECT",
  "NO_ELIGIBLE_MODEL_ROUTE",
  "MODEL_UNAVAILABLE",
  "MODEL_OUTPUT_REJECTED",
  "CANCELLED",
] as const;
export type QSpecialistBlockedReason =
  (typeof Q_SPECIALIST_BLOCKED_REASONS)[number];
