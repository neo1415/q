import type { QSituationFact } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import type { DocumentFigures } from "../local-figures.js";

/**
 * Plan live run 1 (2026-10-29): the founder's own figures in their plan's
 * situation. The founder had told Q their cash (USD 310,000) and burn (USD
 * 65,000); the plan said both were "not established", never mentioned that
 * their September financial report was held back from Q, and never raised
 * that the deck's figure disagreed with the one they confirmed.
 *
 * Three things, for the asker's OWN company only (their active
 * organisation owns it, their tenant), each said as what it is:
 *
 *   told       what they told Q about their own finances (q_knowledge
 *              USER_CLAIM facts, founder_private): their own claims,
 *              SELF_REPORTED, quoted as theirs. Owner decision 2026-10-28
 *              (founder-onboarding financial-claims.ts): a figure the
 *              founder stated or confirmed is their own claim, which Q may
 *              use in their own answers; this plan is personal_private and
 *              never reaches an investor or a ranking.
 *   held back  documents classified highly confidential: by title only,
 *              with how many figures wait for their confirmation -- never
 *              a word of the contents (no model reads them).
 *   confirmed  the figures they confirmed from such a document, each set
 *              against their deck by code (confirmed-figures.ts): both
 *              sides of a contradiction, neither picked.
 */

type RawFact = Omit<QSituationFact, "ref">;

const FIGURES_MAX = 8;

const PROVENANCE = {
  tool: "read_my_record",
  record: null,
  url: null,
} as const;

export type PlanFigureSources = {
  readonly sql: DatabaseExecutor;
  /** createLocalFigureStatus: pending counts and confirmed lines per document. */
  readonly documentFigures: (
    actor: ActorContext,
    companyId: string,
  ) => Promise<ReadonlyMap<string, DocumentFigures>>;
};

const day = (value: Date | string | null): string | null => {
  if (value === null) return null;
  const at = value instanceof Date ? value : new Date(value);
  return Number.isFinite(at.getTime()) ? at.toISOString().slice(0, 10) : null;
};

/** "The founder said cash in the bank is USD 310,000." -> their words, second person. */
export function toldStatement(statement: string): string {
  const said = statement
    .trim()
    .replace(/^the founder said (that )?/iu, "")
    .replace(/[.\s]+$/u, "");
  return `You told Q: ${said}.`;
}

export function createPlanFiguresRead(sources: PlanFigureSources) {
  return async (
    actor: ActorContext,
    companyId: string,
  ): Promise<readonly RawFact[]> => {
    if (actor.organisationId === undefined || actor.actorType !== "HUMAN") {
      return [];
    }
    const own = await sources.sql<{ id: string }[]>`
      select c.id from core.companies c
       where c.tenant_id = ${actor.tenantId}
         and c.id = ${companyId}::uuid
         and c.organisation_id = ${actor.organisationId}`;
    if (own.length === 0) return [];
    const [told, held, figures] = await Promise.all([
      sources.sql<
        {
          knowledge_key: string;
          statement: string;
          recorded_at: Date | string | null;
        }[]
      >`
        select o.knowledge_key, o.statement, o.recorded_at
          from q_knowledge.objects o
         where o.tenant_id = ${actor.tenantId}
           and o.subject_type = 'COMPANY'
           and o.subject_id = ${companyId}::uuid
           and o.status = 'ACTIVE'
           and o.truth_class = 'USER_CLAIM'
           and o.visibility_scope = 'founder_private'
           and o.knowledge_key like 'financial.%'
           and coalesce(o.structured_value ->> 'origin', '') <> 'DOCUMENT_FIGURE'
         order by o.recorded_at desc
         limit ${FIGURES_MAX}`.catch(() => []),
      sources.sql<{ id: string; title: string }[]>`
        select d.id, d.title from evidence.documents d
         where d.tenant_id = ${actor.tenantId}
           and d.company_id = ${companyId}::uuid
           and d.status = 'ACTIVE'
           and d.sensitivity_class in ('HIGHLY_CONFIDENTIAL', 'RESTRICTED')
         order by d.title
         limit 6`.catch(() => []),
      sources.documentFigures(actor, companyId).catch(
        () => new Map<string, DocumentFigures>(),
      ),
    ]);
    const facts: RawFact[] = [];
    // One per measure: the newest thing they said about it.
    const seen = new Set<string>();
    for (const row of told) {
      if (seen.has(row.knowledge_key)) continue;
      seen.add(row.knowledge_key);
      facts.push({
        statement: toldStatement(row.statement).slice(0, 1_000),
        truthClass: "USER_CLAIM",
        evidenceStatus: "SELF_REPORTED",
        asOf: day(row.recorded_at),
        provenance: PROVENANCE,
        label: "founder_private",
        category: null,
      });
    }
    for (const document of held) {
      const status = figures.get(document.id);
      const pending = status?.pending ?? 0;
      facts.push({
        statement: `Your document "${document.title.slice(0, 120)}" is held back from Q by its classification (highly confidential): Q does not read it.${
          pending > 0
            ? ` ${String(pending)} key figure${pending === 1 ? "" : "s"} read from it by code wait for your confirmation on your setup screen; until you confirm, Q does not know them.`
            : (status?.confirmed.length ?? 0) > 0
              ? " The figures you confirmed from it follow."
              : " You can state its key figures yourself (for example monthly revenue and its month), and Q will use them as yours."
        }`,
        truthClass: "UNKNOWN",
        evidenceStatus: "NO_EVIDENCE",
        asOf: null,
        provenance: PROVENANCE,
        label: "founder_private",
        category: null,
      });
      for (const line of status?.confirmed ?? []) {
        facts.push({
          statement: line.slice(0, 1_000),
          truthClass: "USER_CLAIM",
          evidenceStatus: "SELF_REPORTED",
          asOf: null,
          provenance: PROVENANCE,
          label: "founder_private",
          category: null,
        });
      }
    }
    return facts.slice(0, 12);
  };
}
