import type { Metadata } from "next";
import { notFound } from "next/navigation";

import type {
  FounderResults,
  InvestorResults,
  QUsageDto,
  ResultsActivity,
} from "@capital-q/contracts";

import { AppShell } from "@/components/app-shell/app-shell";
import { PageContainer } from "@/components/app-shell/page-container";
import { ResultsDashboard } from "@/features/results/results-dashboard";
import { rangeOf } from "@/features/results/results-words";

export const metadata: Metadata = {
  title: "Results (design review)",
  robots: { index: false },
};

/**
 * The Results dashboard in the real shell with fictional data, for design
 * review and screenshots. Development only; reads and writes nothing.
 * `?side=founder`, `?state=empty`, `?range=7d|30d|all`, `?stage=CONNECTED`.
 */

/** The review page's clock, read once per request (fixtures are relative to it). */
function reviewClock(): number {
  return Date.now();
}

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function series(days: number, empty: boolean, today: string): ResultsActivity {
  if (empty) return { bucket: days <= 31 ? "DAY" : "WEEK", points: [] };
  const week = days > 31;
  const count = week ? 26 : days;
  const step = (week ? 7 : 1) * 86_400_000;
  const end = Date.parse(`${today}T00:00:00Z`);
  return {
    bucket: week ? "WEEK" : "DAY",
    points: Array.from({ length: count }, (_, i) => ({
      start: new Date(end - (count - 1 - i) * step).toISOString().slice(0, 10),
      interests: [0, 1, 0, 2, 1, 0, 3, 0, 1, 0, 0, 1][i % 12] ?? 0,
      connections: [0, 0, 1, 0, 2, 0, 0, 1, 0, 0, 1, 0][i % 12] ?? 0,
      meetings: [0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1][i % 12] ?? 0,
    })),
  };
}

