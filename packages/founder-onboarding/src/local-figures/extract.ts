import type { ExtractedBlock } from "@capital-q/evidence";
import { normaliseDigits, parseMoneyAll } from "@capital-q/onboarding";

import {
  ACTUAL_QUALIFIERS,
  CURRENCY_DECLARATIONS,
  CURRENCY_HINTS,
  FINANCIAL_MEASURES_VERSION,
  MILLIONS_MARKERS,
  NON_ACTUAL_QUALIFIERS,
  THOUSANDS_MARKERS,
  measureByKey,
  measureForLabel,
  type FinancialMeasure,
  type FinancialMeasureKey,
} from "./measures.js";
import {
  comparePeriods,
  parsePeriod,
  periodInText,
  type FigurePeriod,
  type PeriodGranularity,
} from "./period.js";

/**
 * Local figures (owner decision 2026-10-28): the key figures of a founder's
 * highly confidential financial document, read by code in the worker when
 * the document is processed. No model sees the document, no model reads
 * these figures, and nothing here is a fact: every candidate is offered to
 * the founder (Keep / Change / Not this), and only what they confirm
 * becomes their own USER_CLAIM.
 *
 * Pure, deterministic and bounded: the same blocks give the same candidates
 * every time. Precision over recall. A figure is offered only when its
 * label is a measure of FINANCIAL_MEASURES v1, its period is stated, its
 * currency is stated (kept as stated, never relabelled), its cell holds one
 * figure and nothing else, and no other cell of the document states a
 * different figure for the same measure and period. Anything else is not
 * offered at all; unknown stays unknown.
 */

/** Bounds (owner 2026-10-28): the first 60 tables, the first 20 pages. */
export const LOCAL_FIGURE_LIMITS = {
  maxTables: 60,
  maxPages: 20,
  maxCandidates: 20,
  maxQuote: 200,
} as const;

export const LOCAL_FIGURE_DOCUMENT_TYPES: readonly string[] = [
  "MANAGEMENT_ACCOUNTS",
  "FINANCIAL_MODEL",
  "FINANCIAL",
];

/** Whether a document is one whose figures are read locally. */
export function localFiguresApply(document: {
  readonly documentType: string;
}): boolean {
  return LOCAL_FIGURE_DOCUMENT_TYPES.includes(document.documentType);
}

export type LocalFigureValue =
  | {
      readonly kind: "MONEY";
      /** Canonical decimal string, never a float. */
      readonly amount: string;
      /** ISO 4217 as the document states it. */
      readonly currency: string;
      /** False when only "$" named it (US, Canadian, Australian ...). */
      readonly currencyCertain: boolean;
    }
  | { readonly kind: "PERCENT"; readonly value: string }
  | { readonly kind: "MONTHS"; readonly value: string }
  | { readonly kind: "COUNT"; readonly value: string };

export type LocalFigureLocator = {
  readonly page: number | null;
  readonly slide: number | null;
  readonly sheet: string | null;
  /** 1-based ordinal of the table in the document (0: a labelled line). */
  readonly table: number;
  /** 1-based row and column of the cell in that table. */
  readonly row: number;
  readonly column: number;
};

export type LocalFigureCandidate = {
  readonly measure: FinancialMeasureKey;
  readonly measuresVersion: typeof FINANCIAL_MEASURES_VERSION;
  readonly value: LocalFigureValue;
  readonly period: FigurePeriod;
  /** The cell's own text, exactly as the document wrote it. */
  readonly cell: string;
  /** The row as written ("MRR | $48,000 | $51,000"), bounded. */
  readonly quote: string;
  readonly locator: LocalFigureLocator;
  /**
   * Structural, never a model's estimate: HIGH when the figure is a table
   * cell whose row label and column period header both match; MEDIUM when
   * the label was a line of prose or the period came from a heading.
   */
  readonly confidence: "HIGH" | "MEDIUM";
};

