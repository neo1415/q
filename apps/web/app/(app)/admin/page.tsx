import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  getAdminAttribution,
  getAdminBreakGlass,
  getAdminConsoleOverview,
  getAdminEmail,
  searchAdminAudit,
  getAdminDisputes,
  getAdminPaused,
  getAdminOverview,
  getAdminQMonitor,
  getAdminReviews,
  getAdminSafety,
  getAdminVerificationQueue,
} from "@capital-q/api-client";
import { PausedAccounts } from "@/features/admin/paused-accounts";
import { buttonClassName } from "@capital-q/ui/button";
import { formatAmountForDisplay } from "@capital-q/ui/money-input";

import { PageSection } from "@/components/app-shell/page-container";
import { formatDay } from "@/components/date-format";
import { adminContext } from "@/features/admin/admin-context";
import { auditResourceNames } from "@/features/admin/audit-names";
import {
  HeadlineBand,
  HealthPanel,
  NeedsYou,
  RecentActivity,
  SpendPanel,
  type Headline,
  type Queue,
} from "@/features/admin/console-overview";
import { usd } from "@/features/admin/spend-words";
import { systemHealth, webVersion } from "@/features/admin/system-health";
import { serverT } from "@/features/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return { title: t("Admin") };
}
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
  const t = await serverT();

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
  // ADMIN-3: the human appeal queue (PADL #051).
  const reviews = can("reviews.read")
    ? await getAdminReviews(session).then(
        (r) => r.rows.length,
        () => null,
      )
    : null;
  // T1 (admin design 2026-11-19): the overview's own figures, the email
  // panel's delivery counts, recent operator activity and what the
  // services say about themselves. Each is read only for a role that may.
  const [consoleFigures, email, recent, services] = await Promise.all([
    getAdminConsoleOverview(session).catch(() => null),
    can("email.read") ? getAdminEmail(session).catch(() => null) : null,
    can("audit.read")
      ? searchAdminAudit(session, { source: "PLATFORM", limit: 6 }).then(
          (page) => page.rows,
          () => null,
        )
      : null,
    systemHealth(),
  ]);
  const names =
    recent === null
      ? new Map<string, string>()
      : await auditResourceNames(session, recent, can("accounts.read"));
  const queueList: readonly Queue[] = [
    {
      term: "Verification waiting",
      value: verification,
      href: "/admin/queue?tab=verification",
    },
    { term: "Reports to review", value: safety, href: "/admin/safety" },
    {
      term: "Reviews to answer",
      value: reviews,
      href: "/admin/queue?tab=reviews",
    },
    {
      term: "Break-glass to decide",
      value: glass,
      href: "/admin/safety#break-glass",
    },
  ].flatMap((queue) =>
    queue.value === null ? [] : [{ ...queue, value: queue.value }],
  );
  const waitingTotal = queueList.reduce((sum, queue) => sum + queue.value, 0);
  const sent = email?.deliveries.reduce((sum, row) => sum + row.sent, 0);
  const failed = email?.deliveries.reduce((sum, row) => sum + row.failed, 0);
  const headlines: readonly Headline[] = [
    ...(consoleFigures === null
      ? []
      : [
          {
            term: "Active organisations",
            value: consoleFigures.activeOrganisations.toLocaleString("en-GB"),
            href: "/admin/organisations",
          },
        ]),
    {
      term: "People",
      value: overview.people.toLocaleString("en-GB"),
      ...(can("accounts.read") ? { href: "/admin/accounts" } : {}),
    },
    ...(queueList.length === 0
      ? []
      : [
          {
            term: "Waiting on operators",
            value: String(waitingTotal),
            href: "/admin/queue",
          },
        ]),
    ...(consoleFigures === null
      ? []
      : [
          {
            term: "Model spend this month",
            value: usd(consoleFigures.spend.pricedUsd),
            note:
              consoleFigures.spend.unpricedCalls === 0
                ? `${consoleFigures.spend.pricedCalls.toLocaleString("en-GB")} priced calls`
                : `${consoleFigures.spend.unpricedCalls.toLocaleString("en-GB")} calls had no price`,
          },
        ]),
    ...(sent === undefined || failed === undefined
      ? []
      : [
          {
            term: "Emails, 30 days",
            value: `${sent.toLocaleString("en-GB")} sent`,
            note:
              failed === 0
                ? "None failed"
                : `${failed.toLocaleString("en-GB")} failed`,
            href: "/admin/email",
          },
        ]),
    ...(monitor === null
      ? []
      : [
          {
            term: "Q failures, 24 hours",
            value: String(
              monitor.calls.failed +
                (monitor.runsByStatus.find((row) => row.status === "FAILED")
                  ?.runs ?? 0),
            ),
            href: "/admin/q",
          },
        ]),
  ];
  const versions = [
    ...(consoleFigures?.apiVersion === null ||
    consoleFigures?.apiVersion === undefined
      ? []
      : [{ service: "API", sha: consoleFigures.apiVersion }]),
    ...(webVersion() === null
      ? []
      : [{ service: "Web", sha: webVersion() ?? "" }]),
  ];
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
      <div className="flex flex-col gap-4" data-console-overview>
        <HeadlineBand figures={headlines} />
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            <NeedsYou queues={queueList} />
            {consoleFigures === null ? null : (
              <SpendPanel overview={consoleFigures} />
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <HealthPanel
              services={services}
              outbox={consoleFigures?.outbox ?? null}
              versions={versions}
            />
            {recent === null && !can("audit.read") ? null : (
              <RecentActivity rows={recent} names={names} />
            )}
          </div>
        </div>
      </div>
      <PageSection id="overview" title={t("The network")}>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {figures.map((figure) => (
            <div key={figure.term} className="flex flex-col gap-1">
              <dt className="cq-caption text-(--cq-text-secondary)">
                {t(figure.term)}
              </dt>
              <dd className="cq-title-sm text-(--cq-text-primary) tabular-nums">
                {t(figure.value)}
              </dd>
            </div>
          ))}
        </dl>
      </PageSection>

      {can("accounts.read") ? (
        <PageSection id="paused" title={t("Paused by Q")}>
          <PausedAccounts rows={paused} />
        </PageSection>
      ) : null}

      {can("ledger.read") ? (
        <PageSection id="attribution" title={t("Attribution")}>
          <div className="flex flex-col gap-3">
            <div>
              <a
                href="/admin/attribution.csv"
                className={buttonClassName("quiet", "compact")}
                download
              >
                {t("Download CSV")}
              </a>
            </div>
            <div className="relative overflow-x-auto">
              <table className="cq-body-sm w-full min-w-[48rem] text-start">
                <thead className="cq-caption text-(--cq-text-secondary)">
                  <tr>
                    <th className="py-2 pe-4 font-normal">{t("Company")}</th>
                    <th className="py-2 pe-4 font-normal">{t("Investor")}</th>
                    <th className="py-2 pe-4 font-normal">{t("Began")}</th>
                    <th className="py-2 pe-4 font-normal">{t("Connected")}</th>
                    <th className="py-2 pe-4 font-normal">{t("Calls")}</th>
                    <th className="py-2 pe-4 font-normal">{t("Q heard")}</th>
                    <th className="py-2 font-normal">{t("Confirmed")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-(--cq-border-subtle)">
                  {attribution.map((row) => (
                    <tr
                      key={row.relationshipId}
                      className="text-(--cq-text-primary)"
                    >
                      <td className="py-2 pe-4">{row.companyName}</td>
                      <td className="py-2 pe-4">{row.investorName}</td>
                      <td className="py-2 pe-4">
                        {t(ORIGIN_WORDS[row.origin] ?? row.origin)} ·{" "}
                        {t(formatDay(row.startedAt.slice(0, 10)))}
                      </td>
                      <td className="py-2 pe-4">
                        {row.connectedAt === null
                          ? "—"
                          : t(formatDay(row.connectedAt.slice(0, 10)))}
                      </td>
                      <td className="py-2 pe-4 tabular-nums">
                        {row.meetingsHeld}
                        {row.recordingsDeclined === 0
                          ? ""
                          : t(` (${String(row.recordingsDeclined)} declined)`)}
                      </td>
                      <td className="py-2 pe-4 tabular-nums">
                        {row.detected}
                        {row.disputed === 0
                          ? ""
                          : t(` (${String(row.disputed)} disputed)`)}
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
        <PageSection id="disputes" title={t("Disputes")}>
          {disputes.length === 0 ? (
            <p className="cq-body text-(--cq-text-secondary)">{t("None.")}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-(--cq-border-subtle)">
              {disputes.map((row) => (
                <li key={row.commitmentId} className="flex flex-col gap-1 py-3">
                  <span className="cq-body-sm text-(--cq-text-primary)">
                    {row.companyName} · {row.investorName} · {row.currencyCode}{" "}
                    {t(formatAmountForDisplay(row.amount))}
                  </span>
                  {row.quote === null ? null : (
                    <span className="cq-caption text-(--cq-text-secondary)">
                      &ldquo;{row.quote}
                      {t("” · disputed")}{" "}
                      {t(formatDay(row.disputedAt.slice(0, 10)))}
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
