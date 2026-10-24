import {
  FOUNDER_PREFERENCE_OPTIONS,
  GREEN_FLAG_OPTIONS,
  STAGE_OPTIONS,
} from "./definition/index.js";
import {
  InvestorOrganisationIdSchema,
  typicalCheque,
  type InvestorMandateQueryPort,
} from "@capital-q/investors";
import { TenantIdSchema } from "@capital-q/security";
import { REFERENCE_TAXONOMY } from "@capital-q/taxonomy";

/**
 * An investor's active mandate as the facts a Q Card may show (founder
 * design 2026-09-28, "Investment at a glance"). Names only, from the
 * mandate's own declared codes and taxonomy nodes: the typical cheque,
 * stages, sectors, business models, customer types, geographies and what
 * they look for. Never the narrative, never exclusions or things to avoid.
 * The card shows none of these unless the owner puts it on the card.
 *
 * QA F-77 (2026-10-24): one builder for every process that reads a card.
 * The Q API read cards without it, so Q saw no published stage, sector or
 * geography on any investor's card and called every fit unknown.
 */

/** The facts, by the card field each fills (public-identity's mandate fields). */
export type InvestorCardFacts = {
  readonly mandateTypicalCheque?: string | null;
  readonly mandateStages?: string | null;
  readonly mandateSectors?: string | null;
  readonly mandateBusinessModels?: string | null;
  readonly mandateCustomerTypes?: string | null;
  readonly mandateGeographies?: string | null;
  readonly mandateLookFor?: string | null;
};

const TAXONOMY = new Map(
  REFERENCE_TAXONOMY.nodes.map((node) => [node.id, node] as const),
);
const LABELS = new Map(
  [...STAGE_OPTIONS, ...FOUNDER_PREFERENCE_OPTIONS, ...GREEN_FLAG_OPTIONS].map(
    (option) => [option.optionKey, option.label] as const,
  ),
);

/** "1500000.50" -> "1,500,000.50", exactly; never through floating point. */
function grouped(amount: string): string {
  const [whole = "", fraction] = amount.split(".");
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined || /^0+$/.test(fraction)
    ? withCommas
    : `${withCommas}.${fraction}`;
}

const list = (items: readonly string[]): string | null =>
  items.length === 0 ? null : [...new Set(items)].join("; ");

export function createInvestorCardFacts(deps: {
  readonly mandates: InvestorMandateQueryPort;
  readonly tenantOf: (investorOrganisationId: string) => Promise<string | null>;
}) {
  return async (investorOrganisationId: string): Promise<InvestorCardFacts> => {
    const tenant = await deps.tenantOf(investorOrganisationId);
    const id = InvestorOrganisationIdSchema.safeParse(investorOrganisationId);
    if (tenant === null || !id.success) return {};
    const tenantId = TenantIdSchema.parse(tenant);
    const [active] = await deps.mandates.listActiveMandates(tenantId, id.data);
    if (active === undefined) return {};
    const mandate = await deps.mandates.getMandate(
      tenantId,
      id.data,
      active.id,
    );
    if (mandate === null) return {};

    const codes = (dimension: string) =>
      mandate.constraints
        .filter(
          (c) =>
            c.dimension === dimension &&
            !c.isHardExclusion &&
            c.importance !== "AVOID" &&
            c.value.kind === "codes",
        )
        .flatMap((c) => (c.value.kind === "codes" ? c.value.values : []))
        .map((code) => LABELS.get(code) ?? code.replace(/_/g, " "));
    const nodes = (vocabularies: readonly string[]) =>
      mandate.taxonomyPreferences
        .filter(
          (p) =>
            !p.isExclusion &&
            p.preferenceStrength !== "AVOID" &&
            vocabularies.includes(TAXONOMY.get(p.nodeId)?.vocabularyCode ?? ""),
        )
        .flatMap((p) => {
          const node = TAXONOMY.get(p.nodeId);
          return node === undefined ? [] : [node.displayName];
        });
    const typical = typicalCheque(mandate.constraints);
    const currency = mandate.cheque?.currency ?? null;
    return {
      mandateTypicalCheque:
        typical === undefined
          ? null
          : `${currency === null ? "" : `${currency} `}${grouped(typical)}`,
      mandateStages: list(codes("stage")),
      mandateSectors: list(nodes(["industry", "product_category"])),
      mandateBusinessModels: list(nodes(["business_model"])),
      mandateCustomerTypes: list(nodes(["customer_type"])),
      mandateGeographies: list(nodes(["geography"])),
      mandateLookFor: list([
        ...codes("founder.business_attribute"),
        ...codes("green_flag"),
      ]),
    };
  };
}
