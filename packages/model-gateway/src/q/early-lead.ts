import {
  countryWords,
  stageWords,
  type DeclaredProfile,
} from "./named-company-fact.js";

/**
 * Lead 2026-10-16 (live: "summarise my pipeline this month" first text at
 * 6.2 s, "compare Tensorgate and Ledgerfold on traction" at 7.6 s, the
 * whole wait spent on the model's tool round and the start of its
 * answer): an analysis answer opens with one grounded line code can say
 * from what this run already read through its authorised tools -- the
 * person's own relationships, or the named companies' declared profiles --
 * published the moment the model is asked, so the person hears something
 * true at once and the model's analysis follows it.
 *
 * Counts and declared fields only: no judgement, no score, nothing the
 * model would have to take back. Unknown stays unknown. Null when the
 * reads say nothing useful; the answer then starts as before.
 */

const PIPELINE_ASK =
  /\b(?:summar(?:y|i[sz]e)|overview|round[-\s]?up|recap|status|how\s+(?:is|are|'s)|where\s+(?:do|does|am|are)\s+(?:i|we|things)|update\s+(?:me|on))\b[^.?!]*\b(?:pipeline|relationships?|deals?|portfolio|crm|investors?|companies)\b|\b(?:pipeline|relationships?|deals?|portfolio|crm)\b[^.?!]*\b(?:summar(?:y|i[sz]e)|overview|round[-\s]?up|recap|status)\b/iu;
const COMPARE_ASK =
  /\b(?:compare|comparison|versus|vs\.?|side\s+by\s+side)\b/iu;
const THIS_MONTH = /\bthis\s+month\b/iu;
const THIS_WEEK = /\bthis\s+week\b/iu;

const STATE_WORDS: Readonly<Record<string, string>> = {
  DISCOVERED: "discovered",
  INTEREST_EXPRESSED: "interest expressed",
  CONNECTED: "connected",
  MEETING_HELD: "met",
  IN_DILIGENCE: "in diligence",
  PAUSED: "paused",
  PASSED: "passed",
  INVESTED: "invested",
  DECLINED: "not taken forward",
};
/** Furthest along first, as a pipeline is read. */
const STATE_ORDER = [
  "INVESTED",
  "IN_DILIGENCE",
  "MEETING_HELD",
  "CONNECTED",
  "INTEREST_EXPRESSED",
  "DISCOVERED",
  "PAUSED",
  "PASSED",
  "DECLINED",
];

type Row = {
  readonly state?: unknown;
  readonly stateSince?: unknown;
  readonly lastMessage?: { readonly from?: unknown } | null;
};

/** The ask is for a summary of their own pipeline or relationships. */
export function asksForPipelineSummary(text: string): boolean {
  return PIPELINE_ASK.test(text.replace(/[’]/gu, "'"));
}

/** The ask compares named things. */
export function asksForComparison(text: string): boolean {
  return COMPARE_ASK.test(text);
}

const plural = (n: number, one: string, many: string): string =>
  `${String(n)} ${n === 1 ? one : many}`;

/**
 * "You have 7 relationships on Capital Q: 2 in diligence, 3 connected and
 * 2 interest expressed. 2 changed stage this month, and 1 is waiting on
 * your reply." From `list_my_relationships`' own result.
 */
export function pipelineLead(
  data: unknown,
  asked: string,
  now: Date = new Date(),
): string | null {
  if (typeof data !== "object" || data === null) return null;
  const rows = (data as { readonly relationships?: unknown }).relationships;
  if (!Array.isArray(rows)) return null;
  const typed = rows.filter(
    (row): row is Row => typeof row === "object" && row !== null,
  );
  if (typed.length === 0) {
    return "You don't have any relationships on Capital Q yet.";
  }
  const counts = new Map<string, number>();
  for (const row of typed) {
    const state = typeof row.state === "string" ? row.state : "";
    counts.set(state, (counts.get(state) ?? 0) + 1);
  }
  const parts = STATE_ORDER.flatMap((state) => {
    const n = counts.get(state) ?? 0;
    const words = STATE_WORDS[state];
    return n === 0 || words === undefined ? [] : [`${String(n)} ${words}`];
  });
  const listed =
    parts.length <= 1
      ? parts.join("")
      : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1) ?? ""}`;
  const since = THIS_WEEK.test(asked)
    ? { from: new Date(now.getTime() - 7 * 86_400_000), words: "this week" }
    : THIS_MONTH.test(asked)
      ? {
          from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
          words: "this month",
        }
      : null;
  const moved =
    since === null
      ? null
      : typed.filter((row) => {
          const at =
            typeof row.stateSince === "string"
              ? Date.parse(row.stateSince)
              : Number.NaN;
          return Number.isFinite(at) && at >= since.from.getTime();
        }).length;
  const waiting = typed.filter(
    (row) => row.lastMessage?.from === "THEM",
  ).length;
  const tail = [
    moved === null || since === null
      ? null
      : `${moved === 0 ? "None" : String(moved)} changed stage ${since.words}`,
    waiting === 0
      ? null
      : `${String(waiting)} ${waiting === 1 ? "is" : "are"} waiting on your reply`,
  ].filter((part): part is string => part !== null);
  const head = `You have ${plural(typed.length, "relationship", "relationships")} on Capital Q${listed.length === 0 ? "" : `: ${listed}`}.`;
  return tail.length === 0 ? head : `${head} ${tail.join(", and ")}.`;
}

/**
 * Each named company's declared stage and place, before the comparison:
 * "Tensorgate is at the seed stage. … Ledgerfold is based in Lagos, …".
 * Only companies whose authorised profiles this run read.
 */
export function comparisonLead(
  profiles: readonly DeclaredProfile[],
): string | null {
  if (profiles.length < 2) return null;
  const lines = profiles.slice(0, 4).map((profile) => {
    const stage =
      profile.currentStageCode === null
        ? "stage not declared"
        : `${stageWords(profile.currentStageCode)} stage`;
    const where = [
      profile.headquartersCity,
      profile.headquartersCountry === null
        ? null
        : countryWords(profile.headquartersCountry),
    ].filter((part): part is string => part !== null);
    return `${profile.canonicalName}: ${stage}, ${where.length === 0 ? "location not declared" : `based in ${where.join(", ")}`}.`;
  });
  return `${lines.join(" ")} That is what each declares on Capital Q.`;
}

/**
 * The line said as a public-web search starts, when nothing has been said
 * yet: what Q is doing at that moment, in a few words, and true because
 * the call is being made. Streamed to the person, never stored with the
 * answer (by then it would be past).
 */
export function researchLead(subject: string | null): string {
  return subject === null
    ? "I'm checking the public web for that now."
    : `I'm checking what's public on ${subject} now.`;
}