export type LocalFiguresResult = {
  readonly candidates: readonly LocalFigureCandidate[];
  /** Counts only, for logs: never a value. */
  readonly tablesRead: number;
  readonly ambiguousDropped: number;
};

type Table = {
  readonly ordinal: number;
  readonly rows: readonly (readonly string[])[];
  readonly page: number | null;
  readonly slide: number | null;
  readonly sheet: string | null;
  /** The period a heading or caption above the table states, if any. */
  readonly contextPeriod: FigurePeriod | null;
  /** The heading or paragraph just above the table. */
  readonly caption: string | null;
};

type Draft = Omit<LocalFigureCandidate, "measuresVersion">;

// ---------------------------------------------------------------------------
// Hints: currency and scale, from captions, headers and labels
// ---------------------------------------------------------------------------

type CurrencyHint = { readonly code: string; readonly certain: boolean };

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’`]/gu, "'")
    .replace(/[()[\]{},;:|/]/gu, " ")
    .split(/\s+/u)
    .map((token) => token.replace(/^[.\-–—]+|[.\-–—]+$/gu, ""))
    .filter((token) => token.length > 0);
}

/** The single currency a piece of label text names; "CONFLICT" when two. */
function currencyHint(text: string | null): CurrencyHint | "CONFLICT" | null {
  if (text === null) return null;
  const found = new Map<string, boolean>();
  for (const raw of tokens(text)) {
    // "$k", "₦'000", "usd'000": the symbol before a scale marker.
    for (const [token, code, certain] of CURRENCY_HINTS) {
      if (
        raw === token ||
        (token.length === 1 && raw.startsWith(token)) ||
        raw.startsWith(`${token}'`)
      ) {
        found.set(code, (found.get(code) ?? false) || certain);
        break;
      }
    }
  }
  if (found.size === 0) return null;
  if (found.size > 1) return "CONFLICT";
  const [entry] = [...found.entries()];
  return entry === undefined ? null : { code: entry[0], certain: entry[1] };
}

/** 3 (thousands), 6 (millions), 0 (none) or "CONFLICT". */
function scaleHint(text: string | null): number | "CONFLICT" {
  if (text === null) return 0;
  const shifts = new Set<number>();
  for (const raw of tokens(text)) {
    const bare = raw.replace(/^(?:us\$|\$|₦|£|€|usd|eur|gbp|ngn|kes)/u, "");
    if (THOUSANDS_MARKERS.includes(bare)) shifts.add(3);
    else if (MILLIONS_MARKERS.includes(bare)) shifts.add(6);
  }
  if (shifts.size > 1) return "CONFLICT";
  return [...shifts][0] ?? 0;
}

function declaredCurrency(text: string): CurrencyHint | "CONFLICT" | null {
  const lower = text.toLowerCase();
  if (!CURRENCY_DECLARATIONS.some((phrase) => lower.includes(phrase))) {
    return null;
  }
  return text.length > 200 ? null : currencyHint(text);
}

