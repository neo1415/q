/**
 * Coordinator 23 Oct 2026 (live: "Show me my fundraising pipeline" said
 * only "Opening your pipeline…"): a move to their pipeline says what is in
 * it, in one line, from their own relationships as their side may see
 * them ("3 investors: Savanna Seed Partners connected; Zino Aviation and
 * Rift Valley waiting for your reply."), and then opens it. Counts and
 * states only: no judgement. A read that fails says nothing extra.
 */

export type PipelineRow = {
  readonly counterpart: { readonly name: string };
  readonly state: string;
  readonly lastMessage?: { readonly from: "THEM" | "YOU" } | null | undefined;
};

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
  const waiting = rows.filter((row) => row.lastMessage?.from === "THEM");
  const rest = rows.filter((row) => row.lastMessage?.from !== "THEM");
  const groups = STATE_ORDER.flatMap((state) => {
    const here = rest.filter((row) => row.state === state);
    if (here.length === 0) return [];
    const words = STATE_WORDS[state] ?? state.toLowerCase();
    return [
      byName
        ? `${listed(here.map((row) => row.counterpart.name))} ${words}`
        : `${String(here.length)} ${words}`,
    ];
  });
  const unknown = rest.filter((row) => !STATE_ORDER.includes(row.state));
  if (unknown.length > 0) {
    groups.push(
      byName
        ? `${listed(unknown.map((row) => row.counterpart.name))} in progress`
        : `${String(unknown.length)} in progress`,
    );
  }
  const parts = [
    ...groups,
    ...(waiting.length === 0
      ? []
      : [
          byName
            ? `${listed(waiting.map((row) => row.counterpart.name))} waiting for your reply`
            : `${String(waiting.length)} waiting for your reply`,
        ]),
  ];
  return `${String(rows.length)} ${noun(rows.length)}: ${parts.join("; ")}.`;
}
