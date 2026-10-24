import type { PublicCardDto, PublishedFitDto } from "@capital-q/contracts";
import {
  normalizeTaxonomyAlias,
  REFERENCE_TAXONOMY,
  type ReferenceNode,
} from "@capital-q/taxonomy";

import { STAGE_OPTIONS } from "./definition/index.js";

/**
 * QO-42 (owner QA 2026-10-23): a founder's Discover card and investor page
 * said "not known yet" for stage, sector and geography when the investor's
 * Q Card plainly named all three. Only GateQ criteria and the declared
 * profile were compared; what the card publishes was display text.
 *
 * This compares the founder's OWN declared company (stage, headquarters
 * country, confirmed classifications with their ancestors: the GateQ
 * projection) with what the investor PUBLISHES on their card, read at the
 * PARTICIPANT audience as `/@handle` shows a signed-in participant.
 * Context Firewall: the investor's mandate is never read here -- a field
 * they did not put on their card is not on it -- and the result goes only
 * to this founder.
 *
 * Unknown stays unknown: nothing published, nothing declared, or a name
 * on the card the taxonomy does not know (with nothing else matching) is
 * UNKNOWN, never NOT_MET.
 */

/** The founder's own company, as GateQ qualifies it. */
export type FounderFacts = {
  readonly stageCode: string | null;
  /** ISO 3166-1 alpha-2. */
  readonly headquartersCountry: string | null;
  /** Each assigned node with its ancestors. */
  readonly classifications: readonly {
    readonly nodeId: string;
    readonly ancestorNodeIds: readonly string[];
  }[];
};

const STAGE_BY_LABEL = new Map(
  STAGE_OPTIONS.flatMap((option) => [
    [normalizeTaxonomyAlias(option.label), option.optionKey] as const,
    [
      normalizeTaxonomyAlias(option.optionKey.replace(/_/gu, " ")),
      option.optionKey,
    ] as const,
  ]),
);

/** The vocabularies the card's sectors are named from (card-facts). */
const SECTOR_VOCABULARIES = new Set(["industry", "product_category"]);

function wordsIndex(
  keep: (node: ReferenceNode) => boolean,
): ReadonlyMap<string, ReferenceNode> {
  const map = new Map<string, ReferenceNode>();
  const add = (words: string, node: ReferenceNode) => {
    const key = normalizeTaxonomyAlias(words);
    if (key.length > 0 && !map.has(key)) map.set(key, node);
  };
  const kept = REFERENCE_TAXONOMY.nodes.filter(keep);
  const byId = new Map(kept.map((node) => [node.id, node]));
  for (const node of kept) {
    add(node.displayName, node);
    add(node.canonicalCode.replace(/_/gu, " "), node);
  }
  for (const alias of REFERENCE_TAXONOMY.aliases) {
    const node = byId.get(alias.nodeId);
    if (node !== undefined) add(alias.alias, node);
  }
  return map;
}

const SECTOR_BY_WORDS = wordsIndex((node) =>
  SECTOR_VOCABULARIES.has(node.vocabularyCode),
);
const GEOGRAPHY_BY_WORDS = wordsIndex(
  (node) => node.vocabularyCode === "geography",
);
const GEOGRAPHY_BY_ID = new Map(
  REFERENCE_TAXONOMY.nodes
    .filter((node) => node.vocabularyCode === "geography")
    .map((node) => [node.id, node]),
);
const COUNTRY_NODE = new Map(
  [...GEOGRAPHY_BY_ID.values()].flatMap((node) => {
    const iso = node.metadata["iso3166Alpha2"];
    return typeof iso === "string" ? [[iso.toUpperCase(), node] as const] : [];
  }),
);

/** A card list field's names ("Seed; Series A"), as card-facts joins them. */
function cardNames(card: PublicCardDto, key: string): string[] {
  const value = card.fields.find((field) => field.key === key)?.value ?? "";
  return value
    .split(/;\s*/u)
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

/**
 * MET when one published name matches; NOT_MET only when every published
 * name was understood and none matches; otherwise UNKNOWN.
 */
function standing<T>(
  names: readonly string[],
  resolve: (name: string) => T | undefined,
  matches: (value: T) => boolean,
): PublishedFitDto["stage"] {
  if (names.length === 0) return "UNKNOWN";
  let understood = 0;
  for (const name of names) {
    const value = resolve(normalizeTaxonomyAlias(name));
    if (value === undefined) continue;
    understood += 1;
    if (matches(value)) return "MET";
  }
  return understood === names.length ? "NOT_MET" : "UNKNOWN";
}

/** The country and every region above it. */
function geographyChain(country: string): ReadonlySet<string> {
  const chain = new Set<string>();
  let node = COUNTRY_NODE.get(country.toUpperCase());
  while (node !== undefined && !chain.has(node.id)) {
    chain.add(node.id);
    node =
      node.parentNodeId === null
        ? undefined
        : GEOGRAPHY_BY_ID.get(node.parentNodeId);
  }
  return chain;
}

export function publishedFitOf(
  card: PublicCardDto | null,
  founder: FounderFacts,
): PublishedFitDto {
  if (card === null || card.subjectType !== "INVESTOR_ORGANISATION") {
    return { stage: "UNKNOWN", sector: "UNKNOWN", geography: "UNKNOWN" };
  }
  const stage =
    founder.stageCode === null
      ? "UNKNOWN"
      : standing(
          cardNames(card, "mandateStages"),
          (words) => STAGE_BY_LABEL.get(words),
          (code) => code === founder.stageCode,
        );
  // A company classified "payments" fits a published "fintech": its
  // ancestors are what GateQ matches on too.
  const held = new Set(
    founder.classifications.flatMap((one) => [
      one.nodeId,
      ...one.ancestorNodeIds,
    ]),
  );
  const sector =
    held.size === 0
      ? "UNKNOWN"
      : standing(
          cardNames(card, "mandateSectors"),
          (words) => SECTOR_BY_WORDS.get(words),
          (node) => held.has(node.id),
        );
  const chain =
    founder.headquartersCountry === null
      ? new Set<string>()
      : geographyChain(founder.headquartersCountry);
  const geography =
    chain.size === 0
      ? "UNKNOWN"
      : standing(
          cardNames(card, "mandateGeographies"),
          (words) => GEOGRAPHY_BY_WORDS.get(words),
          (node) => node.canonicalCode === "global" || chain.has(node.id),
        );
  return { stage, sector, geography };
}
