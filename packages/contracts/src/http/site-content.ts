import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { CurrencyCodeSchema } from "../common/money.js";

/**
 * The site's content editor (decision 107): landing sections, the pricing
 * page, the FAQ and the legal pages, as typed blocks with versions,
 * preview and publish.
 *
 * Public (anonymous, server-to-server from the web app):
 * - GET  /v1/site/pages/:slug          the published version of one page
 * - GET  /v1/site/landing              every published landing section
 * - GET  /v1/site/images/:documentId   a short-lived link to a published image
 *
 * Admin console (identity.platform_admins; writes need a live step-up and
 * are audited):
 * - GET  /v1/admin/site/pages                    every page, its status, settings
 * - GET  /v1/admin/site/pages/:slug              the draft, versions, history
 * - GET  /v1/admin/site/pages/:slug/versions/:n  one immutable version
 * - PUT  /v1/admin/site/pages/:slug/draft        autosave (optimistic revision)
 * - POST /v1/admin/site/pages/:slug/publish      draft → new version → live
 * - POST /v1/admin/site/pages/:slug/unpublish    take it down (history kept)
 * - POST /v1/admin/site/pages/:slug/restore      copy a version into the draft
 * - POST /v1/admin/site/settings                 the placeholder record
 *
 * Rich text is structured data (paragraphs and lists of text spans with
 * bold, italic and a checked link), never HTML: nothing stored here is ever
 * injected as markup, so a "<script>" typed into a block is only text.
 */

export const SITE_PAGE_PATH = "/v1/site/pages/:slug" as const;
export const SITE_LANDING_PATH = "/v1/site/landing" as const;
export const SITE_IMAGE_PATH = "/v1/site/images/:documentId" as const;
export const ADMIN_SITE_PAGES_PATH = "/v1/admin/site/pages" as const;
export const ADMIN_SITE_PAGE_PATH = "/v1/admin/site/pages/:slug" as const;
export const ADMIN_SITE_PAGE_VERSION_PATH =
  "/v1/admin/site/pages/:slug/versions/:versionNumber" as const;
export const ADMIN_SITE_PAGE_DRAFT_PATH =
  "/v1/admin/site/pages/:slug/draft" as const;
export const ADMIN_SITE_PAGE_PUBLISH_PATH =
  "/v1/admin/site/pages/:slug/publish" as const;
export const ADMIN_SITE_PAGE_UNPUBLISH_PATH =
  "/v1/admin/site/pages/:slug/unpublish" as const;
export const ADMIN_SITE_PAGE_RESTORE_PATH =
  "/v1/admin/site/pages/:slug/restore" as const;
export const ADMIN_SITE_SETTINGS_PATH = "/v1/admin/site/settings" as const;

export const SITE_PAGE_KINDS = [
  "landing-section",
  "pricing",
  "faq",
  "legal",
] as const;
export const SitePageKindSchema = z.enum(SITE_PAGE_KINDS);
export type SitePageKind = z.infer<typeof SitePageKindSchema>;

export const SITE_PAGE_STATUSES = [
  "DRAFT",
  "DRAFT_PENDING_LEGAL_REVIEW",
  "PUBLISHED",
  "UNPUBLISHED",
] as const;
export const SitePageStatusSchema = z.enum(SITE_PAGE_STATUSES);
export type SitePageStatus = z.infer<typeof SitePageStatusSchema>;

export const SiteSlugSchema = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);

// --- links and text ----------------------------------------------------------

/**
 * A link a published page may carry: this site's own paths, an in-page
 * anchor, https, or mailto. `javascript:`, `data:`, protocol-relative and
 * backslash tricks are not links.
 */
