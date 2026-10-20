import type {
  CapitalLedgerDto,
  CapitalObjectiveDto,
  ChatThreadDto,
  DealTermsDto,
  DealViewDto,
  DiligenceDto,
  FitParameterResultDto,
  FitProfileDto,
  InterestDto,
  InvestorMandateDto,
  InvestorResults,
  LedgerCommitmentDto,
  MeetingDto,
  MyCommitmentsDto,
  QUsageDto,
  ReadinessBlueprintDto,
  ReadinessDto,
  RelationshipCommitmentsDto,
  RelationshipNoteList,
  RelationshipStateV2,
  RelationshipStatusDto,
  RelationshipSummaryDto,
  RelationshipPipelineDto,
  RelationshipBrief,
} from "@capital-q/contracts";

import type { InboxRow } from "@/features/relationships/inbox-rows";
import type { PipelineOverview } from "@/features/relationships/relationship-pipeline";
import type { RelationshipDigest } from "@/features/relationships/relationship-data";
import type { CounterpartProfile } from "@/features/relationships/relationship-page-data";
import {
  nextStepFor,
  rowFacts,
  type CommitmentFact,
  type NeedsYouCard,
} from "@/features/relationships/relationships-view";
import { relationshipHref } from "@/features/relationships/relationship-words";
import type { PipelineScores } from "@/features/relationships/pipeline-scores";
import type { RecordWorkRow } from "@/features/relationships/record-workspace";

import { reviewResults } from "../results/fixtures";

/**
 * Fictional data for the CRM design-review page (/dev/crm): the same DTOs
 * the API answers, filled so every chosen CRM screen renders complete and
 * covers every state the prototypes in proto-crm show. Development only.
 * Every company, investor and person here is FICTIONAL (the prototype's
 * own invented names); nothing is read or written.
 */

