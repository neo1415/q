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

type Issue = {
  readonly path: readonly PropertyKey[];
  readonly code: string;
  readonly keys?: readonly string[];
};

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

/** The value at a path, or undefined where the path leaves the object. */
function valueAt(root: unknown, path: readonly PropertyKey[]): unknown {
  let node: unknown = root;
  for (const key of path) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<PropertyKey, unknown>)[key];
  }
  return node;
}

// Which field names were unexpected, when that is the refusal: a field
// name, bounded, never a value the model wrote (live 2026-09-30: every
// ASSESS answer refused as "(root):unrecognized_keys", with no way to see
// which key without it).
const describe = (issue: Issue): string =>
  `${issue.path.map(String).join(".") || "(root)"}:${issue.code}${
    issue.code === "unrecognized_keys" && issue.keys !== undefined
      ? `(${issue.keys
          .slice(0, 4)
          .map((key) => key.replace(/[^A-Za-z0-9_]/g, "").slice(0, 40))
          .join(",")})`
      : ""
  }`;

export function acceptStructuredOutput<T>(
  text: string,
  schema: z.ZodType<T>,
  options: {
    readonly invalidListItems?: InvalidListItems | undefined;
    /**
     * Top-level fields that are auxiliary to the reading: when the model
     * wrote one in the wrong shape, that field alone is left out (its
     * schema default applies) instead of refusing the whole object, and it
     * is reported in `dropped`. Live 2026-10-01: an answer that wrote
     * `actionTalk` as a string lost the whole round, and the person got a
     * tool-less fallback that said what Q "needed to retrieve".
     */
    readonly lenientFields?: readonly string[] | undefined;
    /**
     * Fixed-set labels (enums) by dotted path, with the value that stands
     * in when the model wrote a label outside the set. A label that only
     * differs in case, spacing or hyphens is always mapped to the set's
     * own spelling. Live 2026-10-01: a rehearsal persona whose mood was
     * one word outside the list was refused whole, six times running, and
     * the lobby could not open.
     */
    readonly enumFallbacks?: Readonly<Record<string, string>> | undefined;
  } = {},
): StructuredOutcome<T> {
  const fenced = FENCE.exec(text);
  const body = (fenced?.[1] ?? text).trim();
  let decoded: unknown;
  try {
    decoded = JSON.parse(body);
  } catch {
    return { ok: false, stage: "JSON" };
  }
  const lenientDropped: string[] = [];
  const lenient = options.lenientFields ?? [];
  if (
    lenient.length > 0 &&
    decoded !== null &&
    typeof decoded === "object" &&
    !Array.isArray(decoded)
  ) {
    let first = schema.safeParse(decoded);
    if (!first.success) {
      // Inside an auxiliary field, one malformed element costs that
      // element, not the field (Zino live 2026-10-07: one card's `reasons`
      // written as a string lost all eight answer cards). A lone string
      // where a list of strings belongs is read as that one-item list;
      // any other refused element is dropped. Bounded, reported, and only
      // ever inside a lenient field.
      const working = structuredClone(decoded) as Record<string, unknown>;
      let touched = false;
      for (let pass = 0; pass < DROP_PASSES_MAX && !first.success; pass += 1) {
        const removals = new Map<unknown[], Set<number>>();
        let changed = false;
        // A string refused as a list is also refused for its length
        // against the list's bounds; once read as a list, those go too.
        const listed = new Set<string>();
        const typeFirst = [...first.error.issues].sort(
          (a, b) =>
            (a.code === "invalid_type" ? 0 : 1) -
            (b.code === "invalid_type" ? 0 : 1),
        );
        for (const issue of typeFirst) {
          const field = issue.path[0];
          if (typeof field !== "string" || !lenient.includes(field)) continue;
          if (listed.has(issue.path.map(String).join("."))) continue;
          const parent = valueAt(working, issue.path.slice(0, -1));
          const key = issue.path.at(-1);
          const value =
            parent !== null && typeof parent === "object" && key !== undefined
              ? (parent as Record<PropertyKey, unknown>)[key]
              : undefined;
          if (
            issue.code === "invalid_type" &&
            (issue as { readonly expected?: unknown }).expected === "array" &&
            typeof value === "string" &&
            value.trim().length > 0 &&
            key !== undefined
          ) {
            (parent as Record<PropertyKey, unknown>)[key] = [value];
            listed.add(issue.path.map(String).join("."));
            lenientDropped.push(`${describe(issue)}:as_list`);
            changed = true;
            continue;
          }
          const element = containingElement(working, issue.path);
          if (element === null || issue.path.length < 3) continue;
          const [array, index] = element;
          const set = removals.get(array) ?? new Set<number>();
          set.add(index);
          removals.set(array, set);
        }
        for (const [array, indexes] of removals) {
          for (const index of [...indexes].sort((a, b) => b - a)) {
            array.splice(index, 1);
            changed = true;
            lenientDropped.push("lenient:element_dropped");
          }
        }
        if (!changed) break;
        touched = true;
        first = schema.safeParse(working);
      }
      if (touched) decoded = working;
    }
    if (!first.success) {
      const record = { ...(decoded as Record<string, unknown>) };
      for (const issue of first.error.issues) {
        const field = issue.path[0];
        if (
          typeof field === "string" &&
          lenient.includes(field) &&
          field in record
        ) {
          delete record[field];
          lenientDropped.push(describe(issue));
        }
      }
      // A required-but-nullable field left out stands as null, its
      // "nothing to say" value (live 2026-10-01: a malformed
      // `recommendation` refused whole answers).
      const second = schema.safeParse(record);
      if (!second.success) {
        for (const issue of second.error.issues) {
          const field = issue.path[0];
          if (
            issue.path.length === 1 &&
            typeof field === "string" &&
            lenient.includes(field) &&
            !(field in record)
          ) {
            record[field] = null;
          }
        }
      }
      decoded = record;
    }
  }
  const repaired = repairLabels(schema, decoded, options.enumFallbacks);
  decoded = repaired.value;
  lenientDropped.push(...repaired.replaced);
  let parsed = schema.safeParse(decoded);
  if (parsed.success && lenientDropped.length > 0) {
    return {
      ok: true,
      value: parsed.data,
      dropped: lenientDropped.slice(0, 8),
    };
  }
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
  return {
    ok: true,
    value: parsed.data,
    dropped: [...lenientDropped, ...dropped].slice(0, 8),
  };
}