export function isSafeSiteHref(href: string): boolean {
  if (href.length === 0 || href.length > 2048) return false;
  if (/[\s\\<>"'`]/u.test(href)) return false;
  if (href.startsWith("/")) return !href.startsWith("//");
  if (href.startsWith("#")) return /^#[A-Za-z0-9_-]{1,64}$/u.test(href);
  if (/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:[/?#].*)?$/u.test(href)) {
    return true;
  }
  return /^mailto:[^@]+@[^@]+$/u.test(href);
}

export const SiteHrefSchema = z
  .string()
  .max(2048)
  .refine(isSafeSiteHref, "Use a site path, #anchor, https or mailto link.");

const Text = (max: number) => z.string().max(max);

export const BlockIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/u);

export const RichSpanSchema = z
  .object({
    text: Text(8000),
    bold: z.literal(true).optional(),
    italic: z.literal(true).optional(),
    href: SiteHrefSchema.optional(),
  })
  .strict();
export type RichSpan = z.infer<typeof RichSpanSchema>;

const Spans = z.array(RichSpanSchema).max(200);

export const RichNodeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("paragraph"), spans: Spans }).strict(),
  z
    .object({
      kind: z.literal("list"),
      ordered: z.boolean(),
      items: z.array(Spans).max(100),
    })
    .strict(),
]);
export type RichNode = z.infer<typeof RichNodeSchema>;

export const RichTextSchema = z.array(RichNodeSchema).max(200);
export type RichText = z.infer<typeof RichTextSchema>;

/** A price as an exact decimal string; the block names its currency. */
export const SitePriceSchema = z
  .string()
  .regex(/^\d{1,9}(?:\.\d{1,2})?$/u, "A price like 29 or 29.50.");

// --- blocks ---------------------------------------------------------------

const HeadingBlock = z
  .object({
    type: z.literal("heading"),
    id: BlockIdSchema,
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    text: Text(300),
  })
  .strict();

const RichTextBlock = z
  .object({
    type: z.literal("richText"),
    id: BlockIdSchema,
    content: RichTextSchema,
  })
  .strict();

const ImageBlock = z
  .object({
    type: z.literal("image"),
    id: BlockIdSchema,
    /** A document the admin uploaded through the scanned upload path. */
    documentId: UuidSchema.nullable(),
    alt: Text(300),
    caption: Text(300),
  })
  .strict();

const CalloutBlock = z
  .object({
    type: z.literal("callout"),
    id: BlockIdSchema,
    tone: z.enum(["info", "note", "warning"]),
    title: Text(200),
    content: RichTextSchema,
  })
  .strict();

const SummaryBlock = z
  .object({
    type: z.literal("summary"),
    id: BlockIdSchema,
    title: Text(200),
    content: RichTextSchema,
  })
  .strict();

