import {
  TaxonomyCanonicalCodeSchema,
  TaxonomyVocabularyCodeSchema,
  type TaxonomyAliasType,
  type TaxonomyEdgeType,
  type TaxonomyNodeMetadata,
  type TaxonomyNodeStatus,
} from "../contracts/index.js";
import { validateHierarchy } from "../domain/hierarchy.js";
import { normalizeTaxonomyAlias } from "../domain/normalize-alias.js";
import {
  stableAliasId,
  stableNodeId,
  stableVocabularyId,
} from "../domain/stable-id.js";

/**
 * The version-controlled Capital Q reference taxonomy (V1).
 *
 * This module is the source of truth for the platform vocabularies, nodes,
 * aliases and edges. It is rendered into the forward migration that deploys
 * the reference data to every environment (`pnpm --filter
 * @capital-q/taxonomy render:reference-sql`), and an integration test asserts
 * the database equals this set, id for id.
 *
 * Scope is deliberately useful, not exhaustive: the fintech / payments /
 * insurance concepts the product documents and fixtures use, credible
 * cross-sector roots so the demo does not read as "fintech only", the
 * stages and countries existing flows already use, and minimal shells for
 * impact and regulatory profile. Adding a concept is a reviewed change to
 * this file plus a new migration; it never regenerates an existing id.
 *
 * Identity: `id` is a v5 UUID over the vocabulary and canonical codes;
 * display names are free to change. Codes: [a-z0-9][a-z0-9._-]{0,127}.
 */

type AliasSpec =
  string | { readonly alias: string; readonly type: TaxonomyAliasType };

type NodeSpec = {
  readonly code: string;
  readonly name: string;
  readonly parent?: string | undefined;
  readonly description?: string | undefined;
  readonly metadata?: TaxonomyNodeMetadata | undefined;
  readonly status?: TaxonomyNodeStatus | undefined;
  readonly aliases?: readonly AliasSpec[] | undefined;
};

type VocabularySpec = {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly version: number;
  readonly nodes: readonly NodeSpec[];
};

type EdgeSpec = {
  readonly from: readonly [vocabulary: string, code: string];
  readonly type: TaxonomyEdgeType;
  readonly to: readonly [vocabulary: string, code: string];
};

export type ReferenceVocabulary = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly version: number;
};

export type ReferenceNode = {
  readonly id: string;
  readonly vocabularyId: string;
  readonly vocabularyCode: string;
  readonly canonicalCode: string;
  readonly displayName: string;
  readonly description: string | null;
  readonly parentNodeId: string | null;
  readonly parentCode: string | null;
  readonly depth: number;
  readonly status: TaxonomyNodeStatus;
  readonly metadata: TaxonomyNodeMetadata;
};

export type ReferenceAlias = {
  readonly id: string;
  readonly nodeId: string;
  readonly alias: string;
  readonly locale: string;
  readonly aliasType: TaxonomyAliasType;
  readonly normalizedAlias: string;
};

export type ReferenceEdge = {
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly edgeType: TaxonomyEdgeType;
};

export type ReferenceTaxonomy = {
  readonly vocabularies: readonly ReferenceVocabulary[];
  readonly nodes: readonly ReferenceNode[];
  readonly aliases: readonly ReferenceAlias[];
  readonly edges: readonly ReferenceEdge[];
};

export const REFERENCE_LOCALE = "en";

function country(
  code: string,
  name: string,
  iso: string,
  parent: string,
): NodeSpec {
  return {
    code,
    name,
    parent,
    metadata: { iso3166Alpha2: iso },
    aliases: [{ alias: iso, type: "ABBREVIATION" }],
  };
}

