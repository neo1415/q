import {
  isMatchedRelationshipState,
  UNCERTAINTY_STANDINGS,
} from "@capital-q/contracts";
import {
  ModelUncertaintySchema,
  type ModelUncertainty,
} from "@capital-q/q-core";
import type { DiligenceFollowUp } from "@capital-q/q-tools";

/**
 * Resolving investor uncertainty (owner addendum, 14 Nov 2026; audit slices
 * 0, 3, 4 and 6). Labelling a public claim unverified is never where Q's
 * analysis ends: Q answers first, says what the evidence supports, reasons
 * about materiality, and -- only for a material uncertainty -- offers the
 * one route the relationship actually allows, through the existing actions
 * (Prepare -> Recommend -> Human Approval -> Execute). When evidence comes
 * back, the next answer is told, by code, what was asked and what arrived.
 *
 * Everything here is deterministic and model-free. It reads structured
 * fields only -- the analyst's `uncertainties[]` and offer, the research
 * tool's own status, the relationship tool's own state -- never the prose.
 */

// ---------------------------------------------------------------------------
// Slice 0: what was checked
// ---------------------------------------------------------------------------

/**
 * Where the public web stands for this turn, from the research tool's own
 * output: READ (at least one page about whom it was asked), NOTHING_FOUND
 * (it ran and no page was about them), UNAVAILABLE (it could not run: every
 * provider resting, or over its time budget), NOT_RUN (no public search).
 */
export type PublicCheck = "READ" | "NOTHING_FOUND" | "UNAVAILABLE" | "NOT_RUN";

/** One public-web result the run saw, as its own fields say. */
export type PublicWebSeen = {
  /** The tool call itself succeeded (an outcome, not a page). */
  readonly ok: boolean;
  /** The output's own status: OK, NO_PUBLIC_IDENTITY, PROVIDER_UNAVAILABLE. */
  readonly status: string | null;
  /** Sources about whom it was asked (subjectMatch MATCH or POSSIBLE). */
  readonly about: number;
};

/** The research tool's output, read for its status and matching sources. */
export function publicWebSeenOf(outcome: {
  readonly result:
    { readonly ok: true; readonly data: unknown } | { readonly ok: false };
}): PublicWebSeen {
  if (!outcome.result.ok) return { ok: false, status: null, about: 0 };
  const data = outcome.result.data as {
    readonly status?: unknown;
    readonly sources?: readonly { readonly subjectMatch?: unknown }[];
  } | null;
  const sources: readonly { readonly subjectMatch?: unknown }[] =
    data !== null && Array.isArray(data.sources) ? data.sources : [];
  return {
    ok: true,
    status: typeof data?.status === "string" ? data.status : null,
    about: sources.filter(
      (source) =>
        source.subjectMatch === "MATCH" || source.subjectMatch === "POSSIBLE",
    ).length,
  };
}

export function publicCheckOf(input: {
  readonly seen: readonly PublicWebSeen[];
  /** The turn's web search was dropped over its time budget. */
  readonly dropped: boolean;
}): PublicCheck {
  if (input.seen.some((one) => one.ok && one.about > 0)) return "READ";
  if (
    input.seen.some((one) => one.ok && one.status === "OK") ||
    input.seen.some((one) => one.ok && one.status === "NO_PUBLIC_IDENTITY")
  ) {
    // It ran; nothing about them came back, and no other search read one.
    return "NOTHING_FOUND";
  }
  if (
    input.dropped ||
    input.seen.some((one) => !one.ok || one.status === "PROVIDER_UNAVAILABLE")
  ) {
    return "UNAVAILABLE";
  }
  return "NOT_RUN";
}

/**
 * The research tool's guidance when the web could not be searched and
 * Capital Q says so itself in its closing line: the answer is told not to
 * say it again (one statement of it, never two), and never to read the
 * absence as "nothing exists".
 */
export const UNAVAILABLE_CODE_SAYS_GUIDANCE =
  "PUBLIC WEB SEARCH UNAVAILABLE: nothing on the public web was looked at this turn. Capital Q adds one closing line saying what was checked and that public sources were not read: do not say that yourself. Answer from Capital Q's records and the conversation, saying what they hold and what they don't. Never say or suggest that nothing exists, that nothing was found, or that they have no public presence: it was not checked. Never guess public facts.";

