import type { OptionReference } from "./reading.js";

/**
 * Resolving a pointed-at choice against what was actually shown
 * (CQ-QX-005 §5).
 *
 * "The last four" is an answer. It was being treated as a failure because
 * the only thing that could place an answer was matching its words to an
 * option's label, and those words match nothing. The model now says how
 * the person pointed; this says what they pointed at, from the option set
 * the consumer put on screen last — the person's screen, not the
 * journey's catalogue, because "the second one" means the second one THEY
 * saw.
 *
 * Deterministic and total: every reference resolves to keys or to a named
 * reason it could not, and the reason is what the consumer asks about.
 */

export type ShownOption = {
  readonly key: string;
  readonly label: string;
};

export type ResolvedReference =
  | { readonly kind: "KEYS"; readonly keys: readonly string[] }
  | {
      readonly kind: "UNRESOLVED";
      readonly because:
        "NO_OPTION_SET" | "OUT_OF_RANGE" | "NO_PREVIOUS_SELECTION" | "EMPTY";
    };

export function resolveOptionReference(
  reference: OptionReference,
  shown: readonly ShownOption[],
  /** What they chose last time on this target, for "same as before". */
  previous: readonly string[] | null,
): ResolvedReference {
  if (reference.select === "SAME_AS_BEFORE") {
    return previous === null || previous.length === 0
      ? { kind: "UNRESOLVED", because: "NO_PREVIOUS_SELECTION" }
      : { kind: "KEYS", keys: [...previous] };
  }
  if (shown.length === 0) {
    return { kind: "UNRESOLVED", because: "NO_OPTION_SET" };
  }
  const keys = shown.map((option) => option.key);
  switch (reference.select) {
    case "ALL":
      return { kind: "KEYS", keys };
    case "NONE":
      return { kind: "KEYS", keys: [] };
    case "LAST": {
      const count = reference.count ?? 1;
      if (count > keys.length) {
        return { kind: "UNRESOLVED", because: "OUT_OF_RANGE" };
      }
      return { kind: "KEYS", keys: keys.slice(keys.length - count) };
    }
    case "FIRST": {
      const count = reference.count ?? 1;
      if (count > keys.length) {
        return { kind: "UNRESOLVED", because: "OUT_OF_RANGE" };
      }
      return { kind: "KEYS", keys: keys.slice(0, count) };
    }
    case "ORDINAL": {
      const ordinals = reference.ordinals ?? [];
      if (ordinals.length === 0) {
        return { kind: "UNRESOLVED", because: "EMPTY" };
      }
      if (ordinals.some((n) => n > keys.length)) {
        return { kind: "UNRESOLVED", because: "OUT_OF_RANGE" };
      }
      return {
        kind: "KEYS",
        keys: [...new Set(ordinals.map((n) => keys[n - 1]))].filter(
          (key): key is string => key !== undefined,
        ),
      };
    }
    case "EXCLUDE": {
      const ordinals = reference.ordinals ?? [];
      if (ordinals.some((n) => n > keys.length)) {
        return { kind: "UNRESOLVED", because: "OUT_OF_RANGE" };
      }
      // "Not that one" against a previous selection narrows the
      // selection; against a fresh set it means everything else.
      const base =
        previous !== null && previous.length > 0
          ? previous.filter((key) => keys.includes(key))
          : keys;
      const excluded = new Set(ordinals.map((n) => keys[n - 1]));
      return {
        kind: "KEYS",
        keys: base.filter((key) => !excluded.has(key)),
      };
    }
  }
}

/** The labels a resolution names, for reading it back in plain words. */
export function labelsOf(
  keys: readonly string[],
  shown: readonly ShownOption[],
): readonly string[] {
  return keys
    .map((key) => shown.find((option) => option.key === key)?.label)
    .filter((label): label is string => label !== undefined);
}
