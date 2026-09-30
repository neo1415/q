import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  getAdminAttribution,
  getAdminDisputes,
  getAdminPaused,
  getAdminOverview,
} from "@capital-q/api-client";
import { PausedAccounts } from "@/features/admin/paused-accounts";
import { buttonClassName } from "@capital-q/ui/button";
import { formatAmountForDisplay } from "@capital-q/ui/money-input";

import {
  PageContainer,
  PageHeader,
  PageSection,
} from "@/components/app-shell/page-container";
import { formatDay } from "@/components/date-format";
import { apiSession } from "@/features/q/context";

export const metadata: Metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

const ORIGIN_WORDS: Readonly<Record<string, string>> = {
  DISCOVER: "Discover",
  GATEQ: "GateQ",
  SEARCH: "Search",
  RECOMMENDATION: "Recommended",
  Q: "Q",
  MANUAL: "Direct",
  SYSTEM: "System",
  UNKNOWN: "Unknown",
};

function money(
  rows: readonly { readonly currencyCode: string; readonly amount: string }[],
): string {
  return rows.length === 0
    ? "—"
    : rows
        .map(
          (row) => `${row.currencyCode} ${formatAmountForDisplay(row.amount)}`,
        )
        .join(" · ");
}

/**
 * Capital Q's admin console (founder direction 2026-09-29/30): the
 * attribution and fee ledger, disputes and usage. The API decides who is
 * a platform admin; anyone else gets this route's 404.
 */
export default async function AdminPage() {
  const session = await apiSession();
  if (session === null) notFound();
  const overview = await getAdminOverview(session).catch(() => null);
  if (overview === null) notFound();
  const [attribution, disputes, paused] = await Promise.all([
    getAdminAttribution(session)
      .then((result) => result.rows)
      .catch(() => []),
    getAdminDisputes(session)
      .then((result) => result.rows)
      .catch(() => []),
    getAdminPaused(session)
      .then((result) => result.rows)
      .catch(() => []),
  ]);
  const figures = [
    { term: "People", value: String(overview.people) },
    { term: "Companies", value: String(overview.companies) },
    { term: "Investors", value: String(overview.investorOrganisations) },
    {
      term: "Relationships",
      value: `${String(overview.relationships)} (${String(overview.connected)} connected)`,
    },
    { term: "Calls held", value: String(overview.meetingsHeld) },
    { term: "Recording declined", value: String(overview.recordingsDeclined) },
    { term: "Confirmed capital", value: money(overview.confirmed) },
    { term: "GateQ applications", value: String(overview.applications) },
    { term: "Model spend (30 days)", value: `$${overview.modelSpendUsd30d}` },
  ];
  return (
    <PageContainer>
      <PageHeader title="Admin" />
      <div className="flex flex-col gap-10">
        <PageSection id="overview" title="Overview">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {figures.map((figure) => (
              <div key={figure.term} className="flex flex-col gap-1">
                <dt className="cq-caption text-(--cq-text-secondary)">
                  {figure.term}
                </dt>
                <dd className="cq-title-sm text-(--cq-text-primary) tabular-nums">
                  {figure.value}
                </dd>
              </div>
            ))}
          </dl>
        </PageSection>

        <PageSection id="paused" title="Paused accounts">
          <PausedAccounts rows={paused} />
        </PageSection>

        <PageSection id="attribution" title="Attribution">
          <div className="flex flex-col gap-3">
            <div>
              <a
                href="/admin/attribution.csv"
                className={buttonClassName("quiet", "compact")}
                download
              >
                Download CSV
              </a>
            </div>
            <div className="overflow-x-auto">
              <table className="cq-body-sm w-full min-w-[48rem] text-left">
                <thead className="cq-caption text-(--cq-text-secondary)">
                  <tr>
                    <th className="py-2 pr-4 font-normal">Company</th>
                    <th className="py-2 pr-4 font-normal">Investor</th>
                    <th className="py-2 pr-4 font-normal">Began</th>
                    <th className="py-2 pr-4 font-normal">Connected</th>
                    <th className="py-2 pr-4 font-normal">Calls</th>
                    <th className="py-2 pr-4 font-normal">Q heard</th>
                    <th className="py-2 font-normal">Confirmed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-(--cq-border-subtle)">
                  {attribution.map((row) => (
                    <tr
                      key={row.relationshipId}
                      className="text-(--cq-text-primary)"
                    >
                      <td className="py-2 pr-4">{row.companyName}</td>
                      <td className="py-2 pr-4">{row.investorName}</td>
                      <td className="py-2 pr-4">
                        {ORIGIN_WORDS[row.origin] ?? row.origin} ·{" "}
                        {formatDay(row.startedAt.slice(0, 10))}
                      </td>
                      <td className="py-2 pr-4">
                        {row.connectedAt === null
                          ? "—"
                          : formatDay(row.connectedAt.slice(0, 10))}
                      </td>
                      <td className="py-2 pr-4 tabular-nums">
                        {row.meetingsHeld}
                        {row.recordingsDeclined === 0
                          ? ""
                          : ` (${String(row.recordingsDeclined)} declined)`}
                      </td>
                      <td className="py-2 pr-4 tabular-nums">
                        {row.detected}
                        {row.disputed === 0
                          ? ""
                          : ` (${String(row.disputed)} disputed)`}
                      </td>
                      <td className="py-2 tabular-nums">
                        {money(row.confirmed)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </PageSection>

        <PageSection id="disputes" title="Disputes">
          {disputes.length === 0 ? (
            <p className="cq-body text-(--cq-text-secondary)">None.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-(--cq-border-subtle)">
              {disputes.map((row) => (
                <li key={row.commitmentId} className="flex flex-col gap-1 py-3">
                  <span className="cq-body-sm text-(--cq-text-primary)">
                    {row.companyName} · {row.investorName} · {row.currencyCode}{" "}
                    {formatAmountForDisplay(row.amount)}
                  </span>
                  {row.quote === null ? null : (
                    <span className="cq-caption text-(--cq-text-secondary)">
                      &ldquo;{row.quote}&rdquo; · disputed{" "}
                      {formatDay(row.disputedAt.slice(0, 10))}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </PageSection>
      </div>
    </PageContainer>
  );
}
