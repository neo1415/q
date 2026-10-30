import type { DatabaseExecutor } from "@capital-q/database";
import type { OwnFinancialFigure } from "@capital-q/q-tools";
import type { ActorContext } from "@capital-q/security";

import { toldStatement } from "./workforce/plan-figures.js";

/**
 * Q-page sweep 2026-10-29 (F06): the founder's own financial figures for
 * their own financial model (make_spreadsheet OWN_FINANCIAL_MODEL).
 *
 * The same rows plan-figures.ts reads, under the same ownership rule: the
 * asker's active organisation owns the company, in their tenant, or
 * nothing is read. What they told Q (q_knowledge USER_CLAIM,
 * founder_private, financial.*), including figures they confirmed from
 * their own document, newest first.
 *
 * Owner decision 2026-10-28: a figure stored CONFIDENTIAL is their own
 * claim, which Q may show back to them. A row stored above it is outside
 * every firewall plan: it leaves this read as held back, with its measure
 * only -- its statement and value never leave this read.
 */
const FIGURES_MAX = 24;

export function createOwnFinancialsRead(sql: DatabaseExecutor) {
  return async (
    actor: ActorContext,
    companyId: string,
  ): Promise<readonly OwnFinancialFigure[]> => {
    if (actor.organisationId === undefined || actor.actorType !== "HUMAN") {
      return [];
    }
    const own = await sql<{ id: string }[]>`
      select c.id from core.companies c
       where c.tenant_id = ${actor.tenantId}
         and c.id = ${companyId}::uuid
         and c.organisation_id = ${actor.organisationId}`;
    if (own.length === 0) return [];
    const rows = await sql<
      {
        knowledge_key: string;
        statement: string;
        structured_value: Record<string, unknown> | null;
        sensitivity_class: string;
        recorded_at: Date | string | null;
      }[]
    >`
      select o.knowledge_key, o.statement, o.structured_value,
             o.sensitivity_class::text as sensitivity_class, o.recorded_at
        from q_knowledge.objects o
       where o.tenant_id = ${actor.tenantId}
         and o.subject_type = 'COMPANY'
         and o.subject_id = ${companyId}::uuid
         and o.status = 'ACTIVE'
         and o.truth_class = 'USER_CLAIM'
         and o.visibility_scope = 'founder_private'
         and o.knowledge_key like 'financial.%'
       order by o.recorded_at desc
       limit ${FIGURES_MAX}`;
    return rows.map((row) => toOwnFinancialFigure(row));
  };
}

/** One row as the builder may see it; held back carries no words or value. */
export function toOwnFinancialFigure(row: {
  readonly knowledge_key: string;
  readonly statement: string;
  readonly structured_value: Record<string, unknown> | null;
  readonly sensitivity_class: string;
  readonly recorded_at: Date | string | null;
}): OwnFinancialFigure {
  const at =
    row.recorded_at === null
      ? null
      : row.recorded_at instanceof Date
        ? row.recorded_at
        : new Date(row.recorded_at);
  const asOf =
    at !== null && Number.isFinite(at.getTime())
      ? at.toISOString().slice(0, 10)
      : null;
  if (row.sensitivity_class !== "CONFIDENTIAL") {
    return {
      key: row.knowledge_key,
      heldBack: true,
      statement: null,
      value: null,
      asOf,
    };
  }
  return {
    key: row.knowledge_key,
    heldBack: false,
    statement: toldStatement(row.statement).slice(0, 600),
    value: row.structured_value,
    asOf,
  };
}