const FaqBlock = z
  .object({
    type: z.literal("faq"),
    id: BlockIdSchema,
    title: Text(200),
    items: z
      .array(
        z
          .object({
            id: BlockIdSchema,
            question: Text(300),
            answer: RichTextSchema,
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

export const SitePricingPlanSchema = z
  .object({
    id: BlockIdSchema,
    name: Text(80),
    description: Text(300),
    /** Null: not offered on that interval. "0" is free. */
    monthly: SitePriceSchema.nullable(),
    annual: SitePriceSchema.nullable(),
    priceNote: Text(120),
    perks: z.array(Text(300)).max(30),
    highlight: z.boolean(),
    ctaLabel: Text(60),
    ctaHref: z.union([z.literal(""), SiteHrefSchema]),
  })
  .strict();
export type SitePricingPlan = z.infer<typeof SitePricingPlanSchema>;

const PricingBlock = z
  .object({
    type: z.literal("pricing"),
    id: BlockIdSchema,
    title: Text(200),
    currency: CurrencyCodeSchema,
    showIntervalToggle: z.boolean(),
    plans: z.array(SitePricingPlanSchema).max(8),
  })
  .strict();

const TableBlock = z
  .object({
    type: z.literal("table"),
    id: BlockIdSchema,
    caption: Text(300),
    header: z.array(Text(200)).max(8),
    rows: z.array(z.array(Text(400)).max(8)).max(80),
  })
  .strict();

const FeaturesBlock = z
  .object({
    type: z.literal("features"),
    id: BlockIdSchema,
    title: Text(200),
    items: z
      .array(
        z
          .object({
            id: BlockIdSchema,
            title: Text(200),
            description: Text(600),
          })
          .strict(),
      )
      .max(24),
  })
  .strict();

const ButtonBlock = z
  .object({
    type: z.literal("button"),
    id: BlockIdSchema,
    label: Text(60),
    href: SiteHrefSchema,
    variant: z.enum(["primary", "secondary"]),
  })
  .strict();

const DividerBlock = z
  .object({ type: z.literal("divider"), id: BlockIdSchema })
  .strict();

const LegalClauseBlock = z
  .object({
    type: z.literal("legalClause"),
    id: BlockIdSchema,
    title: Text(300),
    content: RichTextSchema,
    /** For the lawyer and the editors only: stripped from every public read. */
    lawyerNote: Text(4000).nullable(),
  })
  .strict();

const LEAF_BLOCKS = [
  HeadingBlock,
  RichTextBlock,
  ImageBlock,
  CalloutBlock,
  SummaryBlock,
  FaqBlock,
  PricingBlock,
  TableBlock,
  FeaturesBlock,
  ButtonBlock,
  DividerBlock,
  LegalClauseBlock,
] as const;

export const SiteLeafBlockSchema = z.discriminatedUnion("type", [
  ...LEAF_BLOCKS,
]);
export type SiteLeafBlock = z.infer<typeof SiteLeafBlockSchema>;

const ColumnsBlock = z
  .object({
    type: z.literal("columns"),
    id: BlockIdSchema,
    left: z.array(SiteLeafBlockSchema).max(40),
    right: z.array(SiteLeafBlockSchema).max(40),
  })
  .strict();

export const SiteBlockSchema = z.discriminatedUnion("type", [
  ...LEAF_BLOCKS,
  ColumnsBlock,
]);
export type SiteBlock = z.infer<typeof SiteBlockSchema>;
export type SiteBlockType = SiteBlock["type"];

export const SITE_BLOCK_LIMIT = 300;
export const SiteBlocksSchema = z
  .array(SiteBlockSchema)
  .max(SITE_BLOCK_LIMIT)
  .superRefine((blocks, context) => {
    const seen = new Set<string>();
    const visit = (id: string) => {
      if (seen.has(id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate block id ${id}`,
        });
      }
      seen.add(id);
    };
    for (const block of blocks) {
      visit(block.id);
      if (block.type === "columns") {
        for (const inner of [...block.left, ...block.right]) visit(inner.id);
      }
    }
  });

// --- sanitising -------------------------------------------------------------

// C0 controls other than tab and newline, DEL, and the bidirectional
// overrides that can disguise text (Trojan Source).
// eslint-disable-next-line no-control-regex -- the point is to find them
const UNSAFE_CHARACTERS = /[\u0000-\u0008\u000B-\u001F\u007F‪-‮⁦-⁩]/gu;

function cleanText(value: string): string {
  return value.replace(UNSAFE_CHARACTERS, "");
}

/**
 * Brings untrusted block JSON to a shape the schema can judge, without
 * trusting it: strips control and bidi-override characters from every
 * string and drops any link that is not a safe site link (the words stay,
 * the link goes). Anything else wrong is left for the schema to refuse.
 */
export function sanitiseSiteValue(value: unknown): unknown {
  if (typeof value === "string") return cleanText(value);
  if (Array.isArray(value)) return value.map(sanitiseSiteValue);
  if (typeof value !== "object" || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    const next = sanitiseSiteValue(raw);
    if (key === "href" && "text" in value) {
      // A rich-text span's link: unsafe means no link at all.
      if (typeof next === "string" && isSafeSiteHref(next)) out[key] = next;
      continue;
    }
    out[key] = next;
  }
  return out;
}

/** Sanitise, then validate. Throws a ZodError for anything still wrong. */
export function parseSiteBlocks(raw: unknown): SiteBlock[] {
  return SiteBlocksSchema.parse(sanitiseSiteValue(raw));
}

// --- settings and placeholders ---------------------------------------------

export const SiteSettingsSchema = z
  .object({
    companyName: z.string().trim().min(1).max(120),
    legalEntity: z.string().trim().max(200).nullable(),
    registeredAddress: z.string().trim().max(400).nullable(),
    contactEmail: z.string().trim().email().max(254).nullable(),
    governingLawCity: z.string().trim().max(120).nullable(),
  })
  .strict();
export type SiteSettings = z.infer<typeof SiteSettingsSchema>;

export const SITE_PLACEHOLDERS = {
  COMPANY_NAME: { field: "companyName", label: "Brand name" },
  LEGAL_ENTITY: { field: "legalEntity", label: "Registered company name" },
  REGISTERED_ADDRESS: {
    field: "registeredAddress",
    label: "Registered office address",
  },
  CONTACT_EMAIL: { field: "contactEmail", label: "Contact email" },
  GOVERNING_LAW_CITY: {
    field: "governingLawCity",
    label: "City for courts or arbitration",
  },
} as const satisfies Record<
  string,
  { readonly field: keyof SiteSettings; readonly label: string }
>;
export type SitePlaceholder = keyof typeof SITE_PLACEHOLDERS;

const PLACEHOLDER = /\{\{([A-Z_]{2,40})\}\}/gu;

/**
 * `{{COMPANY_NAME}}` and the rest, from the one settings record. A value
 * the admin has not set yet reads as its label in brackets, so a page
 * never shows raw braces or invents a name.
 */
export function resolveSitePlaceholders(
  text: string,
  settings: SiteSettings,
): string {
  return text.replace(PLACEHOLDER, (whole, key: string) => {
    const entry = (
      SITE_PLACEHOLDERS as Record<
        string,
        { readonly field: keyof SiteSettings; readonly label: string }
      >
    )[key];
    if (entry === undefined) return whole;
    const value = settings[entry.field];
    return value === null || value === "" ? `[${entry.label}]` : value;
  });
}

/** The placeholders a text uses, in order of first use. */
export function sitePlaceholdersIn(text: string): SitePlaceholder[] {
  const found: SitePlaceholder[] = [];
  for (const match of text.matchAll(PLACEHOLDER)) {
    const key = match[1] as SitePlaceholder;
    if (key in SITE_PLACEHOLDERS && !found.includes(key)) found.push(key);
  }
  return found;
}

function mapStrings<T>(value: T, map: (text: string) => string): T {
  if (typeof value === "string") return map(value) as T;
  if (Array.isArray(value)) {
    return value.map((item: unknown) => mapStrings(item, map)) as T;
  }
  if (typeof value !== "object" || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    // Identifiers and links are not prose.
    out[key] =
      key === "id" || key === "type" || key === "documentId" || key === "tone"
        ? raw
        : mapStrings(raw, map);
  }
  return out as T;
}

/**
 * What a visitor may see of a version: lawyer notes removed, placeholders
 * resolved. The one projection every public read and every preview uses.
 */
export function publicSiteBlocks(
  blocks: readonly SiteBlock[],
  settings: SiteSettings,
): SiteBlock[] {
  const strip = (block: SiteLeafBlock): SiteLeafBlock =>
    block.type === "legalClause" ? { ...block, lawyerNote: null } : block;
  const stripped = blocks.map((block): SiteBlock =>
    block.type === "columns"
      ? { ...block, left: block.left.map(strip), right: block.right.map(strip) }
      : strip(block),
  );
  return mapStrings(stripped, (text) =>
    resolveSitePlaceholders(text, settings),
  );
}

/** Every document an image block shows, in order, once each. */
export function siteImageDocumentIds(blocks: readonly SiteBlock[]): string[] {
  const ids: string[] = [];
  const visit = (block: SiteLeafBlock) => {
    if (
      block.type === "image" &&
      block.documentId !== null &&
      !ids.includes(block.documentId)
    ) {
      ids.push(block.documentId);
    }
  };
  for (const block of blocks) {
    if (block.type === "columns") {
      block.left.forEach(visit);
      block.right.forEach(visit);
    } else visit(block);
  }
  return ids;
}

/** How many lawyer notes are still open on a page. */
export function siteLawyerNoteCount(blocks: readonly SiteBlock[]): number {
  let count = 0;
  const visit = (block: SiteLeafBlock) => {
    if (block.type === "legalClause" && (block.lawyerNote ?? "") !== "") {
      count += 1;
    }
  };
  for (const block of blocks) {
    if (block.type === "columns") {
      block.left.forEach(visit);
      block.right.forEach(visit);
    } else visit(block);
  }
  return count;
}

/** Plain words of a rich text, for summaries, search and fallbacks. */
export function richTextPlain(content: RichText): string {
  return content
    .map((node) =>
      node.kind === "paragraph"
        ? node.spans.map((span) => span.text).join("")
        : node.items.map((item) => item.map((s) => s.text).join("")).join("\n"),
    )
    .join("\n\n");
}

// --- DTOs -------------------------------------------------------------------

const IsoDateTime = z.string().datetime({ offset: true });

export const PublicSitePageDtoSchema = z
  .object({
    slug: SiteSlugSchema,
    kind: SitePageKindSchema,
    title: z.string(),
    summary: z.string(),
    effectiveDate: z.string().nullable(),
    versionNumber: z.number().int().min(1),
    publishedAt: IsoDateTime,
    blocks: SiteBlocksSchema,
  })
  .strict();
export type PublicSitePageDto = z.infer<typeof PublicSitePageDtoSchema>;

export const PublicSiteLandingDtoSchema = z
  .object({
    sections: z.array(
      z
        .object({
          slug: SiteSlugSchema,
          order: z.number().int().nullable(),
          anchor: z.string().nullable(),
          title: z.string(),
          blocks: SiteBlocksSchema,
        })
        .strict(),
    ),
  })
  .strict();
export type PublicSiteLandingDto = z.infer<typeof PublicSiteLandingDtoSchema>;

export const PublicSiteImageDtoSchema = z
  .object({ url: z.string().url(), expiresAt: z.string() })
  .strict();
export type PublicSiteImageDto = z.infer<typeof PublicSiteImageDtoSchema>;

export const AdminSitePageSummaryDtoSchema = z
  .object({
    slug: SiteSlugSchema,
    kind: SitePageKindSchema,
    title: z.string(),
    summary: z.string(),
    status: SitePageStatusSchema,
    order: z.number().int().nullable(),
    publishedVersion: z.number().int().nullable(),
    latestVersion: z.number().int().nullable(),
    /** The draft differs from what is live (or nothing is live). */
    unpublishedChanges: z.boolean(),
    lawyerNotes: z.number().int().min(0),
    updatedAt: IsoDateTime,
  })
  .strict();
export type AdminSitePageSummaryDto = z.infer<
  typeof AdminSitePageSummaryDtoSchema
>;

export const AdminSiteSettingsDtoSchema = z
  .object({
    settings: SiteSettingsSchema,
    revision: z.number().int().min(1),
    updatedAt: IsoDateTime,
  })
  .strict();
export type AdminSiteSettingsDto = z.infer<typeof AdminSiteSettingsDtoSchema>;

export const AdminSitePageListDtoSchema = z
  .object({
    pages: z.array(AdminSitePageSummaryDtoSchema),
    settings: AdminSiteSettingsDtoSchema,
  })
  .strict();
export type AdminSitePageListDto = z.infer<typeof AdminSitePageListDtoSchema>;

export const SITE_VERSION_SOURCES = ["SEED", "EDITOR", "RESTORE"] as const;
export const SITE_PUBLISH_ACTIONS = [
  "PUBLISH",
  "UNPUBLISH",
  "RESTORE_TO_DRAFT",
] as const;

export const AdminSitePageDetailDtoSchema = z
  .object({
    page: AdminSitePageSummaryDtoSchema,
    effectiveDate: z.string().nullable(),
    draft: z
      .object({
        title: z.string(),
        summary: z.string(),
        blocks: SiteBlocksSchema,
        revision: z.number().int().min(1),
        baseVersion: z.number().int().nullable(),
        updatedAt: IsoDateTime,
        updatedByName: z.string().nullable(),
      })
      .strict(),
    versions: z.array(
      z
        .object({
          versionNumber: z.number().int().min(1),
          source: z.enum(SITE_VERSION_SOURCES),
          restoredFrom: z.number().int().nullable(),
          authorName: z.string().nullable(),
          createdAt: IsoDateTime,
          live: z.boolean(),
        })
        .strict(),
    ),
    history: z.array(
      z
        .object({
          action: z.enum(SITE_PUBLISH_ACTIONS),
          versionNumber: z.number().int().nullable(),
          actorName: z.string().nullable(),
          reason: z.string().nullable(),
          at: IsoDateTime,
        })
        .strict(),
    ),
    settings: SiteSettingsSchema,
  })
  .strict();
export type AdminSitePageDetailDto = z.infer<
  typeof AdminSitePageDetailDtoSchema
>;

export const AdminSiteVersionDtoSchema = z
  .object({
    versionNumber: z.number().int().min(1),
    title: z.string(),
    summary: z.string(),
    blocks: SiteBlocksSchema,
    createdAt: IsoDateTime,
  })
  .strict();
export type AdminSiteVersionDto = z.infer<typeof AdminSiteVersionDtoSchema>;

const Revision = z.number().int().min(1);
const Reason = z.string().trim().min(3).max(500);

/** Blocks arrive as unknown and are sanitised, then validated, on the server. */
export const SaveSiteDraftRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    summary: z.string().max(600),
    blocks: z.unknown(),
    expectedRevision: Revision,
  })
  .strict();
export type SaveSiteDraftRequest = z.infer<typeof SaveSiteDraftRequestSchema>;

export const SaveSiteDraftResultDtoSchema = z
  .object({ revision: Revision, updatedAt: IsoDateTime })
  .strict();
export type SaveSiteDraftResultDto = z.infer<
  typeof SaveSiteDraftResultDtoSchema
>;

export const PublishSitePageRequestSchema = z
  .object({
    expectedRevision: Revision,
    reason: Reason.optional(),
    /**
     * A legal page waiting for review goes live only when the admin says a
     * lawyer has approved this text.
     */
    confirmLegalReview: z.literal(true).optional(),
  })
  .strict();
export type PublishSitePageRequest = z.infer<
  typeof PublishSitePageRequestSchema
>;

export const PublishSitePageResultDtoSchema = z
  .object({ versionNumber: z.number().int().min(1), publishedAt: IsoDateTime })
  .strict();
export type PublishSitePageResultDto = z.infer<
  typeof PublishSitePageResultDtoSchema
>;

export const UnpublishSitePageRequestSchema = z
  .object({ reason: Reason })
  .strict();
export type UnpublishSitePageRequest = z.infer<
  typeof UnpublishSitePageRequestSchema
>;

export const RestoreSiteVersionRequestSchema = z
  .object({
    versionNumber: z.number().int().min(1),
    expectedRevision: Revision,
  })
  .strict();
export type RestoreSiteVersionRequest = z.infer<
  typeof RestoreSiteVersionRequestSchema
>;

export const UpdateSiteSettingsRequestSchema = z
  .object({ settings: SiteSettingsSchema, expectedRevision: Revision })
  .strict();
export type UpdateSiteSettingsRequest = z.infer<
  typeof UpdateSiteSettingsRequestSchema
>;

export const SiteChangedDtoSchema = z.object({ ok: z.literal(true) }).strict();
