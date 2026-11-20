import type { Metadata } from "next";
import { notFound } from "next/navigation";

import type {
  AdminAccountRowDto,
  AdminAuditRowDto,
  AdminConsoleOverviewDto,
  AdminOrganisationRowDto,
} from "@capital-q/contracts";

import {
  PageContainer,
  PageHeader,
  PageSection,
} from "@/components/app-shell/page-container";
import {
  HeadlineBand,
  HealthPanel,
  NeedsYou,
  RecentActivity,
  SpendPanel,
} from "@/features/admin/console-overview";
import { CONSOLE_GROUPS } from "@/features/admin/console-nav";
import { ConsoleNav } from "@/features/admin/console-ui";
import {
  AdminDataTable,
  AdminDataTableSkeleton,
  type AdminTableColumn,
} from "@/features/admin/data-table";
import { when, words } from "@/features/admin/words";

// Read per request: the preview's gate is the running server's setting.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Operations console (design review)",
  robots: { index: false },
};

/**
 * The operations console with fictional data, for design review and the
 * screenshots in docs/design/console-2026-11-19: the grouped sidebar, the
 * overview (T1) and the list table (T2) in its states. Development only; a
 * production build serves it only with CQ_DEV_PREVIEW=1. Nothing here
 * reads or writes, and it grants nothing: the console's own routes still
 * ask the API, which checks each operator permission.
 *
 * `?page=overview|organisations|accounts|empty|loading` (default overview).
 */

const ID = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const AGO = (hours: number) =>
  new Date(Date.UTC(2026, 10, 19, 12) - hours * 3_600_000).toISOString();

const OVERVIEW: AdminConsoleOverviewDto = {
  activeOrganisations: 412,
  spend: {
    month: "2026-11",
    pricedUsd: "1843.27",
    pricedCalls: 18214,
    unpricedCalls: 37,
  },
  daily: Array.from({ length: 14 }, (_, index) => ({
    day: `2026-11-${String(6 + index).padStart(2, "0")}`,
    pricedUsd:
      [
        "61.2",
        "74.9",
        "58.1",
        "92.4",
        "101.7",
        "66.0",
        "48.3",
        "83.5",
        "120.8",
        "97.2",
        "88.6",
        "0",
        "112.4",
        "79.9",
      ][index] ?? "0",
    calls:
      [610, 744, 580, 905, 1020, 655, 470, 820, 1190, 960, 870, 12, 1100, 790][
        index
      ] ?? 0,
    unpricedCalls: index === 11 ? 12 : index === 8 ? 25 : 0,
  })),
  outbox: { pending: 3, oldestPendingSeconds: 42 },
  apiVersion: "862090033",
  workers: null,
};

const RECENT: readonly AdminAuditRowDto[] = [
  [
    "Ines Duarte (fictional)",
    "verification.decide",
    "organisation",
    ID(41),
    0.5,
  ],
  ["Jonah Pryce (fictional)", "account.suspend", "user_profile", ID(42), 3],
  ["Ines Duarte (fictional)", "flags.set", "feature_flag", "q.voice", 7],
  [
    "Mira Castell (fictional)",
    "billing.plan.assign",
    "organisation",
    ID(43),
    26,
  ],
].map(([actor, action, type, id, hours]) => ({
  source: "PLATFORM",
  at: AGO(Number(hours)),
  actorType: "platform_admin",
  actorName: String(actor),
  actorRole: "operator",
  authorityName: String(actor),
  actionType: String(action),
  resourceType: String(type),
  resourceId: String(id),
  outcome: "SUCCEEDED",
  reason: null,
  breakGlass: false,
  metadata: {},
}));

const NAMES = new Map([
  [`organisation:${ID(41)}`, "LedgerBridge (fictional)"],
  [`person:${ID(42)}`, "Sam Achebe (fictional)"],
  [`organisation:${ID(43)}`, "Harbourline Capital (fictional)"],
]);

const ORGANISATIONS: readonly AdminOrganisationRowDto[] = [
  ["Harbourline Capital", "investment_firm", "GB", 6, 2],
  ["LedgerBridge", "company", "NG", 4, 9],
  ["Kora Health", "company", "NG", 3, 30],
  ["Lagoon Angels", "syndicate", "KE", 12, 54],
  ["Northbound Capital", "investment_firm", "US", 9, 80],
  ["Tidewater Labs", "company", null, 1, 140],
].map(([name, type, country, members, hours], index) => ({
  organisationId: ID(100 + index),
  name: `${String(name)} (fictional)`,
  type: String(type),
  country: country === null ? null : String(country),
  members: Number(members),
  createdAt: AGO(Number(hours)),
}));