function qualifierOf(header: string): "ACTUAL" | "NOT_ACTUAL" | null {
  const words = tokens(header);
  const phrase = ` ${words.join(" ")} `;
  if (
    NON_ACTUAL_QUALIFIERS.some((word) =>
      word.includes(" ") ? phrase.includes(` ${word} `) : words.includes(word),
    )
  ) {
    return "NOT_ACTUAL";
  }
  return ACTUAL_QUALIFIERS.some((word) => words.includes(word))
    ? "ACTUAL"
    : null;
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

type NumberStyle = "DEFAULT" | "DECIMAL_COMMA" | "MIXED";

const EMPTY_CELL = /^(?:|-|–|—|n\/?a|tbc|tbd|nil|none|\.)$/iu;

/**
 * How a table writes its numbers. "45.250.000,50" or "1.250.000" is a
 * decimal-comma table; "1,250,000.50" a decimal-point one; both in one
 * table cannot be read safely and none of its figures are offered.
 */
function numberStyle(rows: readonly (readonly string[])[]): NumberStyle {
  let dotGrouped = 0;
  let commaGrouped = 0;
  for (const row of rows) {
    for (const raw of row) {
      const cell = normaliseDigits(raw);
      if (/\d\.\d{3}\.\d{3}|\d\.\d{3},\d|\d,\d{1,2}(?!\d)\s*%/u.test(cell)) {
        dotGrouped += 1;
      }
      if (/\d,\d{3},\d{3}|\d,\d{3}\.\d/u.test(cell)) commaGrouped += 1;
    }
  }
  if (dotGrouped > 0 && commaGrouped > 0) return "MIXED";
  return dotGrouped > 0 ? "DECIMAL_COMMA" : "DEFAULT";
}

/** The cell's number in decimal-point form, or null when it cannot tell. */
function normaliseNumber(cell: string, style: NumberStyle): string | null {
  const text = normaliseDigits(cell).trim();
  if (style === "MIXED") return null;
  if (style === "DECIMAL_COMMA") {
    // "1,500" in a decimal-comma table could be 1.5 or 1500: not offered.
    if (/(?<![\d.,])\d{1,3},\d{3}(?![\d.,])/u.test(text)) return null;
    return text
      .replace(/(\d)\.(?=\d{3}(?!\d))/gu, "$1")
      .replace(/(\d),(?=\d)/gu, "$1.");
  }
  // "1.500" in a decimal-point table could be 1.5 or 1500: not offered.
  if (/(?<![\d.,])\d{1,3}\.\d{3}(?![\d.,])/u.test(text)) return null;
  return text;
}

/** A sign taken off "(65,000)", "-65,000" or "−65,000". */
function signed(cell: string): {
  readonly text: string;
  readonly negative: boolean;
} {
  const trimmed = cell.trim();
  const bracketed = /^\((.+)\)$/u.exec(trimmed);
  if (bracketed !== null) return { text: bracketed[1] ?? "", negative: true };
  if (/^[-−–]\s*\S/u.test(trimmed)) {
    return { text: trimmed.replace(/^[-−–]\s*/u, ""), negative: true };
  }
  return { text: trimmed, negative: false };
}

function shiftDecimal(amount: string, shift: number): string {
  if (shift === 0) return amount;
  const [whole = "0", fraction = ""] = amount.split(".");
  const digits = whole + fraction;
  const point = whole.length + shift;
  const padded = digits.padEnd(point, "0");
  const intPart = padded.slice(0, point).replace(/^0+(?=\d)/u, "") || "0";
  const fracPart = padded.slice(point).replace(/0+$/u, "");
  return fracPart.length > 0 ? `${intPart}.${fracPart}` : intPart;
}

type ValueContext = {
  readonly measure: FinancialMeasure;
  readonly style: NumberStyle;
  /** Currency hints from the most specific to the least. */
  readonly currencies: readonly (CurrencyHint | "CONFLICT" | null)[];
  readonly scale: number | "CONFLICT";
  /** A "%" in the label or header. */
  readonly percentContext: boolean;
};

function readValue(
  raw: string,
  context: ValueContext,
): LocalFigureValue | null {
  if (EMPTY_CELL.test(raw.trim())) return null;
  const { text, negative } = signed(raw);
  const number = normaliseNumber(text, context.style);
  if (number === null) return null;
  const { measure } = context;
  switch (measure.unit) {
    case "MONEY": {
      if (context.scale === "CONFLICT") return null;
      const figures = parseMoneyAll(number);
      const [figure] = figures;
      if (figures.length !== 1 || figure === undefined) return null;
      // The cell holds the figure and nothing else (no words, no second number).
      const rest = number.replace(figure.text, "").trim();
      if (/[\p{L}\p{N}]/u.test(rest)) return null;
      if (negative && measure.key !== "net_burn") return null;
      // A figure that states its own scale ("$51K") under a header that
      // states one too cannot be read safely.
      if (figure.unit !== "ONE" && context.scale !== 0) return null;
      const amount = shiftDecimal(figure.amount, context.scale);
      if (!/^\d+(?:\.\d+)?$/u.test(amount) || Number(amount) <= 0) return null;
      let currency: CurrencyHint | null =
        figure.currency === null
          ? null
          : { code: figure.currency, certain: figure.currencyCertain };
      for (const hint of context.currencies) {
        if (hint === null) continue;
        if (hint === "CONFLICT") return null;
        if (currency === null) {
          currency = hint;
          continue;
        }
        if (hint.code === currency.code) {
          currency = {
            code: currency.code,
            certain: currency.certain || hint.certain,
          };
          continue;
        }
        // "$" beside a stated dollar currency is that currency; any other
        // difference is two currencies, and neither is picked.
        if (
          !currency.certain &&
          hint.certain &&
          ["CAD", "AUD", "SGD"].includes(hint.code) &&
          currency.code === "USD"
        ) {
          currency = hint;
          continue;
        }
        if (currency.certain || hint.certain) return null;
      }
      if (currency === null) return null;
      return {
        kind: "MONEY",
        amount,
        currency: currency.code,
        currencyCertain: currency.certain,
      };
    }
    case "PERCENT": {
      if (negative && measure.key !== "gross_margin") return null;
      const match = /^(\d+(?:\.\d+)?)\s*(%?)$/u.exec(number);
      if (match === null) return null;
      if (match[2] !== "%" && !context.percentContext) return null;
      const value = Number(match[1]);
      const signedValue = negative ? -value : value;
      const range = measure.range ?? { min: -100, max: 100 };
      if (signedValue < range.min || signedValue > range.max) return null;
      return {
        kind: "PERCENT",
        value: `${negative ? "-" : ""}${match[1] ?? ""}`,
      };
    }
    case "MONTHS": {
      if (negative) return null;
      const match = /^(\d+(?:\.\d+)?)(?:\s*(?:months?|mos?|mths?))?$/iu.exec(
        number,
      );
      if (match === null) return null;
      const value = Number(match[1]);
      const range = measure.range ?? { min: 0, max: 240 };
      if (value < range.min || value > range.max) return null;
      return { kind: "MONTHS", value: match[1] ?? "" };
    }
    case "COUNT": {
      if (negative) return null;
      const compact =
        context.style === "DEFAULT"
          ? number.replace(/(\d),(?=\d{3})/gu, "$1")
          : number;
      if (!/^\d+$/u.test(compact)) return null;
      const value = compact.replace(/^0+(?=\d)/u, "");
      return Number(value) > 0 ? { kind: "COUNT", value } : null;
    }
  }
}

// ---------------------------------------------------------------------------
// Measures, periods and cadence
// ---------------------------------------------------------------------------

/**
 * The measure a label names for a period of this granularity, or null. A
 * monthly measure is read only for a month; "Revenue" is monthly for a
 * month and annual for a year, and nothing for a quarter.
 */
function measureFor(
  label: string,
  granularity: PeriodGranularity,
): FinancialMeasure | null {
  const match = measureForLabel(label);
  if (match === null) return null;
  if (match.kind === "PERIOD_REVENUE") {
    return granularity === "MONTH"
      ? measureByKey("monthly_revenue")
      : granularity === "YEAR"
        ? measureByKey("annual_revenue")
        : null;
  }
  if (match.measure.cadence === "MONTHLY" && granularity !== "MONTH") {
    return null;
  }
  return match.measure;
}

function percentIn(text: string | null): boolean {
  return text !== null && /%|percent/iu.test(text);
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

function quoteOf(row: readonly string[]): string {
  return row
    .map((cell) => cell.trim())
    .join(" | ")
    .slice(0, LOCAL_FIGURE_LIMITS.maxQuote);
}

type PeriodColumn = {
  readonly column: number;
  readonly period: FigurePeriod;
};

/**
 * The column a figure is read from: the latest period of the finest
 * granularity the header holds, marked actual (or unmarked). Two columns
 * for that same period that are not told apart by "Actual" is ambiguous.
 */
function chosenColumn(
  header: readonly string[],
  subheader: readonly string[] | null,
): PeriodColumn | null {
  const columns: (PeriodColumn & {
    qualifier: "ACTUAL" | "NOT_ACTUAL" | null;
  })[] = [];
  for (let column = 1; column < header.length; column += 1) {
    const cell = header[column] ?? "";
    const period = parsePeriod(cell);
    if (period === null) continue;
    const below = subheader?.[column] ?? "";
    const qualifier = qualifierOf(cell) ?? qualifierOf(below);
    if (qualifier === "NOT_ACTUAL") continue;
    columns.push({ column, period, qualifier });
  }
  for (const granularity of ["MONTH", "QUARTER", "YEAR"] as const) {
    const same = columns.filter((c) => c.period.granularity === granularity);
    if (same.length === 0) continue;
    const latest = same.toSorted((a, b) =>
      comparePeriods(b.period, a.period),
    )[0];
    if (latest === undefined) return null;
    const tied = same.filter((c) => c.period.key === latest.period.key);
    if (tied.length === 1) return latest;
    const actual = tied.filter((c) => c.qualifier === "ACTUAL");
    return actual.length === 1 ? (actual[0] ?? null) : null;
  }
  return null;
}

function documentCurrency(
  hints: readonly (CurrencyHint | "CONFLICT")[],
): CurrencyHint | "CONFLICT" | null {
  const codes = new Set(
    hints.map((hint) => (hint === "CONFLICT" ? "CONFLICT" : hint.code)),
  );
  if (codes.size === 0) return null;
  if (codes.size > 1 || codes.has("CONFLICT")) return "CONFLICT";
  return hints[0] ?? null;
}

function readTable(
  table: Table,
  declared: CurrencyHint | "CONFLICT" | null,
  declaredScale: number | "CONFLICT",
): Draft[] {
  const rows = table.rows
    .map((row) => row.map((cell) => cell.trim()))
    .filter((row) => row.some((cell) => cell.length > 0));
  if (rows.length < 2) return [];
  const style = numberStyle(rows);
  const width = rows[0]?.length ?? 0;
  const caption = table.caption;
  const tableScale = (() => {
    const own = scaleHint(caption);
    const head = scaleHint(rows[0]?.[0] ?? null);
    const values = [own, head, declaredScale].filter((s) => s !== 0);
    if (values.includes("CONFLICT")) return "CONFLICT" as const;
    return new Set(values).size > 1
      ? ("CONFLICT" as const)
      : ((values[0] ?? 0) as number);
  })();
  const tableCurrency = (() => {
    const own = currencyHint(caption);
    const head = currencyHint(rows[0]?.[0] ?? null);
    if (own === "CONFLICT" || head === "CONFLICT") return "CONFLICT" as const;
    if (own !== null && head !== null && own.code !== head.code) {
      return "CONFLICT" as const;
    }
    return own ?? head;
  })();
  const base = {
    page: table.page,
    slide: table.slide,
    sheet: table.sheet,
    table: table.ordinal,
  };
  const drafts: Draft[] = [];

  // Layout 1: labels down the first column, periods across the header.
  const headerAt = rows
    .slice(0, 3)
    .findIndex((row) =>
      row.slice(1).some((cell) => parsePeriod(cell) !== null),
    );
  if (headerAt >= 0) {
    const header = rows[headerAt] ?? [];
    const next = rows[headerAt + 1] ?? null;
    const subheader =
      next !== null &&
      next.slice(1).some((cell) => qualifierOf(cell) !== null) &&
      !next.slice(1).some((cell) => /\d/u.test(cell))
        ? next
        : null;
    const chosen = chosenColumn(header, subheader);
    if (chosen === null) return [];
    const headerCell = header[chosen.column] ?? "";
    for (let at = headerAt + 1; at < rows.length; at += 1) {
      const row = rows[at] ?? [];
      // A row that lost a cell (a PDF row with a blank) no longer lines up.
      if (row.length !== header.length) continue;
      const label = row[0] ?? "";
      const measure = measureFor(label, chosen.period.granularity);
      if (measure === null) continue;
      const cell = row[chosen.column] ?? "";
      const labelScale = scaleHint(label);
      const columnScale = scaleHint(headerCell);
      const scales = [labelScale, columnScale, tableScale].filter(
        (s) => s !== 0,
      );
      const scale = scales.includes("CONFLICT")
        ? ("CONFLICT" as const)
        : new Set(scales).size > 1
          ? ("CONFLICT" as const)
          : ((scales[0] ?? 0) as number);
      const value = readValue(cell, {
        measure,
        style,
        currencies: [
          currencyHint(label),
          currencyHint(headerCell),
          tableCurrency,
          declared,
        ],
        scale,
        percentContext: percentIn(label) || percentIn(headerCell),
      });
      if (value === null) continue;
      drafts.push({
        measure: measure.key,
        value,
        period: chosen.period,
        cell,
        quote: quoteOf([label, headerCell, cell]),
        locator: { ...base, row: at + 1, column: chosen.column + 1 },
        confidence: "HIGH",
      });
    }
    return drafts;
  }

  // Layout 2: measures across the header, periods down the first column.
  const header = rows[0] ?? [];
  const periodRows = rows
    .map((row, at) => ({ row, at, period: parsePeriod(row[0] ?? "") }))
    .filter(
      (entry): entry is { row: string[]; at: number; period: FigurePeriod } =>
        entry.at > 0 &&
        entry.period !== null &&
        qualifierOf(entry.row[0] ?? "") !== "NOT_ACTUAL",
    );
  if (periodRows.length > 0) {
    const granularity = (["MONTH", "QUARTER", "YEAR"] as const).find((g) =>
      periodRows.some((entry) => entry.period.granularity === g),
    );
    const same = periodRows.filter((e) => e.period.granularity === granularity);
    const latest = same.toSorted((a, b) =>
      comparePeriods(b.period, a.period),
    )[0];
    if (latest === undefined) return [];
    if (same.filter((e) => e.period.key === latest.period.key).length > 1) {
      return [];
    }
    if (latest.row.length !== width) return [];
    for (let column = 1; column < header.length; column += 1) {
      const label = header[column] ?? "";
      const measure = measureFor(label, latest.period.granularity);
      if (measure === null) continue;
      const cell = latest.row[column] ?? "";
      const scales = [scaleHint(label), tableScale].filter((s) => s !== 0);
      const scale = scales.includes("CONFLICT")
        ? ("CONFLICT" as const)
        : new Set(scales).size > 1
          ? ("CONFLICT" as const)
          : ((scales[0] ?? 0) as number);
      const value = readValue(cell, {
        measure,
        style,
        currencies: [currencyHint(label), tableCurrency, declared],
        scale,
        percentContext: percentIn(label),
      });
      if (value === null) continue;
      drafts.push({
        measure: measure.key,
        value,
        period: latest.period,
        cell,
        quote: quoteOf([latest.row[0] ?? "", label, cell]),
        locator: { ...base, row: latest.at + 1, column: column + 1 },
        confidence: "HIGH",
      });
    }
    return drafts;
  }

  // Layout 3: "Label | Value" rows under a heading that names the period.
  const period = table.contextPeriod;
  if (period === null || width !== 2) return [];
  for (let at = 0; at < rows.length; at += 1) {
    const row = rows[at] ?? [];
    if (row.length !== 2) continue;
    const label = row[0] ?? "";
    const measure = measureFor(label, period.granularity);
    if (measure === null) continue;
    const cell = row[1] ?? "";
    const scales = [scaleHint(label), tableScale].filter((s) => s !== 0);
    const scale = scales.includes("CONFLICT")
      ? ("CONFLICT" as const)
      : new Set(scales).size > 1
        ? ("CONFLICT" as const)
        : ((scales[0] ?? 0) as number);
    const value = readValue(cell, {
      measure,
      style,
      currencies: [currencyHint(label), tableCurrency, declared],
      scale,
      percentContext: percentIn(label),
    });
    if (value === null) continue;
    drafts.push({
      measure: measure.key,
      value,
      period,
      cell,
      quote: quoteOf(row),
      locator: { ...base, row: at + 1, column: 2 },
      confidence: "MEDIUM",
    });
  }
  return drafts;
}

/** "MRR: $51,000" as a line of prose, under a heading naming the period. */
function readLine(
  line: string,
  context: {
    readonly period: FigurePeriod | null;
    readonly page: number | null;
    readonly slide: number | null;
    readonly declared: CurrencyHint | "CONFLICT" | null;
    readonly declaredScale: number | "CONFLICT";
  },
): Draft | null {
  const match = /^([^:]{2,60}):\s*([^:]{1,40})$/u.exec(line.trim());
  if (match === null || context.period === null) return null;
  const label = match[1] ?? "";
  const cell = match[2] ?? "";
  const measure = measureFor(label, context.period.granularity);
  if (measure === null) return null;
  const scales = [scaleHint(label), context.declaredScale].filter(
    (s) => s !== 0,
  );
  const scale = scales.includes("CONFLICT")
    ? ("CONFLICT" as const)
    : new Set(scales).size > 1
      ? ("CONFLICT" as const)
      : ((scales[0] ?? 0) as number);
  const value = readValue(cell, {
    measure,
    style: numberStyle([[cell]]),
    currencies: [currencyHint(label), context.declared],
    scale,
    percentContext: percentIn(label),
  });
  if (value === null) return null;
  return {
    measure: measure.key,
    value,
    period: context.period,
    cell: cell.trim(),
    quote: line.trim().slice(0, LOCAL_FIGURE_LIMITS.maxQuote),
    locator: {
      page: context.page,
      slide: context.slide,
      sheet: null,
      table: 0,
      row: 0,
      column: 0,
    },
    confidence: "MEDIUM",
  };
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

function textOf(block: ExtractedBlock): string | null {
  switch (block.kind) {
    case "heading":
    case "paragraph":
    case "footnote":
      return block.text;
    case "slide":
      return [block.title ?? "", block.text].join("\n");
    case "list":
      return block.items.join("\n");
    case "table":
    case "spreadsheet_range":
    case "page_break":
      return null;
  }
}

const isPipeRow = (text: string) =>
  text.includes(" | ") && !text.includes("\n");

function sameValue(a: LocalFigureValue, b: LocalFigureValue): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "MONEY" && b.kind === "MONEY") {
    return a.amount === b.amount && a.currency === b.currency;
  }
  return (a as { value: string }).value === (b as { value: string }).value;
}

/**
 * The key figures a processed financial document states, as candidates for
 * the founder to confirm. Pure: the blocks in, the candidates out.
 */
export function extractLocalFigures(
  blocks: readonly ExtractedBlock[],
): LocalFiguresResult {
  const tables: Table[] = [];
  const prose: {
    readonly text: string;
    readonly period: FigurePeriod | null;
    readonly page: number | null;
    readonly slide: number | null;
  }[] = [];
  const declarations: (CurrencyHint | "CONFLICT")[] = [];
  const scaleDeclarations: (number | "CONFLICT")[] = [];
  let contextPeriod: FigurePeriod | null = null;
  let caption: string | null = null;
  let pipe: {
    rows: string[][];
    page: number | null;
    caption: string | null;
    period: FigurePeriod | null;
  } | null = null;

  const pushTable = (
    rows: string[][],
    page: number | null,
    slide: number | null,
    sheet: string | null,
    tableCaption: string | null,
    period: FigurePeriod | null,
  ) => {
    if (tables.length >= LOCAL_FIGURE_LIMITS.maxTables) return;
    tables.push({
      ordinal: tables.length + 1,
      rows,
      page,
      slide,
      sheet,
      contextPeriod: period,
      caption: tableCaption,
    });
  };
  const closePipe = () => {
    if (pipe !== null && pipe.rows.length >= 2) {
      pushTable(pipe.rows, pipe.page, null, null, pipe.caption, pipe.period);
    }
    pipe = null;
  };

  for (const block of blocks) {
    const page = block.locator.page ?? null;
    const slide = block.locator.slide ?? null;
    const position = page ?? slide;
    if (position !== null && position > LOCAL_FIGURE_LIMITS.maxPages) break;
    if (tables.length >= LOCAL_FIGURE_LIMITS.maxTables) break;

    if (block.kind === "table" || block.kind === "spreadsheet_range") {
      closePipe();
      pushTable(
        block.rows.map((row) => [...row]),
        page,
        slide,
        block.kind === "spreadsheet_range"
          ? (block.sheet ?? block.locator.sheet ?? null)
          : (block.locator.sheet ?? null),
        caption,
        contextPeriod,
      );
      continue;
    }
    const text = textOf(block);
    if (text === null) {
      if (block.kind === "page_break") closePipe();
      continue;
    }
    // A PDF table arrives as one paragraph per row, cells kept apart by " | ".
    if (block.kind === "paragraph" && isPipeRow(text)) {
      if (pipe !== null && pipe.page !== page) closePipe();
      if (pipe === null) {
        pipe = { rows: [], page, caption, period: contextPeriod };
      }
      pipe.rows.push(text.split(" | ").map((cell) => cell.trim()));
      continue;
    }
    closePipe();
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      const declared = declaredCurrency(trimmed);
      if (declared !== null) {
        declarations.push(declared);
        const shift = scaleHint(trimmed);
        if (shift !== 0) scaleDeclarations.push(shift);
      }
      if (prose.length < 2_000) {
        prose.push({ text: trimmed, period: contextPeriod, page, slide });
      }
      const named = periodInText(trimmed);
      if (named !== null && trimmed.length <= 160) contextPeriod = named;
    }
    caption = text.trim().slice(0, 300);
  }
  closePipe();

  const declared = documentCurrency(declarations);
  const declaredScale =
    scaleDeclarations.length === 0
      ? 0
      : new Set(scaleDeclarations).size > 1 ||
          scaleDeclarations.includes("CONFLICT")
        ? ("CONFLICT" as const)
        : (scaleDeclarations[0] ?? 0);

  // Labelled lines are read once the document's declarations are known.
  const relined = prose.flatMap((line) => {
    const found = readLine(line.text, { ...line, declared, declaredScale });
    return found === null ? [] : [found];
  });
  const drafts = [
    ...tables.flatMap((table) => readTable(table, declared, declaredScale)),
    ...relined,
  ];

  // The same measure and period stated twice with different figures is a
  // question for the founder's own records, not for code: neither is offered.
  const groups = new Map<string, Draft[]>();
  for (const draft of drafts) {
    const key = `${draft.measure}|${draft.period.key}`;
    groups.set(key, [...(groups.get(key) ?? []), draft]);
  }
  let ambiguousDropped = 0;
  const kept: LocalFigureCandidate[] = [];
  for (const group of groups.values()) {
    const [first] = group;
    if (first === undefined) continue;
    if (group.some((draft) => !sameValue(draft.value, first.value))) {
      ambiguousDropped += 1;
      continue;
    }
    const best = group.find((draft) => draft.confidence === "HIGH") ?? first;
    kept.push({ ...best, measuresVersion: FINANCIAL_MEASURES_VERSION });
  }
  // Each measure's latest period first; one candidate per measure offered.
  const latest = new Map<FinancialMeasureKey, LocalFigureCandidate>();
  for (const candidate of kept) {
    const held = latest.get(candidate.measure);
    if (
      held === undefined ||
      comparePeriods(candidate.period, held.period) > 0
    ) {
      latest.set(candidate.measure, candidate);
    }
  }
  return {
    candidates: [...latest.values()].slice(
      0,
      LOCAL_FIGURE_LIMITS.maxCandidates,
    ),
    tablesRead: tables.length,
    ambiguousDropped,
  };
}
