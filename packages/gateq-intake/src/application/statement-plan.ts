import { randomUUID } from "node:crypto";

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
  legacyFactsFrom,
  projectView,
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

export const STATEMENT_READING_VERSION = 2;

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
      const parsed = ApplicationStatementSchema.safeParse({
        id: randomUUID(),
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
        backfillKey:
          values.length === 1
            ? `legacy-fact:${fact.id}`
            : `legacy-fact:${fact.id}:${index}`,
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
  /** True when the turn was not about the application: nothing is read. */
  readonly discard: boolean;
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

  const ops = input.discard ? [] : input.statements;
  if (input.discard) rejected += input.statements.length;

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
    const quantity: StatementQuantity | null = NUMERIC_KINDS.has(value.kind)
      ? (op.quantity ?? QUANTITY_OF[dimension] ?? null)
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
    // The same answer again is already on record: nothing new to write.
    if (
      op.op === "NEW" &&
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

    if (target !== null && (op.op === "CORRECTS" || op.op === "DISAGREES")) {
      link(op.op, statement.id, target, "MODEL_READING", turn.id);
      const targetDimension = byId.get(target)?.dimension;
      if (targetDimension !== undefined) touched.add(targetDimension);
      return;
    }
    // Code-detected disagreement: a number on the same dimension, quantity
    // and known date that differs from one on record, with no link.
    for (const other of held) {
      if (
        other.id === statement.id ||
        other.quantity === null ||
        other.quantity !== statement.quantity ||
        other.asOf === null ||
        other.asOf !== statement.asOf ||
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
        .filter((s) => s.id !== statement.id && s.value.kind !== "UNKNOWN")
        .at(-1);
      if (
        latest !== undefined &&
        canonical(latest.value) !== canonical(statement.value) &&
        !(
          latest.quantity !== null &&
          latest.quantity === statement.quantity &&
          latest.asOf !== null &&
          latest.asOf === statement.asOf
        )
      )
        link("DISAGREES", statement.id, latest.id, "CODE_DETECTED", turn.id);
    }
  };

  for (const op of ops) {
    if (op === null) {
      rejected += 1;
      continue;
    }
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

  // What they said about a disagreement on record.
  const corrected = new Set(
    links.filter((l) => l.kind === "CORRECTS").map((l) => l.toStatementId),
  );
  for (const action of input.discard ? [] : input.actions) {
    if (action === null) {
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
    } else if (disagreement.state === "LEFT_OPEN") continue;
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

/**
 * Whether a reply claims something was recorded. A question ("have you
 * logged any sales?") claims nothing, so only statements count.
 */
export function claimsRecording(text: string): boolean {
  return sentencesOf(text).some(
    (sentence) =>
      !sentence.trim().endsWith("?") && CLAIMS_RECORDED.test(sentence),
  );
}

/** The deterministic line when nothing from the turn was recorded. */
export const NOT_RECORDED_LINE =
  "I haven't put anything from that on your application yet.";

/**
 * The reply, held to the turn's reading: a sentence claiming something was
 * recorded stands only when the reading recorded a statement. Otherwise it
 * is removed and the deterministic line says what is true.
 */
export function replyHeldToReading(
  reply: string,
  recordedCount: number,
): string {
  if (recordedCount > 0 || !claimsRecording(reply)) return reply;
  const kept = sentencesOf(reply).filter(
    (sentence) => !claimsRecording(sentence),
  );
  return `${NOT_RECORDED_LINE} ${kept.join("").trim()}`.trim().slice(0, 4000);
}

/** The intake contract's quantity list, for the identity test with q-core. */
export const PLAN_QUANTITIES = StatementQuantitySchema.options;