const ACCOUNTS: readonly AdminAccountRowDto[] = [
  ["Amara Okafor", "amara@korahealth.example", ["Kora Health"], false, 1],
  [
    "Daniel Reyes",
    "daniel@northbound.example",
    ["Northbound Capital", "Lagoon Angels"],
    false,
    5,
  ],
  ["Sam Achebe", "sam@harbourline.example", ["Harbourline Capital"], true, 20],
  [
    "Priya Natarajan",
    "priya@harbourline.example",
    ["Harbourline Capital"],
    false,
    44,
  ],
  ["Unnamed", "new.person@gmail.example", [], false, 60],
].map(([name, email, orgs, suspended, hours], index) => ({
  userId: ID(200 + index),
  name: name === "Unnamed" ? null : `${String(name)} (fictional)`,
  email: String(email),
  createdAt: AGO(Number(hours)),
  suspended: Boolean(suspended),
  organisations: (orgs as string[]).map((org) => `${org} (fictional)`),
}));

const ORG_COLUMNS: readonly AdminTableColumn<AdminOrganisationRowDto>[] = [
  {
    id: "name",
    label: "Name",
    sort: { asc: "name_asc", desc: "name_desc" },
    cell: (row) => row.name,
  },
  { id: "type", label: "Type", cell: (row) => words(row.type) },
  { id: "country", label: "Country", cell: (row) => row.country ?? "—" },
  {
    id: "members",
    label: "Active members",
    numeric: true,
    cell: (row) => String(row.members),
  },
  {
    id: "created",
    label: "Created",
    sort: { asc: "oldest", desc: "newest" },
    cell: (row) => when(row.createdAt),
  },
];

const ACCOUNT_COLUMNS: readonly AdminTableColumn<AdminAccountRowDto>[] = [
  {
    id: "name",
    label: "Name",
    sort: { asc: "name_asc", desc: "name_desc" },
    cell: (row) => row.name ?? "Unnamed member",
  },
  { id: "email", label: "Email", cell: (row) => row.email ?? "—" },
  {
    id: "organisations",
    label: "Organisations",
    cell: (row) =>
      row.organisations.length === 0 ? "—" : row.organisations.join(", "),
  },
  {
    id: "status",
    label: "Status",
    cell: (row) => (row.suspended ? "Suspended" : "Active"),
  },
  {
    id: "joined",
    label: "Joined",
    sort: { asc: "oldest", desc: "newest" },
    cell: (row) => when(row.createdAt),
  },
];

