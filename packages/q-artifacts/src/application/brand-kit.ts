import {
  Q_BRAND_LOGO_MAX_BYTES,
  QBrandKitSchema,
  QBrandPaletteSchema,
  type QBrandKit,
  type QBrandKitSource,
  type QBrandKitState,
  type QBrandKitStatus,
  type QBrandPalette,
} from "@capital-q/contracts";
import {
  jsonbParam,
  type DatabaseExecutor,
  type TransactionManager,
} from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";
import { z } from "zod";

/**
 * A company's look for the documents Q prepares (DOCS spec §4.1; BIZ-005).
 *
 * Append-only versions in `artifacts.brand_kit_versions`. The rule this
 * module holds: nothing Q found or recommended applies until the person
 * confirms it, and a confirmation copies exactly the suggestion they were
 * shown, so a newer suggestion arriving in between changes nothing they
 * agreed to. Values the person sets themselves are a declaration and
 * apply as given.
 *
 * Ownership is the actor's tenant and active organisation, in every where
 * clause; the table is server-only (RLS on, no browser grant).
 */

export type BrandLogoBytes = {
  readonly bytes: Uint8Array;
  readonly contentType: "image/png" | "image/jpeg";
};

/** What a renderer needs from the effective kit. */
export type EffectiveBrand = {
  readonly kitVersion: number;
  readonly palette: QBrandPalette;
  readonly pairing: string | undefined;
  readonly hasLogo: boolean;
};

export class BrandKitNotFoundError extends Error {
  constructor() {
    super("brand kit version not found");
    this.name = "BrandKitNotFoundError";
  }
}
/** The suggestion was already answered: a yes cannot be given twice. */
export class BrandKitAlreadyAnsweredError extends Error {
  constructor() {
    super("brand kit suggestion already answered");
    this.name = "BrandKitAlreadyAnsweredError";
  }
}
export class BrandKitAuthorityError extends Error {
  constructor() {
    super("no organisation context for a brand kit");
    this.name = "BrandKitAuthorityError";
  }
}
export class BrandLogoInvalidError extends Error {
  constructor() {
    super("the logo is not a PNG or JPEG of at most 512 KB");
    this.name = "BrandLogoInvalidError";
  }
}

/** PNG or JPEG by magic bytes, within the size bound; otherwise null. */
export function readLogo(bytes: Uint8Array): BrandLogoBytes | null {
  if (bytes.byteLength < 8 || bytes.byteLength > Q_BRAND_LOGO_MAX_BYTES) {
    return null;
  }
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return { bytes, contentType: "image/png" };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { bytes, contentType: "image/jpeg" };
  }
  return null;
}

const Row = z.object({
  version: z.coerce.number().int(),
  status: z.enum(["RECOMMENDED", "CONFIRMED", "DECLINED"]),
  source: z.enum(["WEBSITE", "PERSON", "Q_DESIGN"]),
  source_url: z.string().nullable(),
  palette: z.unknown(),
  pairing: z.string().nullable(),
  has_logo: z.boolean(),
  based_on_version: z.coerce.number().int().nullable(),
  created_at: z.unknown(),
});
type KitRow = z.infer<typeof Row>;

function toKit(row: KitRow): QBrandKit {
  const createdAt =
    row.created_at instanceof Date
      ? row.created_at.toISOString()
      : new Date(String(row.created_at)).toISOString();
  return QBrandKitSchema.parse({
    version: row.version,
    status: row.status,
    source: row.source,
    ...(row.source_url === null ? {} : { sourceUrl: row.source_url }),
    palette: QBrandPaletteSchema.parse(row.palette),
    ...(row.pairing === null ? {} : { pairing: row.pairing }),
    hasLogo: row.has_logo,
    createdAt,
  });
}

/**
 * The effective kit (latest CONFIRMED) and the newest suggestion nobody
 * has answered yet, if it is newer than what applies.
 */
export function stateOf(rows: readonly KitRow[]): QBrandKitState {
  const sorted = [...rows].sort((a, b) => b.version - a.version);
  const effective = sorted.find((row) => row.status === "CONFIRMED");
  const answered = new Set(
    sorted
      .map((row) => row.based_on_version)
      .filter((value): value is number => value !== null),
  );
  const suggestion = sorted.find(
    (row) =>
      row.status === "RECOMMENDED" &&
      !answered.has(row.version) &&
      (effective === undefined || row.version > effective.version),
  );
  return {
    ...(effective === undefined ? {} : { effective: toKit(effective) }),
    ...(suggestion === undefined ? {} : { suggestion: toKit(suggestion) }),
  };
}

