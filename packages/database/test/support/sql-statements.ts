/**
 * Pulls the SQL text out of `sql` tagged templates in a TypeScript source,
 * for static guards over hand-written queries. Interpolations become `$n`:
 * a guard reasons about the statement's shape, never its values.
 *
 * Deliberately small: it understands `sql`, `tx.sql`, `sql<Row[]>` and
 * nested templates inside `${…}`, which is everything the repositories use.
 */

export type SqlStatement = {
  /** 1-based line of the opening backtick. */
  readonly line: number;
  /** The statement with every interpolation replaced by `$n`. */
  readonly text: string;
};

const TAG = /\bsql\s*(?:<(?:[^<>]|<[^<>]*>)*>)?\s*`/g;

export function sqlStatements(source: string): SqlStatement[] {
  const statements: SqlStatement[] = [];
  for (const match of source.matchAll(TAG)) {
    const start = match.index + match[0].length;
    const { text, end } = readTemplate(source, start);
    if (end < 0) continue;
    statements.push({
      line: source.slice(0, start).split("\n").length,
      text,
    });
  }
  return statements;
}

/** Reads a template body from just after its backtick; `end` is -1 if unterminated. */
function readTemplate(
  source: string,
  from: number,
): { text: string; end: number } {
  let text = "";
  let holes = 0;
  let i = from;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      text += source.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch === "`") return { text, end: i };
    if (ch === "$" && source[i + 1] === "{") {
      i = skipExpression(source, i + 2);
      if (i < 0) return { text, end: -1 };
      holes += 1;
      text += `$${String(holes)}`;
      continue;
    }
    text += ch;
    i += 1;
  }
  return { text, end: -1 };
}

/** Skips a `${…}` expression (from just inside the brace) to just past its `}`. */
function skipExpression(source: string, from: number): number {
  let depth = 1;
  let i = from;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "`") {
      const inner = readTemplate(source, i + 1);
      if (inner.end < 0) return -1;
      i = inner.end + 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      i = skipString(source, i);
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return -1;
}

function skipString(source: string, from: number): number {
  const quote = source[from];
  let i = from + 1;
  while (i < source.length && source[i] !== quote) {
    i += source[i] === "\\" ? 2 : 1;
  }
  return i + 1;
}
