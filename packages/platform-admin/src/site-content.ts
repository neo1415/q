import {
  parseSiteBlocks,
  publicSiteBlocks,
  resolveSitePlaceholders,
  siteImageDocumentIds,
  siteLawyerNoteCount,
  SiteSettingsSchema,
  type AdminSitePageDetailDto,
  type AdminSitePageListDto,
  type AdminSitePageSummaryDto,
  type AdminSiteSettingsDto,
  type AdminSiteVersionDto,
  type ImportedSitePage,
  type PublicSiteLandingDto,
  type PublicSitePageDto,
  type SiteBlock,
  type SitePageKind,
  type SitePageStatus,
  type SiteSettings,
} from "@capital-q/contracts";
import {
  jsonbParam,
  type DatabaseExecutor,
  type TransactionManager,
} from "@capital-q/database";

import { recordAdminAction, type AdminGrant } from "./access.js";
import type { AdminPermission } from "./permissions.js";

/**
 * The site content editor's store (decision 107). Pages, immutable
 * versions, one autosaved draft per page, the published pointer, and an
 * append-only history of publishes, all in the server-only `site_content`
 * schema.
 *
 * Two doors:
 * - the public reads (`publicPage`, `publicLanding`, `publicImage`) answer
 *   only from a version a published pointer names, with lawyer notes
 *   removed and placeholders resolved -- never a draft;
 * - every console operation takes an `AdminGrant` (only `authorize` makes
 *   one) and checks it carries the permission the operation needs, so a
 *   read grant can never write even if a route is mis-wired. Writes are
 *   recorded in `platform_ops.admin_actions` in the same transaction.
 */

export type SiteImageAsset = {
  readonly documentId: string;
  readonly tenantId: string;
  readonly versionId: string;
};

/**
 * Resolves the documents a draft's image blocks name into the exact scanned
 * versions the admin may use, or null when any is not one (not theirs, not
 * an image, not scanned clean). Composed by the API over Evidence.
 */
export type SiteImageResolver = (
  documentIds: readonly string[],
) => Promise<readonly SiteImageAsset[] | null>;

export class SiteContentGrantError extends Error {
  constructor() {
    super("site content: the grant does not carry this permission");
  }
}

function need(grant: AdminGrant, permission: AdminPermission): void {
  // A write grant also reads: content.write is held only by roles that hold
  // content.read (permissions.ts).
  const ok =
    grant.permission === permission ||
    (permission === "content.read" && grant.permission === "content.write");
  if (!ok) throw new SiteContentGrantError();
}

const iso = (value: Date | string) => new Date(value).toISOString();
const dateOnly = (value: Date | string | null) =>
  value === null
    ? null
    : typeof value === "string"
      ? value.slice(0, 10)
      : value.toISOString().slice(0, 10);

type PageRow = {
  id: string;
  slug: string;
  kind: SitePageKind;
  title: string;
  summary: string;
  status: SitePageStatus;
  sort_order: number | null;
  anchor: string | null;
  effective_date: Date | string | null;
  updated_at: Date;
};

type SettingsRow = {
  company_name: string;
  legal_entity: string | null;
  registered_address: string | null;
  contact_email: string | null;
  governing_law_city: string | null;
  revision: number;
  updated_at: Date;
};

const toSettings = (row: SettingsRow): SiteSettings =>
  SiteSettingsSchema.parse({
    companyName: row.company_name,
    legalEntity: row.legal_entity,
    registeredAddress: row.registered_address,
    contactEmail: row.contact_email,
    governingLawCity: row.governing_law_city,
  });

async function settingsRow(sql: DatabaseExecutor): Promise<SettingsRow> {
  const [row] = await sql<SettingsRow[]>`
    select company_name, legal_entity, registered_address, contact_email,
           governing_law_city, revision, updated_at
      from site_content.settings where singleton`;
  if (row === undefined) throw new Error("site content: settings row missing");
  return row;
}

/** Blocks read back from jsonb are checked again: the store never trusts a row. */
const blocksOf = (value: unknown): SiteBlock[] => parseSiteBlocks(value);

