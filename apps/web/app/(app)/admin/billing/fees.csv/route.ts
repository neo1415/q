import { exportAdminFeeLedger } from "@capital-q/api-client";

import { apiSession } from "@/features/q/context";

/**
 * The facilitation-fee ledger as CSV for Capital Q's operators (BILLING,
 * ADR 0034). The API decides who is a platform admin, builds the file
 * (every cell quoted, formulas neutralised) and audits the export; anyone
 * else gets a 404.
 */
export async function GET(): Promise<Response> {
  const session = await apiSession();
  if (session === null) return new Response("Not found", { status: 404 });
  const result = await exportAdminFeeLedger(session).catch(() => null);
  if (result === null) return new Response("Not found", { status: 404 });
  return new Response(result.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${result.filename.replace(/[^a-z0-9._-]/gi, "")}"`,
      "Cache-Control": "no-store",
    },
  });
}
