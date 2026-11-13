/**
 * A company may publish several CURRENT claims of one metric with different
 * dates: its history (June, July, August, September MRR). A chart draws all
 * of them (figure-chart.ts); a reader that presents ONE value per metric
 * (a comparison cell, a fact handed to the model) must present the latest,
 * never an earlier month as if it were today's.
 *
 * Per claim key:
 * - the latest dated reading wins; an undated reading gives way to any
 *   dated one (an undated figure cannot be shown to be the newer);
 * - with no dated reading, every reading stays (nothing to order by);
 * - two readings for the same latest date that differ both stay: a
 *   contradiction coexists until a person reconciles it, never resolved by
 *   picking one; identical ones collapse to the first listed (readers list
 *   the most recently asserted first).
 * Order is otherwise kept.
 */

type Figure = {
  readonly key: string;
  readonly statement?: string | undefined;
  readonly asOf: string | null;
  readonly value?: Readonly<Record<string, unknown>> | null | undefined;
};

const DATE = /^(\d{4}-\d{2}-\d{2})/u;

function dayOf(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  return DATE.exec(raw.trim())?.[1] ?? null;
}

/** The date a reading is for: its value's own date, else the claim's. */
export function figureDate(figure: Figure): string | null {
  const value = figure.value ?? null;
  return (
    dayOf(value?.["asOf"]) ?? dayOf(value?.["periodEnd"]) ?? dayOf(figure.asOf)
  );
}

function sameReading(a: Figure, b: Figure): boolean {
  const left = a.value ?? null;
  const right = b.value ?? null;
  if (left === null || right === null) {
    return left === right && (a.statement ?? "") === (b.statement ?? "");
  }
  return stable(left) === stable(right);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** The readings a one-value-per-metric reader may show (see above). */
export function latestFigures<T extends Figure>(
  figures: readonly T[],
): readonly T[] {
  const latest = new Map<string, string>();
  for (const figure of figures) {
    const date = figureDate(figure);
    if (date === null) continue;
    const before = latest.get(figure.key);
    if (before === undefined || date > before) latest.set(figure.key, date);
  }
  const kept: T[] = [];
  for (const figure of figures) {
    const newest = latest.get(figure.key);
    if (newest !== undefined && figureDate(figure) !== newest) continue;
    if (
      kept.some(
        (one) =>
          one.key === figure.key &&
          figureDate(one) === figureDate(figure) &&
          sameReading(one, figure),
      )
    ) {
      continue;
    }
    kept.push(figure);
  }
  return kept;
}