export type SiteDraftInput = {
  readonly title: string;
  readonly summary: string;
  readonly blocks: readonly SiteBlock[];
  readonly expectedRevision: number;
};

export type SitePublishOutcome =
  | {
      readonly kind: "PUBLISHED";
      readonly versionNumber: number;
      readonly publishedAt: string;
    }
  | { readonly kind: "NOT_FOUND" }
  | { readonly kind: "STALE" }
  | { readonly kind: "NEEDS_LEGAL_CONFIRMATION" }
  | { readonly kind: "IMAGE_NOT_ALLOWED" };

export type SiteContentStore = ReturnType<typeof createSiteContentStore>;

export function createSiteContentStore(options: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
}) {
  const { sql, transactions } = options;

  async function summaries(
    executor: DatabaseExecutor,
    slug: string | null,
  ): Promise<AdminSitePageSummaryDto[]> {
    const rows = await executor<
      (PageRow & {
        published_version: number | null;
        latest_version: number | null;
        unpublished_changes: boolean;
        draft_blocks: unknown;
      })[]
    >`
      select p.id, p.slug, p.kind, p.title, p.summary, p.status, p.sort_order,
             p.anchor, p.effective_date,
             greatest(p.updated_at, d.updated_at) as updated_at,
             pv.version_number as published_version,
             (select max(v.version_number) from site_content.page_versions v
               where v.page_id = p.id) as latest_version,
             (pv.id is null
               or pv.blocks is distinct from d.blocks
               or pv.title is distinct from d.title
               or pv.summary is distinct from d.summary) as unpublished_changes,
             d.blocks as draft_blocks
        from site_content.pages p
        join site_content.page_drafts d on d.page_id = p.id
        left join site_content.published_pointers pp on pp.page_id = p.id
        left join site_content.page_versions pv on pv.id = pp.version_id
       where ${slug === null ? executor`true` : executor`p.slug = ${slug}`}
       order by case p.kind when 'landing-section' then 0 when 'pricing' then 1
                            when 'faq' then 2 else 3 end,
                p.sort_order nulls last, p.title`;
    return rows.map((row) => ({
      slug: row.slug,
      kind: row.kind,
      // The draft's own title is what the editor shows; the page row keeps
      // the published one.
      title: row.title,
      summary: row.summary,
      status: row.status,
      order: row.sort_order,
      publishedVersion: row.published_version,
      latestVersion: row.latest_version,
      unpublishedChanges: row.unpublished_changes,
      lawyerNotes: siteLawyerNoteCount(blocksOf(row.draft_blocks)),
      updatedAt: iso(row.updated_at),
    }));
  }

  async function adminSettings(
    executor: DatabaseExecutor,
  ): Promise<AdminSiteSettingsDto> {
    const row = await settingsRow(executor);
    return {
      settings: toSettings(row),
      revision: row.revision,
      updatedAt: iso(row.updated_at),
    };
  }

  return {
    // --- public -------------------------------------------------------------

    /** The live version of one page, or null when nothing is live. */
    publicPage: async (slug: string): Promise<PublicSitePageDto | null> => {
      const [row] = await sql<
        {
          slug: string;
          kind: SitePageKind;
          title: string;
          summary: string;
          effective_date: Date | string | null;
          version_number: number;
          blocks: unknown;
          published_at: Date;
        }[]
      >`
        select p.slug, p.kind, v.title, v.summary, p.effective_date,
               v.version_number, v.blocks, pp.published_at
          from site_content.pages p
          join site_content.published_pointers pp on pp.page_id = p.id
          join site_content.page_versions v on v.id = pp.version_id
         where p.slug = ${slug} and p.kind <> 'landing-section'`;
      if (row === undefined) return null;
      const settings = toSettings(await settingsRow(sql));
      return {
        slug: row.slug,
        kind: row.kind,
        title: resolveSitePlaceholders(row.title, settings),
        summary: resolveSitePlaceholders(row.summary, settings),
        effectiveDate: dateOnly(row.effective_date),
        versionNumber: row.version_number,
        publishedAt: iso(row.published_at),
        blocks: publicSiteBlocks(blocksOf(row.blocks), settings),
      };
    },

    /** Every live landing section, in order. */
    publicLanding: async (): Promise<PublicSiteLandingDto> => {
      const rows = await sql<
        {
          slug: string;
          sort_order: number | null;
          anchor: string | null;
          title: string;
          blocks: unknown;
        }[]
      >`
        select p.slug, p.sort_order, p.anchor, v.title, v.blocks
          from site_content.pages p
          join site_content.published_pointers pp on pp.page_id = p.id
          join site_content.page_versions v on v.id = pp.version_id
         where p.kind = 'landing-section'
         order by p.sort_order nulls last, p.slug`;
      const settings = toSettings(await settingsRow(sql));
      return {
        sections: rows.map((row) => ({
          slug: row.slug,
          order: row.sort_order,
          anchor: row.anchor,
          title: resolveSitePlaceholders(row.title, settings),
          blocks: publicSiteBlocks(blocksOf(row.blocks), settings),
        })),
      };
    },

    /**
     * The pinned scanned version of an image that a LIVE version shows, or
     * null. A document that is not on a published page is never served
     * here, whoever uploaded it.
     */
    publicImage: async (documentId: string): Promise<SiteImageAsset | null> => {
      const rows = await sql<{ asset: SiteImageAsset }[]>`
        select a.asset
          from site_content.published_pointers pp
          join site_content.page_versions v on v.id = pp.version_id
          cross join lateral jsonb_array_elements(v.image_assets) as a(asset)
         where a.asset ->> 'documentId' = ${documentId}
         limit 1`;
      const asset = rows[0]?.asset;
      return asset === undefined ? null : asset;
    },

    // --- console ------------------------------------------------------------

    listPages: async (grant: AdminGrant): Promise<AdminSitePageListDto> => {
      need(grant, "content.read");
      return {
        pages: await summaries(sql, null),
        settings: await adminSettings(sql),
      };
    },

    pageDetail: async (
      grant: AdminGrant,
      slug: string,
    ): Promise<AdminSitePageDetailDto | null> => {
      need(grant, "content.read");
      const [page] = await summaries(sql, slug);
      if (page === undefined) return null;
      const [meta] = await sql<
        {
          id: string;
          effective_date: Date | string | null;
          title: string;
          summary: string;
          blocks: unknown;
          revision: number;
          base_version: number | null;
          updated_at: Date;
          updated_by_name: string | null;
        }[]
      >`
        select p.id, p.effective_date, d.title, d.summary, d.blocks, d.revision,
               d.base_version, d.updated_at, u.display_name as updated_by_name
          from site_content.pages p
          join site_content.page_drafts d on d.page_id = p.id
          left join identity.user_profiles u on u.id = d.updated_by
         where p.slug = ${slug}`;
      if (meta === undefined) return null;
      const versions = await sql<
        {
          version_number: number;
          source: "SEED" | "EDITOR" | "RESTORE";
          restored_from_version: number | null;
          author_name: string | null;
          created_at: Date;
          live: boolean;
        }[]
      >`
        select v.version_number, v.source, v.restored_from_version,
               u.display_name as author_name, v.created_at,
               (pp.version_id is not null) as live
          from site_content.page_versions v
          left join identity.user_profiles u on u.id = v.author_user_id
          left join site_content.published_pointers pp on pp.version_id = v.id
         where v.page_id = ${meta.id}
         order by v.version_number desc
         limit 100`;
      const history = await sql<
        {
          action: "PUBLISH" | "UNPUBLISH" | "RESTORE_TO_DRAFT";
          version_number: number | null;
          actor_name: string | null;
          reason: string | null;
          occurred_at: Date;
        }[]
      >`
        select e.action, e.version_number, u.display_name as actor_name,
               e.reason, e.occurred_at
          from site_content.publish_events e
          left join identity.user_profiles u on u.id = e.actor_user_id
         where e.page_id = ${meta.id}
         order by e.occurred_at desc, e.id desc
         limit 50`;
      return {
        page: { ...page, title: meta.title, summary: meta.summary },
        effectiveDate: dateOnly(meta.effective_date),
        draft: {
          title: meta.title,
          summary: meta.summary,
          blocks: blocksOf(meta.blocks),
          revision: meta.revision,
          baseVersion: meta.base_version,
          updatedAt: iso(meta.updated_at),
          updatedByName: meta.updated_by_name,
        },
        versions: versions.map((v) => ({
          versionNumber: v.version_number,
          source: v.source,
          restoredFrom: v.restored_from_version,
          authorName: v.author_name,
          createdAt: iso(v.created_at),
          live: v.live,
        })),
        history: history.map((e) => ({
          action: e.action,
          versionNumber: e.version_number,
          actorName: e.actor_name,
          reason: e.reason,
          at: iso(e.occurred_at),
        })),
        settings: toSettings(await settingsRow(sql)),
      };
    },

    version: async (
      grant: AdminGrant,
      slug: string,
      versionNumber: number,
    ): Promise<AdminSiteVersionDto | null> => {
      need(grant, "content.read");
      const [row] = await sql<
        {
          version_number: number;
          title: string;
          summary: string;
          blocks: unknown;
          created_at: Date;
        }[]
      >`
        select v.version_number, v.title, v.summary, v.blocks, v.created_at
          from site_content.page_versions v
          join site_content.pages p on p.id = v.page_id
         where p.slug = ${slug} and v.version_number = ${versionNumber}`;
      return row === undefined
        ? null
        : {
            versionNumber: row.version_number,
            title: row.title,
            summary: row.summary,
            blocks: blocksOf(row.blocks),
            createdAt: iso(row.created_at),
          };
    },

    /** Autosave. STALE when another tab saved first; nothing is overwritten. */
    saveDraft: async (
      grant: AdminGrant,
      slug: string,
      input: SiteDraftInput,
    ): Promise<
      | {
          readonly kind: "SAVED";
          readonly revision: number;
          readonly updatedAt: string;
        }
      | { readonly kind: "NOT_FOUND" }
      | { readonly kind: "STALE" }
    > => {
      need(grant, "content.write");
      const blocks = parseSiteBlocks(input.blocks);
      return transactions.run(async (tx) => {
        const [row] = await tx.sql<{ revision: number; page_id: string }[]>`
          select d.revision, d.page_id
            from site_content.page_drafts d
            join site_content.pages p on p.id = d.page_id
           where p.slug = ${slug}
           for update of d`;
        if (row === undefined) return { kind: "NOT_FOUND" as const };
        if (row.revision !== input.expectedRevision) {
          return { kind: "STALE" as const };
        }
        const [saved] = await tx.sql<{ revision: number; updated_at: Date }[]>`
          update site_content.page_drafts
             set title = ${input.title}, summary = ${input.summary},
                 blocks = ${jsonbParam(tx.sql, blocks)},
                 revision = revision + 1, updated_by = ${grant.userId},
                 updated_at = clock_timestamp()
           where page_id = ${row.page_id}
          returning revision, updated_at`;
        if (saved === undefined)
          throw new Error("site content: draft vanished");
        // Autosave is frequent: one audit row per save would drown the
        // console's log, so drafts are attributed on the draft row and
        // every publish is audited in full.
        return {
          kind: "SAVED" as const,
          revision: saved.revision,
          updatedAt: iso(saved.updated_at),
        };
      });
    },

    /**
     * The draft becomes a new immutable version (or reuses an identical
     * one) and goes live. A legal page needs `confirmLegalReview`; every
     * image must resolve to a scanned upload the admin may use.
     */
    publish: async (
      grant: AdminGrant,
      slug: string,
      input: {
        readonly expectedRevision: number;
        readonly reason?: string | undefined;
        readonly confirmLegalReview?: true | undefined;
      },
      resolveImages: SiteImageResolver,
    ): Promise<SitePublishOutcome> => {
      need(grant, "content.write");
      // Images resolve before the transaction: it is a read of another
      // context, and no transaction is held across it.
      const [peek] = await sql<{ blocks: unknown; kind: SitePageKind }[]>`
        select d.blocks, p.kind
          from site_content.page_drafts d
          join site_content.pages p on p.id = d.page_id
         where p.slug = ${slug}`;
      if (peek === undefined) return { kind: "NOT_FOUND" };
      if (peek.kind === "legal" && input.confirmLegalReview !== true) {
        return { kind: "NEEDS_LEGAL_CONFIRMATION" };
      }
      const imageIds = siteImageDocumentIds(blocksOf(peek.blocks));
      const assets = imageIds.length === 0 ? [] : await resolveImages(imageIds);
      if (assets === null) return { kind: "IMAGE_NOT_ALLOWED" };

      return transactions.run(async (tx) => {
        const [draft] = await tx.sql<
          {
            page_id: string;
            kind: SitePageKind;
            title: string;
            summary: string;
            blocks: unknown;
            revision: number;
          }[]
        >`
          select d.page_id, p.kind, d.title, d.summary, d.blocks, d.revision
            from site_content.page_drafts d
            join site_content.pages p on p.id = d.page_id
           where p.slug = ${slug}
           for update of d, p`;
        if (draft === undefined) return { kind: "NOT_FOUND" as const };
        // The revision binds the approval to the exact text checked above.
        if (draft.revision !== input.expectedRevision) {
          return { kind: "STALE" as const };
        }
        const blocks = blocksOf(draft.blocks);
        const same = await tx.sql<{ id: string; version_number: number }[]>`
          select id, version_number from site_content.page_versions
           where page_id = ${draft.page_id}
             and title = ${draft.title} and summary = ${draft.summary}
             and blocks = ${jsonbParam(tx.sql, blocks)}
             and image_assets = ${jsonbParam(tx.sql, assets)}
           order by version_number desc limit 1`;
        const [latest] = await tx.sql<{ n: number | null }[]>`
          select max(version_number) as n from site_content.page_versions
           where page_id = ${draft.page_id}`;
        const latestNumber = latest?.n ?? 0;
        let versionId: string;
        let versionNumber: number;
        const match = same[0];
        if (match !== undefined && match.version_number === latestNumber) {
          versionId = match.id;
          versionNumber = match.version_number;
        } else {
          const restored = match?.version_number ?? null;
          const [inserted] = await tx.sql<
            { id: string; version_number: number }[]
          >`
            insert into site_content.page_versions
              (page_id, version_number, title, summary, blocks, image_assets,
               source, restored_from_version, author_user_id)
            values (${draft.page_id}, ${latestNumber + 1}, ${draft.title},
                    ${draft.summary}, ${jsonbParam(tx.sql, blocks)},
                    ${jsonbParam(tx.sql, assets)},
                    ${restored === null ? "EDITOR" : "RESTORE"}, ${restored},
                    ${grant.userId})
            returning id, version_number`;
          if (inserted === undefined)
            throw new Error("site content: no version");
          versionId = inserted.id;
          versionNumber = inserted.version_number;
        }
        const [pointer] = await tx.sql<{ published_at: Date }[]>`
          insert into site_content.published_pointers (page_id, version_id, published_by)
          values (${draft.page_id}, ${versionId}, ${grant.userId})
          on conflict (page_id) do update
             set version_id = excluded.version_id,
                 published_by = excluded.published_by,
                 published_at = clock_timestamp()
          returning published_at`;
        await tx.sql`
          update site_content.pages
             set status = 'PUBLISHED', title = ${draft.title},
                 summary = ${draft.summary}, updated_at = clock_timestamp()
           where id = ${draft.page_id}`;
        await tx.sql`
          update site_content.page_drafts set base_version = ${versionNumber}
           where page_id = ${draft.page_id}`;
        await tx.sql`
          insert into site_content.publish_events
            (page_id, version_id, version_number, action, actor_user_id, reason)
          values (${draft.page_id}, ${versionId}, ${versionNumber}, 'PUBLISH',
                  ${grant.userId}, ${input.reason ?? null})`;
        await recordAdminAction(tx.sql, grant, {
          actionType: "site_content.publish",
          resourceType: "site_page",
          resourceId: slug,
          reason: input.reason ?? null,
          metadata: {
            versionNumber,
            kind: draft.kind,
            legalReviewConfirmed: input.confirmLegalReview === true,
          },
        });
        return {
          kind: "PUBLISHED" as const,
          versionNumber,
          publishedAt: iso(pointer?.published_at ?? new Date()),
        };
      });
    },

    /** Takes a page down. Its versions and history stay. */
    unpublish: async (
      grant: AdminGrant,
      slug: string,
      reason: string,
    ): Promise<"UNPUBLISHED" | "NOT_FOUND" | "NOT_LIVE"> => {
      need(grant, "content.write");
      return transactions.run(async (tx) => {
        const [row] = await tx.sql<
          {
            page_id: string;
            version_id: string | null;
            version_number: number | null;
          }[]
        >`
          select p.id as page_id, pp.version_id, v.version_number
            from site_content.pages p
            left join site_content.published_pointers pp on pp.page_id = p.id
            left join site_content.page_versions v on v.id = pp.version_id
           where p.slug = ${slug}
           for update of p`;
        if (row === undefined) return "NOT_FOUND" as const;
        if (row.version_id === null) return "NOT_LIVE" as const;
        await tx.sql`
          delete from site_content.published_pointers where page_id = ${row.page_id}`;
        await tx.sql`
          update site_content.pages set status = 'UNPUBLISHED', updated_at = clock_timestamp()
           where id = ${row.page_id}`;
        await tx.sql`
          insert into site_content.publish_events
            (page_id, version_id, version_number, action, actor_user_id, reason)
          values (${row.page_id}, ${row.version_id}, ${row.version_number},
                  'UNPUBLISH', ${grant.userId}, ${reason})`;
        await recordAdminAction(tx.sql, grant, {
          actionType: "site_content.unpublish",
          resourceType: "site_page",
          resourceId: slug,
          reason,
          metadata: { versionNumber: row.version_number },
        });
        return "UNPUBLISHED" as const;
      });
    },

    /** Copies a version into the draft. What is live does not change until publish. */
    restore: async (
      grant: AdminGrant,
      slug: string,
      input: {
        readonly versionNumber: number;
        readonly expectedRevision: number;
      },
    ): Promise<
      | { readonly kind: "RESTORED"; readonly revision: number }
      | { readonly kind: "NOT_FOUND" }
      | { readonly kind: "STALE" }
    > => {
      need(grant, "content.write");
      return transactions.run(async (tx) => {
        const [row] = await tx.sql<
          {
            page_id: string;
            revision: number;
            version_id: string | null;
            title: string | null;
            summary: string | null;
            blocks: unknown;
          }[]
        >`
          select d.page_id, d.revision, v.id as version_id, v.title, v.summary, v.blocks
            from site_content.page_drafts d
            join site_content.pages p on p.id = d.page_id
            left join site_content.page_versions v
              on v.page_id = p.id and v.version_number = ${input.versionNumber}
           where p.slug = ${slug}
           for update of d`;
        if (row === undefined || row.version_id === null) {
          return { kind: "NOT_FOUND" as const };
        }
        if (row.revision !== input.expectedRevision) {
          return { kind: "STALE" as const };
        }
        const [saved] = await tx.sql<{ revision: number }[]>`
          update site_content.page_drafts
             set title = ${row.title ?? ""}, summary = ${row.summary ?? ""},
                 blocks = ${jsonbParam(tx.sql, blocksOf(row.blocks))},
                 base_version = ${input.versionNumber},
                 revision = revision + 1, updated_by = ${grant.userId},
                 updated_at = clock_timestamp()
           where page_id = ${row.page_id}
          returning revision`;
        await tx.sql`
          insert into site_content.publish_events
            (page_id, version_id, version_number, action, actor_user_id)
          values (${row.page_id}, ${row.version_id}, ${input.versionNumber},
                  'RESTORE_TO_DRAFT', ${grant.userId})`;
        await recordAdminAction(tx.sql, grant, {
          actionType: "site_content.restore",
          resourceType: "site_page",
          resourceId: slug,
          metadata: { versionNumber: input.versionNumber },
        });
        return { kind: "RESTORED" as const, revision: saved?.revision ?? 0 };
      });
    },

    readSettings: async (grant: AdminGrant): Promise<AdminSiteSettingsDto> => {
      need(grant, "content.read");
      return adminSettings(sql);
    },

    updateSettings: async (
      grant: AdminGrant,
      input: {
        readonly settings: SiteSettings;
        readonly expectedRevision: number;
      },
    ): Promise<"CHANGED" | "STALE"> => {
      need(grant, "content.write");
      const next = SiteSettingsSchema.parse(input.settings);
      return transactions.run(async (tx) => {
        const [row] = await tx.sql<SettingsRow[]>`
          select company_name, legal_entity, registered_address, contact_email,
                 governing_law_city, revision, updated_at
            from site_content.settings where singleton for update`;
        if (row === undefined)
          throw new Error("site content: settings row missing");
        if (row.revision !== input.expectedRevision) return "STALE" as const;
        await tx.sql`
          update site_content.settings
             set company_name = ${next.companyName},
                 legal_entity = ${next.legalEntity},
                 registered_address = ${next.registeredAddress},
                 contact_email = ${next.contactEmail},
                 governing_law_city = ${next.governingLawCity},
                 revision = revision + 1, updated_by = ${grant.userId},
                 updated_at = clock_timestamp()
           where singleton`;
        await recordAdminAction(tx.sql, grant, {
          actionType: "site_content.settings",
          resourceType: "site_settings",
          resourceId: "site",
          metadata: { before: toSettings(row), after: next },
        });
        return "CHANGED" as const;
      });
    },
  };
}

