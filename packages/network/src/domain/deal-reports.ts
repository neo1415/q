import { createHash } from "node:crypto";

import type {
  RelationshipReportContent,
  RelationshipReportKind,
} from "@capital-q/contracts";

import { DEAL_STAGES, type DealStageProjection } from "./deal-stage.js";
import type { RelationshipParty } from "./state-projector.js";

/**
 * Reports at every stage (founder, 2026-10-08), compiled deterministically
 * from the relationship's record: no model, no clock beyond the stated
 * generation time, nothing the record does not say. Audit-grade means each
 * row names who recorded it and when, gaps are listed as gaps (unknown
 * stays unknown), and the same record compiles to the same content and the
 * same digest.
 *
 * Visibility is decided before compilation, never after: a shared report
 * is compiled only from facts both sides may read (the caller passes the
 * shared history), and the investor's private memo and pass report only
 * ever reach the investor side (Context Firewall: filter before use).
 */

export const DEAL_REPORT_COMPILER = "deal-report.v1" as const;

export type ReportVisibility =
  "investor_private" | "founder_private" | "relationship_shared";

/** Who may generate each kind, and who sees it. */
export const REPORT_POLICY: Readonly<
  Record<
    RelationshipReportKind,
    {
      readonly sides: readonly RelationshipParty[];
      readonly visibility: ReportVisibility;
      readonly title: string;
    }
  >
> = {
  MEETING_SUMMARY: {
    sides: ["INVESTOR", "COMPANY"],
    visibility: "relationship_shared",
    title: "Meeting summary",
  },
  DILIGENCE: {
    sides: ["INVESTOR", "COMPANY"],
    visibility: "relationship_shared",
    title: "Diligence report",
  },
  INVESTMENT_MEMO: {
    sides: ["INVESTOR"],
    visibility: "investor_private",
    title: "Investment memo",
  },
  CLOSING: {
    sides: ["INVESTOR", "COMPANY"],
    visibility: "relationship_shared",
    title: "Closing report",
  },
  PASS: {
    sides: ["INVESTOR"],
    visibility: "investor_private",
    title: "Pass report",
  },
};

export type ReportRow = {
  readonly label: string;
  readonly value: string;
  readonly source: string;
};

/** Everything a report may say, already filtered to its audience. */
export type ReportFacts = {
  readonly companyName: string;
  readonly investorName: string;
  readonly relationshipState: string;
  readonly generatedAt: string;
  readonly projection: DealStageProjection;
  /** History rows the audience may read, oldest first. */
  readonly history: readonly {
    readonly sequence: number;
    readonly eventType: string;
    readonly occurredAt: string;
    readonly actor: string | null;
  }[];
  readonly meetings: readonly {
    readonly heldAt: string;
    readonly title: string | null;
    readonly summary: string | null;
  }[];
  readonly diligence: {
    readonly requests: readonly {
      readonly title: string;
      readonly askedAt: string;
      readonly askedBy: string | null;
      readonly fulfilledAt: string | null;
      readonly declinedAt: string | null;
    }[];
    readonly questions: readonly {
      readonly question: string;
      readonly askedAt: string;
      readonly askedBy: string | null;
      readonly answer: string | null;
      readonly answeredAt: string | null;
      readonly evidenceStatus: string | null;
    }[];
  };
  readonly commitment: {
    readonly amount: string;
    readonly currencyCode: string;
    readonly level: string;
    readonly status: string;
    readonly statedBy: string | null;
    readonly statedAt: string;
    readonly confirmedBy: string | null;
    readonly confirmedAt: string | null;
    readonly receivedBy: string | null;
    readonly receivedAt: string | null;
    readonly roundName: string | null;
  } | null;
  readonly terms: readonly {
    readonly version: number;
    readonly status: string;
    readonly instrument: string;
    readonly amount: string;
    readonly currencyCode: string;
    readonly valuationCap: string | null;
    readonly valuationBasis: string | null;
    readonly preMoneyValuation: string | null;
    readonly discountPercent: string | null;
    readonly proRata: boolean | null;
    readonly otherTerms: string | null;
    readonly recordedBy: string | null;
    readonly recordedAt: string;
    readonly signedBy: string | null;
    readonly signedAt: string | null;
    readonly signedDocumentId: string | null;
    readonly termsDocumentId: string | null;
  }[];
  readonly close: {
    readonly closedOn: string;
    readonly closedBy: string | null;
    readonly note: string | null;
  } | null;
  /** The investor's own pass record: present only for an investor-private report. */
  readonly pass: {
    readonly passedAt: string;
    readonly reasonLabel: string | null;
    readonly note: string | null;
    readonly sharedWithFounder: boolean;
  } | null;
};

