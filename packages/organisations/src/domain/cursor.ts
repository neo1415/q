import { z } from "zod";

import {
  parseContract,
  UtcTimestampSchema,
  UuidSchema,
} from "@capital-q/contracts";

/**
 * Continuation state for the "my organisations" list, ordered by
 * (joined_at, membership id). Opaque to clients: base64url JSON, validated
 * on the way back in. A cursor is not authorization; every page re-derives
 * the caller's memberships from the session.
 */
const MembershipCursorSchema = z
  .object({
    joinedAt: UtcTimestampSchema,
    id: UuidSchema,
  })
  .strict();

export type MembershipCursor = z.infer<typeof MembershipCursorSchema>;

export function encodeMembershipCursor(cursor: MembershipCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeMembershipCursor(raw: string): MembershipCursor {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    decoded = undefined;
  }
  return parseContract(
    MembershipCursorSchema,
    decoded,
    "The cursor is not one this server issued.",
  );
}
