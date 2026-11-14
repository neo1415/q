import { z } from "zod";

import { UuidSchema } from "../common/ids.js";

import { BrandHexSchema } from "./brand-theme.js";

/**
 * B6 / B7 (2026-11-14): an investor organisation's own gateway, branded,
 * placed and paused by its admins without Capital Q's operators.
 *
 * - GET /v1/gateq/gateways/:gatewayId/appearance  the accent colour and the
 *   sites allowed to frame the embed (any member who may see the gateway).
 * - PUT the same path                              a new revision (an admin:
 *   investor.gateway.publish, the authority over what the public sees).
 * - PUT /v1/gateq/gateways/:gatewayId/status       pause (DISABLED) or
 *   reopen (ACTIVE) the gateway: a paused gateway's public page and embed
 *   answer as if it did not exist; its rules and applications are kept.
 *
 * The colour is lowercase #rrggbb, the one spelling a style element takes;
 * the web derives AA-safe accent tokens from it. Origins are scheme, host
 * and optional port only, because they are written into a
 * Content-Security-Policy header: https, or http://localhost for testing.
 */
export const GATEQ_GATEWAY_APPEARANCE_PATH =
  "/v1/gateq/gateways/:gatewayId/appearance" as const;
export const GATEQ_GATEWAY_STATUS_PATH =
  "/v1/gateq/gateways/:gatewayId/status" as const;

/**
 * Brand from website (owner 2026-11-14): Capital Q reads the organisation's
 * canonical website (only the one on its record) for its name, logo and
 * colours, and the admin corrects what is missing or wrong before saving.
 * POST, because it reads the site and keeps the logo it found in Capital
 * Q's own storage; nothing public changes until the admin saves.
 */
export const GATEQ_GATEWAY_BRAND_SUGGESTION_PATH =
  "/v1/gateq/gateways/:gatewayId/brand-suggestion" as const;
/** The gateway's saved logo bytes, for an open gateway (anonymous). */
export const GATEQ_PUBLIC_GATEWAY_LOGO_PATH =
  "/v1/gateq/public/:publicId/logo" as const;

export const GATEQ_EMBED_ORIGINS_MAX = 10;

/** The name shown on a gateway, when it is not the canonical record's. */
export const GatewayDisplayNameSchema = z.string().trim().min(1).max(120);

export const GatewayLogoKindSchema = z.enum(["LOGO", "ICON"]);
export type GatewayLogoKind = z.infer<typeof GatewayLogoKindSchema>;

export const GatewayLogoRefSchema = z
  .object({ assetId: UuidSchema, kind: GatewayLogoKindSchema })
  .strict();
export type GatewayLogoRef = z.infer<typeof GatewayLogoRefSchema>;

/** One origin: https://host[:port], or http://localhost[:port]. */
export const GatewayEmbedOriginSchema = z
  .string()
  .max(253)
  .regex(
    /^(https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*|http:\/\/localhost)(:[0-9]{1,5})?$/u,
  );

/**
 * What a person typed as a site ("example.com", "https://Example.com/apply")
 * as the origin stored, or null when it is not a site. Lowercased, the
 * path dropped, https assumed when no scheme was given.
 */
export function normaliseEmbedOrigin(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > 300) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.username !== "" || url.password !== "") return null;
  const origin = url.origin.toLowerCase();
  return GatewayEmbedOriginSchema.safeParse(origin).success ? origin : null;
}

export const GatewayEmbedOriginsSchema = z
  .array(GatewayEmbedOriginSchema)
  .max(GATEQ_EMBED_ORIGINS_MAX)
  .refine((origins) => new Set(origins).size === origins.length, {
    message: "Each site is listed once.",
  });

export const GatewayAppearanceRequestSchema = z
  .object({
    /** Null: Capital Q's accent (or the firm's brand theme, if any). */
    accentHex: BrandHexSchema.nullable(),
    embedOrigins: GatewayEmbedOriginsSchema,
    /** Omitted: unchanged. Null: the canonical record's name. */
    displayName: GatewayDisplayNameSchema.nullable().optional(),
    /**
     * Omitted: unchanged. Null: no logo. Otherwise a logo Capital Q stored
     * for this gateway from its website (brand suggestion).
     */
    logoAssetId: UuidSchema.nullable().optional(),
  })
  .strict();
