import type { DatabaseExecutor } from "@capital-q/database";
import type { SharedDocumentPort } from "@capital-q/gateq-intake";

/**
 * F4: the documents a founder sent with a GateQ application, for the
 * receiving firm's download pack. API only: Q never downloads a pack.
 */
const MAX_PACK_FILE_BYTES = 25 * 1024 * 1024;

/**
 * The documents a founder sent with an application, read by Capital Q for
 * the receiving firm. Only ever asked for ids the frozen submission names.
 * A pitch deck keeps the founder's own download choice: view-only stays out
 * of the pack, with a note. Only a scanned-clean version is ever handed out.
 */
export function sharedDocumentsPort(options: {
  readonly sql: DatabaseExecutor;
  readonly authorizeVersion?:
    | ((share: {
        readonly documentTenantId: string;
        readonly documentId: string;
        readonly documentVersionId: string;
      }) => Promise<{ readonly url: string } | null>)
    | undefined;
  readonly fetchBytes?:
    ((url: string) => Promise<Uint8Array | null>) | undefined;
}): SharedDocumentPort {
  const { sql } = options;
  const fetchBytes =
    options.fetchBytes ??
    (async (url: string) => {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) return null;
      const bytes = new Uint8Array(await response.arrayBuffer());
      return bytes.length > MAX_PACK_FILE_BYTES ? null : bytes;
    });
  return {
    titles: async (documentIds) => {
      if (documentIds.length === 0) return new Map();
      const rows = await sql<{ id: string; title: string }[]>`
        select id, title from evidence.documents
         where id = any(${documentIds as string[]}::uuid[])`;
      return new Map(rows.map((row) => [row.id, row.title]));
    },
    file: async (documentId) => {
      const rows = await sql<
        {
          tenant_id: string;
          title: string;
          document_type: string;
          download_audience: string;
          status: string;
          version_id: string | null;
          original_filename: string | null;
        }[]
      >`
        select d.tenant_id, d.title, d.document_type, d.download_audience, d.status,
               v.id as version_id, v.original_filename
          from evidence.documents d
          left join evidence.document_versions v on v.id = d.current_version_id
         where d.id = ${documentId}`;
      const row = rows[0];
      if (row === undefined || row.status !== "ACTIVE") return null;
      const base = {
        title: row.title,
        fileName: row.original_filename ?? `${row.title}.pdf`,
      };
      if (
        row.document_type === "PITCH_DECK" &&
        row.download_audience !== "INVESTORS"
      ) {
        return { ...base, bytes: null, why: "the founder keeps it view only" };
      }
      if (row.version_id === null || options.authorizeVersion === undefined) {
        return { ...base, bytes: null, why: "not downloadable here" };
      }
      const link = await options
        .authorizeVersion({
          documentTenantId: row.tenant_id,
          documentId,
          documentVersionId: row.version_id,
        })
        .catch(() => null);
      if (link === null)
        return { ...base, bytes: null, why: "still being checked for safety" };
      const bytes = await fetchBytes(link.url).catch(() => null);
      return bytes === null
        ? { ...base, bytes: null, why: "couldn't be fetched just now" }
        : { ...base, bytes, why: null };
    },
  };
}
