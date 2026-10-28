/**
 * The period a financial table's header or heading names, read by shape
 * alone: "Sep 2026", "September 2026", "Sep-26", "2026-09", "09/2026",
 * "30 September 2026", "Q3 2026", "FY2025", "2025". Deterministic, no
 * model, no clock: a header that is not one of these shapes is not a
 * period, and a two-digit year is read as 20xx only.
 */

export type PeriodGranularity = "MONTH" | "QUARTER" | "YEAR";

export type FigurePeriod = {
  readonly granularity: PeriodGranularity;
  /** "2026-09", "2026-Q3" or "2026". */
  readonly key: string;
  /** ISO date when the text names a day ("as of 30 Sep 2026"); else null. */
  readonly asOf: string | null;
  /** The words as written, bounded. */
  readonly label: string;
};

const MONTHS: readonly (readonly string[])[] = [
  ["jan", "january"],
  ["feb", "february"],
  ["mar", "march"],
  ["apr", "april"],
  ["may"],
  ["jun", "june"],
  ["jul", "july"],
  ["aug", "august"],
  ["sep", "sept", "september"],
  ["oct", "october"],
  ["nov", "november"],
  ["dec", "december"],
];

function monthNumber(word: string): number | null {
  const lower = word.toLowerCase().replace(/\.$/u, "");
  const index = MONTHS.findIndex((names) => names.includes(lower));
  return index < 0 ? null : index + 1;
}

function year(raw: string): number | null {
  const digits = raw.replace(/^'|^’/u, "");
  if (/^\d{4}$/u.test(digits)) {
    const value = Number(digits);
    return value >= 1990 && value <= 2100 ? value : null;
  }
  if (/^\d{2}$/u.test(digits)) return 2000 + Number(digits);
  return null;
}

const pad = (value: number) => String(value).padStart(2, "0");

function lastDay(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function month(
  y: number,
  m: number,
  label: string,
  day: number | null,
): FigurePeriod | null {
  if (m < 1 || m > 12) return null;
  if (day !== null && (day < 1 || day > lastDay(y, m))) return null;
  return {
    granularity: "MONTH",
    key: `${String(y)}-${pad(m)}`,
    asOf: day === null ? null : `${String(y)}-${pad(m)}-${pad(day)}`,
    label: label.slice(0, 60),
  };
}

/**
 * The text with an as-of preamble and qualifier words taken off, so a
 * header "Sep 2026 Actual" or a heading "As at 30 September 2026" reads as
 * its period. The qualifier itself is judged by the caller.
 */
function core(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[’]/gu, "'")
      // A bracketed qualifier is a unit or currency ("Sep 2026 (USD)").
      .replace(/\([^)]*\)|\[[^\]]*\]/gu, " ")
      .replace(/\b(?:as\s+(?:of|at)|at|for|period|month|ended|ending)\b/gu, " ")
      .replace(/\b(?:actuals?|act|unaudited|audited|mgmt|management)\b/gu, " ")
      .replace(/[,()]/gu, " ")
      .replace(/\s+/gu, " ")
      .trim()
  );
}

