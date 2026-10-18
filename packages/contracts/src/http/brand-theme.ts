import { z } from "zod";

/**
 * Brand theming (P5; K3 presets, ADR 0051): a preset (the page, surfaces,
 * menu bar, accent and Q's light together) and, on top, an optional
 * primary colour the web app turns into readable accent tokens for light
 * and dark. Only the preset's key and the colour travel; the tokens are
 * computed where they are applied.
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

/**
 * The presets the web app can paint. Their palettes are code (each one's
 * contrast is tested), so the set is closed here; the database keeps only
 * the key. Black and gold is Capital Q's brand (founder 2026-10-06) and
 * the platform default; classic blue is the switch back.
 */
export const BRAND_PRESET_KEYS = ["black_gold", "classic_blue"] as const;
export const BrandPresetKeySchema = z.enum(BRAND_PRESET_KEYS);
export type BrandPresetKey = z.infer<typeof BrandPresetKeySchema>;
export const DEFAULT_BRAND_PRESET: BrandPresetKey = "black_gold";

export const BrandThemeDtoSchema = z
  .object({
    /** The preset in effect (the platform default when none was chosen). */
    presetKey: BrandPresetKeySchema,
    /** Null: the preset's own accent. */
    primaryHex: BrandHexSchema.nullable(),
    updatedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
export type BrandThemeDto = z.infer<typeof BrandThemeDtoSchema>;

export const AdminBrandThemeRequestSchema = z
  .object({
    /**
     * The preset to use. Omitted with a null colour: reset to the platform
     * default preset. Omitted with a colour: keep the current preset.
     */
    presetKey: BrandPresetKeySchema.optional(),
    /** Null: the preset's own accent. */
    primaryHex: BrandHexSchema.nullable(),
  })
  .strict();
export type AdminBrandThemeRequest = z.infer<
  typeof AdminBrandThemeRequestSchema
>;
