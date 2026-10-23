/**
 * The bound preview, laid out: a standing instruction's grant names what
 * Q does on its own ("On my own…") and what it asks first ("I ask you
 * first…"); anything else is the content itself (a message), quoted. The
 * rest of a grant stays available under "Full plan", word for word.
 */
export function readPlan(preview: string | undefined): {
  readonly quote: string | null;
  readonly alone: string | null;
  readonly asks: string | null;
  readonly rest: string | null;
} {
  if (preview === undefined || preview.trim().length === 0) {
    return { quote: null, alone: null, asks: null, rest: null };
  }
  const parts = preview.split(/\n{2,}/u);
  const find = (prefix: RegExp) => parts.find((part) => prefix.test(part));
  const alone = find(/^On my own/u);
  const asks = find(/^I ask you first/u);
  if (alone === undefined && asks === undefined) {
    return { quote: preview, alone: null, asks: null, rest: null };
  }
  const items = (part: string | undefined) =>
    part === undefined
      ? null
      : part
          .split("\n")
          .slice(1)
          .map((line) => line.replace(/^- /u, "").replace(/\s*\(.*$/u, ""))
          .filter((line) => line.length > 0)
          .join(", ") || null;
  return {
    quote: null,
    alone: items(alone),
    asks: items(asks) ?? "Anything else",
    rest: preview,
  };
}

export type PlanChange = {
  readonly label: string;
  /** Null: the card carried no earlier value (only the new one). */
  readonly before: string | null;
  readonly after: string;
  readonly unchanged: boolean;
};

const CHANGE_LINE = /^([^:\n]{1,40}): (.+)$/u;
const ARROW = " → ";

/**
 * F-29 (QA 2026-10-23): a change card's preview, one field per line
 * ("Earliest stage: Seed → Pre-seed"), laid out as before and after. Null
 * when the preview is not such a list (a message is quoted as it is).
 */
export function readChanges(
  preview: string | undefined,
): readonly PlanChange[] | null {
  if (preview === undefined) return null;
  const lines = preview
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return null;
  const rows: PlanChange[] = [];
  for (const line of lines) {
    const match = CHANGE_LINE.exec(line);
    const label = match?.[1];
    const value = match?.[2];
    if (label === undefined || value === undefined) return null;
    const at = value.indexOf(ARROW);
    const unchanged = value.endsWith(" (no change)");
    rows.push(
      at === -1
        ? {
            label,
            before: null,
            after: unchanged ? value.slice(0, -" (no change)".length) : value,
            unchanged,
          }
        : {
            label,
            before: value.slice(0, at),
            after: value.slice(at + ARROW.length),
            unchanged: false,
          },
    );
  }
  // Only a list that shows a change is laid out as one.
  return rows.some((row) => row.before !== null || row.unchanged) ? rows : null;
}