/** The period one cell or heading states on its own, or null. */
export function parsePeriod(text: string): FigurePeriod | null {
  const label = text.trim();
  if (label.length === 0 || label.length > 60) return null;
  const c = core(label);
  let match: RegExpExecArray | null;

  // 30 September 2026 / 30 Sep 26
  match = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)\.? ('?\d{2,4})$/u.exec(c);
  if (match !== null) {
    const m = monthNumber(match[2] ?? "");
    const y = year(match[3] ?? "");
    return m === null || y === null
      ? null
      : month(y, m, label, Number(match[1]));
  }
  // September 30 2026
  match = /^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)? ('?\d{4})$/u.exec(c);
  if (match !== null) {
    const m = monthNumber(match[1] ?? "");
    const y = year(match[3] ?? "");
    return m === null || y === null
      ? null
      : month(y, m, label, Number(match[2]));
  }
  // Sep 2026 / September 2026 / Sep-26 / Sep '26
  match = /^([a-z]+)\.?[ -]?('?\d{2}|\d{4})$/u.exec(c);
  const named = match === null ? null : monthNumber(match[1] ?? "");
  if (match !== null && named !== null) {
    const y = year(match[2] ?? "");
    return y === null ? null : month(y, named, label, null);
  }
  // 2026-09 / 2026/09
  match = /^(\d{4})[-/](\d{1,2})$/u.exec(c);
  if (match !== null) {
    const y = year(match[1] ?? "");
    return y === null ? null : month(y, Number(match[2]), label, null);
  }
  // 09/2026 / 9-2026
  match = /^(\d{1,2})[-/](\d{4})$/u.exec(c);
  if (match !== null) {
    const y = year(match[2] ?? "");
    return y === null ? null : month(y, Number(match[1]), label, null);
  }
  // 2026-09-30 (an ISO day)
  match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(c);
  if (match !== null) {
    const y = year(match[1] ?? "");
    return y === null
      ? null
      : month(y, Number(match[2]), label, Number(match[3]));
  }
  // Q3 2026 / Q3-26 / 2026 Q3 (a fiscal "Q3 FY26" is not a calendar quarter)
  match = /^q([1-4])[ -]?('?\d{2}|\d{4})$|^(\d{4}) q([1-4])$/u.exec(c);
  if (match !== null) {
    const q = Number(match[1] ?? match[4]);
    const y = year(match[2] ?? match[3] ?? "");
    return y === null
      ? null
      : {
          granularity: "QUARTER",
          key: `${String(y)}-Q${String(q)}`,
          asOf: null,
          label: label.slice(0, 60),
        };
  }
  // FY2025 / FY 2025 / 2025 (a fiscal year is read as named, never shifted)
  match = /^(?:fy ?)?(\d{4})$/u.exec(c);
  if (match !== null) {
    const y = year(match[1] ?? "");
    return y === null
      ? null
      : {
          granularity: "YEAR",
          key: String(y),
          asOf: null,
          label: label.slice(0, 60),
        };
  }
  return null;
}

/**
 * The one period a heading or caption names inside other words
 * ("Management accounts — September 2026", "Balance sheet as at 30
 * September 2026"). Two different periods in one line is ambiguous: null.
 */
export function periodInText(text: string): FigurePeriod | null {
  const bounded = text.slice(0, 300);
  const found: FigurePeriod[] = [];
  const shapes = [
    /\b\d{1,2}(?:st|nd|rd|th)? [A-Za-z]{3,9}\.? \d{4}\b/gu,
    /\b[A-Za-z]{3,9}\.? \d{1,2}(?:st|nd|rd|th)?,? \d{4}\b/gu,
    /\b[A-Za-z]{3,9}\.?[ -]\d{4}\b/gu,
    /\bQ[1-4] \d{4}\b/gu,
    /\b\d{4}-\d{2}\b/gu,
  ];
  const taken: [number, number][] = [];
  for (const shape of shapes) {
    for (const match of bounded.matchAll(shape)) {
      const start = match.index;
      const end = start + match[0].length;
      if (taken.some(([a, b]) => start < b && end > a)) continue;
      const period = parsePeriod(match[0]);
      if (period !== null) {
        taken.push([start, end]);
        found.push(period);
      }
    }
  }
  const keys = new Set(found.map((period) => period.key));
  return keys.size === 1 ? (found[0] ?? null) : null;
}

/** Order of two periods of the same granularity (by their keys). */
export function comparePeriods(a: FigurePeriod, b: FigurePeriod): number {
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** "September 2026", "Q3 2026", "2026": how the founder reads a period. */
export function describePeriod(period: FigurePeriod): string {
  if (period.granularity === "MONTH") {
    const [y = "", m = "1"] = period.key.split("-");
    const name = MONTHS[Number(m) - 1]?.at(-1) ?? "";
    const word = name.charAt(0).toUpperCase() + name.slice(1);
    return period.asOf === null
      ? `${word} ${y}`
      : `${String(Number(period.asOf.slice(8)))} ${word} ${y}`;
  }
  if (period.granularity === "QUARTER") {
    const [y = "", q = ""] = period.key.split("-");
    return `${q} ${y}`;
  }
  return period.key;
}

/** The instants a period spans, for a claim's validity (end exclusive). */
export function periodBounds(period: FigurePeriod): {
  readonly from: string;
  readonly to: string;
} {
  if (period.granularity === "MONTH") {
    const [y = 0, m = 1] = period.key.split("-").map(Number);
    return {
      from: new Date(Date.UTC(y, m - 1, 1)).toISOString(),
      to: new Date(Date.UTC(y, m, 1)).toISOString(),
    };
  }
  if (period.granularity === "QUARTER") {
    const [ys = "0", qs = "Q1"] = period.key.split("-");
    const y = Number(ys);
    const q = Number(qs.slice(1));
    return {
      from: new Date(Date.UTC(y, (q - 1) * 3, 1)).toISOString(),
      to: new Date(Date.UTC(y, q * 3, 1)).toISOString(),
    };
  }
  const y = Number(period.key);
  return {
    from: new Date(Date.UTC(y, 0, 1)).toISOString(),
    to: new Date(Date.UTC(y + 1, 0, 1)).toISOString(),
  };
}
