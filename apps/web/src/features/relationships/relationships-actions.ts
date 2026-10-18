"use server";

import { z } from "zod";

import { resolveOwnContext } from "@/features/q/context";

import {
  ownRelationships,
  relationshipDigests,
  type RelationshipDigest,
} from "./relationship-data";
import { PAGE_SIZE } from "./relationships-view";

/**
 * The details of the Relationships list's next rows. The list is ordered
 * on the page (by Suitability or by time, owner 2026-10-17), so the next
 * rows are named by id. The ids are input, never proof: only rows of the
 * person's own list, as the API returns it under their session, are read.
 */
const Ids = z.array(z.string().uuid()).min(1).max(PAGE_SIZE);

export async function moreRelationshipDigestsAction(
  ids: readonly string[],
): Promise<
  | {
      readonly ok: true;
      readonly digests: Readonly<Record<string, RelationshipDigest>>;
      readonly ids: readonly string[];
    }
  | { readonly ok: false }
> {
  const parsed = Ids.safeParse(ids);
  if (!parsed.success) return { ok: false };
  const context = await resolveOwnContext();
  const items = await ownRelationships(context);
  if (items === undefined) return { ok: false };
  const wanted = new Set(parsed.data);
  const page = items.filter((item) => wanted.has(item.relationshipId));
  const digests = await relationshipDigests(context, page);
  return {
    ok: true,
    digests,
    ids: page.map((item) => item.relationshipId),
  };
}
