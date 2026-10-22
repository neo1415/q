import {
  DecimalStringSchema,
  type CardDetail,
  type CardMetric,
  type EvidenceStatus,
  type PublicCardDto,
  type QCardField,
  type QCardScope,
  type TruthClass,
} from "@capital-q/contracts";

/**
 * The card's richer sections, pure (owner 2026-10-21, Q Story S6): each
 * owning context's rows, already read, turned into what a card may show
 * for each audience scope.
 *
 * Rows that carry their own scope (claims, data room levels) are filtered
 * per scope here, so a section the owner makes public never carries an
 * item its row keeps to members, and nothing narrower than
 * network_visible is ever read in. Unknown stays unknown: a section with
 * nothing to show is absent, never zero.
 */

export type SectionClaim = {
  readonly claimKey: string;
  readonly statement: string;
  readonly structuredValue: Readonly<Record<string, unknown>> | null;
  readonly validFrom: string | null;
  readonly validTo: string | null;
  readonly truthClass: TruthClass;
  readonly evidenceStatus: EvidenceStatus;
  readonly visibilityScope: string;
};

export type SectionRaise = {
  readonly stageCode: string | null;
  readonly instrumentCode: string | null;
  readonly target: { readonly amount: string; readonly currency: string };
  readonly useOfFunds: string | null;
  readonly targetCloseDate: string | null;
};

export type SectionInvestability = {
  readonly status: string;
  readonly band: string | null;
  readonly confidence: string | null;
  readonly strengths: readonly string[];
  readonly areasScored: number;
  readonly areasTotal: number;
  readonly method: string;
  readonly assessedAt: string | null;
};

export type SectionDocument = {
  readonly title: string;
  readonly category: string | null;
  /** The data room level: only PUBLIC and ON_REQUEST titles are listed. */
  readonly level: string;
};

export type CompanySectionInputs = {
  readonly claims: readonly SectionClaim[];
  readonly raise: SectionRaise | null;
  readonly investability: SectionInvestability | null;
  /** Investor conversations by projected state; the company's own view. */
  readonly pipeline: Readonly<Record<string, number>>;
  readonly team: readonly {
    readonly name: string;
    readonly role: string | null;
    /** The member's own profile photo, signed; null: initials. */
    readonly photoUrl?: string | null | undefined;
  }[];
  readonly documents: readonly SectionDocument[];
};

/**
 * The metrics a card may carry, in the order it shows them. Burn, cash and
 * runway are deliberately absent: together they imply runway (the Context
 * Firewall's combination risk), so they never go on a card.
 */
const METRICS: ReadonlyArray<{
  readonly keys: readonly string[];
  readonly label: string;
  readonly unit: string | null;
}> = [
  { keys: ["financial.arr"], label: "ARR", unit: null },
  {
    keys: ["financial.mrr", "financial.monthly_revenue"],
    label: "Monthly revenue",
    unit: null,
  },
  { keys: ["financial.revenue"], label: "Revenue", unit: null },
  { keys: ["traction.growth"], label: "Growth", unit: "%" },
  { keys: ["traction.monthly_gmv"], label: "Monthly GMV", unit: null },
  {
    keys: ["traction.customer_count", "traction.active_customers"],
    label: "Customers",
    unit: "customers",
  },
  {
    keys: ["customers.paying_accounts", "customers.employers"],
    label: "Paying customers",
    unit: "customers",
  },
  { keys: ["traction.active_users"], label: "Active users", unit: "users" },
  { keys: ["financial.gross_margin"], label: "Gross margin", unit: "%" },
  { keys: ["financial.nrr"], label: "Net revenue retention", unit: "%" },
  { keys: ["traction.churn_rate"], label: "Churn", unit: "%" },
  { keys: ["team.employee_count"], label: "Team size", unit: "people" },
];

const MAX_METRICS = 8;

/** Projections and targets are not traction. */
function isForecast(claim: SectionClaim): boolean {
  const v = claim.structuredValue;
  return (
    v !== null &&
    (v["forecast"] === true ||
      v["isForecast"] === true ||
      v["actual"] === false ||
      v["kind"] === "FORECAST" ||
      v["basis"] === "FORECAST" ||
      /\b(forecast|projection|projected|target|planned)\b/iu.test(
        claim.statement,
      ))
  );
}

