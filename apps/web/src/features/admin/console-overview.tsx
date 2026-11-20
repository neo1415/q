import Link from "next/link";

import type {
  AdminAuditRowDto,
  AdminConsoleOverviewDto,
  ServicePoolDto,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";

import { serverTNow } from "@/features/i18n/server-now";

import {
  auditResourceHref,
  auditResourceKey,
  auditResourceKind,
} from "./audit-names";
import {
  checkLine,
  heartbeatLine,
  poolLine,
  ungatedPoolLine,
  type HealthLine,
} from "./health-words";
import type { ServiceHealth } from "./system-health";
import { SpendChart } from "./spend-chart";
import { when, words } from "./words";

/**
 * The console overview's upper half (admin design 2026-11-19 §4 T1): a
 * band of headline figures, then a 2 : 1 grid with what waits on
 * operators and spend by day on the left, system health and recent
 * operator activity on the right. Every figure comes from a server read;
 * one a role may not read, or a read that failed, is left out rather than
 * shown as zero.
 */

export type Queue = {
  readonly term: string;
  readonly value: number;
  readonly href: string;
};

export type Headline = {
  readonly term: string;
  readonly value: string;
  readonly note?: string | undefined;
  readonly href?: string | undefined;
};

export function HeadlineBand({
  figures,
}: {
  readonly figures: readonly Headline[];
}) {
  const t = serverTNow();
  if (figures.length === 0) return null;
  return (
    <dl
      className="m-0 grid grid-cols-2 overflow-hidden rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) sm:grid-cols-3 xl:grid-cols-6"
      data-console-headlines
    >
      {figures.map((figure) => (
        <div
          key={figure.term}
          className="flex min-w-0 flex-col gap-1 border-(--cq-border-subtle) p-4 [&:not(:last-child)]:border-e [&:not(:last-child)]:border-b sm:[&:not(:last-child)]:border-b-0"
        >
          <dt className="cq-caption text-(--cq-text-secondary)">
            {t(figure.term)}
          </dt>
          <dd className="m-0 text-xl font-semibold tracking-[-0.01em] text-(--cq-text-primary) tabular-nums">
            {figure.href === undefined ? (
              t(figure.value)
            ) : (
              <Link href={figure.href} className="hover:underline">
                {t(figure.value)}
              </Link>
            )}
          </dd>
          {figure.note === undefined ? null : (
            <dd className="m-0 cq-caption text-(--cq-text-tertiary)">
              {t(figure.note)}
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
}

function Panel({
  title,
  children,
  id,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
  readonly id: string;
}) {
  const t = serverTNow();
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-4"
    >
      <h2
        id={id}
        className="m-0 text-[15px] font-semibold text-(--cq-text-primary)"
      >
        {t(title)}
      </h2>
      {children}
    </section>
  );
}

export function NeedsYou({ queues }: { readonly queues: readonly Queue[] }) {
  const t = serverTNow();
  const waiting = queues.filter((queue) => queue.value > 0);
  return (
    <Panel title="Needs you" id="console-needs-you">
      {queues.length === 0 ? (
        <p className="m-0 cq-body-sm text-(--cq-text-secondary)">
          {t("Your role reads no queues.")}
        </p>
      ) : waiting.length === 0 ? (
        <p className="m-0 cq-body-sm text-(--cq-text-secondary)">
          {t("Nothing waits on an operator.")}
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-(--cq-border-subtle) p-0">
          {waiting.map((queue) => (
            <li key={queue.term}>
              <Link
                href={queue.href}
                className="flex min-h-11 items-center justify-between gap-3 py-2 cq-body-sm text-(--cq-text-primary) hover:underline"
              >
                <span>{t(queue.term)}</span>
                <span className="font-semibold tabular-nums text-(--cq-warning)">
                  {queue.value}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function SpendPanel({
  overview,
}: {
  readonly overview: AdminConsoleOverviewDto;
}) {
  return (
    <Panel title="Model spend" id="console-spend">
      <SpendChart days={overview.daily} />
    </Panel>
  );
}

const STATE_WORDS: Readonly<Record<ServiceHealth["state"], string>> = {
  READY: "Ready",
  NOT_READY: "Not ready",
  NOT_ANSWERING: "Not answering",
  NOT_CONFIGURED: "Not configured here",
};

export function HealthPanel({
  services,
  outbox,
  versions,
  qApiPool,
  workers,
  now,
}: {
  readonly services: readonly ServiceHealth[];
  readonly outbox: AdminConsoleOverviewDto["outbox"] | null;
  readonly versions: readonly {
    readonly service: string;
    readonly sha: string;
  }[];
  /** q-api's pool; null when not reported. */
  readonly qApiPool: ServicePoolDto | null;
  /** The workers' last heartbeat, pool and check; null when none. */
  readonly workers: AdminConsoleOverviewDto["workers"];
  readonly now: number;
}) {
  const t = serverTNow();
  const readings: readonly {
    readonly term: string;
    readonly line: HealthLine;
  }[] = [
    { term: "Q API database pool", line: poolLine(qApiPool, now) },
    { term: "Workers", line: heartbeatLine(workers?.beatAt, now) },
    {
      term: "Workers database pool",
      line:
        workers !== null &&
        workers.pool === null &&
        workers.ungatedMaxConnections !== null
          ? ungatedPoolLine(workers.ungatedMaxConnections)
          : poolLine(workers?.pool, now),
    },
    { term: "Workers last check", line: checkLine(workers) },
  ];
  return (
    <Panel title="System health" id="console-health">
      <ul className="m-0 flex list-none flex-col gap-2 p-0" data-console-health>
        {services.map((service) => {
          const ok = service.state === "READY";
          return (
            <li
              key={service.service}
              className="flex items-center justify-between gap-3 cq-body-sm"
            >
              <span className="text-(--cq-text-primary)">
                {service.service}
              </span>
              <span
                className={cx(
                  "inline-flex items-center gap-1.5 tabular-nums",
                  ok
                    ? "text-(--cq-text-secondary)"
                    : "text-(--cq-text-primary)",
                )}
              >
                {/* The state is said in words; the dot only echoes it. */}
                <span
                  aria-hidden="true"
                  className={cx(
                    "size-2 rounded-full",
                    ok ? "bg-(--cq-positive)" : "bg-(--cq-warning)",
                  )}
                />
                {t(STATE_WORDS[service.state])}
                {service.millis === null
                  ? ""
                  : ` · ${String(service.millis)} ms`}
                {service.database === null || service.database === "OK"
                  ? ""
                  : t(` · database ${words(service.database).toLowerCase()}`)}
              </span>
            </li>
          );
        })}
        {readings.map((reading) => (
          <li
            key={reading.term}
            className="flex items-start justify-between gap-3 cq-body-sm"
            data-health-tone={reading.line.tone}
          >
            <span className="text-(--cq-text-primary)">{t(reading.term)}</span>
            <span
              className={cx(
                "inline-flex items-center gap-1.5 text-end tabular-nums",
                reading.line.tone === "OK"
                  ? "text-(--cq-text-secondary)"
                  : "text-(--cq-text-primary)",
              )}
            >
              {/* Words carry the state; the mark only echoes them. */}
              <span
                aria-hidden="true"
                className={cx(
                  "size-2 shrink-0 rounded-full",
                  reading.line.tone === "OK"
                    ? "bg-(--cq-positive)"
                    : reading.line.tone === "UNKNOWN"
                      ? "border border-(--cq-border)"
                      : "bg-(--cq-warning)",
                )}
              />
              {t(reading.line.text)}
            </span>
          </li>
        ))}
        {outbox === null ? null : (
          <li className="flex items-center justify-between gap-3 cq-body-sm">
            <span className="text-(--cq-text-primary)">
              {t("Event outbox")}
            </span>
            <span className="text-(--cq-text-secondary) tabular-nums">
              {outbox.pending === 0
                ? t("Nothing waiting")
                : t(
                    `${String(outbox.pending)} waiting · oldest ${ageWords(outbox.oldestPendingSeconds ?? 0)}`,
                  )}
            </span>
          </li>
        )}
        {versions.map((version) => (
          <li
            key={version.service}
            className="flex items-center justify-between gap-3 cq-body-sm"
          >
            <span className="text-(--cq-text-primary)">
              {t(`${version.service} version`)}
            </span>
            <code className="cq-caption text-(--cq-text-secondary)">
              {version.sha}
            </code>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** "45 s", "12 min", "3 h", "2 days". */
export function ageWords(seconds: number): string {
  if (seconds < 120) return `${String(seconds)} s`;
  if (seconds < 7_200) return `${String(Math.round(seconds / 60))} min`;
  if (seconds < 172_800) return `${String(Math.round(seconds / 3_600))} h`;
  return `${String(Math.round(seconds / 86_400))} days`;
}

export function RecentActivity({
  rows,
  names,
}: {
  readonly rows: readonly AdminAuditRowDto[] | null;
  readonly names: ReadonlyMap<string, string>;
}) {
  const t = serverTNow();
  return (
    <Panel title="Recent operator activity" id="console-activity">
      {rows === null ? (
        <p className="m-0 cq-body-sm text-(--cq-text-secondary)">
          {t("The audit log couldn't load.")}
        </p>
      ) : rows.length === 0 ? (
        <p className="m-0 cq-body-sm text-(--cq-text-secondary)">
          {t("No operator has acted yet.")}
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {rows.map((row, index) => {
            const kind = auditResourceKind(row.resourceType);
            const name =
              kind === null
                ? undefined
                : names.get(auditResourceKey(kind, row.resourceId));
            return (
              <li
                key={`${row.at}-${String(index)}`}
                className="flex flex-col gap-0.5 cq-body-sm"
              >
                <span className="text-(--cq-text-primary)">
                  {row.actorName ?? t("An operator")} ·{" "}
                  {t(words(row.actionType))}
                  {kind === null || name === undefined ? null : (
                    <>
                      {" · "}
                      <Link
                        href={auditResourceHref(kind, row.resourceId)}
                        className="underline-offset-2 hover:underline"
                      >
                        {name}
                      </Link>
                    </>
                  )}
                </span>
                <span className="cq-caption text-(--cq-text-tertiary)">
                  {t(when(row.at))}
                  {row.outcome === "SUCCEEDED"
                    ? ""
                    : t(` · ${words(row.outcome)}`)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <Link
        href="/admin/audit"
        className="cq-body-sm text-(--cq-text-secondary) hover:underline"
      >
        {t("Open the audit log")}
      </Link>
    </Panel>
  );
}
