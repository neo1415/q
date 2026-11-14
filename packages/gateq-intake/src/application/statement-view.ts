import type { QualificationDisputedFact } from "@capital-q/gateq";

import {
  APPLICATION_DIMENSIONS,
  QUALIFYING_DIMENSIONS,
  type ApplicationDimension,
  type FactProvenance,
  type FactValue,
} from "../contracts/index.js";
import {
  DIMENSION_VIEW_VERSION,
  type ApplicationStatement,
  type ApplicationStatementId,
  type ApplicationStatementView,
  type DimensionDisagreement,
  type DimensionStatus,
  type DimensionView,
  type DimensionViewItem,
  type DisagreementEvent,
  type DisagreementState,
  type StatementLink,
  type StatementValue,
  type SupersededItem,
  type ViewSourceKind,
} from "../contracts/statements.js";

/**
 * The deterministic view over an application's statements (design
 * 2026-11-14, slice 1). Pure: the same statements, links and events give
 * the same view whatever order they arrive in.
 *
 * The rules, each the fix for a live defect family:
 *
 *   - CORRECTS hides only its target. Nothing else on the dimension moves
 *     (D11: a "now" figure erased unrelated traction lines).
 *   - UNKNOWN never hides a held value. "I don't know" beside a figure is
 *     kept as said, but the figure stands (D2b).
 *   - ZERO is a value. "Nobody pays yet" is a stated zero (D9).
 *   - DISAGREES keeps both statements visible until a RESOLVED event; a
 *     REOPENED event brings both back.
 *   - Code finds a disagreement on its own only when two current numbers
 *     name the same dimension and quantity, may describe the same period,
 *     and differ. Different quantities never conflict (D10). Two different
 *     known dates are different periods; an unknown date is never assumed
 *     to be a different period (live 2026-11-14: an undated 600 and 1,500
 *     weekly active stood side by side, unflagged), so it is a candidate
 *     for the same one, flagged for the founder to settle or leave open.
 */

export class StatementViewIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StatementViewIntegrityError";
  }
}

type Ordered = { readonly statedAt: string; readonly id: string };

