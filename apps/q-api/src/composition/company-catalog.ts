import { z } from "zod";

import type { DatabaseExecutor } from "@capital-q/database";
import type { CompanyKnowledgePort } from "@capital-q/discovery";
import type { CompanyCatalogPort } from "@capital-q/q-tools";
import { normalizeTaxonomyAlias } from "@capital-q/taxonomy";

/**
 * K1 (founder brief 2026-10-09): companies on the network by declared
 * sector, head-office country and stage, for `discovery.companies`.
 *
 * One catalog read path: candidates come from D's Tier B projection
 * (`CompanyKnowledgePort.discoverCompanies`, listed and discovery-eligible
 * companies only, the viewer checked in the same statement, name order).
 * This only resolves what the reader said into canonical codes -- a
 * sector's code or alias in the industry and product vocabularies, a
 * country's geography node -- and says which sectors the taxonomy does not
 * know. The tool still decides every candidate through disclosure.
 */

const SECTOR_VOCABULARIES = ["industry", "product_category"];

const NodeRow = z.object({
  canonical_code: z.string(),
  display_name: z.string(),
  asked: z.string(),
});

const GeographyRow = z.object({ canonical_code: z.string() });

export function createPostgresCompanyCatalog(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly knowledge: CompanyKnowledgePort;
}): CompanyCatalogPort {
  const { sql, knowledge } = dependencies;
  return {
    find: async (actor, query) => {
      const aliases = [
        ...new Set(
          query.sectors
            .map((sector) => normalizeTaxonomyAlias(sector.replace(/_/gu, " ")))
            .filter((sector) => sector.length > 0),
        ),
      ];
      const codes = query.sectors.map((sector) =>
        sector
          .trim()
          .toLowerCase()
          .replace(/[\s-]+/gu, "_"),
      );
      const [nodes, geographies] = await Promise.all([
        query.sectors.length === 0
          ? Promise.resolve([])
          : sql`
              select distinct n.canonical_code, n.display_name,
                     coalesce(case when n.canonical_code = any(${codes}::text[])
                                   then n.canonical_code end,
                              a.normalized_alias) as asked
                from taxonomy.nodes n
                join taxonomy.vocabularies v on v.id = n.vocabulary_id
                left join taxonomy.aliases a
                  on a.node_id = n.id and a.normalized_alias = any(${aliases}::text[])
               where v.code = any(${SECTOR_VOCABULARIES}::text[])
                 and n.status = 'ACTIVE'
                 and (n.canonical_code = any(${codes}::text[]) or a.id is not null)`.then(
              (rows) => rows.map((row) => NodeRow.parse(row)),
            ),
        query.countries.length === 0
          ? Promise.resolve([])
          : sql`
              select n.canonical_code
                from taxonomy.nodes n
                join taxonomy.vocabularies v on v.id = n.vocabulary_id
               where v.code = 'geography' and n.status = 'ACTIVE'
                 and n.metadata ->> 'iso3166Alpha2' = any(${[...query.countries]}::text[])`.then(
              (rows) => rows.map((row) => GeographyRow.parse(row)),
            ),
      ]);
      const known = new Set(nodes.map((node) => node.asked));
      const unknownSectors = query.sectors.filter((sector, index) => {
        const alias = normalizeTaxonomyAlias(sector.replace(/_/gu, " "));
        return !known.has(codes[index] ?? "") && !known.has(alias);
      });
      const sectors = [
        ...new Map(
          nodes.map((node) => [
            node.canonical_code,
            { code: node.canonical_code, name: node.display_name },
          ]),
        ).values(),
      ];
      // Every sector or every country asked for unknown: nothing matches.
      if (
        (query.sectors.length > 0 && sectors.length === 0) ||
        (query.countries.length > 0 && geographies.length === 0)
      ) {
        return { candidates: [], sectors, unknownSectors };
      }
      const companies = await knowledge.discoverCompanies(actor, {
        sectorCodes: sectors.map((sector) => sector.code),
        geographyCodes: geographies.map(
          (geography) => geography.canonical_code,
        ),
        stageCodes: [...query.stages],
        limit: query.limit,
      });
      const named = new Map(sectors.map((s) => [s.code, s.name]));
      return {
        candidates: companies.map((company) => ({
          companyId: company.companyId,
          name: company.name,
          stageCode: company.stageCode,
          headquartersCountry: company.countryCode,
          shortDescription: company.shortDescription,
          // The asked sectors this company is declared in (a sector's
          // codes carry its ancestors, so a payments company is fintech).
          sectors: company.sectorCodes.flatMap((code) => {
            const name = named.get(code);
            return name === undefined ? [] : [name];
          }),
        })),
        sectors,
        unknownSectors,
      };
    },
  };
}
