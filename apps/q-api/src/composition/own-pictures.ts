import type { DatabaseExecutor } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

/**
 * Q room W5 (R8): the person's own picture, dropped on a placeholder.
 *
 * The file arrived through the ordinary upload path, into their data room
 * with its visibility; this is the named, privileged read of that one
 * document's bytes, kept to: the actor's own organisation's document, its
 * current version, a PNG or JPEG of at most 5 MB, that has been through
 * the malware step (CLEAN, or NOT_SCANNED under ADR 0042's interim
 * policy). PENDING is "not ready yet"; anything else is "not a picture
 * you can place". The bytes are checked again by their first bytes.
 */

const MAX_BYTES = 5 * 1024 * 1024;

type Row = {
  readonly storage_bucket: string;
  readonly storage_key: string;
  readonly mime_type: string;
  readonly size_bytes: string | number;
  readonly malware_scan_status: string;
  readonly title: string;
};

function pictureKind(bytes: Uint8Array): "image/png" | "image/jpeg" | null {
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  return null;
}

export function createOwnPictureReader(dependencies: {
  readonly sql: DatabaseExecutor;
  /** Server-side read from private storage (secret key), or undefined. */
  readonly storage:
    | {
        readonly get: (
          bucket: string,
          key: string,
        ) => Promise<Uint8Array | null>;
      }
    | undefined;
}) {
  return async (
    actor: ActorContext,
    documentId: string,
  ): Promise<
    | {
        readonly bytes: Uint8Array;
        readonly contentType: "image/png" | "image/jpeg";
        readonly title: string;
      }
    | "NOT_READY"
    | null
  > => {
    if (actor.organisationId === undefined) return null;
    const storage = dependencies.storage;
    if (storage === undefined) return null;
    const rows = await dependencies.sql<Row[]>`
      select v.storage_bucket, v.storage_key, v.mime_type, v.size_bytes,
             v.malware_scan_status, d.title
        from evidence.documents d
        join evidence.document_versions v on v.id = d.current_version_id
       where d.id = ${documentId}
         and d.tenant_id = ${actor.tenantId}
         and d.owner_organisation_id = ${actor.organisationId}
         and d.status = 'ACTIVE'
       limit 1`;
    const row = rows[0];
    if (row === undefined) return null;
    if (row.mime_type !== "image/png" && row.mime_type !== "image/jpeg") {
      return null;
    }
    if (Number(row.size_bytes) > MAX_BYTES) return null;
    if (row.malware_scan_status === "PENDING") return "NOT_READY";
    if (
      row.malware_scan_status !== "CLEAN" &&
      row.malware_scan_status !== "NOT_SCANNED"
    ) {
      return null;
    }
    const bytes = await storage.get(row.storage_bucket, row.storage_key);
    if (bytes === null || bytes.byteLength > MAX_BYTES) return null;
    const contentType = pictureKind(bytes);
    if (contentType === null) return null;
    return { bytes, contentType, title: row.title.slice(0, 200) };
  };
}

/** Supabase Storage, read with the server's secret key, never a browser's. */
export function createSupabaseObjectReader(options: {
  readonly supabaseUrl: string;
  readonly secretKey: string;
  readonly fetch?: typeof fetch | undefined;
}) {
  const base = `${options.supabaseUrl.replace(/\/+$/, "")}/storage/v1`;
  const call = options.fetch ?? fetch;
  return {
    get: async (bucket: string, key: string): Promise<Uint8Array | null> => {
      try {
        const response = await call(
          `${base}/object/${encodeURIComponent(bucket)}/${key
            .split("/")
            .map(encodeURIComponent)
            .join("/")}`,
          {
            headers: {
              authorization: `Bearer ${options.secretKey}`,
              apikey: options.secretKey,
            },
            signal: AbortSignal.timeout(20_000),
          },
        );
        if (!response.ok) return null;
        return new Uint8Array(await response.arrayBuffer());
      } catch {
        return null;
      }
    },
  };
}
