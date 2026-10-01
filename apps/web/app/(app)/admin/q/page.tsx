import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getAdminQErrors, getAdminQMonitor } from "@capital-q/api-client";
import { EmptyState, ErrorState } from "@capital-q/ui/states";

import { PageSection } from "@/components/app-shell/page-container";
import { adminContext } from "@/features/admin/admin-context";
import { ErrorStream } from "@/features/admin/error-stream";
import { usd, when, words } from "@/features/admin/words";

export const metadata: Metadata = { title: "Q monitor · Admin" };

const WINDOWS = [
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
] as const;

export default async function AdminQPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly window?: string | undefined }>;
}) {
  const context = await adminContext();
  if (context === null || !context.can("q.monitor.read")) notFound();
  const asked = (await searchParams).window;
  const window = WINDOWS.find((w) => w.value === asked)?.value ?? "24h";
  const [monitor, errors] = await Promise.all([
    getAdminQMonitor(context.session, window).catch(() => null),
    getAdminQErrors(context.session)
      .then((result) => result.rows)
      .catch(() => []),
  ]);
  const canTrace = context.can("q.trace.read");
  if (monitor === null) {
    return (
      <ErrorState
        title="Q's figures couldn't load"
        description="Try again in a moment."
      />
    );
  }
  const runs = monitor.runsByStatus.reduce((sum, row) => sum + row.runs, 0);
  const failedRuns =
    monitor.runsByStatus.find((row) => row.status === "FAILED")?.runs ?? 0;
  const figures = [
    { term: "Q runs", value: String(runs) },
    { term: "Runs failed", value: String(failedRuns) },
    { term: "Model calls", value: String(monitor.calls.total) },
    { term: "Calls failed", value: String(monitor.calls.failed) },
    { term: "Context refused", value: String(monitor.refusals.firewallDenied) },
    {
      term: "Spend",
      value: `${usd(monitor.calls.costUsd)}${monitor.calls.unpriced > 0 ? ` (+${String(monitor.calls.unpriced)} unpriced)` : ""}`,
    },
  ];
  // Bar lengths only: the figures themselves are shown as text.
  const peak = Math.max(
    ...monitor.costPerDay.map((day) => Number(day.costUsd)),
    0,
  );
  return (
    <div className="flex flex-col gap-10">
      <nav aria-label="Time window" className="flex gap-2">
        {WINDOWS.map((option) => (
          <Link
            key={option.value}
            href={`/admin/q?window=${option.value}`}
            aria-current={option.value === window ? "page" : undefined}
            className={`cq-body-sm inline-flex min-h-11 items-center rounded-md border px-3 ${
              option.value === window
                ? "border-(--cq-text-primary) text-(--cq-text-primary)"
                : "border-(--cq-border-subtle) text-(--cq-text-secondary)"
            }`}
          >
            {option.label}
          </Link>
        ))}
      </nav>

      <PageSection id="figures" title="At a glance">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {figures.map((figure) => (
            <div key={figure.term} className="flex flex-col gap-1">
              <dt className="cq-caption text-(--cq-text-secondary)">
                {figure.term}
              </dt>
              <dd className="cq-title-sm tabular-nums text-(--cq-text-primary)">
                {figure.value}
              </dd>
            </div>
          ))}
        </dl>
      </PageSection>

      <PageSection id="errors" title="Live errors">
        <ErrorStream initial={errors} canTrace={canTrace} />
      </PageSection>

      <PageSection id="latency" title="Latency by task and model">
        {monitor.latency.length === 0 ? (
          <EmptyState compact title="No model calls in this window" />
        ) : (
          <div className="overflow-x-auto">
            <table className="cq-body-sm w-full min-w-[40rem] text-left">
              <thead className="cq-caption text-(--cq-text-secondary)">
                <tr>
                  <th className="py-2 pr-4 font-normal">Task</th>
                  <th className="py-2 pr-4 font-normal">Model</th>
                  <th className="py-2 pr-4 text-right font-normal">Calls</th>
                  <th className="py-2 pr-4 text-right font-normal">Failed</th>
                  <th className="py-2 pr-4 text-right font-normal">p50</th>
                  <th className="py-2 pr-4 text-right font-normal">p95</th>
                  <th className="py-2 text-right font-normal">Spend</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--cq-border-subtle) tabular-nums text-(--cq-text-primary)">
                {monitor.latency.map((row) => (
                  <tr key={`${row.taskClass}-${row.model}`}>
                    <td className="py-2 pr-4">{words(row.taskClass)}</td>
                    <td className="py-2 pr-4">{row.model}</td>
                    <td className="py-2 pr-4 text-right">{row.calls}</td>
                    <td className="py-2 pr-4 text-right">{row.failed}</td>
                    <td className="py-2 pr-4 text-right">
                      {(row.p50Ms / 1000).toFixed(1)} s
                    </td>
                    <td className="py-2 pr-4 text-right">
                      {(row.p95Ms / 1000).toFixed(1)} s
                    </td>
                    <td className="py-2 text-right">{usd(row.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageSection>

      <PageSection id="cost" title="Spend per day">
        {monitor.costPerDay.length === 0 ? (
          <EmptyState compact title="No spend in this window" />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {monitor.costPerDay.map((day) => (
              <li
                key={day.day}
                className="grid grid-cols-[6rem_1fr_6rem] items-center gap-3"
              >
                <span className="cq-caption text-(--cq-text-secondary)">
                  {day.day}
                </span>
                <span
                  aria-hidden="true"
                  className="h-2 rounded-full bg-(--cq-surface-subtle)"
                >
                  <span
                    className="block h-2 rounded-full bg-(--cq-text-secondary)"
                    style={{
                      width: `${peak === 0 ? 0 : Math.max(2, (Number(day.costUsd) / peak) * 100)}%`,
                    }}
                  />
                </span>
                <span className="cq-body-sm text-right tabular-nums text-(--cq-text-primary)">
                  {usd(day.costUsd)} · {day.calls}
                </span>
              </li>
            ))}
          </ul>
        )}
      </PageSection>

      <PageSection id="refusals" title="Refusals and failures">
        <div className="grid gap-6 sm:grid-cols-3">
          {[
            {
              title: "Context refused, by reason",
              rows: monitor.refusals.byReason.map((r) => ({
                key: r.reason,
                count: r.count,
              })),
            },
            {
              title: "Runs failed, by cause",
              rows: monitor.runFailures.map((r) => ({
                key: r.code,
                count: r.runs,
              })),
            },
            {
              title: "Model calls failed, by class",
              rows: monitor.callFailures.map((r) => ({
                key: r.code,
                count: r.calls,
              })),
            },
          ].map((block) => (
            <div key={block.title} className="flex flex-col gap-2">
              <h3 className="cq-body font-medium text-(--cq-text-primary)">
                {block.title}
              </h3>
              {block.rows.length === 0 ? (
                <p className="cq-body-sm text-(--cq-text-secondary)">None.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {block.rows.map((row) => (
                    <li
                      key={row.key}
                      className="cq-body-sm flex justify-between gap-3 text-(--cq-text-primary)"
                    >
                      <span>{words(row.key)}</span>
                      <span className="tabular-nums">{row.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </PageSection>

      <PageSection id="runs" title="Recent runs">
        {monitor.recentRuns.length === 0 ? (
          <EmptyState compact title="No runs in this window" />
        ) : (
          <ul className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
            {monitor.recentRuns.map((run) => {
              const line = (
                <>
                  <span className="cq-body-sm text-(--cq-text-primary)">
                    {words(run.capability)} · {words(run.status)}
                    {run.failureCode === null
                      ? ""
                      : ` · ${words(run.failureCode)}`}
                  </span>
                  <span className="cq-caption text-(--cq-text-secondary)">
                    {run.userName ?? "A member"} · {when(run.createdAt)}
                    {run.durationMs === null
                      ? ""
                      : ` · ${(run.durationMs / 1000).toFixed(1)} s`}
                  </span>
                </>
              );
              return (
                <li key={run.runId}>
                  {canTrace ? (
                    <Link
                      href={`/admin/q/runs/${run.runId}`}
                      className="flex min-h-11 flex-wrap items-baseline justify-between gap-2 py-2 hover:bg-(--cq-surface-subtle)"
                    >
                      {line}
                    </Link>
                  ) : (
                    <div className="flex min-h-11 flex-wrap items-baseline justify-between gap-2 py-2">
                      {line}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </PageSection>
    </div>
  );
}
