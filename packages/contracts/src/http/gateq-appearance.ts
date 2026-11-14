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

export const GATEQ_EMBED_ORIGINS_MAX = 10;

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
  })
  .strict();
export type GatewayAppearanceDto = z.infer<typeof GatewayAppearanceDtoSchema>;

export const GatewayStatusRequestSchema = z
  .object({ status: z.enum(["ACTIVE", "DISABLED"]) })
  .strict();
export type GatewayStatusRequest = z.infer<typeof GatewayStatusRequestSchema>;
