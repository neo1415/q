// A person's own profile photo for the demonstration seed (owner 2026-10-22):
// David Nwankwo's owner-supplied headshot
// (supabase/seed-assets/capital-q-team/david-founder.jpg, with permission).
// It takes the product's own path: the bytes are re-encoded by the same
// processor uploads use (metadata stripped, fixed size, WebP), stored in the
// private bucket, and recorded as that person's READY avatar -- owned by
// the person, as core.profile_images requires. A previous photo is
// SUPERSEDED, never deleted. No photo is ever fetched from the web.
import { createHash } from "node:crypto";

import { lit, seedUuid } from "./plan.mjs";

export const PROFILE_IMAGE_BUCKET = "cq-profile-images";

/** What to write for one person's photo, given the processed rendition. */
export function planPersonPhoto({
  seedKey,
  userId,
  tenantId,
  source,
  rendition,
  currentReadyId,
}) {
  const hash = createHash("sha256").update(source.bytes).digest("hex");
  const id = seedUuid(seedKey, "person-photo", userId, hash);
  if (currentReadyId === id) return null; // already this photo
  const objectKey = `img/${tenantId}/${id}.webp`;
  const sql = [
    "begin;",
    ...(currentReadyId === null
      ? []
      : [
          `update core.profile_images set status = 'SUPERSEDED', ended_at = now() where id = ${lit(currentReadyId)} and status = 'READY';`,
        ]),
    `insert into core.profile_images (id, tenant_id, organisation_id, subject_type, subject_id, kind, status, upload_key, declared_content_type, declared_byte_size, object_key, width, height, byte_size, created_by_user_id, upload_expires_at, ready_at) values (${lit(id)}, ${lit(tenantId)}, null, 'PERSON', ${lit(userId)}, 'AVATAR', 'READY', ${lit(`seed/${tenantId}/${id}`)}, ${lit(source.contentType)}, ${source.bytes.byteLength}, ${lit(objectKey)}, ${rendition.width}, ${rendition.height}, ${rendition.bytes.byteLength}, ${lit(userId)}, now(), now()) on conflict (id) do nothing;`,
    "commit;",
  ].join("\n");
  return { id, objectKey, sql };
}

/**
 * Supabase Storage for the hosted run: the service credentials stay in
 * process memory and are never printed. The owner supplies them at deploy
 * time (SUPABASE_URL, SUPABASE_SECRET_KEY).
 */
export function supabaseStorage() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SECRET_KEY are required to upload a photo",
    );
  }
  return {
    putObject: async ({ key: objectKey, body, contentType }) => {
      const r = await fetch(
        `${url}/storage/v1/object/${PROFILE_IMAGE_BUCKET}/${objectKey}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${key}`,
            apikey: key,
            "content-type": contentType,
            "x-upsert": "true",
          },
          body,
        },
      );
      if (!r.ok) throw new Error(`storage: HTTP ${r.status}`);
    },
  };
}
