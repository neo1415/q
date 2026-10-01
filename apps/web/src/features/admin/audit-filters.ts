import type { AdminAuditQuery } from "@capital-q/contracts";

/** The audit filters as they travel in the URL, validated loosely here; the API validates again. */
export function auditFiltersFrom(
  params: Readonly<Record<string, string | undefined>>,
): AdminAuditQuery {
  const pick = (name: string) => {
    const value = params[name]?.trim();
    return value === undefined || value.length === 0 ? undefined : value;
  };
  const source = pick("source");
  const outcome = pick("outcome");
  const day = (value: string | undefined) =>
    value !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? `${value}T00:00:00Z`
      : undefined;
  return {
    ...(source === "TENANT" || source === "PLATFORM" ? { source } : {}),
    ...(pick("action") === undefined
      ? {}
      : { action: pick("action")?.toLowerCase() }),
    ...(pick("resourceType") === undefined
      ? {}
      : { resourceType: pick("resourceType") }),
    ...(pick("resourceId") === undefined
      ? {}
      : { resourceId: pick("resourceId") }),
    ...(outcome === "SUCCEEDED" || outcome === "FAILED" || outcome === "DENIED"
      ? { outcome }
      : {}),
    ...(day(pick("from")) === undefined ? {} : { from: day(pick("from")) }),
    ...(day(pick("to")) === undefined ? {} : { to: day(pick("to")) }),
    ...(pick("actorUserId") === undefined
      ? {}
      : { actorUserId: pick("actorUserId") }),
  };
}

export function csvCell(value: string): string {
  // Quote every cell; neutralise spreadsheet formulas (CSV injection).
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