/** Oldest first; the id breaks a tie so the order never depends on input. */
function byStated(a: Ordered, b: Ordered): number {
  const at = Date.parse(a.statedAt) - Date.parse(b.statedAt);
  if (at !== 0) return at;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function byKey(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sourceKindOf(statement: ApplicationStatement): ViewSourceKind {
  if (statement.origin === "FORM") return "FORM";
  if (statement.origin === "DOCUMENT_CONFIRMED") return "DOCUMENT";
  return "APPLICATION_STATEMENT";
}

function itemOf(statement: ApplicationStatement): DimensionViewItem {
  return {
    statementId: statement.id,
    sourceKind: sourceKindOf(statement),
    origin: statement.origin,
    backfilled: statement.origin === "BACKFILL",
    quantity: statement.quantity,
    value: statement.value,
    asOf: statement.asOf,
    words: statement.words,
    provenance: statement.provenance,
    sourceTurnId: statement.sourceTurnId,
    statedAt: statement.statedAt,
  };
}

const isHeld = (value: StatementValue) => value.kind !== "UNKNOWN";

/**
 * Whether two figures may describe the same period: the same known date,
 * or a date not given on either side. Only two different known dates are
 * known to be different periods.
 */
export function samePeriod(a: string | null, b: string | null): boolean {
  return a === null || b === null || a === b;
}

/**
 * A comparable number for code-detected disagreement, or null when the two
 * cannot be compared honestly (prose, an unknown, an unknown currency).
 */
function comparable(
  value: StatementValue,
): { readonly unit: string; readonly amount: string } | null {
  switch (value.kind) {
    case "COUNT":
      return { unit: "COUNT", amount: canonicalDecimal(value.count) };
    case "PERCENT":
      return { unit: "PERCENT", amount: canonicalDecimal(value.percent) };
    case "MONEY":
      return value.currency === null
        ? null
        : {
            unit: `MONEY:${value.currency}`,
            amount: canonicalDecimal(value.amount),
          };
    case "ZERO":
      // Zero of anything is zero: unit-free, compared with every unit.
      return { unit: "*", amount: "0" };
    case "TEXT":
    case "CODE":
    case "UNKNOWN":
      return null;
  }
}

/**
 * Exact decimals compared as text, never floats ("1500.0" equals "1500";
 * a 16-digit count stays exact). Inputs are already schema-bounded.
 */
function canonicalDecimal(decimal: string): string {
  const negative = decimal.startsWith("-");
  const [whole = "0", fraction = ""] = (
    negative ? decimal.slice(1) : decimal
  ).split(".");
  const trimmed = fraction.replace(/0+$/u, "");
  const magnitude = trimmed.length > 0 ? `${whole}.${trimmed}` : whole;
  return negative && magnitude !== "0" ? `-${magnitude}` : magnitude;
}

/**
 * Whether two values are numbers that disagree: the same unit (any unit
 * against a zero) and a different exact amount. Prose, unknowns and an
 * unknown currency never conflict. Used by the projector and by the write
 * path's own code-detected disagreement.
 */
export function valuesConflict(a: StatementValue, b: StatementValue): boolean {
  return conflicts(a, b);
}

function conflicts(a: StatementValue, b: StatementValue): boolean {
  const left = comparable(a);
  const right = comparable(b);
  if (left === null || right === null) return false;
  if (left.unit !== "*" && right.unit !== "*" && left.unit !== right.unit)
    return false;
  return left.amount !== right.amount;
}

type LinkState = {
  readonly state: DisagreementState;
  readonly resolvedBy: ApplicationStatementId | null;
};

function currentState(
  events: readonly DisagreementEvent[] | undefined,
): LinkState {
  const latest = [...(events ?? [])]
    .sort((a, b) =>
      byStated(
        { statedAt: a.recordedAt, id: a.id },
        { statedAt: b.recordedAt, id: b.id },
      ),
    )
    .at(-1);
  if (latest === undefined || latest.state === "REOPENED")
    return { state: "OPEN", resolvedBy: null };
  if (latest.state === "LEFT_OPEN")
    return { state: "LEFT_OPEN", resolvedBy: null };
  return { state: "RESOLVED", resolvedBy: latest.resolvedByStatementId };
}

function statusOf(
  items: readonly DimensionViewItem[],
  disagreements: readonly DimensionDisagreement[],
): DimensionStatus {
  if (items.length === 0) return "UNANSWERED";
  const active = disagreements.filter((d) => d.active);
  if (active.some((d) => d.state === "OPEN")) return "DISAGREEMENT_OPEN";
  if (active.some((d) => d.state === "LEFT_OPEN"))
    return "DISAGREEMENT_LEFT_OPEN";
  const held = items.filter((item) => isHeld(item.value));
  if (held.length > 0)
    return held.every((item) => item.value.kind === "ZERO")
      ? "ZERO"
      : "SETTLED";
  const latest = items.at(-1);
  return latest?.value.kind === "UNKNOWN" && latest.value.declined === true
    ? "DECLINED"
    : "UNKNOWN";
}

/**
 * Project every application dimension. Throws StatementViewIntegrityError
 * when a link or event names something it was not given: the database
 * makes that impossible, so seeing it means a reader passed a partial set.
 */
export function projectView(
  statements: readonly ApplicationStatement[],
  links: readonly StatementLink[],
  events: readonly DisagreementEvent[],
): ApplicationStatementView {
  const byId = new Map<string, ApplicationStatement>();
  for (const statement of statements) byId.set(statement.id, statement);
  const linkById = new Map<string, StatementLink>();
  for (const link of links) {
    if (!byId.has(link.fromStatementId) || !byId.has(link.toStatementId))
      throw new StatementViewIntegrityError(
        `link ${link.id} names a statement that was not supplied`,
      );
    linkById.set(link.id, link);
  }
  const eventsByLink = new Map<string, DisagreementEvent[]>();
  for (const event of events) {
    const link = linkById.get(event.linkId);
    if (link === undefined)
      throw new StatementViewIntegrityError(
        `disagreement event ${event.id} names a link that was not supplied`,
      );
    if (link.kind !== "DISAGREES")
      throw new StatementViewIntegrityError(
        `disagreement event ${event.id} is on a CORRECTS link`,
      );
    const list = eventsByLink.get(event.linkId) ?? [];
    list.push(event);
    eventsByLink.set(event.linkId, list);
  }

  // Hidden statements and what hid them. A held value is hidden only by a
  // held value: an UNKNOWN correcting or resolving it changes nothing.
  const hiddenBy = new Map<
    string,
    { by: ApplicationStatementId; via: SupersededItem["via"] }
  >();
  const hide = (
    target: ApplicationStatementId,
    by: ApplicationStatementId,
    via: SupersededItem["via"],
  ) => {
    const targetStatement = byId.get(target);
    const byStatement = byId.get(by);
    if (targetStatement === undefined || byStatement === undefined) return;
    if (isHeld(targetStatement.value) && !isHeld(byStatement.value)) return;
    const existing = hiddenBy.get(target);
    // Several statements may hide one: the earliest stays the record of
    // what superseded it, so the answer does not depend on input order.
    if (existing !== undefined) {
      const current = byId.get(existing.by);
      if (current !== undefined && byStated(current, byStatement) <= 0) return;
    }
    hiddenBy.set(target, { by, via });
  };

  const sortedLinks = [...linkById.values()].sort((a, b) => byKey(a.id, b.id));
  for (const link of sortedLinks)
    if (link.kind === "CORRECTS")
      hide(link.toStatementId, link.fromStatementId, "CORRECTION");

  const disagreementLinks = sortedLinks.filter((l) => l.kind === "DISAGREES");
  const linkStates = new Map<string, LinkState>();
  for (const link of disagreementLinks) {
    const state = currentState(eventsByLink.get(link.id));
    linkStates.set(link.id, state);
    if (state.state === "RESOLVED" && state.resolvedBy !== null) {
      for (const end of [link.fromStatementId, link.toStatementId])
        if (end !== state.resolvedBy) hide(end, state.resolvedBy, "RESOLUTION");
    }
  }

  const visible = (id: ApplicationStatementId) => !hiddenBy.has(id);

  const stored: DimensionDisagreement[] = disagreementLinks.map((link) => {
    const state = linkStates.get(link.id) ?? {
      state: "OPEN",
      resolvedBy: null,
    };
    // Once either side is corrected or resolved away the pair no longer
    // stands; it stays in the view as history but decides nothing.
    const bothVisible =
      visible(link.fromStatementId) && visible(link.toStatementId);
    return {
      key: link.id,
      linkId: link.id,
      origin: link.origin,
      olderStatementId: link.toStatementId,
      newerStatementId: link.fromStatementId,
      state: state.state,
      resolvedByStatementId: state.resolvedBy,
      active: state.state !== "RESOLVED" && bothVisible,
    };
  });

  // Pairs already related by any stored link are never re-detected.
  const related = new Set<string>();
  for (const link of sortedLinks) {
    related.add(`${link.fromStatementId}|${link.toStatementId}`);
    related.add(`${link.toStatementId}|${link.fromStatementId}`);
  }

  const detected: DimensionDisagreement[] = [];
  const current = [...byId.values()]
    .filter((s) => visible(s.id))
    .sort(byStated);
  for (let i = 0; i < current.length; i += 1) {
    const older = current[i];
    if (older === undefined || older.quantity === null) continue;
    for (let j = i + 1; j < current.length; j += 1) {
      const newer = current[j];
      if (
        newer === undefined ||
        newer.dimension !== older.dimension ||
        newer.quantity !== older.quantity ||
        !samePeriod(newer.asOf, older.asOf) ||
        related.has(`${newer.id}|${older.id}`) ||
        !conflicts(older.value, newer.value)
      )
        continue;
      detected.push({
        key: `code:${older.id}:${newer.id}`,
        linkId: null,
        origin: "CODE_DETECTED",
        olderStatementId: older.id,
        newerStatementId: newer.id,
        state: "OPEN",
        resolvedByStatementId: null,
        active: true,
      });
    }
  }

  const ordered = [...byId.values()].sort(byStated);
  const dimensions: DimensionView[] = APPLICATION_DIMENSIONS.map(
    (dimension) => {
      const own = ordered.filter((s) => s.dimension === dimension);
      const ownIds = new Set(own.map((s) => s.id));
      const items = own.filter((s) => visible(s.id)).map(itemOf);
      const superseded: SupersededItem[] = own
        .filter((s) => !visible(s.id))
        .map((s) => {
          const hidden = hiddenBy.get(s.id);
          if (hidden === undefined)
            throw new StatementViewIntegrityError("unreachable: hidden");
          return { item: itemOf(s), supersededBy: hidden.by, via: hidden.via };
        });
      const disagreements = [...stored, ...detected]
        .filter(
          (d) =>
            ownIds.has(d.olderStatementId) || ownIds.has(d.newerStatementId),
        )
        .sort((a, b) => {
          const newerA = byId.get(a.newerStatementId);
          const newerB = byId.get(b.newerStatementId);
          const olderA = byId.get(a.olderStatementId);
          const olderB = byId.get(b.olderStatementId);
          if (newerA && newerB && olderA && olderB) {
            const byNewer = byStated(newerA, newerB);
            if (byNewer !== 0) return byNewer;
            const byOlder = byStated(olderA, olderB);
            if (byOlder !== 0) return byOlder;
          }
          return byKey(a.key, b.key);
        });
      return {
        version: DIMENSION_VIEW_VERSION,
        dimension,
        status: statusOf(items, disagreements),
        items,
        superseded,
        disagreements,
      };
    },
  );

  return { version: DIMENSION_VIEW_VERSION, dimensions };
}

/** One dimension's view out of a projected application view. */
export function dimensionView(
  view: ApplicationStatementView,
  dimension: ApplicationDimension,
): DimensionView {
  const found = view.dimensions.find((d) => d.dimension === dimension);
  if (found === undefined)
    throw new StatementViewIntegrityError(`no view for ${dimension}`);
  return found;
}

/**
 * Statuses Q never asks about again: an answer, a stated zero, a refusal,
 * and a disagreement the founder chose to leave open.
 */
export const NEVER_ASKED_AGAIN: ReadonlySet<DimensionStatus> = new Set([
  "SETTLED",
  "ZERO",
  "DECLINED",
  "DISAGREEMENT_LEFT_OPEN",
]);

/** Whether a dimension in this status may be asked about at all. */
export function mayAsk(status: DimensionStatus): boolean {
  return !NEVER_ASKED_AGAIN.has(status);
}

/**
 * Why a dimension may be asked about, in the question-needs vocabulary:
 * an open disagreement is a CONTRADICTION; otherwise it is unanswered or
 * not known. Null when it is never asked again.
 */
export function questionStatus(
  status: DimensionStatus,
): "CONTRADICTION" | "UNANSWERED" | "UNKNOWN" | null {
  if (status === "DISAGREEMENT_OPEN") return "CONTRADICTION";
  if (status === "UNANSWERED") return "UNANSWERED";
  if (status === "UNKNOWN") return "UNKNOWN";
  return null;
}

// ---------------------------------------------------------------------------
// The bridge to today's facts
// ---------------------------------------------------------------------------

export type LegacyFact = {
  readonly dimension: ApplicationDimension;
  readonly value: FactValue;
  readonly provenance: FactProvenance;
};

/**
 * Where the legacy shape could not hold everything the view holds. Reported,
 * never silent: the view itself is complete, and readers move to it in
 * slice 3.
 */
export type LegacyIncompleteness = {
  readonly dimension: ApplicationDimension;
  readonly reason: "TEXT_LIMIT" | "PHRASE_LIMIT" | "UNRECONCILED_LIMIT";
};

const LEGACY_TEXT_LIMIT = 2000;
const LEGACY_PHRASE_LIMIT = 12;
const LEGACY_PHRASE_LENGTH = 120;
const LEGACY_UNRECONCILED_LIMIT = 4;
const LEGACY_QUOTE_LIMIT = 300;

const CANONICAL_CODE: Partial<Record<ApplicationDimension, RegExp>> = {
  "company.country": /^[A-Z]{2}$/,
  "raise.currency": /^[A-Z]{3}$/,
  // The closed company_stage vocabulary: a code outside it is never read.
  "company.stage": /^(?:pre_seed|seed|series_a|series_b|series_c_plus)$/,
};

/**
 * Dimensions that hold one answer, not an account in several sentences: the
 * legacy fact is the latest held statement's value, never every line
 * joined (an email of two addresses is no email). Both statements stay in
 * the view; a disagreement still reads as prose with both (decision 91).
 */
export const SINGLE_VALUED_DIMENSIONS: ReadonlySet<ApplicationDimension> =
  new Set([
    "contact.name",
    "contact.email",
    "contact.role",
    "company.name",
    "company.website",
    "claims.revenue",
    "raise.instrument",
    "raise.lead_status",
  ]);

/** A qualifying value in the shape the deterministic projection reads. */
function qualifyingValue(
  dimension: ApplicationDimension,
  item: DimensionViewItem,
): FactValue {
  const value = item.value;
  if (dimension === "claims.revenue") {
    if (value.kind === "MONEY" && value.currency !== null)
      return { kind: "AMOUNT", amount: value.amount, currency: value.currency };
    if (value.kind === "ZERO")
      return value.currency === undefined
        ? { kind: "TEXT", text: "0" }
        : { kind: "AMOUNT", amount: "0", currency: value.currency };
  }
  if (value.kind === "TEXT" && SINGLE_VALUED_DIMENSIONS.has(dimension))
    return { kind: "TEXT", text: value.text };
  if (dimension === "raise.amount") {
    if (value.kind === "MONEY" && value.currency !== null)
      return { kind: "AMOUNT", amount: value.amount, currency: value.currency };
    if (value.kind === "ZERO" && value.currency !== undefined)
      return { kind: "AMOUNT", amount: "0", currency: value.currency };
  }
  const canonical = CANONICAL_CODE[dimension];
  if (value.kind === "CODE" && canonical?.test(value.code) === true)
    return { kind: "CODE", code: value.code };
  // Anything else (an amount with no currency, a count, prose) is kept in
  // the founder's words. The qualification projection reads only AMOUNT and
  // CODE, so it stays UNKNOWN to the rules: never guessed into a value.
  return { kind: "TEXT", text: item.words };
}

function lineOf(item: DimensionViewItem): string {
  return item.value.kind === "TEXT" ? item.value.text : item.words;
}

const quote = (text: string) => text.slice(0, LEGACY_QUOTE_LIMIT);

/**
 * A dimension's statements as today's one-line-per-statement text, oldest
 * first, with its standing disagreements as unreconciled pairs. Keeps the
 * newest lines when the legacy bound is reached, and reports that it did.
 */
function proseValue(
  entry: DimensionView,
  incomplete: LegacyIncompleteness[],
): FactValue {
  const { dimension, items } = entry;
  const lines = items.map(lineOf);
  const kept: string[] = [];
  let length = 0;
  for (const line of [...lines].reverse()) {
    const next = length + line.length + (kept.length > 0 ? 1 : 0);
    if (next > LEGACY_TEXT_LIMIT) break;
    kept.unshift(line);
    length = next;
  }
  if (kept.length < lines.length)
    incomplete.push({ dimension, reason: "TEXT_LIMIT" });

  const pending = standingDisagreements(entry);
  if (pending.length > LEGACY_UNRECONCILED_LIMIT)
    incomplete.push({ dimension, reason: "UNRECONCILED_LIMIT" });
  const wordsOf = new Map(items.map((item) => [item.statementId, item.words]));
  const unreconciled = pending
    .slice(0, LEGACY_UNRECONCILED_LIMIT)
    .flatMap((d) => {
      const earlier = wordsOf.get(d.olderStatementId);
      const later = wordsOf.get(d.newerStatementId);
      return earlier !== undefined && later !== undefined
        ? [{ earlier: quote(earlier), later: quote(later) }]
        : [];
    });
  return unreconciled.length > 0
    ? { kind: "TEXT", text: kept.join("\n"), unreconciled }
    : { kind: "TEXT", text: kept.join("\n") };
}

/** Disagreements still standing: OPEN or LEFT_OPEN, both sides current. */
function standingDisagreements(entry: DimensionView) {
  return entry.disagreements.filter((d) => d.active && d.state !== "RESOLVED");
}

/** The qualification fact each qualifying dimension feeds (decision 91). */
const DISPUTED_FACT: Partial<
  Record<ApplicationDimension, QualificationDisputedFact>
> = {
  "company.country": "HEADQUARTERS_COUNTRY",
  "company.stage": "CURRENT_STAGE",
  "raise.amount": "RAISE",
  "raise.currency": "RAISE",
};

/**
 * Today's facts from the view, plus the qualification facts in genuine
 * disagreement.
 *
 * A qualifying dimension takes its latest current held value, unless it
 * has a disagreement still standing (OPEN, or LEFT_OPEN by the founder).
 * Owner decision 91 (2026-11-14): then the latest value is NOT used. The
 * fact carries both statements in the founder's words (never a value the
 * rules can read) and the dimension is reported in `disputed`, which
 * `applicationProjection` passes to the engine so the rule reads
 * UNRESOLVED: never a disqualification, never a block on submission, never
 * hidden from the investor. An explicit correction (CORRECTS) or a
 * resolution ends the disagreement, and the corrected value is used again.
 */
export function legacyFactsFrom(view: ApplicationStatementView): {
  readonly facts: readonly LegacyFact[];
  readonly incomplete: readonly LegacyIncompleteness[];
  readonly disputed: readonly ApplicationDimension[];
} {
  const facts: LegacyFact[] = [];
  const incomplete: LegacyIncompleteness[] = [];
  const disputed: ApplicationDimension[] = [];
  for (const entry of view.dimensions) {
    const { dimension, items } = entry;
    if (items.length === 0) continue;
    const held = items.filter((item) => isHeld(item.value));
    const latestHeld = held.at(-1);
    if (latestHeld === undefined) {
      const latest = items.at(-1);
      const declined =
        latest?.value.kind === "UNKNOWN" && latest.value.declined === true;
      facts.push({
        dimension,
        value: declined ? { kind: "NONE", declined: true } : { kind: "NONE" },
        provenance: "UNKNOWN",
      });
      continue;
    }

    if (dimension === "company.sector_phrases") {
      const phrases = held
        .map((item) => lineOf(item).trim())
        .filter((phrase) => phrase.length > 0);
      if (
        phrases.length > LEGACY_PHRASE_LIMIT ||
        phrases.some((phrase) => phrase.length > LEGACY_PHRASE_LENGTH)
      )
        incomplete.push({ dimension, reason: "PHRASE_LIMIT" });
      // The newest phrases, as the legacy one-current-fact held them.
      const kept = phrases
        .slice(-LEGACY_PHRASE_LIMIT)
        .map((phrase) => phrase.slice(0, LEGACY_PHRASE_LENGTH));
      facts.push({
        dimension,
        value: { kind: "PHRASES", phrases: kept },
        provenance: latestHeld.provenance,
      });
      continue;
    }

    if (
      QUALIFYING_DIMENSIONS.includes(dimension) ||
      SINGLE_VALUED_DIMENSIONS.has(dimension)
    ) {
      const inDispute = standingDisagreements(entry).length > 0;
      if (inDispute && QUALIFYING_DIMENSIONS.includes(dimension))
        disputed.push(dimension);
      facts.push({
        dimension,
        value: inDispute
          ? proseValue(entry, incomplete)
          : qualifyingValue(dimension, latestHeld),
        provenance: latestHeld.provenance,
      });
      continue;
    }

    facts.push({
      dimension,
      value: proseValue(entry, incomplete),
      provenance: latestHeld.provenance,
    });
  }
  return { facts, incomplete, disputed };
}

/** The engine's disputed facts for a set of disputed dimensions. */
export function disputedFactsFor(
  dimensions: readonly ApplicationDimension[],
): QualificationDisputedFact[] {
  const facts = new Set<QualificationDisputedFact>();
  for (const dimension of dimensions) {
    const fact = DISPUTED_FACT[dimension];
    if (fact !== undefined) facts.add(fact);
  }
  return [...facts].sort();
}
