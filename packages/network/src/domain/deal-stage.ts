import {
  RELATIONSHIP_EVENT_COMMITMENT_CONFIRMED,
  RELATIONSHIP_EVENT_COMMITMENT_RECEIVED,
  RELATIONSHIP_EVENT_COMMITMENT_WITHDRAWN,
  RELATIONSHIP_EVENT_DEAL_CLOSED,
  RELATIONSHIP_EVENT_DEAL_TERMS_RECORDED,
  RELATIONSHIP_EVENT_DEAL_TERMS_SIGNED,
  RELATIONSHIP_EVENT_DILIGENCE_STARTED,
  RELATIONSHIP_EVENT_MEETING_HELD,
  RELATIONSHIP_EVENT_RELATIONSHIP_PASSED,
  RELATIONSHIP_EVENT_RELATIONSHIP_RESUMED,
} from "./event-registry.js";
import type { ProjectableEvent, RelationshipParty } from "./state-projector.js";

/**
 * deal-stage.v1 (founder, 2026-10-08): the stage strip both sides see on
 * the ONE relationship page, read from the same history as the relationship
 * state. A pure, deterministic fold: no clock, no I/O, no model, no stored
 * stage. There is no deal record; this is a reading of the relationship.
 *
 *   MET            first meeting_held
 *   DILIGENCE      diligence_started
 *   SOFT_COMMIT    a commitment confirmed by the other side (any level);
 *                  withdrawing that commitment un-reaches it
 *   TERMS          deal_terms_recorded           (needs SOFT_COMMIT)
 *   SIGNED         deal_terms_signed             (needs TERMS)
 *   FUNDS_RECEIVED commitment_received           (the company confirmed)
 *   CLOSED         deal_closed                   (needs SIGNED + FUNDS_RECEIVED)
 *
 * A relationship_passed ends the strip at PASSED; relationship_resumed
 * after a pass reopens it. Nothing moves after CLOSED or PASSED. A
 * registered deal event that is not a legal move here is kept as an
 * anomaly and changes nothing -- contradictions are surfaced, never
 * silently resolved.
 */

export const DEAL_STAGE_VERSION = "deal-stage.v1" as const;

export const DEAL_STAGES = [
  "MET",
  "DILIGENCE",
  "SOFT_COMMIT",
  "TERMS",
  "SIGNED",
  "FUNDS_RECEIVED",
  "CLOSED",
] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export type DealEnd = "CLOSED" | "PASSED";

export type DealStageProjection = {
  readonly version: typeof DEAL_STAGE_VERSION;
  /** When each stage was reached, or null: not reached (unknown is not "no"). */
  readonly reached: Readonly<Record<DealStage, string | null>>;
  /** The furthest stage reached, or null before the first meeting. */
  readonly current: DealStage | null;
  /** How the journey ended, when it did. */
  readonly end: { readonly kind: DealEnd; readonly at: string } | null;
  /** The current terms version and the commitment counted, by id. */
  readonly termsId: string | null;
  readonly commitmentId: string | null;
  readonly anomalies: readonly {
    readonly sequence: number;
    readonly eventType: string;
  }[];
};

const DEAL_TYPES: ReadonlySet<string> = new Set([
  RELATIONSHIP_EVENT_MEETING_HELD,
  RELATIONSHIP_EVENT_DILIGENCE_STARTED,
  RELATIONSHIP_EVENT_COMMITMENT_CONFIRMED,
  RELATIONSHIP_EVENT_COMMITMENT_WITHDRAWN,
  RELATIONSHIP_EVENT_COMMITMENT_RECEIVED,
  RELATIONSHIP_EVENT_DEAL_TERMS_RECORDED,
  RELATIONSHIP_EVENT_DEAL_TERMS_SIGNED,
  RELATIONSHIP_EVENT_DEAL_CLOSED,
  RELATIONSHIP_EVENT_RELATIONSHIP_PASSED,
  RELATIONSHIP_EVENT_RELATIONSHIP_RESUMED,
]);

function text(event: ProjectableEvent, key: string): string | null {
  const value = event.payload?.[key];
  return typeof value === "string" ? value : null;
}

