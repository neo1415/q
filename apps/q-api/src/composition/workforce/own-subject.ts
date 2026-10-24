import type { DatabaseExecutor } from "@capital-q/database";
import { countryName } from "@capital-q/q-research";
import type { ActorContext } from "@capital-q/security";

/**
 * Live 2026-10-24 (job b78d7bf9, founder.maji-loop): "Write me a short
 * 12-month growth plan for my company" names no company, so deep research
 * planned for nothing in particular -- "company market industry segments
 * 2026", US service-pricing guides -- and 9 of 16 questions had nothing
 * safe to send. The plan then said the evidence did not cover Kenya's
 * water market.
 *
 * A founder may have Q search for their own company by its name and
 * country (research-public-web.ts, founder report 2026-10-05): those are
 * their own facts. Its declared sectors are Capital Q's taxonomy labels,
 * reference words, and its own one-paragraph description (what it does)
 * is the founder's own words about it: taxonomy labels alone said "Clean
 * Energy" for a water-kiosk company. Figures in it never leave (egress
 * drops them); nothing else -- documents, customers, the record's claims
 * -- is read here.
 */
export type OwnResearchSubject = {
  readonly name: string;
  readonly country: string | null;
  readonly sectors: readonly string[];
  /** Its own description, bounded: what it does. */
  readonly description: string | null;
};

export function createOwnResearchSubject(sql: DatabaseExecutor) {
  return async (actor: ActorContext): Promise<OwnResearchSubject | null> => {
    if (actor.organisationId === undefined) return null;
    const rows = await sql<
      {
        readonly name: string;
        readonly country: string | null;
        readonly sectors: string[] | null;
        readonly description: string | null;
      }[]
    >`
      select c.canonical_name as name, c.headquarters_country as country,
             left(c.primary_description, 600) as description,
             array(
               select n.display_name
                 from taxonomy.entity_assignments a
                 join taxonomy.nodes n on n.id = a.node_id
                where a.entity_type = 'COMPANY'
                  and a.entity_id = c.id
                  and a.tenant_id = c.tenant_id
                  and a.status = 'ACTIVE'
                order by n.display_name
                limit 6) as sectors
        from core.companies c
       where c.tenant_id = ${actor.tenantId}
         and c.organisation_id = ${actor.organisationId}
       order by c.created_at
       limit 1`;
    const row = rows[0];
    if (row === undefined) return null;
    return {
      name: row.name,
      country: row.country,
      sectors: (row.sectors ?? []).filter((one) => one.trim().length > 0),
      description:
        row.description === null || row.description.trim().length === 0
          ? null
          : row.description.trim(),
    };
  };
}

/** The subject as the research planner reads it, and as egress may send it. */
export function subjectLines(subject: OwnResearchSubject | null): {
  readonly text: string;
  readonly terms: readonly string[];
} {
  if (subject === null)
    return { text: "Only what the request itself says.", terms: [] };
  const country =
    subject.country === null ? null : (countryName(subject.country) ?? null);
  const where = country === null ? "" : ` (${country})`;
  const sectors =
    subject.sectors.length === 0
      ? ""
      : `; its market, as declared: ${subject.sectors.join(", ")}`;
  const does =
    subject.description === null
      ? ""
      : ` What it does, in its own words: ${subject.description.slice(0, 600)}`;
  return {
    text: `When the request is about their own company: ${subject.name}${where}${sectors}.${does} Research its market, competitors and context, not companies in general.`,
    terms: [
      subject.name,
      country ?? "",
      ...subject.sectors,
      subject.description ?? "",
    ].filter((one) => one.length > 0),
  };
}
