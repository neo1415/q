import { z } from "zod";

import type { DatabaseExecutor } from "@capital-q/database";
import {
  FINANCIAL_MEASURE_KEYS,
  type FigurePeriod,
} from "@capital-q/founder-onboarding";
import type { ActorContext } from "@capital-q/security";

import {
  matchConfirmedFigures,
  type ConfirmedFigure,
  type DeckStatedFigure,
} from "./workforce/confirmed-figures.js";

/**
 * Owner decision 2026-10-28: what Q may know about the key figures of a
 * founder's highly confidential financial document. Never its content:
 *
 *   pending    how many figures Capital Q's code read from it that wait
 *              for the founder's confirmation (a count; the values stay
 *              off every model path until they are confirmed)
 *   confirmed  the founder's own claims from it (USER_CLAIM, SELF_REPORTED,
 *              founder_private), each set against their deck by code
 *
 * Read for the actor's own company only (their active organisation owns
 * it), in their tenant, from their own onboarding session.
 */

export type DocumentFigures = {
  readonly pending: number;
  readonly confirmed: readonly string[];
};

const StructuredSchema = z
  .object({
    origin: z.literal("DOCUMENT_FIGURE"),
    kind: z.enum(["MONEY", "PERCENTAGE", "DURATION"]),
    amount: z.string().regex(/^\d+(?:\.\d+)?$/u).optional(),
    currency: z.string().regex(/^[A-Z]{3}$/u).optional(),
    value: z.string().regex(/^-?\d+(?:\.\d+)?$/u).optional(),
    measure: z.enum(FINANCIAL_MEASURE_KEYS),
    periodGranularity: z.enum(["MONTH", "QUARTER", "YEAR"]),
    period: z.string().regex(/^\d{4}(?:-\d{2}|-Q[1-4])?$/u),
    asOf: z.string().optional(),
    documentId: z.string().uuid().optional(),
    where: z.string().max(80).optional(),
    confirmation: z.enum(["KEPT", "EDITED"]).optional(),
  })
  .passthrough();

const DeckFactSchema = z
  .object({
    kind: z.string(),
    label: z.string().max(120),
    value: z.string().max(300).nullable(),
    asOf: z.string().max(80).nullable().optional(),
    pages: z.array(z.number().int()).max(12).optional(),
  })
  .passthrough();
const DeckSectionSchema = z
  .object({ section: z.string().max(40), facts: z.array(z.unknown()).max(8) })
  .passthrough();

function confirmedOf(
  row: { readonly structured_value: unknown },
  titles: ReadonlyMap<string, string>,
): ConfirmedFigure | null {
  const parsed = StructuredSchema.safeParse(row.structured_value);
  if (!parsed.success) return null;
  const v = parsed.data;
  const period: FigurePeriod = {
    granularity: v.periodGranularity,
    key: v.period,
    asOf: v.asOf !== undefined && /^\d{4}-\d{2}-\d{2}$/u.test(v.asOf) ? v.asOf : null,
    label: v.period,
  };
  const value: ConfirmedFigure["value"] | null =
    v.kind === "MONEY"
      ? v.amount === undefined || v.currency === undefined
        ? null
        : { kind: "MONEY", amount: v.amount, currency: v.currency }
      : v.value === undefined
        ? null
        : { kind: v.kind === "PERCENTAGE" ? "PERCENT" : "MONTHS", value: v.value };
  if (value === null) return null;
  const title =
    v.documentId === undefined ? undefined : titles.get(v.documentId);
  return {
    measure: v.measure,
    period,
    value,
    documentId: v.documentId ?? null,
    source: `your financial document${title === undefined ? "" : ` “${title.slice(0, 80)}”`}${v.where === undefined ? "" : `, ${v.where}`}`,
    confirmation: v.confirmation ?? "KEPT",
  };
}

function deckFiguresOf(
  sections: unknown,
  confirmed: boolean,
): DeckStatedFigure[] {
  const parsed = z.array(DeckSectionSchema).max(12).safeParse(sections);
  if (!parsed.success) return [];
  const out: DeckStatedFigure[] = [];
  for (const section of parsed.data) {
    for (const raw of section.facts) {
      const fact = DeckFactSchema.safeParse(raw);
      if (!fact.success || fact.data.kind !== "FIGURE") continue;
      out.push({
        section: section.section,
        label: fact.data.label,
        value: fact.data.value,
        asOf: fact.data.asOf ?? null,
        pages: fact.data.pages ?? [],
        confirmed,
      });
    }
  }
  return out.slice(0, 80);
}

