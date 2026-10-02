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
};

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
  readonly areaOf: (toolName: string) => string | null;
  readonly previous: QToolFocus | null;
}): QToolFocus | null {
  const { reading } = input;
  if (reading === null) return null;
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
  if (reading.kind === "RESEARCH_REQUEST") areas.add("Research");
  const handArea = reading.hand === null ? undefined : HAND_AREAS[reading.hand];
  if (handArea !== undefined) areas.add(handArea);
  if (reading.handOver) areas.add("Relationships");
  if (CONTINUES.has(reading.kind) && input.previous !== null) {
    for (const area of input.previous.areas) areas.add(area);
    for (const tool of input.previous.tools) tools.add(tool);
  }
  // Nothing in the reading itself: the purpose's list, as before.
  if (areas.size === 0 && tools.size === 0) return null;
  for (const kind of input.subjectKinds) {
    const area = SUBJECT_AREAS[kind];
    if (area !== undefined) areas.add(area);
  }
  return { areas: [...areas].sort(), tools: [...tools].sort() };
}