const VOCABULARIES: readonly VocabularySpec[] = [
  {
    code: "industry",
    name: "Industry",
    description:
      "The sector a company operates in. Multi-label; primary hierarchy sector → subsector → niche.",
    version: 1,
    nodes: [
      {
        code: "financial_services",
        name: "Financial Services",
        description:
          "Banking, payments, lending, insurance, capital markets and the technology serving them.",
      },
      {
        code: "fintech",
        name: "Fintech",
        parent: "financial_services",
        aliases: ["financial technology"],
      },
      {
        code: "payments",
        name: "Payments",
        parent: "fintech",
        aliases: ["payment services"],
      },
      {
        code: "payment_infrastructure",
        name: "Payment Infrastructure",
        parent: "payments",
        description:
          "Rails, processing and APIs other businesses build payments on.",
        aliases: [
          "payments rails",
          "payment rails",
          "fintech infra",
          "financial infrastructure",
        ],
      },
      {
        code: "merchant_payments",
        name: "Merchant Payments",
        parent: "payments",
        aliases: ["merchant acquiring", "point of sale payments"],
      },
      {
        code: "cross_border_payments",
        name: "Cross-Border Payments",
        parent: "payments",
        aliases: ["remittances", "international payments"],
      },
      {
        code: "embedded_payments",
        name: "Embedded Payments",
        parent: "payments",
      },
      {
        code: "digital_lending",
        name: "Digital Lending",
        parent: "fintech",
        aliases: ["lending", "credit tech"],
      },
      {
        code: "digital_banking",
        name: "Digital Banking",
        parent: "fintech",
        aliases: ["neobank", "challenger bank"],
      },
      {
        code: "wealthtech",
        name: "Wealthtech",
        parent: "fintech",
        aliases: ["wealth management technology"],
      },
      {
        code: "insurtech",
        name: "Insurtech",
        parent: "fintech",
        aliases: ["insurance technology", "insurance tech"],
      },
      { code: "banking", name: "Banking", parent: "financial_services" },
      { code: "insurance", name: "Insurance", parent: "financial_services" },
      {
        code: "capital_markets",
        name: "Capital Markets",
        parent: "financial_services",
      },
      {
        code: "enterprise_software",
        name: "Enterprise Software",
        description: "Software sold to organisations.",
        aliases: ["b2b software"],
      },
      {
        code: "developer_tools",
        name: "Developer Tools",
        parent: "enterprise_software",
        aliases: ["devtools"],
      },
      {
        code: "data_infrastructure",
        name: "Data Infrastructure",
        parent: "enterprise_software",
        aliases: ["ai & data infrastructure", "data platforms"],
      },
      {
        code: "hr_technology",
        name: "HR Technology",
        parent: "enterprise_software",
        aliases: ["hrtech"],
      },
      {
        code: "cybersecurity",
        name: "Cybersecurity",
        aliases: ["cyber security", "infosec", "information security"],
      },
      {
        code: "identity_security",
        name: "Identity & Access",
        parent: "cybersecurity",
        aliases: ["identity infrastructure", "iam"],
      },
      { code: "healthcare", name: "Healthcare" },
      {
        code: "digital_health",
        name: "Digital Health",
        parent: "healthcare",
        aliases: ["healthtech", "health tech"],
      },
      {
        code: "medical_devices",
        name: "Medical Devices",
        parent: "healthcare",
      },
      { code: "energy", name: "Energy" },
      {
        code: "clean_energy",
        name: "Clean Energy",
        parent: "energy",
        aliases: ["renewables", "renewable energy", "cleantech"],
      },
      {
        code: "energy_access",
        name: "Energy Access",
        parent: "energy",
        aliases: ["off-grid energy"],
      },
      { code: "commerce", name: "Commerce & Retail" },
      {
        code: "ecommerce",
        name: "E-commerce",
        parent: "commerce",
        aliases: ["e commerce", "online retail"],
      },
      {
        code: "retail_technology",
        name: "Retail Technology",
        parent: "commerce",
      },
      { code: "logistics", name: "Logistics & Mobility" },
      {
        code: "supply_chain",
        name: "Supply Chain",
        parent: "logistics",
        aliases: ["supply chain technology"],
      },
      { code: "mobility", name: "Mobility & Transport", parent: "logistics" },
      { code: "agriculture", name: "Agriculture" },
      {
        code: "agritech",
        name: "Agritech",
        parent: "agriculture",
        aliases: ["agtech"],
      },
      { code: "education", name: "Education" },
      {
        code: "edtech",
        name: "Edtech",
        parent: "education",
        aliases: ["education technology"],
      },
      { code: "real_estate", name: "Real Estate" },
      { code: "proptech", name: "Proptech", parent: "real_estate" },
      { code: "media_entertainment", name: "Media & Entertainment" },
      {
        code: "telecommunications",
        name: "Telecommunications",
        aliases: ["telecoms", "telco"],
      },
      { code: "manufacturing", name: "Manufacturing & Industrial" },
    ],
  },
  {
    code: "product_category",
    name: "Product Category",
    description:
      "What the company actually builds and sells. Multi-label; independent of industry.",
    version: 1,
    nodes: [
      {
        code: "payment_infrastructure",
        name: "Payment Infrastructure",
        description: "Rails, processing and APIs that let others move money.",
        aliases: ["payments rails", "b2b payment apis", "payment apis"],
      },
      { code: "cross_border_payments", name: "Cross-Border Payments" },
      {
        code: "digital_wallet",
        name: "Digital Wallet",
        aliases: ["mobile money", "e-wallet", "mobile wallet"],
      },
      {
        code: "core_banking_platform",
        name: "Core Banking Platform",
        aliases: ["core banking"],
      },
      {
        code: "lending_platform",
        name: "Lending Platform",
        aliases: ["loan origination"],
      },
      {
        code: "embedded_finance",
        name: "Embedded Finance",
        aliases: ["banking as a service", "baas"],
      },
      {
        code: "claims_automation",
        name: "Claims Automation",
        aliases: ["claims processing automation", "automated claims"],
      },
      { code: "insurance_distribution", name: "Insurance Distribution" },
      {
        code: "developer_api",
        name: "Developer API",
        description: "An API sold to developers and businesses as the product.",
        aliases: ["api product", "developer platform", "api infrastructure"],
      },
      {
        code: "identity_verification",
        name: "Identity Verification",
        aliases: ["kyc", "know your customer"],
      },
      {
        code: "fraud_detection",
        name: "Fraud Detection",
        aliases: ["fraud prevention"],
      },
      {
        code: "data_analytics_platform",
        name: "Data & Analytics Platform",
        aliases: ["analytics platform"],
      },
      { code: "marketplace", name: "Marketplace" },
      { code: "workflow_automation", name: "Workflow Automation" },
      { code: "security_platform", name: "Security Platform" },
      { code: "telehealth", name: "Telehealth", aliases: ["telemedicine"] },
      {
        code: "health_records",
        name: "Health Records",
        aliases: ["electronic health records", "ehr"],
      },
      { code: "energy_management", name: "Energy Management" },
      { code: "fleet_management", name: "Fleet Management" },
      { code: "learning_platform", name: "Learning Platform" },
    ],
  },
  {
    code: "technology",
    name: "Technology",
    description:
      "The enabling technology. Multi-label; describes how, not what or for whom.",
    version: 1,
    nodes: [
      {
        code: "artificial_intelligence",
        name: "Artificial Intelligence",
        aliases: [
          "ai",
          "ai/ml",
          "artificial intelligence / machine learning",
          "ai-enabled",
        ],
      },
      {
        code: "machine_learning",
        name: "Machine Learning",
        parent: "artificial_intelligence",
        aliases: ["ml"],
      },
      {
        code: "natural_language_processing",
        name: "Natural Language Processing",
        parent: "artificial_intelligence",
        aliases: ["nlp", "large language models", "llm"],
      },
      {
        code: "computer_vision",
        name: "Computer Vision",
        parent: "artificial_intelligence",
      },
      {
        code: "api_platform",
        name: "API Platform",
        description: "API-first architecture as the core technical approach.",
        aliases: ["api-first", "api infrastructure"],
      },
      {
        code: "blockchain",
        name: "Blockchain",
        aliases: ["web3", "distributed ledger"],
      },
      { code: "cloud_infrastructure", name: "Cloud Infrastructure" },
      { code: "data_infrastructure", name: "Data Infrastructure" },
      {
        code: "mobile_technology",
        name: "Mobile",
        aliases: ["mobile-first", "mobile app"],
      },
      {
        code: "internet_of_things",
        name: "Internet of Things",
        aliases: ["iot", "connected devices"],
      },
      { code: "robotics", name: "Robotics & Automation" },
      { code: "hardware", name: "Hardware" },
    ],
  },
  {
    code: "business_model",
    name: "Business Model",
    description: "How the company earns. Multi-label.",
    version: 1,
    nodes: [
      {
        code: "b2b_saas",
        name: "B2B SaaS",
        aliases: ["saas", "software as a service", "b2b software subscription"],
      },
      { code: "b2c_subscription", name: "Consumer Subscription" },
      {
        code: "transaction_fee",
        name: "Transaction Fee",
        aliases: ["take rate", "per-transaction fee"],
      },
      { code: "marketplace", name: "Marketplace" },
      {
        code: "usage_based",
        name: "Usage-Based Pricing",
        aliases: ["pay as you go", "metered pricing"],
      },
      { code: "licensing", name: "Licensing" },
      { code: "hardware_sales", name: "Hardware Sales" },
      { code: "advertising", name: "Advertising" },
      { code: "freemium", name: "Freemium" },
      { code: "services", name: "Services" },
    ],
  },
  {
    code: "customer_type",
    name: "Customer Type",
    description:
      "Who buys. Multi-label; business customers may be further sized.",
    version: 1,
    nodes: [
      {
        code: "financial_institution",
        name: "Financial Institution",
        aliases: ["banks", "cooperative banks", "fis"],
      },
      {
        code: "insurance_company",
        name: "Insurance Company",
        aliases: ["insurers"],
      },
      {
        code: "business_customer",
        name: "Business Customer",
        aliases: ["b2b", "businesses"],
      },
      {
        code: "small_business",
        name: "Small & Medium Business",
        parent: "business_customer",
        aliases: ["smb", "sme", "small businesses"],
      },
      { code: "mid_market", name: "Mid-Market", parent: "business_customer" },
      {
        code: "enterprise",
        name: "Enterprise",
        parent: "business_customer",
        aliases: ["large enterprises"],
      },
      { code: "consumer", name: "Consumer", aliases: ["b2c", "individuals"] },
      { code: "developer", name: "Developer", aliases: ["developers"] },
      {
        code: "government",
        name: "Government & Public Sector",
        aliases: ["public sector"],
      },
      { code: "nonprofit", name: "Nonprofit & NGO", aliases: ["ngo"] },
    ],
  },
  {
    code: "company_stage",
    name: "Company Stage",
    description:
      "Financing stage. Shared vocabulary for Company.current_stage_code, capital objective target stage and mandate stage codes; it does not replace those columns.",
    version: 1,
    nodes: [
      { code: "pre_seed", name: "Pre-seed", aliases: ["preseed", "pre seed"] },
      { code: "seed", name: "Seed" },
      { code: "series_a", name: "Series A", aliases: ["series-a"] },
      { code: "series_b", name: "Series B", aliases: ["series-b"] },
      {
        code: "series_c_plus",
        name: "Series C or later",
        aliases: ["series c+", "growth stage", "late stage"],
      },
    ],
  },
  {
    code: "geography",
    name: "Geography",
    description:
      "Operating and target markets: regions and countries. Regional containment is a pragmatic MVP grouping, not a political statement.",
    version: 1,
    nodes: [
      {
        code: "global",
        name: "Global",
        description: "No geographic restriction.",
      },
      { code: "africa", name: "Africa" },
      { code: "west_africa", name: "West Africa", parent: "africa" },
      country("nigeria", "Nigeria", "NG", "west_africa"),
      country("ghana", "Ghana", "GH", "west_africa"),
      { code: "east_africa", name: "East Africa", parent: "africa" },
      country("kenya", "Kenya", "KE", "east_africa"),
      { code: "southern_africa", name: "Southern Africa", parent: "africa" },
      country("south_africa", "South Africa", "ZA", "southern_africa"),
      { code: "north_africa", name: "North Africa", parent: "africa" },
      country("egypt", "Egypt", "EG", "north_africa"),
      { code: "europe", name: "Europe" },
      country("united_kingdom", "United Kingdom", "GB", "europe"),
      country("germany", "Germany", "DE", "europe"),
      country("france", "France", "FR", "europe"),
      country("netherlands", "Netherlands", "NL", "europe"),
      { code: "north_america", name: "North America" },
      country("united_states", "United States", "US", "north_america"),
      country("canada", "Canada", "CA", "north_america"),
      { code: "middle_east", name: "Middle East" },
      country(
        "united_arab_emirates",
        "United Arab Emirates",
        "AE",
        "middle_east",
      ),
      { code: "asia", name: "Asia" },
      country("india", "India", "IN", "asia"),
      country("singapore", "Singapore", "SG", "asia"),
      { code: "latin_america", name: "Latin America" },
      country("brazil", "Brazil", "BR", "latin_america"),
    ],
  },
  {
    code: "impact_theme",
    name: "Impact Theme",
    description:
      "Minimal V1 shell: the impact themes current product flows name. Extended only when a flow needs it.",
    version: 1,
    nodes: [
      { code: "financial_inclusion", name: "Financial Inclusion" },
      {
        code: "climate",
        name: "Climate & Sustainability",
        aliases: ["climate tech"],
      },
      { code: "health_access", name: "Health Access" },
      { code: "economic_opportunity", name: "Jobs & Economic Opportunity" },
    ],
  },
  {
    code: "regulatory_profile",
    name: "Regulatory Profile",
    description:
      "Minimal V1 shell: whether the business operates under a specific regulatory regime.",
    version: 1,
    nodes: [
      {
        code: "regulated_financial_services",
        name: "Regulated Financial Services",
        aliases: ["licensed financial institution"],
      },
      { code: "regulated_healthcare", name: "Regulated Healthcare" },
      { code: "data_protection_sensitive", name: "Data-Protection Sensitive" },
      {
        code: "not_specifically_regulated",
        name: "Not Specifically Regulated",
      },
    ],
  },
];

