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
  readonly sensitivity_class: string | null;
  readonly text: string | null;
};

/**
 * Stress 2026-10-28 (F03, S02-F): a HIGHLY_CONFIDENTIAL (or RESTRICTED)
 * document -- management accounts, a financial model -- is outside every
 * firewall plan and no model provider may receive it. The data room's own
 * view lists it for its team (and for anyone it is shared with), so these
 * reads withheld nothing: its text could reach a model through Q. It is
 * now named as held back and never read, whoever asks -- except (ADR 0078,
 * owner decision 99) by the investor the founder shared it with, through
 * an active grant to their own organisation, for that investor's turns,
 * and (ADR 0079, owner decision 100) by a current member of the company
 * that owns it, for that member's own Q.
 */
export function heldBackClass(sensitivityClass: string | null): boolean {
  return (
    sensitivityClass === "HIGHLY_CONFIDENTIAL" ||
    sensitivityClass === "RESTRICTED"
  );
}

/**
 * ADR 0078 (owner decision 99, "shared means readable") and ADR 0079
 * (decision 100, the owner's own Q): only a HIGHLY_CONFIDENTIAL document is
 * ever unlocked; RESTRICTED (identity artefacts) never enters Q.
 */
function shareMayUnlock(sensitivityClass: string | null): boolean {
  return sensitivityClass === "HIGHLY_CONFIDENTIAL";
}

/** The grant a shared, held-back document is read under (provenance). */
export type SharedUnder = {
  readonly grantId: string;
  readonly expiresAt: string | null;
};

/**
 * ADR 0079 (owner decision 100): the membership a member of the owning
 * company read its highly confidential document under (provenance).
 */
export type OwnCompanyRead = {
  readonly companyId: string;
  readonly membershipId: string;
};

/**
 * ADR 0079 (owner decision 100): whether this person is, now, an active
 * member of the organisation that owns this company, in their tenant --
 * resolved from the server-built access context (its organisation and
 * membership), never from an id the client or a model supplied. An ended
 * membership, another company, or a context without a membership is null.
 */
export function createOwnCompanyMembership(sql: DatabaseExecutor) {
  return async (
    actor: ActorContext,
    companyId: string,
  ): Promise<OwnCompanyRead | null> => {
    if (
      actor.organisationId === undefined ||
      actor.membershipId === undefined
    ) {
      return null;
    }
    const rows = await sql<{ company_id: string; membership_id: string }[]>`
      select c.id::text as company_id, m.id::text as membership_id
        from core.companies c
        join identity.organisation_memberships m
          on m.organisation_id = c.organisation_id
         and m.tenant_id = c.tenant_id
       where c.id = ${companyId}::uuid
         and c.tenant_id = ${actor.tenantId}
         and c.organisation_id = ${actor.organisationId}
         and m.id = ${actor.membershipId}::uuid
         and m.user_id = ${actor.userId}
         and m.membership_status = 'active'
       limit 1`;
    const row = rows[0];
    return row === undefined
      ? null
      : {
          companyId: row.company_id.toLowerCase(),
          membershipId: row.membership_id.toLowerCase(),
        };
  };
}