/** A fixed-shape fictional UUID: one hex prefix per kind, then a number. */
export const fid = (prefix: string, n: number) =>
  `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (at: number) => new Date(at).toISOString();

/** The investor side: Harrow Lane Capital (fictional). */
export const HARROW = {
  id: fid("b", 1),
  name: "Harrow Lane Capital",
} as const;
/** The founder side and the record's company: Tessellate Labs (fictional). */
export const TESSELLATE = {
  id: fid("c", 1),
  name: "Tessellate Labs",
} as const;
export const RECORD_RELATIONSHIP = fid("a", 1);

// ---------------------------------------------------------------------------
// The investor's pipeline: one row in every state (proto-crm x-core.js CO).
// ---------------------------------------------------------------------------

type Row = {
  readonly name: string;
  readonly state: RelationshipStateV2;
  readonly next: RelationshipSummaryDto["nextStep"];
  readonly hours: number;
  readonly about: string;
  readonly suitability: number | null;
  readonly investability: number | null;
};

const ROWS: readonly Row[] = [
  {
    name: TESSELLATE.name,
    state: "IN_DILIGENCE",
    next: "NONE",
    hours: 3,
    about: "Private inference gateway that attests each request",
    suitability: 86,
    investability: 71,
  },
  {
    name: "Northbeam",
    state: "INVESTED",
    next: "NONE",
    hours: 6 * 24 + 4,
    about: "Compliance evidence for AI vendors",
    suitability: 81,
    investability: 64,
  },
  {
    name: "Quillwork",
    state: "CONNECTED",
    next: "SCHEDULE_MEETING",
    hours: 12 * 24,
    about: "Scheduling and payroll for home-care agencies",
    suitability: 78,
    investability: null,
  },
  {
    name: "Saltmarsh Energy",
    state: "CONNECTED",
    next: "SCHEDULE_MEETING",
    hours: 12 * 24 + 2,
    about: "Metering for community battery schemes",
    suitability: 74,
    investability: 58,
  },
  {
    name: "Ferro Health",
    state: "CONNECTED",
    next: "SCHEDULE_MEETING",
    hours: 5 * 24,
    about: "Remote checks for post-surgery recovery",
    suitability: 72,
    investability: null,
  },
  {
    name: "Juniper Ledger",
    state: "CONNECTED",
    next: "SCHEDULE_MEETING",
    hours: 11 * 24,
    about: "Checks every supplier invoice before payment",
    suitability: 69,
    investability: 49,
  },
  {
    name: "Pennant Robotics",
    state: "MEETING_HELD",
    next: "DECIDE_NEXT_STEP",
    hours: 2 * 24,
    about: "Pick-and-place arms for small warehouses",
    suitability: 77,
    investability: 66,
  },
  {
    name: "Lumenfold",
    state: "INTEREST_EXPRESSED",
    next: "AWAIT_ANSWER",
    hours: 12 * 24 + 5,
    about: "Passkeys for hospitals and councils",
    suitability: 83,
    investability: 62,
  },
  {
    name: "Brightkiln",
    state: "INTEREST_EXPRESSED",
    next: "AWAIT_ANSWER",
    hours: 2 * 24 + 6,
    about: "Restocking for neighbourhood shops",
    suitability: 64,
    investability: null,
  },
  {
    name: "Okapi Freight",
    state: "INTEREST_EXPRESSED",
    next: "AWAIT_ANSWER",
    hours: 14 * 24,
    about: "Software for port clearing agents",
    suitability: 71,
    investability: 44,
  },
  {
    name: "Cinderpath",
    state: "PAUSED",
    next: "RESUME",
    hours: 20 * 24,
    about: "Route planning for rural deliveries",
    suitability: 60,
    investability: null,
  },
  {
    name: "Glasswing Health",
    state: "PASSED",
    next: "NONE",
    hours: 25 * 24,
    about: "Triage chat for walk-in clinics",
    suitability: 55,
    investability: 41,
  },
  {
    name: "Tidewell",
    state: "DECLINED",
    next: "NONE",
    hours: 30 * 24,
    about: "Water-quality sensors for fish farms",
    suitability: null,
    investability: null,
  },
  {
    name: "Halden Works",
    state: "INVESTED",
    next: "NONE",
    hours: 140 * 24,
    about: "Maintenance logs for wind turbines",
    suitability: 79,
    investability: 68,
  },
  {
    name: "Ostrava Grid",
    state: "INVESTED",
    next: "NONE",
    hours: 245 * 24,
    about: "Demand response for small factories",
    suitability: 75,
    investability: 63,
  },
  {
    name: "Marrowbone Bio",
    state: "DISCOVERED",
    next: "EXPRESS_INTEREST",
    hours: 26,
    about: "Cell-line quality checks",
    suitability: null,
    investability: null,
  },
];

const companyId = (n: number) => fid("c", n + 1);
const relationshipId = (n: number) => fid("a", n + 1);

export function investorItems(now: number): readonly RelationshipSummaryDto[] {
  return ROWS.map((row, n) => ({
    relationshipId: relationshipId(n),
    counterpart: { kind: "COMPANY", id: companyId(n), name: row.name },
    state: row.state,
    stateSince: iso(now - row.hours * HOUR),
    nextStep: row.next,
  }));
}

const byName = (name: string) => ROWS.findIndex((row) => row.name === name);

export function investorDigests(
  now: number,
): Readonly<Record<string, RelationshipDigest>> {
  const base = (row: Row): RelationshipDigest => ({
    photoUrl: null,
    about: row.about,
    chips: [],
    websiteUrl: null,
    messages: { count: 0, more: false, last: null },
    nextCall: null,
    callsRead: true,
    nextReminder: null,
    followUpDue: false,
    diligence: null,
  });
  const digests: Record<string, RelationshipDigest> = Object.fromEntries(
    ROWS.map((row, n) => [relationshipId(n), base(row)]),
  );
  const set = (name: string, over: Partial<RelationshipDigest>) => {
    const key = relationshipId(byName(name));
    const current = digests[key];
    if (current !== undefined) digests[key] = { ...current, ...over };
  };
  set(TESSELLATE.name, {
    chips: ["Seed", "Security"],
    messages: {
      count: 19,
      more: true,
      last: {
        text: "Ahead of the call: the 40 ms overhead is a median across 31 million requests.",
        mine: false,
        senderName: "Dev Patel",
        sentAt: iso(now - 3 * HOUR),
      },
    },
    nextCall: { startsAt: iso(now + 22 * HOUR) },
    diligence: { openRequests: 2, firstOpenTitle: null, unopenedShares: 1 },
  });
  set("Pennant Robotics", {
    chips: ["Seed", "Robotics"],
    messages: {
      count: 6,
      more: false,
      last: {
        text: "Would you like us to open the data room?",
        mine: true,
        senderName: "You",
        sentAt: iso(now - 26 * HOUR),
      },
    },
  });
  set("Quillwork", {
    messages: {
      count: 3,
      more: false,
      last: {
        text: "Happy to talk next week.",
        mine: false,
        senderName: "Ines Okafor",
        sentAt: iso(now - 30 * HOUR),
      },
    },
  });
  set("Ferro Health", {
    nextReminder: {
      title: "Ask for the pilot results",
      dueAt: iso(now - HOUR),
    },
    followUpDue: true,
  });
  return digests;
}

export function investorUnread(): ReadonlyMap<string, number> {
  return new Map([
    [relationshipId(byName(TESSELLATE.name)), 1],
    [relationshipId(byName("Quillwork")), 2],
  ]);
}

export function investorScores(): Readonly<Record<string, PipelineScores>> {
  return Object.fromEntries(
    ROWS.map((row, n) => [
      companyId(n),
      { suitability: row.suitability, investability: row.investability },
    ]),
  );
}

/** Fit with the mandate for every scored company; unknown stays absent. */
export function investorFits(): Readonly<Record<string, FitProfileDto | null>> {
  return Object.fromEntries(
    ROWS.flatMap((row, n) =>
      row.suitability === null
        ? []
        : [[companyId(n), tessellateFit(companyId(n))]],
    ),
  );
}

export function investorCommitmentFacts(): Readonly<
  Record<string, CommitmentFact>
> {
  return {
    [relationshipId(byName(TESSELLATE.name))]: {
      next: "CONFIRM_AMOUNT",
      amount: "250000",
      currencyCode: "USD",
    },
  };
}

export function investorPipeline(now: number): RelationshipPipelineDto {
  const items = investorItems(now);
  return {
    items: [...items],
    total: items.length,
    totalExact: true,
    scope: "1".repeat(64),
    nextCursor: null,
  };
}

export function investorOverview(now: number): PipelineOverview {
  const items = investorItems(now);
  const counts: Partial<Record<RelationshipStateV2, number>> = {};
  for (const item of items) counts[item.state] = (counts[item.state] ?? 0) + 1;
  // Each row's next step as the List decides it, from the same facts.
  const digests = investorDigests(now);
  const unread = investorUnread();
  const facts = investorCommitmentFacts();
  const steps: Record<string, PipelineOverview["steps"][string]> = {};
  const activity: Record<string, string> = {};
  const about: Record<string, string> = {};
  items.forEach((item, n) => {
    const id = item.relationshipId;
    steps[id] = nextStepFor(
      item,
      rowFacts(digests[id], unread.get(id) ?? 0, facts[id]),
      "INVESTOR",
      now,
      relationshipHref(item),
    );
    activity[id] = iso(now - (ROWS[n]?.hours ?? 0) * HOUR);
    about[id] = ROWS[n]?.about ?? "";
  });
  return { total: items.length, counts, steps, activity, about };
}

// ---------------------------------------------------------------------------
// Overview: Needs you, the period report and the portfolio.
// ---------------------------------------------------------------------------

export function investorNeedsYou(now: number): readonly NeedsYouCard[] {
  const items = investorItems(now);
  const item = (name: string) => items[byName(name)] ?? null;
  const record = (name: string) => `/dev/crm?view=record&about=${name}`;
  return [
    {
      key: "call-brief",
      title: "Prepare for your call tomorrow at 14:00",
      relationship: item(TESSELLATE.name),
      latestAt: iso(now - 20 * 60_000),
      count: 1,
      noticeIds: [],
      reminderId: null,
      action: { label: "Open call brief", href: record("tessellate") },
      step: true,
    },
    {
      key: "pennant-decide",
      title: "You met on Saturday. Decide whether to start diligence.",
      relationship: item("Pennant Robotics"),
      latestAt: iso(now - 2 * DAY),
      count: 1,
      noticeIds: [],
      reminderId: null,
      action: { label: "Decide", href: record("pennant") },
      step: true,
    },
    {
      key: "quillwork-message",
      title: "Sent you a message",
      relationship: item("Quillwork"),
      latestAt: iso(now - 30 * HOUR),
      count: 2,
      noticeIds: [fid("e", 1), fid("e", 2)],
      reminderId: null,
      action: { label: "Reply", href: "/dev/crm?view=messages" },
    },
    {
      key: "ferro-reminder",
      title: "Follow-up reminder is due: ask for the pilot results",
      relationship: item("Ferro Health"),
      latestAt: iso(now - HOUR),
      count: 1,
      noticeIds: [],
      reminderId: fid("e", 3),
      action: { label: "Open", href: record("ferro") },
    },
    {
      key: "juniper-book",
      title: "Accepted 11 days ago. Book a first call.",
      relationship: item("Juniper Ledger"),
      latestAt: iso(now - 11 * DAY),
      count: 1,
      noticeIds: [],
      reminderId: null,
      action: { label: "Book a call", href: "/dev/crm?view=calls" },
      step: true,
    },
  ];
}

/** Each invested company's commitment read; Northbeam has no amount. */
export function portfolioCommitments(
  now: number,
): ReadonlyMap<string, RelationshipCommitmentsDto | undefined> {
  const commitment = (
    n: number,
    amount: string,
    currencyCode: string,
    days: number,
  ): RelationshipCommitmentsDto => ({
    current: {
      id: fid("f", n),
      amount,
      currencyCode,
      level: "INVESTED",
      status: "RECEIVED",
      source: "PERSON",
      quote: null,
      statedByYourSide: true,
      statedAt: iso(now - days * DAY),
      confirmedAt: iso(now - (days - 2) * DAY),
      note: null,
      meetingId: null,
      canConfirm: false,
      canAdopt: false,
      canDispute: false,
      canWithdraw: false,
    },
    history: [],
    detected: [],
    connected: true,
  });
  return new Map([
    [
      relationshipId(byName("Northbeam")),
      { current: null, history: [], detected: [], connected: true },
    ],
    [
      relationshipId(byName("Halden Works")),
      commitment(1, "250000", "GBP", 140),
    ],
    [
      relationshipId(byName("Ostrava Grid")),
      commitment(2, "400000", "EUR", 245),
    ],
  ]);
}

export function investorResults(now: number): {
  readonly results: InvestorResults;
  readonly usage: QUsageDto;
} {
  const base = reviewResults(now, "30d", false);
  const names = [
    TESSELLATE.name,
    "Pennant Robotics",
    "Quillwork",
    "Saltmarsh Energy",
    "Ferro Health",
    "Juniper Ledger",
    "Lumenfold",
    "Northbeam",
  ];
  return {
    usage: base.usage,
    results: {
      ...base.investor,
      organisationName: `${HARROW.name} (fictional)`,
      meetings: {
        held: 6,
        upcoming: [
          { companyName: TESSELLATE.name, startsAt: iso(now + 22 * HOUR) },
        ],
      },
      pipelineFit: base.investor.pipelineFit.map((row, n) => ({
        ...row,
        companyName: names[n] ?? row.companyName,
        companyId: companyId(n),
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Capital, investor: the mandate and the book (proto-crm p-capital.js BOOK).
// ---------------------------------------------------------------------------

const TAX = (n: number) => fid("9", n);

export function harrowMandate(): {
  readonly mandate: InvestorMandateDto;
  readonly labels: ReadonlyMap<string, string>;
} {
  const pref = (
    n: number,
    vocabularyCode: string,
    canonicalCode: string,
    isExclusion = false,
  ) => ({
    nodeId: TAX(n),
    vocabularyCode,
    canonicalCode,
    preferenceStrength: isExclusion
      ? ("HARD_EXCLUSION" as const)
      : ("STRONG" as const),
    isExclusion,
  });
  return {
    mandate: {
      id: fid("d", 1),
      investorOrganisationId: HARROW.id,
      name: "Seed fund II",
      status: "ACTIVE",
      effectiveFrom: null,
      effectiveTo: null,
      discoveryMode: null,
      chequeRange: {
        currency: "USD",
        min: "100000",
        typical: "250000",
        max: "500000",
      },
      minStageCode: "pre_seed",
      maxStageCode: "seed",
      rawMandateText:
        "Software that makes regulated work provable: security, compliance and health operations, from first revenue.",
      constraints: [],
      taxonomyPreferences: [
        pref(1, "industry", "cybersecurity"),
        pref(2, "industry", "regtech"),
        pref(3, "industry", "health_operations"),
        pref(4, "geography", "united_kingdom"),
        pref(5, "geography", "europe"),
        pref(6, "geography", "united_states"),
        pref(7, "business_model", "b2b_saas"),
        pref(8, "industry", "gambling", true),
      ],
      version: 3,
      createdAt: "2026-06-02T09:00:00.000Z",
      updatedAt: "2026-09-14T09:00:00.000Z",
    },
    labels: new Map([
      [TAX(1), "Security"],
      [TAX(2), "Regtech"],
      [TAX(3), "Health operations"],
      [TAX(4), "United Kingdom"],
      [TAX(5), "Europe"],
      [TAX(6), "United States"],
      [TAX(7), "B2B SaaS"],
      [TAX(8), "Gambling"],
    ]),
  };
}

const param = (
  parameter: FitParameterResultDto["parameter"],
  outcome: FitParameterResultDto["outcome"],
  reason: string,
  extra: Partial<FitParameterResultDto> = {},
): FitParameterResultDto => ({
  parameter,
  outcome,
  reason,
  evidenceStatus: outcome === "UNKNOWN" ? null : "SELF_REPORTED",
  stale: false,
  applicable: true,
  ...extra,
});

/** Tessellate Labs' fit with Harrow Lane's declared mandate. */
export function tessellateFit(at = TESSELLATE.id): FitProfileDto {
  const parameters: FitParameterResultDto[] = [
    param("STAGE", "STRONG", "Seed, inside your pre-seed to seed range"),
    param("SECTOR", "STRONG", "Security is in your declared sectors"),
    param("GEOGRAPHY", "STRONG", "United States is in your declared geography"),
    param("CHEQUE_SIZE", "UNKNOWN", "The round isn't formally shared yet", {
      stated: true,
      context: {
        items: [{ label: "Raising", value: "$3M", source: "PITCH" }],
        open: "Ticket fit not scored until the round is formally shared",
      },
    }),
    param("BUSINESS_MODEL", "STRONG", "Annual platform contracts, B2B"),
    param("TRACTION", "PARTIAL", "Revenue stated, no retention figure"),
    param("TEAM", "UNKNOWN", "No preference declared", { applicable: false }),
    param("THESIS", "PARTIAL", "LLM security overlaps part of your thesis"),
    param("ROUND_TERMS", "UNKNOWN", "A SAFE is stated in the pitch", {
      stated: true,
      context: {
        items: [
          { label: "Instrument", value: "Post-money SAFE", source: "PITCH" },
          { label: "Cap", value: "$24m", source: "PITCH" },
        ],
        open: "Lead investor required: not stated",
      },
    }),
  ];
  return {
    companyId: at,
    configVersion: "fit-review",
    configLabel: "v1",
    band: "GOOD_FIT",
    confidence: "MEDIUM",
    parameters,
    topReasons: parameters.slice(0, 3),
    mainMismatch: null,
    hardRule: null,
    computedAt: "2026-10-19T09:00:00.000Z",
  };
}

/** Two companies in touch sit outside the declared sectors (Q noticed). */
export function harrowObservedFit(): readonly FitProfileDto[] {
  const outside = (name: string): FitProfileDto => {
    const fit = tessellateFit(companyId(byName(name)));
    const parameters = fit.parameters.map((p) =>
      p.parameter === "SECTOR"
        ? { ...p, outcome: "MISMATCH" as const, reason: "Outside your sectors" }
        : p,
    );
    return { ...fit, band: "PARTIAL_FIT", parameters };
  };
  return [
    tessellateFit(),
    outside("Saltmarsh Energy"),
    outside("Pennant Robotics"),
  ];
}

const ledgerRow = (
  n: number,
  over: Partial<LedgerCommitmentDto> &
    Pick<
      LedgerCommitmentDto,
      "counterpartName" | "amount" | "currencyCode" | "level" | "status"
    >,
  now: number,
): LedgerCommitmentDto => ({
  id: fid("f", 100 + n),
  relationshipId: fid("a", 100 + n),
  counterpartId: fid("c", 100 + n),
  source: "PERSON",
  quote: null,
  roundId: null,
  statedByYourSide: true,
  transferReference: null,
  at: iso(now - (n + 1) * 2 * DAY),
  next: null,
  ...over,
});

/** The investor's book: a commitment on each step of the ladder. */
export function harrowBook(now: number): MyCommitmentsDto {
  const tessellate = byName(TESSELLATE.name);
  return {
    totals: [
      {
        currencyCode: "USD",
        raised: "0",
        confirmed: "200000",
        pledged: "250000",
      },
      {
        currencyCode: "GBP",
        raised: "250000",
        confirmed: "150000",
        pledged: "0",
      },
      { currencyCode: "EUR", raised: "400000", confirmed: "0", pledged: "0" },
    ],
    commitments: [
      ledgerRow(
        0,
        {
          relationshipId: relationshipId(tessellate),
          counterpartId: companyId(tessellate),
          counterpartName: TESSELLATE.name,
          amount: "250000",
          currencyCode: "USD",
          level: "SOFT",
          status: "STATED",
          quote: "We'd likely come in at around $250k.",
          source: "Q_MEETING",
          next: "CONFIRM_AMOUNT",
        },
        now,
      ),
      ledgerRow(
        1,
        {
          counterpartName: "Wrenfield",
          amount: "150000",
          currencyCode: "GBP",
          level: "FIRM",
          status: "CONFIRMED",
          next: "MARK_SENT",
        },
        now,
      ),
      ledgerRow(
        2,
        {
          counterpartName: "Kittiwake Systems",
          amount: "200000",
          currencyCode: "USD",
          level: "FIRM",
          status: "TRANSFER_SENT",
          transferReference: "HLC-2026-118",
          next: null,
        },
        now,
      ),
      ledgerRow(
        3,
        {
          relationshipId: relationshipId(byName("Halden Works")),
          counterpartId: companyId(byName("Halden Works")),
          counterpartName: "Halden Works",
          amount: "250000",
          currencyCode: "GBP",
          level: "INVESTED",
          status: "RECEIVED",
          at: iso(now - 140 * DAY),
        },
        now,
      ),
      ledgerRow(
        4,
        {
          relationshipId: relationshipId(byName("Ostrava Grid")),
          counterpartId: companyId(byName("Ostrava Grid")),
          counterpartName: "Ostrava Grid",
          amount: "400000",
          currencyCode: "EUR",
          level: "INVESTED",
          status: "RECEIVED",
          at: iso(now - 245 * DAY),
        },
        now,
      ),
    ],
  };
}

// ---------------------------------------------------------------------------
// Raise, founder: Tessellate Labs' seed round (proto-crm p-raise.js).
// ---------------------------------------------------------------------------

const SEED_ROUND = fid("7", 1);
const PRE_SEED_ROUND = fid("7", 2);

export function tessellateLedger(now: number): CapitalLedgerDto {
  const investor = (n: number) => fid("b", 10 + n);
  const row = (
    n: number,
    name: string,
    over: Partial<LedgerCommitmentDto> &
      Pick<LedgerCommitmentDto, "amount" | "level" | "status">,
  ) =>
    ledgerRow(
      10 + n,
      {
        counterpartId: investor(n),
        counterpartName: name,
        currencyCode: "USD",
        roundId: SEED_ROUND,
        statedByYourSide: false,
        ...over,
      },
      now,
    );
  return {
    currentRoundId: SEED_ROUND,
    rounds: [
      {
        id: SEED_ROUND,
        name: "Seed",
        target: { amount: "3000000", currency: "USD" },
        instrument: "SAFE",
        status: "OPEN",
        isCurrent: true,
        openedOn: "2026-09-01",
        firstClosedOn: null,
        closedOn: null,
        cancelledOn: null,
        cancelledReason: null,
        terms: {
          targetCloseOn: "2026-12-15",
          valuation: null,
          valuationCap: "24000000",
          discountPercent: null,
          hardCap: null,
          proRataRights: "MAJOR_INVESTORS",
          lead: null,
          extendsRoundId: null,
          reportedRaised: null,
        },
        closes: [],
        corrections: 1,
        revision: 2,
        createdAt: "2026-08-28T09:00:00.000Z",
        sums: { raised: "100000", confirmed: "900000", pledged: "250000" },
        otherCurrencies: [],
        notices: [],
        steps: ["CLOSE", "TRANCHE", "CANCEL"],
      },
      {
        id: PRE_SEED_ROUND,
        name: "Pre-seed",
        target: { amount: "600000", currency: "USD" },
        instrument: "SAFE",
        status: "CLOSED",
        isCurrent: false,
        openedOn: "2024-11-01",
        firstClosedOn: "2025-02-14",
        closedOn: "2025-03-20",
        cancelledOn: null,
        cancelledReason: null,
        terms: {
          targetCloseOn: null,
          valuation: null,
          valuationCap: "8000000",
          discountPercent: null,
          hardCap: null,
          proRataRights: null,
          lead: { kind: "NAMED", name: "Kestrel Angels" },
          extendsRoundId: null,
          reportedRaised: "600000",
        },
        closes: [
          {
            kind: "FINAL_CLOSE",
            on: "2025-03-20",
            amount: "600000",
            label: null,
          },
        ],
        corrections: 0,
        revision: 1,
        createdAt: "2024-10-20T09:00:00.000Z",
        sums: { raised: "0", confirmed: "0", pledged: "0" },
        otherCurrencies: [],
        notices: [],
        steps: [],
      },
    ],
    totals: [
      {
        currencyCode: "USD",
        raised: "100000",
        confirmed: "900000",
        pledged: "250000",
      },
    ],
    commitments: [
      row(0, "Kestrel Angels", {
        amount: "100000",
        level: "INVESTED",
        status: "RECEIVED",
        at: iso(now - 11 * DAY),
      }),
      row(1, "Oakum Partners", {
        amount: "400000",
        level: "FIRM",
        status: "TRANSFER_SENT",
        transferReference: "OAK-55120",
        next: "CONFIRM_RECEIVED",
        at: iso(now - 2 * DAY),
      }),
      row(2, "Brightwater Ventures", {
        amount: "500000",
        level: "FIRM",
        status: "CONFIRMED",
        at: iso(now - 4 * DAY),
      }),
      row(3, HARROW.name, {
        relationshipId: RECORD_RELATIONSHIP,
        counterpartId: HARROW.id,
        amount: "250000",
        level: "SOFT",
        status: "STATED",
        statedByYourSide: false,
        next: "CONFIRM_AMOUNT",
        at: iso(now - DAY),
      }),
    ],
  };
}

export function tessellateObjective(): CapitalObjectiveDto {
  return {
    id: fid("6", 1),
    companyId: TESSELLATE.id,
    objectiveType: "RAISE",
    status: "ACTIVE",
    target: { amount: "3000000", currency: "USD" },
    targetStage: "seed",
    instrumentCode: "safe",
    targetCloseDate: "2026-12-15",
    useOfFundsSummary:
      "Two enterprise sales leads, SOC 2 Type I and 18 months of runway.",
    valuation: { amount: "24000000", kind: "POST_MONEY" },
    minimumCheque: "100000",
    startedAt: "2026-09-01T09:00:00.000Z",
    closedAt: null,
    version: 4,
    createdAt: "2026-08-28T09:00:00.000Z",
    updatedAt: "2026-10-12T09:00:00.000Z",
  };
}

export function tessellateInvestors(now: number): RelationshipSummaryDto[] {
  const at = (days: number) => iso(now - days * DAY);
  return [
    [HARROW.name, HARROW.id, "IN_DILIGENCE", "FOLLOW_UP", 1],
    ["Brightwater Ventures", fid("b", 12), "IN_DILIGENCE", "NONE", 4],
    ["Oakum Partners", fid("b", 11), "INVESTED", "NONE", 2],
    ["Kestrel Angels", fid("b", 10), "INVESTED", "NONE", 11],
    ["Fenwick Seed", fid("b", 14), "INTEREST_EXPRESSED", "ANSWER_INTEREST", 3],
  ].map(([name, id, state, next, days], n) => ({
    relationshipId: n === 0 ? RECORD_RELATIONSHIP : fid("a", 200 + n),
    counterpart: {
      kind: "INVESTOR_ORGANISATION" as const,
      id: String(id),
      name: String(name),
    },
    state: state as RelationshipStateV2,
    nextStep: next as RelationshipSummaryDto["nextStep"],
    stateSince: at(Number(days)),
  }));
}

export function tessellateReadiness(): ReadinessDto {
  const evidence = (
    label: string,
    claim: boolean,
  ): ReadinessDto["pillars"][number]["evidence"][number] => ({
    label,
    source: claim ? "DECK" : "DATA_ROOM",
    truthClass: "USER_CLAIM",
    evidenceStatus: claim ? "SELF_REPORTED" : "DOCUMENT_SUPPORTED",
    note: claim ? "From your deck" : "On file",
    ref: null,
  });
  const action = (
    key: string,
    title: string,
    pillar: ReadinessDto["actions"][number]["pillar"],
    priority: ReadinessDto["actions"][number]["priority"],
    state: ReadinessDto["actions"][number]["state"],
    owner: ReadinessDto["actions"][number]["owner"] = "FOUNDER",
  ): ReadinessDto["actions"][number] => ({
    key,
    pillar,
    closesGapId: `gap.${key}`,
    priority,
    title,
    why: "An investor will ask for it before a term sheet.",
    next: "Upload it, or ask Q to draft it.",
    doneWhen: "It is on file and shared with investors you choose.",
    owner,
    ownerLabel: owner === "WITH_Q" ? "Q drafts, you approve" : "You",
    state,
    doneAt: state === "OPEN" ? null : "2026-10-15T09:00:00.000Z",
    href: "/documents",
    askQ: owner === "WITH_Q" ? `Help me: ${title.toLowerCase()}.` : null,
  });
  return {
    companyId: TESSELLATE.id,
    rulesVersion: "readiness-rules/v1",
    revision: 6,
    assessedAt: "2026-10-19T09:00:00.000Z",
    stageCode: "seed",
    pillars: [
      {
        pillar: "FOUNDER",
        label: "Team",
        status: "STRONG",
        summary: "4 people named with roles.",
        evidence: [evidence("4 people named with roles", false)],
        improve: [],
      },
      {
        pillar: "PRODUCT_AND_SOLUTION",
        label: "Product",
        status: "STRONG",
        summary: "Demo and architecture shared.",
        evidence: [evidence("Architecture overview", false)],
        improve: [],
      },
      {
        pillar: "COMMERCIAL_VALIDATION",
        label: "Traction",
        status: "DEVELOPING",
        summary: "$360k contracted ARR, from your deck.",
        evidence: [evidence("$360k contracted ARR", true)],
        improve: ["Share retention by customer."],
      },
      {
        pillar: "MARKET_OPPORTUNITY",
        label: "Market",
        status: "GAP",
        summary: "Size stated, no source given.",
        evidence: [evidence("$2.25bn TAM", true)],
        improve: ["Add a source for the market size."],
      },
      {
        pillar: "BUSINESS_ECONOMICS",
        label: "Financials",
        status: "STRONG",
        summary: "Cash, burn and runway on file.",
        evidence: [evidence("Management accounts, September", false)],
        improve: [],
      },
      {
        pillar: "GOVERNANCE_AND_TRUST",
        label: "Legal",
        status: "DEVELOPING",
        summary: "IP assignment deeds not uploaded.",
        evidence: [evidence("Certificate of incorporation", false)],
        improve: ["Upload IP assignment deeds."],
      },
      {
        pillar: "EXECUTION_CAPACITY",
        label: "Competition",
        status: "UNKNOWN",
        summary: "Not covered yet.",
        evidence: [],
        improve: ["Write a competition section."],
      },
      {
        pillar: "INVESTMENT_READINESS",
        label: "The ask",
        status: "STRONG",
        summary: "$3M post-money SAFE, $24m cap.",
        evidence: [evidence("$3M post-money SAFE", true)],
        improve: ["Name a lead investor."],
      },
    ],
    blockers: [
      {
        id: "gap.market-source",
        pillar: "MARKET_OPPORTUNITY",
        kind: "MISSING",
        title: "No source for the market size",
        why: "A size with no source reads as a guess.",
        actionKey: "market-source",
      },
      {
        id: "gap.ip-deeds",
        pillar: "GOVERNANCE_AND_TRUST",
        kind: "MISSING",
        title: "IP assignment deeds not uploaded",
        why: "Investors check the company owns what it sells.",
        actionKey: "ip-deeds",
      },
    ],
    actions: [
      action(
        "market-source",
        "Add a source for the market size",
        "MARKET_OPPORTUNITY",
        "NOW",
        "OPEN",
        "WITH_Q",
      ),
      action(
        "ip-deeds",
        "Upload IP assignment deeds",
        "GOVERNANCE_AND_TRUST",
        "NOW",
        "OPEN",
      ),
      action(
        "competition",
        "Write a competition section",
        "EXECUTION_CAPACITY",
        "NEXT",
        "OPEN",
        "WITH_Q",
      ),
      action(
        "retention",
        "Share retention by customer",
        "COMMERCIAL_VALIDATION",
        "NEXT",
        "OPEN",
      ),
      action(
        "lead",
        "Name a lead investor",
        "INVESTMENT_READINESS",
        "LATER",
        "OPEN",
      ),
      action(
        "runway",
        "Share runway after the raise",
        "BUSINESS_ECONOMICS",
        "NOW",
        "DONE_BY_EVIDENCE",
      ),
    ],
    followUps: [],
    uncertainty: ["Statuses come from what you've shared."],
  };
}

export function tessellateBlueprint(
  horizonMonths: 3 | 6 | 12,
): ReadinessBlueprintDto {
  const grounding = {
    evidence: [],
    truthClass: "Q_INFERENCE" as const,
    evidenceStatus: "SELF_REPORTED" as const,
    confidence: "MODERATE" as const,
  };
  const step = (
    id: string,
    title: string,
    pillar: ReadinessBlueprintDto["roadmap"][number]["pillar"],
    priority: "NOW" | "NEXT" | "LATER",
    executor: "FOUNDER" | "WITH_Q" | "EXPERT_SUPPORT",
    dependsOn: string[] = [],
  ): ReadinessBlueprintDto["roadmap"][number] => ({
    id,
    title,
    why: "It closes a gap an investor will ask about.",
    closesGapId: null,
    pillar,
    priority,
    effort: priority === "LATER" ? "WEEKS" : "DAYS",
    executor,
    dependsOn,
    doneWhen: "It is on file and Q sees the evidence.",
    ...grounding,
  });
  return {
    id: fid("5", 1),
    companyId: TESSELLATE.id,
    version: 2,
    horizonMonths,
    basis: {
      diagnosisVersion: "readiness-rules/v1",
      evidenceAsOf: "2026-10-19",
      mandateVersions: [],
    },
    roadmap: [
      step(
        "close-seed",
        "Close the seed round",
        "INVESTMENT_READINESS",
        "NOW",
        "FOUNDER",
      ),
      step(
        "market-source",
        "Source the market size",
        "MARKET_OPPORTUNITY",
        "NOW",
        "WITH_Q",
      ),
      step(
        "sales-leads",
        "Hire two enterprise sales leads",
        "EXECUTION_CAPACITY",
        "NEXT",
        "FOUNDER",
        ["close-seed"],
      ),
      step(
        "third-contract",
        "Sign a third paid contract",
        "COMMERCIAL_VALIDATION",
        "NEXT",
        "FOUNDER",
      ),
      step(
        "soc2",
        "Reach SOC 2 Type I",
        "GOVERNANCE_AND_TRUST",
        "LATER",
        "EXPERT_SUPPORT",
      ),
      step(
        "series-a",
        "Be ready for a Series A",
        "INVESTMENT_READINESS",
        "LATER",
        "WITH_Q",
        ["soc2"],
      ),
    ],
    sequencing: [
      {
        label: "Now",
        startsWeek: 0,
        endsWeek: 6,
        stepIds: ["close-seed", "market-source"],
      },
      {
        label: "Next",
        startsWeek: 6,
        endsWeek: 20,
        stepIds: ["sales-leads", "third-contract"],
      },
      {
        label: "Later",
        startsWeek: 20,
        endsWeek: 52,
        stepIds: ["soc2", "series-a"],
      },
    ],
    investorPlans: [],
    uncertainty: [
      "Retention is not shared yet, so the traction step is a guess at timing.",
    ],
    generatedAt: "2026-10-19T09:00:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// The relationship record with Tessellate Labs (proto-crm p-record.js).
// ---------------------------------------------------------------------------

export function tessellateStatus(now: number): RelationshipStatusDto {
  const at = (days: number) => iso(now - days * DAY);
  return {
    relationshipId: RECORD_RELATIONSHIP,
    companyId: TESSELLATE.id,
    investorOrganisationId: HARROW.id,
    state: "IN_DILIGENCE",
    stateSince: at(1),
    nextStep: "NONE",
    milestones: [
      { state: "INTEREST_EXPRESSED", at: at(14) },
      { state: "CONNECTED", at: at(14) },
      { state: "MEETING_HELD", at: at(2) },
      { state: "IN_DILIGENCE", at: at(1) },
    ],
    projectorVersion: "relationship-state.v2",
  };
}

export function tessellateProfile(): CounterpartProfile {
  return {
    photoUrl: null,
    companyId: TESSELLATE.id,
    about:
      "A gateway that runs LLM inference inside hardware enclaves and attests every request, so regulated firms can use AI on sensitive data.",
    location: "Austin, United States",
    websiteUrl: "https://tessellate.example",
    chips: ["Seed", "Security", "B2B SaaS"],
    profileHref: "/dev/profile",
  };
}

/** Calls: the one booked for tomorrow, one held, one cancelled. */
export function tessellateMeetings(now: number): MeetingDto[] {
  const monday = mondayOf(now);
  const meeting = (
    n: number,
    purpose: string,
    startsAt: number,
    status: MeetingDto["status"],
    hasBrief: boolean,
  ): MeetingDto => ({
    id: fid("8", n),
    relationshipId: RECORD_RELATIONSHIP,
    purpose,
    startsAt: iso(startsAt),
    endsAt: iso(startsAt + 45 * 60_000),
    timeZone: "Europe/London",
    status,
    organisedByYou: true,
    organiserName: "Amelia Hart",
    meetLink: "https://meet.example/tessellate",
    attendees: ["Laura Bennett", "Dev Patel"],
    hasBrief,
  });
  // Tomorrow at 14:00 (the prototype's booked hour), or this week's Tuesday.
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(14, 0, 0, 0);
  const booked =
    tomorrow.getTime() < monday + 5 * DAY
      ? tomorrow.getTime()
      : monday + DAY + 14 * HOUR;
  return [
    meeting(
      1,
      "Diligence call: retention and the market",
      booked,
      "SCHEDULED",
      true,
    ),
    meeting(
      2,
      "First call with Tessellate Labs",
      now - 2 * DAY,
      "SCHEDULED",
      true,
    ),
    meeting(3, "Intro call", now - 11 * DAY, "CANCELLED", false),
  ];
}

/** Monday 00:00 (server-local) of the week the calendar shows. */
function mondayOf(now: number): number {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  const weekday = (day.getDay() + 6) % 7;
  day.setDate(day.getDate() - weekday + (weekday >= 5 ? 7 : 0));
  return day.getTime();
}

/** This week's busy hours on the person's calendar (never what they are). */
export function harrowBusy(
  now: number,
): readonly { readonly startsAt: string; readonly endsAt: string }[] {
  const monday = mondayOf(now);
  // [weekday 0-4, hour] from proto-crm p-calls.js BUSY.
  const busy: readonly (readonly [number, number])[] = [
    [0, 9],
    [0, 10],
    [0, 16],
    [1, 12],
    [2, 13],
    [3, 11],
    [3, 15],
    [4, 9],
    [4, 10],
  ];
  return busy.map(([day, hour]) => {
    const start = monday + day * DAY + hour * HOUR;
    return { startsAt: iso(start), endsAt: iso(start + HOUR) };
  });
}

export function tessellateInterest(now: number): InterestDto {
  return {
    interestId: fid("4", 1),
    relationshipId: RECORD_RELATIONSHIP,
    companyId: TESSELLATE.id,
    status: "EXPRESSED",
    expressedAt: iso(now - 14 * DAY),
    response: "ACCEPTED",
    respondedAt: iso(now - 14 * DAY + 5 * HOUR),
    connection: null,
  };
}

export function tessellateWork(now: number): readonly RecordWorkRow[] {
  return [
    {
      key: "work-1",
      title: "Seed security deals this quarter",
      status: "Running",
      stage: "Report written",
      href: "/work",
      report: {
        headline: "Strong technical moat; traction is the open question",
        verdict: "Worth diligence",
        href: "/work",
      },
      updatedAt: iso(now - DAY),
    },
  ];
}

export function harrowNotes(now: number): RelationshipNoteList {
  return {
    visibility: "organisation_private",
    items: [
      {
        id: fid("3", 1),
        body: "Strong technical founders. Ask how retention looks across the two paid contracts before we firm up.",
        authorName: null,
        authoredByMe: true,
        createdAt: iso(now - 5 * HOUR),
        supersedesNoteId: null,
      },
      {
        id: fid("3", 2),
        body: "Met Laura at the London security meetup; she asked for a lead.",
        authorName: "Tom Reyes",
        authoredByMe: false,
        createdAt: iso(now - 13 * DAY),
        supersedesNoteId: null,
      },
    ],
  };
}

/** The deal at terms: revision 2 approved today, beside revision 1. */
export function tessellateDeal(now: number): DealViewDto {
  const at = (days: number) => iso(now - days * DAY);
  const terms = (version: number, recordedAt: string): DealTermsDto => ({
    termsId: fid("2", version),
    version,
    status: version === 2 ? "RECORDED" : "SUPERSEDED",
    instrument: "SAFE",
    amount: "250000",
    currencyCode: "USD",
    valuationCap: version === 2 ? "24000000" : "20000000",
    valuationBasis: "POST_MONEY",
    preMoneyValuation: null,
    discountPercent: null,
    proRata: true,
    otherTerms: null,
    termsDocumentId: null,
    recordedBySide: "INVESTOR",
    recordedBy: "Amelia Hart",
    recordedAt,
    signedDocumentId: null,
    signedBy: null,
    signedAt: null,
  });
  return {
    relationshipId: RECORD_RELATIONSHIP,
    side: "INVESTOR",
    stageVersion: "deal-stage.v1",
    stages: [
      { stage: "MET", reachedAt: at(2) },
      { stage: "DILIGENCE", reachedAt: at(1) },
      { stage: "SOFT_COMMIT", reachedAt: at(1) },
      { stage: "TERMS", reachedAt: iso(now - 2 * HOUR) },
      { stage: "SIGNED", reachedAt: null },
      { stage: "FUNDS_RECEIVED", reachedAt: null },
      { stage: "CLOSED", reachedAt: null },
    ],
    current: "TERMS",
    end: null,
    nextSteps: ["RECORD_TERMS", "MARK_SIGNED", "SEND_FUNDS", "PASS"],
    terms: terms(2, iso(now - 2 * HOUR)),
    termsHistory: [terms(1, at(1))],
    close: null,
    checklist: [],
    updateCadence: null,
    passNoteDraft: null,
    sharedDocumentIds: [fid("1", 1), fid("1", 2)],
    reports: [
      {
        reportId: fid("0", 1),
        kind: "DILIGENCE",
        version: 1,
        title: "Diligence report: Tessellate Labs",
        visibility: "relationship_shared",
        ownerSide: "INVESTOR",
        generatedBy: "Amelia Hart",
        createdAt: at(1),
        contentSha256: "a".repeat(64),
      },
    ],
  };
}

export function tessellateCommitments(now: number): RelationshipCommitmentsDto {
  return {
    current: {
      id: fid("f", 200),
      amount: "250000",
      currencyCode: "USD",
      level: "SOFT",
      status: "STATED",
      source: "PERSON",
      quote: null,
      statedByYourSide: true,
      statedAt: iso(now - DAY),
      confirmedAt: null,
      note: "After the first call: likely in, subject to diligence.",
      meetingId: null,
      canConfirm: false,
      canAdopt: false,
      canDispute: false,
      canWithdraw: true,
    },
    history: [],
    detected: [],
    connected: true,
  };
}

/** Diligence: shared (viewed and not), waiting, declined, and not asked. */
export function tessellateDiligence(now: number): DiligenceDto {
  const at = (hours: number) => iso(now - hours * HOUR);
  const doc = (n: number) => fid("1", n);
  return {
    relationshipId: RECORD_RELATIONSHIP,
    side: "INVESTOR",
    open: true,
    shares: [
      {
        policyId: fid("6", 11),
        documentId: doc(1),
        title: "Tax filings and good standing",
        documentType: "LEGAL",
        sharedAt: at(30),
        scanned: true,
        viewedAt: at(20),
        qSummary: "Filed on time for 2024 and 2025; good standing dated 2 Oct.",
      },
      {
        policyId: fid("6", 12),
        documentId: doc(2),
        title: "Seed deck, October",
        documentType: "PITCH_DECK",
        sharedAt: at(4),
        scanned: true,
        viewedAt: null,
        qSummary: "Matches the pitch video; the market size has no source.",
      },
    ],
    requests: [
      {
        requestId: fid("6", 21),
        title: "Tax filings and good standing",
        note: null,
        requestedAt: at(40),
        requestedByName: "Amelia Hart",
        status: "FULFILLED",
        declineNote: null,
        fulfilledBy: {
          documentId: doc(1),
          title: "Tax filings and good standing",
        },
        questions: null,
      },
      {
        requestId: fid("6", 22),
        title: "IP assignment deeds",
        note: "Founders and the four staff, please.",
        requestedAt: at(26),
        requestedByName: "Amelia Hart",
        status: "OPEN",
        declineNote: null,
        fulfilledBy: null,
        questions: null,
      },
      {
        requestId: fid("6", 23),
        title: "Latency benchmark method",
        note: "The 40 ms figure is their claim until this arrives.",
        requestedAt: at(26),
        requestedByName: "Amelia Hart",
        status: "OPEN",
        declineNote: null,
        fulfilledBy: null,
        questions: null,
      },
      {
        requestId: fid("6", 24),
        title: "Questions on traction",
        note: null,
        requestedAt: at(24),
        requestedByName: "Amelia Hart",
        status: "OPEN",
        declineNote: null,
        fulfilledBy: null,
        questions: [
          {
            questionId: fid("6", 31),
            question: "How many paid contracts are live today?",
            assumptionId: "TRACTION:1",
            assumptionLabel: "Paid contracts",
            answer: {
              text: "Two, both annual; a third is in legal review.",
              answeredAt: at(6),
              truthClass: "USER_CLAIM",
              evidenceStatus: "SELF_REPORTED",
            },
          },
          {
            questionId: fid("6", 32),
            question: "What is the sales cycle for an enterprise contract?",
            assumptionId: null,
            assumptionLabel: null,
            answer: null,
          },
        ],
      },
      {
        requestId: fid("6", 25),
        title: "Customer contracts",
        note: null,
        requestedAt: at(30),
        requestedByName: "Amelia Hart",
        status: "DECLINED",
        declineNote: "We'll share these after a term sheet.",
        fulfilledBy: null,
        questions: null,
      },
    ],
  };
}

/** Q's open questions on the company: one is not asked yet. */
export const TESSELLATE_OPEN_QUESTIONS = [
  "Retention by customer",
  "Does the round still require a lead investor?",
];

// ---------------------------------------------------------------------------
// Messages: the inbox split (proto-crm p-messages.js CONVS and MSG).
// ---------------------------------------------------------------------------

export function harrowInbox(now: number): readonly InboxRow[] {
  const items = investorItems(now);
  const row = (
    name: string,
    preview: string,
    hours: number,
    unread: number,
  ): InboxRow => {
    const n = byName(name);
    const item = items[n];
    return {
      relationshipId: relationshipId(n),
      name,
      href:
        name === TESSELLATE.name
          ? "/dev/crm?view=messages"
          : name === "Lumenfold"
            ? "/dev/crm?view=messages-empty"
            : "/dev/crm?view=messages",
      photoUrl: null,
      companyId: companyId(n),
      matched:
        item !== undefined &&
        item.state !== "INTEREST_EXPRESSED" &&
        item.state !== "DISCOVERED",
      preview,
      at: iso(now - hours * HOUR),
      unread,
    };
  };
  return [
    row(TESSELLATE.name, "Dev Patel: Ahead of the call, the 40 ms…", 3, 1),
    row(
      "Pennant Robotics",
      "You: Would you like us to open the data room?",
      26,
      0,
    ),
    row("Quillwork", "Ines Okafor: Happy to talk next week.", 30, 2),
    row("Northbeam", "You: Congratulations on the close.", 7 * 24, 0),
    row(
      "Lumenfold",
      "Interest sent, waiting for them to accept",
      12 * 24 + 5,
      0,
    ),
  ];
}

export function tessellateThread(now: number): ChatThreadDto {
  const message = (
    n: number,
    mine: boolean,
    senderName: string,
    body: string,
    hoursAgo: number,
  ): ChatThreadDto["messages"][number] => ({
    messageId: fid("e", 100 + n),
    side: mine ? "INVESTOR" : "COMPANY",
    mine,
    senderName,
    kind: "TEXT",
    body,
    attachment: null,
    voiceDurationMs: null,
    edited: false,
    unsent: false,
    viaQ: false,
    sentAt: iso(now - hoursAgo * HOUR),
  });
  const messages = [
    message(
      1,
      false,
      "Lena Brandt",
      "Thanks for the call notes. We've shared the tax filings and good standing; they're view only until 12 Nov.",
      5 * 24 + 2,
    ),
    message(
      2,
      true,
      "Amelia Hart",
      "Thank you. Could you also share how retention looks across the two paid contracts?",
      5 * 24 + 1.5,
    ),
    message(
      3,
      false,
      "Lena Brandt",
      "Yes. We're pulling it together and will bring it to tomorrow's call.",
      5 * 24 + 1,
    ),
    message(
      4,
      false,
      "Dev Patel",
      "Ahead of the call: the 40 ms overhead is a median across 31 million requests. Happy to walk through the method.",
      3,
    ),
  ];
  return {
    relationshipId: RECORD_RELATIONSHIP,
    status: "OPEN",
    messages,
    cursor: fid("e", 104),
    counterpartLastReadMessageId: fid("e", 102),
    unread: 1,
    blockedByYourSide: false,
  };
}

/** Lumenfold: interest sent, not accepted yet, so messages are locked. */
export function lumenfoldStatus(now: number): RelationshipStatusDto {
  const n = byName("Lumenfold");
  const since = iso(now - (ROWS[n]?.hours ?? 0) * HOUR);
  return {
    relationshipId: relationshipId(n),
    companyId: companyId(n),
    investorOrganisationId: HARROW.id,
    state: "INTEREST_EXPRESSED",
    stateSince: since,
    nextStep: "AWAIT_ANSWER",
    milestones: [{ state: "INTEREST_EXPRESSED", at: since }],
    projectorVersion: "relationship-state.v2",
  };
}

export function lumenfoldProfile(): CounterpartProfile {
  return {
    photoUrl: null,
    companyId: companyId(byName("Lumenfold")),
    about: "Passkeys for hospitals and councils.",
    location: "Manchester, United Kingdom",
    websiteUrl: null,
    chips: ["Seed", "Security"],
    profileHref: null,
  };
}

export const LUMENFOLD = {
  id: companyId(byName("Lumenfold")),
  name: "Lumenfold",
} as const;

/** The Relationship Brief the record's Next rail reads its lines from. */
export function tessellateBrief(now: number): RelationshipBrief {
  const status = tessellateStatus(now);
  const meetings = tessellateMeetings(now).map((meeting) => ({
    id: meeting.id,
    status: meeting.status,
    startsAt: meeting.startsAt,
    endsAt: meeting.endsAt,
    timing:
      Date.parse(meeting.endsAt) > now
        ? ("UPCOMING" as const)
        : ("PAST" as const),
    organisedByYou: meeting.organisedByYou,
    noShow: false,
  }));
  const thread = tessellateThread(now);
  const latest = thread.messages.at(-1);
  const message =
    latest === undefined
      ? null
      : {
          from: latest.mine ? ("YOU" as const) : ("OTHER_SIDE" as const),
          senderName: latest.senderName,
          kind: latest.kind,
          delivery: "SENT" as const,
          viaQ: false,
          sentAt: latest.sentAt,
          preview: latest.body,
        };
  const diligence = tessellateDiligence(now);
  return {
    relationshipId: RECORD_RELATIONSHIP,
    yourSide: "INVESTOR",
    counterparty: { kind: "COMPANY", id: TESSELLATE.id, name: TESSELLATE.name },
    generatedAt: iso(now),
    state: {
      state: status.state,
      stateSince: status.stateSince,
      milestones: status.milestones,
      nextStep: status.nextStep,
    },
    messages: {
      count: 19,
      latest: { status: "OK", message, fromThem: message },
    },
    noShows: [],
    meetings: {
      status: "OK",
      items: meetings,
      nextScheduled:
        meetings.find(
          (m) => m.status === "SCHEDULED" && m.timing === "UPCOMING",
        ) ?? null,
    },
    pendingDecisions: {
      items: [{ kind: "ATTEND_MEETING", owner: "YOU", since: null }],
      complete: true,
    },
    obligations: {
      status: "OK",
      openRequests: diligence.requests
        .filter((request) => request.status === "OPEN")
        .map((request) => ({ id: request.requestId, title: request.title })),
      answeredCount: 1,
    },
    documents: {
      status: "OK",
      items: diligence.shares.map((share) => ({
        id: share.documentId,
        title: share.title,
        openedByYourSide: share.viewedAt !== null,
      })),
    },
    sourceVersions: {
      projector: "relationship-state.v2",
      historySequence: 42,
      brief: "relationship-brief.v1",
    },
  };
}