const STAGE_WORDS: Readonly<Record<string, string>> = {
  MET: "Met",
  DILIGENCE: "Diligence",
  SOFT_COMMIT: "Soft commit",
  TERMS: "Terms",
  SIGNED: "Signed",
  FUNDS_RECEIVED: "Funds received",
  CLOSED: "Closed",
};

const EVENT_WORDS: Readonly<Record<string, string>> = {
  interest_expressed: "Interest expressed",
  connection_accepted: "Connected",
  interest_declined: "Interest declined",
  meeting_scheduled: "Meeting scheduled",
  meeting_held: "Meeting held",
  diligence_started: "Diligence started",
  document_requested: "Document requested",
  document_shared: "Document shared",
  data_room_access_requested: "Data-room access requested",
  data_room_access_granted: "Data-room access granted",
  commitment_stated: "Commitment stated",
  commitment_confirmed: "Commitment confirmed by the other side",
  commitment_withdrawn: "Commitment withdrawn",
  commitment_transfer_sent: "Funds marked sent",
  commitment_received: "Funds confirmed received",
  deal_terms_recorded: "Terms recorded",
  deal_terms_signed: "Terms recorded as signed",
  deal_closed: "Investment closed",
  relationship_passed: "Decided not to proceed",
  relationship_paused: "Paused",
  relationship_resumed: "Resumed",
  relationship_progressed: "Meeting outcome recorded",
};

/** Deterministic, UTC: the same record prints the same date anywhere. */
export function reportDate(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return (
    new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(at) + " UTC"
  );
}

