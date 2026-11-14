import {
  GATEQ_SYNTHESIS_TEXT_MAX,
  GateqDossierSchema,
  type ApplicationTranscriptTurnDto,
  type GateqDossier,
  gateqStatementsInWords,
  type GateqSynthesisPointV2,
  type GateqSynthesisV2,
} from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  GateqDossierSynthesisResultV2Schema,
  renderPrompt,
  type GateqDossierSynthesisResultV2,
  type PromptRegistry,
} from "@capital-q/q-core";

import { withDerivedAmountsMarked } from "./dossier.js";

/**
 * Q's reading of a submitted GateQ application (lead decision 2026-10-15).
 *
 * Runs AFTER submission, outside its transaction, as a job of the API: a
 * sweep claims one submission at a time, asks the Model Gateway on the
 * EVIDENCE_SYNTHESIS task class, validates the answer and records it once.
 *
 * Context boundary (the Context Firewall's rule, applied before the model
 * is called): the only input is what the receiving organisation was sent,
 * the frozen dossier and the frozen transcript of THIS submission. No live
 * application facts, no company profile, no other application, and no
 * contact details (the founder's email and phone are not needed to read
 * the evidence, so they never reach a model). The q-firewall package has
 * no scope for a background job over a submission yet; this projection is
 * that boundary until it does (flagged for an ADR, not redesigned here).
 *
 * Output discipline: every point must cite a fact id or transcript turn
 * that the call was shown; anything uncited is dropped and counted. The
 * whole reading is Q_INFERENCE and carries no score, rank or decision.
 *
 * Completeness (owner decision 97, 2026-11-14): no count ceiling and no
 * silent loss. v1 kept nine points and read the first 14,000 characters of
 * the transcript, so the latest turns -- often the founder's corrections --
 * were never read. Now every fact is read; turns are chosen facts' own
 * turns first, then the most recent, then older ones; turns that do not
 * fit are read in further parts; an answer that runs out of room is
 * continued. What could not be read or written within the reading's call
 * budget is recorded on the reading (`complete`, `incomplete`, `coverage`).
 */

export const GATEQ_SYNTHESIS_PROMPT_VERSION = "GATEQ_DOSSIER_SYNTHESIS@v2";

/**
 * Model calls one application may ever cost. After the last one fails the
 * investor is told plainly that Q's reading could not be made, rather than
 * "not ready yet" forever. The store and the inbox read the same number.
 */
export const GATEQ_SYNTHESIS_MAX_ATTEMPTS_DEFAULT = 3;
export const GATEQ_SYNTHESIS_MAX_ATTEMPTS_CAP = 3;

/** CQ_GATEQ_SYNTHESIS_MAX_ATTEMPTS, bounded to 1..3; anything else is 3. */
export function gateqSynthesisMaxAttempts(raw: string | undefined): number {
  const value = Number(raw);
  return Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= GATEQ_SYNTHESIS_MAX_ATTEMPTS_CAP
    ? value
    : GATEQ_SYNTHESIS_MAX_ATTEMPTS_DEFAULT;
}

/**
 * Seconds a failed attempt waits before the next: the base, doubled for each
 * attempt already spent (10 min, then 20 min by default), so a provider
 * outage is not hammered and a transient fault still recovers the same hour.
 */
export function gateqSynthesisRetryDelaySeconds(
  attemptsSpent: number,
  baseSeconds: number,
): number {
  const spent = Math.max(1, Math.min(6, Math.trunc(attemptsSpent)));
  return Math.max(60, baseSeconds) * 2 ** (spent - 1);
}

export type PendingSynthesis = {
  readonly applicationId: string;
  readonly tenantId: string;
  readonly investorName: string;
  readonly dossier: unknown;
  readonly transcript: readonly ApplicationTranscriptTurnDto[];
};

export type SynthesisStore = {
  /** Submissions without a reading (or with a retryable failure), oldest first. */
  readonly pending: (limit: number) => Promise<readonly PendingSynthesis[]>;
  /**
   * Record an attempt BEFORE the model is called (as FAILED, attempts+1),
   * so a crash mid-call counts as a failure and two replicas never both
   * pay for the same reading. False: another attempt holds it or the
   * attempts are spent.
   */
  readonly claim: (input: {
    readonly applicationId: string;
    readonly tenantId: string;
  }) => Promise<boolean>;
  readonly ready: (input: {
    readonly applicationId: string;
    readonly synthesis: GateqSynthesisV2;
    readonly promptVersion: string;
  }) => Promise<void>;
};

