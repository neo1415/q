import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";

import { recordAdminAction, type AdminGrant } from "./access.js";

/**
 * Brand theming (P5): the brand's primary colour. The platform default
 * (tenant_id null) applies to everyone; a tenant row, when one exists, wins
 * for that tenant's people. Reads are open to any signed-in person (it is
 * how the app looks, not data about anyone); a change needs the console's
 * write grant and is recorded with the colour before and after.
 */

export type BrandTheme = {
  readonly primaryHex: string | null;
  readonly updatedAt: string | null;
};

const NONE: BrandTheme = { primaryHex: null, updatedAt: null };

type Row = { primary_hex: string; updated_at: Date };

const toTheme = (row: Row | undefined): BrandTheme =>
  row === undefined
    ? NONE
    : {
        primaryHex: row.primary_hex,
        updatedAt: new Date(row.updated_at).toISOString(),
      };

/** The colour in effect for a tenant: its own, else the platform default. */
export async function effectiveBrandTheme(
  sql: DatabaseExecutor,
  tenantId: string | null,
): Promise<BrandTheme> {
  const [row] = await sql<Row[]>`
    select primary_hex, updated_at
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
    select primary_hex, updated_at
      from platform_ops.brand_themes
     where tenant_id is null`;
  return toTheme(row);
}

/** Set (or, with null, reset) the platform default colour. */
export async function setPlatformBrandTheme(
  transactions: TransactionManager,
  grant: AdminGrant,
  primaryHex: string | null,
): Promise<BrandTheme> {
  return transactions.run(async (tx) => {
    const [before] = await tx.sql<Row[]>`
      select primary_hex, updated_at from platform_ops.brand_themes
       where tenant_id is null for update`;
    const from = before?.primary_hex ?? null;
    if (from === primaryHex) return toTheme(before);
    let after: Row | undefined;
    if (primaryHex === null) {
      await tx.sql`delete from platform_ops.brand_themes where tenant_id is null`;
    } else if (before === undefined) {
      [after] = await tx.sql<Row[]>`
        insert into platform_ops.brand_themes (tenant_id, primary_hex, updated_by)
        values (null, ${primaryHex}, ${grant.userId})
        returning primary_hex, updated_at`;
    } else {
      [after] = await tx.sql<Row[]>`
        update platform_ops.brand_themes
           set primary_hex = ${primaryHex}, updated_by = ${grant.userId},
               updated_at = clock_timestamp()
         where tenant_id is null
        returning primary_hex, updated_at`;
    }
    await recordAdminAction(tx.sql, grant, {
      actionType: primaryHex === null ? "brand.reset" : "brand.set",
      resourceType: "brand_theme",
      resourceId: "platform",
      metadata: { from, to: primaryHex },
    });
    return toTheme(after);
  });
}

export type BrandThemeStore = {
  readonly effective: (tenantId: string | null) => Promise<BrandTheme>;
  readonly platform: () => Promise<BrandTheme>;
  readonly setPlatform: (
    grant: AdminGrant,
    primaryHex: string | null,
  ) => Promise<BrandTheme>;
};

export function createBrandThemeStore(options: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
}): BrandThemeStore {
  return {
    effective: (tenantId) => effectiveBrandTheme(options.sql, tenantId),
    platform: () => platformBrandTheme(options.sql),
    setPlatform: (grant, primaryHex) =>
      setPlatformBrandTheme(options.transactions, grant, primaryHex),
  };
}
