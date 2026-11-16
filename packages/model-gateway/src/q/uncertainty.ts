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
 * The research tool's guidance when the web could not be searched. Code
 * says so itself, in one short line, where it matters to the answer: the
 * answer is told not to say it again (one statement of it, never two), and
 * never to read the absence as "nothing exists".
 */
export const UNAVAILABLE_CODE_SAYS_GUIDANCE =
  "PUBLIC WEB SEARCH UNAVAILABLE: nothing on the public web was looked at this turn. Where it matters to the answer, Capital Q says in one short line that public sources were not read: do not say that yourself. Answer from Capital Q's records and the conversation, saying what they hold and what they don't. Never say or suggest that nothing exists, that nothing was found, or that they have no public presence: it was not checked. Never guess public facts.";

/**
 * When code says what was checked (owner directive 14 Nov 2026, point 4:
 * Q is an analyst, not a compliance workflow). Read from the turn reader's
 * structured reading and the answer's own fields, never from words.
 */
export type CheckedLineNeed = {
  /**
   * The reader read the turn as about the public web or public facts
   * (asksForWeb, a RESEARCH_REQUEST, or a PUBLIC_FACTS question): what
   * was checked is then part of the answer.
   */
  readonly askedPublic: boolean;
  /** The answer's own fields say it could not answer (insufficientEvidence). */
  readonly cannotAnswer: boolean;
  /** The answer's own fields list evidence it lacks (missingEvidence). */
  readonly lacksEvidence: boolean;
  /**
   * The reader read a question about their own records (THEIR_OWN_RECORDS
   * or PROGRESS: their pipeline, relationships, mandate) and not about the
   * web. Live recheck 651a3bd50 T4: "Do I already have Ajopot in my
   * pipeline?" closed with "The public web search was unavailable this
   * turn": the web search ran only because a company was named (records
   * and web in parallel); the answer needed nothing public, so its absence
   * is never said (939ad92d0: said only where it changes how the answer
   * reads).
   */
  readonly recordsQuestion?: true;
};

/**
 * Live gap (production 4d61457fd, investor.savanna-seed): "What was Maji
 * Loop's MRR in October 2026?" was answered "isn't on record" while the
 * turn's public search could not run (every provider resting), and nothing
 * said the public web had not been read. Owner directive 14 Nov 2026
 * (point 4): the line was then added to nearly every answer about another
 * company -- an operational disclosure, not analysis. Where the answer
 * stands on Capital Q's records, the record source labels and public
 * source cards already show what it rests on; the line is said only where
 * it changes how the answer reads:
 *
 * - READ: never (the answer and its source cards say what pages report).
 * - they asked about public sources or public facts: always, so what was
 *   looked at is part of the answer.
 * - UNAVAILABLE: the turn meant to search and could not; said when the
 *   answer lacks evidence or cannot answer, since silence would read as
 *   "nothing public exists" (research absence honesty).
 * - NOT_RUN: said when the answer cannot answer at all, for the same
 *   reason; a records answer that merely notes a gap stands on its own.
 * - NOTHING_FOUND: the search ran, so no absence is implied by not
 *   looking; said only when asked.
 *
 * Built from Capital Q's own records' scope and the tool's status only:
 * nothing of a founder's private record can be in it.
 */
export function checkedLine(input: {
  readonly check: PublicCheck;
  /** Whom the turn is about, as the reader named them; null: unknown. */
  readonly subject: string | null;
  readonly need: CheckedLineNeed;
}): string | null {
  const whom = input.subject === null ? "" : ` on ${input.subject}`;
  const them = input.subject ?? "them";
  const { askedPublic, cannotAnswer, lacksEvidence } = input.need;
  if (input.need.recordsQuestion === true && !askedPublic) return null;
  switch (input.check) {
    case "READ":
      return null;
    case "UNAVAILABLE":
      return askedPublic || cannotAnswer || lacksEvidence
        ? `What I checked: Capital Q's records you can see${whom}. The public web search was unavailable this turn, so anything published about ${them} isn't reflected here.`
        : null;
    case "NOTHING_FOUND":
      return askedPublic
        ? `What I checked: Capital Q's records you can see${whom}, and a public web search, which found no page about ${them}.`
        : null;
    case "NOT_RUN":
      return askedPublic || cannotAnswer
        ? `What I checked: Capital Q's records you can see${whom}. I haven't searched public sources this turn.`
        : null;
  }
}

