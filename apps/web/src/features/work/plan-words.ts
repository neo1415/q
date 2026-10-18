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