/**
 * Technical budgets, never limits on what is kept: characters of findings
 * and of transcript one call is shown, and calls one reading may make
 * (parts plus continuations). Whatever they leave unread or unwritten is
 * recorded on the reading as incomplete.
 */
export type SynthesisBudgets = {
  readonly findingsChars: number;
  readonly transcriptChars: number;
  readonly calls: number;
};
export const GATEQ_SYNTHESIS_BUDGETS: SynthesisBudgets = {
  findingsChars: 32_000,
  transcriptChars: 32_000,
  calls: 8,
};

/**
 * What a published criterion is about, from its label, and the recorded
 * application facts it is checked against (the gate's criterion types:
 * geography, stage, sector classifications and exclusions, raise size and
 * cheque compatibility).
 */
const CRITERION_TOPICS: readonly (readonly [RegExp, readonly string[]])[] = [
  [
    /\b(based|locat\w*|countr\w*|geograph\w*|region\w*|headquarter\w*|hq)\b/iu,
    ["company.country"],
  ],
  [/\bstages?\b/iu, ["company.stage"]],
  [
    /\b(sectors?|industr\w*|verticals?|exclu\w*)\b/iu,
    ["company.sector_phrases"],
  ],
  [/\b(cheques?|checks?|tickets?|round|raise\w*)\b/iu, ["raise.amount"]],
];

type FactLine = {
  /** What a point resting on this line cites (two for a disagreement). */
  readonly ids: readonly string[];
  readonly turnSeqs: readonly number[];
  readonly line: string;
};

/**
 * Slice 3: a v2 dossier's findings from its statement view, through the
 * one shared formatter: every current statement by id with its source and
 * disagreement state, then each disagreement with both values and their
 * sources, then what was corrected away, as history. Every id is citable.
 */
function statementLines(dossier: GateqDossier): FactLine[] | null {
  if (dossier.schemaVersion !== "gateq-dossier.v2") return null;
  const groupLabel = new Map(
    dossier.dimensions.map((group) => [group.group as string, group.label]),
  );
  const finding = new Map(
    dossier.dimensions.flatMap((group) =>
      group.facts.map((fact) => [fact.statementId, fact] as const),
    ),
  );
  const lines = gateqStatementsInWords(dossier.statements);
  const seqs = (line: (typeof lines)[number]) =>
    line.sourceTurnSeqs.flatMap((seq) => (seq === null ? [] : [seq]));
  const where = (line: (typeof lines)[number]) =>
    `${line.group === null ? "" : `${groupLabel.get(line.group) ?? line.group} / `}${line.label}`;
  const ordered = [
    ...lines.filter((line) => line.kind === "STATEMENT"),
    ...lines.filter((line) => line.kind === "DISAGREEMENT"),
    ...lines.filter((line) => line.kind === "HISTORY"),
  ];
  return ordered.map((line) => {
    const turns = seqs(line).join(",") || "form";
    const source = line.sourceKinds.join("+");
    const state = line.disagreementState ?? "none";
    if (line.kind === "STATEMENT") {
      const id = line.statementIds[0] ?? "";
      const fact = finding.get(id);
      const axes =
        fact === undefined
          ? "truth=UNKNOWN; evidence=NO_EVIDENCE"
          : `truth=${fact.truthClass}; evidence=${fact.evidenceStatus}`;
      return {
        ids: [id],
        turnSeqs: seqs(line),
        line: `sourceFactId=${id} | ${where(line)}: ${line.summaries[0] ?? ""} [source=${source}; disagreement=${state}; ${axes}; turn=${turns}]${fact?.derivation === undefined ? "" : ` (${fact.derivation})`}`,
      };
    }
    if (line.kind === "DISAGREEMENT")
      return {
        ids: [...line.statementIds],
        turnSeqs: seqs(line),
        line: `sourceFactId=${line.statementIds.join(" and sourceFactId=")} | ${where(line)}: the founder's answers disagree [source=${source}; disagreement=${state}; turn=${turns}]: ${line.text}`,
      };
    return {
      ids: [...line.statementIds],
      turnSeqs: seqs(line),
      line: `sourceFactId=${line.statementIds[0] ?? ""} | ${where(line)} (earlier, superseded; history only): ${line.summaries[0] ?? ""} [source=${source}; disagreement=none; turn=${turns}]`,
    };
  });
}

