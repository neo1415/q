import { getCompanyFundraising } from "@capital-q/api-client";

import { apiSession, resolveOwnContext } from "@/features/q/context";

/**
 * The raise as a CSV (founder direction 2026-09-29: bookkeeping and
 * reports). The founder's own company only, read under their own session
 * through the same API the page uses; nothing here widens access.
 */

function cell(value: string): string {
  // Quote every cell; neutralise spreadsheet formulas (CSV injection).
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export async function GET(): Promise<Response> {
  const context = await resolveOwnContext();
  const session = await apiSession();
  if (context.kind !== "FOUNDER" || session === null) {
    return new Response("Not found", { status: 404 });
  }
  const fundraising = await getCompanyFundraising(
    session,
    context.companyId,
  ).catch(() => null);
  if (fundraising === null) {
    return new Response("Couldn't load your raise", { status: 503 });
  }
  const rows = [
    ["Investor", "Amount", "Currency", "Level", "Status"],
    ...fundraising.investors.map((investor) => [
      investor.investorName,
      investor.amount,
      investor.currencyCode,
      investor.level,
      investor.bucket === "CONFIRMED" ? "Confirmed" : "Soft",
    ]),
  ];
  const body = rows.map((row) => row.map(cell).join(",")).join("\r\n");
  return new Response(`${body}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="capital-q-raise.csv"',
      "Cache-Control": "no-store",
    },
  });
}
