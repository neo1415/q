import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";
import type {
  GateQDisagreementAction,
  GateQStatementOp,
  GateQStatementValue,
} from "@capital-q/q-core";

import {
  APPLICATION_DIMENSIONS,
  NewApplicationFactSchema,
  QUALIFYING_DIMENSIONS,
  type ApplicationDimension,
  type ApplicationFact,
  type ApplicationId,
  type FactProvenance,
  type NewApplicationFact,
} from "../contracts/index.js";
import {
  ApplicationStatementIdSchema,
  ApplicationStatementSchema,
  DisagreementEventIdSchema,
  DisagreementEventSchema,
  StatementLinkIdSchema,
  StatementLinkSchema,
  StatementQuantitySchema,
  TurnReadingIdSchema,
  TurnReadingSchema,
  type ApplicationStatement,
  type ApplicationStatementId,
  type ApplicationStatementView,
  type ApplicationTurnId,
  type DimensionDisagreement,
  type DimensionViewItem,
  type DisagreementEvent,
  type DisagreementState,
  type StatementLink,
  type StatementNotRecorded,
  type StatementQuantity,
  type StatementValue,
  type TurnReading,
} from "../contracts/statements.js";
import { currencyCodeIn, normaliseProposedFact } from "./normalise-fact.js";
import { regionIn } from "./cities.js";
import type { NotRecorded } from "./not-recorded.js";
import { amountStatedIn } from "./stated-amount.js";
import {
  dimensionView,
  legacyFactsFrom,
  projectView,
  quantityFitting,
  relatable,
  SINGLE_VALUED_DIMENSIONS,
  valuesConflict,
  type LegacyIncompleteness,
} from "./statement-view.js";

/**
 * The write path of atomic statements (design 2026-11-14, slice 2).
 *
 * Pure. Given what is on record (statements, links, disagreement events and
 * the legacy facts) and one validated reading of a turn, it decides every
 * row the turn writes, with its id, before anything is written:
 *
 *   - short handles (S<n>, D<n>, T<n>) the model saw map to server ids
 *     here and nowhere else; a handle the server never issued is never
 *     guessed (the statement is kept as NEW, the miss is reported);
 *   - each value is put into its dimension's bounded shape with the same
 *     rules as the legacy path: an amount Q worked out is said back for a
 *     yes, a model never mints document support, a dimension outside the
 *     closed vocabulary is refused;
 *   - a number that disagrees with one on record about the same quantity
 *     and date, with no link, is linked by code (CODE_DETECTED);
 *   - each PERSON turn read gets its reading, the authoritative account of
 *     what was and was not recorded from it;
 *   - the legacy facts of every touched dimension are re-projected from the
 *     statements, so every existing reader keeps working.
 *
 * The plan is checkpointed with the paid reply, so a retry writes the same
 * ids; `completeTurn` writes it in one transaction with Q's reply.
 */

/**
 * 3: read under the one relation rule and prompt v8 (root cause 2026-11-14).
 * 4: prompt v9; a founder's action on a disagreement is applied whatever the
 * turn's intent label, and a CORRECTS hides a figure only when the founder
 * signalled a correction (live 78f8d72d5).
 */
export const STATEMENT_READING_VERSION = 4;

export type StatementContext = {
  readonly statements: readonly ApplicationStatement[];
  readonly links: readonly StatementLink[];
  readonly events: readonly DisagreementEvent[];
};

export const StatementPlanSchema = z
  .object({
    version: z.literal(1),
    /** Handle -> server id (or code-detected key) as the model saw them. */
    handles: z.record(z.string().max(16), z.string().max(120)),
    statements: z.array(ApplicationStatementSchema).max(160),
    links: z.array(StatementLinkSchema).max(160),
    events: z.array(DisagreementEventSchema).max(32),
    readings: z.array(TurnReadingSchema).max(8),
    legacyFacts: z.array(NewApplicationFactSchema).max(40),
  })
  .strict();
export type StatementPlan = z.infer<typeof StatementPlanSchema>;

// ---------------------------------------------------------------------------
// Carrying legacy facts into statements
// ---------------------------------------------------------------------------

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const QUANTITY_OF: Partial<Record<ApplicationDimension, StatementQuantity>> = {
  "claims.revenue": "revenue",
  "raise.amount": "raise_amount",
};

function carriedValues(
  fact: ApplicationFact,
): readonly { value: StatementValue; words: string }[] {
  const value = fact.value;
  switch (value.kind) {
    case "TEXT":
      return [{ value: { kind: "TEXT", text: value.text }, words: value.text }];
    case "CODE":
      return [{ value: { kind: "CODE", code: value.code }, words: value.code }];
    case "AMOUNT":
      return [
        {
          value: /^0(\.0{1,2})?$/u.test(value.amount)
            ? { kind: "ZERO", currency: value.currency }
            : {
                kind: "MONEY",
                amount: value.amount,
                currency: value.currency,
              },
          words: `${value.amount} ${value.currency}`,
        },
      ];
    case "PHRASES":
      return value.phrases.map((phrase) => ({
        value: { kind: "TEXT", text: phrase },
        words: phrase,
      }));
    case "NONE":
      return [
        {
          value:
            value.declined === true
              ? { kind: "UNKNOWN", declined: true }
              : { kind: "UNKNOWN" },
          words:
            value.declined === true ? "(preferred not to say)" : "(unknown)",
        },
      ];
  }
}

/**
 * The id a carried legacy fact always gets: derived from its application
 * and backfill key, so the write path, every reader's view and the
 * backfill script name the same statement by the same id (invariant 8),
 * and a second carry of one fact is the same row, never a second one.
 */
