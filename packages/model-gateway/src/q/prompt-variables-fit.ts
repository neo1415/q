import type { z } from "zod";

/**
 * D16 (live 15 Nov 2026, run f1f8cf19): a turn whose assembled context
 * passed one prompt variable's bound failed to render, and the person saw
 * only "Q couldn't complete this request". The notes are bounded where
 * they are composed; this is the second layer, for any variable: what is
 * over its bound is shortened, and saying so (decision 97, never silent),
 * so the turn is answered from what fits instead of failing.
 */

/** Said in a shortened text or list: never silent (decision 97). */
export const SHORTENED_MARKER =
  "[More was here and is not shown for space: never say there is none of what is not shown.]";

/** Text within `max`: cut at a sentence end, with the marker. */
export function shortenedText(text: string, max: number): string {
  if (text.length <= max) return text;
  const room = max - SHORTENED_MARKER.length - 1;
  if (room <= 0) return text.slice(0, Math.max(0, max));
  const head = text.slice(0, room);
  const end = Math.max(head.lastIndexOf(". "), head.lastIndexOf("; "));
  const kept = (end > room / 2 ? head.slice(0, end + 1) : head).trimEnd();
  return `${kept} ${SHORTENED_MARKER}`;
}

export type FittedVariables = {
  /** The variables, every bound the schema reported now within it. */
  readonly variables: Record<string, unknown>;
  /** Which variables were over, as paths ("turnNotes", "authorisedFacts"). */
  readonly shortened: readonly string[];
};

/** A list over its bound: kept whole up to it, the newest turns for a conversation. */
function shortenedList(
  key: string,
  list: readonly unknown[],
  max: number,
): unknown[] {
  if (key === "conversation") return list.slice(list.length - max);
  if (key === "authorisedFacts" && max >= 1) {
    const kept = list.slice(0, max - 1);
    return [
      ...kept,
      {
        scope: "CAPITAL_Q_NOTE",
        statement: `${String(list.length - kept.length)} more authorised facts exist and were not shown for space; never say there is none of what is not shown.`,
        truthClass: "UNKNOWN",
        evidenceStatus: "NO_EVIDENCE",
      },
    ];
  }
  return list.slice(0, max);
}

function setAt(
  root: Record<string, unknown>,
  path: readonly PropertyKey[],
  change: (value: unknown) => unknown,
): void {
  let at: unknown = root;
  for (const key of path.slice(0, -1)) {
    if (typeof at !== "object" || at === null) return;
    at = (at as Record<PropertyKey, unknown>)[key];
  }
  const last = path[path.length - 1];
  if (typeof at !== "object" || at === null || last === undefined) return;
  const holder = at as Record<PropertyKey, unknown>;
  holder[last] = change(holder[last]);
}

/**
 * The variables with every too-long text and too-long list shortened to its
 * bound, as the schema reports them. Anything else invalid is left as it
 * is: that is a defect to surface, not to paper over.
 */
export function fittedVariables(
  schema: z.ZodType,
  input: Record<string, unknown>,
): FittedVariables {
  const variables = structuredClone(input);
  const shortened: string[] = [];
  for (let round = 0; round < 3; round += 1) {
    const parsed = schema.safeParse(variables);
    if (parsed.success) break;
    let changed = false;
    for (const issue of parsed.error.issues) {
      if (issue.code !== "too_big") continue;
      const max = Number(issue.maximum);
      if (!Number.isFinite(max)) continue;
      const key = String(issue.path[0] ?? "");
      setAt(variables, issue.path, (value) => {
        if (typeof value === "string" && value.length > max) {
          changed = true;
          return shortenedText(value, max);
        }
        if (Array.isArray(value) && value.length > max) {
          changed = true;
          return shortenedList(key, value, max);
        }
        return value;
      });
      shortened.push(issue.path.map(String).join("."));
    }
    if (!changed) break;
  }
  return { variables, shortened: [...new Set(shortened)] };
}
