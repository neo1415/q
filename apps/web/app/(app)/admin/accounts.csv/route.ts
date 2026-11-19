import { listAdminAccounts } from "@capital-q/api-client";

import { csvCell } from "@/features/admin/audit-filters";
import { viewFrom } from "@/features/admin/data-table";
import { apiSession } from "@/features/q/context";

/**
 * Accounts as CSV: the page's own search and order, followed page by page
 * through the same permissioned read the table uses (never a wider one),
 * up to 2,000 rows. The API decides who may read it; anyone else gets 404.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await apiSession();
  if (session === null) return new Response("Not found", { status: 404 });
  const view = viewFrom(
    Object.fromEntries(new URL(request.url).searchParams.entries()),
  );
  const lines: string[][] = [
    ["Name", "Email", "Organisations", "Suspended", "Joined (UTC)", "Id"],
  ];
  let cursor: string | undefined;
  for (let page = 0; page < 40; page += 1) {
    const result = await listAdminAccounts(session, {
      ...(view.q.length > 0 ? { q: view.q } : {}),
      sort: view.sort,
      ...(cursor === undefined ? {} : { cursor }),
      limit: 50,
    }).catch(() => null);
    if (result === null) {
      if (page === 0) return new Response("Not found", { status: 404 });
      break;
    }
    for (const row of result.rows)
      lines.push([
        row.name ?? "",
        row.email ?? "",
        row.organisations.join("; "),
        row.suspended ? "yes" : "",
        row.createdAt,
        row.userId,
      ]);
    if (result.nextCursor === null) break;
    cursor = result.nextCursor;
  }
  const body = lines.map((line) => line.map(csvCell).join(",")).join("\r\n");
  return new Response(`${body}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="capital-q-accounts.csv"',
      "Cache-Control": "no-store",
    },
  });
}