export default async function ConsoleReviewPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (
    process.env.NODE_ENV === "production" &&
    process.env["CQ_DEV_PREVIEW"] !== "1"
  ) {
    notFound();
  }
  const page = (await searchParams)["page"];
  const permissions = [
    ...new Set(
      CONSOLE_GROUPS.flatMap((group) =>
        group.sections.flatMap((section) =>
          typeof section.permission === "string"
            ? [section.permission]
            : section.permission,
        ),
      ),
    ),
  ];
  return (
    <PageContainer>
      <PageHeader
        title="Admin"
        description="Platform owner (fictional review data)"
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10">
        <div className="lg:sticky lg:top-4 lg:self-start">
          <ConsoleNav permissions={permissions} counts={{ people: 1906 }} />
        </div>
        <div className="flex min-w-0 flex-col gap-8">
          {page === "organisations" ? (
            <PageSection id="organisations" title="Organisations">
              <AdminDataTable
                title="Organisations"
                noun="organisations"
                basePath="/dev/console-nav"
                csvPath="/admin/organisations.csv"
                columns={ORG_COLUMNS}
                rows={ORGANISATIONS}
                rowKey={(row) => row.organisationId}
                rowHref={(row) => `/admin/organisations/${row.organisationId}`}
                primary={(row) => row.name}
                secondary={(row) =>
                  `${words(row.type)} · ${row.country ?? "Country not stated"} · ${String(row.members)} active members`
                }
                view={{ q: "", sort: "newest" }}
                total={412}
                nextCursor="review-next"
                searchLabel="Search organisations"
                placeholder="Name, legal name or handle"
              />
            </PageSection>
          ) : page === "accounts" ? (
            <PageSection id="accounts" title="Accounts">
              <AdminDataTable
                title="Accounts"
                noun="accounts"
                basePath="/dev/console-nav"
                csvPath="/admin/accounts.csv"
                columns={ACCOUNT_COLUMNS}
                rows={ACCOUNTS}
                rowKey={(row) => row.userId}
                rowHref={(row) => `/admin/accounts/${row.userId}`}
                primary={(row) =>
                  `${row.name ?? "Unnamed member"}${row.suspended ? " · Suspended" : ""}`
                }
                secondary={(row) =>
                  `${row.email ?? ""} · joined ${when(row.createdAt)}`
                }
                view={{ q: "", sort: "name_asc" }}
                total={1906}
                nextCursor="review-next"
                searchLabel="Search accounts"
                placeholder="Name, email or handle"
              />
            </PageSection>
          ) : page === "empty" ? (
            <PageSection id="organisations" title="Organisations">
              <AdminDataTable
                title="Organisations"
                noun="organisations"
                basePath="/dev/console-nav"
                csvPath="/admin/organisations.csv"
                columns={ORG_COLUMNS}
                rows={[]}
                rowKey={(row) => row.organisationId}
                rowHref={(row) => `/admin/organisations/${row.organisationId}`}
                primary={(row) => row.name}
                secondary={(row) => row.type}
                view={{ q: "zebra", sort: "newest" }}
                total={0}
                nextCursor={null}
                searchLabel="Search organisations"
                placeholder="Name, legal name or handle"
              />
            </PageSection>
          ) : page === "loading" ? (
            <PageSection id="organisations" title="Organisations">
              <AdminDataTableSkeleton />
            </PageSection>
          ) : (
            <div className="flex flex-col gap-4" data-console-overview>
              <HeadlineBand
                figures={[
                  {
                    term: "Active organisations",
                    value: "412",
                    href: "/admin/organisations",
                  },
                  { term: "People", value: "1,906", href: "/admin/accounts" },
                  {
                    term: "Waiting on operators",
                    value: "14",
                    href: "/admin/queue",
                  },
                  {
                    term: "Model spend this month",
                    value: "$1,843.27",
                    note: "37 calls had no price",
                  },
                  {
                    term: "Emails, 30 days",
                    value: "2,318 sent",
                    note: "6 failed",
                    href: "/admin/email",
                  },
                  {
                    term: "Q failures, 24 hours",
                    value: "3",
                    href: "/admin/q",
                  },
                ]}
              />
              <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                <div className="flex min-w-0 flex-col gap-4">
                  <NeedsYou
                    queues={[
                      {
                        term: "Verification waiting",
                        value: 9,
                        href: "/admin/queue?tab=verification",
                      },
                      {
                        term: "Reports to review",
                        value: 3,
                        href: "/admin/safety",
                      },
                      {
                        term: "Reviews to answer",
                        value: 2,
                        href: "/admin/queue?tab=reviews",
                      },
                      {
                        term: "Break-glass to decide",
                        value: 0,
                        href: "/admin/safety#break-glass",
                      },
                    ]}
                  />
                  <SpendPanel overview={OVERVIEW} />
                </div>
                <div className="flex min-w-0 flex-col gap-4">
                  <HealthPanel
                    services={[
                      {
                        service: "API",
                        state: "READY",
                        database: "OK",
                        millis: 41,
                      },
                      {
                        service: "Q API",
                        state: "READY",
                        database: "OK",
                        millis: 63,
                      },
                    ]}
                    outbox={OVERVIEW.outbox}
                    qApiPool={{
                      slots: 10,
                      held: 3,
                      waiting: 0,
                      oldestHeldMs: 400,
                      recycles: 1,
                      lastRecycledAt: "2026-11-19T09:12:00.000Z",
                    }}
                    workers={{
                      beatAt: "2026-11-19T11:59:48.000Z",
                      pool: {
                        slots: 5,
                        held: 1,
                        waiting: 0,
                        oldestHeldMs: 90,
                        recycles: 0,
                        lastRecycledAt: null,
                      },
                      ungatedMaxConnections: null,
                      checkedAt: "2026-11-19T11:59:48.000Z",
                      findings: [],
                    }}
                    now={Date.UTC(2026, 10, 19, 12)}
                    versions={[
                      { service: "API", sha: "862090033" },
                      { service: "Web", sha: "862090033" },
                    ]}
                  />
                  <RecentActivity rows={RECENT} names={NAMES} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