/** An exact decimal string from a stored amount, or null (never guessed). */
function decimal(value: unknown, places?: number): string | null {
  const text =
    typeof value === "number" && Number.isFinite(value)
      ? places === undefined
        ? String(value)
        : String(Number(value.toFixed(places)))
      : typeof value === "string"
        ? value.trim()
        : null;
  return text !== null && DecimalStringSchema.safeParse(text).success
    ? text
    : null;
}

function metricOf(
  claim: SectionClaim,
  label: string,
  unit: string | null,
): CardMetric | null {
  const v = claim.structuredValue;
  if (v === null) return null;
  const kind = v["kind"];
  const period = periodOf(claim);
  if (kind === "MONEY") {
    const amount = decimal(v["amount"]);
    const currency = v["currency"];
    if (
      amount === null ||
      typeof currency !== "string" ||
      !/^[A-Z]{3}$/.test(currency)
    ) {
      return null;
    }
    return {
      label,
      amount,
      currency,
      unit: null,
      period,
      truthClass: claim.truthClass,
      evidenceStatus: claim.evidenceStatus,
    };
  }
  if (
    (kind === "COUNT" || kind === "PERCENTAGE" || kind === "PERCENT") &&
    unit !== null
  ) {
    const amount = decimal(v["value"], kind === "COUNT" ? 0 : 1);
    if (amount === null) return null;
    // A percentage key never takes a count, nor a count key a percentage.
    if ((unit === "%") !== (kind !== "COUNT")) return null;
    return {
      label,
      amount,
      currency: null,
      unit,
      period,
      truthClass: claim.truthClass,
      evidenceStatus: claim.evidenceStatus,
    };
  }
  return null;
}

/** "2025" or "Mar 2025" from the claim's validity, as stated; else null. */
function periodOf(claim: SectionClaim): string | null {
  const v = claim.structuredValue;
  const asOf =
    (typeof v?.["periodEnd"] === "string" ? v["periodEnd"] : null) ??
    (typeof v?.["asOf"] === "string" ? v["asOf"] : null) ??
    claim.validTo ??
    claim.validFrom;
  if (asOf === null) return null;
  const date = new Date(asOf);
  if (Number.isNaN(date.getTime())) return null;
  return `As of ${date.toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })}`;
}

const SCOPE_REACH: Readonly<Record<QCardScope, ReadonlySet<string>>> = {
  public_external: new Set(["public_external"]),
  network_visible: new Set(["public_external", "network_visible"]),
};

function metricsFor(
  claims: readonly SectionClaim[],
  scope: QCardScope,
): CardDetail | null {
  const reach = SCOPE_REACH[scope];
  const metrics: CardMetric[] = [];
  for (const spec of METRICS) {
    // Every current reading of the fact, side by side: contradictions
    // coexist until reconciled, and the favourable one is never picked.
    for (const claim of claims) {
      if (!spec.keys.includes(claim.claimKey)) continue;
      if (!reach.has(claim.visibilityScope) || isForecast(claim)) continue;
      const metric = metricOf(claim, spec.label, spec.unit);
      if (metric === null) continue;
      if (
        metrics.some(
          (m) =>
            m.label === metric.label &&
            m.amount === metric.amount &&
            m.currency === metric.currency &&
            m.period === metric.period,
        )
      ) {
        continue;
      }
      metrics.push(metric);
    }
  }
  if (metrics.length === 0) return null;
  // Truncate by whole facts, so a contradiction is never cut in half.
  const kept: CardMetric[] = [];
  for (const metric of metrics) {
    const sameFact = metrics.filter((m) => m.label === metric.label);
    if (kept.some((m) => m.label === metric.label)) continue;
    if (kept.length + sameFact.length > MAX_METRICS) break;
    kept.push(...sameFact);
  }
  return kept.length === 0 ? null : { kind: "METRICS", metrics: kept };
}

