import { createHash } from "node:crypto";

import type { DatabaseExecutor } from "@capital-q/database";

import type {
  GatewayAppearance,
  GatewayAppearanceRepository,
  GatewayLogoAssetRepository,
  GatewayLogoRef,
} from "../application/appearance.js";

/**
 * `gateq.gateway_appearances` (B6/B7): append-only revisions; the newest
 * is the gateway's appearance. The table's own checks hold the colour and
 * origin spellings and its trigger refuses any rewrite. Brand from website
 * (20261231580000) adds the display name and the logo, whose foreign key
 * names the gateway too, so a revision only ever points at its own logo.
 */

type Row = {
  readonly gateway_id: string;
  readonly revision: number;
  readonly accent_hex: string | null;
  readonly embed_origins: readonly string[] | null;
  readonly display_name: string | null;
  readonly logo_asset_id: string | null;
  readonly logo_kind: string | null;
  readonly created_at: Date | string;
};

const kindOf = (kind: string | null): GatewayLogoRef["kind"] =>
  kind === "ICON" ? "ICON" : "LOGO";

const toAppearance = (row: Row): GatewayAppearance => ({
  gatewayId: row.gateway_id,
  revision: Number(row.revision),
  accentHex: row.accent_hex,
  embedOrigins: [...(row.embed_origins ?? [])],
  updatedAt:
    row.created_at instanceof Date
      ? row.created_at.toISOString()
      : new Date(row.created_at).toISOString(),
  displayName: row.display_name,
  logo:
    row.logo_asset_id === null
      ? null
      : { assetId: row.logo_asset_id, kind: kindOf(row.logo_kind) },
});

export function createPostgresGatewayAppearanceRepository(options: {
  readonly sql: DatabaseExecutor;
}): GatewayAppearanceRepository {
  const { sql } = options;
  return {
    current: async (gatewayId) => {
      const rows = await sql<Row[]>`
        select a.gateway_id, a.revision, a.accent_hex, a.embed_origins,
               a.display_name, a.logo_asset_id, l.kind as logo_kind,
               a.created_at
          from gateq.gateway_appearances a
          left join gateq.gateway_logo_assets l on l.id = a.logo_asset_id
         where a.gateway_id = ${gatewayId}
         order by a.revision desc
         limit 1`;
      const row = rows[0];
      return row === undefined ? null : toAppearance(row);
    },

    append: async (tx, input) => {
      // The gateway row's lock serialises revisions for one gateway.
      await tx.sql`
        select 1 from gateq.gateways where id = ${input.gatewayId} for update`;
      const rows = await tx.sql<Row[]>`
        with inserted as (
          insert into gateq.gateway_appearances (
            gateway_id, tenant_id, revision, accent_hex, embed_origins,
            display_name, logo_asset_id, created_by_user_id
          )
          select ${input.gatewayId}, ${input.tenantId},
                 coalesce(max(revision), 0) + 1,
                 ${input.accentHex}, ${[...input.embedOrigins]}::text[],
                 ${input.displayName}, ${input.logoAssetId},
                 ${input.userId}
            from gateq.gateway_appearances
           where gateway_id = ${input.gatewayId}
          returning gateway_id, revision, accent_hex, embed_origins,
                    display_name, logo_asset_id, created_at
        )
        select i.*, l.kind as logo_kind
          from inserted i
          left join gateq.gateway_logo_assets l on l.id = i.logo_asset_id`;
      const row = rows[0];
      if (row === undefined) {
        throw new Error("gateway appearance insert returned nothing");
      }
      return toAppearance(row);
    },
  };
}

type AssetRow = {
  readonly id: string;
  readonly kind: string;
};

/** `gateq.gateway_logo_assets`: logos kept by Capital Q, append-only. */
export function createPostgresGatewayLogoAssetRepository(options: {
  readonly sql: DatabaseExecutor;
}): GatewayLogoAssetRepository {
  const { sql } = options;
  return {
    store: async (tx, input) => {
      const sha256 = createHash("sha256").update(input.bytes).digest("hex");
      // The same image read again is the row already kept.
      const rows = await tx.sql<AssetRow[]>`
        insert into gateq.gateway_logo_assets (
          gateway_id, tenant_id, kind, content_type, bytes, sha256,
          source_url, created_by_user_id
        ) values (
          ${input.gatewayId}, ${input.tenantId}, ${input.kind},
          ${input.contentType}, ${Buffer.from(input.bytes)}, ${sha256},
          ${input.sourceUrl}, ${input.userId}
        )
        on conflict (gateway_id, sha256, kind) do nothing
        returning id, kind`;
      const inserted = rows[0];
      if (inserted !== undefined) {
        return { assetId: inserted.id, kind: kindOf(inserted.kind) };
      }
      const existing = await tx.sql<AssetRow[]>`
        select id, kind from gateq.gateway_logo_assets
         where gateway_id = ${input.gatewayId}
           and sha256 = ${sha256} and kind = ${input.kind}`;
      const row = existing[0];
      if (row === undefined) throw new Error("gateway logo asset not stored");
      return { assetId: row.id, kind: kindOf(row.kind) };
    },

    find: async (gatewayId, assetId) => {
      const rows = await sql<AssetRow[]>`
        select id, kind from gateq.gateway_logo_assets
         where id = ${assetId} and gateway_id = ${gatewayId}`;
      const row = rows[0];
      return row === undefined
        ? null
        : { assetId: row.id, kind: kindOf(row.kind) };
    },

    bytes: async (gatewayId, assetId) => {
      const rows = await sql<
        { readonly content_type: string; readonly bytes: Uint8Array }[]
      >`
        select content_type, bytes from gateq.gateway_logo_assets
         where id = ${assetId} and gateway_id = ${gatewayId}`;
      const row = rows[0];
      if (row === undefined) return null;
      // The table's check allows only these three; the server re-checks
      // the bytes against the type before serving them.
      return {
        contentType:
          row.content_type === "image/svg+xml"
            ? "image/svg+xml"
            : row.content_type === "image/jpeg"
              ? "image/jpeg"
              : "image/png",
        bytes: new Uint8Array(row.bytes),
      };
    },
  };
}
