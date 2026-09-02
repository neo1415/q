import type { z } from "zod";

/**
 * The audit input did not satisfy the contract. Carries issue paths and
 * messages only -- never the offending values, because a rejected value may
 * be exactly the secret the rule exists to keep out of storage and logs.
 */
export class AuditInputError extends Error {
  readonly issues: readonly {
    readonly path: string;
    readonly message: string;
  }[];

  constructor(kind: "material_action" | "security_event", error: z.ZodError) {
    const issues = error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    }));
    super(
      `Invalid ${kind} audit input: ${issues.map((issue) => `${issue.path || "<root>"}: ${issue.message}`).join("; ")}`,
    );
    this.name = "AuditInputError";
    this.issues = issues;
  }
}

/**
 * An audit record with this AuditEventId already exists with different
 * content. History is never overwritten; the caller has a defect (or is
 * reusing an id) and must record a new event.
 */
export class AuditEventConflictError extends Error {
  readonly auditEventId: string;

  constructor(auditEventId: string) {
    super(
      `An audit record already exists for ${auditEventId} with different content.`,
    );
    this.name = "AuditEventConflictError";
    this.auditEventId = auditEventId;
  }
}

/** The ActorContext handed to the audit helper is not one it can attribute. */
export class AuditActorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditActorError";
  }
}
