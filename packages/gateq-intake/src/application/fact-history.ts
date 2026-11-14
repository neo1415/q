import type {
  ApplicationFact,
  FactProvenance,
  FactValue,
} from "../contracts/index.js";

/**
 * What a founder says in the interview is kept, statement by statement
 * (live run 2026-11-13, application 3ec9713b): "1,900 sign-ups, 600 weekly",
 * then "roughly 1,500 weekly users", then "willingness to pay not tested"
 * left Traction holding only the last sentence. The user numbers were gone
 * from the review and the dossier, and 600 against 1,500 was resolved by
 * whichever came last.
 *
 * So a new statement about a narrative dimension that the founder did not
 * say REPLACES the earlier one is added to it, never written over it. When
 * Q's reading of the turn says it disagrees with what is on record, the
 * earlier words are carried beside it as unreconciled: both stand, flagged,
 * until the founder says which is right (a correction, which supersedes;
 * the store keeps every superseded row as history).
 *
 * Code decides only the bookkeeping here. Whether a statement disagrees, or
 * corrects, is the interview model's structured reading of the turn
 * (`conflicts`, `correction`), never a keyword match.
 */

/**
 * Dimensions whose statements add up. A name, an email, a website or a
 * status is one value that a new one replaces (its history is kept by the
 * store); what the company does, its traction or its use of funds is told
 * in several sentences, and each one counts.
 */
export const ACCUMULATING_DIMENSIONS: ReadonlySet<string> = new Set([
  "company.description",
  "company.problem",
  "company.solution",
  "company.market",
  "company.customers",
  "company.team",
  "company.business_model",
  "claims.traction",
  "raise.use_of_funds",
  "application.note",
]);

/** Byte budget for one stored value (the column allows 4096). */
const VALUE_BYTES_MAX = 3_600;
const TEXT_CHARS_MAX = 2_000;
const UNRECONCILED_MAX = 4;
const QUOTE_MAX = 300;

type TextValue = Extract<FactValue, { readonly kind: "TEXT" }>;

const squash = (text: string) => text.replace(/\s+/gu, " ").trim();

/**
 * A narrative value as statement text: TEXT as it is, PHRASES joined (the
 * model writes either for a sentence of theirs). Anything else is not a
 * statement and is never accumulated.
 */
export function asStatement(value: FactValue): TextValue | null {
  if (value.kind === "TEXT") return value;
  if (value.kind === "PHRASES" && value.phrases.length > 0)
    return {
      kind: "TEXT",
      text: value.phrases.join("; ").slice(0, TEXT_CHARS_MAX),
    };
  return null;
}

/** The statements in an accumulated TEXT value, oldest first. */
export function statementsOf(value: TextValue): readonly string[] {
  return value.text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * An accumulated text as a person reads it: each statement a sentence,
 * starting with a capital and ending with a stop, joined with a space
 * (live 2026-11-14: "…regulatory reporting. cloud core banking for…" read
 * as two texts glued together). Display only; the stored words, one
 * statement per line, are never changed. A single statement is returned
 * as it was said.
 */
export function statementsInWords(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 2) return text.trim();
  return lines
    .map((line) => {
      const capital = line.charAt(0).toLocaleUpperCase("en") + line.slice(1);
      return /[.!?…:;]$/u.test(capital) ? capital : `${capital}.`;
    })
    .join(" ");
}

/**
 * The provenance of the statements together: an estimate stays an
 * estimate, and a combined text is never document-supported (no document
 * said the whole of it; only the Evidence confirmation path mints that).
 */
function weaker(a: FactProvenance, b: FactProvenance): FactProvenance {
  if (a === "ESTIMATED" || b === "ESTIMATED") return "ESTIMATED";
  return "APPLICANT_PROVIDED";
}

/**
 * The earlier words the model says this statement disagrees with, checked
 * against what was really recorded: a quote that is not in the held value
 * is not trusted, and the held value's latest statement stands for it.
 */
function earlierQuote(held: TextValue, quoted: string | null): string {
  const statements = statementsOf(held);
  const latest = statements.at(-1) ?? held.text;
  if (quoted !== null) {
    const wanted = squash(quoted).toLowerCase();
    if (wanted.length > 0) {
      const found = statements.find((s) =>
        squash(s).toLowerCase().includes(wanted),
      );
      if (found !== undefined) return found.slice(0, QUOTE_MAX);
    }
  }
  return latest.slice(0, QUOTE_MAX);
}

const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length;

/**
 * The value to record when a founder adds `statement` to a dimension that
 * already holds `held`, without saying it replaces it.
 *
 * Returns null when the statement is already there (nothing to write).
 * When the whole would not fit the stored bound, the oldest statements are
 * left to the dimension's history rows (they are never deleted there) and
 * the newest kept here.
 */
export function addedStatement(input: {
  readonly held: {
    readonly value: TextValue;
    readonly provenance: FactProvenance;
  };
  readonly statement: string;
  readonly provenance: FactProvenance;
  /** Q's reading: this disagrees with the earlier words quoted (or null). */
  readonly conflict: { readonly earlier: string | null } | null;
}): { readonly value: TextValue; readonly provenance: FactProvenance } | null {
  const statement = input.statement.trim();
  if (statement.length === 0) return null;
  const earlier = statementsOf(input.held.value);
  if (earlier.some((s) => squash(s) === squash(statement))) return null;

  const unreconciled = [...(input.held.value.unreconciled ?? [])];
  if (input.conflict !== null) {
    unreconciled.push({
      earlier: earlierQuote(input.held.value, input.conflict.earlier),
      later: statement.slice(0, QUOTE_MAX),
    });
  }
  const kept = unreconciled.slice(-UNRECONCILED_MAX);

  const lines = [...earlier, statement];
  const build = (from: number): TextValue => ({
    kind: "TEXT",
    text: lines.slice(from).join("\n").slice(-TEXT_CHARS_MAX),
    ...(kept.length === 0 ? {} : { unreconciled: kept }),
  });
  let from = 0;
  let value = build(from);
  while (
    from < lines.length - 1 &&
    (lines.slice(from).join("\n").length > TEXT_CHARS_MAX ||
      bytes(value) > VALUE_BYTES_MAX)
  ) {
    from += 1;
    value = build(from);
  }
  return {
    value,
    provenance: weaker(input.held.provenance, input.provenance),
  };
}

const CONTRADICTION_MAX = 300;

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

const labelOf = (dimension: string) => {
  const last = dimension.split(".").at(-1) ?? dimension;
  const words = last.replace(/_/gu, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * Statements that disagree and have not been reconciled, said without
 * choosing: the founder's earlier words, then their latest.
 */
export function unreconciledStatements(
  facts: readonly ApplicationFact[],
): readonly string[] {
  const out: string[] = [];
  for (const fact of facts) {
    if (fact.supersededAt !== null || fact.value.kind !== "TEXT") continue;
    for (const pair of fact.value.unreconciled ?? []) {
      // A contradiction line is bounded at 300 characters on the wire
      // (coverage and dossier contracts); the full words stay on the fact.
      const frame = `${labelOf(fact.dimension)}: the founder said "" and later ""; not yet reconciled`;
      const each = Math.max(
        40,
        Math.floor((CONTRADICTION_MAX - frame.length) / 2),
      );
      out.push(
        `${labelOf(fact.dimension)}: the founder said "${clip(pair.earlier, each)}" and later "${clip(pair.later, each)}"; not yet reconciled`.slice(
          0,
          CONTRADICTION_MAX,
        ),
      );
    }
  }
  return out;
}
