import { z } from "zod";

/**
 * What this browser remembers about an unfinished resumable upload, per
 * pitch (CQ-MEDIA-011).
 *
 * Just enough to resume after a reload: the idempotency key the
 * reservation was made with, and which file it was for. Not the upload
 * address: the server hands the same address back when the same key and
 * length are asked for again, under the founder's own session, so nothing
 * that could send bytes anywhere sits at rest in the browser. A key alone
 * grants nothing; it only lets an authorised request be recognised.
 *
 * Browser storage can be absent, full or blocked; every access is guarded
 * and a failure simply means "nothing to resume", which the screen already
 * handles honestly.
 */

const PREFIX = "cq.pitch-upload.";

const ResumeRecordSchema = z
  .object({
    v: z.literal(1),
    mediaAssetId: z.string().uuid(),
    idempotencyKey: z.string().min(8).max(255),
    name: z.string().max(1_024),
    sizeBytes: z.number().int().min(1),
    lastModified: z.number(),
    mimeType: z.string().max(255),
  })
  .strict();
export type ResumeRecord = z.infer<typeof ResumeRecordSchema>;

/** The parts of a File that say "the same file", without reading it. */
export type FileIdentity = {
  readonly name: string;
  readonly size: number;
  readonly lastModified: number;
  readonly type: string;
};

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadResume(mediaAssetId: string): ResumeRecord | null {
  try {
    const raw = storage()?.getItem(`${PREFIX}${mediaAssetId}`) ?? null;
    if (raw === null) return null;
    const parsed = ResumeRecordSchema.safeParse(JSON.parse(raw) as unknown);
    return parsed.success && parsed.data.mediaAssetId === mediaAssetId
      ? parsed.data
      : null;
  } catch {
    return null;
  }
}

export function saveResume(
  mediaAssetId: string,
  idempotencyKey: string,
  file: FileIdentity,
): void {
  const record: ResumeRecord = {
    v: 1,
    mediaAssetId,
    idempotencyKey,
    name: file.name,
    sizeBytes: file.size,
    lastModified: file.lastModified,
    mimeType: file.type,
  };
  try {
    storage()?.setItem(`${PREFIX}${mediaAssetId}`, JSON.stringify(record));
  } catch {
    // Full or blocked: resuming after a reload will not be offered.
  }
}

export function clearResume(mediaAssetId: string): void {
  try {
    storage()?.removeItem(`${PREFIX}${mediaAssetId}`);
  } catch {
    // Nothing to do.
  }
}

/** Whether `file` is the one the record was made for. */
export function isSameFile(record: ResumeRecord, file: FileIdentity): boolean {
  return (
    record.name === file.name &&
    record.sizeBytes === file.size &&
    record.lastModified === file.lastModified
  );
}