export type GatewayAppearanceRequest = z.infer<
  typeof GatewayAppearanceRequestSchema
>;

export const GatewayAppearanceDtoSchema = z
  .object({
    gatewayId: UuidSchema,
    /** 0: never set (Capital Q's look, any site may frame it). */
    revision: z.number().int().min(0),
    accentHex: BrandHexSchema.nullable(),
    embedOrigins: GatewayEmbedOriginsSchema,
    updatedAt: z.string().nullable(),
    /** Whether this viewer may change it (an admin of the organisation). */
    canChange: z.boolean(),
    /** Null: the canonical record's name is shown. */
    displayName: GatewayDisplayNameSchema.nullable().default(null),
    logo: GatewayLogoRefSchema.nullable().default(null),
  })
  .strict();
export type GatewayAppearanceDto = z.infer<typeof GatewayAppearanceDtoSchema>;

/** Why a field of the brand suggestion was not found, precisely. */
export const GatewayBrandReasonSchema = z.enum([
  "NO_WEBSITE",
  "INVALID_URL",
  "BLOCKED_ADDRESS",
  "OFF_SITE_REDIRECT",
  "DNS_FAILED",
  "TIMEOUT",
  "UNREACHABLE",
  "HTTP_ERROR",
  "TOO_LARGE",
  "TOO_MANY_REDIRECTS",
  "NOT_HTML",
  "NO_NAME",
  "NO_LOGO",
  "UNSUPPORTED_LOGO_FORMAT",
  "NO_COLOURS",
]);
export type GatewayBrandReason = z.infer<typeof GatewayBrandReasonSchema>;

const NotFound = z
  .object({ status: z.literal("NOT_FOUND"), reason: GatewayBrandReasonSchema })
  .strict();

/** A PNG or JPEG preview of the stored logo (at most 512 KB raw). */
const LogoPreviewDataUrl = z
  .string()
  .max(720_000)
  .regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/u);

export const GatewayBrandSuggestionDtoSchema = z
  .object({
    gatewayId: UuidSchema,
    /** The canonical record's website; null: none yet (add it first). */
    websiteUrl: z.string().nullable(),
    /** The canonical record's name, which stays authoritative. */
    canonicalName: z.string(),
    /** The page actually read, after redirects. */
    sourceUrl: z.string().nullable(),
    /** For adding a website to the record when it has none. */
    investorOrganisationId: UuidSchema,
    profileVersion: z.number().int().min(1),
    name: z.discriminatedUnion("status", [
      z
        .object({
          status: z.literal("FOUND"),
          value: GatewayDisplayNameSchema,
          from: z.enum([
            "OG_SITE_NAME",
            "MANIFEST",
            "APPLICATION_NAME",
            "TITLE",
          ]),
        })
        .strict(),
      NotFound,
    ]),
    logo: z.discriminatedUnion("status", [
      z
        .object({
          status: z.literal("FOUND"),
          kind: GatewayLogoKindSchema,
          assetId: UuidSchema,
          sourceUrl: z.string(),
          previewDataUrl: LogoPreviewDataUrl,
        })
        .strict(),
      NotFound,
    ]),
    colours: z.discriminatedUnion("status", [
      z
        .object({
          status: z.literal("FOUND"),
          primary: BrandHexSchema,
          secondary: BrandHexSchema.optional(),
        })
        .strict(),
      NotFound,
    ]),
  })
  .strict();
export type GatewayBrandSuggestionDto = z.infer<
  typeof GatewayBrandSuggestionDtoSchema
>;

export const GatewayBrandSuggestionRequestSchema = z.object({}).strict();

export const GatewayStatusRequestSchema = z
  .object({ status: z.enum(["ACTIVE", "DISABLED"]) })
  .strict();
export type GatewayStatusRequest = z.infer<typeof GatewayStatusRequestSchema>;
