import type { QToolFocus } from "@capital-q/q-runtime";

/**
 * What a turn is about, for the tool offer (lead 2026-10-02: the offer was
 * a static list per purpose, 80 of 80 for an own-company question, and
 * every turn paid for every schema). Code decides it from the turn's
 * reading, never the answer's model:
 *
 *   the action the reader named (askedAction / appAction) -> its tool and area
 *   a question, by its kind           -> where such an answer comes from
 *   a research request                 -> Research
 *   a hand (screen, visibility, document, hand-over) -> that hand's area
 *   the run's subjects                 -> their areas (a company: Records)
 *   an answer, a clarification or a correction (often "yes" to Q's own
 *     offer)                           -> the previous turn's focus
 *   small talk, control, noise         -> the core only
 *
 * Nothing found: null, and the purpose's list is offered as before. The
 * reader's own action list is not narrowed, so an action not offered here
 * is still named by the reader and still reached (askedAction, and the
 * argument fallback that runs a declared action directly).
 */

export type FocusReading = {
  readonly kind: string;
  readonly questionKind: string | null;
  /** The declared action named, by tool name (askedAction or appAction). */
  readonly namedTools: readonly string[];
  /** The reader's hand, when it read one (NAVIGATE, SET_VISIBILITY, ...). */
  readonly hand: string | null;
  readonly handOver: boolean;
  /**
   * The reader's research decision for the turn (QResearchDirective mode:
   * EXPLICIT, OFFERED, NONE...). Absent: not read.
   */
  readonly research?: string | null | undefined;
  /** The person's words this turn, for a URL or a domain they named. */
  readonly text?: string | undefined;
};

/**
 * The public-web tools a research turn needs (lead 2026-10-04, run
 * 13955ca2: a RESEARCH_REQUEST read with research EXPLICIT, on an
 * OWN_COMPANY_QUESTION plan of 85 eligible tools, lost all three to the
 * 40-tool bound, and Q said it had no public-web result). Kept the way a
 * named action is kept: they lead the offer, so no bound can cut them.
 * Offering is not authority: the plan's purpose and scopes still decide
 * whether they may execute.
 */
export const RESEARCH_TOOLS: readonly string[] = [
  "extract_public_web",
  "lookup_public_profile",
  "research_public_web",
];

/**
 * EXPLICIT asks for research: the Research area and its tools. OFFERED
 * (most turns) only keeps the tools within reach: they join whatever the
 * turn is focused on, and an unfocused turn already holds them.
 */
const RESEARCH_ASKED = "EXPLICIT";
const RESEARCH_OFFERED = "OFFERED";
/** A question put to Q (the turn reader's kind). */
const QUESTION = "QUESTION_TO_Q";

/**
 * A web address in what they wrote: a scheme, "www.", or a bare domain
 * on a common or country TLD ("zinoaviation.com", "acme.co.uk"). A file
 * name ("deck.pdf") or a version ("v1.5") is not one.
 */
const WEB_ADDRESS =
  /(?:\bhttps?:\/\/|\bwww\.)\S|\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.(?:com|net|org|io|ai|co|app|dev|xyz|tech|vc|capital|ventures|fund|finance|africa|biz|info|uk|ng|za|ke|gh|rw|eg|ma|de|fr|nl|us|ca|in|sg|ae|eu|me|ly|so|to|ie|es|it|au|nz|br|mx)\b(?![.-][a-z0-9])/iu;

/** A request to repeat the last attempt. */
const RETRY =
  /^\s*(?:(?:ok(?:ay)?|please|pls|q)[,\s]+)*(?:try (?:it |that )?again|retry|redo (?:it|that)|do (?:it|that) again|one more time|again)\b/iu;

/** The turn names a web address. */
export function namesWebAddress(text: string): boolean {
  return WEB_ADDRESS.test(text);
}

const QUESTION_AREAS: Readonly<Record<string, readonly string[]>> = {
  ADVICE: ["Research"],
  ABOUT_CAPITAL_Q: ["Research"],
  REAL_WORLD_EXAMPLE: ["Research"],
  PUBLIC_FACTS: ["Research"],
  OPTIONS: ["Records"],
  PROGRESS: ["Records", "Relationships"],
  THEIR_OWN_RECORDS: [
    "Records",
    "Profile",
    "Relationships",
    "Documents",
    "Pitch",
  ],
};

const HAND_AREAS: Readonly<Record<string, string>> = {
  NAVIGATE: "Screens",
  SET_VISIBILITY: "Visibility",
  PREPARE_DOCUMENT: "Documents",
};

const SUBJECT_AREAS: Readonly<Record<string, string>> = {
  COMPANY: "Records",
  INVESTOR_ORGANISATION: "Relationships",
  RELATIONSHIP: "Relationships",
  CAPITAL_OBJECTIVE: "Records",
  DOCUMENT: "Documents",
};

/** Kinds that carry no request of their own: the core is enough. */
const CORE_ONLY = new Set([
  "SMALL_TALK",
  "OFF_TOPIC",
  "UNCLEAR_TRANSCRIPT",
  "CONTROL",
]);
/** Kinds that continue the last turn ("yes, do it"). */
const CONTINUES = new Set(["ANSWER", "CLARIFICATION", "CORRECTION"]);

