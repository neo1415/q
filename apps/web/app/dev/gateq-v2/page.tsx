import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";

import {
  GATEQ_INBOX_VIEWS,
  type ApplicationSummaryDto,
  type ClaimableCompanyDto,
  type FounderApplicationDto,
  type GateqInboxDetailDto,
  type GateqInboxDto,
  type GateqInboxItemDto,
  type GateqInboxView,
  type GatewayPolicyDto,
  type PublicGatewayDto,
} from "@capital-q/contracts";

import { AppShell } from "@/components/app-shell/app-shell";
import { PageContainer } from "@/components/app-shell/page-container";
import {
  EMPTY_ANSWERS,
  type FormAnswers,
  type FormStep,
} from "@/features/gateq/form/form-model";
import { GateQForm } from "@/features/gateq/form/gateq-form";
import {
  ClaimView,
  FounderApplications,
} from "@/features/gateq/page/founder-views";
import { GateqChrome, type GateqTab } from "@/features/gateq/page/gateq-chrome";
import { CopyLink, InboxView } from "@/features/gateq/page/inbox-view";
import { FindView, GateView } from "@/features/gateq/page/investor-views";
import { qrSvg } from "@/features/q-card/qr";

// Rendered per request: a production build serves it only under CQ_DEV_PREVIEW.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "GateQ (design review)",
  robots: { index: false },
};

/**
 * GateQ F1-F4 in the real shell with fictional data, for design review and
 * the screenshot checks (design 2026-10-06/a/gateq.html). Development only,
 * or a production build started with CQ_DEV_PREVIEW=1. Nothing here reads
 * or writes anything; every name is fictional.
 *
 *   ?view=form|founder|claim|inbox|inbox-detail|find|gate
 *   &state=full|loading|empty|error|limited
 *   &step=company|round|share|note|check|sent   (form)
 *   &sheet=pass|pack|claim   &bulk=1   &solo=1
 */

const GATEWAY: PublicGatewayDto = {
  publicId: "gq_preview0000000000000000000",
  organisationDisplayName: "Sahel Capital",
  title: "Apply to Sahel Capital",
  description:
    "We back early companies making money move better in West Africa.",
  inboundMode: "QUALIFIED",
  acceptingApplications: true,
  criteria: [
    { label: "Pre-seed or seed", requiredness: "REQUIRED", dimension: "STAGE" },
    {
      label: "Fintech, health, or agriculture finance",
      requiredness: "REQUIRED",
      dimension: "TAXONOMY",
    },
    { label: "West Africa", requiredness: "REQUIRED", dimension: "GEOGRAPHY" },
    {
      label: "$500k to $3M",
      requiredness: "REQUIRED",
      dimension: "RAISE_SIZE",
    },
  ],
  publishedAt: "2026-10-05T09:00:00.000Z",
  replyWithinDays: 10,
};

const KORA: FormAnswers = {
  ...EMPTY_ANSWERS,
  companyName: "Kora Health",
  oneLiner: "Gets clinics paid for insurance claims in weeks, not months.",
  stage: "seed",
  sectors: ["Health"],
  country: "NG",
  band: "1m_3m",
  amount: "1,200,000",
  instrument: "SAFE",
  lead: "LOOKING",
  materials: [
    "00000000-0000-4000-8000-0000000000d1",
    "00000000-0000-4000-8000-0000000000d2",
  ],
  contactEmail: "amara@korahealth.ng",
  note: "Hi Sahel team, we help Nigerian clinics get paid by insurers in weeks instead of months. 64 clinics use Kora today and revenue has grown 3x this year. We're raising $1.2M and would value an investor who knows payments in West Africa.",
};

const summary = (
  over: Partial<ApplicationSummaryDto>,
): ApplicationSummaryDto => ({
  reference: "ga_preview",
  status: "IN_PROGRESS",
  declaredName: "Kora Health",
  facts: [],
  documentCount: 0,
  submittedAt: null,
  access: "MAY_APPLY",
  unmet: [],
  stillNeeded: [],
  ...over,
});

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hoursAgo = (now: number, hours: number) =>
  new Date(now - hours * 3_600_000).toISOString();

