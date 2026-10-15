import {
  ApplicationTranscriptTurnDtoSchema,
  type GateqSynthesisV1,
} from "@capital-q/contracts";
import { jsonbParam, type DatabaseExecutor } from "@capital-q/database";

import type {
  PendingSynthesis,
  SynthesisStore,
} from "../application/dossier-synthesis.js";

/**
 * gateq.application_syntheses (migration 20261227203100). Server role only.
 * `from` bounds which submissions are read at all, so switching the job on
 * never spends on the historical backlog; `maxAttempts` bounds the model
 * calls one application can ever cost.
 */
export function createPostgresSynthesisStore(deps: {
  readonly sql: DatabaseExecutor;
  readonly from: Date;
  readonly maxAttempts: number;
  /** A failed attempt waits this long before it is tried again. */
  readonly retryAfterSeconds?: number | undefined;
}): SynthesisStore {
  const { sql } = deps;
  const retry = Math.max(60, deps.retryAfterSeconds ?? 600);
  return {
    pending: async (limit) => {
      const rows = await sql<
        {
          application_id: string;
          tenant_id: string;
          dossier: unknown;
          snapshot: unknown;
          investor_name: string | null;
          gateway_name: string;
        }[]
      >`
        select s.application_id, s.tenant_id, s.dossier, s.snapshot,
               io.display_name as investor_name, g.name as gateway_name
          from gateq.application_submissions s
          join gateq.applications a on a.id = s.application_id and a.tenant_id = s.tenant_id
          join gateq.gateways g on g.id = a.gateway_id and g.tenant_id = a.tenant_id
          left join core.investor_organisations io
                 on io.id = g.investor_organisation_id and io.tenant_id = g.tenant_id
          left join gateq.application_syntheses y on y.application_id = s.application_id
         where s.dossier is not null
           and s.submitted_at >= ${deps.from}
           and (y.application_id is null
                or (y.status = 'FAILED' and y.attempts < ${deps.maxAttempts}
                    and y.updated_at < now() - make_interval(secs => ${retry})))
         order by s.submitted_at
         limit ${Math.max(1, Math.min(10, limit))}`;
      return rows.map((row): PendingSynthesis => ({
        applicationId: row.application_id,
        tenantId: row.tenant_id,
        investorName: row.investor_name ?? row.gateway_name,
        dossier: row.dossier,
        transcript: transcriptOf(row.snapshot),
      }));
    },

    claim: async (input) => {
      const rows = await sql<{ attempts: number }[]>`
        insert into gateq.application_syntheses (application_id, tenant_id, status, attempts)
        values (${input.applicationId}, ${input.tenantId}, 'FAILED', 1)
        on conflict (application_id) do update
           set attempts = gateq.application_syntheses.attempts + 1,
               updated_at = now()
         where gateq.application_syntheses.status = 'FAILED'
           and gateq.application_syntheses.tenant_id = ${input.tenantId}
           and gateq.application_syntheses.attempts < ${deps.maxAttempts}
           and gateq.application_syntheses.updated_at < now() - make_interval(secs => ${retry})
        returning attempts`;
      return rows.length === 1;
    },

    ready: async (input: {
      readonly applicationId: string;
      readonly synthesis: GateqSynthesisV1;
      readonly promptVersion: string;
    }) => {
      await sql`
        update gateq.application_syntheses
           set status = 'READY', synthesis = ${jsonbParam(sql, input.synthesis)},
               prompt_version = ${input.promptVersion}, updated_at = now()
         where application_id = ${input.applicationId} and status = 'FAILED'`;
    },
  };
}

function transcriptOf(snapshot: unknown) {
  if (typeof snapshot !== "object" || snapshot === null) return [];
  const turns = (snapshot as { readonly transcript?: unknown }).transcript;
  if (!Array.isArray(turns)) return [];
  return turns.flatMap((turn: unknown) => {
    const parsed = ApplicationTranscriptTurnDtoSchema.safeParse(turn);
    return parsed.success ? [parsed.data] : [];
  });
}