/** Every frozen fact as a line with its id, then code's summary lines. */
function findingLines(input: {
  readonly dossier: GateqDossier;
  readonly transcript: readonly ApplicationTranscriptTurnDto[];
}): { readonly facts: readonly FactLine[]; readonly summary: string[] } {
  const dossier = withDerivedAmountsMarked(input.dossier, input.transcript);
  const facts: FactLine[] = statementLines(dossier) ?? [];
  for (const group of dossier.schemaVersion === "gateq-dossier.v2"
    ? []
    : dossier.dimensions) {
    for (const fact of group.facts) {
      facts.push({
        ids: [fact.sourceFactId],
        turnSeqs: fact.sourceTurnSeq === null ? [] : [fact.sourceTurnSeq],
        line: `sourceFactId=${fact.sourceFactId} | ${group.label} / ${fact.label}: ${fact.summary} [truth=${fact.truthClass}; evidence=${fact.evidenceStatus}; turn=${fact.sourceTurnSeq ?? "form"}]${fact.derivation === undefined ? "" : ` (${fact.derivation})`}`,
      });
    }
  }
  // Each criterion names the recorded fact it reads (live check 2026-10-16:
  // with bare labels, a location mismatch was cited to the stage, sector
  // and raise facts). The frozen dossier keeps only the investor's label,
  // so the topic is read from it; a label naming no topic cites nothing.
  // Every finding on the dimension: two answers in disagreement are both
  // what the rule was checked against (decision 91).
  const factOf = new Map<string, string[]>();
  for (const group of dossier.dimensions)
    for (const fact of group.facts)
      factOf.set(fact.dimension, [
        ...(factOf.get(fact.dimension) ?? []),
        fact.sourceFactId,
      ]);
  const checked = (label: string): string => {
    const ids = CRITERION_TOPICS.filter(([pattern]) => pattern.test(label))
      .flatMap(([, dimensions]) => dimensions)
      .flatMap((dimension) => factOf.get(dimension) ?? []);
    return ids.length === 0
      ? ""
      : ` (checked against sourceFactId=${[...new Set(ids)].join(", sourceFactId=")})`;
  };
  const summary = [
    `Published mandate check (not an investment decision): ${dossier.qualification.criteria.map((c) => `${c.label} ${c.status}${checked(c.label)}`).join("; ") || "no rules"}.`,
    `Unknown: ${dossier.unknowns.map((g) => g.label).join("; ") || "none"}.`,
    `Declined: ${dossier.declined.map((g) => g.label).join("; ") || "none"}.`,
    `Missing: ${dossier.missing.map((g) => g.label).join("; ") || "none"}.`,
    `Contradictions: ${dossier.contradictions.join("; ") || "none recorded"}.`,
  ];
  return { facts, summary };
}

/** One call's view of the submission. */
export type SynthesisPart = {
  readonly findings: string;
  readonly transcript: string;
  /** Code's own words on which turns this call is shown and which not. */
  readonly coverage: string;
  /** What a point from this call may cite. */
  readonly factIds: ReadonlySet<string>;
  readonly turnSeqs: ReadonlySet<number>;
};

const turnLine = (turn: ApplicationTranscriptTurnDto): string =>
  `turn ${String(turn.seq)} ${turn.role}: ${turn.text}`;

/** "1-3, 6, 9-12": the seqs as ranges, for the coverage words. */
function ranges(seqs: readonly number[]): string {
  const sorted = [...seqs].sort((a, b) => a - b);
  const out: string[] = [];
  let start = sorted[0];
  let prev = start;
  for (const seq of [...sorted.slice(1), Number.NaN]) {
    if (start === undefined || prev === undefined) break;
    if (seq === prev + 1) {
      prev = seq;
      continue;
    }
    out.push(
      start === prev ? String(start) : `${String(start)}-${String(prev)}`,
    );
    start = seq;
    prev = seq;
  }
  const text = out.join(", ");
  return text.length > 600 ? `${text.slice(0, 599)}…` : text;
}

