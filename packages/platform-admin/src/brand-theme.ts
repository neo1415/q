import {
  BrandPresetKeySchema,
  DEFAULT_BRAND_PRESET,
  type BrandPresetKey,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";

import { recordAdminAction, type AdminGrant } from "./access.js";

/**
 * Brand theming (P5; K3 presets, ADR 0051): a preset and, on top, an
 * optional primary colour. The platform default (tenant_id null) applies
 * to everyone; a tenant row, when one exists, wins for that tenant's
 * people. With no row at all the default preset (black and gold) is in
 * effect. Reads are open to any signed-in person (it is how the app looks,
 * not data about anyone); a change needs the console's write grant and is
 * recorded with the preset and colour before and after.
 */

export type BrandTheme = {
  readonly presetKey: BrandPresetKey;
  readonly primaryHex: string | null;
  readonly updatedAt: string | null;
};

const NONE: BrandTheme = {
  presetKey: DEFAULT_BRAND_PRESET,
  primaryHex: null,
  updatedAt: null,
};

type Row = {
  preset_key: string;
  primary_hex: string | null;
  updated_at: Date;
};

/** A key the code no longer paints falls back to the default, never breaks. */
const presetOf = (key: string): BrandPresetKey => {
  const parsed = BrandPresetKeySchema.safeParse(key);
  return parsed.success ? parsed.data : DEFAULT_BRAND_PRESET;
};

const toTheme = (row: Row | undefined): BrandTheme =>
  row === undefined
    ? NONE
    : {
        presetKey: presetOf(row.preset_key),
        primaryHex: row.primary_hex,
        updatedAt: new Date(row.updated_at).toISOString(),
      };

/** The theme in effect for a tenant: its own, else the platform default. */
export async function effectiveBrandTheme(
  sql: DatabaseExecutor,
  tenantId: string | null,
): Promise<BrandTheme> {
  const [row] = await sql<Row[]>`
    select preset_key, primary_hex, updated_at
      from platform_ops.brand_themes
     where tenant_id is null or tenant_id = ${tenantId}
     order by tenant_id nulls last
     limit 1`;
  return toTheme(row);
}

/** The platform default only (the console's view). */
export async function platformBrandTheme(
  sql: DatabaseExecutor,
): Promise<BrandTheme> {
  const [row] = await sql<Row[]>`
    select preset_key, primary_hex, updated_at
      from platform_ops.brand_themes
     where tenant_id is null`;
  return toTheme(row);
}

export type BrandThemeChange = {
  /** Omitted: keep the current preset (or, with a null colour, reset). */
  readonly presetKey?: BrandPresetKey | undefined;
  /** Null: the preset's own accent. */
  readonly primaryHex: string | null;
};

/** No preset named and no colour: back to the default preset, its own accent. */
export const isBrandReset = (change: BrandThemeChange): boolean =>
  change.presetKey === undefined && change.primaryHex === null;

/** Set the platform default preset and colour, or reset (see isBrandReset). */
export async function setPlatformBrandTheme(
  transactions: TransactionManager,
  grant: AdminGrant,
  change: BrandThemeChange,
): Promise<BrandTheme> {
  return transactions.run(async (tx) => {
    const [before] = await tx.sql<Row[]>`
      select preset_key, primary_hex, updated_at from platform_ops.brand_themes
       where tenant_id is null for update`;
    const reset = isBrandReset(change);
    const fromPreset =
      before === undefined ? null : presetOf(before.preset_key);
    const fromHex = before?.primary_hex ?? null;
    const preset = change.presetKey ?? fromPreset ?? DEFAULT_BRAND_PRESET;
    const unchanged = reset
      ? before === undefined
      : fromPreset === preset && fromHex === change.primaryHex;
    if (unchanged) return toTheme(before);
    let after: Row | undefined;
    if (reset) {
      await tx.sql`delete from platform_ops.brand_themes where tenant_id is null`;
    } else if (before === undefined) {
      [after] = await tx.sql<Row[]>`
        insert into platform_ops.brand_themes
          (tenant_id, preset_key, primary_hex, updated_by)
        values (null, ${preset}, ${change.primaryHex}, ${grant.userId})
        returning preset_key, primary_hex, updated_at`;
    } else {
      [after] = await tx.sql<Row[]>`
        update platform_ops.brand_themes
           set preset_key = ${preset}, primary_hex = ${change.primaryHex},
               updated_by = ${grant.userId}, updated_at = clock_timestamp()
         where tenant_id is null
        returning preset_key, primary_hex, updated_at`;
    }
    await recordAdminAction(tx.sql, grant, {
      actionType: reset ? "brand.reset" : "brand.set",
      resourceType: "brand_theme",
      resourceId: "platform",
      metadata: {
        from: { preset: fromPreset, hex: fromHex },
        to: reset
          ? { preset: DEFAULT_BRAND_PRESET, hex: null }
          : { preset, hex: change.primaryHex },
      },
    });
    return toTheme(after);
  });
}

export type BrandThemeStore = {
  readonly effective: (tenantId: string | null) => Promise<BrandTheme>;
  readonly platform: () => Promise<BrandTheme>;
  readonly setPlatform: (
    grant: AdminGrant,
    change: BrandThemeChange,
  ) => Promise<BrandTheme>;
};

export function createBrandThemeStore(options: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
}): BrandThemeStore {
  return {
    effective: (tenantId) => effectiveBrandTheme(options.sql, tenantId),
    platform: () => platformBrandTheme(options.sql),
    setPlatform: (grant, change) =>
      setPlatformBrandTheme(options.transactions, grant, change),
  };
}