export function projectDealStage(
  events: readonly ProjectableEvent[],
): DealStageProjection {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  const seen = new Set<number>();
  const reached: Record<DealStage, string | null> = {
    MET: null,
    DILIGENCE: null,
    SOFT_COMMIT: null,
    TERMS: null,
    SIGNED: null,
    FUNDS_RECEIVED: null,
    CLOSED: null,
  };
  let end: { kind: DealEnd; at: string } | null = null;
  let termsId: string | null = null;
  let commitmentId: string | null = null;
  const anomalies: { sequence: number; eventType: string }[] = [];
  const anomaly = (event: ProjectableEvent) =>
    anomalies.push({ sequence: event.sequence, eventType: event.eventType });
  const reach = (stage: DealStage, event: ProjectableEvent) => {
    reached[stage] ??= event.occurredAt;
  };

  for (const event of ordered) {
    if (seen.has(event.sequence)) continue;
    seen.add(event.sequence);
    if (!DEAL_TYPES.has(event.eventType)) continue;

    if (event.eventType === RELATIONSHIP_EVENT_RELATIONSHIP_RESUMED) {
      // Only an investor resetting a pass reopens the strip.
      if (end?.kind === "PASSED") end = null;
      continue;
    }
    if (end !== null) {
      // The journey ended: a later deal move is a contradiction to surface.
      if (
        event.eventType === RELATIONSHIP_EVENT_DEAL_TERMS_RECORDED ||
        event.eventType === RELATIONSHIP_EVENT_DEAL_TERMS_SIGNED ||
        event.eventType === RELATIONSHIP_EVENT_DEAL_CLOSED
      ) {
        anomaly(event);
      }
      continue;
    }

    switch (event.eventType) {
      case RELATIONSHIP_EVENT_MEETING_HELD:
        reach("MET", event);
        break;
      case RELATIONSHIP_EVENT_DILIGENCE_STARTED:
        reach("DILIGENCE", event);
        break;
      case RELATIONSHIP_EVENT_COMMITMENT_CONFIRMED: {
        const id = text(event, "commitmentId");
        if (id !== null) {
          commitmentId = id;
          reach("SOFT_COMMIT", event);
        }
        break;
      }
      case RELATIONSHIP_EVENT_COMMITMENT_WITHDRAWN: {
        // Money no longer on the table: the soft commit is un-reached
        // unless it already arrived (a receipt is never withdrawn).
        if (
          text(event, "commitmentId") === commitmentId &&
          reached.FUNDS_RECEIVED === null
        ) {
          commitmentId = null;
          reached.SOFT_COMMIT = null;
        }
        break;
      }
      case RELATIONSHIP_EVENT_COMMITMENT_RECEIVED: {
        const id = text(event, "commitmentId");
        if (id !== null) {
          commitmentId = id;
          reach("SOFT_COMMIT", event);
          reach("FUNDS_RECEIVED", event);
        }
        break;
      }
      case RELATIONSHIP_EVENT_DEAL_TERMS_RECORDED: {
        const id = text(event, "termsId");
        if (id === null || reached.SOFT_COMMIT === null) {
          anomaly(event);
          break;
        }
        // A revision after signing unsigns: the new version is unsigned.
        if (termsId !== id) reached.SIGNED = null;
        termsId = id;
        reach("TERMS", event);
        break;
      }
      case RELATIONSHIP_EVENT_DEAL_TERMS_SIGNED: {
        if (reached.TERMS === null || text(event, "termsId") !== termsId) {
          anomaly(event);
          break;
        }
        reach("SIGNED", event);
        break;
      }
      case RELATIONSHIP_EVENT_DEAL_CLOSED: {
        if (reached.SIGNED === null || reached.FUNDS_RECEIVED === null) {
          anomaly(event);
          break;
        }
        reach("CLOSED", event);
        end = { kind: "CLOSED", at: event.occurredAt };
        break;
      }
      case RELATIONSHIP_EVENT_RELATIONSHIP_PASSED:
        end = { kind: "PASSED", at: event.occurredAt };
        break;
    }
  }

  let current: DealStage | null = null;
  for (const stage of DEAL_STAGES) {
    if (reached[stage] !== null) current = stage;
  }
  return {
    version: DEAL_STAGE_VERSION,
    reached,
    current,
    end,
    termsId,
    commitmentId,
    anomalies,
  };
}

/** A move a side may make from here: plain codes, never a score. */
export type DealStep =
  | "START_DILIGENCE"
  | "SOFT_COMMIT"
  | "RECORD_TERMS"
  | "MARK_SIGNED"
  | "SEND_FUNDS"
  | "CONFIRM_FUNDS"
  | "CLOSE"
  | "PASS";

/** States a pass or diligence may start from (relationship-state.v2). */
const LIVE = new Set(["CONNECTED", "MEETING_HELD", "IN_DILIGENCE", "PAUSED"]);

/**
 * What this side may do next, in the order the page offers it. Money steps
 * (SOFT_COMMIT, SEND_FUNDS, CONFIRM_FUNDS) are the existing commitment
 * card's; this only says they are next.
 */
