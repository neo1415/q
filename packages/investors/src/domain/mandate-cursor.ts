import { z } from "zod";

import {
  parseContract,
  UtcTimestampSchema,
  UuidSchema,
} from "@capital-q/contracts";

/**
 * Continuation state for the mandate list, ordered by (created_at desc,
 * id desc). Opaque to clients: base64url JSON, validated on the way back
 * in. A cursor is not authorization; every page re-checks the caller's
 * investor organisation context.
 */
const MandateCursorSchema = z
  .object({
    createdAt: UtcTimestampSchema,
    id: UuidSchema,
  })
  .strict();

export type MandateCursor = z.infer<typeof MandateCursorSchema>;

export function encodeMandateCursor(cursor: MandateCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeMandateCursor(raw: string): MandateCursor {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    decoded = undefined;
  }
  return parseContract(
    MandateCursorSchema,
    decoded,
    "The cursor is not one this server issued.",
  );
}
