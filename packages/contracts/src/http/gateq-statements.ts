import type {
  GateqDisagreementState,
  GateqDossier,
  GateqInvestmentGroup,
  GateqStatementSourceKind,
  GateqStatementViewV1,
  GateqStatementWords,
} from "./gateq-intake.js";

/**
 * The one formatter of GateQ statements (design 2026-11-14, slice 3,
 * invariant 8). Founder review, the frozen dossier, the investor inbox,
 * Q's synthesis and the investor's Q all read an application through this
 * function, so the same statements, sources and disagreement states appear
 * identically wherever they are read. Pure; no model, no I/O.
 */

/** Where a statement came from, in a reader's words. Never "verified". */
export const GATEQ_SOURCE_KIND_WORDS: Readonly<
  Record<GateqStatementSourceKind, string>
> = {
  APPLICATION_STATEMENT: "Said in the application",
  FORM: "Given in the form",
  DOCUMENT: "From a shared document",
  COMPANY_PROFILE: "From their Capital Q company profile",
};

/** A disagreement's state, in a reader's words. */
export const GATEQ_DISAGREEMENT_STATE_WORDS: Readonly<
  Record<GateqDisagreementState, string>
> = {
  OPEN: "Open, not yet settled",
  LEFT_OPEN: "Left open by the founder",
  RESOLVED: "Resolved",
};

/**
 * Decision 91: a rule whose fact the founder's own answers disagree on is
 * neither unanswered nor in need of the founder's clarification: it is the
 * investor's judgement call.
 */
export const GATEQ_UNRESOLVED_WORDS = "Needs your judgement: answers disagree";

export type GateqStatementLineKind = "STATEMENT" | "DISAGREEMENT" | "HISTORY";

export type GateqStatementLine = {
  readonly kind: GateqStatementLineKind;
  readonly dimension: string;
  readonly label: string;
  readonly group: GateqInvestmentGroup | null;
  /** One id for a statement or history line; older then newer for a disagreement. */
  readonly statementIds: readonly string[];
  readonly sourceKinds: readonly GateqStatementSourceKind[];
  readonly sourceTurnSeqs: readonly (number | null)[];
  /** The state of the disagreement this line is, or is part of; null when none stands. */
  readonly disagreementState: GateqDisagreementState | null;
  readonly backfilled: boolean;
  /** The value(s) alone, in words. */
  readonly summaries: readonly string[];
  /** The whole line, in English, for a reader that takes text. */
  readonly text: string;
};

function sourceWords(statement: GateqStatementWords): string {
  return `${GATEQ_SOURCE_KIND_WORDS[statement.sourceKind]}${statement.backfilled ? ", carried from earlier records" : ""}`;
}

/** The standing disagreement state of each current statement, OPEN first. */
function standingStates(
  dimension: GateqStatementViewV1["dimensions"][number],
): ReadonlyMap<string, GateqDisagreementState> {
  const states = new Map<string, GateqDisagreementState>();
  for (const d of dimension.disagreements) {
    if (!d.active || d.state === "RESOLVED") continue;
    for (const id of [d.olderStatementId, d.newerStatementId])
      if (states.get(id) !== "OPEN") states.set(id, d.state);
  }
  return states;
}

/**
 * Every statement of the view's investment dimensions as lines, dimension
 * by dimension in the view's order: the current statements, then their disagreements (standing
 * and resolved, both values with their sources), then what was corrected
 * or resolved away, as history. Nothing is joined or dropped.
 */