export function dealNextSteps(input: {
  readonly projection: DealStageProjection;
  readonly relationshipState: string;
  readonly side: RelationshipParty;
}): readonly DealStep[] {
  const { projection, relationshipState, side } = input;
  if (projection.end !== null) return [];
  const { reached } = projection;
  const steps: DealStep[] = [];
  const live = LIVE.has(relationshipState) || relationshipState === "INVESTED";
  if (!live) return [];
  if (
    reached.DILIGENCE === null &&
    reached.SOFT_COMMIT === null &&
    (relationshipState === "CONNECTED" || relationshipState === "MEETING_HELD")
  ) {
    steps.push("START_DILIGENCE");
  }
  if (reached.SOFT_COMMIT === null) steps.push("SOFT_COMMIT");
  if (reached.SOFT_COMMIT !== null && reached.SIGNED === null) {
    steps.push("RECORD_TERMS");
  }
  if (reached.TERMS !== null && reached.SIGNED === null) {
    steps.push("MARK_SIGNED");
  }
  if (reached.SOFT_COMMIT !== null && reached.FUNDS_RECEIVED === null) {
    steps.push(side === "INVESTOR" ? "SEND_FUNDS" : "CONFIRM_FUNDS");
  }
  if (reached.SIGNED !== null && reached.FUNDS_RECEIVED !== null) {
    steps.push("CLOSE");
  }
  // Only the investor's side passes, and never once money arrived.
  if (
    side === "INVESTOR" &&
    LIVE.has(relationshipState) &&
    reached.FUNDS_RECEIVED === null
  ) {
    steps.push("PASS");
  }
  return steps;
}

/**
 * The post-close checklists (Visible/Carta practice, research 2026-10-08).
 * Reference codes; a tick is a fact on its own row. Items whose fact the
 * record already holds are pre-ticked by the reader, never stored twice.
 */
export const CLOSE_CHECKLIST: Readonly<
  Record<
    RelationshipParty,
    readonly {
      readonly code: string;
      readonly label: string;
      readonly fromRecord?: "SIGNED" | "FUNDS_RECEIVED";
    }[]
  >
> = {
  COMPANY: [
    {
      code: "SIGNED_DOCS_FILED",
      label: "Signed documents filed",
      fromRecord: "SIGNED",
    },
    {
      code: "FUNDS_COUNTED",
      label: "Funds received and counted in the round",
      fromRecord: "FUNDS_RECEIVED",
    },
    { code: "CAP_TABLE_UPDATED", label: "Cap table updated" },
    { code: "UPDATE_LIST_ADDED", label: "Investor added to your update list" },
    { code: "UPDATE_CADENCE_AGREED", label: "Update cadence agreed" },
    {
      code: "SIDE_LETTER_RIGHTS_NOTED",
      label: "Side-letter rights noted (pro-rata, information)",
    },
  ],
  INVESTOR: [
    {
      code: "SIGNED_DOCS_FILED",
      label: "Signed documents filed",
      fromRecord: "SIGNED",
    },
    {
      code: "FUNDS_SENT_RECONCILED",
      label: "Transfer reconciled",
      fromRecord: "FUNDS_RECEIVED",
    },
    { code: "PORTFOLIO_ENTRY_CONFIRMED", label: "Portfolio entry confirmed" },
    { code: "REPORTING_CADENCE_SET", label: "Reporting cadence set" },
  ],
};

/**
 * The post-close update cadence Q suggests: monthly for the first six
 * months after a close, then quarterly (common seed practice). A
 * suggestion with its reason, never a rule.
 */
export function postCloseCadence(): {
  readonly cadence: "MONTHLY_THEN_QUARTERLY";
  readonly sentence: string;
} {
  return {
    cadence: "MONTHLY_THEN_QUARTERLY",
    sentence:
      "Monthly updates for the first six months, then quarterly: short, with the numbers, the asks and what changed.",
  };
}

/**
 * A respectful note for a pass (research 2026-10-08: pass fast, clearly,
 * with one honest line). Deterministic from the reason code; the investor
 * approves or edits it, and it reaches the founder only if they share it.
 */
const PASS_REASON_LINES: Readonly<Record<string, string>> = {
  STAGE: "it's earlier than our fund invests",
  SECTOR: "it sits outside the sectors our fund covers",
  GEOGRAPHY: "it's outside the markets our fund invests in",
  TRACTION: "we'd want to see more traction before we invest",
  TEAM: "we don't think we're the right partner for the team at this point",
  VALUATION: "we couldn't get comfortable with the valuation",
  BUSINESS_MODEL: "we couldn't get comfortable with the business model yet",
  MARKET: "we weren't able to get conviction on the market",
  TIMING: "the timing isn't right for our fund",
  ROUND: "the round's structure doesn't fit our fund",
};

export function draftPassNote(input: {
  readonly companyName: string;
  readonly reasonCode: string | null;
}): string {
  const reason =
    input.reasonCode === null ? undefined : PASS_REASON_LINES[input.reasonCode];
  const why = reason === undefined ? "" : `: ${reason}`;
  return `Thank you for the time and openness through our conversations about ${input.companyName}. We've decided not to proceed at this stage${why}. We'd be glad to hear how things develop, and we wish you and the team every success.`;
}
