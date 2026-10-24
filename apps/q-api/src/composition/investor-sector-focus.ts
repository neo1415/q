import type { CompanyQualificationProjectionPort } from "@capital-q/gateq";
import type { PublicIdentityService } from "@capital-q/public-identity";
import type { InvestorSectorFocusPort, SectorRef } from "@capital-q/q-tools";
import type { ActorContext } from "@capital-q/security";
import {
  normalizeTaxonomyAlias,
  REFERENCE_TAXONOMY,
  type ReferenceNode,
} from "@capital-q/taxonomy";

/**
 * Owner 2026-10-23: the sectors an investor PUBLISHES, as a founder may
 * see them, beside the founder's own company's declared sectors, so "which
 * investors should I talk to first?" weighs sector honestly (Maji Loop,
 * water, was told a fintech fund fits).
 *
 * Context Firewall: an investor's sectors are read only from their Q Card
 * as the PARTICIPANT audience sees it (`cardForSubject`, the same
 * projection `/@handle` shows a signed-in participant): a field the
 * investor did not put on their card for that audience is not there, and
 * their mandate is never read. The company's sectors are its own declared
 * classifications (the projection GateQ qualifies against), for its own
 * founder only.
 */

const INDUSTRY = "industry";

const industry = REFERENCE_TAXONOMY.nodes.filter(
  (node) => node.vocabularyCode === INDUSTRY,
);
const nodeById = new Map(industry.map((node) => [node.id, node]));
const nodeByWords = (() => {
  const map = new Map<string, ReferenceNode>();
  const add = (words: string, node: ReferenceNode) => {
    const key = normalizeTaxonomyAlias(words);
    if (key.length > 0 && !map.has(key)) map.set(key, node);
  };
  for (const node of industry) {
    add(node.displayName, node);
    add(node.canonicalCode.replace(/_/gu, " "), node);
  }
  for (const alias of REFERENCE_TAXONOMY.aliases) {
    const node = nodeById.get(alias.nodeId);
    if (node !== undefined) add(alias.alias, node);
  }
  return map;
})();

function refOf(node: ReferenceNode): SectorRef {
  return {
    code: node.canonicalCode,
    name: node.displayName,
    parent: node.parentCode,
  };
}

/** Sector names onto the taxonomy; a name it does not know keeps code null. */
export function resolveSectors(names: readonly string[]): SectorRef[] {
  return names
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .map((name) => {
      const node = nodeByWords.get(normalizeTaxonomyAlias(name));
      return node === undefined
        ? { code: null, name, parent: null }
        : refOf(node);
    });
}

/** A card's mandateSectors value: the active mandate's names, "; "-separated. */
function cardSectors(value: string | undefined): string[] {
  return value === undefined ? [] : value.split(/;\s*/u);
}

/** Card reads in flight at once (each is its own few queries). */
const CARD_READS_AT_ONCE = 8;

async function inBatches<T, R>(
  items: readonly T[],
  size: number,
  read: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let at = 0; at < items.length; at += size) {
    out.push(...(await Promise.all(items.slice(at, at + size).map(read))));
  }
  return out;
}

export function createInvestorSectorFocusPort(dependencies: {
  /** The actor's own company, resolved by the server (never the model). */
  readonly ownCompany: (actor: ActorContext) => Promise<string | null>;
  readonly projection: CompanyQualificationProjectionPort;
  readonly cards: Pick<PublicIdentityService, "cardForSubject">;
}): InvestorSectorFocusPort {
  return {
    resolve: resolveSectors,
    forOwnCompany: async (actor, companyId, investorOrganisationIds) => {
      const own = await dependencies.ownCompany(actor).catch(() => null);
      if (own === null || own.toLowerCase() !== companyId.toLowerCase()) {
        return { company: [], investors: [] };
      }
      const projection = await dependencies.projection
        .projectionFor({ tenantId: actor.tenantId, companyId: own })
        .catch(() => null);
      const company = (projection?.classifications ?? [])
        .filter((one) => one.vocabularyCode === INDUSTRY)
        .map((one) => nodeById.get(one.nodeId))
        .filter((node): node is ReferenceNode => node !== undefined)
        .map(refOf);
      // QO-31: up to the whole candidate set is asked about, so the cards
      // are read a few at a time, never all at once against the pool.
      const investors = await inBatches(
        investorOrganisationIds,
        CARD_READS_AT_ONCE,
        async (investorOrganisationId) => {
          const card = await dependencies.cards
            .cardForSubject({
              subject: {
                subjectType: "INVESTOR_ORGANISATION",
                subjectId: investorOrganisationId,
              },
              audience: "PARTICIPANT",
            })
            .catch(() => null);
          const field = card?.fields.find(
            (one) => one.key === "mandateSectors",
          );
          return {
            investorOrganisationId,
            sectors: resolveSectors(cardSectors(field?.value)),
          };
        },
      );
      return {
        company,
        investors: investors.filter((one) => one.sectors.length > 0),
      };
    },
  };
}