/**
 * Live gap (production 4d61457fd, investor.savanna-seed): "What was Maji
 * Loop's MRR in October 2026?" was answered "isn't on record" while the
 * turn's public search could not run (every provider resting), and nothing
 * said the public web had not been read. On a turn about a named company
 * or person not theirs, code says what was checked: the records Capital Q
 * holds that they may see, and whether public sources were read this turn.
 *
 * - UNAVAILABLE: always said (the turn was meant to search, and did not).
 * - NOTHING_FOUND / NOT_RUN: said only when the answer's own structure
 *   reports something missing or uncertain (insufficientEvidence,
 *   missingEvidence, uncertainties); otherwise the records answered.
 * - READ: nothing added; the answer says what the sources report.
 *
 * Built from Capital Q's own records' scope and the tool's status only:
 * nothing of a founder's private record can be in it.
 */
export function checkedLine(input: {
  readonly check: PublicCheck;
  /** Whom the turn is about, as the reader named them; null: unknown. */
  readonly subject: string | null;
  /** The answer's own fields report a gap (never read from its words). */
  readonly reportsGap: boolean;
}): string | null {
  const whom = input.subject === null ? "" : ` on ${input.subject}`;
  const them = input.subject ?? "them";
  switch (input.check) {
    case "READ":
      return null;
    case "UNAVAILABLE":
      return `What I checked: Capital Q's records you can see${whom}. Public sources weren't read this turn because the web search was unavailable, so anything published about ${them} isn't reflected here; I can look again later.`;
    case "NOTHING_FOUND":
      return input.reportsGap
        ? `What I checked: Capital Q's records you can see${whom}, and a public web search this turn, which found no page about ${them}.`
        : null;
    case "NOT_RUN":
      return input.reportsGap
        ? `What I checked: Capital Q's records you can see${whom}. I didn't search public sources this turn; ask and I'll look.`
        : null;
  }
}

// ---------------------------------------------------------------------------
// Slice 3: the analyst's uncertainties, read as structure
// ---------------------------------------------------------------------------

/**
 * A public reading's standing among the others (decision 92), from the
 * code-derived links between independent publishers (evidence
 * linkResearchReadings, 55d53c7b5): CONTRADICTED when an independent page
 * differs, CORROBORATED when one agrees, REPORTED otherwise. Never
 * INDEPENDENTLY_VERIFIED: agreeing reports are corroboration, not
 * verification, and no page raises a standing past that.
 */
export function publicStandingOf(
  index: number,
  links: readonly {
    readonly kind: "CORROBORATES" | "CONTRADICTS";
    readonly between: readonly [number, number];
  }[],
): "REPORTED" | "CORROBORATED" | "CONTRADICTED" {
  const mine = links.filter(
    (link) => link.between[0] === index || link.between[1] === index,
  );
  if (mine.some((link) => link.kind === "CONTRADICTS")) return "CONTRADICTED";
  if (mine.some((link) => link.kind === "CORROBORATES")) return "CORROBORATED";
  return "REPORTED";
}

/**
 * The analyst's uncertainties, item by item: a malformed one is dropped,
 * never the list. A standing outside the closed list is never accepted
 * (KYB and identity checks are not standings).
 */