/**
 * Whether the reader read the turn as about public sources or public
 * facts. Structured fields only (TURN_READER asksForWeb, turn kind,
 * question kind).
 */
export function askedAboutPublic(request: {
  readonly asksForWeb?: boolean | undefined;
  readonly turnKind?: string | undefined;
  readonly questionKind?: string | undefined;
}): boolean {
  return (
    request.asksForWeb === true ||
    request.turnKind === "RESEARCH_REQUEST" ||
    request.questionKind === "PUBLIC_FACTS"
  );
}

/**
 * Owner directive 14 Nov 2026 (point 4): a line code closes answers with
 * (what was checked, the relationship step) is said once in a
 * conversation, not on every answer about the same company. True when one
 * of Q's earlier answers already holds it word for word -- code's own
 * sentence, never the person's words.
 */
export function saidEarlier(
  line: string,
  earlierAnswers: readonly string[],
): boolean {
  const wanted = line.replace(/\s+/gu, " ").trim();
  return (
    wanted.length > 0 &&
    earlierAnswers.some((answer) =>
      answer.replace(/\s+/gu, " ").includes(wanted),
    )
  );
}

/** A public-web noun: where the turn would have looked. */
const PUBLIC_PLACE =
  /\b(?:public(?:ly)?\s+(?:sources?|web|search(?:es)?|information|reports?|pages?)|web\s+search(?:es)?|the\s+(?:public\s+)?web|online\s+sources?|internet)\b/iu;
