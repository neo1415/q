import { decodeJsonbString, type DatabaseExecutor } from "@capital-q/database";
import type { FounderPitchSectionsPort } from "@capital-q/founder-onboarding";

/**
 * Lane ob1: founder onboarding's read of lane ov's stored pitch reading
 * (media.pitch_section_readings), composed here because the worker owns
 * both compositions; the onboarding package owns no media data.
 *
 * Only a reading of that company's own pitch, in that tenant, and that
 * company's active founder session: identifiers from the event are
 * re-checked against the database, never trusted.
 */
export function createPitchSectionsPort(
  sql: DatabaseExecutor,
): FounderPitchSectionsPort {
  return {
    read: async (tenantId, readingId, companyId) => {
      const row = (
        await sql<{ sections: unknown }[]>`
          select r.sections
            from media.pitch_section_readings r
            join media.media_assets m
              on m.id = r.media_asset_id and m.tenant_id = r.tenant_id
           where r.id = ${readingId}
             and r.tenant_id = ${tenantId}
             and m.owner_type = 'COMPANY'
             and m.owner_id = ${companyId}
             and m.deleted_at is null
             and m.superseded_at is null`
      )[0];
      if (row === undefined) return null;
      const raw = decodeJsonbString(row.sections);
      const sections = (Array.isArray(raw) ? raw : []).flatMap(
        (section: unknown) => {
          if (typeof section !== "object" || section === null) return [];
          const { key, facts } = section as {
            readonly key?: unknown;
            readonly facts?: unknown;
          };
          if (typeof key !== "string" || !Array.isArray(facts)) return [];
          return [
            {
              key,
              facts: facts.flatMap((fact: unknown) => {
                if (typeof fact !== "object" || fact === null) return [];
                const { label, value } = fact as {
                  readonly label?: unknown;
                  readonly value?: unknown;
                };
                return typeof label === "string" && typeof value === "string"
                  ? [
                      {
                        label: label.slice(0, 200),
                        value: value.slice(0, 1000),
                      },
                    ]
                  : [];
              }),
            },
          ];
        },
      );
      const session = (
        await sql<{ id: string }[]>`
          select s.id
            from onboarding.sessions s
           where s.tenant_id = ${tenantId}
             and s.journey_type = 'founder'
             and s.status = 'ACTIVE'
             and s.subject_type = 'COMPANY'
             and s.subject_id = ${companyId}
           order by s.last_activity_at desc
           limit 1`
      )[0];
      return { sessionId: session?.id ?? null, sections };
    },
  };
}