/** Exact money as text: the stored decimal, grouped, never through a float. */
export function moneyText(amount: string, currencyCode: string): string {
  const [whole = "0", fraction = ""] = amount.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${currencyCode} ${grouped}.${(fraction + "00").slice(0, 2)}`;
}

const by = (who: string | null, at: string) =>
  `${who ?? "A member of their organisation"} · ${reportDate(at)}`;

const INSTRUMENT_WORDS: Readonly<Record<string, string>> = {
  SAFE: "SAFE",
  CONVERTIBLE_NOTE: "Convertible note",
  PRICED_EQUITY: "Priced equity",
  OTHER: "Other instrument",
};

function stageSection(facts: ReportFacts) {
  const rows: ReportRow[] = DEAL_STAGES.map((stage) => {
    const at = facts.projection.reached[stage];
    return {
      label: STAGE_WORDS[stage] ?? stage,
      value: at === null ? "Not reached" : reportDate(at),
      source: `relationship history · ${facts.projection.version}`,
    };
  });
  if (facts.projection.end?.kind === "PASSED") {
    rows.push({
      label: "Ended",
      value: `Not proceeding · ${reportDate(facts.projection.end.at)}`,
      source: `relationship history · ${facts.projection.version}`,
    });
  }
  return {
    heading: "Where the relationship stands",
    body: `Relationship state: ${facts.relationshipState.toLowerCase().replaceAll("_", " ")}.`,
    rows,
  };
}

function termsRows(facts: ReportFacts): ReportRow[] {
  const current = facts.terms.find((terms) => terms.status !== "SUPERSEDED");
  if (current === undefined) return [];
  const source = by(current.recordedBy, current.recordedAt);
  const rows: ReportRow[] = [
    {
      label: "Instrument",
      value: INSTRUMENT_WORDS[current.instrument] ?? current.instrument,
      source,
    },
    {
      label: "Investment",
      value: moneyText(current.amount, current.currencyCode),
      source,
    },
  ];
  if (current.valuationCap !== null) {
    rows.push({
      label: "Valuation cap",
      value: `${moneyText(current.valuationCap, current.currencyCode)}${
        current.valuationBasis === null
          ? ""
          : ` ${current.valuationBasis === "POST_MONEY" ? "post-money" : "pre-money"}`
      }`,
      source,
    });
  }
  if (current.preMoneyValuation !== null) {
    rows.push({
      label: "Pre-money valuation",
      value: moneyText(current.preMoneyValuation, current.currencyCode),
      source,
    });
  }
  if (current.discountPercent !== null) {
    rows.push({
      label: "Discount",
      value: `${current.discountPercent}%`,
      source,
    });
  }
  if (current.proRata !== null) {
    rows.push({
      label: "Pro-rata right",
      value: current.proRata ? "Yes" : "No",
      source,
    });
  }
  if (current.otherTerms !== null) {
    rows.push({ label: "Other terms", value: current.otherTerms, source });
  }
  rows.push({ label: "Terms version", value: String(current.version), source });
  if (current.signedAt !== null) {
    rows.push({
      label: "Signed",
      value: `Signed copy on file (document ${current.signedDocumentId ?? "unknown"})`,
      source: by(current.signedBy, current.signedAt),
    });
  }
  return rows;
}

function termsGaps(facts: ReportFacts): string[] {
  const current = facts.terms.find((terms) => terms.status !== "SUPERSEDED");
  if (current === undefined) return ["No terms are on record yet."];
  const gaps: string[] = [];
  if (current.valuationCap === null && current.preMoneyValuation === null) {
    gaps.push("No valuation cap or pre-money valuation is on record.");
  }
  if (current.proRata === null) gaps.push("Pro-rata rights are not stated.");
  if (current.termsDocumentId === null) {
    gaps.push("No terms document is attached.");
  }
  return gaps;
}

function commitmentRows(facts: ReportFacts): ReportRow[] {
  const commitment = facts.commitment;
  if (commitment === null) return [];
  const rows: ReportRow[] = [
    {
      label: "Commitment",
      value: `${moneyText(commitment.amount, commitment.currencyCode)} · ${commitment.level.toLowerCase()}`,
      source: by(commitment.statedBy, commitment.statedAt),
    },
  ];
  if (commitment.confirmedAt !== null) {
    rows.push({
      label: "Confirmed by the other side",
      value: reportDate(commitment.confirmedAt),
      source: by(commitment.confirmedBy, commitment.confirmedAt),
    });
  }
  if (commitment.receivedAt !== null) {
    rows.push({
      label: "Funds received",
      value: reportDate(commitment.receivedAt),
      source: by(commitment.receivedBy, commitment.receivedAt),
    });
  }
  if (commitment.roundName !== null) {
    rows.push({
      label: "Counted in round",
      value: commitment.roundName,
      source: "company capital rounds",
    });
  }
  return rows;
}

function historySection(facts: ReportFacts, heading: string) {
  return {
    heading,
    body: "Every recorded step, with who acted and when. Times are UTC.",
    rows: facts.history.map((event) => ({
      label:
        EVENT_WORDS[event.eventType] ?? event.eventType.replaceAll("_", " "),
      value: `#${String(event.sequence)}`,
      source: by(event.actor, event.occurredAt),
    })),
  };
}

