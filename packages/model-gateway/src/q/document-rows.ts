import type { AuthorisedFact } from "@capital-q/q-core";

/**
 * Live re-check on a65386689 (16 Nov 2026, run 91bb8564): Thames Arc asked
 * Halyard Security's hiring plan "by role" and Q said "4 public-sector
 * account managers" (the plan's row says 3) and "5 in Q1" (its Q1 rows add
 * up to 4). The plan reached the answer as a retrieved passage whose table
 * the PDF extraction had run together: "Public-sector account manager |
 * Sales | 3 2027-Q1 | ..." under "Product engineer (shared workstations,
 * Engineering | 4 2027-Q2 | ...", with a wrapped role ("Information security
 * and assurance | Operations | 1 2027-Q1" over "manager | G&A").
 *
 * Code reads such a table's rows itself -- the item, its one count, its
 * period -- so the answer is handed the rows plainly (a fact beside the
 * passage) and the claim check holds a period's count ("5 in Q1") to the
 * rows that start in it. Deterministic, no model. A table is read only
 * when a header names a count column; a row with more than one count (a
 * month-by-month series) is no row of this kind and is skipped; a table
 * whose own "Total" row its rows do not add up to is not read at all.
 */

export type TableRow = {
  /** The row's item as the document writes it ("Public-sector account manager"). */
  readonly label: string;
  readonly count: number;
  /** "2027-Q1", or null where the row states no quarter. */
  readonly period: string | null;
};

export type DocumentTable = {
  readonly rows: readonly TableRow[];
};

/** A header naming a column of counts. */
const COUNT_HEADER =
  /(?<![\p{L}])(?:people|headcount|hires|heads|fte|number|count|quantity|qty)(?![\p{L}])/iu;
/** A cell that opens with a whole number ("3", "3 2027-Q1"), never a year's quarter. */
const COUNT_CELL = /^(?<n>\d{1,4})(?![\d,.\-/:%])(?:\s|$)/u;
const QUARTER =
  /(?<![\p{L}\p{N}])(?:(?<y1>(?:19|20)\d{2})\s?-?\s?q(?<q1>[1-4])|q(?<q2>[1-4])\s?(?:of\s+)?(?<y2>(?:19|20)\d{2}))(?![\p{L}\p{N}])/iu;
const TOTAL_LABEL = /^(?:total|totals|grand total|sum)$/iu;
/** Lines of a text: real breaks, a JSON string's escaped ones. */
const LINE_BREAK = /\r?\n|\\n|\\r/u;

/** "2027-Q1" from a cell, or null. */
export function quarterOf(text: string): string | null {
  const match = QUARTER.exec(text);
  if (match === null) return null;
  const groups = match.groups ?? {};
  const year = groups["y1"] ?? groups["y2"];
  const quarter = groups["q1"] ?? groups["q2"];
  return year === undefined || quarter === undefined
    ? null
    : `${year}-Q${quarter}`;
}

/** The label, without a parenthesis the extraction cut off ("Product engineer (shared workstations, Engineering"). */
function cleanLabel(cell: string): string {
  const open = cell.lastIndexOf("(");
  const cut =
    open >= 0 && !cell.slice(open).includes(")") ? cell.slice(0, open) : cell;
  return cut
    .replace(/\s+/gu, " ")
    .replace(/[\s,;:]+$/u, "")
    .trim();
}

const cellsOf = (line: string): string[] =>
  line.split("|").map((cell) => cell.trim());