function coverageWords(
  total: number,
  shown: readonly number[],
  laterPart: boolean,
): string {
  if (total === 0)
    return "There is no interview transcript; only the findings.";
  if (shown.length === total)
    return `The interview has ${String(total)} turns; all of them are shown.`;
  const notShown = total - shown.length;
  return `The interview has ${String(total)} turns. This part of the reading shows ${String(shown.length)}: turns ${ranges(shown) || "none"}. ${String(notShown)} turns are NOT shown here${laterPart ? "" : " (another part of this reading reads them)"}; FINDINGS hold the founder's recorded answers, corrections included.`;
}

/**
 * Turns for one call, in the order they are worth reading: the turns the
 * given facts were heard in (and the question just before each), then the
 * most recent, then older ones, while they fit. Shown in time order.
 */
function chooseTurns(
  turns: readonly ApplicationTranscriptTurnDto[],
  citedSeqs: readonly number[],
  budget: number,
): readonly ApplicationTranscriptTurnDto[] {
  const bySeq = new Map(turns.map((turn) => [turn.seq, turn] as const));
  const ordered = [...turns].sort((a, b) => a.seq - b.seq);
  const priority: ApplicationTranscriptTurnDto[] = [];
  for (const seq of citedSeqs) {
    const index = ordered.findIndex((turn) => turn.seq === seq);
    const before = index > 0 ? ordered[index - 1] : undefined;
    if (before !== undefined && before.role === "Q") priority.push(before);
    const turn = bySeq.get(seq);
    if (turn !== undefined) priority.push(turn);
  }
  priority.push(...[...ordered].reverse());
  const chosen = new Map<number, ApplicationTranscriptTurnDto>();
  let used = 0;
  for (const turn of priority) {
    if (chosen.has(turn.seq)) continue;
    const cost = turnLine(turn).length + 1;
    if (used + cost > budget) continue;
    chosen.set(turn.seq, turn);
    used += cost;
  }
  return [...chosen.values()].sort((a, b) => a.seq - b.seq);
}

/** Lines packed in order into chunks of at most `budget` characters. */
function chunk<T>(
  items: readonly T[],
  size: (item: T) => number,
  budget: number,
): T[][] {
  const out: T[][] = [];
  let current: T[] = [];
  let used = 0;
  for (const item of items) {
    const cost = size(item) + 1;
    if (current.length > 0 && used + cost > budget) {
      out.push(current);
      current = [];
      used = 0;
    }
    current.push(item);
    used += cost;
  }
  if (current.length > 0) out.push(current);
  return out;
}

/**
 * The parts one reading is made of. Every fact is in some part (all of
 * them in the first unless they exceed the findings budget), and every
 * turn: the first parts take the turns their facts came from and the most
 * recent ones, and the turns left over are read, in time order, in parts
 * of their own. Nothing is left out of the plan; only the call budget can
 * leave a part unread, and that is recorded.
 */
export function synthesisParts(
  input: {
    readonly dossier: GateqDossier;
    readonly transcript: readonly ApplicationTranscriptTurnDto[];
  },
  budgets: Pick<
    SynthesisBudgets,
    "findingsChars" | "transcriptChars"
  > = GATEQ_SYNTHESIS_BUDGETS,
): {
  readonly parts: readonly SynthesisPart[];
  readonly facts: number;
  readonly turns: number;
} {
  const { facts, summary } = findingLines(input);
  const summaryText = summary.join("\n");
  const factChunks = chunk(
    facts,
    (fact) => fact.line.length,
    Math.max(1_000, budgets.findingsChars - summaryText.length),
  );
  if (factChunks.length === 0) factChunks.push([]);
  const turns = [...input.transcript].sort((a, b) => a.seq - b.seq);
  const total = turns.length;
  const read = new Set<number>();
  const parts: SynthesisPart[] = [];
  const findingsOf = (group: readonly FactLine[]) =>
    [...group.map((fact) => fact.line), ...summary].join("\n").trim();
  for (const group of factChunks) {
    const cited = [...new Set(group.flatMap((fact) => fact.turnSeqs))];
    const shown = chooseTurns(turns, cited, budgets.transcriptChars);
    for (const turn of shown) read.add(turn.seq);
    parts.push({
      findings: findingsOf(group),
      transcript: shown.map(turnLine).join("\n") || "(no interview)",
      coverage: coverageWords(
        total,
        shown.map((turn) => turn.seq),
        false,
      ),
      factIds: new Set(group.flatMap((fact) => fact.ids)),
      turnSeqs: new Set(shown.map((turn) => turn.seq)),
    });
  }
  // The turns no part has read yet, in time order, read beside every fact
  // the first part was shown so their points can still cite facts.
  const left = turns.filter((turn) => !read.has(turn.seq));
  const first = factChunks[0] ?? [];
  for (const piece of chunk(
    left,
    (turn) => turnLine(turn).length,
    budgets.transcriptChars,
  )) {
    parts.push({
      findings: findingsOf(first),
      transcript: piece.map(turnLine).join("\n"),
      coverage: coverageWords(
        total,
        piece.map((turn) => turn.seq),
        true,
      ),
      factIds: new Set(first.flatMap((fact) => fact.ids)),
      turnSeqs: new Set(piece.map((turn) => turn.seq)),
    });
  }
  return { parts, facts: facts.length, turns: total };
}