export function createLocalFigureStatus(sql: DatabaseExecutor) {
  return async (
    actor: ActorContext,
    companyId: string,
  ): Promise<ReadonlyMap<string, DocumentFigures>> => {
    const empty = new Map<string, DocumentFigures>();
    if (actor.organisationId === undefined) return empty;
    // Their own company: the one their active organisation owns.
    const own = await sql<{ id: string }[]>`
      select c.id from core.companies c
       where c.tenant_id = ${actor.tenantId}
         and c.id = ${companyId}::uuid
         and c.organisation_id = ${actor.organisationId}`;
    if (own.length === 0) return empty;

    const [pending, objects, decks] = await Promise.all([
      sql<{ document_id: string; pending: number }[]>`
        select r.ref ->> 'sourceId' as document_id, count(*)::int as pending
          from onboarding.suggestions g
          join onboarding.sessions s on s.id = g.session_id
          cross join lateral jsonb_array_elements(g.source_refs) as r(ref)
         where s.user_id = ${actor.userId}
           and s.tenant_id = ${actor.tenantId}
           and s.subject_id = ${companyId}::uuid
           and g.status = 'PENDING'
           and g.source_refs @> '[{"sourceType":"LOCAL_FIGURE"}]'::jsonb
           and r.ref ->> 'sourceType' = 'EVIDENCE_DOCUMENT'
         group by 1`.catch(() => []),
      sql<{ structured_value: unknown }[]>`
        select o.structured_value
          from q_knowledge.objects o
         where o.tenant_id = ${actor.tenantId}
           and o.subject_type = 'COMPANY'
           and o.subject_id = ${companyId}::uuid
           and o.status = 'ACTIVE'
           and o.truth_class = 'USER_CLAIM'
           and o.structured_value ->> 'origin' = 'DOCUMENT_FIGURE'
         order by o.recorded_at desc
         limit 20`.catch(() => []),
      // The founder-confirmed reading first; else Q's latest reading of
      // their deck, labelled as not yet confirmed.
      sql<{ sections: unknown; confirmed: boolean }[]>`
        select e.sections,
               exists (select 1 from evidence.deck_extraction_confirmations c
                        where c.extraction_id = e.id and c.tenant_id = e.tenant_id) as confirmed
          from evidence.deck_extractions e
         where e.tenant_id = ${actor.tenantId}
           and e.company_id = ${companyId}::uuid
         order by confirmed desc, e.created_at desc
         limit 1`.catch(() => []),
    ]);

    const documentIds = [
      ...new Set(
        objects.flatMap((row) => {
          const id = StructuredSchema.safeParse(row.structured_value);
          return id.success && id.data.documentId !== undefined
            ? [id.data.documentId]
            : [];
        }),
      ),
    ];
    const titles = new Map(
      documentIds.length === 0
        ? []
        : (
            await sql<{ id: string; title: string }[]>`
              select d.id, d.title from evidence.documents d
               where d.tenant_id = ${actor.tenantId}
                 and d.company_id = ${companyId}::uuid
                 and d.id = any(${documentIds}::uuid[])`.catch(() => [])
          ).map((row) => [row.id, row.title] as const),
    );
    const confirmed = objects
      .map((row) => confirmedOf(row, titles))
      .filter((figure): figure is ConfirmedFigure => figure !== null);
    const deck = decks[0];
    const rows = matchConfirmedFigures(
      confirmed,
      deck === undefined ? [] : deckFiguresOf(deck.sections, deck.confirmed),
    );

    const out = new Map<string, { pending: number; confirmed: string[] }>();
    const entry = (id: string) => {
      const held = out.get(id) ?? { pending: 0, confirmed: [] };
      out.set(id, held);
      return held;
    };
    for (const row of pending) entry(row.document_id).pending = row.pending;
    for (const row of rows) {
      if (row.documentId !== null) entry(row.documentId).confirmed.push(row.line);
    }
    return out;
  };
}
