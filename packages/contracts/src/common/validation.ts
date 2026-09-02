import { z } from "zod";

/**
 * A single validation failure, described without disclosing what was submitted.
 *
 * Transport-neutral by design. The same issue can later be rendered as an HTTP
 * problem detail, attached to a rejected job, returned from a provider adapter,
 * or surfaced against a form field -- so it carries no status code, no problem
 * type URI and no API error code. Mapping to RFC 9457 belongs to CQ-CON-002.
 *
 *   path     where the failure is, as a dotted path ("" for the root value)
 *   code     a stable machine-readable category
 *   message  a safe human-readable explanation of what was expected
 *
 * What it must never carry: the offending input, the surrounding object, a
 * stack trace, a database detail, or any credential. A validation failure is
 * frequently the first thing written to a log or an error tracker, and echoing
 * the rejected value there is how secrets escape.
 */
export const ValidationIssueSchema = z.object({
  path: z.string(),
  code: z.string().min(1),
  message: z.string().min(1),
});

export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;

/**
 * Convert a Zod error into safe Capital Q validation issues.
 *
 * Only the path, the issue code and Zod's expectation-based message are taken.
 * The `input` and `received` fields Zod attaches are never read, so the
 * submitted value cannot travel with the error.
 */
export function toValidationIssues(
  error: z.ZodError,
): readonly ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    code: issue.code,
    message: issue.message,
  }));
}

/**
 * Thrown when a value fails a Capital Q contract.
 *
 * Transport-neutral: no HTTP status, no problem type, no wire error code. The
 * adapter that catches it decides how to express it.
 */
export class ContractValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(message: string, issues: readonly ValidationIssue[]) {
    super(message);
    this.name = "ContractValidationError";
    this.issues = issues;
  }
}

/**
 * Parse `value` against `schema`, or throw a ContractValidationError carrying
 * safe issues.
 *
 * Prefer this over exposing a raw ZodError outward: the Zod error is an
 * internal representation, not a Capital Q contract, and callers should not
 * couple to its shape.
 */
export function parseContract<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
  message = "Value does not satisfy the contract",
): z.infer<TSchema> {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new ContractValidationError(
      message,
      toValidationIssues(result.error),
    );
  }

  return result.data;
}
