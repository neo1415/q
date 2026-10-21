import "@/features/relationships/crm.css";

import Link from "next/link";

import type {
  BillingFeatureStandingDto,
  QUsageDto,
  QWorkDto,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { Check, Clock, ICON_SIZE, ICON_STROKE } from "@capital-q/ui/icons";

import { STATUS_WORDS, WORK_KIND_LABELS } from "@/features/work/work-words";

import { remainingOf } from "./plan-words";
import { dollars, taskName } from "./usage-words";

/**
 * Settings → Usage, told as the work it paid for (chosen design "What Q
 * did, in words", 2026-10-21): what Q did for the person this month (or
 * last), each line saying what it was and what it used, then the totals.
 *
 * Every line is read, never written for effect: Q's jobs from the Work
 * list, then what each kind of work cost from the usage ledger. Standing
 * work says it is still running. Totals are the plan's own counts this
 * month; last month has no plan standing, so its totals are what each
 * kind of work cost. Nothing here is a charge, and call counts never show.
 */

type Purpose = QUsageDto["byTask"][number]["purpose"];

/** What Q did, by purpose, in the person's terms. */
const PURPOSE_STORY: Readonly<Record<Purpose, string>> = {
  CONVERSATION: "Talked things through with you",
  INSTRUCTION: "Worked on your standing instructions",
  DELEGATED_WORK: "Worked on the jobs you gave it",
  REHEARSAL: "Rehearsed your pitch with you",
  RESEARCH: "Researched for you",
  ONBOARDING: "Set up your workspace with you",
  MEETING: "Joined and wrote up your meetings",
  DOCUMENT: "Read and wrote documents for you",
  VOICE_REALTIME: "Spoke with you live",
  OTHER: "Other work for you",
};

export type UsagePeriod = "current" | "previous";

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** Whether a job belongs to the month being read (YYYY-MM, UTC). */
export function workInMonth(work: QWorkDto, month: string): boolean {
  const started = work.createdAt.slice(0, 7);
  const last = (work.lastStep?.at ?? work.createdAt).slice(0, 7);
  if (work.status === "ACTIVE") return started <= month;
  return started <= month && last >= month;
}

export type StoryLine = {
  readonly key: string;
  readonly title: string;
  readonly detail: string;
  readonly when: string;
  readonly running: boolean;
};

/** The lines, in order: Q's jobs first, then each kind of work's cost. */
export function storyLines({
  usage,
  work,
  period,
}: {
  readonly usage: QUsageDto;
  readonly work: readonly QWorkDto[] | null;
  readonly period: UsagePeriod;
}): readonly StoryLine[] {
  const jobs = (work ?? [])
    .filter((item) => workInMonth(item, usage.month))
    .map((item): StoryLine => {
      const running = item.status === "ACTIVE";
      const spend =
        item.spend === null
          ? ""
          : `. ${dollars(item.spend.spentUsdMonth)} of ${dollars(item.spend.budgetUsdMonth)} this month`;
      return {
        key: `work-${item.id}`,
        title: item.goal ?? item.summary ?? WORK_KIND_LABELS[item.kind],
        detail: `${WORK_KIND_LABELS[item.kind]}, ${STATUS_WORDS[item.status].toLowerCase()}${spend}`,
        when: running
          ? `Since ${day(item.createdAt)}`
          : day(item.lastStep?.at ?? item.createdAt),
        running,
      };
    });
  const kinds = usage.byTask
    .filter((row) => Number(row.usd) > 0)
    .toSorted((a, b) => Number(b.usd) - Number(a.usd))
    .map((row): StoryLine => ({
      key: `purpose-${row.purpose}`,
      title: PURPOSE_STORY[row.purpose],
      detail: `${taskName(row.purpose)}, about ${dollars(row.usd)}`,
      when: period === "current" ? "This month" : "Last month",
      running: false,
    }));
  return [...jobs, ...kinds];
}

export function UsageStory({
  usage,
  work,
  period,
  planName,
}: {
  readonly usage: QUsageDto;
  /** Q's jobs, or null when they could not be read. */
  readonly work: readonly QWorkDto[] | null;
  readonly period: UsagePeriod;
  /** The plan's name, for the line beside the switch. */
  readonly planName: string | null;
}) {
  const lines = storyLines({ usage, work, period });
  const features = (usage.plan?.features ?? []).filter(
    (feature) => feature.kind === "MONTHLY" || feature.kind === "COUNT",
  );
  return (
    <div data-usage-story={period}>
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <nav
          aria-label="Month"
          className="inline-flex gap-0.5 rounded-[10px] bg-(--cq-surface-strong) p-[3px]"
        >
          {(
            [
              ["current", "This month", "/settings/usage"],
              ["previous", "Last month", "/settings/usage?month=previous"],
            ] as const
          ).map(([key, label, href]) => (
            <Link
              key={key}
              href={href}
              scroll={false}
              aria-current={key === period ? "page" : undefined}
              className={cx(
                "inline-flex min-h-11 items-center rounded-(--cq-radius-md) px-3 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-(--cq-motion-fast) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--cq-focus-ring) lg:min-h-[38px]",
                key === period
                  ? "bg-(--cq-surface-raised) text-(--cq-text-primary) shadow-[0_1px_2px_rgb(0_0_0/0.12),0_0_0_1px_var(--cq-border-subtle)]"
                  : "text-(--cq-text-secondary) hover:text-(--cq-text-primary)",
              )}
              data-usage-period={key}
            >
              {label}
            </Link>
          ))}
        </nav>
        <span className="text-xs text-(--cq-text-tertiary)">
          {planName === null
            ? "Resets on the 1st."
            : `${planName}. Resets on the 1st.`}
        </span>
      </div>

      {lines.length === 0 ? (
        <div
          className="cq-crm-swap flex flex-col items-center gap-2 rounded-(--cq-radius-lg) border border-dashed border-(--cq-border) bg-(--cq-surface) px-6 py-10 text-center"
          data-usage-empty
        >
          <span className="grid size-12 place-items-center rounded-full bg-(--cq-surface-subtle) text-(--cq-text-secondary)">
            <Clock size={22} strokeWidth={ICON_STROKE} aria-hidden="true" />
          </span>
          <b className="text-base text-(--cq-text-primary)">
            {period === "current"
              ? "Nothing yet this month"
              : "Nothing recorded last month"}
          </b>
          <p className="m-0 max-w-[44ch] text-(--cq-text-secondary)">
            {period === "current"
              ? "Ask Q something, or give it a job, and the work shows here."
              : "Q did no work for you last month, so there is nothing to show."}
          </p>
        </div>
      ) : (
        <ul className="cq-crm-stagger m-0 flex list-none flex-col gap-2 p-0">
          {lines.map((line) => (
            <li
              key={line.key}
              className="cq-crm-lift grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3.5 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-4 py-3.5 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
              data-usage-line={line.running ? "running" : "done"}
            >
              <span className="grid size-10 place-items-center rounded-full bg-(--cq-surface-subtle) text-(--cq-text-secondary)">
                {line.running ? (
                  <Clock
                    size={ICON_SIZE.compact}
                    strokeWidth={ICON_STROKE}
                    aria-hidden="true"
                  />
                ) : (
                  <Check
                    size={ICON_SIZE.compact}
                    strokeWidth={ICON_STROKE}
                    aria-hidden="true"
                  />
                )}
              </span>
              <span className="min-w-0">
                <b className="block text-[15px] font-medium text-(--cq-text-primary)">
                  {line.title}
                </b>
                <span className="text-[13px] text-(--cq-text-secondary)">
                  {line.detail}
                </span>
              </span>
              <span className="col-start-2 text-xs text-(--cq-text-tertiary) sm:col-start-auto">
                {line.when}
              </span>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-7 mb-3 text-[15px] font-semibold text-(--cq-text-primary)">
        {period === "current" ? "Totals this month" : "Totals last month"}
      </h2>
      {features.length > 0 ? (
        <ul className="m-0 grid list-none grid-cols-1 gap-2.5 p-0 sm:grid-cols-3 sm:gap-3.5">
          {features.map((feature) => (
            <FeatureTotal key={feature.key} feature={feature} />
          ))}
        </ul>
      ) : (
        <CostTotals usage={usage} />
      )}
      <p className="mt-3 text-xs text-(--cq-text-tertiary)">
        Amounts are approximate and nothing here is charged.
      </p>
    </div>
  );
}

const DAY_MONTH = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function FeatureTotal({
  feature,
}: {
  readonly feature: BillingFeatureStandingDto;
}) {
  if (!feature.included) {
    return (
      <li className="flex min-h-[140px] flex-col gap-2.5 rounded-(--cq-radius-lg) border border-dashed border-(--cq-border-subtle) bg-(--cq-surface) p-[18px]">
        <h3 className="m-0 text-sm font-medium text-(--cq-text-secondary)">
          {feature.name}
        </h3>
        <Unknown>Not included in your plan</Unknown>
        <Link
          href="/settings/plan"
          className="inline-flex min-h-11 items-center self-start rounded-(--cq-radius-md) px-2.5 text-[13px] font-medium text-(--cq-text-secondary) hover:bg-(--cq-surface-subtle) hover:text-(--cq-text-primary)"
        >
          See plans
        </Link>
      </li>
    );
  }
  const used = feature.used;
  const left = remainingOf(feature);
  const resets =
    feature.resetsAt === null
      ? null
      : `resets ${DAY_MONTH.format(new Date(feature.resetsAt))}`;
  return (
    <li
      className="flex min-h-[140px] flex-col gap-2.5 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-[18px]"
      data-usage-total={feature.key}
    >
      <h3 className="m-0 text-sm font-medium text-(--cq-text-secondary)">
        {feature.name}
      </h3>
      {used === null ? (
        <Unknown>Not measured yet</Unknown>
      ) : (
        <span className="text-[26px] font-semibold tracking-[-0.02em] text-(--cq-text-primary) tabular-nums">
          {used}
          <small className="ms-1 text-sm font-normal text-(--cq-text-tertiary)">
            {feature.limit === null
              ? feature.kind === "MONTHLY"
                ? "this month"
                : "now"
              : `of ${String(feature.limit)}`}
          </small>
        </span>
      )}
      {feature.limit === null || used === null ? (
        <span className="text-xs text-(--cq-text-tertiary)">
          No limit on your plan
        </span>
      ) : (
        <>
          <span
            aria-hidden="true"
            className="h-2 overflow-hidden rounded-full bg-(--cq-surface-subtle)"
          >
            <span
              className="block h-full rounded-full bg-(--cq-positive)"
              style={{
                width: `${String(Math.min(100, feature.limit === 0 ? 100 : (used / feature.limit) * 100))}%`,
              }}
            />
          </span>
          <span className="text-xs text-(--cq-text-tertiary)">
            {[left === null ? null : `${String(left)} left`, resets]
              .filter((part) => part !== null)
              .join(", ")}
          </span>
        </>
      )}
    </li>
  );
}

/** Last month (or no plan read): what each kind of work cost. */
function CostTotals({ usage }: { readonly usage: QUsageDto }) {
  const rows = usage.byTask
    .filter((row) => Number(row.usd) > 0)
    .toSorted((a, b) => Number(b.usd) - Number(a.usd))
    .slice(0, 3);
  if (rows.length === 0) {
    return (
      <p className="m-0 text-sm text-(--cq-text-secondary)">
        Nothing used, so there are no totals.
      </p>
    );
  }
  return (
    <ul className="m-0 grid list-none grid-cols-1 gap-2.5 p-0 sm:grid-cols-3 sm:gap-3.5">
      {rows.map((row) => (
        <li
          key={row.purpose}
          className="flex min-h-[140px] flex-col gap-2.5 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-[18px]"
          data-usage-total={row.purpose}
        >
          <h3 className="m-0 text-sm font-medium text-(--cq-text-secondary)">
            {taskName(row.purpose)}
          </h3>
          <span className="text-[26px] font-semibold tracking-[-0.02em] text-(--cq-text-primary) tabular-nums">
            {dollars(row.usd)}
          </span>
          <span className="text-xs text-(--cq-text-tertiary)">
            Approximate, not charged
          </span>
        </li>
      ))}
    </ul>
  );
}

function Unknown({ children }: { readonly children: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-(--cq-text-tertiary)">
      <span
        aria-hidden="true"
        className="size-2.5 flex-none rounded-full border-[1.5px] border-dashed border-(--cq-text-tertiary)"
      />
      {children}
    </span>
  );
}
