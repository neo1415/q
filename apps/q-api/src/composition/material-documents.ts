import type { DataRoomView } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { MaterialDocument } from "@capital-q/q-tools";
import type { ActorContext } from "@capital-q/security";

/**
 * R0: a company's data-room documents for Q to find by meaning, and one
 * document's extracted text to read (Zino live 2026-10-06: the seeded
 * certificate of incorporation could be neither opened nor read).
 *
 * Authorisation is the data room's own view, read AS the person, first:
 * only the ids it returned are looked up here, the opening words and the
 * text only for a document they may open now (OPEN, or the company's own
 * team). The lookup below is the service's privileged read, named and kept
 * to those ids and that company; nothing else reaches it.
 */

/** How much of the opening a match may see. */
const OPENING_CHARS = 400;
/** How much text one read hands on. */
const TEXT_CHARS = 16_000;

type Row = {
  readonly id: string;
  readonly document_type: string | null;
  readonly text: string | null;
};

export function createMaterialDocumentReads(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly view: (
    actor: ActorContext,
    companyId: string,
  ) => Promise<DataRoomView | null>;
}) {
  const { sql, view } = dependencies;

  const lookup = async (
    companyId: string,
    ids: readonly string[],
    chunks: number,
  ): Promise<Map<string, Row>> => {
    if (ids.length === 0) return new Map();
    const rows = await sql<Row[]>`
      select d.id::text as id,
             d.document_type,
             (select string_agg(x.content, ' ' order by x.chunk_index)
                from (select k.content, k.chunk_index
                        from q_knowledge.chunk_sets s
                        join q_knowledge.chunks k on k.chunk_set_id = s.id
                       where s.document_id = d.id
                         and s.document_version_id = d.current_version_id
                         and s.status = 'ACTIVE'
                         and k.status = 'ACTIVE'
                         and k.invalidated_at is null
                       order by k.chunk_index
                       limit ${chunks}) x) as text
        from evidence.documents d
       where d.company_id = ${companyId}
         and d.id = any(${ids as string[]}::uuid[])`;
    return new Map(rows.map((row) => [row.id.toLowerCase(), row]));
  };

  /** The documents the view lists, with access in the tool's words. */
  const listed = (
    room: DataRoomView,
  ): {
    readonly documentId: string;
    readonly title: string;
    readonly folder: string;
    readonly access: MaterialDocument["access"];
    readonly pageCount: number | null;
    readonly updatedAt: string;
  }[] => {
    const folder = new Map(room.folders.map((f) => [f.code, f.label]));
    return room.viewer === "INVESTOR"
      ? room.documents.map((d) => ({
          documentId: d.documentId.toLowerCase(),
          title: d.title,
          folder: folder.get(d.folderCode) ?? d.folderCode,
          access: d.access,
          pageCount: d.pageCount,
          updatedAt: d.updatedAt,
        }))
      : room.documents.map((d) => ({
          documentId: d.documentId.toLowerCase(),
          title: d.title,
          folder: folder.get(d.folderCode) ?? d.folderCode,
          access: "OWNER" as const,
          pageCount: d.pageCount,
          updatedAt: d.updatedAt,
        }));
  };

  return {
    documents: async (
      actor: ActorContext,
      companyId: string,
    ): Promise<readonly MaterialDocument[] | null> => {
      const room = await view(actor, companyId);
      if (room === null) return null;
      const entries = listed(room);
      const openable = entries
        .filter((e) => e.access === "OPEN" || e.access === "OWNER")
        .map((e) => e.documentId);
      const all = await lookup(
        companyId,
        entries.map((e) => e.documentId),
        2,
      );
      return entries.map((entry) => {
        const row = all.get(entry.documentId);
        return {
          ...entry,
          documentType: row?.document_type ?? null,
          // The opening only where they may open it: a title they may
          // know exists says nothing more of what is inside.
          opening:
            openable.includes(entry.documentId) && row?.text != null
              ? row.text.slice(0, OPENING_CHARS)
              : null,
        };
      });
    },
    documentText: async (
      actor: ActorContext,
      companyId: string,
      documentId: string,
    ): Promise<{
      readonly text: string;
      readonly truncated: boolean;
    } | null> => {
      const room = await view(actor, companyId);
      if (room === null) return null;
      const id = documentId.toLowerCase();
      const entry = listed(room).find((e) => e.documentId === id);
      if (
        entry === undefined ||
        (entry.access !== "OPEN" && entry.access !== "OWNER")
      ) {
        return null;
      }
      const row = (await lookup(companyId, [id], 60)).get(id);
      const text = row?.text?.trim() ?? "";
      if (text.length === 0) return null;
      return {
        text: text.slice(0, TEXT_CHARS),
        truncated: text.length > TEXT_CHARS,
      };
    },
    /**
     * Q room W3 (R3): pages of the current version's latest paged
     * extraction, re-authorised exactly as documentText. pageCount 0 means
     * no page text (a scan, or not paged); never a guess.
     */
    documentPages: async (
      actor: ActorContext,
      companyId: string,
      documentId: string,
      range: { readonly from: number; readonly to: number },
    ): Promise<{
      readonly pageCount: number;
      readonly pages: readonly {
        readonly page: number;
        readonly text: string;
      }[];
    } | null> => {
      const room = await view(actor, companyId);
      if (room === null) return null;
      const id = documentId.toLowerCase();
      const entry = listed(room).find((e) => e.documentId === id);
      if (
        entry === undefined ||
        (entry.access !== "OPEN" && entry.access !== "OWNER")
      ) {
        return null;
      }
      const rows = await sql<
        { page_number: number; text: string | null; page_count: number }[]
      >`
        with latest as (
          select p.extraction_id
            from evidence.documents d
            join evidence.document_pages p
              on p.document_id = d.id
             and p.document_version_id = d.current_version_id
            join evidence.document_extractions x on x.id = p.extraction_id
           where d.company_id = ${companyId} and d.id = ${id}
           order by x.created_at desc, x.id desc
           limit 1)
        select p.page_number,
               case when p.page_number between ${range.from} and ${range.to}
                    then p.text end as text,
               (count(*) over ())::int as page_count
          from evidence.document_pages p
          join latest l on l.extraction_id = p.extraction_id
         order by p.page_number`;
      return {
        pageCount: rows[0]?.page_count ?? 0,
        pages: rows
          .filter((row) => row.text !== null)
          .map((row) => ({ page: row.page_number, text: row.text ?? "" })),
      };
    },
  };
}
