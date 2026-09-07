/**
 * Canonical JSON serialisation for integrity binding (CQ-Q-008 §25).
 *
 * Two structurally equal values serialise to the same bytes whatever the
 * insertion order of their properties, so a hash over this text is a
 * property of the value, not of the code path that built it:
 *
 *   - object keys are sorted by code unit, recursively;
 *   - `undefined` properties are dropped (JSON has no undefined);
 *   - arrays keep their order (order is meaning: a list of recipients);
 *   - strings and numbers use JSON's own escaping and number grammar;
 *   - non-finite numbers, bigints, functions, symbols and Dates are
 *     refused rather than silently coerced, because a value that cannot be
 *     represented exactly cannot be bound exactly.
 *
 * This is the only serialiser a payload hash may be computed over. Plain
 * `JSON.stringify` of an object whose key order happens to match is not a
 * security definition.
 */

export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalJsonError";
  }
}

function canonicalise(value: unknown, path: string): unknown {
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      if (!Number.isFinite(value)) {
        throw new CanonicalJsonError(
          `non-finite number at ${path} cannot be canonicalised`,
        );
      }
      // -0 and 0 are one JSON number.
      return value === 0 ? 0 : value;
    case "undefined":
      throw new CanonicalJsonError(`undefined at ${path} has no JSON form`);
    case "bigint":
    case "function":
    case "symbol":
      throw new CanonicalJsonError(
        `${typeof value} at ${path} cannot be canonicalised`,
      );
    case "object":
      break;
  }
  if (value === null) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      if (item === undefined) {
        throw new CanonicalJsonError(
          `undefined array element at ${path}[${String(index)}] has no JSON form`,
        );
      }
      return canonicalise(item, `${path}[${String(index)}]`);
    });
  }
  if (
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  ) {
    throw new CanonicalJsonError(
      `non-plain object at ${path} cannot be canonicalised`,
    );
  }
  const out: Record<string, unknown> = {};
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record).sort()) {
    const nested = record[key];
    if (nested !== undefined) {
      out[key] = canonicalise(nested, `${path}.${key}`);
    }
  }
  return out;
}

/**
 * The canonical JSON text of `value`. Deterministic for structurally equal
 * plain data; throws CanonicalJsonError for anything JSON cannot carry
 * exactly.
 */
export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalise(value, "$"));
}

/** The canonical plain-data form itself, for callers that hash or compare structurally. */
export function toCanonicalJsonValue(value: unknown): unknown {
  return canonicalise(value, "$");
}