export function createMaterialDocumentReads(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly view: (
    actor: ActorContext,
    companyId: string,
  ) => Promise<DataRoomView | null>;
  /**
   * ADR 0078: the data room's own active grant of one document to the
   * actor's investor organisation (permissions' qReadableShare: the same
   * relationship, grant and access-service checks that let them open it),
   * or null. Absent: nothing held back is ever read (the diligence
   * workforce composes this without it).
   */
  readonly sharedGrant?:
    | ((
        actor: ActorContext,
        companyId: string,
        documentId: string,
      ) => Promise<SharedUnder | null>)
    | undefined;
  /**
   * ADR 0079 (owner decision 100): the actor's current membership of the
   * company's owning organisation (createOwnCompanyMembership), or null.
   * Absent: the owner's highly confidential documents stay held back.
   */
  readonly ownMember?:
    | ((
        actor: ActorContext,
        companyId: string,
      ) => Promise<OwnCompanyRead | null>)
    | undefined;
}) {
  const { sql, view } = dependencies;

  /**
   * Whether a held-back document is readable to this person after all:
   * only an investor's OPEN entry, only HIGHLY_CONFIDENTIAL, only under an
   * active grant to their own organisation, asked afresh on every read
   * (never cached), so a revoked or expired grant closes it at once. A
   * failed lookup is no share.
   */
  const shareOf = async (
    actor: ActorContext,
    companyId: string,
    entry: { readonly documentId: string; readonly access: string },
    sensitivityClass: string | null,
  ): Promise<SharedUnder | null> => {
    const lookup = dependencies.sharedGrant;
    if (
      lookup === undefined ||
      entry.access !== "OPEN" ||
      !shareMayUnlock(sensitivityClass)
    ) {
      return null;
    }
    return lookup(actor, companyId, entry.documentId).catch(() => null);
  };

  /**
   * ADR 0079 (owner decision 100): a highly confidential document read by
   * its own company's member: only the data room's OWNER entry (its own
   * team, decided by the room's owner check), only HIGHLY_CONFIDENTIAL
   * (RESTRICTED never), only with a membership active now, asked afresh on
   * every read. A failed lookup is no read.
   */
  const ownReadOf = async (
    actor: ActorContext,
    companyId: string,
    entry: { readonly access: string },
    sensitivityClass: string | null,
  ): Promise<OwnCompanyRead | null> => {
    const member = dependencies.ownMember;
    if (
      member === undefined ||
      entry.access !== "OWNER" ||
      !shareMayUnlock(sensitivityClass)
    ) {
      return null;
    }
    const read = await member(actor, companyId).catch(() => null);
    return read !== null && read.companyId === companyId.toLowerCase()
      ? read
      : null;
  };

  /** The one unlock that applies to this entry, if any. */
  const unlockOf = async (
    actor: ActorContext,
    companyId: string,
    entry: { readonly documentId: string; readonly access: string },
    sensitivityClass: string | null,
  ): Promise<{
    readonly sharedUnder?: SharedUnder;
    readonly ownCompanyRead?: OwnCompanyRead;
  } | null> => {
    if (entry.access === "OWNER") {
      const own = await ownReadOf(actor, companyId, entry, sensitivityClass);
      return own === null ? null : { ownCompanyRead: own };
    }
    const shared = await shareOf(actor, companyId, entry, sensitivityClass);
    return shared === null ? null : { sharedUnder: shared };
  };

  const lookup = async (
    companyId: string,
    ids: readonly string[],
    chunks: number,
  ): Promise<Map<string, Row>> => {
    if (ids.length === 0) return new Map();
    const rows = await sql<Row[]>`
      select d.id::text as id,
             d.document_type,
             d.sensitivity_class::text as sensitivity_class,
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
      return Promise.all(
        entries.map(async (entry) => {
          const row = all.get(entry.documentId);
          const classified = heldBackClass(row?.sensitivity_class ?? null);
          const unlocked = classified
            ? await unlockOf(
                actor,
                companyId,
                entry,
                row?.sensitivity_class ?? null,
              )
            : null;
          const heldBack = classified && unlocked === null;
          return {
            ...entry,
            documentType: row?.document_type ?? null,
            // The opening only where they may open it: a title they may
            // know exists says nothing more of what is inside. Never for a
            // document held back from Q.
            opening:
              !heldBack &&
              openable.includes(entry.documentId) &&
              row?.text != null
                ? row.text.slice(0, OPENING_CHARS)
                : null,
            ...(heldBack ? { heldBack: true } : {}),
            ...(unlocked ?? {}),
          };
        }),
      );
    },
    documentText: async (
      actor: ActorContext,
      companyId: string,
      documentId: string,
    ): Promise<{
      readonly text: string;
      readonly truncated: boolean;
      readonly sharedUnder?: SharedUnder;
      readonly ownCompanyRead?: OwnCompanyRead;
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
      let unlocked: Awaited<ReturnType<typeof unlockOf>> = null;
      if (heldBackClass(row?.sensitivity_class ?? null)) {
        // Checked again here, at the read itself, before any text leaves.
        unlocked = await unlockOf(
          actor,
          companyId,
          entry,
          row?.sensitivity_class ?? null,
        );
        if (unlocked === null) return null;
      }
      const text = row?.text?.trim() ?? "";
      if (text.length === 0) return null;
      return {
        text: text.slice(0, TEXT_CHARS),
        truncated: text.length > TEXT_CHARS,
        ...(unlocked ?? {}),
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
      readonly sharedUnder?: SharedUnder;
      readonly ownCompanyRead?: OwnCompanyRead;
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
      const held = await sql<{ sensitivity_class: string | null }[]>`
        select d.sensitivity_class::text as sensitivity_class
          from evidence.documents d
         where d.company_id = ${companyId} and d.id = ${id}`;
      const sensitivityClass = held[0]?.sensitivity_class ?? null;
      let unlocked: Awaited<ReturnType<typeof unlockOf>> = null;
      if (heldBackClass(sensitivityClass)) {
        unlocked = await unlockOf(actor, companyId, entry, sensitivityClass);
        if (unlocked === null) return null;
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
            -- Decision 104: a version the virus check blocked is never read.
            join evidence.document_versions v
              on v.id = d.current_version_id
             and v.malware_scan_status <> 'BLOCKED'
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
        ...(unlocked ?? {}),
      };
    },
  };
}
