import type { Metadata } from "next";
import Link from "next/link";

import { getResults } from "@capital-q/api-client";
import type { FounderResults, InvestorResults } from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import { fieldControlClassName } from "@capital-q/ui/input";
import { EmptyState, ErrorState } from "@capital-q/ui/states";

import {
  PageContainer,
  PageHeader,
  PageSection,
} from "@/components/app-shell/page-container";
import { apiSession } from "@/features/q/context";

export const metadata: Metadata = { title: "Results" };
export const dynamic = "force-dynamic";

const RANGES = [
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "12m", label: "12 months" },
  { value: "all", label: "All time" },
] as const;

const STATE_WORDS: Readonly<Record<string, string>> = {
  DISCOVERED: "Discovered",
  INTEREST_EXPRESSED: "Interest expressed",
  CONNECTED: "Connected",
  DECLINED: "Declined",
  CLOSED: "Closed",
};

const REASON_WORDS: Readonly<Record<string, string>> = {
  STAGE_IN_RANGE: "Stage",
  SECTOR_MATCH: "Sector",
  GEOGRAPHY_MATCH: "Geography",
  BUSINESS_MODEL_MATCH: "Business model",
  CUSTOMER_TYPE_MATCH: "Customer type",
  DECLARED_DEPLOYING: "Deploying",
  PROFILE_COMPLETE: "Profile complete",
};

