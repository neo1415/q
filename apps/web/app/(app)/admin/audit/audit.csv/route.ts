import { searchAdminAudit } from "@capital-q/api-client";

import { auditFiltersFrom, csvCell } from "@/features/admin/audit-filters";
import { apiSession } from "@/features/q/context";

/**
 * The audit log as CSV, with the page's filters, up to 2,000 rows. The API
 * decides who may read it; anyone else gets a 404.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await apiSession();
  if (session === null) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const filters = auditFiltersFrom(
    Object.fromEntries(url.searchParams.entries()),
  );
  const lines = [
    [
      "When (UTC)",
      "Source",
      "Actor type",
      "Actor",
      "Role",
      "Authority",
      "Action",
      "Resource type",
      "Resource id",
      "Outcome",
      "Reason",
      "Break-glass",
    ],
  ];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const result = await searchAdminAudit(session, {
      ...filters,
      ...(cursor === undefined ? {} : { cursor }),
      limit: 200,
    }).catch(() => null);
    if (result === null) {
      if (page === 0) return new Response("Not found", { status: 404 });
      break;
    }
    for (const row of result.rows) {
      lines.push([
        row.at,
        row.source,
        row.actorType,
        row.actorName ?? "",
        row.actorRole ?? "",
        row.authorityName ?? "",
        row.actionType,
        row.resourceType,
        row.resourceId,
        row.outcome,
        row.reason ?? "",
        row.breakGlass ? "yes" : "",
      ]);
    }
    if (result.nextCursor === null) break;
    cursor = result.nextCursor;
  }
  const body = lines.map((line) => line.map(csvCell).join(",")).join("\r\n");
  return new Response(`${body}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="capital-q-audit.csv"',
      "Cache-Control": "no-store",
    },
  });
}