function inboxFixture(
  now: number,
  view: GateqInboxView,
  options: { solo: boolean; member: boolean },
) {
  const DR = { userId: id(901), name: "Daniel Reyes", initials: "DR" };
  const SK = { userId: id(902), name: "Sara Kamau", initials: "SK" };
  const JO = { userId: id(903), name: "Jide Okafor", initials: "JO" };
  const base = (
    n: number,
    over: Partial<GateqInboxItemDto>,
  ): GateqInboxItemDto => ({
    applicationId: id(n),
    reference: `ga_preview${n}`,
    companyName: "",
    oneLiner: null,
    stage: "Seed",
    sector: "Fintech",
    country: "Nigeria",
    raise: { amount: "2000000", currency: "USD" },
    fit: "FITS",
    rules: { met: 4, total: 4, unknown: 0 },
    starred: false,
    unread: false,
    labels: [],
    assignee: null,
    folder: "INBOX",
    replyBy: null,
    replyState: "ON_TRACK",
    daysLeft: 8,
    submittedAt: hoursAgo(now, 30),
    ...over,
  });
  const items: GateqInboxItemDto[] = [
    base(1, {
      companyName: "Sunline Energy",
      oneLiner: "Pay-as-you-go solar for small shops in Kenya",
      sector: "Energy",
      country: "Kenya",
      starred: true,
      unread: true,
      labels: ["IC next week"],
      assignee: options.solo ? null : DR,
      replyState: "DUE_SOON",
      daysLeft: 2,
      submittedAt: hoursAgo(now, 1),
    }),
    base(2, {
      companyName: "Kora Health",
      oneLiner: "Gets clinics paid for claims in weeks",
      sector: "Health",
      unread: true,
      labels: ["Health"],
      assignee: options.solo ? null : SK,
      daysLeft: 6,
    }),
    base(3, {
      companyName: "Tally Pay",
      oneLiner: "Card payments for corner shops",
      sector: "Payments",
      country: "United Arab Emirates",
      unread: true,
      rules: { met: 3, total: 4, unknown: 0 },
    }),
    base(4, {
      companyName: "Harvest Ledger",
      oneLiner: "Loans repaid at harvest",
      stage: "Pre-seed",
      sector: "Agriculture finance",
      country: "Ghana",
      fit: "PARTIAL",
      rules: { met: 3, total: 4, unknown: 1 },
      labels: ["Asked for more"],
      assignee: options.solo ? null : JO,
      daysLeft: 4,
      submittedAt: hoursAgo(now, 100),
    }),
    base(5, {
      companyName: "Okra Finance",
      oneLiner: "Savings that beat inflation",
      stage: "Pre-seed",
      daysLeft: 9,
      submittedAt: hoursAgo(now, 124),
    }),
    base(6, {
      companyName: "Mosaic",
      oneLiner: "Payroll for remote African teams",
      stage: "Pre-seed",
      sector: "HR software",
      country: "Rwanda",
      fit: "NOT_A_FIT",
      rules: { met: 3, total: 4, unknown: 0 },
      daysLeft: 9,
      submittedAt: hoursAgo(now, 150),
    }),
    base(7, {
      companyName: "Bazaar Box",
      oneLiner: "Wholesale delivered overnight",
      sector: "Commerce",
      starred: true,
      labels: ["Fintech"],
      assignee: options.solo ? null : DR,
      daysLeft: 10,
      submittedAt: hoursAgo(now, 170),
    }),
  ];
  const inView = items.filter((item) =>
    view === "STARRED"
      ? item.starred
      : view === "FITS"
        ? item.fit === "FITS"
        : view === "PARTIAL"
          ? item.fit === "PARTIAL"
          : view === "NOT_A_FIT"
            ? item.fit === "NOT_A_FIT"
            : view === "INBOX",
  );
  const inbox: GateqInboxDto = {
    gateway: {
      id: id(800),
      name: "Seed gate",
      publicId: "gq_preview0000000000000000000",
      replyWithinDays: 10,
    },
    viewer: { userId: id(901), canDecide: !options.member, solo: options.solo },
    view,
    counts: Object.fromEntries(GATEQ_INBOX_VIEWS.map((v) => [v, 0])) as Record<
      GateqInboxView,
      number
    >,
    items: inView,
    labels: ["IC next week", "Health", "Fintech", "Asked for more"],
    members: options.solo ? [DR] : [DR, SK, JO],
  };
  Object.assign(inbox.counts, {
    INBOX: 3,
    STARRED: 2,
    ASSIGNED_TO_ME: 2,
    FITS: 5,
    PARTIAL: 1,
    NOT_A_FIT: 1,
  });
  const details: Record<string, GateqInboxDetailDto> = Object.fromEntries(
    items.map((item) => [
      item.applicationId,
      {
        item,
        rules: [
          {
            label: "Pre-seed or seed",
            dimension: "STAGE",
            required: true,
            standing: "MEETS",
          },
          {
            label: "Fintech, health, agriculture finance",
            dimension: "TAXONOMY",
            required: true,
            standing: "MEETS",
          },
          {
            label: "Nigeria, Ghana, Kenya",
            dimension: "GEOGRAPHY",
            required: true,
            standing: item.fit === "NOT_A_FIT" ? "DOES_NOT_MEET" : "MEETS",
          },
          {
            label: "$300k to $3M",
            dimension: "RAISE_SIZE",
            required: true,
            standing: item.fit === "PARTIAL" ? "NOT_ANSWERED" : "MEETS",
          },
        ],
        answers: [
          { label: "Stage", value: item.stage ?? "" },
          { label: "Sector", value: item.sector ?? "" },
          { label: "Based in", value: item.country ?? "" },
          { label: "Raising", value: "$2M" },
          { label: "Instrument", value: "SAFE" },
          { label: "Lead investor", value: "Looking for a lead" },
        ],
        note: "We sell solar to 12,000 small shops on daily payments. Revenue is $58k a month and grew 4x in a year. We're closing on 30 October and would love a co-investor who knows SME finance.",
        contact: { name: "Wanjiru Mwangi", email: "wanjiru@sunline.example" },
        shared: [
          { documentId: id(701), title: "Pitch deck, 16 slides" },
          { documentId: id(702), title: "Key numbers, monthly" },
          { documentId: id(703), title: "Bank statements summary" },
        ],
        notes: options.solo
          ? []
          : [
              {
                id: id(601),
                author: SK,
                body: "Met Wanjiru at Africa Fintech Summit, sharp on unit economics. Daniel, worth an IC slot?",
                createdAt: hoursAgo(now, 20),
              },
            ],
        activity: [
          { at: item.submittedAt, text: "Applied through Seed gate" },
          { at: item.submittedAt, text: "Q checked it against your rules" },
          ...(options.solo
            ? []
            : [
                {
                  at: hoursAgo(now, 0.5),
                  text: "Assigned to Daniel Reyes by Sara Kamau",
                },
              ]),
        ],
        messages: [],
      } satisfies GateqInboxDetailDto,
    ]),
  );
  return { inbox, details };
}

