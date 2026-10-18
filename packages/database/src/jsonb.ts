import type { DatabaseExecutor } from "./types.js";

/**
 * A jsonb query parameter. postgres.js serialises a json-typed parameter
 * itself, so a value passed through JSON.stringify first and cast with
 * `::jsonb` is stored as a JSON *string* (jsonb_typeof = 'string') instead of
 * the object or array it describes. Always pass jsonb values through this.
 */
export function jsonbParam(sql: DatabaseExecutor, value: unknown) {
  return sql.json(
    JSON.parse(JSON.stringify(value)) as Parameters<
      DatabaseExecutor["json"]
    >[0],
  );
}

/**
 * Reads a jsonb column that older rows may hold double-encoded (a JSON string
 * whose text is the real value). A value that is not a string, or a string
 * that is not JSON, is returned unchanged.
 */
export function decodeJsonbString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}