export type BrandKitService = {
  readonly state: (actor: ActorContext) => Promise<QBrandKitState>;
  /** Files a suggestion (RECOMMENDED). Applies nothing. */
  readonly suggest: (
    actor: ActorContext,
    input: {
      readonly source: Exclude<QBrandKitSource, "PERSON">;
      readonly sourceUrl?: string | undefined;
      readonly companyId?: string | undefined;
      readonly palette: QBrandPalette;
      readonly pairing?: string | undefined;
      readonly logo?: BrandLogoBytes | undefined;
    },
  ) => Promise<QBrandKit>;
  /** The person's own values, confirmed as given. */
  readonly set: (
    actor: ActorContext,
    input: {
      readonly palette: QBrandPalette;
      readonly pairing?: string | undefined;
      /** New logo bytes; `null` removes the logo; absent keeps the current one. */
      readonly logo?: Uint8Array | null | undefined;
    },
  ) => Promise<QBrandKit>;
  /** Confirm or decline exactly the suggestion at `version`. */
  readonly answer: (
    actor: ActorContext,
    input: {
      readonly version: number;
      readonly decision: "CONFIRM" | "DECLINE";
    },
  ) => Promise<QBrandKit>;
  readonly logo: (
    actor: ActorContext,
    version: number,
  ) => Promise<BrandLogoBytes | null>;
  readonly effective: (actor: ActorContext) => Promise<EffectiveBrand | null>;
};

const APPEND_ATTEMPTS = 3;

