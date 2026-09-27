import {
  CAPITAL_INTENSITY_OPTIONS,
  DEPLOYMENT_STATUS_OPTIONS,
  DISCOVERY_MODE_OPTIONS,
  FOUNDER_PREFERENCE_OPTIONS,
  GREEN_FLAG_OPTIONS,
  INVESTMENT_ROLE_OPTIONS,
  INVESTOR_TYPE_OPTIONS,
  RED_FLAG_OPTIONS,
  REGULATORY_APPETITE_OPTIONS,
  REVENUE_STATE_OPTIONS,
  STAGE_OPTIONS,
} from "@capital-q/investor-onboarding/definition";
import type { MandateLabels } from "@capital-q/q-specialists";
import { REFERENCE_TAXONOMY } from "@capital-q/taxonomy";

/**
 * The names a person knows their mandate's codes by (R30 #8): the taxonomy's
 * display names ("West Africa", "E-commerce") and the Investor Definition's
 * option labels ("Syndicate", "Co-invest alongside a lead"), the same words
 * the onboarding and the profile use. Nothing is invented: a code neither
 * source knows falls back to the document's own plain-words rendering.
 */

type Option = { readonly optionKey: string; readonly label: string };

function byKey(...lists: readonly (readonly Option[])[]) {
  const map = new Map<string, string>();
  for (const list of lists) {
    for (const option of list) {
      if (!map.has(option.optionKey)) map.set(option.optionKey, option.label);
    }
  }
  return map;
}

const DEFINITION_LABELS = byKey(
  STAGE_OPTIONS,
  INVESTMENT_ROLE_OPTIONS,
  GREEN_FLAG_OPTIONS,
  RED_FLAG_OPTIONS,
  CAPITAL_INTENSITY_OPTIONS,
  REGULATORY_APPETITE_OPTIONS,
  REVENUE_STATE_OPTIONS,
  FOUNDER_PREFERENCE_OPTIONS,
  DISCOVERY_MODE_OPTIONS,
);
const INVESTOR_TYPES = byKey(INVESTOR_TYPE_OPTIONS);
const DEPLOYMENT_STATES = byKey(DEPLOYMENT_STATUS_OPTIONS);

const TAXONOMY_BY_VOCABULARY = new Map<string, string>();
const TAXONOMY_BY_CODE = new Map<string, string>();
for (const node of REFERENCE_TAXONOMY.nodes) {
  TAXONOMY_BY_VOCABULARY.set(
    `${node.vocabularyCode}/${node.canonicalCode}`,
    node.displayName,
  );
  if (!TAXONOMY_BY_CODE.has(node.canonicalCode)) {
    TAXONOMY_BY_CODE.set(node.canonicalCode, node.displayName);
  }
  // Countries are also filed by ISO code ("NG").
  const iso = node.metadata["iso3166Alpha2"];
  if (typeof iso === "string") {
    TAXONOMY_BY_CODE.set(iso.toLowerCase(), node.displayName);
  }
}

export const MANDATE_LABELS: MandateLabels = {
  code: (code, vocabularyCode) => {
    const key = code.toLowerCase();
    return (
      (vocabularyCode === undefined
        ? undefined
        : TAXONOMY_BY_VOCABULARY.get(`${vocabularyCode}/${key}`)) ??
      DEFINITION_LABELS.get(key) ??
      TAXONOMY_BY_CODE.get(key)
    );
  },
  investorType: (code) => INVESTOR_TYPES.get(code.toLowerCase()),
  deploymentState: (code) => DEPLOYMENT_STATES.get(code.toLowerCase()),
};