/** Pipeline states a card counts, in order; passes and declines never. */
const PIPELINE: ReadonlyArray<readonly [string, string]> = [
  ["INTEREST_EXPRESSED", "Interest expressed"],
  ["CONNECTED", "Connected"],
  ["MEETING_HELD", "Met"],
  ["IN_DILIGENCE", "In diligence"],
  ["INVESTED", "Invested"],
];

const LISTED_LEVELS: ReadonlySet<string> = new Set(["PUBLIC", "ON_REQUEST"]);

function same(detail: CardDetail | null) {
  return { public_external: detail, network_visible: detail };
}

function membersOnly(detail: CardDetail | null) {
  return { public_external: null, network_visible: detail };
}

/**
 * A company's sections: a one-line text value per section (the field's
 * `value`, for plain readers) and its structured detail per scope.
 */
export function companySections(input: CompanySectionInputs): {
  readonly facts: Readonly<Record<string, string | null>>;
  readonly details: Readonly<
    Record<string, Readonly<Partial<Record<QCardScope, CardDetail | null>>>>
  >;
} {
  const metrics = {
    public_external: metricsFor(input.claims, "public_external"),
    network_visible: metricsFor(input.claims, "network_visible"),
  };

  const raise: CardDetail | null =
    input.raise === null ||
    decimal(input.raise.target.amount) === null ||
    !/^[A-Z]{3}$/.test(input.raise.target.currency)
      ? null
      : {
          kind: "RAISE",
          stageCode: input.raise.stageCode,
          instrumentCode: input.raise.instrumentCode,
          target: input.raise.target,
          useOfFunds:
            input.raise.useOfFunds === null ||
            input.raise.useOfFunds.trim().length === 0
              ? null
              : input.raise.useOfFunds.trim().slice(0, 1000),
          targetCloseDate: input.raise.targetCloseDate,
          // The owner's own declared objective, shown as they stated it.
          truthClass: "USER_CLAIM",
          evidenceStatus: "SELF_REPORTED",
        };

  const iq = input.investability;
  const intelligence: CardDetail | null =
    iq === null ||
    (iq.status !== "SCORED" && iq.status !== "INSUFFICIENT_EVIDENCE")
      ? null
      : {
          kind: "INTELLIGENCE",
          status: iq.status === "SCORED" ? "ASSESSED" : "INSUFFICIENT_EVIDENCE",
          band: iq.status === "SCORED" ? iq.band : null,
          confidence: iq.status === "SCORED" ? iq.confidence : null,
          strengths: iq.strengths.slice(0, 3),
          areasScored: iq.areasScored,
          areasTotal: iq.areasTotal,
          method: iq.method,
          assessedAt: iq.assessedAt,
        };

  const stages = PIPELINE.flatMap(([state, label]) => {
    const count = input.pipeline[state] ?? 0;
    return Number.isInteger(count) && count > 0 ? [{ label, count }] : [];
  });
  const relationships: CardDetail | null =
    stages.length === 0 ? null : { kind: "RELATIONSHIPS", stages };

  const members = input.team
    .filter((member) => member.name.trim().length > 0)
    .slice(0, 12)
    .map((member) => ({
      name: member.name.trim().slice(0, 120),
      role:
        member.role === null || member.role.trim().length === 0
          ? null
          : member.role.trim().slice(0, 120),
      ...(typeof member.photoUrl === "string" &&
      /^https?:\/\//.test(member.photoUrl)
        ? { photoUrl: member.photoUrl }
        : {}),
    }));
  const team: CardDetail | null =
    members.length === 0 ? null : { kind: "TEAM", members };

  const listed = input.documents
    .filter((doc) => LISTED_LEVELS.has(doc.level) && doc.title.trim() !== "")
    .slice(0, 20)
    .map((doc) => ({
      title: doc.title.trim().slice(0, 160),
      category: doc.category === null ? null : doc.category.slice(0, 60),
    }));
  const documents: CardDetail | null =
    listed.length === 0 ? null : { kind: "DOCUMENTS", documents: listed };

  const line = (present: boolean, text: string) => (present ? text : null);
  const anyMetrics = metrics.network_visible ?? metrics.public_external;
  return {
    facts: {
      tractionMetrics: line(
        anyMetrics !== null,
        anyMetrics?.kind === "METRICS"
          ? anyMetrics.metrics.map((m) => m.label).join(", ")
          : "",
      ),
      currentRaise: line(
        raise !== null,
        raise?.kind === "RAISE"
          ? `${raise.target.amount} ${raise.target.currency}`
          : "",
      ),
      investabilitySummary: line(
        intelligence !== null,
        intelligence?.kind === "INTELLIGENCE"
          ? (intelligence.band ?? "Not enough evidence yet")
          : "",
      ),
      relationshipSummary: line(
        relationships !== null,
        stages.map((stage) => `${stage.label}: ${stage.count}`).join(", "),
      ),
      team: line(team !== null, members.map((m) => m.name).join(", ")),
      documentsOnRequest: line(
        documents !== null,
        `${listed.length} document${listed.length === 1 ? "" : "s"}`,
      ),
    },
    details: {
      tractionMetrics: metrics,
      currentRaise: same(raise),
      relationshipSummary: same(relationships),
      investabilitySummary: membersOnly(intelligence),
      team: membersOnly(team),
      documentsOnRequest: membersOnly(documents),
    },
  };
}