export function uncertaintiesOf(analyst: unknown): readonly ModelUncertainty[] {
  const raw =
    analyst !== null && typeof analyst === "object"
      ? (analyst as { readonly uncertainties?: unknown }).uncertainties
      : undefined;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item: unknown) => {
    const parsed = ModelUncertaintySchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Whether the answer's own fields report something missing or uncertain. */
export function reportsGap(analyst: unknown): boolean {
  if (analyst === null || typeof analyst !== "object") return false;
  const read = analyst as {
    readonly insufficientEvidence?: unknown;
    readonly missingEvidence?: unknown;
  };
  return (
    read.insufficientEvidence === true ||
    (Array.isArray(read.missingEvidence) && read.missingEvidence.length > 0) ||
    uncertaintiesOf(analyst).length > 0
  );
}

const sameWords = (a: string, b: string): boolean =>
  a.replace(/\s+/gu, " ").trim().toLowerCase() ===
  b.replace(/\s+/gu, " ").trim().toLowerCase();

/**
 * The material uncertainty an offer would resolve: the one its `about`
 * names exactly, or -- when it names none -- the only material one. Null:
 * no material uncertainty backs the offer, so no uncertainty offer stands.
 */
export function materialUncertaintyFor(
  uncertainties: readonly ModelUncertainty[],
  about: string | null,
): ModelUncertainty | null {
  const material = uncertainties.filter((one) => one.material);
  if (about !== null) {
    return material.find((one) => sameWords(one.statement, about)) ?? null;
  }
  return material.length === 1 ? (material[0] ?? null) : null;
}

// ---------------------------------------------------------------------------
// Slice 4: the vehicle the relationship allows
// ---------------------------------------------------------------------------

export const DILIGENCE_DOCUMENTS_TOOL = "diligence_documents";
export const DATA_ROOM_REQUEST_TOOL = "request_data_room_access";
export const SEND_QUESTIONS_TOOL = "send_questions_to_founder";

/** The existing actions that resolve an uncertainty with the founder. */
export const UNCERTAINTY_VEHICLES: ReadonlySet<string> = new Set([
  DILIGENCE_DOCUMENTS_TOOL,
  DATA_ROOM_REQUEST_TOOL,
  SEND_QUESTIONS_TOOL,
]);

/** The ways of settling an uncertainty that go through the founder. */
const THROUGH_FOUNDER: ReadonlySet<string> = new Set([
  "ASK_FOUNDER",
  "REQUEST_DOCUMENT",
]);

/** Where the person's own side stands with the company, as read. */
export type RelationshipStanding = {
  readonly yourSide: "INVESTOR" | "COMPANY" | null;
  /** The projected state; null: nothing on record they can see. */
  readonly state: string | null;
  readonly milestones: readonly { readonly state: string }[];
} | null;

export type VehicleChoice =
  | { readonly kind: "VEHICLE"; readonly tool: string }
  /** No route: the plain line names the relationship step (null: none). */
  | { readonly kind: "NONE"; readonly line: string | null };

/** Diligence open: started (a milestone) and not passed (the service's rule). */
function diligenceOpen(standing: NonNullable<RelationshipStanding>): boolean {
  return (
    standing.state !== null &&
    standing.state !== "PASSED" &&
    standing.milestones.some((milestone) => milestone.state === "IN_DILIGENCE")
  );
}

/**
 * The authorised vehicle, in the owner's order: a diligence document
 * request while in diligence; a data-room request while connected when an
 * on-request title is in view; questions to the founder while connected;
 * otherwise no offer, and one plain line naming the relationship step.
 * Only the investor's side resolves an investor's uncertainty this way.
 * Each tool still runs its own authorize step at prepare time.
 */
export function chooseVehicle(input: {
  readonly standing: RelationshipStanding;
  /** An on-request data-room title was in view this turn. */
  readonly onRequestTitle: boolean;
  /** The run holds this tool (offered or loadable). */
  readonly holds: (tool: string) => boolean;
  readonly company: string | null;
}): VehicleChoice {
  const standing = input.standing;
  const them = input.company ?? "the company";
  if (standing !== null && standing.yourSide === "COMPANY") {
    return { kind: "NONE", line: null };
  }
  if (standing !== null && diligenceOpen(standing)) {
    if (input.holds(DILIGENCE_DOCUMENTS_TOOL)) {
      return { kind: "VEHICLE", tool: DILIGENCE_DOCUMENTS_TOOL };
    }
  }
  const state = standing?.state ?? null;
  const connected =
    state !== null &&
    isMatchedRelationshipState(state) &&
    state !== "PASSED" &&
    state !== "PAUSED";
  if (connected) {
    if (input.onRequestTitle && input.holds(DATA_ROOM_REQUEST_TOOL)) {
      return { kind: "VEHICLE", tool: DATA_ROOM_REQUEST_TOOL };
    }
    if (input.holds(SEND_QUESTIONS_TOOL)) {
      return { kind: "VEHICLE", tool: SEND_QUESTIONS_TOOL };
    }
    return { kind: "NONE", line: null };
  }
  switch (state ?? "NONE") {
    case "INTEREST_EXPRESSED":
      return {
        kind: "NONE",
        line: `Your interest in ${them} is waiting for them to accept; once they do, you can send them questions or ask for documents through Capital Q.`,
      };
    case "PASSED":
      return {
        kind: "NONE",
        line: `You passed on ${them}, so nothing can be asked of them through Capital Q unless the relationship is resumed.`,
      };
    case "PAUSED":
      return {
        kind: "NONE",
        line: `Your relationship with ${them} is paused; resume it to send them questions or ask for documents.`,
      };
    default:
      return {
        kind: "NONE",
        line: `To ask ${them} directly, the next step is to express interest; once they accept, you can send questions or ask for documents through Capital Q.`,
      };
  }
}

/** Code's own offer sentence for a vehicle the model did not name. */
export function vehicleOfferSentence(
  tool: string,
  company: string | null,
): string {
  const them = company ?? "them";
  switch (tool) {
    case DILIGENCE_DOCUMENTS_TOOL:
      return `Want me to ask ${them} for a document that would settle this? I'll prepare the request for your approval.`;
    case DATA_ROOM_REQUEST_TOOL:
      return `Want me to ask ${them} for the on-request document in their data room? I'll prepare the request for your approval.`;
    default:
      return `Want me to put this question to ${them}? I'll prepare it for your approval.`;
  }
}

/**
 * The analyst's offer, held against the uncertainty it resolves and the
 * relationship's route:
 *
 * - an offer whose tool is not an uncertainty vehicle passes untouched;
 * - one with no material uncertainty behind it is not said (a minor
 *   uncertainty needs no action offer);
 * - one whose tool is the authorised vehicle stands, carrying `about`;
 * - one naming another vehicle is re-bound to the authorised one, said in
 *   code's own sentence (the model's sentence goes);
 * - with no route, the offer goes and the plain line says the step.
 */
export type UncertaintyOfferDecision =
  | { readonly kind: "PASS" }
  | { readonly kind: "DROP"; readonly because: "NOT_MATERIAL" }
  | {
      readonly kind: "KEEP";
      readonly about: UncertaintyAbout;
    }
  | {
      readonly kind: "REBIND";
      readonly tool: string;
      readonly said: string;
      readonly about: UncertaintyAbout;
    }
  | { readonly kind: "NO_ROUTE"; readonly line: string | null };

/** What an offer resolves, as a diligence request will record it. */
export type UncertaintyAbout = {
  readonly statement: string;
  readonly standing: (typeof UNCERTAINTY_STANDINGS)[number];
};

export function decideUncertaintyOffer(input: {
  readonly action: string;
  readonly about: string | null;
  readonly uncertainties: readonly ModelUncertainty[];
  /** The vehicle chosen for the turn's company; null: company unknown. */
  readonly vehicle: VehicleChoice | null;
  readonly company: string | null;
}): UncertaintyOfferDecision {
  if (!UNCERTAINTY_VEHICLES.has(input.action)) return { kind: "PASS" };
  const backing = materialUncertaintyFor(input.uncertainties, input.about);
  // Nothing to resolve: a material uncertainty, still open. An item the
  // answer called independently verified is not asked about again.
  if (backing === null || backing.standing === "INDEPENDENTLY_VERIFIED") {
    return { kind: "DROP", because: "NOT_MATERIAL" };
  }
  const about: UncertaintyAbout = {
    statement: backing.statement,
    standing: backing.standing,
  };
  // The company is not known to code: the tool's own prepare-time check
  // still refuses before any card when the route is not open.
  if (input.vehicle === null) return { kind: "KEEP", about };
  if (input.vehicle.kind === "NONE") {
    return { kind: "NO_ROUTE", line: input.vehicle.line };
  }
  return input.vehicle.tool === input.action
    ? { kind: "KEEP", about }
    : {
        kind: "REBIND",
        tool: input.vehicle.tool,
        said: vehicleOfferSentence(input.vehicle.tool, input.company),
        about,
      };
}

/**
 * With no offer made, the line that names the relationship step when a
 * material uncertainty could be settled only through the founder and the
 * relationship allows no route yet. Null otherwise: a route exists (the
 * answer chose not to offer it) or nothing material goes through them.
 */
export function stepLineWithoutOffer(input: {
  readonly uncertainties: readonly ModelUncertainty[];
  readonly vehicle: VehicleChoice | null;
}): string | null {
  if (input.vehicle === null || input.vehicle.kind !== "NONE") return null;
  const throughFounder = input.uncertainties.some(
    (one) =>
      one.material && one.resolveBy.some((way) => THROUGH_FOUNDER.has(way)),
  );
  return throughFounder ? input.vehicle.line : null;
}

/**
 * On a yes to an uncertainty offer: the vehicle's call carries what it
 * resolves, from the offer's record (never from the model's words). A call
 * that already names one keeps it; only the three vehicles carry it.
 */
export function withResolves(
  call: { readonly name: string; readonly arguments: unknown },
  about: UncertaintyAbout | null | undefined,
): unknown {
  if (about === null || about === undefined) return call.arguments;
  if (
    call.name !== DILIGENCE_DOCUMENTS_TOOL &&
    call.name !== SEND_QUESTIONS_TOOL
  ) {
    return call.arguments;
  }
  const args =
    call.arguments !== null && typeof call.arguments === "object"
      ? (call.arguments as Record<string, unknown>)
      : null;
  if (args === null || args["resolves"] !== undefined) return call.arguments;
  if (
    call.name === DILIGENCE_DOCUMENTS_TOOL &&
    args["operation"] !== "REQUEST"
  ) {
    return call.arguments;
  }
  return { ...args, resolves: about };
}

// ---------------------------------------------------------------------------
// Slice 6: the re-assessment note
// ---------------------------------------------------------------------------

const day = (iso: string | null): string | null =>
  iso === null ? null : (/^\d{4}-\d{2}-\d{2}/u.exec(iso)?.[0] ?? null);

const STANDING_WORDS: Readonly<Record<string, string>> = {
  REPORTED: "reported by a source",
  CORROBORATED: "corroborated by independent sources, not verified",
  CONTRADICTED: "contradicted between sources or records",
  FOUNDER_CONFIRMED: "confirmed by the founder, not independently verified",
  DOCUMENT_SUPPORTED: "supported by a document",
  INDEPENDENTLY_VERIFIED: "independently verified",
};

const EVIDENCE_WORDS: Readonly<Record<string, string>> = {
  SELF_REPORTED: "self-reported",
  DOCUMENT_SUPPORTED: "document-supported",
};

const quoted = (text: string, max: number): string =>
  `"${text.replace(/\s+/gu, " ").replace(/"/gu, "'").trim().slice(0, max)}"`;

/** What came back for one linked request, in code's words. */
function cameBack(followUp: DiligenceFollowUp, company: string): string {
  const parts: string[] = [];
  if (followUp.status === "FULFILLED") {
    const documentTitle = followUp.document?.title ?? null;
    const documentSummary = followUp.document?.summary ?? null;
    const title =
      documentTitle === null ? "a document" : quoted(documentTitle, 120);
    const when = day(followUp.fulfilledAt);
    const summary =
      documentSummary === null
        ? " Q has not read it yet, so it supports nothing yet."
        : ` Q's own summary of it (Q's reading, not fact): ${quoted(documentSummary, 300)}.`;
    parts.push(
      `${company} shared ${title}${when === null ? "" : ` on ${when}`}.${summary}`,
    );
  }
  if (followUp.answers.length > 0) {
    const statuses = [
      ...new Set(
        followUp.answers.map(
          (answer) =>
            EVIDENCE_WORDS[answer.evidenceStatus] ?? answer.evidenceStatus,
        ),
      ),
    ].join(" and ");
    const latest = day(
      followUp.answers
        .map((answer) => answer.answeredAt)
        .toSorted()
        .at(-1) ?? null,
    );
    parts.push(
      `the founder answered ${String(followUp.answers.length)} question(s)${latest === null ? "" : `, latest on ${latest}`} (the founder's claim, ${statuses}).`,
    );
  }
  if (followUp.status === "DECLINED") {
    parts.push(
      `${company} declined it${followUp.declineNote === null ? "" : `: ${quoted(followUp.declineNote, 200)}`}.`,
    );
  }
  return parts.length === 0
    ? "still open: nothing has come back."
    : parts.join(" ");
}

/**
 * Addendum 14 Nov 2026 (slice 6): on the investor's turn about a company
 * with diligence requests linked to an uncertainty, Capital Q tells the
 * answer -- as its own record, not the person's words -- what was asked,
 * the standing then, and what came back. The answer says what changed,
 * what is resolved and what is still open, and never upgrades anything to
 * verified: a shared document or the founder's answer can support or
 * confirm, never verify. Null when no request names an uncertainty.
 */
export function reassessmentNote(input: {
  readonly company: string;
  readonly followUps: readonly DiligenceFollowUp[];
}): string | null {
  if (input.followUps.length === 0) return null;
  const lines = input.followUps.slice(-8).map((followUp) => {
    const asked = day(followUp.requestedAt);
    const standing =
      followUp.about.standing === null
        ? ""
        : ` (then ${STANDING_WORDS[followUp.about.standing] ?? followUp.about.standing})`;
    return `- They asked for ${quoted(followUp.title, 120)}${asked === null ? "" : ` on ${asked}`} to resolve ${quoted(followUp.about.statement, 240)}${standing}. Now: ${cameBack(followUp, input.company)}`;
  });
  return [
    `SINCE THEY ASKED (Capital Q's record of their diligence requests to ${input.company}, each linked to an open question about it; trusted, written by code):`,
    ...lines,
    "In your answer, say plainly what changed, what is now resolved and what is still open, item by item, from this record and what you can read. A shared document can make an item document-supported only once its content shows it; the founder's answer makes it founder-confirmed at most. Never call anything verified or independently verified on this basis, and never say a document shows something its summary does not.",
  ].join("\n");
}
