import {
  parseStartupDescription,
  type StartupAlertDto,
  type StartupAlertRequest,
} from "@capital-q/contracts";
import { jsonbParam, type DatabaseExecutor } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

/**
 * F3: an investor's "Find a startup" search, saved as an alert. What is kept
 * is their own words and the deterministic reading of them; a saved search
 * is never a mandate and never rewrites the declared one. Telling them
 * about new matches belongs to the mandate watcher (J1), which reads these
 * rows; nothing here sends anything.
 */
export function createStartupAlerts(options: {
  readonly sql: DatabaseExecutor;
}) {
  const { sql } = options;
  return {
    save: async (
      actor: ActorContext,
      input: StartupAlertRequest,
    ): Promise<StartupAlertDto | null> => {
      // An alert belongs to the organisation the person acts for.
      if (actor.organisationId === undefined) return null;
      const parsed = parseStartupDescription(input.description);
      const inserted = await sql<{ id: string }[]>`
        insert into gateq.startup_alerts
          (tenant_id, organisation_id, user_id, description, filters, client_request_id)
        values (${actor.tenantId}, ${actor.organisationId}, ${actor.userId}, ${input.description},
                ${jsonbParam(sql, { ...parsed.filters, words: parsed.words })}, ${input.clientRequestId})
        on conflict (user_id, client_request_id) do nothing
        returning id`;
      const created = inserted[0];
      if (created !== undefined)
        return { alertId: created.id, deduplicated: false };
      const existing = await sql<{ id: string }[]>`
        select id from gateq.startup_alerts
         where user_id = ${actor.userId} and client_request_id = ${input.clientRequestId}`;
      const found = existing[0];
      return found === undefined
        ? null
        : { alertId: found.id, deduplicated: true };
    },
  };
}

export type StartupAlerts = ReturnType<typeof createStartupAlerts>;
