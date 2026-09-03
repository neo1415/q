import { z } from "zod";

import {
  parseContract,
  UtcTimestampSchema,
  UuidSchema,
} from "@capital-q/contracts";

/**
 * Continuation state for the capital objective list, ordered by
 * (created_at desc, id desc) so the current/latest objective comes first.
 * Opaque to clients: base64url JSON, validated on the way back in. A cursor
 * is not authorization; every page re-checks the caller's company context.
 */
const CapitalObjectiveCursorSchema = z
  .object({
    createdAt: UtcTimestampSchema,
    id: UuidSchema,
  })
  .strict();

export type CapitalObjectiveCursor = z.infer<
  typeof CapitalObjectiveCursorSchema
>;

export function encodeCapitalObjectiveCursor(
  cursor: CapitalObjectiveCursor,
): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCapitalObjectiveCursor(
  raw: string,
): CapitalObjectiveCursor {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    decoded = undefined;
  }
  return parseContract(
    CapitalObjectiveCursorSchema,
    decoded,
    "The cursor is not one this server issued.",
  );
}
