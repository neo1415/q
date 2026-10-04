"use server";

import { z } from "zod";

import { resolveOwnContext } from "@/features/q/context";

import {
  ownRelationships,
  relationshipDigests,
  type RelationshipDigest,
} from "./relationship-data";
import { listOrder, pageAfter } from "./relationships-view";

/**
 * The next page of the Relationships list (cursor pagination, 2026-10-04).
 * The cursor is input, never proof: the page is cut from the person's own
 * list as the API returns it under their session, so a cursor can only
 * page through what they could already see.
 */
const Cursor = z
  .string()
  .max(120)
  .regex(/^[0-9T:.+Z-]{20,40}~[0-9a-f-]{36}$/i);

export async function moreRelationshipDigestsAction(cursor: string): Promise<
  | {
      readonly ok: true;
      readonly digests: Readonly<Record<string, RelationshipDigest>>;
      readonly ids: readonly string[];
      readonly next: string | null;
    }
  | { readonly ok: false }
> {
  const parsed = Cursor.safeParse(cursor);
  if (!parsed.success) return { ok: false };
  const context = await resolveOwnContext();
  const items = await ownRelationships(context);
  if (items === undefined) return { ok: false };
  const page = pageAfter(items.toSorted(listOrder), parsed.data);
  const digests = await relationshipDigests(context, page.items);
  return {
    ok: true,
    digests,
    ids: page.items.map((item) => item.relationshipId),
    next: page.next,
  };
}