/**
 * The first part's view, for callers and tests that read what Q is shown:
 * the findings, the transcript and what may be cited.
 */
export function synthesisContext(input: {
  readonly dossier: GateqDossier;
  readonly transcript: readonly ApplicationTranscriptTurnDto[];
}): SynthesisPart {
  const plan = synthesisParts(input);
  const first = plan.parts[0];
  if (first === undefined) throw new Error("a reading always has a part");
  return first;
}

/** Which points' text the gateway clipped, from its acceptance report. */
function clippedPoints(dropped: readonly string[] | undefined): Set<number> {
  const out = new Set<number>();
  for (const entry of dropped ?? []) {
    const match = /^points\.(\d+)\.text:too_big:clipped/u.exec(entry);
    if (match?.[1] !== undefined) out.add(Number(match[1]));
  }
  return out;
}

/**
 * Keep only points that cite something this call was shown; the rest are
 * not evidence and are counted, never stored. Every citation is kept.
 */
export function citedPoints(
  result: GateqDossierSynthesisResultV2,
  known: {
    readonly factIds: ReadonlySet<string>;
    readonly turnSeqs: ReadonlySet<number>;
  },
  dropped?: readonly string[],
): { readonly points: GateqSynthesisPointV2[]; readonly uncited: number } {
  const clipped = clippedPoints(dropped);
  let uncited = 0;
  const points = result.points.flatMap((point, index) => {
    const factIds = [...new Set(point.factIds)].filter((id) =>
      known.factIds.has(id),
    );
    const turnSeqs = [...new Set(point.turnSeqs)].filter((seq) =>
      known.turnSeqs.has(seq),
    );
    if (factIds.length === 0 && turnSeqs.length === 0) {
      uncited += 1;
      return [];
    }
    const over = point.text.length > GATEQ_SYNTHESIS_TEXT_MAX;
    return [
      {
        kind: point.kind,
        importance: point.importance,
        text: over ? point.text.slice(0, GATEQ_SYNTHESIS_TEXT_MAX) : point.text,
        textClipped: over || clipped.has(index),
        factIds,
        turnSeqs,
      },
    ];
  });
  return { points, uncited };
}

const IMPORTANCE_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
const sameText = (text: string) =>
  text.toLowerCase().replace(/\s+/gu, " ").trim();

/** Points already written, for the next call; every point is named. */
function writtenLines(points: readonly GateqSynthesisPointV2[]): string {
  if (points.length === 0) return "(none)";
  const full = points
    .map((point) => `- ${point.kind}: ${point.text.replace(/\s+/gu, " ")}`)
    .join("\n");
  if (full.length <= 60_000) return full;
  // Every point still named, each by its opening words.
  const short = points
    .map(
      (point) =>
        `- ${point.kind}: ${point.text.replace(/\s+/gu, " ").slice(0, 160)}`,
    )
    .join("\n");
  return short.length <= 60_000
    ? short
    : `${short.slice(short.length - 59_000)}\n(and earlier points, not repeated here)`;
}