export function backfillStatementId(
  applicationId: string,
  backfillKey: string,
): ApplicationStatementId {
  const hex = createHash("sha256")
    .update(`gateq-backfill:${applicationId}:${backfillKey}`)
    .digest("hex");
  // A version-4-shaped, variant-1 UUID from the digest.
  const variant = ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return ApplicationStatementIdSchema.parse(
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`,
  );
}

/**
 * Legacy facts no statement accounts for, as BACKFILL statements, honestly
 * flagged. A dimension recorded before statements existed, or by the form
 * since, is carried into the statements the first time a turn touches it,
 * so a new statement adds to what was said rather than replacing it. Not
 * yet written: the plan writes the ones its turn touches.
 */
export function legacyCarry(input: {
  readonly applicationId: ApplicationId;
  readonly context: StatementContext;
  readonly legacyFacts: readonly ApplicationFact[];
}): readonly ApplicationStatement[] {
  const view = projectView(
    input.context.statements,
    input.context.links,
    input.context.events,
  );
  const projected = legacyFactsFrom(view).facts;
  const keys = new Set(
    input.context.statements.flatMap((s) =>
      s.backfillKey === null ? [] : [s.backfillKey],
    ),
  );
  const carried: ApplicationStatement[] = [];
  for (const fact of input.legacyFacts) {
    if (fact.supersededAt !== null) continue;
    const mine = projected.find((p) => p.dimension === fact.dimension);
    if (mine !== undefined && sameJson(mine.value, fact.value)) continue;
    // A projection the legacy shape cannot hold (a qualifying answer in
    // disagreement is prose, and the legacy raise is only an amount) was
    // never written: the older legacy value is explained by the statements
    // themselves, not something new to carry.
    if (
      mine !== undefined &&
      !NewApplicationFactSchema.safeParse({
        dimension: mine.dimension,
        value: mine.value,
        provenance: mine.provenance,
      }).success
    )
      continue;
    const values = carriedValues(fact);
    values.forEach((carry, index) => {
      const unknown = carry.value.kind === "UNKNOWN";
      const backfillKey =
        values.length === 1
          ? `legacy-fact:${fact.id}`
          : `legacy-fact:${fact.id}:${index}`;
      // Already carried: the statement on record is this fact.
      if (keys.has(backfillKey)) return;
      const parsed = ApplicationStatementSchema.safeParse({
        id: backfillStatementId(input.applicationId, backfillKey),
        applicationId: input.applicationId,
        dimension: fact.dimension,
        quantity:
          carry.value.kind === "MONEY" || carry.value.kind === "ZERO"
            ? (QUANTITY_OF[fact.dimension] ?? null)
            : null,
        value: carry.value,
        asOf: null,
        words: carry.words.slice(0, 2000),
        provenance: unknown
          ? "UNKNOWN"
          : fact.provenance === "UNKNOWN"
            ? "APPLICANT_PROVIDED"
            : fact.provenance,
        origin: "BACKFILL",
        sourceTurnId: null,
        backfillKey,
        statedAt: fact.recordedAt,
        recordedAt: fact.recordedAt,
      });
      if (parsed.success) carried.push(parsed.data);
    });
  }
  return carried;
}

// ---------------------------------------------------------------------------
// Handles
// ---------------------------------------------------------------------------

export type Handles = {
  readonly statements: ReadonlyMap<string, DimensionViewItem>;
  readonly disagreements: ReadonlyMap<string, DimensionDisagreement>;
  readonly turns: ReadonlyMap<string, string>;
};

/** S<n> for each current statement, D<n> for each standing disagreement. */
export function handlesFor(
  view: ApplicationStatementView,
  unreadTurnIds: readonly string[],
): Handles {
  const statements = new Map<string, DimensionViewItem>();
  const disagreements = new Map<string, DimensionDisagreement>();
  for (const entry of view.dimensions) {
    for (const item of entry.items)
      statements.set(`S${statements.size + 1}`, item);
    for (const disagreement of entry.disagreements) {
      if (!disagreement.active) continue;
      if ([...disagreements.values()].some((d) => d.key === disagreement.key))
        continue;
      disagreements.set(`D${disagreements.size + 1}`, disagreement);
    }
  }
  const turns = new Map<string, string>();
  unreadTurnIds.forEach((id, index) => turns.set(`T${index + 1}`, id));
  return { statements, disagreements, turns };
}

function handleOf(
  map: ReadonlyMap<string, unknown>,
  raw: string | null,
): string | null {
  if (raw === null) return null;
  const handle = raw.trim().toUpperCase();
  return map.has(handle) ? handle : null;
}

function renderValue(value: StatementValue): string {
  switch (value.kind) {
    case "TEXT":
      return value.text;
    case "CODE":
      return value.code;
    case "MONEY":
      return `${value.amount} ${value.currency ?? "(currency not given)"}`;
    case "COUNT":
      return value.count;
    case "PERCENT":
      return `${value.percent}%`;
    case "ZERO":
      return "a stated zero";
    case "UNKNOWN":
      return value.declined === true
        ? "(they preferred not to say)"
        : "(they do not know)";
  }
}

/** KNOWN FACTS: every current statement by handle, grouped by dimension. */
export function renderKnownStatements(
  view: ApplicationStatementView,
  handles: Handles,
  limit = 8000,
): string {
  const handleById = new Map(
    [...handles.statements].map(([handle, item]) => [item.statementId, handle]),
  );
  const lines: string[] = [];
  for (const entry of view.dimensions) {
    if (entry.items.length === 0) continue;
    lines.push(`${entry.dimension} (${entry.status.toLowerCase()})`);
    for (const item of entry.items) {
      const handle = handleById.get(item.statementId) ?? "S?";
      const about = [
        item.quantity,
        item.asOf === null ? null : `as of ${item.asOf}`,
      ]
        .filter((part) => part !== null)
        .join(", ");
      const value = renderValue(item.value);
      const words =
        item.value.kind === "TEXT" && item.value.text === item.words
          ? ""
          : ` - "${item.words.slice(0, 300)}"`;
      lines.push(
        `  ${handle}${about.length > 0 ? ` [${about}]` : ""}: ${value}${words} [${item.provenance}${item.backfilled ? ", carried from earlier records" : ""}]`,
      );
    }
  }
  if (lines.length === 0) return "(nothing yet)";
  const out: string[] = [];
  let length = 0;
  for (const line of lines) {
    if (length + line.length + 1 > limit - 40) {
      out.push("(more on record, not shown)");
      break;
    }
    out.push(line);
    length += line.length + 1;
  }
  return out.join("\n");
}

/** How many Q questions asked about a dimension after a turn sequence. */
export type AskLog = {
  readonly asks: readonly {
    readonly dimension: ApplicationDimension;
    readonly seq: number;
  }[];
  /** A statement's source turn seq; 0 for one with no turn. */
  readonly seqOf: (statementId: string) => number;
};

export function asksSince(
  log: AskLog,
  dimension: ApplicationDimension,
  seq: number,
): number {
  return log.asks.filter((ask) => ask.dimension === dimension && ask.seq > seq)
    .length;
}

/** CONTRADICTIONS: each standing disagreement by handle, never their words. */
export function renderDisagreements(
  handles: Handles,
  view: ApplicationStatementView,
  log: AskLog,
): readonly string[] {
  const handleById = new Map(
    [...handles.statements].map(([handle, item]) => [item.statementId, handle]),
  );
  const dimensionOf = new Map<string, ApplicationDimension>();
  for (const entry of view.dimensions)
    for (const item of entry.items)
      dimensionOf.set(item.statementId, entry.dimension);
  return [...handles.disagreements].map(([handle, d]) => {
    const dimension = dimensionOf.get(d.newerStatementId) ?? "application";
    const older = handleById.get(d.olderStatementId) ?? "an earlier statement";
    const newer = handleById.get(d.newerStatementId) ?? "a later statement";
    const mark =
      d.state === "LEFT_OPEN"
        ? "left open by them"
        : dimension !== "application" &&
            asksSince(log, dimension, log.seqOf(d.newerStatementId)) > 0
          ? "already asked"
          : "ask once";
    return `${handle} ${dimension}: ${older} and ${newer} disagree (${mark})`;
  });
}

// ---------------------------------------------------------------------------
// Reading a turn into rows
// ---------------------------------------------------------------------------

/** Dimensions whose answer is a code in their own closed vocabulary. */
const CODE_DIMENSIONS: ReadonlySet<ApplicationDimension> = new Set([
  "company.country",
  "company.stage",
  "raise.currency",
]);
/** Dimensions that hold no stated nothing (a country is never zero). */
const NO_ZERO: ReadonlySet<ApplicationDimension> = new Set([
  "company.country",
  "company.stage",
  "company.sector_phrases",
  "raise.amount",
  "raise.currency",
]);
/** Words the normaliser puts into a dimension's own shape. */
const SHAPED: ReadonlySet<ApplicationDimension> = new Set([
  "company.country",
  "company.stage",
  "raise.currency",
  "raise.amount",
  "company.sector_phrases",
  "contact.email",
  "company.website",
]);

const DIMENSIONS = new Set<string>(APPLICATION_DIMENSIONS);
/** A stated zero of any of these is a stated zero of revenue. */
const REVENUE_ZERO_QUANTITIES: ReadonlySet<string> = new Set([
  "paying_customers",
  "revenue",
  "mrr",
  "arr",
]);
const NUMERIC_KINDS = new Set(["MONEY", "COUNT", "PERCENT", "ZERO", "UNKNOWN"]);

type Shaped =
  | { readonly ok: true; readonly values: readonly StatementValue[] }
  | { readonly ok: false; readonly region: string | null };

function moneyOf(
  amount: string,
  currency: string | null,
): StatementValue | null {
  if (/^0(\.0{1,2})?$/u.test(amount))
    return currency === null ? { kind: "ZERO" } : { kind: "ZERO", currency };
  return { kind: "MONEY", amount, currency };
}

/** The statement value(s) a read value holds in its dimension's shape. */
function shapeValue(
  dimension: ApplicationDimension,
  value: GateQStatementValue,
  context: {
    readonly said: string;
    readonly currencyOnRecord: string | null;
  },
): Shaped {
  switch (value.kind) {
    case "UNKNOWN":
      return {
        ok: true,
        values: [
          value.declined
            ? { kind: "UNKNOWN", declined: true }
            : { kind: "UNKNOWN" },
        ],
      };
    case "ZERO": {
      if (NO_ZERO.has(dimension)) return { ok: false, region: null };
      const currency = currencyCodeIn(context.said);
      return {
        ok: true,
        values: [
          currency === null ? { kind: "ZERO" } : { kind: "ZERO", currency },
        ],
      };
    }
    case "MONEY": {
      if (
        CODE_DIMENSIONS.has(dimension) ||
        dimension === "company.sector_phrases"
      )
        return { ok: false, region: null };
      const currency =
        value.currency ??
        currencyCodeIn(context.said) ??
        (dimension === "raise.amount" ? context.currencyOnRecord : null);
      const money = moneyOf(value.amount, currency);
      if (money?.kind === "ZERO" && NO_ZERO.has(dimension))
        return { ok: false, region: null };
      return money === null
        ? { ok: false, region: null }
        : { ok: true, values: [money] };
    }
    case "COUNT":
      if (CODE_DIMENSIONS.has(dimension) || dimension === "raise.amount")
        return { ok: false, region: null };
      if (value.count === "0")
        return NO_ZERO.has(dimension)
          ? { ok: false, region: null }
          : { ok: true, values: [{ kind: "ZERO" }] };
      return { ok: true, values: [{ kind: "COUNT", count: value.count }] };
    case "PERCENT":
      if (CODE_DIMENSIONS.has(dimension) || dimension === "raise.amount")
        return { ok: false, region: null };
      return {
        ok: true,
        values: [{ kind: "PERCENT", percent: value.percent }],
      };
    case "TEXT":
    case "CODE": {
      const words = value.kind === "TEXT" ? value.text : value.code;
      if (!SHAPED.has(dimension))
        return {
          ok: true,
          values: [{ kind: "TEXT", text: words.slice(0, 2000) }],
        };
      const normalised = normaliseProposedFact(
        { dimension, value, provenance: "APPLICANT_PROVIDED" },
        { utterance: context.said, currencyOnRecord: context.currencyOnRecord },
      );
      // A stage outside the closed vocabulary is kept in their words as
      // TEXT, never stored as a code the rules would read.
      if (normalised === null && dimension === "company.stage")
        return {
          ok: true,
          values: [{ kind: "TEXT", text: words.slice(0, 2000) }],
        };
      if (normalised === null)
        return {
          ok: false,
          region: dimension === "company.country" ? regionIn(words) : null,
        };
      const shaped = normalised.value;
      switch (shaped.kind) {
        case "CODE":
          return { ok: true, values: [{ kind: "CODE", code: shaped.code }] };
        case "TEXT":
          return {
            ok: true,
            values: [{ kind: "TEXT", text: shaped.text.slice(0, 2000) }],
          };
        case "AMOUNT": {
          const money = moneyOf(shaped.amount, shaped.currency);
          return money === null || money.kind === "ZERO"
            ? { ok: false, region: null }
            : { ok: true, values: [money] };
        }
        case "PHRASES":
          return {
            ok: true,
            values: shaped.phrases.map((phrase) => ({
              kind: "TEXT" as const,
              text: phrase,
            })),
          };
        case "NONE":
          return { ok: true, values: [{ kind: "UNKNOWN" }] };
      }
    }
  }
}

/** One canonical form for "is this the same answer again". */
function canonical(value: StatementValue): string {
  if (value.kind === "TEXT")
    return `TEXT:${value.text.trim().toLowerCase().replace(/\s+/gu, " ")}`;
  return JSON.stringify(value);
}

/**
 * Words with which a founder says an earlier answer was wrong or replaced.
 * Bounded and English: a turn in another language without them is never
 * silently corrected; its two figures stay visible as a disagreement and
 * Q asks which is right (the fail-safe direction).
 */
const CORRECTION_WORDS =
  /\b(?:actually|correct(?:ion|ed|ing)?|sorry|mistaken?|wrong|typo|i meant|meant to say|should (?:be|read|have said)|instead|rather than|scratch that|updated?|revised?)\b/iu;
/** "not 600", "not $350k": the founder names the figure being replaced. */
const NOT_A_FIGURE = /\bnot\s+(?:the\s+)?(?:[$€£]\s*|(?:usd|kes|ksh)\s*)?\d/iu;

/**
 * Whether a reader's CORRECTS of `target` may hide it. On a figure (both
 * ends hold a value about the same metric and period) only when the
 * founder signalled a correction in the words of the turn, or when the
 * target is one side of an OPEN disagreement, which Q asked them to settle.
 * Elsewhere (prose, a contact detail, a code they restate) the reader's
 * explicit reference stands as it did.
 */
function correctionStands(
  target: ApplicationStatement | undefined,
  statement: Pick<
    ApplicationStatement,
    "dimension" | "quantity" | "value" | "asOf" | "sourceTurnId"
  >,
  said: string,
  standing: Iterable<DimensionDisagreement>,
): boolean {
  if (target === undefined) return true;
  const figure =
    statement.quantity !== null &&
    quantityFitting(target.value.kind, target.quantity) ===
      statement.quantity &&
    relatable(target, statement) &&
    canonical(target.value) !== canonical(statement.value);
  if (!figure) return true;
  if (CORRECTION_WORDS.test(said) || NOT_A_FIGURE.test(said)) return true;
  for (const d of standing)
    if (
      d.active &&
      d.state === "OPEN" &&
      (d.olderStatementId === target.id || d.newerStatementId === target.id)
    )
      return true;
  return false;
}

/**
 * A note without its sentences that only ask for a disagreement to be left
 * open ("Still leave it open for Kilima.", "Please leave that open."). The
 * remaining sentences are kept in their own words.
 */
const LEAVE_OPEN_REQUEST =
  /^(?:(?:please|just|still|so|ok(?:ay)?|then|and|but|for now)[,\s]+)*(?:(?:can|could|would|will) you\s+|i'?d like you to\s+|let'?s\s+)?(?:please\s+)?(?:leave|keep)\s+(?:it|that|this|them|those|both|th(?:e|at|ose) [\w\s'-]{1,48}?)\s+(?:open|unresolved|undecided|unsettled|as (?:it is|they are))\b[^.!?]*[.!?]*$/iu;

export function withoutLeaveOpenRequests(text: string): string {
  const sentences = text.match(/[^.!?]+[.!?]*/gu) ?? [text];
  return sentences
    .filter((sentence) => !LEAVE_OPEN_REQUEST.test(sentence.trim()))
    .join("")
    .trim();
}

export type PlanTurn = {
  /** `application_turns.id`; null only where there is no transcript. */
  readonly id: string | null;
  readonly text: string;
};

export type PlanInput = {
  readonly applicationId: ApplicationId;
  /** Persisted rows plus the not-yet-written legacy carry. */
  readonly context: StatementContext;
  readonly carried: readonly ApplicationStatement[];
  readonly legacyFacts: readonly ApplicationFact[];
  readonly handles: Handles;
  readonly current: PlanTurn;
  /** The current turn was already read: nothing from it is read again. */
  readonly currentRead?: boolean | undefined;
  /** Unread earlier PERSON turns, oldest first, as T1, T2 ... */
  readonly unread: readonly PlanTurn[];
  readonly statements: readonly (GateQStatementOp | null)[];
  readonly actions: readonly (GateQDisagreementAction | null)[];
  /**
   * True when the reading labelled the turn not about the application
   * (small talk, a question for Q, ...): its value statements are dropped.
   * The label never drops the founder's own action on a disagreement on
   * record (a leave-open or a settling): see `planReading`.
   */
  readonly discard: boolean;
  /**
   * True when the turn was read as an attempt to steer Q (SABOTAGE). Such a
   * turn may still leave a disagreement open (it hides nothing), but it
   * never settles one.
   */
  readonly sabotage?: boolean | undefined;
  /** The dimension Q's last line asked about, if any. */
  readonly lastAsked?: ApplicationDimension | null | undefined;
  /** Whether they agreed to a figure Q read back. */
  readonly agreedTo: (amount: string) => boolean;
  /** Figures Q read back that they agreed to, recorded as said. */
  readonly agreedReadBacks: readonly NotRecorded[];
  readonly now: Date;
};

export type PlanOutcome = {
  readonly plan: StatementPlan;
  /** Read but refused: counted for diagnostics. */
  readonly rejected: number;
  /** Worked-out figures to say back for a yes. */
  readonly readBacks: readonly NotRecorded[];
  /** A region given for the country, asked down to a country. */
  readonly narrowTo: string | null;
  /** New statements recorded from what they just said and the unread turns. */
  readonly recordedCount: number;
  /**
   * Disagreements a "left open" sentence may truthfully be about after this
   * turn: an event written now, one already left open that it named, or,
   * when no OPEN disagreement stands, every standing LEFT_OPEN one. Q may
   * say it is leaving something unresolved only when this is above zero.
   */
  readonly leftOpenCount: number;
  readonly incomplete: readonly LegacyIncompleteness[];
};

const at = (ms: number) => new Date(ms).toISOString();

function latestInstant(context: StatementContext): number {
  let latest = 0;
  for (const s of context.statements)
    latest = Math.max(latest, Date.parse(s.statedAt));
  for (const l of context.links)
    latest = Math.max(latest, Date.parse(l.createdAt));
  for (const e of context.events)
    latest = Math.max(latest, Date.parse(e.recordedAt));
  return latest;
}

export function planReading(input: PlanInput): PlanOutcome {
  const { applicationId } = input;
  const existing = [...input.context.statements, ...input.carried];
  const byId = new Map(existing.map((s) => [s.id, s] as const));
  const baseView = projectView(
    existing,
    input.context.links,
    input.context.events,
  );
  const visible = new Set<string>();
  for (const entry of baseView.dimensions)
    for (const item of entry.items) visible.add(item.statementId);
  const legacyOn = (dimension: ApplicationDimension) =>
    input.legacyFacts.find(
      (fact) => fact.dimension === dimension && fact.supersededAt === null,
    );
  const currencyOnRecord = (() => {
    const held = baseView.dimensions
      .find((d) => d.dimension === "raise.currency")
      ?.items.filter((item) => item.value.kind === "CODE")
      .at(-1)?.value;
    return held?.kind === "CODE" ? held.code : null;
  })();

  // Ordering: every new row is later than everything on record, oldest
  // turn first, one millisecond apart, so "to is older than from" holds
  // and the projector orders them as said.
  let clock = Math.max(
    input.now.getTime(),
    latestInstant({ ...input.context, statements: existing }) + 1,
  );
  const tick = () => at(clock++);

  const turnsRead: PlanTurn[] =
    input.currentRead === true
      ? [...input.unread]
      : [...input.unread, input.current];
  const perTurn = new Map<
    string,
    {
      recorded: ApplicationStatementId[];
      notRecorded: StatementNotRecorded[];
      proposed: number;
    }
  >();
  const turnKey = (turn: PlanTurn) => turn.id ?? "current";
  for (const turn of turnsRead)
    perTurn.set(turnKey(turn), { recorded: [], notRecorded: [], proposed: 0 });
  const note = (turn: PlanTurn, entry: StatementNotRecorded) => {
    const slot = perTurn.get(turnKey(turn));
    if (slot !== undefined && slot.notRecorded.length < 32)
      slot.notRecorded.push(entry);
  };

  const handlesUsed: Record<string, string> = {};
  for (const [handle, item] of input.handles.statements)
    handlesUsed[handle] = item.statementId;
  for (const [handle, d] of input.handles.disagreements)
    handlesUsed[handle] = d.key;
  for (const [handle, id] of input.handles.turns) handlesUsed[handle] = id;

  const newStatements: ApplicationStatement[] = [];
  const links: StatementLink[] = [];
  const events: DisagreementEvent[] = [];
  const readBacks: NotRecorded[] = [];
  let narrowTo: string | null = null;
  let rejected = 0;
  const touched = new Set<ApplicationDimension>();

  const link = (
    kind: StatementLink["kind"],
    from: ApplicationStatementId,
    to: ApplicationStatementId,
    origin: StatementLink["origin"],
    turnId: string | null,
  ): StatementLink | null => {
    if (from === to) return null;
    // Unknown stays unknown: an UNKNOWN end never forms a disagreement
    // (live 2026-11-14: "leave it open" stored as 600 vs "Not known").
    if (kind === "DISAGREES") {
      const ends = [from, to].map(
        (id) => byId.get(id) ?? newStatements.find((s) => s.id === id),
      );
      if (ends.some((end) => end === undefined || end.value.kind === "UNKNOWN"))
        return null;
    }
    if (
      links.some(
        (l) =>
          l.kind === kind &&
          l.fromStatementId === from &&
          l.toStatementId === to,
      )
    )
      return null;
    const made: StatementLink = {
      id: StatementLinkIdSchema.parse(randomUUID()),
      applicationId,
      kind,
      fromStatementId: from,
      toStatementId: to,
      origin,
      sourceTurnId: turnId as ApplicationTurnId | null,
      createdAt: tick(),
    };
    links.push(made);
    return made;
  };

  // One thing said once is one statement (live 78f8d72d5 t46: "We reach
  // data teams through the CFOs at our 4 pilot companies…" was stored as a
  // COUNT and again as prose in the same words, and shown twice). Within a
  // reading, an exact repeat keeps its first copy, and prose in the same
  // words as a figure on the same dimension is that figure's words.
  const sameWords = (a: string, b: string) =>
    a.trim().toLowerCase().replace(/\s+/gu, " ") ===
    b.trim().toLowerCase().replace(/\s+/gu, " ");
  const ops = input.statements.filter((op, index, all) => {
    if (op === null) return true;
    return !all.some(
      (other, j) =>
        other !== null &&
        j !== index &&
        other.turn === op.turn &&
        other.dimension === op.dimension &&
        sameWords(other.words, op.words) &&
        ((j < index &&
          other.op === op.op &&
          other.target === op.target &&
          (other.quantity ?? null) === (op.quantity ?? null) &&
          JSON.stringify(other.value) === JSON.stringify(op.value)) ||
          (op.value.kind === "TEXT" &&
            other.value.kind !== "TEXT" &&
            other.value.kind !== "UNKNOWN")),
    );
  });

  /** The visible held values on a dimension, plus this turn's new ones. */
  const heldOn = (dimension: ApplicationDimension) => [
    ...(baseView.dimensions.find((d) => d.dimension === dimension)?.items ?? [])
      .map((item) => byId.get(item.statementId))
      .filter((s): s is ApplicationStatement => s !== undefined),
    ...newStatements.filter((s) => s.dimension === dimension),
  ];

  const add = (
    op: GateQStatementOp,
    turn: PlanTurn,
    value: StatementValue,
    dimension: ApplicationDimension,
    words: string,
    target: ApplicationStatementId | null,
  ) => {
    const unknown = value.kind === "UNKNOWN";
    // The quantity it names only when its value fits it (a share is not a
    // number of users): the relation rule reads the same fit.
    const quantity = NUMERIC_KINDS.has(value.kind)
      ? (quantityFitting(
          value.kind,
          op.quantity ?? QUANTITY_OF[dimension] ?? null,
        ) as StatementQuantity | null)
      : null;
    // A model never mints document support: only a value already on
    // record with it keeps it (the confirmation path is the Evidence one).
    const legacy = legacyOn(dimension);
    const provenance: FactProvenance = unknown
      ? "UNKNOWN"
      : op.provenance === "UNKNOWN"
        ? "APPLICANT_PROVIDED"
        : op.provenance === "DOCUMENT_SUPPORTED" &&
            legacy?.provenance !== "DOCUMENT_SUPPORTED"
          ? "APPLICANT_PROVIDED"
          : op.provenance;
    const held = heldOn(dimension);
    // A CORRECTS hides its target, so on a figure it stands only when the
    // founder said the earlier one was wrong or replaced, or settled the
    // pair Q asked about. A different figure for the same metric said
    // without that is a second answer, read as NEW: the same answer again
    // writes nothing, and a different one falls to the relation rule below
    // and stays visible as a disagreement (live 78f8d72d5 t16: "Back to
    // users: about 1,500 weekly active users" silently corrected 600).
    const related =
      target !== null &&
      op.op === "CORRECTS" &&
      !correctionStands(
        byId.get(target),
        {
          dimension,
          quantity,
          value,
          asOf: op.asOf,
          sourceTurnId: turn.id as ApplicationTurnId | null,
        },
        turn.text,
        input.handles.disagreements.values(),
      )
        ? null
        : target;
    const asNew = op.op === "NEW" || (op.op === "CORRECTS" && related === null);
    // The same answer again is already on record: nothing new to write.
    if (
      asNew &&
      held.some(
        (s) =>
          canonical(s.value) === canonical(value) &&
          (s.quantity === quantity || value.kind === "TEXT") &&
          s.asOf === op.asOf,
      )
    )
      return;
    const statedAt = tick();
    const parsed = ApplicationStatementSchema.safeParse({
      id: randomUUID(),
      applicationId,
      dimension,
      quantity,
      value,
      asOf: op.asOf,
      words: words.slice(0, 2000),
      provenance,
      origin: "TURN",
      sourceTurnId: turn.id,
      backfillKey: null,
      statedAt,
      recordedAt: statedAt,
    });
    if (!parsed.success) {
      // Only a transcript-free composition has no turn id; it writes no
      // statements, so the projection stands in with a placeholder id.
      if (turn.id !== null) {
        rejected += 1;
        note(turn, {
          dimension,
          words: words.slice(0, 600),
          reason: "INVALID_VALUE",
        });
        return;
      }
    }
    const statement: ApplicationStatement = parsed.success
      ? parsed.data
      : ({
          id: ApplicationStatementIdSchema.parse(randomUUID()),
          applicationId,
          dimension,
          quantity,
          value,
          asOf: op.asOf,
          words: words.slice(0, 2000),
          provenance,
          origin: "TURN",
          sourceTurnId: null,
          backfillKey: null,
          statedAt,
          recordedAt: statedAt,
        } satisfies ApplicationStatement);
    newStatements.push(statement);
    touched.add(dimension);
    perTurn.get(turnKey(turn))?.recorded.push(statement.id);

    if (related !== null && (op.op === "CORRECTS" || op.op === "DISAGREES")) {
      const targetStatement = byId.get(related);
      // The reader's DISAGREES S<n> is a relation like any other: it
      // stands only under the relation rule (the same metric, period and
      // a held value on both sides). Failing it, the statement is kept as
      // said, linked to nothing, never forced onto another metric.
      if (
        op.op === "CORRECTS" ||
        (targetStatement !== undefined &&
          relatable(targetStatement, statement, { explicit: true }))
      ) {
        link(op.op, statement.id, related, "MODEL_READING", turn.id);
        if (targetStatement !== undefined)
          touched.add(targetStatement.dimension);
        return;
      }
    }
    // Code-detected disagreement: a number about the same metric, for what
    // may be the same period, said in another turn, that differs from one
    // on record, with no link (the relation rule, `relatable`). An unknown
    // date is never assumed to be another period (live 2026-11-14: undated
    // 600 and 1,500 weekly active stood side by side with no disagreement);
    // two figures from one turn are a change said once, never a
    // disagreement (live 06910b145: "from 1 partner school to 4").
    for (const other of held) {
      if (
        other.id === statement.id ||
        statement.quantity === null ||
        !relatable(other, statement) ||
        !valuesConflict(other.value, statement.value)
      )
        continue;
      link("DISAGREES", statement.id, other.id, "CODE_DETECTED", turn.id);
    }
    // A qualifying answer that differs from the one on record, said as new,
    // is a disagreement until they settle it (decision 91), never silently
    // the latest.
    if (
      QUALIFYING_DIMENSIONS.includes(dimension) &&
      dimension !== "company.sector_phrases" &&
      statement.value.kind !== "UNKNOWN"
    ) {
      const latest = held
        .filter((s) => s.id !== statement.id && relatable(s, statement))
        .at(-1);
      if (
        latest !== undefined &&
        canonical(latest.value) !== canonical(statement.value) &&
        !(
          statement.quantity !== null &&
          valuesConflict(latest.value, statement.value)
        )
      )
        link("DISAGREES", statement.id, latest.id, "CODE_DETECTED", turn.id);
    }
  };

  // "Leave it open" said while a disagreement about the same thing stands
  // is a LEAVE_OPEN on that disagreement, never an "I don't know"
  // statement (live 2026-11-14): read from the structured op (an UNKNOWN,
  // not declined), never from words.
  const implicitActions: GateQDisagreementAction[] = [];
  // The standing disagreements (OPEN, or already LEFT_OPEN: naming one
  // already left open is true to say and writes nothing) the UNKNOWN is
  // about: the one its own S<n> target stands in, or one whose two sides
  // are about the same dimension AND the same metric as the UNKNOWN. A
  // dimension alone is not "the same thing" (live 06910b145: "We don't
  // know our CAC yet" was swallowed into the 1-vs-4 partner schools pair,
  // both on traction).
  const standingOn = (op: GateQStatementOp) => {
    const handle = handleOf(input.handles.statements, op.target);
    const targetId =
      handle === null
        ? null
        : (input.handles.statements.get(handle)?.statementId ?? null);
    const quantity = op.quantity ?? null;
    return [...input.handles.disagreements].filter(([, d]) => {
      if (!d.active || d.state === "RESOLVED") return false;
      const ends = [d.olderStatementId, d.newerStatementId];
      if (targetId !== null) return ends.includes(targetId);
      return ends.every((id) => {
        const end = byId.get(id);
        return (
          end !== undefined &&
          end.dimension === op.dimension &&
          quantityFitting(end.value.kind, end.quantity) === quantity
        );
      });
    });
  };

  // A request to leave a disagreement open is never a founder's note (live
  // 78f8d72d5: "Still leave it open for Kilima." in the Founder's note).
  // While a disagreement stands, a note's sentence that only asks for that
  // is dropped from the note; the action itself is the reading's (above
  // and below), never inferred from these words.
  const anyStanding = [...input.handles.disagreements.values()].some(
    (d) => d.active && d.state !== "RESOLVED",
  );
  const asSaid = (op: GateQStatementOp): GateQStatementOp | null => {
    if (
      op.dimension === "application.note" &&
      op.value.kind === "TEXT" &&
      anyStanding
    ) {
      const words = withoutLeaveOpenRequests(op.words);
      const text = withoutLeaveOpenRequests(op.value.text);
      if (words.length === 0 || text.length === 0) return null;
      return words === op.words && text === op.value.text
        ? op
        : { ...op, words, value: { kind: "TEXT", text } };
    }
    // "Not known" is about something, never about a note: said in answer
    // to Q's question on a dimension that holds nothing yet, it is that
    // dimension's stated unknown (live 78f8d72d5 t22: "We haven't sized
    // the market bottom-up yet" stored as a note, so Market showed as
    // Missing, not as a stated unknown).
    const asked = input.lastAsked ?? null;
    if (
      op.dimension === "application.note" &&
      op.value.kind === "UNKNOWN" &&
      op.turn === null &&
      asked !== null &&
      asked !== "application.note" &&
      dimensionView(baseView, asked).status === "UNANSWERED"
    )
      return { ...op, dimension: asked, quantity: null };
    return op;
  };

  for (const read of ops) {
    if (read === null) {
      rejected += 1;
      continue;
    }
    // A left-open intent is an event on the disagreement, never a value
    // statement, whichever op the reading chose (NEW or DISAGREES S<n>;
    // live 2026-11-14 turns 18 and 38).
    const standing =
      read.turn === null &&
      read.op !== "CORRECTS" &&
      read.value.kind === "UNKNOWN" &&
      read.value.declined !== true
        ? standingOn(read)
        : [];
    if (standing.length > 0) {
      for (const [handle] of standing)
        implicitActions.push({
          disagreement: handle,
          action: "LEAVE_OPEN",
          keep: null,
        });
      continue;
    }
    // The intent label drops value statements only. The founder's own
    // action on a disagreement on record (just above, and the reading's
    // disagreementActions below) never depends on it (live 78f8d72d5:
    // three bare "leave it open" turns labelled QUESTION_FOR_Q recorded
    // nothing).
    if (input.discard) {
      rejected += 1;
      continue;
    }
    const op = asSaid(read);
    if (op === null) continue;
    // Which turn said it. A T<n> the server did not issue is never guessed.
    let turn: PlanTurn = input.current;
    if (op.turn !== null) {
      const handle = handleOf(input.handles.turns, op.turn);
      const index = handle === null ? -1 : Number(handle.slice(1)) - 1;
      const found = index >= 0 ? input.unread[index] : undefined;
      if (found === undefined) {
        rejected += 1;
        note(input.current, {
          dimension: DIMENSIONS.has(op.dimension)
            ? (op.dimension as ApplicationDimension)
            : null,
          words: `${op.turn}: ${op.words}`.slice(0, 600),
          reason: "UNKNOWN_HANDLE",
        });
        continue;
      }
      turn = found;
    }
    if (turn === input.current && input.currentRead === true) continue;
    const slot = perTurn.get(turnKey(turn));
    if (slot !== undefined) slot.proposed += 1;
    if (!DIMENSIONS.has(op.dimension)) {
      rejected += 1;
      note(turn, {
        dimension: null,
        words: op.words.slice(0, 600),
        reason: "OUT_OF_SCOPE",
      });
      continue;
    }
    const dimension = op.dimension as ApplicationDimension;
    const shaped = shapeValue(dimension, op.value, {
      said: `${op.words} ${turn.text}`,
      currencyOnRecord,
    });
    if (!shaped.ok) {
      if (shaped.region !== null) narrowTo = shaped.region;
      rejected += 1;
      note(turn, {
        dimension,
        words: op.words.slice(0, 600),
        reason: "INVALID_VALUE",
      });
      continue;
    }
    // An amount must be one they said, or agreed to when Q said it back.
    const workedOut = shaped.values.find(
      (value) =>
        value.kind === "MONEY" &&
        op.value.kind !== "ZERO" &&
        !amountStatedIn(value.amount, turn.text) &&
        !input.agreedTo(value.amount),
    );
    if (workedOut?.kind === "MONEY") {
      rejected += 1;
      if (workedOut.currency !== null)
        readBacks.push({
          dimension,
          reason: "AMOUNT_READ_BACK",
          amount: workedOut.amount,
          currency: workedOut.currency,
        });
      note(turn, {
        dimension,
        words: op.words.slice(0, 600),
        reason: "AMOUNT_READ_BACK",
      });
      continue;
    }
    // The statement it corrects or disagrees with, by handle only.
    let target: ApplicationStatementId | null = null;
    if (op.op !== "NEW") {
      const handle = handleOf(input.handles.statements, op.target);
      const item =
        handle === null ? undefined : input.handles.statements.get(handle);
      if (item === undefined) {
        // Never guessed: kept as a new statement, and the miss reported.
        note(turn, {
          dimension,
          words: `${op.op} ${op.target ?? "(none)"}: ${op.words}`.slice(0, 600),
          reason: "UNKNOWN_HANDLE",
        });
      } else target = item.statementId;
    }
    for (const value of shaped.values)
      add(op, turn, value, dimension, op.words, target);
  }

  // Their yes to a figure Q read back is theirs, whether or not the
  // reading proposed it again.
  if (!input.discard && input.currentRead !== true)
    for (const back of input.agreedReadBacks) {
      if (newStatements.some((s) => s.dimension === back.dimension)) continue;
      add(
        {
          op: "NEW",
          target: null,
          turn: null,
          dimension: back.dimension,
          quantity: QUANTITY_OF[back.dimension] ?? null,
          value: {
            kind: "MONEY",
            amount: back.amount,
            currency: back.currency,
          },
          asOf: null,
          words:
            input.current.text.slice(0, 600) ||
            `${back.amount} ${back.currency}`,
          provenance: "APPLICANT_PROVIDED",
        },
        input.current,
        { kind: "MONEY", amount: back.amount, currency: back.currency },
        back.dimension,
        input.current.text.slice(0, 600) || `${back.amount} ${back.currency}`,
        null,
      );
    }

  // A stated zero of paying customers is a stated zero of revenue: the
  // same words, the same turn, recorded where revenue is read, so "settled"
  // is one fact for the asking plan and every reader (live 06910b145:
  // "Nobody pays yet" was read only as paying customers = 0, and revenue
  // was asked five more times). Only when revenue holds nothing yet: an
  // amount on record is never contradicted by code.
  if (
    !input.discard &&
    !heldOn("claims.revenue").some((s) => s.value.kind !== "UNKNOWN")
  ) {
    const zero = newStatements.find(
      (s) =>
        s.value.kind === "ZERO" &&
        s.dimension !== "claims.revenue" &&
        s.quantity !== null &&
        REVENUE_ZERO_QUANTITIES.has(s.quantity),
    );
    if (zero !== undefined) {
      const turn = [input.current, ...input.unread].find(
        (t) => t.id === zero.sourceTurnId,
      );
      if (turn !== undefined)
        add(
          {
            op: "NEW",
            target: null,
            turn: null,
            dimension: "claims.revenue",
            quantity: "revenue",
            value: { kind: "ZERO" },
            asOf: zero.asOf,
            words: zero.words.slice(0, 600),
            provenance:
              zero.provenance === "UNKNOWN"
                ? "APPLICANT_PROVIDED"
                : zero.provenance === "DOCUMENT_SUPPORTED"
                  ? "APPLICANT_PROVIDED"
                  : zero.provenance,
          },
          turn,
          { kind: "ZERO" },
          "claims.revenue",
          zero.words,
          null,
        );
    }
  }

  // What they said about a disagreement on record.
  const corrected = new Set(
    links.filter((l) => l.kind === "CORRECTS").map((l) => l.toStatementId),
  );
  let leftOpen = 0;
  const actions = [...input.actions, ...implicitActions].filter(
    (action, index, all) =>
      action === null ||
      all.findIndex(
        (other) =>
          other !== null &&
          other.disagreement.trim().toUpperCase() ===
            action.disagreement.trim().toUpperCase() &&
          other.action === action.action,
      ) === index,
  );
  // Whatever the turn's intent label: a leave-open or a settling is the
  // founder's own act on a D<n> the server issued, checked by handle below.
  // Only a turn read as steering Q never settles one (it may leave one open,
  // which hides nothing).
  for (const action of actions) {
    if (action === null) {
      rejected += 1;
      continue;
    }
    if (action.action === "RESOLVE" && input.sabotage === true) {
      rejected += 1;
      continue;
    }
    const handle = handleOf(input.handles.disagreements, action.disagreement);
    const disagreement =
      handle === null ? undefined : input.handles.disagreements.get(handle);
    if (disagreement === undefined) {
      note(input.current, {
        dimension: null,
        words: `${action.action} ${action.disagreement}`.slice(0, 600),
        reason: "UNKNOWN_HANDLE",
      });
      continue;
    }
    // A correction of either side already settles it.
    if (
      corrected.has(disagreement.olderStatementId) ||
      corrected.has(disagreement.newerStatementId)
    )
      continue;
    let resolvedBy: ApplicationStatementId | null = null;
    if (action.action === "RESOLVE") {
      const keepHandle = handleOf(input.handles.statements, action.keep);
      const keep =
        keepHandle === null
          ? undefined
          : input.handles.statements.get(keepHandle);
      const newer = byId.get(disagreement.newerStatementId);
      const keepStatement =
        keep === undefined ? undefined : byId.get(keep.statementId);
      const valid =
        keepStatement !== undefined &&
        newer !== undefined &&
        (keepStatement.id === disagreement.olderStatementId ||
          keepStatement.id === disagreement.newerStatementId ||
          Date.parse(keepStatement.statedAt) > Date.parse(newer.statedAt));
      if (!valid || keepStatement === undefined) {
        note(input.current, {
          dimension: null,
          words:
            `RESOLVE ${action.disagreement} keep ${action.keep ?? "(none)"}`.slice(
              0,
              600,
            ),
          reason: "UNKNOWN_HANDLE",
        });
        continue;
      }
      resolvedBy = keepStatement.id;
    } else if (disagreement.state === "LEFT_OPEN") {
      // Already left open: true to say so, nothing new to write.
      leftOpen += 1;
      continue;
    }
    // A disagreement code found with no stored link gets its link first.
    let linkId = disagreement.linkId;
    if (linkId === null) {
      const made = link(
        "DISAGREES",
        disagreement.newerStatementId,
        disagreement.olderStatementId,
        "CODE_DETECTED",
        input.current.id,
      );
      if (made === null) continue;
      linkId = made.id;
    }
    events.push({
      id: DisagreementEventIdSchema.parse(randomUUID()),
      applicationId,
      linkId,
      state: action.action === "RESOLVE" ? "RESOLVED" : "LEFT_OPEN",
      resolvedByStatementId: resolvedBy,
      sourceTurnId: input.current.id as ApplicationTurnId | null,
      recordedAt: tick(),
    });
    if (action.action === "LEAVE_OPEN") leftOpen += 1;
    for (const end of [
      disagreement.olderStatementId,
      disagreement.newerStatementId,
    ]) {
      const dimension = byId.get(end)?.dimension;
      if (dimension !== undefined) touched.add(dimension);
    }
  }

  // The legacy carry a touched dimension needs, written first.
  const carried = input.carried.filter((s) => touched.has(s.dimension));
  const allStatements = [
    ...input.context.statements,
    ...carried,
    ...newStatements,
  ];
  const allLinks = [...input.context.links, ...links];
  const view = projectView(allStatements, allLinks, [
    ...input.context.events,
    ...events,
  ]);
  const projected = legacyFactsFrom(view);
  // "Left open" is a claim about recorded state, not only about this
  // turn's writes: once the turn is applied, if every disagreement still
  // standing is LEFT_OPEN, a sentence saying they are left open cannot be
  // about anything else, and it is true (live 06910b145 t39/t41: Q's true
  // "I'll leave those open" was replaced by "I haven't marked those two
  // answers as left open yet", though they had been since t18). With any
  // OPEN one standing, only this turn's own events or named handles count.
  const standingAfter = new Map<string, DisagreementState>();
  for (const entry of view.dimensions)
    for (const d of entry.disagreements)
      if (d.active && d.state !== "RESOLVED") standingAfter.set(d.key, d.state);
  if (
    leftOpen === 0 &&
    [...standingAfter.values()].some((state) => state === "LEFT_OPEN") &&
    ![...standingAfter.values()].some((state) => state === "OPEN")
  )
    leftOpen = [...standingAfter.values()].length;
  const legacyFacts: NewApplicationFact[] = [];
  for (const dimension of APPLICATION_DIMENSIONS) {
    if (!touched.has(dimension)) continue;
    const fact = projected.facts.find((f) => f.dimension === dimension);
    if (fact === undefined) continue;
    const current = legacyOn(dimension);
    if (
      current !== undefined &&
      sameJson(current.value, fact.value) &&
      current.provenance === fact.provenance
    )
      continue;
    const parsed = NewApplicationFactSchema.safeParse({
      dimension,
      value: fact.value,
      provenance: fact.provenance,
    });
    if (parsed.success) legacyFacts.push(parsed.data);
  }

  const readings: TurnReading[] = [];
  for (const turn of turnsRead) {
    if (turn.id === null) continue;
    const slot = perTurn.get(turnKey(turn));
    if (slot === undefined) continue;
    const recorded = slot.recorded.slice(0, 64);
    readings.push(
      TurnReadingSchema.parse({
        id: TurnReadingIdSchema.parse(randomUUID()),
        applicationId,
        turnId: turn.id,
        outcome:
          recorded.length > 0
            ? "READ"
            : slot.proposed > 0 && slot.notRecorded.length > 0
              ? "REJECTED"
              : "NO_STATEMENTS",
        recordedStatementIds: recorded,
        notRecorded: slot.notRecorded,
        readingVersion: STATEMENT_READING_VERSION,
        recordedAt: tick(),
      }),
    );
  }

  const plan: StatementPlan = {
    version: 1,
    handles: handlesUsed,
    statements: [...carried, ...newStatements],
    links,
    events,
    readings,
    legacyFacts,
  };
  return {
    plan,
    rejected,
    readBacks,
    narrowTo,
    recordedCount: newStatements.length,
    leftOpenCount: leftOpen,
    incomplete: projected.incomplete,
  };
}

// ---------------------------------------------------------------------------
// Invariant 7: Q never claims success without the authoritative result
// ---------------------------------------------------------------------------

const CLAIMS_RECORDED =
  /\b(?:noted|recorded|saved|logged|captured|added (?:that|it|this)|(?:i've|i have|i'll) (?:got|note|add|record|save|log|capture)\w*(?: (?:that|it|this))?(?: down)?|on (?:the|your) (?:record|application) now)\b/iu;

const sentencesOf = (text: string): readonly string[] =>
  text.trim().match(/[^.!?]+[.!?]*/gu) ?? [text];

/** A sentence's clauses, each with the separator that ends it. */
const clausesOf = (sentence: string): readonly string[] =>
  sentence.split(/(?<=[;:–—])|(?<=,)(?!\d)/u);

/**
 * How a clause of a question opens: an auxiliary or question word ("should
 * I leave it open?"), an offer with no subject ("leave it open for
 * Kilima?") or an alternative ("or settle it now?").
 */
const ASKS =
  /^(?:or|should|shall|do|does|did|can|could|would|will|is|are|was|were|am|may|might|must|have|has|had|what|which|how|why|where|when|who|whom|whose|want|leave|keep|mark|flag|any|anything)\b/u;
const LEADING_FILLER =
  /^(?:(?:and|but|so|then|well|okay|ok|right|now|sure|great)\b[\s,]*)+/u;

/**
 * A sentence split into what it asserts and what it asks. A sentence that
 * does not end in "?" asserts all of it. One that does still asserts every
 * clause that is not itself a question (live 78f8d72d5 t39: "I'll leave the
 * weekly-active figures open for Kilima; what would you like to know…?" was
 * skipped whole because of its "?", and no left-open event existed).
 */
function partsOf(sentence: string): {
  readonly asserted: readonly string[];
  readonly asked: readonly string[];
} {
  const clauses = clausesOf(sentence);
  if (!sentence.trim().endsWith("?")) return { asserted: clauses, asked: [] };
  const asserted: string[] = [];
  const asked: string[] = [];
  for (const clause of clauses) {
    const lead = clause
      .trim()
      .toLowerCase()
      .replace(/^[^\p{L}']+/u, "")
      .replace(LEADING_FILLER, "");
    // A bare filler clause ("So,") asks and claims nothing.
    if (lead.length === 0 || ASKS.test(lead)) asked.push(clause);
    else asserted.push(clause);
  }
  return { asserted, asked };
}

/**
 * A denial is not a claim: "I haven't marked those two answers as left open
 * yet" (the deterministic line itself) says nothing was left open.
 */
const DENIED =
  /\b(?:haven't|have not|hasn't|has not|won't|will not|didn't|did not|not)\s+(?:yet\s+)?(?:been\s+)?(?:leav|left|keep|mark|flag|not|record|sav|log|captur|add)\w*[^.!?,;]*/giu;

const asserts = (sentence: string, claim: RegExp): boolean =>
  claim.test(partsOf(sentence).asserted.join(" ").replace(DENIED, " "));

/** The sentence without what it asserts, if it asks something. */
function askedPartOf(sentence: string): string {
  const asked = partsOf(sentence).asked.join("").trim();
  const tidy = asked.replace(/^[,;:–—\s]+/u, "");
  return `${tidy.charAt(0).toUpperCase()}${tidy.slice(1)}`;
}

/**
 * Whether a reply claims something was recorded. A question ("have you
 * logged any sales?") claims nothing; a claim joined to one still does.
 */
export function claimsRecording(text: string): boolean {
  return sentencesOf(text).some((sentence) =>
    asserts(sentence, CLAIMS_RECORDED),
  );
}

/** The deterministic line when nothing from the turn was recorded. */
export const NOT_RECORDED_LINE =
  "I haven't put anything from that on your application yet.";

const CLAIMS_LEFT_OPEN =
  /\b(?:leav(?:e|ing)|left|keep(?:ing)?|mark(?:ing|ed)?|flag(?:ging|ged)?)\b[^.!?]*\b(?:unresolved|open|undecided|unsettled|as (?:it|they) (?:is|are|stand))\b/iu;

/**
 * Whether a reply claims a disagreement was left open. Every sentence is
 * checked whatever its punctuation; only a clause that is itself a
 * question ("shall I leave it open?") claims nothing.
 */
export function claimsLeftOpen(text: string): boolean {
  return sentencesOf(text).some((sentence) =>
    asserts(sentence, CLAIMS_LEFT_OPEN),
  );
}

/** The deterministic line when a disagreement was not left open. */
export const NOT_LEFT_OPEN_LINE =
  "I haven't marked those two answers as left open yet.";

/** The reply without the claim: sentences dropped, questions kept. */
function withoutClaim(text: string, claim: RegExp): string {
  return sentencesOf(text)
    .map((sentence) =>
      asserts(sentence, claim) ? askedPartOf(sentence) : sentence.trim(),
    )
    .filter((sentence) => sentence.length > 0)
    .join(" ")
    .trim();
}

/**
 * The reply, held to the turn's reading: a claim that something was
 * recorded stands only when the reading recorded a statement, and one that
 * a disagreement is left open only when a LEFT_OPEN stands (invariant 7).
 * Otherwise the claim is removed, whatever sentence it shares, and the
 * deterministic line says what is true.
 */
export function replyHeldToReading(
  reply: string,
  recordedCount: number,
  leftOpenCount?: number,
): string {
  let text = reply;
  if (
    leftOpenCount !== undefined &&
    leftOpenCount === 0 &&
    claimsLeftOpen(text)
  )
    text =
      `${NOT_LEFT_OPEN_LINE} ${withoutClaim(text, CLAIMS_LEFT_OPEN)}`.trim();
  if (recordedCount > 0 || !claimsRecording(text)) return text.slice(0, 4000);
  return `${NOT_RECORDED_LINE} ${withoutClaim(text, CLAIMS_RECORDED)}`
    .trim()
    .slice(0, 4000);
}

/** The intake contract's quantity list, for the identity test with q-core. */
export const PLAN_QUANTITIES = StatementQuantitySchema.options;

// ---------------------------------------------------------------------------
// The form (slice 3)
// ---------------------------------------------------------------------------

/**
 * The rows a form save writes (slice 3, fixed after live 2026-11-14).
 *
 * A form save is an explicit founder action on the fields it carries, and
 * it may only change what the founder changed:
 *
 *   - unchanged is nothing: a field whose value is already what the form
 *     last said, or already a current answer with no different form answer
 *     beside it, writes no statement, no link and no legacy fact (live: 35
 *     "earlier answers, corrected" from re-saving identical values);
 *   - a changed field CORRECTS only earlier form answers (and legacy
 *     records carried in) on its dimension. It never supersedes an
 *     interview statement: on a single-answer dimension a different value
 *     DISAGREES with each interview answer instead, so a disagreement the
 *     founder left open stays standing and the qualification stays
 *     UNRESOLVED (decision 91; live: a profile-prefilled series_b form
 *     erased the left-open Series A / seed disagreement);
 *   - an unknown never disagrees with anything (unknown stays unknown).
 *
 * Legacy facts are re-projected from the statements for the dimensions it
 * wrote, as a turn's plan does. Pure: nothing is written here.
 */
export function formStatementPlan(input: {
  readonly applicationId: ApplicationId;
  readonly context: StatementContext;
  readonly legacyFacts: readonly ApplicationFact[];
  readonly proposed: readonly NewApplicationFact[];
  readonly at: string;
}): {
  readonly statements: readonly ApplicationStatement[];
  readonly links: readonly StatementLink[];
  /** The legacy facts to record: projections, plus any the shape refuses. */
  readonly legacyFacts: readonly NewApplicationFact[];
} {
  const proposedDimensions = new Set(input.proposed.map((f) => f.dimension));
  const carriedAll = legacyCarry(input).filter((s) =>
    proposedDimensions.has(s.dimension),
  );
  const existing = [...input.context.statements, ...carriedAll];
  const byId = new Map(existing.map((s) => [s.id as string, s] as const));
  const view = projectView(existing, input.context.links, input.context.events);
  // Strictly after everything it corrects: a link points newer to older.
  let clock = Math.max(
    Date.parse(input.at),
    ...existing.map((s) => Date.parse(s.statedAt) + 1),
  );
  const written = new Set<ApplicationDimension>();
  const statements: ApplicationStatement[] = [];
  const links: StatementLink[] = [];
  const legacyFacts: NewApplicationFact[] = [];
  const formLike = (origin: ApplicationStatement["origin"]) =>
    origin === "FORM" || origin === "BACKFILL";

  for (const fact of input.proposed) {
    const dimension = fact.dimension;
    const current =
      view.dimensions.find((d) => d.dimension === dimension)?.items ?? [];
    const shaped: ApplicationStatement[] = [];
    let refused = false;
    for (const carry of carriedValues({
      id: randomUUID() as ApplicationFact["id"],
      applicationId: input.applicationId,
      dimension,
      value: fact.value,
      provenance: fact.provenance,
      recordedAt: input.at,
      supersededAt: null,
    })) {
      const unknown = carry.value.kind === "UNKNOWN";
      const parsed = ApplicationStatementSchema.safeParse({
        id: randomUUID(),
        applicationId: input.applicationId,
        dimension,
        quantity:
          carry.value.kind === "MONEY" || carry.value.kind === "ZERO"
            ? (QUANTITY_OF[dimension] ?? null)
            : null,
        value: carry.value,
        asOf: null,
        words: carry.words.slice(0, 2000),
        provenance: unknown
          ? "UNKNOWN"
          : fact.provenance === "UNKNOWN"
            ? "APPLICANT_PROVIDED"
            : fact.provenance,
        origin: "FORM",
        sourceTurnId: null,
        backfillKey: null,
        statedAt: input.at,
        recordedAt: input.at,
      });
      if (parsed.success) shaped.push(parsed.data);
      else refused = true;
    }
    // A value the bounded shape refuses stays in the legacy fact alone;
    // the reader's view carries that fact in, flagged.
    if (refused) {
      legacyFacts.push(fact);
      continue;
    }
    const said = new Set(shaped.map((s) => canonical(s.value)));
    const currentValues = new Set(current.map((i) => canonical(i.value)));
    const formCurrent = current.filter((i) => formLike(i.origin));
    const lastForm = existing
      .filter((s) => s.dimension === dimension && s.origin === "FORM")
      .sort((a, b) =>
        a.statedAt === b.statedAt
          ? a.id.localeCompare(b.id)
          : a.statedAt.localeCompare(b.statedAt),
      )
      .at(-1);
    const unchanged =
      // Already a current answer, with no different form answer beside it.
      ([...said].every((v) => currentValues.has(v)) &&
        formCurrent.every((i) => said.has(canonical(i.value)))) ||
      // What the form last said, even if the interview has since moved on:
      // sending it again is not the founder changing it.
      (shaped.length === 1 &&
        lastForm !== undefined &&
        said.has(canonical(lastForm.value)));
    if (unchanged) continue;

    const singleAnswer =
      (QUALIFYING_DIMENSIONS.includes(dimension) &&
        dimension !== "company.sector_phrases") ||
      SINGLE_VALUED_DIMENSIONS.has(dimension);
    for (const shapedStatement of shaped) {
      const statedAt = new Date(clock).toISOString();
      clock += 1;
      const statement: ApplicationStatement = {
        ...shapedStatement,
        statedAt,
        recordedAt: statedAt,
      };
      statements.push(statement);
      written.add(dimension);
      for (const item of current) {
        const target = byId.get(item.statementId);
        if (target === undefined) continue;
        let kind: StatementLink["kind"] | null = null;
        if (formLike(target.origin)) kind = "CORRECTS";
        else if (
          singleAnswer &&
          statement.value.kind !== "UNKNOWN" &&
          target.value.kind !== "UNKNOWN" &&
          canonical(statement.value) !== canonical(target.value)
        )
          kind = "DISAGREES";
        if (kind === null) continue;
        links.push(
          StatementLinkSchema.parse({
            id: randomUUID(),
            applicationId: input.applicationId,
            kind,
            fromStatementId: statement.id,
            toStatementId: target.id,
            origin: "CODE_DETECTED",
            sourceTurnId: null,
            createdAt: statedAt,
          }),
        );
      }
    }
  }

  const carried = carriedAll.filter((s) => written.has(s.dimension));
  const after = projectView(
    [...input.context.statements, ...carried, ...statements],
    [...input.context.links, ...links],
    input.context.events,
  );
  const projected = legacyFactsFrom(after).facts;
  for (const dimension of written) {
    const fact = projected.find((f) => f.dimension === dimension);
    if (fact === undefined) continue;
    const legacy = input.legacyFacts.find(
      (f) => f.dimension === dimension && f.supersededAt === null,
    );
    if (
      legacy !== undefined &&
      sameJson(legacy.value, fact.value) &&
      legacy.provenance === fact.provenance
    )
      continue;
    const parsed = NewApplicationFactSchema.safeParse({
      dimension,
      value: fact.value,
      provenance: fact.provenance,
    });
    if (parsed.success) legacyFacts.push(parsed.data);
  }
  return { statements: [...carried, ...statements], links, legacyFacts };
}
