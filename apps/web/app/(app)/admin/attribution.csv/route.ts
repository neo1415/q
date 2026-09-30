import { getAdminAttribution } from "@capital-q/api-client";

import { apiSession } from "@/features/q/context";

/**
 * The attribution ledger as a CSV for Capital Q's operators. The API
 * decides who is a platform admin; anyone else gets a 404.
 */

function cell(value: string): string {
  // Quote every cell; neutralise spreadsheet formulas (CSV injection).
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export async function GET(): Promise<Response> {
  const session = await apiSession();
  if (session === null) return new Response("Not found", { status: 404 });
  const result = await getAdminAttribution(session).catch(() => null);
  if (result === null) return new Response("Not found", { status: 404 });
  const rows = [
    [
      "Relationship",
      "Company",
      "Investor",
      "Origin",
      "Began",
      "Connected",
      "Calls held",
      "Recording declined",
      "Q heard",
      "Disputed",
      "Confirmed",
      "Last activity",
    ],
    ...result.rows.map((row) => [
      row.relationshipId,
      row.companyName,
      row.investorName,
      row.origin,
      row.startedAt,
      row.connectedAt ?? "",
      String(row.meetingsHeld),
      String(row.recordingsDeclined),
      String(row.detected),
      String(row.disputed),
      row.confirmed
        .map((money) => `${money.currencyCode} ${money.amount}`)
        .join("; "),
      row.lastActivityAt,
    ]),
  ];
  const body = rows.map((row) => row.map(cell).join(",")).join("\r\n");
  return new Response(`${body}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="capital-q-attribution.csv"',
      "Cache-Control": "no-store",
    },
  });
}