/**
 * Labels outside an enum: the set's own spelling when only case, spaces or
 * hyphens differ; otherwise the configured stand-in for that path. Works
 * on a copy and reports each path it changed (never the value written).
 */
function repairLabels<T>(
  schema: z.ZodType<T>,
  decoded: unknown,
  fallbacks: Readonly<Record<string, string>> | undefined,
): { readonly value: unknown; readonly replaced: readonly string[] } {
  const first = schema.safeParse(decoded);
  if (first.success || decoded === null || typeof decoded !== "object") {
    return { value: decoded, replaced: [] };
  }
  const labelIssues = first.error.issues.filter(
    (issue) => issue.code === "invalid_value" && issue.path.length > 0,
  );
  if (labelIssues.length === 0) return { value: decoded, replaced: [] };
  const working: unknown = structuredClone(decoded);
  const replaced: string[] = [];
  for (const issue of labelIssues) {
    const path = issue.path;
    let parent: unknown = working;
    for (const key of path.slice(0, -1)) {
      if (parent === null || typeof parent !== "object") break;
      parent = (parent as Record<PropertyKey, unknown>)[key];
    }
    if (parent === null || typeof parent !== "object") continue;
    const last = path[path.length - 1] as PropertyKey;
    const current = (parent as Record<PropertyKey, unknown>)[last];
    const allowed = (issue as { values?: readonly unknown[] }).values ?? [];
    const spelled =
      typeof current === "string"
        ? current
            .trim()
            .toUpperCase()
            .replace(/[\s-]+/g, "_")
        : null;
    const dotted = path
      .filter((key) => typeof key !== "number")
      .map(String)
      .join(".");
    const stand =
      spelled !== null && allowed.includes(spelled)
        ? spelled
        : fallbacks?.[dotted];
    if (stand === undefined) continue;
    (parent as Record<PropertyKey, unknown>)[last] = stand;
    replaced.push(`${dotted}:label`);
  }
  return { value: working, replaced };
}
