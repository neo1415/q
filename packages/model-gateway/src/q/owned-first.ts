import type { QToolCallOutcome } from "@capital-q/q-runtime";

/**
 * Speed lane C (production 2026-10-12, run b5eb0a12): "Remember what we
 * discussed about Tensorgate. Has anything changed since our previous
 * assessment?" was read as a question about their own records
 * (research ONLY_IF_EMPTY: Capital Q's authorised context first, the web
 * only if that comes back empty). The model asked for the company search
 * and the public web in the same round; the search found the company in
 * 128 ms and the answer still waited 7.4 s for the web.
 *
 * Under ONLY_IF_EMPTY a public-web call the model makes beside a read of
 * Capital Q's own records now waits for that read, and runs only if every
 * such read came back empty. EXPLICIT, OFFERED and the code's own research
 * hop are untouched; nothing is offered or authorised differently.
 */

/** The public-web tool, by the name the model is offered. */
export const PUBLIC_WEB_TOOL = "research_public_web";

/** What the model is told when its web call was not needed. */
export const OWNED_FIRST_CODE = "OWNED_EVIDENCE_FIRST";
export const OWNED_FIRST_MESSAGE =
  "Not run: Capital Q's own records answered this question in the same step. The public web is searched only when those come back empty or when they ask for current or public sources. Answer from the records you have and say plainly what they do not establish.";

/**
 * Whether a round's web calls wait for its reads of owned evidence: under
 * ONLY_IF_EMPTY, when the round also reads their records, or when an
 * earlier round of the same turn already found something there (else a
 * chained round could ask the web alone, after the records answered).
 */
export function holdsWebForOwned(input: {
  readonly researchMode: string | undefined;
  readonly proposals: readonly {
    readonly name: string;
    readonly classification: string | undefined;
  }[];
  readonly ownedFoundEarlier: boolean;
}): boolean {
  if (input.researchMode !== "ONLY_IF_EMPTY") return false;
  const web = input.proposals.some((call) => call.name === PUBLIC_WEB_TOOL);
  const owned = input.proposals.some(
    (call) =>
      call.name !== PUBLIC_WEB_TOOL && call.classification === "READ_ONLY",
  );
  return web && (owned || input.ownedFoundEarlier);
}

/** Lists a read reports its findings in; all empty means it found nothing. */
const RESULT_LISTS = [
  "items",
  "companies",
  "investors",
  "results",
  "matches",
  "relationships",
  "prospects",
  "documents",
] as const;

/**
 * Reads that look up the turn's subject in Capital Q (by canonical tool
 * name). Reads that list everything they hold (their relationships, their
 * schedule, their approvals, Q's work) come back non-empty whatever was
 * asked, so they never count as the records having answered.
 */
export const OWNED_LOOKUPS: ReadonlySet<string> = new Set([
  "company.search",
  "company.get",
  "discovery.slate",
  "discovery.companies",
  "explore.search_network",
  "relationship.get",
  "records.own.read",
  "people.find",
]);

/**
 * Whether one lookup of their own records returned something to answer
 * from. A failure, a refusal, null, a read that is not a lookup and a
 * lookup whose result lists are all empty found nothing (absence is never
 * evidence either way).
 */
export function ownedReadFound(outcome: QToolCallOutcome): boolean {
  if (outcome.toolName === null || !OWNED_LOOKUPS.has(outcome.toolName)) {
    return false;
  }
  if (outcome.status !== "SUCCEEDED" || !outcome.result.ok) return false;
  const data = outcome.result.data;
  if (data === null || data === undefined) return false;
  if (Array.isArray(data)) return data.length > 0;
  if (typeof data !== "object") return true;
  const record = data as Readonly<Record<string, unknown>>;
  const lists = RESULT_LISTS.filter((key) => Array.isArray(record[key]));
  if (lists.length > 0) {
    return lists.some((key) => (record[key] as readonly unknown[]).length > 0);
  }
  return Object.keys(record).length > 0;
}

/**
 * `work`'s value if it settles within `ms`, else null. A rejection is
 * null. The timer is cleared as soon as either side settles.
 */
export async function settledWithin<T>(
  work: Promise<T | null>,
  ms: number,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), Math.max(0, ms));
  });
  try {
    return await Promise.race([work.catch(() => null), late]);
  } finally {
    clearTimeout(timer);
  }
}
