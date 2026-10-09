import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V46_SCHEMA_VERSION,
  TurnReaderV46ResultSchema,
  type TurnReaderV7Variables,
  type TurnReaderV46Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V45, V45_FIT } from "./turn-reader.v45.js";

/**
 * TURN_READER v46 -- DISCOVER COMPANIES (founder brief K1, live 2026-10-09
 * 15:57 UTC).
 *
 * "Three fintech companies" reached Q Brain and was answered with mandate
 * prose and no cards: nothing in the reading said it was a catalog ask.
 * Companies of a kind -- a sector, a place, a stage, a number -- is one
 * request in any words; the reader names it with its structure (taxonomy
 * codes, countries, count, how to order) and code answers it from the
 * catalog, with fit only when they asked for it.
 */
export const V46_DISCOVER = `- DISCOVER_COMPANIES: they want to see companies on Capital Q of a kind — a sector, a country, a stage, any number, in any words ("show me three fintech companies", "five healthtech startups", "fintech companies in Nigeria", "top three fintech", "which fintech companies suit my mandate"). Fill discover. Over FIT whenever they name a sector, country or stage; FIT only for fit with no kind named.
`;
export const V46_DISCOVER_FIELDS = `DISCOVER (for DISCOVER_COMPANIES; for FIT only previous, true when they mean the companies Q just showed, as in "which has the strongest fit" right after a list; otherwise null): sectors: taxonomy codes, lower_snake_case, the most specific that fits their words — financial_services, fintech, payments, payment_infrastructure, merchant_payments, cross_border_payments, embedded_payments, digital_lending, digital_banking, wealthtech, insurtech, banking, insurance, capital_markets, enterprise_software, developer_tools, data_infrastructure, hr_technology, cybersecurity, identity_security, healthcare, digital_health (healthtech), medical_devices, energy, clean_energy, energy_access, commerce, ecommerce, retail_technology, logistics, supply_chain, mobility, agriculture, agritech, education, edtech, real_estate, proptech, media_entertainment, telecommunications, manufacturing; a sector not listed in their own word, lower case. countries: ISO alpha-2 head-office countries ("in Nigeria" is NG). stages: pre_seed, seed, series_a, series_b, series_c_plus. ranking: FIT when they ask which suit or fit them or their mandate, or the strongest fit; TOP when they say top or best without saying on what; NONE otherwise. mandateRelevant: true when they tie it to their mandate or to themselves. previous: true when they mean companies Q just showed. count: the number they asked for, null when none.
`;

for (const anchor of [V45_FIT, "STILL WAITING:"]) {
  if (TURN_READER_V45.template.split(anchor).length !== 2) {
    throw new Error(`TURN_READER v46 rewrites v45, which changed: ${anchor}`);
  }
}

export const TURN_READER_V46: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV46Result
> = {
  ...TURN_READER_V45,
  version: 46,
  status: "DEPRECATED",
  changeDescription:
    "Founder brief K1 (live 2026-10-09 15:57): companies of a kind on Capital Q is DISCOVER_COMPANIES in any words, with taxonomy sectors, countries, stages, count and ranking, answered from the catalog by code.",
  effectiveFrom: "2026-10-09",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V46_SCHEMA_VERSION,
    schema: TurnReaderV46ResultSchema,
  },
  template: TURN_READER_V45.template
    .replace(V45_FIT, `${V46_DISCOVER}${V45_FIT}`)
    .replace("STILL WAITING:", `${V46_DISCOVER_FIELDS}STILL WAITING:`),
};
