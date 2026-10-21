import "server-only";

import {
  getDiscoveredInvestor,
  getDiscoveredInvestorCard,
  getInvestorGates,
  type ApiSession,
} from "@capital-q/api-client";
import {
  GATEQ_INVESTOR_GATES_MAX,
  type DiscoveredInvestorProfileDto,
  type InvestorGateFitDto,
  type PublicCardDto,
} from "@capital-q/contracts";

/**
 * A founder's reads of investors (ADR 0023), each under the founder's own
 * session and each the API's own visibility decision: the declared
 * profile, the investor's Q Card as a participant reads it, and their
 * published gate with the founder's standing. An investor this founder may
 * not see answers nothing (the same 404), which reads here as null. A read
 * that fails is null too: a page shows "not known", never a guess.
 */

/** The most investors one page asks about at once. */
export const INVESTOR_READS_MAX = 50;

export async function investorCards(
  session: ApiSession,
  ids: readonly string[],
): Promise<ReadonlyMap<string, PublicCardDto | null>> {
  const unique = [...new Set(ids)].slice(0, INVESTOR_READS_MAX);
  const read = await Promise.all(
    unique.map((id) =>
      getDiscoveredInvestorCard(session, id)
        .then((answer) => answer.card)
        .catch(() => null),
    ),
  );
  return new Map(unique.map((id, at) => [id, read[at] ?? null]));
}

export async function investorProfiles(
  session: ApiSession,
  ids: readonly string[],
): Promise<ReadonlyMap<string, DiscoveredInvestorProfileDto | null>> {
  const unique = [...new Set(ids)].slice(0, INVESTOR_READS_MAX);
  const read = await Promise.all(
    unique.map((id) => getDiscoveredInvestor(session, id).catch(() => null)),
  );
  return new Map(unique.map((id, at) => [id, read[at] ?? null]));
}

export async function investorGates(
  session: ApiSession,
  ids: readonly string[],
): Promise<ReadonlyMap<string, InvestorGateFitDto>> {
  const unique = [...new Set(ids)].slice(0, GATEQ_INVESTOR_GATES_MAX);
  if (unique.length === 0) return new Map();
  const found = await getInvestorGates(session, unique).catch(() => ({
    items: [],
  }));
  return new Map(
    found.items.map((gate) => [
      gate.investorOrganisationId.toLowerCase(),
      gate,
    ]),
  );
}

/** One investor's gate from a map keyed by lower-case id. */
export function gateFor(
  gates: ReadonlyMap<string, InvestorGateFitDto>,
  investorOrganisationId: string,
): InvestorGateFitDto | null {
  return gates.get(investorOrganisationId.toLowerCase()) ?? null;
}