export function createBrandKitService(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
}): BrandKitService {
  const { sql, transactions } = dependencies;

  const owner = (actor: ActorContext) => {
    if (actor.organisationId === undefined) throw new BrandKitAuthorityError();
    return { tenantId: actor.tenantId, organisationId: actor.organisationId };
  };

  const rows = async (actor: ActorContext): Promise<KitRow[]> => {
    const { tenantId, organisationId } = owner(actor);
    const found = await sql`
      select version, status, source, source_url, palette, pairing,
             (logo is not null) as has_logo, based_on_version, created_at
        from artifacts.brand_kit_versions
       where tenant_id = ${tenantId}
         and organisation_id = ${organisationId}
       order by version desc
       limit 50
    `;
    return found.map((row) => Row.parse(row));
  };

  /** Append the next version, retrying when a concurrent write took it. */
  const append = async (
    actor: ActorContext,
    values: {
      readonly status: QBrandKitStatus;
      readonly source: QBrandKitSource;
      readonly sourceUrl: string | null;
      readonly companyId: string | null;
      readonly palette: QBrandPalette;
      readonly pairing: string | null;
      /** Bytes, or the version whose logo to copy, or none. */
      readonly logo: BrandLogoBytes | { readonly copyFrom: number } | null;
      readonly basedOnVersion: number | null;
    },
  ): Promise<QBrandKit> => {
    const { tenantId, organisationId } = owner(actor);
    const palette = QBrandPaletteSchema.parse(values.palette);
    for (let attempt = 0; attempt < APPEND_ATTEMPTS; attempt += 1) {
      const written = await transactions.run(async (tx) => {
        const next = await tx.sql`
          select coalesce(max(version), 0) + 1 as next
            from artifacts.brand_kit_versions
           where organisation_id = ${organisationId}
        `;
        const version = z.coerce
          .number()
          .int()
          .parse((next[0] as { next: unknown } | undefined)?.next);
        const logo = values.logo;
        const inserted =
          logo !== null && "copyFrom" in logo
            ? await tx.sql`
                insert into artifacts.brand_kit_versions (
                  tenant_id, organisation_id, company_id, version, status,
                  source, source_url, palette, pairing, logo,
                  logo_content_type, based_on_version, created_by_user_id)
                select ${tenantId}, ${organisationId}, ${values.companyId},
                       ${version}, ${values.status}, ${values.source},
                       ${values.sourceUrl}, ${jsonbParam(tx.sql, palette)},
                       ${values.pairing}, logo, logo_content_type,
                       ${values.basedOnVersion}, ${actor.userId}
                  from artifacts.brand_kit_versions
                 where tenant_id = ${tenantId}
                   and organisation_id = ${organisationId}
                   and version = ${logo.copyFrom}
                on conflict (organisation_id, version) do nothing
                returning version, status, source, source_url, palette,
                          pairing, (logo is not null) as has_logo,
                          based_on_version, created_at
              `
            : await tx.sql`
                insert into artifacts.brand_kit_versions (
                  tenant_id, organisation_id, company_id, version, status,
                  source, source_url, palette, pairing, logo,
                  logo_content_type, based_on_version, created_by_user_id)
                values (${tenantId}, ${organisationId}, ${values.companyId},
                        ${version}, ${values.status}, ${values.source},
                        ${values.sourceUrl}, ${jsonbParam(tx.sql, palette)},
                        ${values.pairing},
                        ${logo === null ? null : Buffer.from(logo.bytes)},
                        ${logo === null ? null : logo.contentType},
                        ${values.basedOnVersion}, ${actor.userId})
                on conflict (organisation_id, version) do nothing
                returning version, status, source, source_url, palette,
                          pairing, (logo is not null) as has_logo,
                          based_on_version, created_at
              `;
        return inserted.length === 0 ? null : Row.parse(inserted[0]);
      });
      if (written !== null) return toKit(written);
    }
    throw new Error("could not append a brand kit version");
  };

  return {
    state: async (actor) => stateOf(await rows(actor)),

    suggest: async (actor, input) =>
      append(actor, {
        status: "RECOMMENDED",
        source: input.source,
        sourceUrl: input.sourceUrl ?? null,
        companyId: input.companyId ?? null,
        palette: input.palette,
        pairing: input.pairing ?? null,
        logo: input.logo ?? null,
        basedOnVersion: null,
      }),

    set: async (actor, input) => {
      let logo: BrandLogoBytes | { readonly copyFrom: number } | null = null;
      if (input.logo instanceof Uint8Array) {
        const read = readLogo(input.logo);
        if (read === null) throw new BrandLogoInvalidError();
        logo = read;
      } else if (input.logo === undefined) {
        const effective = stateOf(await rows(actor)).effective;
        logo =
          effective?.hasLogo === true ? { copyFrom: effective.version } : null;
      }
      return append(actor, {
        status: "CONFIRMED",
        source: "PERSON",
        sourceUrl: null,
        companyId: null,
        palette: input.palette,
        pairing: input.pairing ?? null,
        logo,
        basedOnVersion: null,
      });
    },

    answer: async (actor, input) => {
      const all = await rows(actor);
      const target = all.find(
        (row) => row.version === input.version && row.status === "RECOMMENDED",
      );
      if (target === undefined) throw new BrandKitNotFoundError();
      if (all.some((row) => row.based_on_version === input.version)) {
        throw new BrandKitAlreadyAnsweredError();
      }
      // Exactly what they were shown: the suggestion's own payload.
      return append(actor, {
        status: input.decision === "CONFIRM" ? "CONFIRMED" : "DECLINED",
        source: target.source,
        sourceUrl: target.source_url,
        companyId: null,
        palette: QBrandPaletteSchema.parse(target.palette),
        pairing: target.pairing,
        logo: target.has_logo ? { copyFrom: target.version } : null,
        basedOnVersion: target.version,
      });
    },

    logo: async (actor, version) => {
      const { tenantId, organisationId } = owner(actor);
      const found = await sql`
        select logo, logo_content_type
          from artifacts.brand_kit_versions
         where tenant_id = ${tenantId}
           and organisation_id = ${organisationId}
           and version = ${version}
           and logo is not null
         limit 1
      `;
      const row = found[0] as
        { logo: unknown; logo_content_type: unknown } | undefined;
      if (row === undefined || !(row.logo instanceof Uint8Array)) return null;
      return readLogo(new Uint8Array(row.logo));
    },

    effective: async (actor) => {
      const effective = stateOf(await rows(actor)).effective;
      if (effective === undefined) return null;
      return {
        kitVersion: effective.version,
        palette: effective.palette,
        pairing: effective.pairing,
        hasLogo: effective.hasLogo,
      };
    },
  };
}