export function createDossierSynthesis(deps: {
  readonly gateway: Pick<ModelGateway, "execute">;
  readonly store: SynthesisStore;
  readonly registry?: PromptRegistry | undefined;
  readonly logger?: Logger | undefined;
  readonly now?: (() => Date) | undefined;
  readonly budgets?: SynthesisBudgets | undefined;
}) {
  const registry = deps.registry ?? createDefaultPromptRegistry();
  const now = deps.now ?? (() => new Date());
  const budgets = deps.budgets ?? GATEQ_SYNTHESIS_BUDGETS;

  type CallResult = {
    readonly value: GateqDossierSynthesisResultV2;
    readonly dropped: readonly string[] | undefined;
    /** The answer stopped at its output ceiling: there is more to write. */
    readonly cutOff: boolean;
  };

  const call = async (
    item: PendingSynthesis,
    part: SynthesisPart,
    written: readonly GateqSynthesisPointV2[],
  ): Promise<CallResult | null> => {
    const rendered = renderPrompt(registry, {
      task: "GATEQ_DOSSIER_SYNTHESIS",
      operatingMode: "ASSESSMENT",
      communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
      environmentNotes:
        "You cannot record, decide or send anything; this reading is shown to the investor's team as Q's nonbinding view beside the dossier.",
      variables: {
        investorName: item.investorName.slice(0, 200) || "the investor",
        findings: part.findings || "(no findings)",
        transcript: part.transcript,
        coverage: part.coverage,
        written: writtenLines(written),
      },
    });
    const response = await deps.gateway.execute<GateqDossierSynthesisResultV2>(
      {
        taskClass: "EVIDENCE_SYNTHESIS",
        // The founder's commercial material, read for its recipient.
        sensitivity: "CONFIDENTIAL",
        // Output room is a cost-controlled budget per call; a reading with
        // more to say continues in another call, it is never cut short.
        budget: {
          maxAttempts: 1,
          maxEstimatedCostUsd: 0.15,
          maxOutputTokens: 4_000,
          attemptTimeoutMs: 90_000,
        },
        messages: [...rendered.messages],
        output: rendered.output,
        attribution: {
          tenantId: item.tenantId,
          correlationId: `gateq-synthesis-${item.applicationId}`,
          purpose: "DOCUMENT",
        },
      },
      {
        schema: GateqDossierSynthesisResultV2Schema,
        // One malformed point costs that point alone (reported, never
        // repaired); every kept point is still checked for citations.
        invalidListItems: "DROP",
        // An answer that ran out of room keeps the points it finished,
        // and the reading continues from them (decision 97).
        cutOffLists: { keepItems: 10_000 },
        signal: AbortSignal.timeout(120_000),
      },
    );
    if (response.output.kind !== "STRUCTURED") {
      deps.logger?.warn(
        { applicationId: item.applicationId, output: response.output.kind },
        "gateq synthesis call failed: no structured answer",
      );
      return null;
    }
    const parsed = GateqDossierSynthesisResultV2Schema.safeParse(
      response.output.value,
    );
    if (!parsed.success) {
      deps.logger?.warn(
        { applicationId: item.applicationId },
        "gateq synthesis call failed: answer did not match its schema",
      );
      return null;
    }
    const dropped = response.output.dropped;
    return {
      value: parsed.data,
      dropped,
      // Test doubles may leave `finish` out; the acceptance report still
      // carries a salvaged cut-off.
      cutOff:
        (response.finish as string | undefined) === "MAX_OUTPUT_TOKENS" ||
        (dropped ?? []).some((entry) => entry.startsWith("(cut-off)")),
    };
  };

  /** Every part, continued while Q has more, within the call budget. */
  const read = async (
    item: PendingSynthesis,
    dossier: GateqDossier,
  ): Promise<GateqSynthesisV2 | null> => {
    const plan = synthesisParts(
      { dossier, transcript: item.transcript },
      budgets,
    );
    const points: GateqSynthesisPointV2[] = [];
    const seen = new Map<string, GateqSynthesisPointV2>();
    let takeaway = "";
    let uncited = 0;
    let calls = 0;
    const turnsRead = new Set<number>();
    const problems: {
      reason: "OUTPUT_BUDGET" | "PART_FAILED";
      detail: string;
    }[] = [];
    for (const [index, part] of plan.parts.entries()) {
      let more = true;
      let answered = false;
      while (more) {
        if (calls >= budgets.calls) {
          problems.push({
            reason: "OUTPUT_BUDGET",
            detail: `Q's reading stopped at its budget of ${String(budgets.calls)} model calls before it had read and written everything.`,
          });
          break;
        }
        calls += 1;
        let result: CallResult | null;
        try {
          result = await call(item, part, points);
        } catch (error: unknown) {
          deps.logger?.warn(
            { err: error, applicationId: item.applicationId, part: index },
            "gateq synthesis call failed",
          );
          result = null;
        }
        if (result === null) {
          // The first part is the reading itself: without it, the attempt
          // fails and is retried later. A later part's failure is kept as
          // what it is.
          if (index === 0 && !answered) return null;
          problems.push({
            reason: "PART_FAILED",
            detail: answered
              ? "Part of Q's reading could not be continued, so it may hold fewer points than the submission supports."
              : `Interview turns ${ranges([...part.turnSeqs])} could not be read for this reading.`,
          });
          break;
        }
        answered = true;
        if (takeaway === "" && result.value.takeaway !== "")
          takeaway = result.value.takeaway;
        const kept = citedPoints(result.value, part, result.dropped);
        uncited += kept.uncited;
        let fresh = 0;
        for (const point of kept.points) {
          const key = sameText(point.text);
          const earlier = seen.get(key);
          if (earlier !== undefined) {
            // The same point again: one point, every citation it made.
            const merged = {
              ...earlier,
              factIds: [...new Set([...earlier.factIds, ...point.factIds])],
              turnSeqs: [...new Set([...earlier.turnSeqs, ...point.turnSeqs])],
            };
            points[points.indexOf(earlier)] = merged;
            seen.set(key, merged);
            continue;
          }
          seen.set(key, point);
          points.push(point);
          fresh += 1;
        }
        more = result.value.more || result.cutOff;
        if (more && fresh === 0) {
          // "More" with nothing new would only spend calls.
          problems.push({
            reason: "OUTPUT_BUDGET",
            detail:
              "Q said it had more to write but wrote nothing new, so this reading may be missing points.",
          });
          more = false;
        }
      }
      if (answered) for (const seq of part.turnSeqs) turnsRead.add(seq);
      if (
        problems.some((problem) => problem.reason === "OUTPUT_BUDGET") &&
        calls >= budgets.calls
      )
        break;
    }
    if (takeaway === "") return null;
    if (turnsRead.size < plan.turns) {
      problems.push({
        reason: "OUTPUT_BUDGET",
        detail: `Q read ${String(turnsRead.size)} of the interview's ${String(plan.turns)} turns.`,
      });
    }
    const first = problems[0];
    const detail = [...new Set(problems.map((problem) => problem.detail))]
      .join(" ")
      .slice(0, 600);
    return {
      schemaVersion: 2,
      generatedAt: now().toISOString(),
      truthClass: "Q_INFERENCE",
      takeaway,
      points: [...points].sort(
        (a, b) =>
          IMPORTANCE_ORDER[a.importance] - IMPORTANCE_ORDER[b.importance],
      ),
      complete: first === undefined,
      incomplete: first === undefined ? null : { reason: first.reason, detail },
      uncitedDropped: uncited,
      coverage: {
        facts: plan.facts,
        turns: plan.turns,
        turnsRead: turnsRead.size,
        calls,
      },
    };
  };

  const one = async (item: PendingSynthesis): Promise<"READY" | "FAILED"> => {
    const dossier = GateqDossierSchema.safeParse(item.dossier);
    if (!dossier.success) return "FAILED";
    if (
      !(await deps.store.claim({
        applicationId: item.applicationId,
        tenantId: item.tenantId,
      }))
    )
      return "FAILED";
    try {
      const synthesis = await read(item, dossier.data);
      if (synthesis === null) {
        deps.logger?.warn(
          { applicationId: item.applicationId },
          "gateq synthesis failed: no reading of the submission",
        );
        return "FAILED";
      }
      if (!synthesis.complete) {
        deps.logger?.warn(
          {
            applicationId: item.applicationId,
            incomplete: synthesis.incomplete?.reason,
            coverage: synthesis.coverage,
          },
          "gateq synthesis recorded as incomplete",
        );
      }
      await deps.store.ready({
        applicationId: item.applicationId,
        synthesis,
        promptVersion: GATEQ_SYNTHESIS_PROMPT_VERSION,
      });
      return "READY";
    } catch (error: unknown) {
      deps.logger?.warn(
        { err: error, applicationId: item.applicationId },
        "gateq synthesis failed",
      );
      return "FAILED";
    }
  };

  return {
    /** One sweep: at most `limit` submissions, one at a time. */
    sweep: async (limit = 1) => {
      let ready = 0;
      let failed = 0;
      for (const item of await deps.store.pending(limit)) {
        if ((await one(item)) === "READY") ready++;
        else failed++;
      }
      return { ready, failed };
    },
  };
}

export type DossierSynthesis = ReturnType<typeof createDossierSynthesis>;
