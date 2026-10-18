import type { CapitalQEvent } from "@capital-q/contracts";

const READINESS_CHANGED = "core.company.marketplace_readiness_changed";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The company a readiness event made marketplace-ready, or null. Only the
 * transition into ready counts: a company leaving the marketplace wakes no
 * instruction. Reads the id from the message and nothing else.
 */
export function newlyReadyCompanyOf(
  event: CapitalQEvent<unknown>,
): string | null {
  if (event.type !== READINESS_CHANGED) return null;
  const data = event.data as
    | { readonly companyId?: unknown; readonly readinessState?: unknown }
    | null
    | undefined;
  if (data === null || data === undefined) return null;
  return data.readinessState === "marketplace_ready" &&
    typeof data.companyId === "string" &&
    UUID.test(data.companyId)
    ? data.companyId
    : null;
}
