import type { DatabaseExecutor } from "@capital-q/database";
import type { PrivateDocumentStorageProvider } from "@capital-q/evidence";
import type { Logger } from "@capital-q/observability";
import {
  PICTURE_CACHE_CONTROL,
  PROFILE_IMAGE_BUCKET,
} from "@capital-q/public-identity";
import { z } from "zod";

/**
 * Egress (Supabase restricted the project, 2026-10-24): processed pictures
 * were stored `cache-control: no-store`, so every view fetched them again.
 * New ones are stored cacheable; this rewrites those already stored, with
 * the workers' own storage credentials (no person handles the key).
 *
 * Off unless CQ_PICTURE_CACHE_BACKFILL is set at start:
 * - `dry-run`: logs how many, their current cache-control and the bytes
 *   one download each would cost; writes nothing.
 * - `apply`: re-puts each at its own key with its own bytes and type and
 *   the cacheable value. Idempotent: rewritten pictures no longer match.
 *
 * Only processed pictures: bucket cq-profile-images, img/<tenant>/<row>.webp.
 * Raw uploads and every other bucket are never read or written.
 */
export const PICTURE_CACHE_BACKFILL_ENV = "CQ_PICTURE_CACHE_BACKFILL";

const KEY = /^img\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/u;
/** A processed picture is small; anything larger is left alone. */
const MAX_BYTES = 5 * 1024 * 1024;
/** Pictures per start; a second start continues where this one stopped. */
const PER_START = 2_000;

const Row = z.object({
  name: z.string(),
  size: z.coerce.number().nullable(),
  mimetype: z.string().nullable(),
  cache_control: z.string().nullable(),
});

export type PictureCacheMode = "dry-run" | "apply";

export function pictureCacheModeOf(
  value: string | undefined,
): PictureCacheMode | null {
  return value === "dry-run" || value === "apply" ? value : null;
}

export type PictureCacheReport = {
  readonly mode: PictureCacheMode;
  readonly toRewrite: number;
  readonly downloadBytes: number;
  readonly currentCacheControl: Readonly<Record<string, number>>;
  readonly rewritten: number;
  readonly failed: number;
};

export async function backfillPictureCache(input: {
  readonly sql: DatabaseExecutor;
  readonly storage: Pick<
    PrivateDocumentStorageProvider,
    "openObjectStream" | "putObject"
  >;
  readonly mode: PictureCacheMode;
  readonly logger?: Logger | undefined;
}): Promise<PictureCacheReport> {
  const { sql, storage, mode, logger } = input;
  const raw = await sql`
    select name,
           (metadata->>'size')::bigint as size,
           metadata->>'mimetype' as mimetype,
           metadata->>'cacheControl' as cache_control
      from storage.objects
     where bucket_id = ${PROFILE_IMAGE_BUCKET}
       and name like 'img/%'
       and coalesce(metadata->>'cacheControl', '') <> ${PICTURE_CACHE_CONTROL}
     order by created_at
     limit ${PER_START}`;
  const rows = z
    .array(Row)
    .parse(raw)
    .filter((row) => KEY.test(row.name));
  const currentCacheControl: Record<string, number> = {};
  let downloadBytes = 0;
  for (const row of rows) {
    const control = row.cache_control ?? "(none)";
    currentCacheControl[control] = (currentCacheControl[control] ?? 0) + 1;
    downloadBytes += row.size ?? 0;
  }
  let rewritten = 0;
  let failed = 0;
  if (mode === "apply") {
    for (const row of rows) {
      const object = { bucket: PROFILE_IMAGE_BUCKET, key: row.name };
      try {
        const stream = await storage.openObjectStream(object);
        const parts: Uint8Array[] = [];
        let total = 0;
        for await (const part of stream.body) {
          total += part.byteLength;
          if (total > MAX_BYTES) throw new Error("larger than a picture");
          parts.push(part);
        }
        const body = new Uint8Array(total);
        let at = 0;
        for (const part of parts) {
          body.set(part, at);
          at += part.byteLength;
        }
        await storage.putObject({
          object,
          body,
          contentType: row.mimetype ?? "image/webp",
          cacheControl: PICTURE_CACHE_CONTROL,
        });
        rewritten += 1;
      } catch (error: unknown) {
        failed += 1;
        // The key names a tenant and an upload id, never a person.
        logger?.warn(
          { err: error, key: row.name },
          "picture cache backfill could not rewrite a picture",
        );
      }
    }
  }
  return {
    mode,
    toRewrite: rows.length,
    downloadBytes,
    currentCacheControl,
    rewritten,
    failed,
  };
}
