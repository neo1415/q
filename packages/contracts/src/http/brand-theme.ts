import { z } from "zod";

/**
 * Brand theming (P5): the brand's primary colour, which the web app turns
 * into readable accent tokens for light and dark. Only the colour travels;
 * the derived tokens are computed where they are applied.
 *
 * - GET  /v1/brand-theme        any signed-in person: the colour in effect
 *                               for their tenant (its own, else the
 *                               platform default), or null for Capital Q's.
 * - GET  /v1/admin/brand-theme  platform admin: the platform default.
 * - POST /v1/admin/brand-theme  platform admin with step-up: set or reset.
 */
export const BRAND_THEME_PATH = "/v1/brand-theme" as const;
export const ADMIN_BRAND_THEME_PATH = "/v1/admin/brand-theme" as const;

/** Lowercase #rrggbb, the one spelling stored (it is written into CSS). */
export const BrandHexSchema = z.string().regex(/^#[0-9a-f]{6}$/u);

export const BrandThemeDtoSchema = z
  .object({
    /** Null: Capital Q's own colours. */
    primaryHex: BrandHexSchema.nullable(),
    updatedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
export type BrandThemeDto = z.infer<typeof BrandThemeDtoSchema>;

export const AdminBrandThemeRequestSchema = z
  .object({
    /** Null resets to Capital Q's colours. */
    primaryHex: BrandHexSchema.nullable(),
  })
  .strict();
export type AdminBrandThemeRequest = z.infer<
  typeof AdminBrandThemeRequestSchema
>;