function sentence(code: string): string {
  const text = code.replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function money(currency: string, amount: string): string {
  const [whole = "0", fraction] = amount.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = (fraction ?? "").replace(/0+$/, "");
  return `${currency} ${cents.length === 0 ? grouped : `${grouped}.${cents.padEnd(2, "0").slice(0, 2)}`}`;
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function Figures({
  items,
}: {
  readonly items: readonly {
    readonly term: string;
    readonly value: string;
    readonly note?: string;
  }[];
}) {
  return (
    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      {items.map((item) => (
        <div key={item.term} className="flex flex-col gap-1">
          <dt className="cq-caption text-(--cq-text-secondary)">{item.term}</dt>
          <dd className="cq-title-sm tabular-nums text-(--cq-text-primary)">
            {item.value}
          </dd>
          {item.note === undefined ? null : (
            <dd className="cq-caption text-(--cq-text-secondary)">
              {item.note}
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
}

/** A labelled bar; the number is always written beside it. */
function Bar({
  label,
  value,
  max,
}: {
  readonly label: string;
  readonly value: number;
  readonly max: number;
}) {
  const width =
    max === 0
      ? 0
      : Math.max(value === 0 ? 0 : 2, Math.round((value / max) * 100));
  return (
    <li className="grid grid-cols-[8rem_1fr_3rem] items-center gap-3">
      <span className="cq-body-sm text-(--cq-text-primary)">{label}</span>
      <span
        aria-hidden="true"
        className="h-2 rounded-full bg-(--cq-surface-subtle)"
      >
        <span
          className="block h-2 rounded-full bg-(--cq-accent)"
          style={{ width: `${String(width)}%` }}
        />
      </span>
      <span className="cq-body-sm text-right tabular-nums text-(--cq-text-primary)">
        {value}
      </span>
    </li>
  );
}

function FounderView({ results }: { readonly results: FounderResults }) {
  const raise = results.raise;
  const floored = (value: { value: number | null; belowFloor: boolean }) =>
    value.belowFloor ? "Fewer than 3" : String(value.value ?? 0);
  return (
    <>
      <PageSection
        id="raise"
        title="Raise progress"
        description="Now, whatever the period. Confirmed means both sides confirmed it."
      >
        {raise === null ? (
          <EmptyState
            compact
            title="No raise to show"
            description="Set your raise on Capital to track it here."
            action={
              <Link
                className={buttonClassName("secondary", "compact")}
                href="/capital"
              >
                Open Capital
              </Link>
            }
          />
        ) : (
          <div className="flex flex-col gap-4">
            <Figures
              items={[
                {
                  term: "Target",
                  value:
                    raise.target === null
                      ? "Not stated"
                      : money(raise.target.currencyCode, raise.target.amount),
                },
                ...raise.totals.flatMap((t) => [
                  {
                    term: `Confirmed (${t.currencyCode})`,
                    value: money(t.currencyCode, t.confirmed),
                  },
                  {
                    term: `Soft (${t.currencyCode})`,
                    value: money(t.currencyCode, t.soft),
                  },
                ]),
                {
                  term: "Remaining",
                  value:
                    raise.remaining === null
                      ? "Not stated"
                      : money(
                          raise.target?.currencyCode ?? "",
                          raise.remaining,
                        ),
                },
                {
                  term: "In conversation",
                  value: String(raise.inConversation),
                  note: "Connected, no commitment yet",
                },
              ]}
            />
            {raise.committedInvestors.length === 0 ? null : (
              <ul className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
                {raise.committedInvestors.map((investor) => (
                  <li
                    key={`${investor.investorName}-${investor.amount}`}
                    className="flex flex-wrap justify-between gap-2 py-2"
                  >
                    <span className="cq-body-sm text-(--cq-text-primary)">
                      {investor.investorName}
                    </span>
                    <span className="cq-body-sm tabular-nums text-(--cq-text-secondary)">
                      {money(investor.currencyCode, investor.amount)} ·{" "}
                      {investor.bucket === "CONFIRMED" ? "Confirmed" : "Soft"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </PageSection>

      <PageSection
        id="engagement"
        title="Investor engagement"
        description="Recorded events in this period. Viewing is not interest."
      >
        <Figures
          items={[
            {
              term: "Interests received",
              value: String(results.engagement.interestsReceived),
            },
            {
              term: "Connections",
              value: String(results.engagement.connections),
            },
            {
              term: "Meetings held",
              value: String(results.engagement.meetingsHeld),
            },
            {
              term: "Firms that opened your profile",
              value: floored(results.engagement.profileOpens),
            },
            {
              term: "Firms that watched your pitch",
              value: floored(results.engagement.pitchWatches),
            },
          ]}
        />
      </PageSection>

      <PageSection
        id="pipeline"
        title="Pipeline"
        description="Where each investor relationship stands now."
      >
        {results.pipeline.rows.length === 0 ? (
          <EmptyState
            compact
            title="No relationships yet"
            description="They start when an investor expresses interest or you answer one."
          />
        ) : (
          <div className="flex flex-col gap-4">
            <ul className="flex flex-col gap-2">
              {results.pipeline.byState.map((state) => (
                <Bar
                  key={state.state}
                  label={STATE_WORDS[state.state] ?? sentence(state.state)}
                  value={state.count}
                  max={Math.max(
                    ...results.pipeline.byState.map((s) => s.count),
                  )}
                />
              ))}
            </ul>
            <ul className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
              {results.pipeline.rows.map((row) => (
                <li
                  key={`${row.investorName}-${row.since}`}
                  className="flex flex-wrap justify-between gap-2 py-2"
                >
                  <span className="cq-body-sm text-(--cq-text-primary)">
                    {row.investorName}
                  </span>
                  <span className="cq-caption text-(--cq-text-secondary)">
                    {STATE_WORDS[row.state] ?? sentence(row.state)} since{" "}
                    {day(row.since)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </PageSection>

      <PageSection id="rehearsals" title="Rehearsals">
        {results.rehearsals.length === 0 ? (
          <EmptyState
            compact
            title="No rehearsals in this period"
            action={
              <Link
                className={buttonClassName("secondary", "compact")}
                href="/rehearsals"
              >
                Open Rehearsals
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
            {results.rehearsals.map((r) => (
              <li key={r.at} className="flex flex-col gap-0.5 py-2">
                <span className="cq-body-sm text-(--cq-text-primary)">
                  {day(r.at)} with {r.counterpart}
                  {r.score === null ? "" : ` · score ${String(r.score)}`}
                  {r.outcome === null ? "" : ` · ${sentence(r.outcome)}`}
                </span>
                {r.ratings.length === 0 ? null : (
                  <span className="cq-caption text-(--cq-text-secondary)">
                    {r.ratings
                      .map(
                        (x) =>
                          `${sentence(x.dimension)}: ${sentence(x.rating).toLowerCase()}`,
                      )
                      .join(" · ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </PageSection>

      <PageSection id="documents" title="Documents made">
        {results.documents.length === 0 ? (
          <EmptyState compact title="No documents in this period" />
        ) : (
          <ul className="flex flex-col gap-1">
            {results.documents.map((d) => (
              <li
                key={d.type}
                className="cq-body-sm flex justify-between gap-3 text-(--cq-text-primary)"
              >
                <span>{sentence(d.type)}</span>
                <span className="tabular-nums">{d.count}</span>
              </li>
            ))}
          </ul>
        )}
      </PageSection>
    </>
  );
}

function InvestorView({ results }: { readonly results: InvestorResults }) {
  const f = results.funnel;
  const steps = [
    { label: "Seen", value: f.seen },
    { label: "Saved", value: f.saved },
    { label: "Interest", value: f.interest },
    { label: "Connected", value: f.connected },
    { label: "Met", value: f.met },
    { label: "Committed", value: f.committed },
  ];
  const max = Math.max(...steps.map((s) => s.value));
  return (
    <>
      <PageSection
        id="funnel"
        title="Deal flow"
        description="Distinct companies at each step in this period, as recorded. A step is counted even when the one above it was not recorded (a company saved from a link was never seen in the feed), and a later change, like unsaving, does not remove it."
      >
        {max === 0 ? (
          <EmptyState
            compact
            title="No deal flow in this period"
            action={
              <Link
                className={buttonClassName("secondary", "compact")}
                href="/discover"
              >
                Open Discover
              </Link>
            }
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {steps.map((step) => (
              <Bar
                key={step.label}
                label={step.label}
                value={step.value}
                max={max}
              />
            ))}
          </ul>
        )}
      </PageSection>

      <PageSection id="meetings" title="Meetings">
        <div className="flex flex-col gap-3">
          <Figures
            items={[
              {
                term: "Held in this period",
                value: String(results.meetings.held),
              },
            ]}
          />
          {results.meetings.upcoming.length === 0 ? null : (
            <ul className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
              {results.meetings.upcoming.map((m) => (
                <li
                  key={`${m.companyName}-${m.startsAt}`}
                  className="flex flex-wrap justify-between gap-2 py-2"
                >
                  <span className="cq-body-sm text-(--cq-text-primary)">
                    {m.companyName}
                  </span>
                  <span className="cq-caption text-(--cq-text-secondary)">
                    {new Date(m.startsAt).toLocaleString("en-GB", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PageSection>

      <PageSection id="q-work" title="Q's work for you">
        <Figures
          items={[
            ...results.qWork.runs.map((r) => ({
              // "Answer 133" read as one answer: the count is of runs.
              term:
                r.capability.toUpperCase() === "ANSWER"
                  ? "Answers"
                  : sentence(r.capability),
              value: String(r.runs),
            })),
            { term: "Errands", value: String(results.qWork.errands) },
            {
              term: "Documents prepared",
              value: String(results.qWork.documents),
            },
          ]}
        />
      </PageSection>

      <PageSection
        id="fit"
        title="Mandate fit of your pipeline"
        description="What each company and your mandate declared in common. No overlap yet is unknown, not a poor fit."
      >
        {results.pipelineFit.length === 0 ? (
          <EmptyState compact title="No open relationships" />
        ) : (
          <ul className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
            {results.pipelineFit.map((row) => (
              <li key={row.companyName} className="flex flex-col gap-0.5 py-2">
                <span className="cq-body-sm text-(--cq-text-primary)">
                  {row.companyName} ·{" "}
                  {STATE_WORDS[row.state] ?? sentence(row.state)}
                </span>
                <span className="cq-caption text-(--cq-text-secondary)">
                  {row.excluded
                    ? "Hits one of your declared exclusions"
                    : row.reasons.length === 0
                      ? results.hasMandate
                        ? "No declared overlap yet"
                        : "Add your mandate to see fit"
                      : row.reasons
                          .map(
                            (r) =>
                              `${REASON_WORDS[r.kind] ?? sentence(r.kind)}: ${r.detail}`,
                          )
                          .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </PageSection>
    </>
  );
}

/**
 * Results (spec §5): what a person's activity on Capital Q produced, with
 * reports they can take into their business.
 */
export default async function ResultsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const range = RANGES.find((r) => r.value === params["range"])?.value;
  const custom =
    params["from"] !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(params["from"])
      ? {
          from: params["from"],
          ...(params["to"] !== undefined &&
          /^\d{4}-\d{2}-\d{2}$/.test(params["to"])
            ? { to: params["to"] }
            : {}),
        }
      : null;
  const query = custom ?? { range: range ?? "30d" };
  const session = await apiSession();
  const results =
    session === null
      ? null
      : await getResults(session, query).catch(() => null);
  const download = new URLSearchParams(Object.entries(query));
  const control = `${fieldControlClassName} h-11 cq-body-sm lg:h-10`;
  return (
    <PageContainer>
      <PageHeader
        title="Results"
        description="What your work on Capital Q produced. Counts of recorded events, nothing estimated."
      />
      <div className="flex flex-col gap-10">
        <div className="flex flex-col gap-4">
          <nav aria-label="Period" className="flex flex-wrap gap-2">
            {RANGES.map((option) => {
              const active =
                custom === null && (range ?? "30d") === option.value;
              return (
                <Link
                  key={option.value}
                  href={`/results?range=${option.value}`}
                  aria-current={active ? "page" : undefined}
                  className={`cq-body-sm inline-flex min-h-11 items-center rounded-md border px-3 ${
                    active
                      ? "border-(--cq-text-primary) text-(--cq-text-primary)"
                      : "border-(--cq-border-subtle) text-(--cq-text-secondary)"
                  }`}
                >
                  {option.label}
                </Link>
              );
            })}
          </nav>
          <form
            method="get"
            action="/results"
            className="flex flex-wrap items-end gap-2"
          >
            <label className="flex flex-col gap-1">
              <span className="cq-caption text-(--cq-text-secondary)">
                From
              </span>
              <input
                type="date"
                name="from"
                required
                defaultValue={custom?.from ?? ""}
                className={control}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="cq-caption text-(--cq-text-secondary)">To</span>
              <input
                type="date"
                name="to"
                defaultValue={custom?.to ?? ""}
                className={control}
              />
            </label>
            <button type="submit" className={buttonClassName("secondary")}>
              Show period
            </button>
          </form>
          {results === null || results.side === "NONE" ? null : (
            <div className="flex flex-wrap gap-2">
              <a
                href={`/results/report?format=pdf&${download.toString()}`}
                className={buttonClassName("primary")}
                download
              >
                Download PDF report
              </a>
              <a
                href={`/results/report?format=csv&${download.toString()}`}
                className={buttonClassName("secondary")}
                download
              >
                Download CSV
              </a>
            </div>
          )}
          {results === null || results.side === "NONE" ? null : (
            <p className="cq-caption text-(--cq-text-secondary)">
              {results.organisationName} · {results.window.label}
            </p>
          )}
        </div>
        {results === null ? (
          <ErrorState
            title="Results couldn't load"
            description="Try again in a moment. Nothing is lost."
          />
        ) : results.side === "NONE" ? (
          <EmptyState
            title="No results yet"
            description="Results appear once your company or investment firm is set up on Capital Q."
            action={
              <Link
                className={buttonClassName("secondary", "compact")}
                href="/home"
              >
                Ask Q
              </Link>
            }
          />
        ) : results.side === "FOUNDER" ? (
          <FounderView results={results} />
        ) : (
          <InvestorView results={results} />
        )}
      </div>
    </PageContainer>
  );
}
