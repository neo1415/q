import type {
  BillingAccountPlanDto,
  BillingCatalogueDto,
  CompanyDto,
  HumanReviewDto,
  InvestorOrganisationDto,
  InvitationPreviewDto,
  KybDto,
  MyEtiquetteGuideDto,
  MyOrganisationDto,
  PendingClaimDto,
  PersonProfileDto,
  ProfileFinding,
  ProfileImagesDto,
  QCardDto,
  QDailyPreferences,
  QMemoryItemDto,
  QPreferenceLearningDto,
  QUsageDto,
  QWorkDto,
  TeamDto,
  TeamMemberDto,
  ThesisReadingDto,
} from "@capital-q/contracts";

import type { FounderBackgroundValues } from "@/features/profile/founder-background";
import type { AnswersState } from "@/features/profile/profile-data";

/**
 * Fictional fixtures for the account pages' design review
 * (/dev/account-review). Every name, address and figure is invented: the
 * founder side is Kestrel Grid (Tobi Arden), the investor side Harbourline
 * Capital (Mira Castell). Each is typed against the real contract, so a
 * contract change breaks this file rather than the screenshots.
 */

export const fid = (prefix: string, n: number) =>
  `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const DAY = 86_400_000;
const iso = (at: number) => new Date(at).toISOString();

export const KESTREL = {
  id: fid("c", 1),
  name: "Kestrel Grid",
  founder: "Tobi Arden",
  founderId: fid("e", 1),
  email: "tobi@kestrelgrid.example",
} as const;

export const HARBOURLINE = {
  id: fid("b", 1),
  name: "Harbourline Capital",
  partner: "Mira Castell",
  partnerId: fid("e", 2),
  email: "mira@harbourline.example",
} as const;

export type Side = "founder" | "investor";

/** A plain, flat image as a data URL, so nothing is fetched. */
function swatch(label: string, fill: string, w: number, h: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${fill}"/><text x="50%" y="54%" font-family="Helvetica,Arial,sans-serif" font-size="${Math.round(h / 3)}" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// ── Profile ────────────────────────────────────────────────────────────

export function person(side: Side, now: number): PersonProfileDto {
  return side === "founder"
    ? {
        userId: KESTREL.founderId,
        displayName: KESTREL.founder,
        headline: "Co-founder and CEO, Kestrel Grid",
        version: 4,
        updatedAt: iso(now - 6 * DAY),
      }
    : {
        userId: HARBOURLINE.partnerId,
        displayName: HARBOURLINE.partner,
        headline: "Partner, Harbourline Capital",
        version: 3,
        updatedAt: iso(now - 9 * DAY),
      };
}

export function company(now: number): CompanyDto {
  return {
    id: KESTREL.id,
    canonicalName: KESTREL.name,
    legalName: "Kestrel Grid Ltd",
    slug: "kestrel-grid",
    websiteUrl: "https://kestrelgrid.example",
    foundedDate: "2023-03-01",
    headquartersCountry: "KE",
    headquartersCity: "Nairobi",
    currentStageCode: "seed",
    primaryDescription:
      "Kestrel Grid runs metered solar mini-grids for small factories and pays back the hardware from the power they buy.",
    shortDescription: "Pay-as-you-go solar power for small factories.",
    companyStatus: "active",
    marketplaceVisibility: "network_visible",
    marketplaceReadinessState: "not_assessed",
    pitch: null,
    version: 7,
    createdAt: iso(now - 220 * DAY),
    updatedAt: iso(now - 3 * DAY),
  };
}

export function investor(now: number): InvestorOrganisationDto {
  return {
    id: HARBOURLINE.id,
    investorType: "VC",
    displayName: HARBOURLINE.name,
    websiteUrl: "https://harbourline.example",
    hqCountry: "GB",
    publicDescription:
      "Seed and Series A investor in climate and logistics software across Africa and Europe.",
    deploymentState: "ACTIVELY_INVESTING",
    inboundPreference: null,
    verificationState: "unverified",
    visibility: "network_visible",
    version: 5,
    createdAt: iso(now - 300 * DAY),
    updatedAt: iso(now - 12 * DAY),
  };
}

export function personImages(side: Side, now: number): ProfileImagesDto {
  const id = side === "founder" ? KESTREL.founderId : HARBOURLINE.partnerId;
  return {
    subjectType: "PERSON",
    subjectId: id,
    avatar: {
      kind: "AVATAR",
      url: swatch(side === "founder" ? "TA" : "MC", "#4a5664", 512, 512),
      width: 512,
      height: 512,
      updatedAt: iso(now - 20 * DAY),
    },
    cover: null,
  };
}

export function orgImages(side: Side, now: number): ProfileImagesDto {
  const founder = side === "founder";
  return {
    subjectType: founder ? "COMPANY" : "INVESTOR_ORGANISATION",
    subjectId: founder ? KESTREL.id : HARBOURLINE.id,
    avatar: {
      kind: "AVATAR",
      url: swatch(founder ? "K" : "H", "#5e5240", 512, 512),
      width: 512,
      height: 512,
      updatedAt: iso(now - 40 * DAY),
    },
    cover: {
      kind: "COVER",
      url: swatch("", "#36443b", 1584, 396),
      width: 1584,
      height: 396,
      updatedAt: iso(now - 40 * DAY),
    },
  };
}

const SECTOR_CLIMATE = fid("d", 1);
const SECTOR_LOGISTICS = fid("d", 2);

/** Setup answers as the profile reads them: completed, so editable in place. */
export function answers(side: Side): AnswersState {
  if (side === "founder") {
    return {
      status: "READ",
      completed: true,
      labels: { [SECTOR_CLIMATE]: "Climate and energy" },
      responses: {
        "F1.categories": {
          type: "RESOURCE_REFERENCE",
          resourceType: "TAXONOMY_NODE",
          resourceIds: [SECTOR_CLIMATE],
        },
        "F4.founder_role": { type: "TEXT", text: "CEO" },
      },
      groups: [
        {
          id: "traction",
          label: "Traction",
          lines: [
            {
              stepKey: "F5.signal",
              title: "Strongest signal",
              value: "Paying customers",
            },
            { stepKey: "F5.pilots", title: "Pilots", value: "3 factories" },
            {
              stepKey: "F5.revenue_status",
              title: "Revenue",
              value: "Recurring revenue",
            },
            {
              stepKey: "F5.customers",
              title: "Customers",
              value: "14 small factories in Nairobi and Thika",
            },
            {
              stepKey: "F5.growth",
              title: "Growth",
              value: "Revenue up 9% month on month since March",
            },
          ],
        },
        {
          id: "raise",
          label: "Raise",
          lines: [
            {
              stepKey: "F6.target_amount",
              title: "Target",
              value: "USD 1,200,000",
            },
            { stepKey: "F6.instrument", title: "Instrument", value: "SAFE" },
            {
              stepKey: "F6.timeframe",
              title: "Timeframe",
              value: "Next 3 months",
            },
            {
              stepKey: "F6.use_of_funds",
              title: "Use of funds",
              value: "Twenty more sites and a field team in Mombasa",
            },
          ],
        },
      ],
    };
  }
  return {
    status: "READ",
    completed: true,
    labels: {
      [SECTOR_CLIMATE]: "Climate and energy",
      [SECTOR_LOGISTICS]: "Logistics",
    },
    responses: {
      "I0.business_title": { type: "TEXT", text: "Partner" },
      "I2.stages": { type: "MULTI_SELECT", optionKeys: ["seed", "series_a"] },
      "I2.currency": { type: "SINGLE_SELECT", optionKey: "usd" },
      "I2.cheque_min": { type: "RANGE", value: "250000" },
      "I2.cheque_typical": { type: "RANGE", value: "750000" },
      "I2.cheque_max": { type: "RANGE", value: "2000000" },
      "I3.sectors": {
        type: "RESOURCE_REFERENCE",
        resourceType: "TAXONOMY_NODE",
        resourceIds: [SECTOR_CLIMATE, SECTOR_LOGISTICS],
      },
      "I7.hard_exclusions": {
        type: "TEXT",
        text: "No crypto tokens, no defence.",
      },
      "I11.additional_context": {
        type: "TEXT",
        text: "Software that makes physical infrastructure in emerging markets cheaper to run.",
      },
    },
    groups: [
      {
        id: "role",
        label: "Your role",
        lines: [
          {
            stepKey: "I0.business_title",
            title: "Your title",
            value: "Partner",
          },
        ],
      },
      {
        id: "mandate",
        label: "Investment mandate",
        lines: [
          {
            stepKey: "I2.stages",
            title: "Stages",
            value: null,
            items: ["Seed", "Series A"],
          },
          {
            stepKey: "I2.investment_role",
            title: "Your role in a round",
            value: null,
          },
        ],
      },
      {
        id: "cheque",
        label: "Cheque size",
        lines: [
          { stepKey: "I2.cheque_min", title: "Smallest", value: "USD 250,000" },
          {
            stepKey: "I2.cheque_typical",
            title: "Typical",
            value: "USD 750,000",
          },
          {
            stepKey: "I2.cheque_max",
            title: "Largest",
            value: "USD 2,000,000",
          },
        ],
      },
      {
        id: "focus",
        label: "Investment focus",
        lines: [
          {
            stepKey: "I3.sectors",
            title: "Sectors",
            value: null,
            items: ["Climate and energy", "Logistics"],
          },
          {
            stepKey: "I3.geography",
            title: "Geography",
            value: "East Africa, West Africa, UK",
          },
        ],
      },
      {
        id: "exclusions",
        label: "Exclusions",
        lines: [
          {
            stepKey: "I7.hard_exclusions",
            title: "Never",
            value: "No crypto tokens, no defence.",
          },
        ],
      },
      {
        id: "thesis",
        label: "In your words",
        lines: [
          {
            stepKey: "I11.additional_context",
            title: "In your words",
            value:
              "Software that makes physical infrastructure in emerging markets cheaper to run.",
          },
        ],
      },
    ],
  };
}

export function findings(side: Side, now: number): readonly ProfileFinding[] {
  const founder = side === "founder";
  return [
    {
      id: fid("f", 1),
      key: founder ? "presence.self_description" : "presence.what_they_do",
      statement: founder
        ? "Solar mini-grids for small manufacturers, paid for by the kilowatt-hour."
        : "Backs seed-stage climate and logistics software founders in Africa and Europe.",
      truthClass: "Q_INFERENCE",
      evidenceStatus: "SELF_REPORTED",
      lifecycleStatus: "CURRENT",
      recordedAt: iso(now - 2 * DAY),
      sources: [
        {
          title: founder ? "Kestrel Grid: About" : "Harbourline Capital",
          url: founder
            ? "https://kestrelgrid.example/about"
            : "https://harbourline.example",
          retrievedAt: iso(now - 2 * DAY),
        },
      ],
    },
    {
      id: fid("f", 2),
      key: "presence.milestone",
      statement: founder
        ? "Announced its fourteenth factory site, in Thika, in September."
        : "Announced a second fund in its September newsletter.",
      truthClass: "Q_INFERENCE",
      evidenceStatus: "SELF_REPORTED",
      lifecycleStatus: "CURRENT",
      recordedAt: iso(now - 5 * DAY),
      sources: [
        {
          title: founder ? "Kestrel Grid news" : "Harbourline newsletter",
          url: founder
            ? "https://kestrelgrid.example/news"
            : "https://harbourline.example/news",
          retrievedAt: iso(now - 5 * DAY),
        },
      ],
    },
  ];
}

export function personFindings(now: number): readonly ProfileFinding[] {
  return [
    {
      id: fid("f", 3),
      key: "presence.self_description",
      statement:
        "Engineer turned operator; built grid software before Kestrel.",
      truthClass: "Q_INFERENCE",
      evidenceStatus: "SELF_REPORTED",
      lifecycleStatus: "CURRENT",
      recordedAt: iso(now - 4 * DAY),
      sources: [
        {
          title: "Conference speaker page",
          url: "https://events.example/speakers/arden",
          retrievedAt: iso(now - 4 * DAY),
        },
      ],
    },
  ];
}

export function thesis(now: number): ThesisReadingDto {
  return {
    mandateId: fid("a", 9),
    mandateVersion: 3,
    declared: [
      { label: "Stages", value: "Seed, Series A" },
      { label: "Sectors", value: "Climate and energy, Logistics" },
      { label: "Countries", value: "Kenya, Nigeria, Ghana, United Kingdom" },
    ],
    observed: {
      saved: 11,
      passed: 23,
      counts: [
        {
          decision: "SAVED",
          dimension: "COUNTRY",
          value: "RW",
          label: "Rwanda",
          count: 4,
        },
        {
          decision: "PASSED",
          dimension: "STAGE",
          value: "series_a",
          label: "Series A",
          count: 9,
        },
      ],
    },
    inferred: [
      "You save Rwandan companies often, though Rwanda isn't in your mandate.",
      "You pass on most Series A companies you open.",
    ],
    suggestions: [
      {
        id: "ADD_COUNTRY:RW",
        kind: "ADD_COUNTRY",
        value: "RW",
        title: "Add Rwanda to your countries",
        because: "You saved 4 Rwandan companies in the last 30 days.",
        effect: "Discover would include companies based in Rwanda.",
        truthClass: "Q_INFERENCE",
      },
    ],
    computedAt: iso(now - 1 * DAY),
  };
}

export function founderBackground(): FounderBackgroundValues {
  return {
    businessTitle: "Co-founder and CEO",
    previousRoles:
      "Grid planning engineer, six years; led a utility's metering rollout.",
    education: "BSc Electrical Engineering",
    version: 2,
  };
}

export function qCard(side: Side, now: number): QCardDto {
  const founder = side === "founder";
  return {
    subjectType: founder ? "COMPANY" : "INVESTOR_ORGANISATION",
    subjectId: founder ? KESTREL.id : HARBOURLINE.id,
    handle: founder ? "kestrel-grid" : "harbourline",
    publicCode: founder ? "k7g2m4p9xq" : "h3l8c5v1nb",
    fieldScopes: founder
      ? {
          shortDescription: "public_external",
          currentStageCode: "network_visible",
          headquartersCity: "public_external",
          websiteUrl: "public_external",
        }
      : {
          publicDescription: "public_external",
          hqCountry: "public_external",
          websiteUrl: "public_external",
        },
    indexable: false,
    scansLast30Days: 17,
    version: 2,
    updatedAt: iso(now - 8 * DAY),
  };
}

export function kyb(
  side: Side,
  state:
    "none" | "org-verified" | "sent" | "verified" | "optional" | "declined",
  now: number,
): KybDto {
  const founder = side === "founder";
  const organisationName = founder ? KESTREL.name : HARBOURLINE.name;
  const organisationKind = founder ? "COMPANY" : "INVESTOR";
  const verifiedOrg =
    state === "org-verified" || state === "verified" || state === "optional";
  return {
    standing: verifiedOrg
      ? "VERIFIED"
      : state === "sent"
        ? "PENDING"
        : state === "declined"
          ? "REVOKED"
          : "NOT_REQUESTED",
    submission:
      state === "sent" || state === "declined"
        ? {
            submissionId: fid("9", 1),
            source: "PERSON",
            legalName: founder ? "Kestrel Grid Ltd" : "Harbourline Capital LLP",
            registrationNumber: founder ? "PVT-7Q2KX9" : "OC401234",
            jurisdictionCode: founder ? "KE" : "GB",
            registeredAddress: null,
            websiteUrl: null,
            hasDocument: true,
            status: state === "declined" ? "REJECTED" : "SUBMITTED",
            decisionReason:
              state === "declined"
                ? "The registration number doesn't match the registry's record for this name."
                : null,
            submittedAt: iso(now - 2 * DAY),
            decidedAt: state === "declined" ? iso(now - 1 * DAY) : null,
          }
        : null,
    organisationName,
    organisationKind,
    person: {
      standing:
        state === "verified"
          ? "VERIFIED"
          : state === "sent"
            ? "PENDING"
            : "NOT_REQUESTED",
      declineReason: null,
      affiliation:
        state === "optional" ? "CONFIRMED_BY_ORGANISATION" : "NOT_CONFIRMED",
      submission:
        state === "sent"
          ? {
              submissionId: fid("9", 2),
              nameOnId: founder ? KESTREL.founder : HARBOURLINE.partner,
              role: founder ? "Co-founder and CEO" : "Partner",
              hasDocument: false,
              status: "SUBMITTED",
              decisionReason: null,
              submittedAt: iso(now - 2 * DAY),
            }
          : null,
    },
  };
}

export const KYB_TYPED = {
  person: { nameOnId: "Tobi Arden", role: "Co-founder and CEO" },
  organisation: {
    legalName: "Kestrel Grid Ltd",
    registrationNumber: "PVT-7Q2KX9",
    jurisdictionCode: "KE",
    registeredAddress: "Mombasa Road, Nairobi",
    websiteUrl: "https://kestrelgrid.example",
  },
} as const;

// ── Team ───────────────────────────────────────────────────────────────

type Row = readonly [
  name: string,
  email: string,
  role: "OWNER" | "ADMIN" | "MEMBER",
  title: string,
];

const COMPANY_PEOPLE: readonly Row[] = [
  [KESTREL.founder, KESTREL.email, "OWNER", "Co-founder and CEO"],
  [
    "Wanjiru Kamau",
    "wanjiru@kestrelgrid.example",
    "ADMIN",
    "Co-founder and CTO",
  ],
  [
    "Daniel Okello",
    "daniel@kestrelgrid.example",
    "MEMBER",
    "Head of field operations",
  ],
  ["Leah Moraa", "leah@kestrelgrid.example", "MEMBER", "Finance"],
];
const FIRM_PEOPLE: readonly Row[] = [
  [HARBOURLINE.partner, HARBOURLINE.email, "OWNER", "Partner"],
  ["Jonah Pryce", "jonah@harbourline.example", "ADMIN", "Partner"],
  ["Ines Duarte", "ines@harbourline.example", "MEMBER", "Principal"],
  ["Sam Achebe", "sam@harbourline.example", "MEMBER", "Analyst"],
  ["Priya Natarajan", "priya@harbourline.example", "MEMBER", "Platform"],
];

export const TEAM_ROLE_FOR = fid("7", 2);

export function team(
  side: Side,
  state: "full" | "solo" | "member",
  now: number,
): TeamDto {
  const founder = side === "founder";
  const rows =
    state === "solo"
      ? (founder ? COMPANY_PEOPLE : FIRM_PEOPLE).slice(0, 1)
      : founder
        ? COMPANY_PEOPLE
        : FIRM_PEOPLE;
  const me = state === "member" ? 2 : 0;
  const members: TeamMemberDto[] = rows.map(
    ([name, email, role, title], at) => ({
      membershipId: fid("7", at + 1),
      userId: fid("6", at + 1),
      name,
      email,
      title,
      role,
      isYou: at === me,
      joinedAt: iso(now - (200 - at * 30) * DAY),
      avatarUrl: null,
    }),
  );
  const myRole = rows[me]?.[2] ?? "OWNER";
  const admin = myRole !== "MEMBER";
  return {
    organisation: {
      organisationId: founder ? KESTREL.id : HARBOURLINE.id,
      name: founder ? KESTREL.name : HARBOURLINE.name,
      kind: founder ? "COMPANY" : "FIRM",
      organisationType: founder ? "company" : "investment_firm",
    },
    you: {
      membershipId: fid("7", me + 1),
      role: myRole,
      can: {
        invite: admin,
        changeRoles: admin,
        removeMembers: admin,
        own: myRole === "OWNER",
      },
    },
    ownerCount: 1,
    members,
    invitations:
      admin && state === "full"
        ? [
            {
              invitationId: fid("8", 1),
              email: founder
                ? "achieng@kestrelgrid.example"
                : "oliver@harbourline.example",
              role: "MEMBER",
              state: "PENDING",
              sentAt: iso(now - 2 * DAY),
              sentCount: 1,
              expiresAt: iso(now + 5 * DAY),
              invitedByName: founder ? KESTREL.founder : HARBOURLINE.partner,
            },
            {
              invitationId: fid("8", 2),
              email: founder
                ? "musa@kestrelgrid.example"
                : "ana@harbourline.example",
              role: "ADMIN",
              state: "EXPIRED",
              sentAt: iso(now - 10 * DAY),
              sentCount: 2,
              expiresAt: iso(now - 3 * DAY),
              invitedByName: founder ? KESTREL.founder : HARBOURLINE.partner,
            },
          ]
        : [],
    joinRequests:
      admin && state === "full" && founder
        ? [
            {
              requestId: fid("5", 1),
              name: "Kevin Mutua",
              email: "kevin@kestrelgrid.example",
              message: "I joined the field team in Thika last month.",
              requestedAt: iso(now - 1 * DAY),
            },
          ]
        : [],
    ownershipOffers: [],
  };
}

export function claims(now: number): readonly PendingClaimDto[] {
  return [
    {
      requestId: fid("4", 1),
      companyId: KESTREL.id,
      companyName: KESTREL.name,
      requesterName: "Grace Wambui",
      method: "WORK_EMAIL",
      workEmailDomain: "kestrelgrid.example",
      emailConfirmed: true,
      requestedAt: iso(now - 1 * DAY),
      evidence: null,
    },
  ];
}

// ── Join and Welcome ───────────────────────────────────────────────────

export const INVITE: InvitationPreviewDto = {
  state: "PENDING",
  organisationName: HARBOURLINE.name,
  kind: "FIRM",
  role: "MEMBER",
  email: "oliver@harbourline.example",
  invitedByName: HARBOURLINE.partner,
  memberCount: 5,
  memberInitials: ["MC", "JP", "ID", "SA"],
};

export const JOIN_TOKEN = "devreviewtoken0000000000000000000000";

export function workspaces(count: 2 | 3): readonly MyOrganisationDto[] {
  const all: readonly MyOrganisationDto[] = [
    {
      organisationId: HARBOURLINE.id,
      name: HARBOURLINE.name,
      kind: "FIRM",
      organisationType: "investment_firm",
      role: "ADMIN",
      memberCount: 5,
      active: true,
      companyId: null,
    },
    {
      organisationId: KESTREL.id,
      name: KESTREL.name,
      kind: "COMPANY",
      organisationType: "company",
      role: "MEMBER",
      memberCount: 4,
      active: false,
      companyId: KESTREL.id,
    },
    {
      organisationId: fid("c", 2),
      name: "Tidewater Angels",
      kind: "FIRM",
      organisationType: "investment_firm",
      role: "OWNER",
      memberCount: 1,
      active: false,
      companyId: null,
    },
  ];
  return all.slice(0, count);
}

// ── Settings ───────────────────────────────────────────────────────────

export function plan(
  side: Side,
  source: "LAUNCH_DEFAULT" | "STRIPE",
  now: number,
): BillingAccountPlanDto {
  const founder = side === "founder";
  return {
    account: "ORGANISATION",
    plan: {
      key: founder ? "founder" : "investor",
      version: 1,
      name: founder ? "Founder" : "Investor",
      description: founder
        ? "Q's diagnosis, readiness and rehearsals for your raise."
        : "A Discover feed shaped by your mandate, and Q research.",
      audience: founder ? "FOUNDER" : "INVESTOR",
    },
    source,
    endsAt: null,
    features: [
      {
        key: "q.research",
        name: "Research",
        description: "Q researching a company or a market for you.",
        kind: "MONTHLY",
        unitSingular: "search",
        unitPlural: "searches",
        included: true,
        limit: 100,
        used: 38,
        resetsAt: iso(now + 10 * DAY),
        overridden: false,
      },
      {
        key: "q.rehearsals",
        name: "Pitch rehearsals",
        description: "Practising your pitch with Q.",
        kind: "MONTHLY",
        unitSingular: "rehearsal",
        unitPlural: "rehearsals",
        included: founder,
        limit: founder ? 20 : null,
        used: founder ? 6 : null,
        resetsAt: founder ? iso(now + 10 * DAY) : null,
        overridden: false,
      },
    ],
    canManage: true,
    checkoutAvailable: true,
    hasBillingCustomer: source === "STRIPE",
  };
}

export const CATALOGUE: BillingCatalogueDto = {
  plans: [
    {
      key: "founder",
      version: 1,
      name: "Founder",
      description: "",
      audience: "FOUNDER",
      selfServe: true,
      features: [
        {
          key: "q.research",
          name: "Research",
          kind: "MONTHLY",
          unitPlural: "searches",
          included: true,
          limit: 100,
        },
        {
          key: "q.rehearsals",
          name: "Pitch rehearsals",
          kind: "MONTHLY",
          unitPlural: "rehearsals",
          included: true,
          limit: 20,
        },
        {
          key: "dataroom.share",
          name: "Data room sharing",
          kind: "ACCESS",
          unitPlural: "",
          included: true,
          limit: null,
        },
      ],
    },
    {
      key: "investor",
      version: 1,
      name: "Investor",
      description: "",
      audience: "INVESTOR",
      selfServe: true,
      features: [
        {
          key: "q.research",
          name: "Research",
          kind: "MONTHLY",
          unitPlural: "searches",
          included: true,
          limit: 100,
        },
        {
          key: "q.rehearsals",
          name: "Pitch rehearsals",
          kind: "MONTHLY",
          unitPlural: "rehearsals",
          included: false,
          limit: null,
        },
        {
          key: "team.seats",
          name: "Seats",
          kind: "COUNT",
          unitPlural: "seats",
          included: true,
          limit: 2,
        },
      ],
    },
    {
      key: "fund",
      version: 1,
      name: "Fund",
      description: "",
      audience: "INVESTOR",
      selfServe: false,
      features: [
        {
          key: "q.research",
          name: "Research",
          kind: "MONTHLY",
          unitPlural: "searches",
          included: true,
          limit: null,
        },
        {
          key: "team.seats",
          name: "Seats",
          kind: "COUNT",
          unitPlural: "seats",
          included: true,
          limit: 25,
        },
      ],
    },
  ],
};

export function daily(now: number): QDailyPreferences {
  return {
    frequency: "WEEKLY",
    email: true,
    sections: ["YOUR_SECTOR", "DEALS"],
    nextDueAt: iso(now + 3 * DAY),
  };
}

export function speaking(now: number): MyEtiquetteGuideDto {
  return {
    guide: {
      version: 1,
      sourceKind: "PASTE",
      fileName: null,
      mediaType: null,
      text: "Keep first messages to three sentences. Never promise a meeting time without checking my calendar.",
      savedAt: iso(now - 14 * DAY),
    },
    house: { source: "BUILT_IN", title: "Capital Q house guide", version: "1" },
  };
}

export const LEARNING: QPreferenceLearningDto = {
  status: "GRANTED",
  mayAsk: false,
  askAgainAfter: null,
};

export function workspaceOf(side: Side, solo: boolean): MyOrganisationDto {
  const founder = side === "founder";
  return {
    organisationId: founder ? KESTREL.id : HARBOURLINE.id,
    name: founder ? KESTREL.name : HARBOURLINE.name,
    kind: founder ? "COMPANY" : "FIRM",
    organisationType: founder ? "company" : "investment_firm",
    role: "OWNER",
    memberCount: solo ? 1 : founder ? 4 : 5,
    active: true,
    companyId: founder ? KESTREL.id : null,
  };
}

// ── What Q remembers ───────────────────────────────────────────────────

export function memory(now: number): readonly QMemoryItemDto[] {
  return [
    {
      memoryItemId: fid("3", 1),
      kind: "fact",
      content: "Never introduce me to crypto token companies.",
      quote: "never introduce me to crypto token companies",
      about: "YOU",
      learnedAt: iso(now - 18 * DAY),
      origin: "SAID",
      forgetsAt: null,
    },
    {
      memoryItemId: fid("3", 2),
      kind: "fact",
      content:
        "Harbourline's second fund closes in the first quarter of next year.",
      quote: null,
      about: "COMPANY",
      learnedAt: iso(now - 9 * DAY),
      origin: "SAID",
      forgetsAt: null,
    },
    {
      memoryItemId: fid("3", 3),
      kind: "preference",
      content: "Prefers a written summary before any first call.",
      quote: null,
      about: "YOU",
      learnedAt: iso(now - 6 * DAY),
      origin: "LEARNED",
      forgetsAt: null,
    },
    {
      memoryItemId: fid("3", 4),
      kind: "correction",
      content: "Cheques start at $250k, not $100k.",
      quote: "it's 250 minimum, not 100",
      about: "YOU",
      learnedAt: iso(now - 4 * DAY),
      origin: "CORRECTED",
      forgetsAt: null,
    },
    {
      memoryItemId: fid("3", 5),
      kind: "pronunciation",
      content: "Castell is said cas-TELL.",
      quote: null,
      about: "YOU",
      learnedAt: iso(now - 30 * DAY),
      origin: "SAID",
      forgetsAt: null,
    },
    {
      memoryItemId: fid("3", 6),
      kind: "small_talk",
      content: "Travelling to Nairobi in the second week of November.",
      quote: "I'm in Nairobi the second week of November",
      about: "YOU",
      learnedAt: iso(now - 2 * DAY),
      origin: "SAID",
      forgetsAt: iso(now + 88 * DAY),
    },
  ];
}

export const MEMORY_FORGOTTEN = fid("3", 3);
export const MEMORY_CORRECTING = fid("3", 4);

// ── Usage ──────────────────────────────────────────────────────────────

function monthOf(at: number): string {
  return new Date(at).toISOString().slice(0, 7);
}

export function usage(
  period: "current" | "previous",
  quiet: boolean,
  now: number,
): QUsageDto {
  const at = period === "current" ? now : now - 31 * DAY;
  return {
    month: monthOf(at),
    totalUsd: quiet ? "0" : period === "current" ? "1.420000" : "2.050000",
    calls: quiet ? 0 : 612,
    unpricedCalls: quiet ? 0 : 3,
    failedCalls: quiet ? 0 : 11,
    byTask: quiet
      ? []
      : [
          { purpose: "CONVERSATION", usd: "0.610000", calls: 140 },
          { purpose: "RESEARCH", usd: "0.420000", calls: 38 },
          { purpose: "INSTRUCTION", usd: "0.230000", calls: 61 },
          { purpose: "DOCUMENT", usd: "0.160000", calls: 12 },
        ],
    instructions: quiet
      ? []
      : [
          {
            instructionId: fid("2", 1),
            goal: "Follow up founders who replied to me",
            usd: "0.230000",
            budgetUsdMonth: "5.00",
          },
        ],
    plan: {
      name: "Investor",
      features: plan("investor", "LAUNCH_DEFAULT", now).features,
    },
  };
}

export function work(quiet: boolean, now: number): readonly QWorkDto[] {
  if (quiet) return [];
  return [
    {
      id: fid("2", 1),
      kind: "STANDING_INSTRUCTION",
      status: "ACTIVE",
      summary: null,
      createdAt: iso(now - 12 * DAY),
      expiresAt: iso(now + 48 * DAY),
      lanes: [],
      goal: "Follow up founders who replied to me",
      run: null,
      lastStep: null,
      spend: null,
      delegation: null,
    },
    {
      id: fid("2", 2),
      kind: "INVESTOR_OUTREACH",
      status: "DONE",
      summary: "Introduced you to 3 climate founders; 2 replied.",
      createdAt: iso(now - 8 * DAY),
      expiresAt: iso(now + 22 * DAY),
      lanes: [],
      goal: "Find seed climate founders in Kenya",
      run: null,
      lastStep: null,
      spend: null,
      delegation: null,
    },
  ];
}

// ── Reviews ────────────────────────────────────────────────────────────

export function reviews(now: number): readonly HumanReviewDto[] {
  return [
    {
      reviewId: fid("1", 1),
      subjectType: "READINESS_ASSESSMENT",
      subjectRef: null,
      reason:
        "Q says my traction is unknown, but I uploaded six months of invoices.",
      source: "APP",
      status: "OPEN",
      outcome: null,
      decisionReason: null,
      dueAt: iso(now + 2 * DAY),
      decidedAt: null,
      createdAt: iso(now - 1 * DAY),
    },
    {
      reviewId: fid("1", 2),
      subjectType: "VERIFICATION_DECISION",
      subjectRef: null,
      reason:
        "The registration number was declined but it is the one on our certificate.",
      source: "APP",
      status: "DECIDED",
      outcome: "CHANGED",
      decisionReason:
        "The registry lists the company under its earlier name. We matched the certificate and verified Kestrel Grid.",
      dueAt: iso(now - 9 * DAY),
      decidedAt: iso(now - 10 * DAY),
      createdAt: iso(now - 12 * DAY),
    },
    {
      reviewId: fid("1", 3),
      subjectType: "Q_ASSESSMENT",
      subjectRef: null,
      reason: "The summary says we are pre-revenue; we are not.",
      source: "APP",
      status: "DECIDED",
      outcome: "NEEDS_EVIDENCE",
      decisionReason:
        "Nothing on the profile shows revenue yet. Add a revenue statement to your documents and ask again.",
      dueAt: iso(now - 20 * DAY),
      decidedAt: iso(now - 21 * DAY),
      createdAt: iso(now - 23 * DAY),
    },
  ];
}

export const REVIEW_REASON =
  "The readiness reading says our team is incomplete, but our CTO joined in August.";
