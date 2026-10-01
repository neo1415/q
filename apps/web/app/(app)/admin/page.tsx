import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  getAdminAttribution,
  getAdminBreakGlass,
  getAdminDisputes,
  getAdminPaused,
  getAdminOverview,
  getAdminQMonitor,
  getAdminSafety,
  getAdminVerificationQueue,
} from "@capital-q/api-client";
import { PausedAccounts } from "@/features/admin/paused-accounts";
import { buttonClassName } from "@capital-q/ui/button";
import { formatAmountForDisplay } from "@capital-q/ui/money-input";

import { PageSection } from "@/components/app-shell/page-container";
import { formatDay } from "@/components/date-format";
import { adminContext } from "@/features/admin/admin-context";

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
  const context = await adminContext();
  if (context === null) notFound();
  const { session, can } = context;
  const overview = await getAdminOverview(session).catch(() => null);
  if (overview === null) notFound();
  const [attribution, disputes, paused, verification, safety, glass, monitor] =
    await Promise.all([
      can("ledger.read")
        ? getAdminAttribution(session).then(
            (r) => r.rows,
            () => [],
          )
        : [],
      can("ledger.read")
        ? getAdminDisputes(session).then(
            (r) => r.rows,
            () => [],
          )
        : [],
      can("accounts.read")
        ? getAdminPaused(session).then(
            (r) => r.rows,
            () => [],
          )
        : [],
      can("verification.read")
        ? getAdminVerificationQueue(session).then(
            (r) => r.rows.length,
            () => null,
          )
        : null,
      can("safety.read")
        ? getAdminSafety(session).then(
            (r) => r.reports.length,
            () => null,
          )
        : null,
      can("safety.read")
        ? getAdminBreakGlass(session).then(
            (r) => r.rows.filter((row) => row.status === "PENDING").length,
            () => null,
          )
        : null,
      can("q.monitor.read")
        ? getAdminQMonitor(session, "24h").catch(() => null)
        : null,
    ]);
  const queues = [
    {
      term: "Verification waiting",
      value: verification,
      href: "/admin/verification",
    },
    { term: "Reports to review", value: safety, href: "/admin/safety" },
    {
      term: "Break-glass to decide",
      value: glass,
      href: "/admin/safety#break-glass",
    },
    {
      term: "Q failures (24 hours)",
      value:
        monitor === null
          ? null
          : monitor.calls.failed +
            (monitor.runsByStatus.find((row) => row.status === "FAILED")
              ?.runs ?? 0),
      href: "/admin/q",
    },
  ].filter((queue) => queue.value !== null);
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
    <div className="flex flex-col gap-10">
      {queues.length === 0 ? null : (
        <PageSection id="queues" title="Waiting on you">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {queues.map((queue) => (
              <li key={queue.term}>
                <a
                  href={queue.href}
                  className="flex min-h-11 flex-col gap-1 rounded-lg border border-(--cq-border-subtle) px-3 py-2 hover:bg-(--cq-surface-subtle)"
                >
                  <span className="cq-caption text-(--cq-text-secondary)">
                    {queue.term}
                  </span>
                  <span className="cq-title-sm tabular-nums text-(--cq-text-primary)">
                    {String(queue.value)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </PageSection>
      )}
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

      {can("accounts.read") ? (
        <PageSection id="paused" title="Paused by Q">
          <PausedAccounts rows={paused} />
        </PageSection>
      ) : null}

      {can("ledger.read") ? (
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
      ) : null}

      {can("ledger.read") ? (
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
      ) : null}
    </div>
  );
}