const CLAIMABLE: readonly ClaimableCompanyDto[] = [
  {
    companyId: id(501),
    name: "Kora Health Technologies Ltd",
    website: "https://korahealth.ng",
    city: "Lagos",
    country: "NG",
    members: 0,
    yours: false,
    requested: false,
  },
  {
    companyId: id(502),
    name: "Kora Foods",
    website: "https://korafoods.com",
    city: "Accra",
    country: "GH",
    members: 2,
    yours: false,
    requested: false,
  },
];

const APPLICATIONS: readonly FounderApplicationDto[] = [
  {
    applicationId: id(401),
    fund: "Sahel Capital",
    sentAt: "2026-10-03T09:00:00.000Z",
    status: "SENT",
    reasonCode: null,
    message: null,
  },
  {
    applicationId: id(402),
    fund: "Lagoon Angels",
    sentAt: "2026-09-28T09:00:00.000Z",
    status: "REPLIED",
    reasonCode: null,
    message:
      "Thanks Amara. Could you share your last six months of key numbers before we talk?",
  },
  {
    applicationId: id(403),
    fund: "Northbound Capital",
    sentAt: "2026-09-20T09:00:00.000Z",
    status: "REPLIED",
    reasonCode: null,
    message: "We'd love a call. Does Thursday 9 October at 10:00 work?",
  },
  {
    applicationId: id(404),
    fund: "Baobab Fund",
    sentAt: "2026-09-02T09:00:00.000Z",
    status: "PASSED",
    reasonCode: "CHEQUE_DOES_NOT_FIT",
    message:
      "Thank you for applying. Your round is larger than the cheques we write, so we can't take it.",
  },
];