const EDGES: readonly EdgeSpec[] = [
  {
    from: ["product_category", "payment_infrastructure"],
    type: "related_to",
    to: ["industry", "payment_infrastructure"],
  },
  {
    from: ["product_category", "cross_border_payments"],
    type: "related_to",
    to: ["industry", "cross_border_payments"],
  },
  {
    from: ["product_category", "claims_automation"],
    type: "related_to",
    to: ["industry", "insurtech"],
  },
  {
    from: ["product_category", "embedded_finance"],
    type: "related_to",
    to: ["industry", "embedded_payments"],
  },
  {
    from: ["product_category", "identity_verification"],
    type: "related_to",
    to: ["industry", "identity_security"],
  },
  {
    from: ["product_category", "marketplace"],
    type: "related_to",
    to: ["business_model", "marketplace"],
  },
  {
    from: ["product_category", "developer_api"],
    type: "commonly_co_occurs",
    to: ["technology", "api_platform"],
  },
  {
    from: ["business_model", "b2b_saas"],
    type: "commonly_co_occurs",
    to: ["customer_type", "business_customer"],
  },
  {
    from: ["technology", "data_infrastructure"],
    type: "related_to",
    to: ["industry", "data_infrastructure"],
  },
  {
    from: ["industry", "insurtech"],
    type: "overlaps",
    to: ["industry", "insurance"],
  },
  {
    from: ["industry", "financial_services"],
    type: "broader_than",
    to: ["product_category", "payment_infrastructure"],
  },
  {
    from: ["impact_theme", "financial_inclusion"],
    type: "commonly_co_occurs",
    to: ["customer_type", "small_business"],
  },
];