export function gateqStatementsInWords(
  view: GateqStatementViewV1,
): readonly GateqStatementLine[] {
  const lines: GateqStatementLine[] = [];
  for (const dimension of view.dimensions) {
    // Contact details and the founder's note are read in their own places
    // (the contact card, the note), never as investment findings; they
    // stay in the view itself.
    if (dimension.group === null) continue;
    const states = standingStates(dimension);
    const byId = new Map<string, GateqStatementWords>();
    for (const s of dimension.statements) byId.set(s.statementId, s);
    for (const s of dimension.superseded) byId.set(s.statementId, s);
    const base = {
      dimension: dimension.dimension,
      label: dimension.label,
      group: dimension.group,
    };
    for (const statement of dimension.statements) {
      const state = states.get(statement.statementId) ?? null;
      lines.push({
        ...base,
        kind: "STATEMENT",
        statementIds: [statement.statementId],
        sourceKinds: [statement.sourceKind],
        sourceTurnSeqs: [statement.sourceTurnSeq],
        disagreementState: state,
        backfilled: statement.backfilled,
        summaries: [statement.summary],
        text: `${dimension.label}: ${statement.summary} (${sourceWords(statement)}${state === null ? "" : `; answers disagree, ${GATEQ_DISAGREEMENT_STATE_WORDS[state].toLowerCase()}`})`,
      });
    }
    for (const d of dimension.disagreements) {
      // A pair one side of which was corrected away no longer stands; the
      // correction is the record, shown below as history.
      if (!d.active && d.state !== "RESOLVED") continue;
      const older = byId.get(d.olderStatementId);
      const newer = byId.get(d.newerStatementId);
      // A side on another dimension is read on that dimension's lines.
      if (older === undefined || newer === undefined) continue;
      const resolver =
        d.resolvedByStatementId === null
          ? undefined
          : byId.get(d.resolvedByStatementId);
      lines.push({
        ...base,
        kind: "DISAGREEMENT",
        statementIds: [older.statementId, newer.statementId],
        sourceKinds: [older.sourceKind, newer.sourceKind],
        sourceTurnSeqs: [older.sourceTurnSeq, newer.sourceTurnSeq],
        disagreementState: d.state,
        backfilled: older.backfilled || newer.backfilled,
        summaries: [older.summary, newer.summary],
        text: `${dimension.label}: answers disagree (${GATEQ_DISAGREEMENT_STATE_WORDS[d.state].toLowerCase()}): “${older.summary}” (${sourceWords(older)}) and “${newer.summary}” (${sourceWords(newer)})${resolver === undefined ? "" : `; settled by “${resolver.summary}”`}`,
      });
    }
    for (const old of dimension.superseded) {
      lines.push({
        ...base,
        kind: "HISTORY",
        statementIds: [old.statementId],
        sourceKinds: [old.sourceKind],
        sourceTurnSeqs: [old.sourceTurnSeq],
        disagreementState: null,
        backfilled: old.backfilled,
        summaries: [old.summary],
        text: `${dimension.label}, earlier: ${old.summary} (${sourceWords(old)}; ${old.via === "CORRECTION" ? "corrected later" : "settled later"})`,
      });
    }
  }
  return lines;
}

/**
 * What invariant 8 compares across readers: each line's statement ids,
 * sources and disagreement state, as sorted keys. Two readers agree on the
 * facts and their sources exactly when these sets are equal.
 */
export function gateqStatementIdentities(
  lines: readonly GateqStatementLine[],
): readonly string[] {
  return lines
    .map(
      (line) =>
        `${line.kind}:${line.statementIds.join("+")}:${line.sourceKinds.join("+")}:${line.disagreementState ?? "NONE"}`,
    )
    .sort();
}

/** The disagreements still standing, OPEN or LEFT_OPEN, as lines. */
export function gateqStandingDisagreements(
  lines: readonly GateqStatementLine[],
): readonly GateqStatementLine[] {
  return lines.filter(
    (line) =>
      line.kind === "DISAGREEMENT" && line.disagreementState !== "RESOLVED",
  );
}

/**
 * The sources an investor's Q reading of a frozen dossier cites: every
 * finding with its own source kind. A v2 finding is a statement with its
 * recorded source; a v1 finding predates sources and is the application's.
 * Profile and document facts carry their own kind, never "the application".
 */
export function gateqReadingSources(dossier: GateqDossier): readonly {
  readonly factId: string;
  readonly transcriptSeq: number | null;
  readonly sourceKind: GateqStatementSourceKind;
}[] {
  if (dossier.schemaVersion === "gateq-dossier.v2") {
    return gateqStatementsInWords(dossier.statements)
      .filter((line) => line.kind === "STATEMENT")
      .map((line) => ({
        factId: line.statementIds[0] ?? "",
        transcriptSeq: line.sourceTurnSeqs[0] ?? null,
        sourceKind: line.sourceKinds[0] ?? "APPLICATION_STATEMENT",
      }));
  }
  return dossier.dimensions.flatMap((group) =>
    group.facts.map((fact) => ({
      factId: fact.sourceFactId,
      transcriptSeq: fact.sourceTurnSeq,
      sourceKind: "APPLICATION_STATEMENT" as const,
    })),
  );
}
