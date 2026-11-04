/**
 * Coordinator 23 Oct 2026 (live: "Show me my fundraising pipeline" said
 * only "Opening your pipeline…"): a move to their pipeline says what is in
 * it, in one line, from their own relationships as their side may see
 * them ("3 investors: Savanna Seed Partners and Rift Valley connected;
 * Zino Aviation awaiting reply."), and then opens it. Counts and
 * states only: no judgement. A read that fails says nothing extra.
 */

export type PipelineRow = {
  readonly counterpart: { readonly name: string };
  readonly state: string;
  readonly lastMessage?: { readonly from: "THEM" | "YOU" } | null | undefined;
};

/**
 * The Relationships page's own words for each state (its chips and stage
 * strip), so Q's line and the page read the same (acceptance 4 Nov 2026:
 * Q said "3 interest expressed", the page "Awaiting reply 3").
 */
const STATE_WORDS: Readonly<Record<string, string>> = {
  DISCOVERED: "discovered",
  INTEREST_EXPRESSED: "awaiting reply",
  CONNECTED: "connected",
  MEETING_HELD: "met",
  IN_DILIGENCE: "in diligence",
  PAUSED: "paused",
  PASSED: "not proceeding for now",
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
const NAMES_MAX = 6;

function listed(names: readonly string[]): string {
  return names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

export function pipelineSummaryLine(
  side: "INVESTOR" | "COMPANY",
  rows: readonly PipelineRow[],
): string {
  const noun = (n: number) =>
    side === "COMPANY"
      ? n === 1
        ? "investor"
        : "investors"
      : n === 1
        ? "company"
        : "companies";
  if (rows.length === 0) {
    return side === "COMPANY"
      ? "No investors in your pipeline yet."
      : "No companies in your pipeline yet.";
  }
  const byName = rows.length <= NAMES_MAX;
  // Every row counts once, in its own state, exactly as the page's chips
  // count them (acceptance 4 Nov 2026: Q said "7 connected; 1 waiting for
  // your reply", the page "Connected 8 · Needs you 2"). Q used to take rows
  // whose last message was theirs out of their state; that is a different
  // measure from the page's "Needs you" (the person's own next steps), so
  // the line leaves it to the page rather than give a second, clashing count.
  const parts = STATE_ORDER.flatMap((state) => {
    const here = rows.filter((row) => row.state === state);
    if (here.length === 0) return [];
    const words = STATE_WORDS[state] ?? state.toLowerCase();
    return [
      byName
        ? `${listed(here.map((row) => row.counterpart.name))} ${words}`
        : `${String(here.length)} ${words}`,
    ];
  });
  const unknown = rows.filter((row) => !STATE_ORDER.includes(row.state));
  if (unknown.length > 0) {
    parts.push(
      byName
        ? `${listed(unknown.map((row) => row.counterpart.name))} in progress`
        : `${String(unknown.length)} in progress`,
    );
  }
  return `${String(rows.length)} ${noun(rows.length)}: ${parts.join("; ")}.`;
}