export default async function ResultsReviewPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const one = (key: string) =>
    typeof params[key] === "string" ? params[key] : undefined;
  const founder = one("side") === "founder";
  const empty = one("state") === "empty";
  const range = rangeOf(one("range"));
  const stage = one("stage") ?? null;
  const now = reviewClock();
  const today = new Date(now).toISOString().slice(0, 10);
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 365;
  const window = {
    from: range === "all" ? null : today,
    to: today,
    label: range === "all" ? "All time" : `Last ${String(days)} days`,
  };
  const activity = series(days, empty, today);
  const usage: QUsageDto = {
    month: today.slice(0, 7),
    totalUsd: "3.41",
    calls: 212,
    unpricedCalls: 0,
    failedCalls: 1,
    byTask: [],
    instructions: [],
    plan: null,
  };
  const investor: InvestorResults = {
    side: "INVESTOR",
    organisationName: "Savanna Seed Partners (fictional)",
    window,
    funnel: empty
      ? { seen: 0, saved: 0, interest: 0, connected: 0, met: 0, committed: 0 }
      : {
          seen: 64,
          saved: 11,
          interest: 9,
          connected: 8,
          met: 4,
          committed: 1,
        },
    meetings: {
      held: empty ? 0 : 4,
      upcoming: empty
        ? []
        : [
            {
              companyName: "Tarmacly",
              startsAt: new Date(now + 2 * 86_400_000).toISOString(),
            },
            {
              companyName: "Nsuo Labs",
              startsAt: new Date(now + 4 * 86_400_000).toISOString(),
            },
          ],
    },
    qWork: {
      runs: empty
        ? []
        : [
            { capability: "ANSWER", runs: 202 },
            { capability: "PREPARE_ACTION", runs: 24 },
          ],
      errands: empty ? 0 : 3,
      documents: empty ? 0 : 2,
    },
    pipelineFit: empty
      ? []
      : [
          ["Nsuo Labs", "CONNECTED", "Sector: Logistics & Mobility"],
          ["Tarmacly", "CONNECTED", "Sector: Logistics & Mobility"],
          ["Tallyloom", "CONNECTED", null],
          ["Maji Loop", "CONNECTED", "Stage: seed"],
          ["Clinicrest", "CONNECTED", "Stage: seed"],
          ["Kazikit", "INTEREST_EXPRESSED", "Sector: Enterprise Software"],
          ["Ledgerfold", "CONNECTED", "Stage: seed"],
          ["Ajopot", "IN_DILIGENCE", "Sector: Fintech"],
        ].map(([name, state, reason], index) => ({
          companyName: String(name),
          companyId: id(index + 1),
          state: String(state),
          excluded: false,
          reasons:
            reason === null
              ? []
              : [
                  {
                    kind: String(reason).startsWith("Stage")
                      ? "STAGE_IN_RANGE"
                      : "SECTOR_MATCH",
                    detail: String(reason).split(": ")[1] ?? "",
                  },
                ],
        })),
    hasMandate: true,
    pipeline: {
      byState: empty
        ? []
        : [
            { state: "CONNECTED", count: 6 },
            { state: "INTEREST_EXPRESSED", count: 1 },
            { state: "IN_DILIGENCE", count: 1 },
            { state: "DECLINED", count: 2 },
          ],
    },
    interest: empty
      ? { sent: 0, accepted: 0, declined: 0 }
      : { sent: 9, accepted: 6, declined: 1 },
    responseTime: empty
      ? { medianHours: null, answered: 0, waiting: 0 }
      : { medianHours: 14.2, answered: 7, waiting: 2 },
    commitments: empty
      ? []
      : [
          {
            status: "CONFIRMED",
            currencyCode: "USD",
            count: 1,
            amount: "250000",
          },
          { status: "STATED", currencyCode: "USD", count: 1, amount: "100000" },
        ],
    activity,
  };
  const founderResults: FounderResults = {
    side: "FOUNDER",
    organisationName: "Ledgerfold (fictional)",
    window,
    raise: empty
      ? null
      : {
          target: { currencyCode: "USD", amount: "2000000" },
          totals: [
            { currencyCode: "USD", confirmed: "250000", soft: "350000" },
          ],
          remaining: "1750000",
          inConversation: 3,
          committedInvestors: [
            {
              investorName: "Savanna Seed Partners",
              amount: "250000",
              currencyCode: "USD",
              bucket: "CONFIRMED",
            },
            {
              investorName: "Lagoon Angels Circle",
              amount: "350000",
              currencyCode: "USD",
              bucket: "SOFT",
            },
          ],
        },
    pipeline: {
      byState: empty
        ? []
        : [
            { state: "CONNECTED", count: 3 },
            { state: "IN_DILIGENCE", count: 1 },
            { state: "INTEREST_EXPRESSED", count: 2 },
            { state: "DECLINED", count: 1 },
          ],
      rows: empty
        ? []
        : [
            ["Savanna Seed Partners", "IN_DILIGENCE"],
            ["Voltron Capital", "CONNECTED"],
            ["Ventures Platform", "CONNECTED"],
            ["Harbour Gate Fund", "CONNECTED"],
            ["Lagoon Angels Circle", "DECLINED"],
            ["Kestrel Ventures", "INTEREST_EXPRESSED"],
            ["Baobab Growth", "INTEREST_EXPRESSED"],
          ].map(([name, state], index) => ({
            investorName: String(name),
            state: String(state),
            since: new Date(now - (index + 1) * 86_400_000).toISOString(),
            investorOrganisationId: id(100 + index),
          })),
    },
    engagement: {
      interestsReceived: empty ? 0 : 6,
      connections: empty ? 0 : 3,
      meetingsHeld: empty ? 0 : 4,
      profileOpens: empty
        ? { value: 0, belowFloor: false }
        : { value: 9, belowFloor: false },
      pitchWatches: empty
        ? { value: 0, belowFloor: false }
        : { value: null, belowFloor: true },
    },
    rehearsals: empty
      ? []
      : [
          {
            at: new Date(now).toISOString(),
            counterpart: "Voltron Capital",
            outcome: "FOUNDER_ENDED",
            score: 58,
            ratings: [],
          },
          {
            at: new Date(now - 3_600_000).toISOString(),
            counterpart: "Ventures Platform",
            outcome: "DECLINED",
            score: 46,
            ratings: [],
          },
        ],
    documents: empty ? [] : [{ type: "PITCH_DECK", count: 1 }],
    investorsEngaged: empty ? 0 : 5,
    diligence: empty
      ? { requested: 0, fulfilled: 0 }
      : { requested: 4, fulfilled: 3 },
    responseTime: empty
      ? { medianHours: null, answered: 0, waiting: 0 }
      : { medianHours: 30, answered: 5, waiting: 1 },
    activity,
  };
  return (
    <AppShell
      context={
        founder
          ? {
              scope: "founder_private",
              label: "Ledgerfold (fictional)",
              admin: false,
            }
          : {
              scope: "investor_private",
              label: "Savanna Seed Partners (fictional)",
              admin: false,
            }
      }
    >
      <PageContainer>
        <ResultsDashboard
          basePath={founder ? "/dev/results?side=founder" : "/dev/results"}
          range={range}
          stage={stage}
          download={`range=${range}`}
          usage={founder ? null : usage}
          results={founder ? founderResults : investor}
        />
      </PageContainer>
    </AppShell>
  );
}
