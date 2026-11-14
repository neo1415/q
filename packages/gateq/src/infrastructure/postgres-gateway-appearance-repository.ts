import type { DatabaseExecutor } from "@capital-q/database";

import type {
  GatewayAppearance,
  GatewayAppearanceRepository,
} from "../application/appearance.js";

/**
 * `gateq.gateway_appearances` (B6/B7): append-only revisions; the newest
 * is the gateway's appearance. The table's own checks hold the colour and
 * origin spellings and its trigger refuses any rewrite.
 */

type Row = {
  readonly gateway_id: string;
  readonly revision: number;
  readonly accent_hex: string | null;
  readonly embed_origins: readonly string[] | null;
  readonly created_at: Date | string;
};

const toAppearance = (row: Row): GatewayAppearance => ({
  gatewayId: row.gateway_id,
  revision: Number(row.revision),
  accentHex: row.accent_hex,
  embedOrigins: [...(row.embed_origins ?? [])],
  updatedAt:
    row.created_at instanceof Date
      ? row.created_at.toISOString()
      : new Date(row.created_at).toISOString(),
});

export function createPostgresGatewayAppearanceRepository(options: {
  readonly sql: DatabaseExecutor;
}): GatewayAppearanceRepository {
  const { sql } = options;
  return {
    current: async (gatewayId) => {
      const rows = await sql<Row[]>`
        select gateway_id, revision, accent_hex, embed_origins, created_at
          from gateq.gateway_appearances
         where gateway_id = ${gatewayId}
         order by revision desc
         limit 1`;
      const row = rows[0];
      return row === undefined ? null : toAppearance(row);
    },

    append: async (tx, input) => {
      // The gateway row's lock serialises revisions for one gateway.
      await tx.sql`
        select 1 from gateq.gateways where id = ${input.gatewayId} for update`;
      const rows = await tx.sql<Row[]>`
        insert into gateq.gateway_appearances (
          gateway_id, tenant_id, revision, accent_hex, embed_origins,
          created_by_user_id
        )
        select ${input.gatewayId}, ${input.tenantId},
               coalesce(max(revision), 0) + 1,
               ${input.accentHex}, ${[...input.embedOrigins]}::text[],
               ${input.userId}
          from gateq.gateway_appearances
         where gateway_id = ${input.gatewayId}
        returning gateway_id, revision, accent_hex, embed_origins, created_at`;
      const row = rows[0];
      if (row === undefined) {
        throw new Error("gateway appearance insert returned nothing");
      }
      return toAppearance(row);
    },
  };
}