const NOTICE: Readonly<Record<ReportVisibility, string>> = {
  relationship_shared:
    "Compiled by Capital Q from the relationship's record, which both sides can read. It states what was recorded and by whom; it is not verified evidence and changes nothing on the record.",
  investor_private:
    "Compiled by Capital Q for your organisation only. It is never shared with the company. It states what was recorded and by whom; it is not verified evidence.",
  founder_private:
    "Compiled by Capital Q for your company only. It states what was recorded and by whom; it is not verified evidence.",
};

/** Compile one report. Pure: the same facts give the same content. */
export function compileReport(
  kind: RelationshipReportKind,
  facts: ReportFacts,
): RelationshipReportContent {
  const policy = REPORT_POLICY[kind];
  const subtitle = `${facts.investorName} and ${facts.companyName} · compiled ${reportDate(facts.generatedAt)}`;
  const sections: RelationshipReportContent["sections"][number][] = [];
  const gaps: string[] = [];

  switch (kind) {
    case "MEETING_SUMMARY": {
      sections.push(stageSection(facts));
      sections.push({
        heading: "Meetings",
        body:
          facts.meetings.length === 0
            ? "No meeting is on record."
            : `${String(facts.meetings.length)} meeting(s) on record.`,
        rows: facts.meetings.map((meeting) => ({
          label: meeting.title ?? "Meeting",
          value: meeting.summary ?? "No summary on record.",
          source: `meeting record · ${reportDate(meeting.heldAt)}`,
        })),
      });
      if (facts.meetings.every((meeting) => meeting.summary === null)) {
        gaps.push(
          "No meeting summary is on record: Q records one when the call is recorded.",
        );
      }
      const outcomes = facts.history.filter((event) =>
        [
          "diligence_started",
          "relationship_progressed",
          "relationship_paused",
          "relationship_passed",
        ].includes(event.eventType),
      );
      sections.push({
        heading: "What the meetings led to",
        body:
          outcomes.length === 0
            ? "No outcome is recorded yet."
            : "Outcomes confirmed by a person.",
        rows: outcomes.map((event) => ({
          label: EVENT_WORDS[event.eventType] ?? event.eventType,
          value: reportDate(event.occurredAt),
          source: by(event.actor, event.occurredAt),
        })),
      });
      break;
    }
    case "DILIGENCE": {
      const { requests, questions } = facts.diligence;
      const openRequests = requests.filter(
        (request) =>
          request.fulfilledAt === null && request.declinedAt === null,
      );
      const openQuestions = questions.filter(
        (question) => question.answer === null,
      );
      sections.push({
        heading: "Summary",
        body: `${String(requests.length)} document request(s), ${String(openRequests.length)} open; ${String(questions.length)} question(s), ${String(openQuestions.length)} unanswered.`,
        rows: [],
      });
      sections.push({
        heading: "Documents asked for",
        body: requests.length === 0 ? "No document was requested." : "",
        rows: requests.map((request) => ({
          label: request.title,
          value:
            request.fulfilledAt !== null
              ? `Shared ${reportDate(request.fulfilledAt)}`
              : request.declinedAt !== null
                ? `Declined ${reportDate(request.declinedAt)}`
                : "Open",
          source: by(request.askedBy, request.askedAt),
        })),
      });
      sections.push({
        heading: "Questions asked and answered",
        body:
          questions.length === 0
            ? "No question was asked on record."
            : "Answers are the company's own claims unless a document supports them.",
        rows: questions.map((question) => ({
          label: question.question,
          value:
            question.answer === null
              ? "Unanswered"
              : `${question.answer} (${(question.evidenceStatus ?? "SELF_REPORTED").toLowerCase().replaceAll("_", " ")})`,
          source: by(question.askedBy, question.answeredAt ?? question.askedAt),
        })),
      });
      for (const request of openRequests)
        gaps.push(`Open request: ${request.title}`);
      for (const question of openQuestions)
        gaps.push(`Unanswered: ${question.question}`);
      break;
    }
    case "INVESTMENT_MEMO": {
      sections.push(stageSection(facts));
      const commitment = commitmentRows(facts);
      sections.push({
        heading: "Commitment",
        body:
          commitment.length === 0
            ? "No commitment is on record."
            : "Money counts only once the other side confirms it, and is raised only once received.",
        rows: commitment,
      });
      const terms = termsRows(facts);
      sections.push({
        heading: "Terms",
        body: terms.length === 0 ? "No terms are on record." : "",
        rows: terms,
      });
      gaps.push(...termsGaps(facts));
      const open =
        facts.diligence.questions.filter((question) => question.answer === null)
          .length +
        facts.diligence.requests.filter(
          (request) =>
            request.fulfilledAt === null && request.declinedAt === null,
        ).length;
      sections.push({
        heading: "Diligence",
        body: `${String(facts.diligence.questions.length)} question(s) and ${String(facts.diligence.requests.length)} document request(s) on record; ${String(open)} still open.`,
        rows: [],
      });
      if (open > 0)
        gaps.push(`${String(open)} diligence item(s) are still open.`);
      break;
    }
    case "CLOSING": {
      sections.push(stageSection(facts));
      sections.push({ heading: "Terms", body: "", rows: termsRows(facts) });
      sections.push({
        heading: "Money",
        body: "Raised means received, as the company confirmed.",
        rows: commitmentRows(facts),
      });
      sections.push({
        heading: "Close",
        body:
          facts.close === null
            ? "Not closed."
            : `Closed on ${facts.close.closedOn}.`,
        rows:
          facts.close === null
            ? []
            : [
                {
                  label: "Closed",
                  value: facts.close.note ?? facts.close.closedOn,
                  source: by(
                    facts.close.closedBy,
                    `${facts.close.closedOn}T00:00:00.000Z`,
                  ),
                },
              ],
      });
      const revisions = facts.terms.filter(
        (terms) => terms.status === "SUPERSEDED",
      );
      if (revisions.length > 0) {
        sections.push({
          heading: "Earlier versions of the terms",
          body: "Kept as history; never edited.",
          rows: revisions.map((terms) => ({
            label: `Version ${String(terms.version)}`,
            value: `${INSTRUMENT_WORDS[terms.instrument] ?? terms.instrument} · ${moneyText(terms.amount, terms.currencyCode)}`,
            source: by(terms.recordedBy, terms.recordedAt),
          })),
        });
      }
      sections.push(historySection(facts, "Approvals and steps, in order"));
      if (facts.close === null) gaps.push("The investment is not closed yet.");
      break;
    }
    case "PASS": {
      sections.push(stageSection(facts));
      const pass = facts.pass;
      sections.push({
        heading: "Decision",
        body:
          pass === null
            ? "No pass is on record."
            : `Decided not to proceed on ${reportDate(pass.passedAt)}.`,
        rows:
          pass === null
            ? []
            : [
                {
                  label: "Reason",
                  value: pass.reasonLabel ?? "Not given",
                  source: `pass record · ${reportDate(pass.passedAt)}`,
                },
                {
                  label: "Note",
                  value: pass.note ?? "None",
                  source: `pass record · ${reportDate(pass.passedAt)}`,
                },
                {
                  label: "Shared with the founder",
                  value: pass.sharedWithFounder
                    ? "Yes"
                    : "No: private to your organisation",
                  source: `pass record · ${reportDate(pass.passedAt)}`,
                },
              ],
      });
      sections.push(historySection(facts, "The relationship, step by step"));
      break;
    }
  }

  return {
    compiler: DEAL_REPORT_COMPILER,
    kind,
    title: `${policy.title}: ${facts.companyName}`,
    subtitle,
    sections,
    gaps,
    notice: NOTICE[policy.visibility],
  };
}

/** Canonical JSON (sorted keys) for the digest: same content, same hash. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function reportDigest(content: RelationshipReportContent): string {
  return createHash("sha256").update(canonical(content)).digest("hex");
}