const POLICY: GatewayPolicyDto = {
  gateway: {
    id: id(800),
    publicId: "gq_preview0000000000000000000",
    name: "Seed gate",
    status: "ACTIVE",
    createdAt: "2026-09-01T09:00:00.000Z",
  },
  version: {
    id: id(801),
    versionNumber: 3,
    status: "PUBLISHED",
    inboundMode: "QUALIFIED",
    publicTitle: "Northbound Capital seed gate",
    publicDescription: null,
    publishedAt: "2026-10-01T09:00:00.000Z",
  },
  criteria: [
    {
      id: id(811),
      position: 1,
      requiredness: "REQUIRED",
      label: "Pre-seed or seed",
      config: { type: "STAGE", allowedStageCodes: ["pre_seed", "seed"] },
    },
    {
      id: id(812),
      position: 2,
      requiredness: "REQUIRED",
      label: "Fintech, health, agriculture finance",
      config: {
        type: "TAXONOMY",
        vocabularyCode: "sector",
        allowedNodeIds: [id(821)],
      },
    },
    {
      id: id(813),
      position: 3,
      requiredness: "REQUIRED",
      label: "Nigeria, Ghana, Kenya",
      config: { type: "GEOGRAPHY", allowedCountries: ["NG", "GH", "KE"] },
    },
    {
      id: id(814),
      position: 4,
      requiredness: "REQUIRED",
      label: "$300k to $3M",
      config: {
        type: "RAISE_SIZE",
        currency: "USD",
        minAmount: "300000",
        maxAmount: "3000000",
      },
    },
    {
      id: id(815),
      position: 5,
      requiredness: "REQUIRED",
      label: "Gambling, tobacco, weapons",
      config: {
        type: "EXCLUDED_TAXONOMY",
        vocabularyCode: "sector",
        excludedNodeIds: [id(822)],
      },
    },
  ],
};

/** The review page's clock, read once per request (fixtures are relative to it). */
function reviewClock(): number {
  return Date.now();
}

type State = "full" | "loading" | "empty" | "error" | "limited";

