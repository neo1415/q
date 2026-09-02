import type { CorrelationId } from "@capital-q/contracts";

/**
 * The application correlation id is `cor_<uuid>`; the audit columns store
 * the uuid. One place does the translation so it is never done by hand.
 */
export function correlationUuid(
  correlationId: CorrelationId | undefined,
): string | null {
  return correlationId === undefined
    ? null
    : correlationId.slice("cor_".length);
}
