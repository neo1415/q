import { z } from "zod";

import { QManifestSectionKindSchema } from "./screen-manifest.js";
import { QRecordPageSchema, QSettingsSectionSchema } from "./ui-intent.js";
import { QVoiceDestinationSchema } from "./voice.js";

/**
 * Q Workspace W2 (DECISIONS 71; plan §5 W2): the site map. Everything the
 * signed-in app has -- every page, its tabs, its sections and the kinds of
 * record it can show -- so Q can name "the exact place" rather than only
 * the page on screen (the per-page `QPageManifest` sees one page at a time).
 *
 * It is types, not data: a page's route pattern, never an id, a name or
 * a count. Instances ("Tamarind Pay's thread", "the cap table") are
 * resolved per person by an authorised Safe Read tool, never listed here,
 * so the map is the same for everyone and safe to cache as a prompt
 * prefix. Knowing a page exists grants nothing: every page still
 * authorises its own read server-side.
 *
 * Built deterministically by the web app from its route table, its page
 * registry and the contract enums, and checked in
 * (`site-map.generated.ts`); a test fails when the build and the snapshot
 * differ, and another when a page, tab or section of `app/` is missing.
 */

/** Bump on a breaking change of the shape; the snapshot carries it. */
export const Q_SITE_MAP_VERSION = 1 as const;

/** A tab, section or sub-part id: lowercase words joined by hyphens or underscores. */
export const QSiteMapIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,47}$/u);

/**
 * A section id: exactly the page's QSection id, and the navigation
 * target's `sectionId` (W3: `#section-<id>`, `[data-q-section]`).
 */
export const QSiteMapSectionIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,39}$/u);

/** A tab key, as the navigation target's `tab` (W3). */
export const QSiteMapTabIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/u);

/** A route pattern of the app (`[param]` is one segment), as `APP_ROUTE_PATTERNS` lists it. */
export const QSiteMapRouteSchema = z
  .string()
  .regex(
    /^\/(?:[a-z0-9-]+|\[[A-Za-z]+\])(?:\/(?:[a-z0-9-]+|\[[A-Za-z]+\]))*$/u,
  );