/** Every count table in a text, its rows in the document's order. */
export function documentTables(text: string): DocumentTable[] {
  const lines = text
    .split(LINE_BREAK)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const tables: DocumentTable[] = [];
  let rows: TableRow[] | null = null;
  let total: number | null = null;
  let broken = false;
  // A row's label still open: the extraction wrapped it onto the next line.
  let open: { label: string; unclosed: boolean } | null = null;
  const close = (): void => {
    if (rows !== null && rows.length > 0 && !broken) {
      const sum = rows.reduce((all, row) => all + row.count, 0);
      if (total === null || total === sum) tables.push({ rows });
    }
    rows = null;
    total = null;
    broken = false;
    open = null;
  };
  for (const line of lines) {
    const cells = cellsOf(line);
    if (cells.length >= 2 && COUNT_HEADER.test(line) && !/\d/u.test(line)) {
      close();
      rows = [];
      continue;
    }
    if (rows === null) continue;
    const counted = cells
      .slice(1)
      .map((cell) => COUNT_CELL.exec(cell))
      .filter((match) => match !== null);
    if (cells.length >= 2 && counted.length === 1) {
      const count = Number(counted[0]?.groups?.["n"]);
      const rawLabel = cells[0] ?? "";
      const label = cleanLabel(rawLabel);
      if (label.length === 0 || /\d/u.test(label)) {
        broken = true;
        continue;
      }
      if (TOTAL_LABEL.test(label)) {
        total = count;
        open = null;
        continue;
      }
      const period =
        cells
          .slice(1)
          .map(quarterOf)
          .find((one) => one !== null) ?? null;
      rows.push({ label, count, period });
      open = {
        label,
        unclosed: rawLabel.includes("(") && !rawLabel.includes(")"),
      };
      continue;
    }
    if (cells.length >= 2 && counted.length > 1) {
      // A series (month by month): not a table of items and their counts.
      broken = true;
      continue;
    }
    // A wrapped row: "manager | G&A" under "Information security and
    // assurance | Operations | 1 2027-Q1". Only a line with cells carries
    // the first column on; a bare line ("lost devices)", "G&A") is the end
    // of some other cell, and changes no label.
    const last = rows.at(-1);
    if (
      cells.length >= 2 &&
      counted.length === 0 &&
      open !== null &&
      !open.unclosed &&
      last !== undefined &&
      /^[\p{Ll}]/u.test(cells[0] ?? "") &&
      (cells[0] ?? "").split(/\s+/u).length <= 3
    ) {
      const label = `${last.label} ${cleanLabel(cells[0] ?? "")}`;
      rows[rows.length - 1] = { ...last, label };
      open = null;
      continue;
    }
    if (
      cells.length < 2 &&
      line.split(/\s+/u).length <= 3 &&
      !/\d/u.test(line)
    ) {
      continue;
    }
    close();
  }
  close();
  return tables;
}

/** The rows a fact's text holds, said plainly; null when it holds no count table. */
export function documentRowsStatement(text: string): string | null {
  const tables = documentTables(text);
  if (tables.length === 0) return null;
  const lines: string[] = [];
  for (const table of tables) {
    for (const row of table.rows) {
      lines.push(
        `${row.label}: ${String(row.count)}${row.period === null ? "" : ` (starts ${row.period})`}`,
      );
    }
    const periods = [
      ...new Set(
        table.rows.flatMap((row) => (row.period === null ? [] : [row.period])),
      ),
    ].sort();
    if (periods.length >= 2) {
      for (const period of periods) {
        const sum = table.rows
          .filter((row) => row.period === period)
          .reduce((all, row) => all + row.count, 0);
        lines.push(`Starting ${period}: ${String(sum)} in all`);
      }
    }
    if (table.rows.length >= 2) {
      const sum = table.rows.reduce((all, row) => all + row.count, 0);
      lines.push(`These rows add up to ${String(sum)}`);
    }
  }
  return `The table's rows, read one by one by Capital Q from the passage (each count belongs to its own row only):\n${lines.join("\n")}`;
}

/**
 * A fact beside each document passage that holds a count table: its rows,
 * read by code. Same source, same truth and evidence as the passage; a
 * passage already stated once is read once.
 */
export function documentRowFacts(
  facts: readonly AuthorisedFact[],
): AuthorisedFact[] {
  const seen = new Set<string>();
  const out: AuthorisedFact[] = [];
  for (const fact of facts) {
    if (!fact.statement.includes("|")) continue;
    const statement = documentRowsStatement(fact.statement);
    if (statement === null || seen.has(statement)) continue;
    seen.add(statement);
    out.push({
      scope: fact.scope,
      statement,
      truthClass: fact.truthClass,
      evidenceStatus: fact.evidenceStatus,
      ...(fact.source === undefined ? {} : { source: fact.source }),
      ...(fact.asOf === undefined ? {} : { asOf: fact.asOf }),
    });
  }
  return out;
}