function build(): ReferenceTaxonomy {
  const vocabularies: ReferenceVocabulary[] = [];
  const nodes: ReferenceNode[] = [];
  const aliases: ReferenceAlias[] = [];
  const byKey = new Map<string, ReferenceNode>();

  for (const spec of VOCABULARIES) {
    TaxonomyVocabularyCodeSchema.parse(spec.code);
    const vocabularyId = stableVocabularyId(spec.code);
    vocabularies.push({
      id: vocabularyId,
      code: spec.code,
      name: spec.name,
      description: spec.description,
      version: spec.version,
    });
    for (const node of spec.nodes) {
      TaxonomyCanonicalCodeSchema.parse(node.code);
      const parent =
        node.parent === undefined
          ? null
          : byKey.get(`${spec.code}/${node.parent}`);
      if (node.parent !== undefined && parent === undefined) {
        throw new Error(
          `${spec.code}/${node.code}: parent ${node.parent} must be declared first`,
        );
      }
      const built: ReferenceNode = {
        id: stableNodeId(spec.code, node.code),
        vocabularyId,
        vocabularyCode: spec.code,
        canonicalCode: node.code,
        displayName: node.name,
        description: node.description ?? null,
        parentNodeId: parent?.id ?? null,
        parentCode: parent?.canonicalCode ?? null,
        depth: parent === undefined || parent === null ? 0 : parent.depth + 1,
        status: node.status ?? "ACTIVE",
        metadata: node.metadata ?? {},
      };
      byKey.set(`${spec.code}/${node.code}`, built);
      nodes.push(built);
      const seen = new Set<string>();
      for (const aliasSpec of node.aliases ?? []) {
        const alias =
          typeof aliasSpec === "string" ? aliasSpec : aliasSpec.alias;
        const aliasType: TaxonomyAliasType =
          typeof aliasSpec === "string" ? "SYNONYM" : aliasSpec.type;
        const normalizedAlias = normalizeTaxonomyAlias(alias);
        if (seen.has(normalizedAlias)) {
          throw new Error(
            `${spec.code}/${node.code}: duplicate alias ${alias}`,
          );
        }
        seen.add(normalizedAlias);
        aliases.push({
          id: stableAliasId(
            spec.code,
            node.code,
            REFERENCE_LOCALE,
            normalizedAlias,
          ),
          nodeId: built.id,
          alias,
          locale: REFERENCE_LOCALE,
          aliasType,
          normalizedAlias,
        });
      }
    }
  }

  validateHierarchy(nodes);

  const edges: ReferenceEdge[] = EDGES.map((edge) => {
    const from = byKey.get(`${edge.from[0]}/${edge.from[1]}`);
    const to = byKey.get(`${edge.to[0]}/${edge.to[1]}`);
    if (from === undefined || to === undefined) {
      throw new Error(
        `edge names an unknown node: ${edge.from.join("/")} -> ${edge.to.join("/")}`,
      );
    }
    if (from.id === to.id) {
      throw new Error(`self edge on ${from.canonicalCode}`);
    }
    return { fromNodeId: from.id, toNodeId: to.id, edgeType: edge.type };
  });

  return { vocabularies, nodes, aliases, edges };
}

export const REFERENCE_TAXONOMY: ReferenceTaxonomy = build();

/** Look up a reference node by vocabulary and canonical code (test/fixture convenience). */
export function referenceNode(
  vocabularyCode: string,
  canonicalCode: string,
): ReferenceNode {
  const node = REFERENCE_TAXONOMY.nodes.find(
    (candidate) =>
      candidate.vocabularyCode === vocabularyCode &&
      candidate.canonicalCode === canonicalCode,
  );
  if (node === undefined) {
    throw new Error(
      `unknown reference node ${vocabularyCode}/${canonicalCode}`,
    );
  }
  return node;
}