/** That the public web was not looked at this turn. */
const NOT_LOOKED =
  /\b(?:unavailable|not\s+available|(?:was|were|is|are)n['’]?t\s+(?:read|checked|searched|available|reachable|run)|(?:was|were|is|are)\s+not\s+(?:read|checked|searched|available|reachable|run)|could(?:\s+not|n['’]t)\s+(?:be\s+)?(?:read|checked|searched|reach(?:ed)?|run|access(?:ed)?)|did(?:\s+not|n['’]t)\s+(?:read|check|search|run)|not\s+(?:read|checked|searched)\s+this\s+turn)\b/iu;

/**
 * Live 14 Nov 2026 (run 76234bfc, defect D3): the answer said the public
 * search was unavailable and code's closing line said it again, despite
 * the tool guidance. Q's own drafted answer (never the person's words) is
 * checked, sentence by sentence, for one that already says the public web
 * was not looked at this turn; when one does, code's line is not added, so
 * the absence is said once. The answer's sentence stands as written.
 */
export function answerSaysPublicCheck(answer: string): boolean {
  return answer
    .split(/(?<=[.!?])\s+|\n+/u)
    .some(
      (sentence) => PUBLIC_PLACE.test(sentence) && NOT_LOOKED.test(sentence),
    );
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

/**
 * When the "what was checked" line is needed, from the reader's structured
 * reading and the answer's own fields. Uncertainties alone never call for
 * it: how solid a figure is is said by the answer and its offer path, not
 * by a disclosure of where Q looked.
 */
export function checkedLineNeedOf(
  analyst: unknown,
  request: Parameters<typeof askedAboutPublic>[0],
): CheckedLineNeed {
  const read =
    analyst !== null && typeof analyst === "object"
      ? (analyst as {
          readonly insufficientEvidence?: unknown;
          readonly missingEvidence?: unknown;
        })
      : {};
  return {
    askedPublic: askedAboutPublic(request),
    cannotAnswer: read.insufficientEvidence === true,
    lacksEvidence:
      Array.isArray(read.missingEvidence) && read.missingEvidence.length > 0,
    ...(request.questionKind === "THEIR_OWN_RECORDS" ||
    request.questionKind === "PROGRESS"
      ? { recordsQuestion: true as const }
      : {}),
  };
}

const sameWords = (a: string, b: string): boolean =>
  a.replace(/\s+/gu, " ").trim().toLowerCase() ===
  b.replace(/\s+/gu, " ").trim().toLowerCase();

const normalised = (text: string): string =>
  text
    .replace(/[\s.;:,]+$/u, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();

/**
 * The material uncertainty an offer would resolve: the one its `about`
 * names (exactly, else the one statement holding the other), or the only
 * material one. Null:
 * no material uncertainty backs the offer, so no uncertainty offer stands.
 */
export function materialUncertaintyFor(
  uncertainties: readonly ModelUncertainty[],
  about: string | null,
): ModelUncertainty | null {
  const material = uncertainties.filter((one) => one.material);
  if (about !== null) {
    const exact = material.find((one) => sameWords(one.statement, about));
    if (exact !== undefined) return exact;
    // Defect D5 (live 14 Nov 2026, run 8039bfd5: a material uncertainty
    // and no offer): an `about` restating the item in other words matched
    // nothing exactly, so the offer went as "not material" while a
    // material one stood. One statement holding the other is the same
    // item; failing that, the only material one backs it.
    const wanted = normalised(about);
    const held = material.filter(
      (one) =>
        wanted.length > 0 &&
        (normalised(one.statement).includes(wanted) ||
          wanted.includes(normalised(one.statement))),
    );
    if (held.length === 1) return held[0] ?? null;
  }
  return material.length === 1 ? (material[0] ?? null) : null;
}

const throughFounder = (one: ModelUncertainty): boolean =>
  one.resolveBy.some((way) => THROUGH_FOUNDER.has(way));

const hasMaterial = (uncertainties: readonly ModelUncertainty[]): boolean =>
  uncertainties.some((one) => one.material);

/** The answer's first material, still-open item the founder can settle. */
function firstFounderResolvable(
  uncertainties: readonly ModelUncertainty[],
): ModelUncertainty | null {
  return (
    uncertainties.find(
      (one) =>
        one.material &&
        one.standing !== "INDEPENDENTLY_VERIFIED" &&
        throughFounder(one),
    ) ?? null
  );
}

/**
 * The item an offer to the company would settle (root cause, audit
 * 2026-11-14-uncertainty-offer-root-cause.md): the one its `about` names,
 * else the answer's first material open item settled through the founder.
 * Code's own offer (D5) has always read it this way; the model's offer
 * read "exactly one material item, or an `about` matching one", so an
 * answer listing two material items (definition and period of "active")
 * with `about` null or reworded backed nothing, and the offer passed as a
 * plain message (live 06910b145, run d2da404e).
 */
export function offerBacking(
  uncertainties: readonly ModelUncertainty[],
  about: string | null,
): ModelUncertainty | null {
  return (
    materialUncertaintyFor(uncertainties, about) ??
    firstFounderResolvable(uncertainties)
  );
}

/**
 * Why an offer was held as it was, for the decision log line: which item
 * backs it and what the route was, so a live run says which predicate
 * decided (06910b145 logged only "PASS"). Structured fields only.
 */
export function offerDecisionTrace(input: {
  readonly about: string | null;
  readonly uncertainties: readonly ModelUncertainty[];
  readonly vehicle: VehicleChoice | null;
  readonly standing: RelationshipStanding | undefined;
  readonly subjectKnown: boolean;
}): {
  readonly uncertainties: number;
  readonly material: number;
  readonly backing:
    | "NONE"
    | "NAMED"
    | "FIRST_FOUNDER_RESOLVABLE"
    | "VERIFIED"
    | "NOT_THROUGH_FOUNDER";
  readonly offerAbout: boolean;
  readonly subject: "KNOWN" | "UNKNOWN";
  readonly state: string | null;
  readonly diligenceOpen: boolean | null;
  readonly vehicle: string;
} {
  const named = materialUncertaintyFor(input.uncertainties, input.about);
  const backing = offerBacking(input.uncertainties, input.about);
  const standing = input.standing ?? null;
  return {
    uncertainties: input.uncertainties.length,
    material: input.uncertainties.filter((one) => one.material).length,
    backing:
      backing === null
        ? "NONE"
        : backing.standing === "INDEPENDENTLY_VERIFIED"
          ? "VERIFIED"
          : !throughFounder(backing)
            ? "NOT_THROUGH_FOUNDER"
            : named === null
              ? "FIRST_FOUNDER_RESOLVABLE"
              : "NAMED",
    offerAbout: input.about !== null,
    subject: input.subjectKnown ? "KNOWN" : "UNKNOWN",
    state: standing?.state ?? null,
    diligenceOpen: standing === null ? null : diligenceOpen(standing),
    vehicle:
      input.vehicle === null
        ? "UNKNOWN_COMPANY"
        : input.vehicle.kind === "VEHICLE"
          ? input.vehicle.tool
          : "NONE",
  };
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

/**
 * Live 14 Nov 2026 (run ec736742, Ajopot x Savanna Seed, IN_DILIGENCE): the
 * analyst offered "a focused diligence request" and named propose_email as
 * its tool. An email is not an uncertainty vehicle, so the offer passed
 * untouched, the yes drafted an email, the missing mailbox turned it into a
 * chat message, and `about` never reached a request. A message to the
 * company offered to settle a material uncertainty is that uncertainty's
 * offer: it goes through the route the relationship allows.
 */
export const MESSAGE_TO_COMPANY_TOOLS: ReadonlySet<string> = new Set([
  "propose_email",
  "propose_chat_message",
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
  | {
      readonly kind: "NONE";
      readonly line: string | null;
      /**
       * D11: the clause of `line` that states the relationship stage
       * itself ("Your interest in Kazikit is waiting for them to accept"),
       * from the stage code read; absent when the line names none.
       */
      readonly stage?: string;
    };

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
        stage: `Your interest in ${them} is waiting for them to accept`,
      };
    case "PASSED":
      return {
        kind: "NONE",
        line: `You passed on ${them}, so nothing can be asked of them through Capital Q unless the relationship is resumed.`,
        stage: `You passed on ${them}`,
      };
    case "PAUSED":
      return {
        kind: "NONE",
        line: `Your relationship with ${them} is paused; resume it to send them questions or ask for documents.`,
        stage: `Your relationship with ${them} is paused`,
      };
    default:
      return {
        kind: "NONE",
        line: `To ask ${them} directly, the next step is to express interest; once they accept, you can send questions or ask for documents through Capital Q.`,
        stage: "the next step is to express interest",
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
 * - an offer whose tool is not an uncertainty vehicle passes untouched,
 *   except a message to the company that asks it for information (a
 *   material open item settled through the founder backs it, its `about`
 *   says so, or they asked for the request): re-bound to the vehicle the
 *   stage allows (live runs ec736742, d2da404e), or, before the pair is
 *   connected, not said and the step said instead;
 * - one with no material uncertainty behind it is not said (a minor
 *   uncertainty needs no action offer);
 * - one whose tool is the authorised vehicle stands, carrying `about`;
 * - one naming another vehicle is re-bound to the authorised one, said in
 *   code's own sentence (the model's sentence goes);
 * - with no route, the offer goes and the plain line says the step;
 * - a vehicle offered on a turn whose answer names no uncertainty at all
 *   is an offer of what they asked for: only its route is held (D6).
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
      /** Absent: the answer named no uncertainty (an offer they asked for). */
      readonly about?: UncertaintyAbout | undefined;
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
  /**
   * The turn reader read this turn as asking for one of the vehicles
   * (askedAction): "Yes, please prepare that request to Ajopot" (live
   * c5fbdd3f). A message offered in reply is an offer of what they asked.
   */
  readonly askedVehicle?: boolean | undefined;
}): UncertaintyOfferDecision {
  const vehicleOffer = UNCERTAINTY_VEHICLES.has(input.action);
  if (!vehicleOffer && !MESSAGE_TO_COMPANY_TOOLS.has(input.action)) {
    return { kind: "PASS" };
  }
  if (vehicleOffer && input.uncertainties.length === 0) {
    // Defect D6 (live 14 Nov 2026, runs c5fbdd3f, b6e565fb): asked to
    // prepare the request, Q offered to draft it on a turn whose answer
    // named no uncertainty (the question was the turn before), and an
    // offer with nothing material behind it was not kept, so the yes bound
    // to nothing. With nothing to weigh it is an offer of what they asked
    // for, not an uncertainty offer: only its route is held.
    if (input.vehicle === null) return { kind: "PASS" };
    if (input.vehicle.kind === "NONE") {
      return { kind: "NO_ROUTE", line: input.vehicle.line };
    }
    return input.vehicle.tool === input.action
      ? { kind: "PASS" }
      : {
          kind: "REBIND",
          tool: input.vehicle.tool,
          said: vehicleOfferSentence(input.vehicle.tool, input.company),
        };
  }
  const backing = offerBacking(input.uncertainties, input.about);
  if (!vehicleOffer) {
    // A message offer stays a message unless it is offered to settle a
    // material, still-open uncertainty that goes through the founder and
    // a vehicle the relationship allows can carry: then it is that
    // vehicle's offer, said in code's words, carrying `about`. With no
    // vehicle (or the company unknown) it is still a message, and its own
    // authorize step decides whether it may go.
    //
    // Whether it asks the company for information is read from structure:
    // a material open item settled through the founder backs it; or the
    // offer's own `about` says it resolves one though no material item
    // stands behind it; or they asked for the request itself (askedVehicle).
    // Then code, not the model's tool name, chooses how it goes.
    const seeksInformation =
      backing === null
        ? (input.about !== null && !hasMaterial(input.uncertainties)) ||
          input.askedVehicle === true
        : backing.standing !== "INDEPENDENTLY_VERIFIED" &&
          throughFounder(backing);
    if (!seeksInformation || input.vehicle === null) return { kind: "PASS" };
    if (input.vehicle.kind === "NONE") {
      // Before the pair is connected (or after a pass or pause) nothing can
      // be asked of them; the step is said instead. Connected with no route
      // tool (line null): an ordinary message, its own authorize step decides.
      return input.vehicle.line === null
        ? { kind: "PASS" }
        : { kind: "NO_ROUTE", line: input.vehicle.line };
    }
    return {
      kind: "REBIND",
      tool: input.vehicle.tool,
      said: vehicleOfferSentence(input.vehicle.tool, input.company),
      // Nothing unproven is recorded as what it resolves.
      ...(backing === null
        ? {}
        : {
            about: {
              statement: backing.statement,
              standing: backing.standing,
            },
          }),
    };
  }
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

/** What code's own offer through a vehicle asks of the company. */
function vehicleRequest(
  tool: string,
  company: string | null,
  statement: string,
): string {
  const them = company ?? "the company";
  const what =
    tool === DILIGENCE_DOCUMENTS_TOOL
      ? `Ask ${them} for a document that would settle this`
      : tool === DATA_ROOM_REQUEST_TOOL
        ? `Ask ${them} for the on-request data-room document that would settle this`
        : `Put this question to ${them}`;
  return `${what}: ${statement.replace(/\s+/gu, " ").trim()}`.slice(0, 300);
}

/**
 * Defect D5 (live 14 Nov 2026, run 8039bfd5, Ajopot x Savanna Seed, IN
 * DILIGENCE): the answer named a material uncertainty and what would settle
 * it ("a reconciled six-month cohort table") but closed with no recorded
 * offer -- a question is shown no change-preparing tool, so the model had
 * none to name -- and told them to "ask Ajopot" with nothing a yes could
 * bind to. When the answer's own fields name a material, still-open
 * uncertainty settled through the founder, and the relationship's route is
 * a tool this run may use, code makes that one offer, in its own words,
 * bound to that tool and carrying `about`. Null: nothing material, settled
 * elsewhere, or no route (the step line says so instead). The tool's own
 * authorize step and approval card still decide on the yes.
 */
export function codeUncertaintyOffer(input: {
  readonly uncertainties: readonly ModelUncertainty[];
  readonly vehicle: VehicleChoice | null;
  readonly company: string | null;
}): {
  readonly action: string;
  readonly request: string;
  readonly said: string;
  readonly about: UncertaintyAbout;
} | null {
  if (input.vehicle === null || input.vehicle.kind !== "VEHICLE") return null;
  const backing = firstFounderResolvable(input.uncertainties);
  if (backing === null) return null;
  const tool = input.vehicle.tool;
  return {
    action: tool,
    request: vehicleRequest(tool, input.company, backing.statement),
    said: vehicleOfferSentence(tool, input.company),
    about: { statement: backing.statement, standing: backing.standing },
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
 * D11 (live 15 Nov 2026, run 396ebc21, Kazikit at INTEREST_EXPRESSED, a
 * two-part question): the stage limit code would close with, known before
 * the answer is written -- the line chooseVehicle names even with every
 * vehicle held, so it depends on the relationship's stage alone, never on
 * the run's tools. Null: the stage leaves a route open, or names no step.
 */
export function stageLimitOf(
  standing: RelationshipStanding,
  company: string | null,
): { readonly line: string; readonly stage: string } | null {
  const choice = chooseVehicle({
    standing,
    onRequestTitle: true,
    holds: () => true,
    company,
  });
  return choice.kind === "NONE" &&
    choice.line !== null &&
    choice.stage !== undefined
    ? { line: choice.line, stage: choice.stage }
    : null;
}

/**
 * Trusted, before the answer is written: code closes an answer that leaves
 * a material question only the company could settle with the stage line
 * (stepLineWithoutOffer), so the answer does not state the stage too.
 */
export function stageLimitNote(line: string): string {
  return `WHERE THE RELATIONSHIP STANDS (Capital Q's record; trusted, written by code): if your answer leaves a material open question that only the company could settle (an uncertainty to resolve by asking the founder or requesting a document), Capital Q closes your answer with this line, word for word: "${line.replace(/"/gu, "'")}". Then do not state that stage, or what it stops you doing, yourself: answer the substance and leave the stage to that line.`;
}

/** Words of a stage clause that carry no stage of their own. */
const STAGE_FILLER: ReadonlySet<string> = new Set([
  "your",
  "you",
  "with",
  "them",
  "they",
  "their",
  "the",
  "for",
  "and",
  "next",
]);

/** Content stems (first five letters) of a text, without the company's name. */
function stemsOf(text: string, company: string | null): ReadonlySet<string> {
  const name = new Set(
    (company ?? "")
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 0),
  );
  return new Set(
    [...text.toLowerCase().matchAll(/\p{L}+/gu)]
      .map((match) => match[0])
      .filter(
        (word) => word.length > 2 && !name.has(word) && !STAGE_FILLER.has(word),
      )
      .map((word) => word.slice(0, 5)),
  );
}

/**
 * D11: the sentences of Q's own drafted answer (never the person's words)
 * that restate the stage code closes with: a sentence carrying two content
 * stems of code's stage clause (for INTEREST_EXPRESSED, "interest" and
 * "accept"), compared with the clause built from the stage code read.
 * Code's line says the stage once; those sentences are dropped.
 */
export function stageRestatements(
  answer: string,
  stage: string,
  company: string | null,
): readonly string[] {
  const wanted = stemsOf(stage, company);
  if (wanted.size === 0) return [];
  const needed = Math.min(2, wanted.size);
  return answer
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => {
      if (sentence.length === 0) return false;
      const has = stemsOf(sentence, company);
      return [...wanted].filter((stem) => has.has(stem)).length >= needed;
    });
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
// One code-owned resolution flow (live 14 Nov 2026, D12-D14)
// ---------------------------------------------------------------------------

/**
 * The open item an offer to resolve an uncertainty records, as code keeps
 * it on the conversation (q-runtime QOpenResolution). Structured only.
 */
export type OpenResolutionItem = {
  readonly runId: string;
  readonly action: string;
  readonly counterparty: {
    readonly kind: "COMPANY";
    readonly id: string;
    readonly name: string | null;
  };
  readonly about: { readonly statement: string; readonly standing: string };
  readonly title: string;
};

/** A request heading: short, as a document is named on a checklist (D15b). */
const TITLE_MAX = 80;

/**
 * D15b (live 15 Nov 2026, request 4c9a2968): the request was titled
 * "Evidence that settles: Whether Ajopot's 18,700 active users represent
 * recurring, financially relevant usage is unresolved." -- the uncertainty
 * sentence, naming no document. The title is now document-like: the
 * document the answer itself suggested (its `resolveBy` detail, when it
 * gave one), else "Supporting evidence for <what the item is about>",
 * the item's subject in its own words, else for the company. `about`
 * stays separate, beside it, as the founder's checklist shows it.
 */
export function resolutionTitleOf(
  statement: string,
  company?: string | null,
  suggestedDocument?: string | null,
): string {
  const suggested = (suggestedDocument ?? "").replace(/\s+/gu, " ").trim();
  if (suggested.length >= 3) return capped(sentenceCase(suggested));
  const subject = subjectOf(statement);
  const named = subject.split(" ").length >= 2 && subject.length <= 70;
  return capped(
    `Supporting evidence for ${named ? subject : (company ?? "this question")}`,
  );
}

function sentenceCase(text: string): string {
  const plain = text.replace(/[.\s]+$/u, "");
  return plain.charAt(0).toUpperCase() + plain.slice(1);
}

function capped(title: string): string {
  if (title.length <= TITLE_MAX) return title;
  const cut = title.slice(0, TITLE_MAX - 1);
  const space = cut.lastIndexOf(" ");
  return `${space > 30 ? cut.slice(0, space) : cut}…`;
}

/**
 * What an uncertainty sentence is about, as a noun phrase: "Whether
 * Ajopot's 18,700 active users represent recurring usage is unresolved."
 * is about "Ajopot's 18,700 active users". Structure only (the sentence's
 * own clause shape, never a word list of topics); the whole sentence,
 * trimmed, when it has no such shape.
 */
export function subjectOf(statement: string): string {
  const one = statement.replace(/\s+/gu, " ").trim().replace(/[.]+$/u, "");
  const whether = /^(?:whether|if|how|what|why)\s+(.+)$/iu.exec(one);
  const rest = whether?.[1] ?? one;
  // The subject ends where its verb begins: the first auxiliary or verb
  // form after at least two words ("... users represent ...").
  const words = rest.split(" ");
  const verbAt = words.findIndex(
    (word, at) =>
      at >= 1 &&
      /^(?:is|are|was|were|has|have|had|can|could|will|would|does|do|did|reflects?|represents?|includes?|means?|holds?|covers?|comes?|stands?)$/iu.test(
        word,
      ),
  );
  const subject = (verbAt > 0 ? words.slice(0, verbAt) : words).join(" ");
  // A sentence's opening article reads lower-case mid-title; a name keeps
  // its capital ("Ajopot's active users").
  return /^(?:The|A|An|Its|Their)\s/u.test(subject)
    ? subject.charAt(0).toLowerCase() + subject.slice(1)
    : subject;
}

// ---------------------------------------------------------------------------
// D15 (live 15 Nov 2026): a request already made for the same item
// ---------------------------------------------------------------------------

const ITEM_WORD = /[\p{L}\p{N}][\p{L}\p{N},.'’-]*/gu;

function itemWords(text: string): ReadonlySet<string> {
  return new Set(
    [...text.toLowerCase().matchAll(ITEM_WORD)]
      .map((match) => match[0].replace(/[,.'’-]+$/u, ""))
      .filter((word) => word.length > 3),
  );
}

/**
 * Whether two statements of an open item are the same item: most of their
 * content words are shared (Dice >= 0.5). Both are Capital Q's own stored
 * or computed sentences, compared as data; nothing here reads the
 * person's words.
 */
export function sameItem(a: string, b: string): boolean {
  const left = itemWords(a);
  const right = itemWords(b);
  if (left.size === 0 || right.size === 0) return false;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return (2 * shared) / (left.size + right.size) >= 0.5;
}

/**
 * The request already made for the item an offer would settle: an open or
 * answered diligence request to the same company linked to the same item.
 * A declined one does not hold a new offer back (asking again is theirs).
 */
export function existingRequestFor(
  statement: string,
  followUps: readonly DiligenceFollowUp[],
): DiligenceFollowUp | null {
  const matching = followUps.filter(
    (followUp) =>
      followUp.status !== "DECLINED" &&
      sameItem(followUp.about.statement, statement),
  );
  return matching.at(-1) ?? null;
}

/**
 * Where that request stands, from the request's own record (never from an
 * action receipt): outstanding since the day asked, or answered and with
 * what. Said by code; the answer assesses what came back.
 */
export function requestStateLine(
  company: string,
  followUp: DiligenceFollowUp,
  at: DayReference = {},
): string {
  const asked = spokenDay(followUp.requestedAt, at);
  const since = asked === null ? "" : ` ${asked}`;
  const title = `"${requestHeading(followUp)}"`;
  if (followUp.status === "FULFILLED") {
    const documentTitle = followUp.document?.title ?? null;
    const answered = spokenDay(followUp.fulfilledAt, at);
    return `You asked ${company} for ${title}${since}; they answered${answered === null ? "" : ` ${answered}`} with ${documentTitle === null ? "a document" : quoted(documentTitle, 120)}, so I haven't asked again.`;
  }
  return `You asked ${company} for ${title}${since}, and it's still outstanding, so I haven't asked again.`;
}

/**
 * D19 (live 15 Nov 2026, run 5c9344fd): the request's short, document-like
 * title. Titles written since D15b are at most TITLE_MAX characters; an
 * older request's title was the uncertainty sentence itself (longer than
 * that), so what it is about is said instead, cut at a word.
 */
function requestHeading(followUp: DiligenceFollowUp): string {
  const title = followUp.title.replace(/\s+/gu, " ").trim();
  if (title.length > 0 && title.length <= TITLE_MAX) {
    return title.replace(/"/gu, "'");
  }
  const about = followUp.about.statement.replace(/\s+/gu, " ").trim();
  return wordCut((about.length > 0 ? about : title).replace(/"/gu, "'"), 120);
}

/** When a day is said, and in whose calendar. */
export type DayReference = {
  readonly now?: Date | undefined;
  readonly timeZone?: string | null | undefined;
};

const calendarDay = (instant: Date, timeZone: string): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);

/**
 * D19: a day as a person says it -- "today", "yesterday", else "on 12 Nov"
 * (with the year when it is not this year) -- in their time zone when
 * known, else UTC. Null for a missing or unreadable date.
 */
export function spokenDay(
  iso: string | null,
  at: DayReference = {},
): string | null {
  if (iso === null) return null;
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return null;
  const now = at.now ?? new Date();
  let timeZone = at.timeZone ?? "UTC";
  try {
    calendarDay(now, timeZone);
  } catch {
    timeZone = "UTC";
  }
  const then = calendarDay(instant, timeZone);
  const today = calendarDay(now, timeZone);
  if (then === today) return "today";
  const dayBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (then === calendarDay(dayBefore, timeZone)) return "yesterday";
  const spoken = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    ...(then.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" }),
  }).format(instant);
  return `on ${spoken.replace(/\.$/u, "")}`;
}

/**
 * The item a recorded offer opens (D12): only an offer through a vehicle
 * that carries what it resolves and whom it goes to. Null otherwise.
 */
export function openResolutionOf(
  runId: string,
  offer: {
    readonly action: string;
    readonly about?:
      { readonly statement: string; readonly standing: string } | undefined;
    readonly counterparty?: OpenResolutionItem["counterparty"] | undefined;
  },
): OpenResolutionItem | null {
  if (!UNCERTAINTY_VEHICLES.has(offer.action)) return null;
  if (offer.about === undefined || offer.counterparty === undefined) {
    return null;
  }
  return {
    runId,
    action: offer.action,
    counterparty: offer.counterparty,
    about: offer.about,
    title: resolutionTitleOf(offer.about.statement, offer.counterparty.name),
  };
}

const nameKeyOf = (name: string | null | undefined): string =>
  (name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * Whether a name they or the model used is the item's counterparty: the
 * same name or id, or no name at all (the item is then whom it is about).
 */
export function sameCounterparty(
  item: OpenResolutionItem,
  name: string | null | undefined,
): boolean {
  const wanted = nameKeyOf(name);
  if (wanted.length === 0) return true;
  if (wanted === nameKeyOf(item.counterparty.id)) return true;
  return wanted === nameKeyOf(item.counterparty.name);
}

/**
 * The vehicle's inputs, from the item (D13: "Yes, please request that from
 * Ajopot" left the argument reader nothing to read). Only the diligence
 * request is filled by code; the other vehicles stay with the answer.
 * A title they gave this turn wins over code's suggestion. Null: this
 * vehicle is not one code fills.
 */
export function resolutionArguments(
  item: OpenResolutionItem,
  given?: Readonly<Record<string, unknown>> | null,
): Readonly<Record<string, unknown>> | null {
  if (item.action !== DILIGENCE_DOCUMENTS_TOOL) return null;
  const givenTitle = given?.["title"];
  const givenNote = given?.["note"];
  return {
    operation: "REQUEST",
    relationship: item.counterparty.name ?? item.counterparty.id,
    title:
      typeof givenTitle === "string" && givenTitle.trim().length > 0
        ? givenTitle
        : item.title,
    ...(typeof givenNote === "string" && givenNote.trim().length > 0
      ? { note: givenNote }
      : {}),
    resolves: item.about,
  };
}

/**
 * D14: a diligence request toward the item's counterparty, made without
 * naming what it resolves (an explicit ask, or the model's own call),
 * carries the item's `about`. Any other call is returned unchanged.
 */
export function withOpenResolution(
  call: { readonly name: string; readonly arguments: unknown },
  item: OpenResolutionItem | null | undefined,
): unknown {
  if (item === null || item === undefined) return call.arguments;
  if (call.name !== DILIGENCE_DOCUMENTS_TOOL) return call.arguments;
  const args =
    call.arguments !== null && typeof call.arguments === "object"
      ? (call.arguments as Record<string, unknown>)
      : null;
  if (args === null || args["operation"] !== "REQUEST") return call.arguments;
  if (args["resolves"] !== undefined) return call.arguments;
  const to = args["relationship"];
  if (typeof to === "string" && !sameCounterparty(item, to)) {
    return call.arguments;
  }
  return { ...args, resolves: item.about };
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

/**
 * Text cut at a word, with "…" when anything was cut (D19: a plain slice
 * left "…usage is unresolve").
 */
function wordCut(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  const kept = space > max / 3 ? cut.slice(0, space) : cut;
  return `${kept.replace(/[\s,;:.-]+$/u, "")}…`;
}

const quoted = (text: string, max: number): string =>
  `"${wordCut(text.replace(/\s+/gu, " ").replace(/"/gu, "'").trim(), max)}"`;

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