export function toolFocusOf(input: {
  readonly reading: FocusReading | null;
  readonly subjectKinds: readonly string[];
  /**
   * The turn names someone they have a relationship with, or its subject
   * is a counterparty (lead 2026-10-03, runs 8b5ff536, 5dd9bec5: "Share our
   * financial model with Savanna Seed Partners" and "Ask Ledgerfold for
   * …" were planned on their own company, Records, never Relationships).
   */
  readonly counterparty?: boolean | undefined;
  readonly areaOf: (toolName: string) => string | null;
  readonly previous: QToolFocus | null;
  /**
   * The person is setting up (the onboarding screen, or Q's first minute):
   * Q is working out who they are and what their company or firm is, so
   * the public-web tools stay in reach on every turn with a request
   * (founder live 2026-10-05: onboarding Q said it could not search the
   * internet). Offering is not authority; the plan still decides.
   */
  readonly onboarding?: boolean | undefined;
}): QToolFocus | null {
  const focus = focusOf(input);
  if (
    input.onboarding !== true ||
    input.reading === null ||
    CORE_ONLY.has(input.reading.kind)
  ) {
    return focus;
  }
  if (focus === null) {
    // Nothing else in the reading: the purpose's whole list, as before,
    // with the research tools leading so no bound can cut them.
    return { areas: [], tools: [...RESEARCH_TOOLS], widen: true };
  }
  return {
    ...focus,
    tools: [...new Set([...focus.tools, ...RESEARCH_TOOLS])].sort(),
  };
}

function focusOf(input: {
  readonly reading: FocusReading | null;
  readonly subjectKinds: readonly string[];
  readonly counterparty?: boolean | undefined;
  readonly areaOf: (toolName: string) => string | null;
  readonly previous: QToolFocus | null;
}): QToolFocus | null {
  const { reading } = input;
  if (reading === null) return null;
  // "Try again" is the last turn's request once more, whatever kind it
  // was read as (lead 2026-10-04): its tools are kept.
  if (input.previous !== null && RETRY.test(reading.text ?? "")) {
    return {
      areas: [...new Set(["Screens", ...input.previous.areas])].sort(),
      tools: [...input.previous.tools].sort(),
    };
  }
  if (CORE_ONLY.has(reading.kind)) return { areas: ["Screens"], tools: [] };
  const areas = new Set<string>();
  const tools = new Set<string>();
  for (const tool of reading.namedTools) {
    tools.add(tool);
    const area = input.areaOf(tool);
    if (area !== null) areas.add(area);
  }
  for (const area of QUESTION_AREAS[reading.questionKind ?? ""] ?? []) {
    areas.add(area);
  }
  if (
    reading.kind === "RESEARCH_REQUEST" ||
    reading.research === RESEARCH_ASKED ||
    namesWebAddress(reading.text ?? "")
  ) {
    areas.add("Research");
    for (const tool of RESEARCH_TOOLS) tools.add(tool);
  }
  const handArea = reading.hand === null ? undefined : HAND_AREAS[reading.hand];
  if (handArea !== undefined) areas.add(handArea);
  if (reading.handOver) areas.add("Relationships");
  if (CONTINUES.has(reading.kind) && input.previous !== null) {
    for (const area of input.previous.areas) areas.add(area);
    for (const tool of input.previous.tools) tools.add(tool);
  }
  const subjectAreas = [
    ...input.subjectKinds.flatMap((kind) => {
      const area = SUBJECT_AREAS[kind];
      return area === undefined ? [] : [area];
    }),
    ...(input.counterparty === true ? ["Relationships"] : []),
  ];
  // Nothing in the reading itself: the purpose's list, as before -- and a
  // request to act also brings the declared app actions of what the turn
  // is about (lead 2026-10-03, run d396af2f: "Ask Ledgerfold for their
  // management accounts" named no tool, and diligence_documents was not
  // offered).
  // Any question to Q keeps the web within reach (web search 2026-10-06:
  // "three YC-backed companies that fit my mandate" was read as OPTIONS,
  // focused on Records, and Q answered from what little it held). The
  // tools lead the offer; nothing forces a search.
  const asks = reading.kind === QUESTION;
  if (areas.size === 0 && tools.size === 0) {
    // A question that names nothing keeps the full offer (navigation,
    // page actions and the web alike): narrowing it to the research tools
    // let the bound cut navigation, and Q said it could not scroll
    // (founder 2026-10-06). The gateway keeps the web tool on such turns.
    if (reading.kind !== "TOOL_REQUEST" || subjectAreas.length === 0) {
      return null;
    }
    return {
      areas: [...new Set(subjectAreas)].sort(),
      tools: reading.research === RESEARCH_OFFERED ? [...RESEARCH_TOOLS] : [],
      widen: true,
    };
  }
  for (const area of subjectAreas) areas.add(area);
  if (reading.research === RESEARCH_OFFERED || asks) {
    for (const tool of RESEARCH_TOOLS) tools.add(tool);
  }
  return { areas: [...areas].sort(), tools: [...tools].sort() };
}