/** An investor organisation's team: the firm's people and their titles. */
export function investorTeamSection(
  members: readonly { readonly name: string; readonly role: string | null }[],
): {
  readonly facts: Readonly<Record<string, string | null>>;
  readonly details: Readonly<
    Record<string, Readonly<Partial<Record<QCardScope, CardDetail | null>>>>
  >;
} {
  const sections = companySections({
    claims: [],
    raise: null,
    investability: null,
    pipeline: {},
    team: members,
    documents: [],
  });
  return {
    facts: { team: sections.facts["team"] ?? null },
    details: { team: sections.details["team"] ?? {} },
  };
}

/** What a person's focus may echo from their organisation's own card. */
const FOCUS_KEYS: Readonly<
  Record<"INVESTOR" | "FOUNDER", readonly QCardField[]>
> = {
  INVESTOR: [
    "mandateTypicalCheque",
    "mandateStages",
    "mandateSectors",
    "mandateGeographies",
    "mandateLookFor",
    "deploymentState",
  ],
  FOUNDER: ["currentStageCode", "shortDescription"],
};

function focusFrom(
  side: "INVESTOR" | "FOUNDER",
  card: PublicCardDto | null,
): CardDetail | null {
  if (card === null) return null;
  const fields = FOCUS_KEYS[side].flatMap((key) => {
    const field = card.fields.find((candidate) => candidate.key === key);
    return field === undefined ? [] : [{ key, value: field.value }];
  });
  const raiseDetail =
    side === "FOUNDER"
      ? card.fields.find((field) => field.key === "currentRaise")?.detail
      : undefined;
  const raise =
    raiseDetail?.kind === "RAISE"
      ? { target: raiseDetail.target, stageCode: raiseDetail.stageCode }
      : null;
  if (fields.length === 0 && raise === null) return null;
  return {
    kind: "FOCUS",
    side,
    organisationHandle: card.handle,
    fields,
    raise,
  };
}

/**
 * A person's "what they're looking for" (owner 2026-10-22), per scope,
 * built only from their organisation's own card as that card shows it to
 * the same audience: anyone sees what the organisation's card shows anyone,
 * members what it shows members. A person's card therefore never widens
 * what their organisation chose to share.
 */
export function personFocus(input: {
  readonly side: "INVESTOR" | "FOUNDER";
  readonly publicCard: PublicCardDto | null;
  readonly memberCard: PublicCardDto | null;
}): {
  readonly value: string | null;
  readonly details: Readonly<Partial<Record<QCardScope, CardDetail | null>>>;
} {
  // Each projection is re-filtered to its own audience's scopes.
  const publicCard =
    input.publicCard === null
      ? null
      : {
          ...input.publicCard,
          fields: input.publicCard.fields.filter(
            (field) => field.scope === "public_external",
          ),
        };
  const details = {
    public_external: focusFrom(input.side, publicCard),
    network_visible: focusFrom(input.side, input.memberCard),
  };
  const any = details.network_visible ?? details.public_external;
  return {
    value:
      any === null
        ? null
        : input.side === "INVESTOR"
          ? "Investment focus"
          : "Company focus",
    details,
  };
}
