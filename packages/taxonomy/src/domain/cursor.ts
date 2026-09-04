import { z } from "zod";

import { parseContract, UuidSchema } from "@capital-q/contracts";

/**
 * Continuation state for node listings, ordered by (display_name, id) so
 * siblings read alphabetically. Opaque to clients: base64url JSON, validated
 * on the way back in. A cursor is not authorization.
 */
const TaxonomyNodeCursorSchema = z
  .object({
    displayName: z.string().max(200),
    id: UuidSchema,
  })
  .strict();

export type TaxonomyNodeCursor = z.infer<typeof TaxonomyNodeCursorSchema>;

export function encodeTaxonomyNodeCursor(cursor: TaxonomyNodeCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeTaxonomyNodeCursor(raw: string): TaxonomyNodeCursor {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    decoded = undefined;
  }
  return parseContract(
    TaxonomyNodeCursorSchema,
    decoded,
    "The cursor is not one this server issued.",
  );
}