/**
 * Imports the default content (content/defaults, via importSiteMarkdown)
 * as version 1 of each page. Idempotent: a slug that already exists is
 * left exactly as it is -- after the first import the editor owns the
 * content, and a re-run never overwrites an admin's work. Pages other
 * than legal ones are published as they are imported; legal pages stay
 * DRAFT_PENDING_LEGAL_REVIEW until an admin confirms a lawyer's approval
 * and publishes them in the console.
 */
export async function seedSiteContent(
  transactions: TransactionManager,
  pages: readonly ImportedSitePage[],
): Promise<{
  readonly created: string[];
  readonly skipped: string[];
  readonly published: string[];
}> {
  const created: string[] = [];
  const skipped: string[] = [];
  const published: string[] = [];
  for (const page of pages) {
    const blocks = parseSiteBlocks(page.blocks);
    await transactions.run(async (tx) => {
      const [inserted] = await tx.sql<{ id: string }[]>`
        insert into site_content.pages
          (slug, kind, title, summary, status, sort_order, anchor, effective_date)
        values (${page.slug}, ${page.kind}, ${page.title}, ${page.summary},
                ${page.status}, ${page.order}, ${page.anchor}, ${page.effectiveDate})
        on conflict (slug) do nothing
        returning id`;
      if (inserted === undefined) {
        skipped.push(page.slug);
        return;
      }
      const [version] = await tx.sql<{ id: string }[]>`
        insert into site_content.page_versions
          (page_id, version_number, title, summary, blocks, source)
        values (${inserted.id}, 1, ${page.title}, ${page.summary},
                ${jsonbParam(tx.sql, blocks)}, 'SEED')
        returning id`;
      await tx.sql`
        insert into site_content.page_drafts (page_id, title, summary, blocks, base_version)
        values (${inserted.id}, ${page.title}, ${page.summary},
                ${jsonbParam(tx.sql, blocks)}, 1)`;
      created.push(page.slug);
      if (page.kind === "legal" || version === undefined) return;
      await tx.sql`
        insert into site_content.published_pointers (page_id, version_id)
        values (${inserted.id}, ${version.id})`;
      await tx.sql`
        update site_content.pages set status = 'PUBLISHED' where id = ${inserted.id}`;
      await tx.sql`
        insert into site_content.publish_events (page_id, version_id, version_number, action)
        values (${inserted.id}, ${version.id}, 1, 'PUBLISH')`;
      published.push(page.slug);
    });
  }
  return { created, skipped, published };
}
