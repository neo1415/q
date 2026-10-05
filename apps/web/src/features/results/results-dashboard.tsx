import Link from "next/link";
import type { ReactNode } from "react";

import type {
  FounderResults,
  InvestorResults,
  QUsageDto,
  ResultsActivity,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { buttonClassName } from "@capital-q/ui/button";
import { ChevronRight, ICON_SIZE } from "@capital-q/ui/icons";

import { EntityAvatar } from "@/features/entity/entity-avatar";

import { ActivityBars } from "./activity-bars";
import {
  activityTotals,
  commitmentLines,
  money,
  orderedStages,
  pageHref,
  plural,
  RESULTS_PERIODS,
  sentenceCase,
  stageHref,
  stateWord,
  waitWords,
  type KnownRange,
} from "./results-words";

/**
 * The Results dashboard (founder critique 2026-10-05: "imagine when there's
 * so many things happening"). Server-rendered from the Results read and,
 * for an investor, Q's usage this month. Every number is a recorded count;
 * an unknown is said in words. Picking a pipeline stage lists who is at it
 * (a link, so it works without script and can be shared).
 */

const REASON_WORDS: Readonly<Record<string, string>> = {
  STAGE_IN_RANGE: "Stage",
  SECTOR_MATCH: "Sector",
  GEOGRAPHY_MATCH: "Geography",
  BUSINESS_MODEL_MATCH: "Business model",
  CUSTOMER_TYPE_MATCH: "Customer type",
  DECLARED_DEPLOYING: "Deploying",
  PROFILE_COMPLETE: "Profile complete",
};

export type ResultsDashboardProps = {
  readonly basePath: string;
  readonly range: KnownRange;
  readonly stage: string | null;
  /** Query string for the report downloads (the period asked for). */
  readonly download: string;
  /** Q's usage this month; null when it couldn't be read. */
  readonly usage: QUsageDto | null;
  readonly results: FounderResults | InvestorResults;
};

function Panel({
  id,
  title,
  action,
  children,
  className,
}: {
  readonly id?: string;
  readonly title: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={id === undefined ? undefined : `${id}-title`}
      className={cx(
        "flex min-w-0 flex-col gap-4 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-4 sm:p-5",
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2
          id={id === undefined ? undefined : `${id}-title`}
          className="cq-title-sm text-(--cq-text-primary)"
        >
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Tile({
  label,
  value,
  note,
  href,
}: {
  readonly label: string;
  readonly value: string;
  readonly note?: string | undefined;
  readonly href?: string | undefined;
}) {
  const body = (
    <>
      <span className="cq-body-sm text-(--cq-text-secondary)">{label}</span>
      <span className="text-[1.625rem] leading-tight font-semibold tracking-[-0.01em] tabular-nums text-(--cq-text-primary) sm:text-[1.875rem]">
        {value}
      </span>
      {note === undefined ? null : (
        <span className="cq-caption text-(--cq-text-secondary)">{note}</span>
      )}
    </>
  );
  const frame =
    "flex min-w-0 flex-col gap-1 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-4";
  return href === undefined ? (
    <div className={frame}>{body}</div>
  ) : (
    <Link
      href={href}
      className={cx(
        frame,
        "transition-colors duration-(--cq-motion-fast) hover:border-(--cq-border) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)",
      )}
    >
      {body}
    </Link>
  );
}

function Header({
  props,
  name,
}: {
  readonly props: ResultsDashboardProps;
  readonly name: string;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="cq-title-xl text-(--cq-text-primary)">Results</h1>
        <p className="cq-body-sm text-(--cq-text-secondary)">
          {name} · {props.results.window.label.toLowerCase()}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <nav
          aria-label="Period"
          className="inline-flex rounded-(--cq-radius-md) border border-(--cq-border) bg-(--cq-surface-raised) p-0.5"
        >
          {RESULTS_PERIODS.map((period) => {
            const active = props.range === period.value;
            return (
              <Link
                key={period.value}
                href={pageHref(props.basePath, { range: period.value })}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "cq-body-sm inline-flex min-h-10 items-center rounded-[8px] px-3 focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)",
                  active
                    ? "bg-(--cq-surface-strong) font-semibold text-(--cq-text-primary)"
                    : "text-(--cq-text-secondary) hover:text-(--cq-text-primary)",
                )}
              >
                {period.label}
              </Link>
            );
          })}
        </nav>
        <a
          href={`/results/report?format=pdf&${props.download}`}
          className={buttonClassName("secondary")}
          download
        >
          Download PDF
        </a>
        <a
          href={`/results/report?format=csv&${props.download}`}
          className={buttonClassName("quiet")}
          download
        >
          CSV
        </a>
      </div>
    </header>
  );
}

function Activity({
  activity,
  first,
}: {
  readonly activity: ResultsActivity | undefined;
  readonly first: string;
}) {
  if (activity === undefined) return null;
  const totals = activityTotals(activity);
  return (
    <Panel id="activity" title="Activity">
      {activity.points.length === 0 || totals === null ? (
        <p className="cq-body-sm text-(--cq-text-secondary)">
          Nothing recorded yet.
        </p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-3">
          <ActivityBars
            title={first}
            total={totals.interests}
            bucket={activity.bucket}
            points={activity.points.map((p) => ({
              start: p.start,
              value: p.interests,
            }))}
          />
          <ActivityBars
            title="Connections"
            total={totals.connections}
            bucket={activity.bucket}
            points={activity.points.map((p) => ({
              start: p.start,
              value: p.connections,
            }))}
          />
          <ActivityBars
            title="Meetings held"
            total={totals.meetings}
            bucket={activity.bucket}
            points={activity.points.map((p) => ({
              start: p.start,
              value: p.meetings,
            }))}
          />
        </div>
      )}
    </Panel>
  );
}

type DrillRow = {
  readonly key: string;
  readonly state: string;
  readonly name: string;
  readonly detail: string;
  readonly href: string | null;
  readonly avatar: ReactNode;
};

function Pipeline({
  props,
  side,
  byState,
  rows,
  unlisted,
}: {
  readonly props: ResultsDashboardProps;
  readonly side: "FOUNDER" | "INVESTOR";
  readonly byState: readonly {
    readonly state: string;
    readonly count: number;
  }[];
  readonly rows: readonly DrillRow[];
  /** Stages the list does not carry (said, never shown as empty). */
  readonly unlisted: readonly string[];
}) {
  const stages = orderedStages(byState);
  const max = Math.max(1, ...stages.map((s) => s.count));
  const picked = stages.some((s) => s.state === props.stage)
    ? props.stage
    : null;
  const shown =
    picked === null ? rows : rows.filter((row) => row.state === picked);
  return (
    <Panel
      id="pipeline"
      title="Pipeline"
      action={
        picked === null ? null : (
          <Link
            href={stageHref(props.basePath, props.range, null)}
            className="cq-body-sm text-(--cq-accent) underline-offset-2 hover:underline"
          >
            Show everyone
          </Link>
        )
      }
    >
      {stages.length === 0 ? (
        <p className="cq-body-sm text-(--cq-text-secondary)">
          {side === "INVESTOR"
            ? "No relationships yet. They start when you express interest."
            : "No relationships yet. They start when an investor expresses interest."}
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-0.5">
            {stages.map((stage) => {
              const on = picked === stage.state;
              return (
                <li key={stage.state}>
                  <Link
                    href={stageHref(
                      props.basePath,
                      props.range,
                      on ? null : stage.state,
                    )}
                    aria-current={on ? "true" : undefined}
                    className={cx(
                      "grid min-h-11 grid-cols-[7.5rem_1fr_2.5rem] items-center gap-3 rounded-(--cq-radius-sm) px-2 focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)",
                      on
                        ? "bg-(--cq-accent-soft) font-semibold"
                        : "hover:bg-(--cq-surface-subtle)",
                    )}
                  >
                    <span className="cq-body-sm truncate text-(--cq-text-primary)">
                      {stateWord(stage.state, side)}
                    </span>
                    <span
                      aria-hidden="true"
                      className="h-2 rounded-(--cq-radius-xs) bg-(--cq-surface-subtle)"
                    >
                      <span
                        className="block h-2 rounded-(--cq-radius-xs) bg-(--cq-accent)"
                        style={{
                          width: `${String(Math.max(4, Math.round((stage.count / max) * 100)))}%`,
                        }}
                      />
                    </span>
                    <span className="cq-body-sm text-right tabular-nums text-(--cq-text-primary)">
                      {stage.count}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {picked !== null && unlisted.includes(picked) ? (
            <p className="cq-body-sm text-(--cq-text-secondary)">
              {stateWord(picked, side)} relationships aren’t listed here. Find
              them on Relationships.
            </p>
          ) : shown.length === 0 ? null : (
            <ul className="divide-y divide-(--cq-border-subtle) border-t border-(--cq-border-subtle)">
              {shown.map((row) => {
                const inner = (
                  <>
                    {row.avatar}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="cq-body truncate text-(--cq-text-primary)">
                        {row.name}
                      </span>
                      <span className="cq-caption truncate text-(--cq-text-secondary)">
                        {picked === null
                          ? `${stateWord(row.state, side)} · ${row.detail}`
                          : row.detail}
                      </span>
                    </span>
                  </>
                );
                return (
                  <li key={row.key}>
                    {row.href === null ? (
                      <span className="flex min-h-14 items-center gap-3 px-1 py-2">
                        {inner}
                      </span>
                    ) : (
                      <Link
                        href={row.href}
                        className="flex min-h-14 items-center gap-3 px-1 py-2 hover:bg-(--cq-surface-subtle) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
                      >
                        {inner}
                        <ChevronRight
                          size={ICON_SIZE.regular}
                          aria-hidden="true"
                          className="shrink-0 text-(--cq-text-tertiary)"
                        />
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}

function Lines({
  items,
}: {
  readonly items: readonly {
    readonly label: string;
    readonly value: string;
  }[];
}) {
  return (
    <dl className="divide-y divide-(--cq-border-subtle)">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex min-h-10 items-center justify-between gap-3 py-1.5"
        >
          <dt className="cq-body-sm text-(--cq-text-secondary)">
            {item.label}
          </dt>
          <dd className="cq-body-sm text-right tabular-nums text-(--cq-text-primary)">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function responseTile(
  label: string,
  response: InvestorResults["responseTime"],
) {
  if (response === undefined) {
    return { label, value: "Unknown", note: undefined };
  }
  return {
    label,
    value:
      response.medianHours === null
        ? "No answers yet"
        : waitWords(response.medianHours),
    note:
      response.medianHours === null
        ? response.waiting === 0
          ? undefined
          : `${plural(response.waiting, "waiting", "waiting")}`
        : `Median of ${String(response.answered)}${response.waiting === 0 ? "" : ` · ${String(response.waiting)} waiting`}`,
  };
}

function InvestorDashboard(
  props: ResultsDashboardProps & {
    readonly results: InvestorResults;
  },
) {
  const { results, usage } = props;
  const interest = results.interest;
  const commitments = commitmentLines(results.commitments ?? []);
  const live = commitments
    .filter((line) => line.status !== "WITHDRAWN")
    .reduce((sum, line) => sum + line.count, 0);
  const confirmed = commitments[0];
  const response = responseTile("Founders answer in", results.responseTime);
  const rows: DrillRow[] = results.pipelineFit.map((row) => ({
    key: row.companyId ?? row.companyName,
    state: row.state,
    name: row.companyName,
    detail: row.excluded
      ? "Hits one of your declared exclusions"
      : row.reasons.length === 0
        ? results.hasMandate
          ? "No declared overlap yet"
          : "Add your mandate to see fit"
        : row.reasons
            .map(
              (r) =>
                `${REASON_WORDS[r.kind] ?? sentenceCase(r.kind)}: ${r.detail}`,
            )
            .join(" · "),
    href:
      row.companyId === undefined
        ? null
        : `/relationships/company/${encodeURIComponent(row.companyId)}`,
    avatar: (
      <EntityAvatar
        kind="company"
        name={row.companyName}
        companyId={row.companyId}
        size="sm"
        decorative
      />
    ),
  }));
  const byState =
    results.pipeline?.byState ??
    Object.entries(
      results.pipelineFit.reduce<Record<string, number>>((acc, row) => {
        acc[row.state] = (acc[row.state] ?? 0) + 1;
        return acc;
      }, {}),
    ).map(([state, count]) => ({ state, count }));
  const f = results.funnel;
  const runs = results.qWork.runs;
  const answers = runs
    .filter((r) => r.capability.toUpperCase() === "ANSWER")
    .reduce((sum, r) => sum + r.runs, 0);
  const prepared = runs
    .filter((r) => r.capability.toUpperCase() !== "ANSWER")
    .reduce((sum, r) => sum + r.runs, 0);
  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <Header props={props} name={results.organisationName} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Interest sent"
          value={String(interest?.sent ?? f.interest)}
          note={
            interest === undefined
              ? undefined
              : `${String(interest.accepted)} accepted · ${String(interest.declined)} declined`
          }
          href={stageHref(props.basePath, props.range, "INTEREST_EXPRESSED")}
        />
        <Tile {...response} />
        <Tile
          label="Meetings held"
          value={String(results.meetings.held)}
          note={
            results.meetings.upcoming.length === 0
              ? "None coming up"
              : `${String(results.meetings.upcoming.length)} coming up`
          }
        />
        <Tile
          label="Commitments"
          value={results.commitments === undefined ? "Unknown" : String(live)}
          note={
            results.commitments === undefined || confirmed === undefined
              ? undefined
              : `${String(confirmed.count)} confirmed`
          }
          href="#commitments"
        />
      </div>

      <Activity activity={results.activity} first="Interest sent" />

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-[3fr_2fr]">
        <div className="flex min-w-0 flex-col gap-4 sm:gap-5">
          <Pipeline
            props={props}
            side="INVESTOR"
            byState={byState}
            rows={rows}
            unlisted={["DECLINED", "CLOSED"]}
          />
          <Panel id="deal-flow" title="From your feed">
            <ol className="grid grid-cols-3 gap-3 sm:grid-cols-6">
              {[
                ["Seen", f.seen],
                ["Saved", f.saved],
                ["Interest", f.interest],
                ["Connected", f.connected],
                ["Met", f.met],
                ["Committed", f.committed],
              ].map(([label, value]) => (
                <li key={String(label)} className="flex flex-col gap-0.5">
                  <span className="cq-caption text-(--cq-text-secondary)">
                    {label}
                  </span>
                  <span className="cq-title-sm tabular-nums text-(--cq-text-primary)">
                    {value}
                  </span>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
        <div className="flex min-w-0 flex-col gap-4 sm:gap-5">
          <Panel
            id="commitments"
            title="Commitments"
            action={
              <Link
                href="/capital"
                className="cq-body-sm text-(--cq-accent) underline-offset-2 hover:underline"
              >
                Open Capital
              </Link>
            }
          >
            {results.commitments === undefined ? (
              <p className="cq-body-sm text-(--cq-text-secondary)">
                Commitments couldn’t be read just now.
              </p>
            ) : (
              <Lines
                items={commitments.map((line) => ({
                  label: line.label,
                  value:
                    line.count === 0
                      ? "0"
                      : `${String(line.count)} · ${line.amounts.join(", ")}`,
                }))}
              />
            )}
          </Panel>
          <Panel
            id="q-work"
            title="Q’s work"
            action={
              <Link
                href="/settings/usage"
                className="cq-body-sm text-(--cq-accent) underline-offset-2 hover:underline"
              >
                Usage
              </Link>
            }
          >
            <Lines
              items={[
                { label: "Questions answered", value: String(answers) },
                {
                  label: "Prepared for your approval",
                  value: String(prepared),
                },
                { label: "Errands run", value: String(results.qWork.errands) },
                {
                  label: "Documents prepared",
                  value: String(results.qWork.documents),
                },
                {
                  label: "Spend this month",
                  value:
                    usage === null
                      ? "Unknown"
                      : `USD ${Number(usage.totalUsd).toFixed(2)}`,
                },
              ]}
            />
          </Panel>
          {results.meetings.upcoming.length === 0 ? null : (
            <Panel id="upcoming" title="Coming up">
              <Lines
                items={results.meetings.upcoming.slice(0, 5).map((m) => ({
                  label: m.companyName,
                  value: new Date(m.startsAt).toLocaleString("en-GB", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
                }))}
              />
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

function RaisePanel({ results }: { readonly results: FounderResults }) {
  const raise = results.raise;
  if (raise === null) {
    return (
      <Panel id="raise" title="Your round">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="cq-body-sm text-(--cq-text-secondary)">
            Set your round on Capital to see what’s raised against it.
          </p>
          <Link
            className={buttonClassName("primary", "compact")}
            href="/capital"
          >
            Set your round
          </Link>
        </div>
      </Panel>
    );
  }
  const target = raise.target;
  const own =
    target === null
      ? undefined
      : raise.totals.find((t) => t.currencyCode === target.currencyCode);
  const ratio = (amount: string) =>
    target === null || Number(target.amount) <= 0
      ? 0
      : Math.min(100, (Number(amount) / Number(target.amount)) * 100);
  const confirmedPct = own === undefined ? 0 : ratio(own.confirmed);
  const softPct =
    own === undefined ? 0 : Math.min(100, confirmedPct + ratio(own.soft));
  return (
    <Panel
      id="raise"
      title="Your round"
      action={
        <Link
          href="/capital"
          className="cq-body-sm text-(--cq-accent) underline-offset-2 hover:underline"
        >
          Open Capital
        </Link>
      }
    >
      <div className="flex flex-col gap-2">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[1.625rem] leading-tight font-semibold tabular-nums text-(--cq-text-primary) sm:text-[1.875rem]">
            {own === undefined
              ? target === null
                ? "Target not set"
                : money(target.currencyCode, "0")
              : money(own.currencyCode, own.confirmed)}
          </span>
          <span className="cq-body-sm text-(--cq-text-secondary)">
            {target === null
              ? "confirmed"
              : `confirmed of ${money(target.currencyCode, target.amount)}`}
          </span>
        </p>
        {target === null ? null : (
          <div
            role="img"
            aria-label={`${String(Math.round(confirmedPct))}% confirmed, ${String(Math.round(softPct))}% with soft commitments`}
            className="relative h-2.5 overflow-hidden rounded-(--cq-radius-full) bg-(--cq-surface-subtle)"
          >
            <span
              className="absolute inset-y-0 left-0 bg-(--cq-accent-soft) [background-image:repeating-linear-gradient(135deg,transparent_0_4px,var(--cq-border)_4px_5px)]"
              style={{ width: `${String(softPct)}%` }}
            />
            <span
              className="absolute inset-y-0 left-0 bg-(--cq-accent)"
              style={{ width: `${String(confirmedPct)}%` }}
            />
          </div>
        )}
        <p className="cq-caption text-(--cq-text-secondary)">
          {[
            own === undefined || Number(own.soft) === 0
              ? null
              : `${money(own.currencyCode, own.soft)} soft`,
            raise.remaining === null || target === null
              ? null
              : `${money(target.currencyCode, raise.remaining)} to go`,
            `${plural(raise.inConversation, "investor", "investors")} in conversation`,
          ]
            .filter((part): part is string => part !== null)
            .join(" · ")}
        </p>
      </div>
      {raise.committedInvestors.length === 0 ? null : (
        <Lines
          items={raise.committedInvestors.map((i) => ({
            label: i.investorName,
            value: `${money(i.currencyCode, i.amount)} · ${i.bucket === "CONFIRMED" ? "confirmed" : "soft"}`,
          }))}
        />
      )}
    </Panel>
  );
}

function FounderDashboard(
  props: ResultsDashboardProps & {
    readonly results: FounderResults;
  },
) {
  const { results } = props;
  const e = results.engagement;
  const rows: DrillRow[] = results.pipeline.rows.map((row) => ({
    key: row.investorOrganisationId ?? `${row.investorName}-${row.since}`,
    state: row.state,
    name: row.investorName,
    detail: `since ${new Date(row.since).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`,
    href:
      row.investorOrganisationId === undefined
        ? null
        : `/relationships/investor/${encodeURIComponent(row.investorOrganisationId)}`,
    avatar: (
      <EntityAvatar
        kind="investor"
        name={row.investorName}
        investorOrganisationId={row.investorOrganisationId}
        size="sm"
        decorative
      />
    ),
  }));
  const floored = (value: { value: number | null; belowFloor: boolean }) =>
    value.belowFloor ? "Fewer than 3" : String(value.value ?? 0);
  const scored = results.rehearsals.filter((r) => r.score !== null);
  const latest = scored[0];
  const before = scored[1];
  const change =
    typeof latest?.score === "number" && typeof before?.score === "number"
      ? latest.score - before.score
      : null;
  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <Header props={props} name={results.organisationName} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Investors engaged"
          value={
            results.investorsEngaged === undefined
              ? String(e.connections)
              : String(results.investorsEngaged)
          }
          note={`${plural(e.interestsReceived, "interest", "interests")} received`}
          href={stageHref(props.basePath, props.range, null)}
        />
        <Tile
          label="Meetings held"
          value={String(e.meetingsHeld)}
          note={`${plural(e.connections, "new connection", "new connections")}`}
        />
        <Tile
          label="Diligence requests"
          value={
            results.diligence === undefined
              ? "Unknown"
              : String(results.diligence.requested)
          }
          note={
            results.diligence === undefined
              ? undefined
              : `${String(results.diligence.fulfilled)} answered`
          }
        />
        <Tile {...responseTile("You answer in", results.responseTime)} />
      </div>

      <RaisePanel results={results} />

      <Activity activity={results.activity} first="Interest received" />

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-[3fr_2fr]">
        <Pipeline
          props={props}
          side="FOUNDER"
          byState={results.pipeline.byState}
          rows={rows}
          unlisted={[]}
        />
        <div className="flex min-w-0 flex-col gap-4 sm:gap-5">
          <Panel
            id="rehearsals"
            title="Rehearsals"
            action={
              <Link
                href="/rehearsals"
                className="cq-body-sm text-(--cq-accent) underline-offset-2 hover:underline"
              >
                Rehearse
              </Link>
            }
          >
            {latest === undefined ? (
              <p className="cq-body-sm text-(--cq-text-secondary)">
                None in this period.
              </p>
            ) : (
              <Lines
                items={[
                  {
                    label: "Rehearsed",
                    value: plural(results.rehearsals.length, "time", "times"),
                  },
                  {
                    label: `Latest, with ${latest.counterpart}`,
                    value: `${String(latest.score)} / 100${
                      change === null
                        ? ""
                        : ` (${change >= 0 ? "+" : ""}${String(change)})`
                    }`,
                  },
                ]}
              />
            )}
          </Panel>
          <Panel id="seen" title="Seen by investors">
            <Lines
              items={[
                {
                  label: "Firms that opened your profile",
                  value: floored(e.profileOpens),
                },
                {
                  label: "Firms that watched your pitch",
                  value: floored(e.pitchWatches),
                },
              ]}
            />
          </Panel>
          {results.documents.length === 0 ? null : (
            <Panel id="documents" title="Documents Q made">
              <Lines
                items={results.documents.map((d) => ({
                  label: sentenceCase(d.type),
                  value: String(d.count),
                }))}
              />
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

export function ResultsDashboard(props: ResultsDashboardProps) {
  return props.results.side === "FOUNDER" ? (
    <FounderDashboard {...props} results={props.results} />
  ) : (
    <InvestorDashboard {...props} results={props.results} />
  );
}
