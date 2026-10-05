import { jsonbParam, type DatabaseExecutor } from "@capital-q/database";

import type { PolicyExtractionRepository } from "../application/policy-extraction.js";

/**
 * `gateq.policy_extractions`: provenance of a mandate read into draft
 * criteria. A digest of the text, never the text. Idempotent on
 * (gateway, client request): a retry returns the first row's id.
 */
export function createPostgresPolicyExtractionRepository(options: {
  readonly sql: DatabaseExecutor;
}): PolicyExtractionRepository {
  const { sql } = options;
  return {
    record: async (input) => {
      const inserted = await sql<{ id: string }[]>`
        insert into gateq.policy_extractions (
          tenant_id, gateway_id, source_kind, source_sha256, source_chars,
          reader_version, proposals, not_found, client_request_id,
          created_by_user_id
        ) values (
          ${input.tenantId}, ${input.gatewayId}, ${input.sourceKind},
          ${input.sourceSha256}, ${input.sourceChars}, ${input.readerVersion},
          ${jsonbParam(sql, input.proposals)}, ${[...input.notFound]},
          ${input.clientRequestId}, ${input.createdByUserId}
        )
        on conflict (gateway_id, client_request_id) do nothing
        returning id`;
      const first = inserted[0];
      if (first !== undefined) return { id: first.id, deduplicated: false };
      const existing = await sql<{ id: string }[]>`
        select id from gateq.policy_extractions
         where gateway_id = ${input.gatewayId}
           and tenant_id = ${input.tenantId}
           and client_request_id = ${input.clientRequestId}`;
      const row = existing[0];
      if (row === undefined) {
        throw new Error("policy extraction conflict without a row");
      }
      return { id: row.id, deduplicated: true };
    },
  };
}