/** A path template: a route pattern with an optional fixed query and hash. */
export const QSiteMapHrefSchema = z
  .string()
  .max(160)
  .regex(/^\/[A-Za-z0-9/[\]_-]*(?:\?[a-z0-9_=&-]+)?(?:#[a-z0-9_-]+)?$/u);

/** Who a page is for. Access is still decided by the page, never by this. */
export const Q_SITE_MAP_AUDIENCES = [
  "ANY",
  "FOUNDER",
  "INVESTOR",
  "ADMIN",
] as const;
export const QSiteMapAudienceSchema = z.enum(Q_SITE_MAP_AUDIENCES);
export type QSiteMapAudience = z.infer<typeof QSiteMapAudienceSchema>;

/**
 * The kinds of record a page can show, by a route parameter or a query.
 * Instances are resolved per person by tool (W2.3), never listed.
 */
export const Q_SITE_MAP_INSTANCE_KINDS = [
  "COMPANY",
  "INVESTOR_ORGANISATION",
  /** A relationship's message thread (by the counterpart's id). */
  "RELATIONSHIP_THREAD",
  /** A company's current pitch deck (a data-room document). */
  "DECK",
  "DATA_ROOM_DOCUMENT",
  /** A document Q made for them (an artifact). */
  "OWN_DOCUMENT",
  "WORK_ITEM",
  "WORK_REPORT",
  "CAPITAL_ROUND",
  "GATEQ_APPLICATION",
  "DAILY_EDITION",
  "REHEARSAL",
  "MEETING",
  "EXTERNAL_PERSON",
  "PITCH_VIDEO",
  "TEAM_MEMBER",
  "FOUNDER",
  "INVITATION",
] as const;
export const QSiteMapInstanceKindSchema = z.enum(Q_SITE_MAP_INSTANCE_KINDS);
export type QSiteMapInstanceKind = z.infer<typeof QSiteMapInstanceKindSchema>;

const TitleSchema = z.string().trim().min(1).max(60);
const PurposeSchema = z.string().trim().min(1).max(140);

/** A part of a tab reached by its own query (`sub=`): a deck section, a profile section. */
export const QSiteMapSubSchema = z
  .object({ id: QSiteMapIdSchema, title: TitleSchema })
  .strict();
export type QSiteMapSub = z.infer<typeof QSiteMapSubSchema>;

export const QSiteMapTabSchema = z
  .object({
    id: QSiteMapTabIdSchema,
    title: TitleSchema,
    /** Where it opens: the page's route with the tab's own query or path. */
    href: QSiteMapHrefSchema,
    /** The named destination that opens exactly this tab, if any. */
    destinations: z.array(QVoiceDestinationSchema).max(8),
    /** Parts of the tab reached by `sub=` (closed lists from the contracts). */
    subs: z.array(QSiteMapSubSchema).max(24),
    /** Who sees this tab, when narrower than the page; absent: the page's. */
    audience: QSiteMapAudienceSchema.optional(),
  })
  .strict();
export type QSiteMapTab = z.infer<typeof QSiteMapTabSchema>;

/**
 * A section of a page: the id it registers with the page manifest
 * (`QSection`, `data-q-section`), so a section named here is one the page
 * really shows, and a plain title.
 */
export const QSiteMapSectionSchema = z
  .object({
    id: QSiteMapSectionIdSchema,
    title: TitleSchema,
    kind: QManifestSectionKindSchema,
    /** The tab it is on; absent: on the page whatever the tab. */
    tab: QSiteMapTabIdSchema.optional(),
    /** Who sees this section, when narrower than the page; absent: the page's. */
    audience: QSiteMapAudienceSchema.optional(),
  })
  .strict();
export type QSiteMapSection = z.infer<typeof QSiteMapSectionSchema>;

export const QSiteMapPageSchema = z
  .object({
    route: QSiteMapRouteSchema,
    title: TitleSchema,
    purpose: PurposeSchema,
    audience: QSiteMapAudienceSchema,
    /** A page that only sends the person on: where it sends them. */
    redirectsTo: QSiteMapRouteSchema.optional(),
    /** What each `[param]` of the route names. */
    params: z
      .array(
        z
          .object({
            name: z.string().regex(/^[A-Za-z]+$/u),
            instance: QSiteMapInstanceKindSchema,
          })
          .strict(),
      )
      .max(4),
    /** Kinds of record the page can show or open (beyond its params). */
    shows: z.array(QSiteMapInstanceKindSchema).max(12),
    /** Named destinations that open the page itself (not a tab). */
    destinations: z.array(QVoiceDestinationSchema).max(8),
    /** OPEN_RECORD_PAGE pages that land here. */
    recordPages: z.array(QRecordPageSchema).max(12),
    /** OPEN_SETTINGS sections that land here. */
    settingsSections: z.array(QSettingsSectionSchema).max(12),
    tabs: z.array(QSiteMapTabSchema).max(16),
    sections: z.array(QSiteMapSectionSchema).max(16),
  })
  .strict()
  .refine(
    (page) => new Set(page.tabs.map((tab) => tab.id)).size === page.tabs.length,
    { message: "tab ids are unique on a page", path: ["tabs"] },
  )
  .refine(
    (page) =>
      new Set(page.sections.map((section) => section.id)).size ===
      page.sections.length,
    { message: "section ids are unique on a page", path: ["sections"] },
  )
  .refine(
    (page) =>
      page.sections.every(
        (section) =>
          section.tab === undefined ||
          page.tabs.some((tab) => tab.id === section.tab),
      ),
    { message: "a section's tab is one of the page's", path: ["sections"] },
  )
  .refine(
    (page) =>
      [...page.tabs, ...page.sections].every((part) =>
        narrows(page.audience, part.audience),
      ) &&
      page.sections.every((section) =>
        narrows(
          audienceOf(
            page,
            page.tabs.find((tab) => tab.id === section.tab),
          ),
          section.audience,
        ),
      ),
    {
      message:
        "a tab or section is only ever for (some of) its page's or tab's audience",
      path: ["audience"],
    },
  );
export type QSiteMapPage = z.infer<typeof QSiteMapPageSchema>;

/** Whether `inner` (absent: the same) is within `outer`. */
function narrows(
  outer: QSiteMapAudience,
  inner: QSiteMapAudience | undefined,
): boolean {
  return inner === undefined || inner === outer || outer === "ANY";
}

/**
 * Who sees a tab or section: its own audience, else its tab's, else the
 * page's. W4 relies on this for access STAYs; the page still authorises.
 */
export function audienceOf(
  page: { readonly audience: QSiteMapAudience },
  ...parts: readonly (
    { readonly audience?: QSiteMapAudience | undefined } | undefined
  )[]
): QSiteMapAudience {
  let audience = page.audience;
  for (const part of parts) {
    if (part?.audience !== undefined) audience = part.audience;
  }
  return audience;
}

export const QSiteMapSchema = z
  .object({
    version: z.literal(Q_SITE_MAP_VERSION),
    pages: z.array(QSiteMapPageSchema).min(1).max(200),
  })
  .strict()
  .refine(
    (map) =>
      new Set(map.pages.map((page) => page.route)).size === map.pages.length,
    { message: "one entry per route", path: ["pages"] },
  )
  .refine(
    (map) =>
      map.pages.every(
        (page, index) =>
          index === 0 || (map.pages[index - 1]?.route ?? "") < page.route,
      ),
    {
      message: "pages are ordered by route (a stable cache prefix)",
      path: ["pages"],
    },
  );
export type QSiteMap = z.infer<typeof QSiteMapSchema>;

// --- digest -----------------------------------------------------------------

/**
 * W2.4: the most the digest may be, in characters (about 3k tokens). A test
 * holds the generated map's digest under it, so a page added later cannot
 * silently grow the cached prefix past its budget.
 */
export const Q_SITE_MAP_DIGEST_MAX_CHARS = 12_000;

export type QSiteMapDigestOptions = {
  /** The person's side: pages for the other side are left out. Absent: both. */
  readonly side?: "FOUNDER" | "INVESTOR" | undefined;
};

function admits(
  page: QSiteMapPage,
  side: QSiteMapDigestOptions["side"],
): boolean {
  if (page.audience === "ADMIN") return false;
  if (page.redirectsTo !== undefined) return false;
  return (
    side === undefined || page.audience === "ANY" || page.audience === side
  );
}

/**
 * The compact site map a model reads (W2.4): one line per page, then its
 * tabs and sections by id and title. Deterministic (the map's own order),
 * so it can sit in a cached prompt prefix. Admin pages and pages that only
 * redirect are left out; instances are never in it (resolved by tool).
 */
export function qSiteMapDigest(
  map: QSiteMap,
  options: QSiteMapDigestOptions = {},
): string {
  const lines: string[] = [
    `Capital Q site map v${String(map.version)}. route | title | purpose. tabs: id=title. sections: id=title. [param]=what it names.`,
  ];
  for (const page of map.pages) {
    if (!admits(page, options.side)) continue;
    const params =
      page.params.length === 0
        ? ""
        : ` [${page.params.map((param) => `${param.name}=${param.instance}`).join(",")}]`;
    const who =
      options.side === undefined && page.audience !== "ANY"
        ? ` (${page.audience.toLowerCase()})`
        : "";
    lines.push(
      `${page.route}${params}${who} | ${page.title} | ${page.purpose}`,
    );
    const seen = (audience: QSiteMapAudience) =>
      options.side === undefined ||
      audience === "ANY" ||
      audience === options.side;
    const mark = (audience: QSiteMapAudience) =>
      options.side === undefined &&
      audience !== page.audience &&
      audience !== "ANY"
        ? `(${audience.toLowerCase()})`
        : "";
    const tabs = page.tabs.filter((tab) => seen(audienceOf(page, tab)));
    if (tabs.length > 0) {
      lines.push(
        ` tabs: ${tabs
          .map((tab) =>
            tab.subs.length === 0
              ? `${tab.id}=${tab.title}${mark(audienceOf(page, tab))}`
              : `${tab.id}=${tab.title}${mark(audienceOf(page, tab))}(sub: ${tab.subs.map((sub) => sub.id).join(",")})`,
          )
          .join("; ")}`,
      );
    }
    const sections = page.sections.filter(
      (section) =>
        seen(
          audienceOf(
            page,
            page.tabs.find((tab) => tab.id === section.tab),
            section,
          ),
        ) &&
        // A one-section page's section is the page itself; not worth a line.
        (page.sections.length > 1 || section.tab !== undefined),
    );
    if (sections.length > 0) {
      lines.push(
        ` sections: ${sections
          .map(
            (section) =>
              `${section.id}=${section.title}${mark(
                audienceOf(
                  page,
                  page.tabs.find((tab) => tab.id === section.tab),
                  section,
                ),
              )}${section.tab === undefined ? "" : `@${section.tab}`}`,
          )
          .join("; ")}`,
      );
    }
  }
  return lines.join("\n");
}

/** The page entry a concrete pathname belongs to, or null (`[param]` is one segment). */
export function qSiteMapPageFor(
  map: QSiteMap,
  pathname: string,
): QSiteMapPage | null {
  const path = pathname.split(/[?#]/u)[0] ?? "";
  const parts = path.split("/").filter((part) => part.length > 0);
  for (const page of map.pages) {
    const pattern = page.route.split("/").filter((part) => part.length > 0);
    if (pattern.length !== parts.length) continue;
    if (
      pattern.every(
        (segment, index) =>
          (segment.startsWith("[") && segment.endsWith("]")) ||
          segment === parts[index],
      )
    ) {
      // A literal route wins over a parameter one ("/investors/top").
      const literal = map.pages.find(
        (other) => other.route === `/${parts.join("/")}`,
      );
      return literal ?? page;
    }
  }
  return null;
}

/** Where a navigation target's `page` (a destination or a record page) lands in the map. */
export type QSiteMapLanding = {
  readonly page: QSiteMapPage;
  /** The tab the destination opens; null: the page itself. */
  readonly tab: QSiteMapTab | null;
};

/**
 * W3/W4: the site-map entry a `QNavigateTarget.page` names -- a named
 * destination (`QNavigateDestination`) or a record page (`QRecordPage`) --
 * so a target's tab and section can be checked against the page it lands
 * on. Null: the key lands on no page of the map.
 */
export function qSiteMapLandingFor(
  map: QSiteMap,
  key: string,
): QSiteMapLanding | null {
  for (const page of map.pages) {
    if ((page.destinations as readonly string[]).includes(key)) {
      return { page, tab: null };
    }
    const tab = page.tabs.find((one) =>
      (one.destinations as readonly string[]).includes(key),
    );
    if (tab !== undefined) return { page, tab };
    if ((page.recordPages as readonly string[]).includes(key)) {
      return { page, tab: null };
    }
  }
  return null;
}