export default async function GateqReviewPage({
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
  const params = await searchParams;
  const get = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const view = get("view") ?? "inbox";
  const stateParam = get("state");
  const state: State =
    stateParam === "loading" ||
    stateParam === "empty" ||
    stateParam === "error" ||
    stateParam === "limited"
      ? stateParam
      : "full";
  const founder = view === "form" || view === "founder" || view === "claim";
  const now = reviewClock();
  const href = (next: string) => (tab: GateqTab) =>
    `/dev/gateq-v2?view=${tab === "applications" ? "founder" : tab}${next}`;

  let body: ReactNode;
  if (view === "form") {
    const stepParam = get("step");
    const step: FormStep =
      stepParam === "round" ||
      stepParam === "share" ||
      stepParam === "note" ||
      stepParam === "check" ||
      stepParam === "sent"
        ? stepParam
        : "company";
    body = (
      <GateQForm
        gateway={GATEWAY}
        inApp
        prefill={{
          companyName: "Kora Health",
          oneLiner: KORA.oneLiner,
          stageCode: "seed",
          country: "NG",
          contactName: null,
          contactEmail: "amara@korahealth.ng",
        }}
        needsCompany={state === "empty"}
        materials={[
          {
            id: KORA.materials[0] ?? "",
            name: "Pitch deck, version 3",
            detail: "Pitch deck · only if you tick it",
          },
          {
            id: KORA.materials[1] ?? "",
            name: "One-page summary",
            detail: "Company profile · only if you tick it",
          },
          {
            id: id(3),
            name: "Key numbers, monthly",
            detail: "Financials · only if you tick it",
          },
          {
            id: id(4),
            name: "Management accounts, last 12 months",
            detail: "Management accounts · only if you tick it",
          },
        ]}
        preview={{
          step: state === "limited" ? "check" : step,
          answers: state === "limited" ? { ...KORA, country: "KE" } : KORA,
          loading: state === "loading",
          problem: state === "error" ? "The connection dropped." : null,
          application:
            state === "limited"
              ? summary({ access: "MAY_NOT_APPLY", unmet: ["West Africa"] })
              : step === "check" || step === "sent" || state === "error"
                ? summary({ access: "MAY_APPLY" })
                : null,
        }}
      />
    );
  } else if (view === "founder" || view === "claim") {
    body = (
      <GateqChrome
        role="FOUNDER"
        active={view === "claim" ? "claim" : "applications"}
        hrefFor={href(`&state=${state}`)}
        maxWidth={view === "claim" ? 760 : 860}
      >
        {view === "claim" ? (
          <ClaimView
            state={state === "limited" ? "full" : state}
            initialQuery="kora health"
            initialResults={
              state === "limited"
                ? CLAIMABLE.map((c, i) => (i === 0 ? { ...c, members: 3 } : c))
                : CLAIMABLE
            }
            demoSheet={get("sheet") === "claim"}
          />
        ) : (
          <FounderApplications
            state={state}
            applications={APPLICATIONS}
            limited={state === "limited"}
          />
        )}
      </GateqChrome>
    );
  } else if (view === "find") {
    body = (
      <GateqChrome
        role="INVESTOR"
        active="find"
        hrefFor={href(`&state=${state}`)}
        maxWidth={900}
        action={<CopyLink text="https://capitalq.app/g/northbound-seed" />}
      >
        <FindView
          state={state === "limited" ? "full" : state}
          limited={state === "limited"}
          initialText="Seed fintech in Nigeria or Ghana with at least $30k monthly revenue, raising under $2M"
          initialResults={
            state === "full" || state === "limited"
              ? [
                  {
                    companyId: id(301),
                    name: "Okra Finance",
                    oneLiner: "Savings that beat inflation",
                    stage: "pre_seed",
                    country: "NG",
                  },
                  {
                    companyId: id(302),
                    name: "Tally Pay",
                    oneLiner: "Card payments for corner shops",
                    stage: "seed",
                    country: "NG",
                  },
                  ...(state === "limited"
                    ? []
                    : [
                        {
                          companyId: id(303),
                          name: "Bazaar Box",
                          oneLiner: "Wholesale delivered overnight, pay later",
                          stage: "seed",
                          country: "NG",
                        },
                      ]),
                ]
              : null
          }
        />
      </GateqChrome>
    );
  } else if (view === "gate") {
    body = (
      <GateqChrome
        role="INVESTOR"
        active="gate"
        hrefFor={href(`&state=${state}`)}
        maxWidth={900}
        unread={3}
        action={<CopyLink text="https://capitalq.app/g/northbound-seed" />}
      >
        <GateView
          state={state === "limited" ? "full" : state}
          gatewayId={id(800)}
          policy={POLICY}
          link="https://capitalq.app/g/gq_preview0000000000000000000"
          snippet={
            '<script src="https://capitalq.app/gateq.js" data-gate="gq_preview0000000000000000000" async></script>'
          }
          qr={qrSvg("https://capitalq.app/g/gq_preview0000000000000000000")}
          replyWithinDays={10}
          canDecide={state !== "limited"}
        />
      </GateqChrome>
    );
  } else {
    const viewParam = (get("chip") ?? "INBOX") as GateqInboxView;
    const solo = get("solo") === "1";
    const fixture = inboxFixture(
      now,
      GATEQ_INBOX_VIEWS.includes(viewParam) ? viewParam : "INBOX",
      { solo, member: state === "limited" },
    );
    const selected = get("sel") ?? fixture.inbox.items[0]?.applicationId;
    const sheet = get("sheet");
    body = (
      <GateqChrome
        role="INVESTOR"
        active="inbox"
        hrefFor={href(`&state=${state}`)}
        unread={3}
        action={<CopyLink text="https://capitalq.app/g/northbound-seed" />}
      >
        <InboxView
          inbox={
            state === "empty" ? { ...fixture.inbox, items: [] } : fixture.inbox
          }
          state={state === "limited" ? "full" : state}
          initialDetail={null}
          gateLink="https://capitalq.app/g/northbound-seed"
          fund="Northbound Capital"
          viewBase="/dev/gateq-v2?view=inbox&chip="
          demo={{
            details: fixture.details,
            checked: get("bulk") === "1" ? [id(1), id(2), id(5)] : [],
            sheet: sheet === "pass" || sheet === "pack" ? sheet : null,
            phoneDetail: view === "inbox-detail",
            ...(selected === undefined ? {} : { selected }),
          }}
        />
      </GateqChrome>
    );
  }

  return (
    <AppShell
      context={{
        scope: founder ? "founder_private" : "investor_private",
        label: founder
          ? "Kora Health (fictional)"
          : "Northbound Capital (fictional)",
      }}
    >
      <PageContainer>{body}</PageContainer>
    </AppShell>
  );
}
