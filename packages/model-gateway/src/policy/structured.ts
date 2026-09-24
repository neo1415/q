import type { z } from "zod";

/**
 * Structured output acceptance (doc 12 §27; packet §32).
 *
 *   provider text → JSON decode → Zod validation → typed value
 *
 * Provider JSON that parses is not yet data. Only what the caller's Zod
 * schema accepts is returned; anything else is INVALID_MODEL_OUTPUT and
 * is never persisted. Code fences are tolerated because models emit them
 * despite instructions; nothing else is "repaired".
 */

export type StructuredOutcome<T> =
  | {
      readonly ok: true;
      readonly value: T;
      /**
       * List elements the schema refused and that were dropped rather
       * than refusing the whole object (`invalidListItems: "DROP"`), as
       * field paths and Zod codes. Empty when nothing was dropped.
       */
      readonly dropped?: readonly string[];
    }
  | {
      readonly ok: false;
      /** Which stage refused: a bounded reason, never the model text. */
      readonly stage: "JSON" | "SCHEMA";
      /**
       * Which fields the schema refused and why, as field paths and Zod's
       * own codes. Never a value the model wrote, so this is safe to log
       * and is the difference between "the model is wrong" and "we are
       * asking for something this model cannot produce". Bounded.
       */
      readonly refusals?: readonly string[];
    };

const FENCE = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i;

/**
 * What to do with one element of a list that the schema refuses.
 *
 * REFUSE (the default): the whole object is refused, as it always was.
 * DROP: that element alone is removed and the rest validated again. For a
 * caller whose lists are independent readings — a statement the person
 * made, a change they asked for — one malformed reading is not a reason
 * to throw away the others (CQ-QX-007 A5: an invalid knowledge key on one
 * statement discarded the profile change beside it, and the person was
 * told the change was "noted" when nothing had been proposed). Only list
 * ELEMENTS are ever dropped; a refused field outside any list still
 * refuses the object, and nothing is repaired or rewritten.
 */
export type InvalidListItems = "REFUSE" | "DROP";

/** Bounded: a response this broken is refused, not whittled down. */
const DROP_PASSES_MAX = 4;
const DROPPED_MAX = 8;

type Issue = { readonly path: readonly PropertyKey[]; readonly code: string };

/** The innermost array element an issue sits in, as [array, index]. */
function containingElement(
  root: unknown,
  path: readonly PropertyKey[],
): readonly [unknown[], number] | null {
  let found: readonly [unknown[], number] | null = null;
  let node: unknown = root;
  for (const key of path) {
    if (Array.isArray(node) && typeof key === "number") {
      found = [node, key];
      node = node[key];
      continue;
    }
    if (node !== null && typeof node === "object" && typeof key === "string") {
      node = (node as Record<string, unknown>)[key];
      continue;
    }
    break;
  }
  return found;
}

const describe = (issue: Issue): string =>
  `${issue.path.map(String).join(".") || "(root)"}:${issue.code}`;

export function acceptStructuredOutput<T>(
  text: string,
  schema: z.ZodType<T>,
  options: { readonly invalidListItems?: InvalidListItems | undefined } = {},
): StructuredOutcome<T> {
  const fenced = FENCE.exec(text);
  const body = (fenced?.[1] ?? text).trim();
  let decoded: unknown;
  try {
    decoded = JSON.parse(body);
  } catch {
    return { ok: false, stage: "JSON" };
  }
  let parsed = schema.safeParse(decoded);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  const refused = parsed.error.issues.slice(0, 8).map(describe);
  if (options.invalidListItems !== "DROP") {
    return { ok: false, stage: "SCHEMA", refusals: refused };
  }
  // Work on a copy: the decoded object is the model's, and what was
  // dropped is reported rather than silently forgotten.
  const working: unknown = structuredClone(decoded);
  const dropped: string[] = [];
  for (let pass = 0; pass < DROP_PASSES_MAX && !parsed.success; pass += 1) {
    const removals = new Map<unknown[], Set<number>>();
    for (const issue of parsed.error.issues) {
      const element = containingElement(working, issue.path);
      if (element === null) {
        // A refused field outside any list: nothing may be dropped for it.
        return { ok: false, stage: "SCHEMA", refusals: refused };
      }
      const [list, index] = element;
      const indices = removals.get(list) ?? new Set<number>();
      indices.add(index);
      removals.set(list, indices);
      dropped.push(describe(issue));
    }
    for (const [list, indices] of removals) {
      for (const index of [...indices].sort((a, b) => b - a)) {
        list.splice(index, 1);
      }
    }
    if (dropped.length > DROPPED_MAX) {
      return { ok: false, stage: "SCHEMA", refusals: refused };
    }
    parsed = schema.safeParse(working);
  }
  if (!parsed.success) {
    return { ok: false, stage: "SCHEMA", refusals: refused };
  }
  return { ok: true, value: parsed.data, dropped: dropped.slice(0, 8) };
}
