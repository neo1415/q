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

/** A node spec with extra plain-language synonyms (e.g. "Ivory Coast"). */
function withAliases(spec: NodeSpec, synonyms: readonly string[]): NodeSpec {
  return { ...spec, aliases: [...(spec.aliases ?? []), ...synonyms] };
}

/**
 * ISO 3166-1 alpha-2 codes that are also everyday words or investment
 * shorthand ("no", "it", "me", "VC", "PE", "AI", "ML", "BD"): never an
 * alias, so a phrase such as "no restriction" or "VC-backed" does not name
 * a place.
 * The country is still found by its name and synonyms; its ISO code stays
 * in metadata for headquarters matching. Curated reference data.
 */
const ISO_CODES_NOT_ALIASES: ReadonlySet<string> = new Set(
  (
    "AD AG AI AL AM AR AS AT BD BE BI BS BY CC CO CV CX DM DO ER " +
    "FM GA GP HR ID IM IO IQ IR IS IT LA MD ME ML MS MY NA NE NO " +
    "PA PE PM PR PS SO ST TM TO TV VA VC"
  ).split(" "),
);

/**
 * A country added by geography v5 (every ISO 3166-1 country): as
 * `country`, with its synonyms, and without an ISO alias that is a word.
 */
function place(
  code: string,
  name: string,
  iso: string,
  parent: string,
  synonyms: readonly string[] = [],
): NodeSpec {
  const spec = country(code, name, iso, parent);
  return {
    ...spec,
    aliases: [
      ...(ISO_CODES_NOT_ALIASES.has(iso) ? [] : (spec.aliases ?? [])),
      ...synonyms,
    ],
  };
}

/**
 * Industries an investor can rule out as a red flag ("never show me
 * gambling"), as industry nodes a company declares like any other sector
 * (QO-28b, 2026-10-24). Each canonical code is the red-flag option key the
 * investor journey records, so Discover reads the investor's declared code
 * against the company's declared industry: a match excludes, and a company
 * that has declared no industry stays unknown and is never excluded
 * (ADR 0020). Red flags that are not industries (pre-product, single
 * founder, hardware-heavy) have no node here.
 */
const RED_FLAG_INDUSTRY_NODES: readonly NodeSpec[] = [
  {
    code: "gambling",
    name: "Gambling & Betting",
    aliases: ["betting", "sports betting", "casino", "igaming"],
  },
  {
    code: "tobacco",
    name: "Tobacco & Nicotine",
    aliases: ["vaping", "e-cigarettes", "nicotine products"],
  },
  {
    code: "weapons",
    name: "Weapons & Firearms",
    aliases: ["firearms", "munitions"],
  },
  {
    code: "adult_content",
    name: "Adult Content",
    aliases: ["adult entertainment"],
  },
  {
    code: "crypto_speculation",
    name: "Speculative Crypto",
    description: "Token speculation and trading-led crypto products.",
    aliases: ["memecoins", "token speculation"],
  },
];

/** The red-flag codes that name an industry node (see above). */
export const RED_FLAG_INDUSTRY_CODES: readonly string[] =
  RED_FLAG_INDUSTRY_NODES.map((node) => node.code);

const VOCABULARIES: readonly VocabularySpec[] = [
  {
    code: "industry",
    name: "Industry",
    description:
      "The sector a company operates in. Multi-label; primary hierarchy sector → subsector → niche.",
    // v2 (QO-28b, 2026-10-24): the red-flag industries.
    version: 2,
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
      ...RED_FLAG_INDUSTRY_NODES,
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
    // v2 (CQ-ACCEPT-001): an investor named Côte d'Ivoire and only Ghana
    // could be recorded. More of the markets investors here name, and a
    // Central Africa region. v3 (2026-10-15): Qatar and the other GCC
    // countries under the Middle East. v4 (2026-10-24): the Gulf (GCC)
    // region between them. v5 (live recheck 2026-10-30): every ISO 3166-1
    // country ("Benelux and the Nordics" could not be placed), with the
    // regions investors name whose members are all new (the Nordics,
    // Central & Eastern Europe, Southern Europe, East and Central Asia,
    // Central America, the Caribbean), Oceania and Antarctica. Countries
    // already listed keep their parents: a region that would contain one
    // of them (Benelux, Western Europe, Southeast Asia) is not added here,
    // as that means re-parenting existing rows.
    version: 5,
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
      withAliases(
        country("cote_divoire", "Côte d'Ivoire", "CI", "west_africa"),
        ["Ivory Coast", "Cote d'Ivoire", "Cote dIvoire"],
      ),
      country("senegal", "Senegal", "SN", "west_africa"),
      country("benin", "Benin", "BJ", "west_africa"),
      country("togo", "Togo", "TG", "west_africa"),
      { code: "east_africa", name: "East Africa", parent: "africa" },
      country("kenya", "Kenya", "KE", "east_africa"),
      country("rwanda", "Rwanda", "RW", "east_africa"),
      country("uganda", "Uganda", "UG", "east_africa"),
      country("tanzania", "Tanzania", "TZ", "east_africa"),
      country("ethiopia", "Ethiopia", "ET", "east_africa"),
      { code: "central_africa", name: "Central Africa", parent: "africa" },
      country("cameroon", "Cameroon", "CM", "central_africa"),
      withAliases(
        country(
          "dr_congo",
          "Democratic Republic of the Congo",
          "CD",
          "central_africa",
        ),
        ["DRC", "DR Congo", "Congo-Kinshasa"],
      ),
      { code: "southern_africa", name: "Southern Africa", parent: "africa" },
      country("south_africa", "South Africa", "ZA", "southern_africa"),
      country("zambia", "Zambia", "ZM", "southern_africa"),
      country("botswana", "Botswana", "BW", "southern_africa"),
      { code: "north_africa", name: "North Africa", parent: "africa" },
      country("egypt", "Egypt", "EG", "north_africa"),
      country("morocco", "Morocco", "MA", "north_africa"),
      country("tunisia", "Tunisia", "TN", "north_africa"),
      { code: "europe", name: "Europe" },
      country("united_kingdom", "United Kingdom", "GB", "europe"),
      country("germany", "Germany", "DE", "europe"),
      country("france", "France", "FR", "europe"),
      country("netherlands", "Netherlands", "NL", "europe"),
      { code: "north_america", name: "North America" },
      country("united_states", "United States", "US", "north_america"),
      country("canada", "Canada", "CA", "north_america"),
      { code: "middle_east", name: "Middle East" },
      // v4 (QA F-81, 2026-10-24): "Egypt, Morocco and the Gulf" kept only
      // Egypt and Morocco, as nothing named the Gulf. The six GCC countries
      // now sit under their own region (same ids), so "the Gulf" means those
      // six and the Middle East still contains them.
      {
        code: "gcc",
        name: "Gulf (GCC)",
        parent: "middle_east",
        description: "The Gulf Cooperation Council countries.",
        aliases: [
          "the Gulf",
          "Gulf",
          "Gulf states",
          "Arabian Gulf",
          { alias: "GCC", type: "ABBREVIATION" },
        ],
      },
      country("united_arab_emirates", "United Arab Emirates", "AE", "gcc"),
      // v3 (2026-10-15): the Gulf. Qatar-based founders and investors had
      // no node to name their own market.
      withAliases(country("qatar", "Qatar", "QA", "gcc"), ["Doha"]),
      withAliases(country("saudi_arabia", "Saudi Arabia", "SA", "gcc"), [
        "KSA",
        "Saudi",
      ]),
      country("kuwait", "Kuwait", "KW", "gcc"),
      country("bahrain", "Bahrain", "BH", "gcc"),
      country("oman", "Oman", "OM", "gcc"),
      { code: "asia", name: "Asia" },
      country("india", "India", "IN", "asia"),
      country("singapore", "Singapore", "SG", "asia"),
      { code: "latin_america", name: "Latin America" },
      country("brazil", "Brazil", "BR", "latin_america"),
      // v5 (live recheck 2026-10-30): every other ISO 3166-1 country.
      // Africa, into the existing regions.
      place("burkina_faso", "Burkina Faso", "BF", "west_africa"),
      place("cabo_verde", "Cabo Verde", "CV", "west_africa", ["Cape Verde"]),
      place("gambia", "Gambia", "GM", "west_africa", ["The Gambia"]),
      place("guinea", "Guinea", "GN", "west_africa"),
      place("guinea_bissau", "Guinea-Bissau", "GW", "west_africa"),
      place("liberia", "Liberia", "LR", "west_africa"),
      place("mali", "Mali", "ML", "west_africa"),
      place("mauritania", "Mauritania", "MR", "west_africa"),
      place("niger", "Niger", "NE", "west_africa"),
      place("sierra_leone", "Sierra Leone", "SL", "west_africa"),
      place(
        "saint_helena",
        "Saint Helena, Ascension and Tristan da Cunha",
        "SH",
        "west_africa",
        ["Saint Helena", "St Helena"],
      ),
      place("burundi", "Burundi", "BI", "east_africa"),
      place("comoros", "Comoros", "KM", "east_africa"),
      place("djibouti", "Djibouti", "DJ", "east_africa"),
      place("eritrea", "Eritrea", "ER", "east_africa"),
      place("madagascar", "Madagascar", "MG", "east_africa"),
      place("mauritius", "Mauritius", "MU", "east_africa"),
      place("seychelles", "Seychelles", "SC", "east_africa"),
      place("somalia", "Somalia", "SO", "east_africa"),
      place("south_sudan", "South Sudan", "SS", "east_africa"),
      place("reunion", "Réunion", "RE", "east_africa", ["Reunion"]),
      place("mayotte", "Mayotte", "YT", "east_africa"),
      place(
        "british_indian_ocean_territory",
        "British Indian Ocean Territory",
        "IO",
        "east_africa",
      ),
      place("angola", "Angola", "AO", "central_africa"),
      place(
        "central_african_republic",
        "Central African Republic",
        "CF",
        "central_africa",
      ),
      place("chad", "Chad", "TD", "central_africa"),
      place(
        "republic_of_the_congo",
        "Republic of the Congo",
        "CG",
        "central_africa",
        ["Congo-Brazzaville", "Congo Republic"],
      ),
      place("gabon", "Gabon", "GA", "central_africa"),
      place("equatorial_guinea", "Equatorial Guinea", "GQ", "central_africa"),
      place(
        "sao_tome_and_principe",
        "São Tomé and Príncipe",
        "ST",
        "central_africa",
        ["Sao Tome and Principe"],
      ),
      place("namibia", "Namibia", "NA", "southern_africa"),
      place("zimbabwe", "Zimbabwe", "ZW", "southern_africa"),
      place("mozambique", "Mozambique", "MZ", "southern_africa"),
      place("malawi", "Malawi", "MW", "southern_africa"),
      place("lesotho", "Lesotho", "LS", "southern_africa"),
      place("eswatini", "Eswatini", "SZ", "southern_africa", ["Swaziland"]),
      place("algeria", "Algeria", "DZ", "north_africa"),
      place("libya", "Libya", "LY", "north_africa"),
      place("sudan", "Sudan", "SD", "north_africa"),
      place("western_sahara", "Western Sahara", "EH", "north_africa"),
      // Europe: the rest of Western Europe beside the countries already
      // under Europe, then the regions whose members are all new.
      place("ireland", "Ireland", "IE", "europe", ["Republic of Ireland"]),
      place("belgium", "Belgium", "BE", "europe"),
      place("luxembourg", "Luxembourg", "LU", "europe"),
      place("austria", "Austria", "AT", "europe"),
      place("switzerland", "Switzerland", "CH", "europe"),
      place("liechtenstein", "Liechtenstein", "LI", "europe"),
      place("monaco", "Monaco", "MC", "europe"),
      place("isle_of_man", "Isle of Man", "IM", "europe"),
      place("jersey", "Jersey", "JE", "europe"),
      place("guernsey", "Guernsey", "GG", "europe"),
      {
        code: "nordics",
        name: "Nordics",
        parent: "europe",
        description: "The Nordic countries and their territories.",
        aliases: [
          "the Nordics",
          "Nordic countries",
          "Nordic region",
          "Scandinavia",
        ],
      },
      place("denmark", "Denmark", "DK", "nordics"),
      place("sweden", "Sweden", "SE", "nordics"),
      place("norway", "Norway", "NO", "nordics"),
      place("finland", "Finland", "FI", "nordics"),
      place("iceland", "Iceland", "IS", "nordics"),
      place("faroe_islands", "Faroe Islands", "FO", "nordics"),
      place("aland_islands", "Åland Islands", "AX", "nordics", [
        "Aland Islands",
      ]),
      place("greenland", "Greenland", "GL", "nordics"),
      place(
        "svalbard_and_jan_mayen",
        "Svalbard and Jan Mayen",
        "SJ",
        "nordics",
      ),
      {
        code: "central_eastern_europe",
        name: "Central & Eastern Europe",
        parent: "europe",
        aliases: [
          "Central and Eastern Europe",
          "Eastern Europe",
          { alias: "CEE", type: "ABBREVIATION" },
        ],
      },
      place("poland", "Poland", "PL", "central_eastern_europe"),
      place("czechia", "Czechia", "CZ", "central_eastern_europe", [
        "Czech Republic",
      ]),
      place("slovakia", "Slovakia", "SK", "central_eastern_europe"),
      place("hungary", "Hungary", "HU", "central_eastern_europe"),
      place("romania", "Romania", "RO", "central_eastern_europe"),
      place("bulgaria", "Bulgaria", "BG", "central_eastern_europe"),
      place("slovenia", "Slovenia", "SI", "central_eastern_europe"),
      place("croatia", "Croatia", "HR", "central_eastern_europe"),
      place("estonia", "Estonia", "EE", "central_eastern_europe"),
      place("latvia", "Latvia", "LV", "central_eastern_europe"),
      place("lithuania", "Lithuania", "LT", "central_eastern_europe"),
      place("serbia", "Serbia", "RS", "central_eastern_europe"),
      place(
        "bosnia_and_herzegovina",
        "Bosnia and Herzegovina",
        "BA",
        "central_eastern_europe",
        ["Bosnia"],
      ),
      place("montenegro", "Montenegro", "ME", "central_eastern_europe"),
      place(
        "north_macedonia",
        "North Macedonia",
        "MK",
        "central_eastern_europe",
      ),
      place("albania", "Albania", "AL", "central_eastern_europe"),
      place("moldova", "Moldova", "MD", "central_eastern_europe"),
      place("ukraine", "Ukraine", "UA", "central_eastern_europe"),
      place("belarus", "Belarus", "BY", "central_eastern_europe"),
      place("russia", "Russia", "RU", "central_eastern_europe", [
        "Russian Federation",
      ]),
      { code: "southern_europe", name: "Southern Europe", parent: "europe" },
      place("spain", "Spain", "ES", "southern_europe"),
      place("portugal", "Portugal", "PT", "southern_europe"),
      place("italy", "Italy", "IT", "southern_europe"),
      place("greece", "Greece", "GR", "southern_europe"),
      place("malta", "Malta", "MT", "southern_europe"),
      place("cyprus", "Cyprus", "CY", "southern_europe"),
      place("andorra", "Andorra", "AD", "southern_europe"),
      place("san_marino", "San Marino", "SM", "southern_europe"),
      place("vatican_city", "Vatican City", "VA", "southern_europe", [
        "Holy See",
      ]),
      place("gibraltar", "Gibraltar", "GI", "southern_europe"),
      // North America.
      place("bermuda", "Bermuda", "BM", "north_america"),
      place(
        "saint_pierre_and_miquelon",
        "Saint Pierre and Miquelon",
        "PM",
        "north_america",
      ),
      // Latin America and the Caribbean.
      place("mexico", "Mexico", "MX", "latin_america"),
      place("argentina", "Argentina", "AR", "latin_america"),
      place("bolivia", "Bolivia", "BO", "latin_america"),
      place("chile", "Chile", "CL", "latin_america"),
      place("colombia", "Colombia", "CO", "latin_america"),
      place("ecuador", "Ecuador", "EC", "latin_america"),
      place("falkland_islands", "Falkland Islands", "FK", "latin_america"),
      place("french_guiana", "French Guiana", "GF", "latin_america"),
      place("guyana", "Guyana", "GY", "latin_america"),
      place("paraguay", "Paraguay", "PY", "latin_america"),
      place("peru", "Peru", "PE", "latin_america"),
      place("suriname", "Suriname", "SR", "latin_america"),
      place("uruguay", "Uruguay", "UY", "latin_america"),
      place("venezuela", "Venezuela", "VE", "latin_america"),
      {
        code: "central_america",
        name: "Central America",
        parent: "latin_america",
      },
      place("belize", "Belize", "BZ", "central_america"),
      place("costa_rica", "Costa Rica", "CR", "central_america"),
      place("el_salvador", "El Salvador", "SV", "central_america"),
      place("guatemala", "Guatemala", "GT", "central_america"),
      place("honduras", "Honduras", "HN", "central_america"),
      place("nicaragua", "Nicaragua", "NI", "central_america"),
      place("panama", "Panama", "PA", "central_america"),
      {
        code: "caribbean",
        name: "Caribbean",
        parent: "latin_america",
        aliases: ["the Caribbean"],
      },
      place("anguilla", "Anguilla", "AI", "caribbean"),
      place("antigua_and_barbuda", "Antigua and Barbuda", "AG", "caribbean"),
      place("aruba", "Aruba", "AW", "caribbean"),
      place("bahamas", "Bahamas", "BS", "caribbean", ["The Bahamas"]),
      place("barbados", "Barbados", "BB", "caribbean"),
      place(
        "caribbean_netherlands",
        "Bonaire, Sint Eustatius and Saba",
        "BQ",
        "caribbean",
        ["Caribbean Netherlands", "Bonaire"],
      ),
      place(
        "british_virgin_islands",
        "British Virgin Islands",
        "VG",
        "caribbean",
        ["BVI"],
      ),
      place("cayman_islands", "Cayman Islands", "KY", "caribbean"),
      place("cuba", "Cuba", "CU", "caribbean"),
      place("curacao", "Curaçao", "CW", "caribbean", ["Curacao"]),
      place("dominica", "Dominica", "DM", "caribbean"),
      place("dominican_republic", "Dominican Republic", "DO", "caribbean"),
      place("grenada", "Grenada", "GD", "caribbean"),
      place("guadeloupe", "Guadeloupe", "GP", "caribbean"),
      place("haiti", "Haiti", "HT", "caribbean"),
      place("jamaica", "Jamaica", "JM", "caribbean"),
      place("martinique", "Martinique", "MQ", "caribbean"),
      place("montserrat", "Montserrat", "MS", "caribbean"),
      place("puerto_rico", "Puerto Rico", "PR", "caribbean"),
      place("saint_barthelemy", "Saint Barthélemy", "BL", "caribbean", [
        "Saint Barthelemy",
        "St Barts",
      ]),
      place(
        "saint_kitts_and_nevis",
        "Saint Kitts and Nevis",
        "KN",
        "caribbean",
        ["St Kitts and Nevis"],
      ),
      place("saint_lucia", "Saint Lucia", "LC", "caribbean", ["St Lucia"]),
      place("saint_martin", "Saint Martin (French part)", "MF", "caribbean", [
        "Saint-Martin",
      ]),
      place(
        "saint_vincent_and_the_grenadines",
        "Saint Vincent and the Grenadines",
        "VC",
        "caribbean",
        ["St Vincent and the Grenadines"],
      ),
      place("sint_maarten", "Sint Maarten", "SX", "caribbean"),
      place("trinidad_and_tobago", "Trinidad and Tobago", "TT", "caribbean"),
      place(
        "turks_and_caicos_islands",
        "Turks and Caicos Islands",
        "TC",
        "caribbean",
      ),
      place("us_virgin_islands", "U.S. Virgin Islands", "VI", "caribbean", [
        "US Virgin Islands",
        "USVI",
      ]),
      // The Middle East beside the Gulf.
      place("israel", "Israel", "IL", "middle_east"),
      place("palestine", "Palestine", "PS", "middle_east", [
        "State of Palestine",
        "Palestinian Territories",
      ]),
      place("jordan", "Jordan", "JO", "middle_east"),
      place("lebanon", "Lebanon", "LB", "middle_east"),
      place("syria", "Syria", "SY", "middle_east"),
      place("iraq", "Iraq", "IQ", "middle_east"),
      place("iran", "Iran", "IR", "middle_east"),
      place("yemen", "Yemen", "YE", "middle_east"),
      place("turkey", "Turkey", "TR", "middle_east", ["Türkiye", "Turkiye"]),
      // Asia: South and Southeast Asia sit with India and Singapore under
      // Asia; East and Central Asia are regions of their own.
      place("pakistan", "Pakistan", "PK", "asia"),
      place("bangladesh", "Bangladesh", "BD", "asia"),
      place("sri_lanka", "Sri Lanka", "LK", "asia"),
      place("nepal", "Nepal", "NP", "asia"),
      place("bhutan", "Bhutan", "BT", "asia"),
      place("maldives", "Maldives", "MV", "asia"),
      place("afghanistan", "Afghanistan", "AF", "asia"),
      place("indonesia", "Indonesia", "ID", "asia"),
      place("malaysia", "Malaysia", "MY", "asia"),
      place("thailand", "Thailand", "TH", "asia"),
      place("vietnam", "Vietnam", "VN", "asia", ["Viet Nam"]),
      place("philippines", "Philippines", "PH", "asia", ["The Philippines"]),
      place("myanmar", "Myanmar", "MM", "asia", ["Burma"]),
      place("cambodia", "Cambodia", "KH", "asia"),
      place("laos", "Laos", "LA", "asia", ["Lao PDR"]),
      place("brunei", "Brunei", "BN", "asia", ["Brunei Darussalam"]),
      place("timor_leste", "Timor-Leste", "TL", "asia", ["East Timor"]),
      place("georgia", "Georgia", "GE", "asia"),
      place("armenia", "Armenia", "AM", "asia"),
      place("azerbaijan", "Azerbaijan", "AZ", "asia"),
      { code: "east_asia", name: "East Asia", parent: "asia" },
      place("china", "China", "CN", "east_asia", ["Mainland China", "PRC"]),
      place("hong_kong", "Hong Kong", "HK", "east_asia"),
      place("macao", "Macao", "MO", "east_asia", ["Macau"]),
      place("japan", "Japan", "JP", "east_asia"),
      place("south_korea", "South Korea", "KR", "east_asia", [
        "Korea",
        "Republic of Korea",
      ]),
      place("north_korea", "North Korea", "KP", "east_asia"),
      place("mongolia", "Mongolia", "MN", "east_asia"),
      place("taiwan", "Taiwan", "TW", "east_asia"),
      { code: "central_asia", name: "Central Asia", parent: "asia" },
      place("kazakhstan", "Kazakhstan", "KZ", "central_asia"),
      place("kyrgyzstan", "Kyrgyzstan", "KG", "central_asia"),
      place("tajikistan", "Tajikistan", "TJ", "central_asia"),
      place("turkmenistan", "Turkmenistan", "TM", "central_asia"),
      place("uzbekistan", "Uzbekistan", "UZ", "central_asia"),
      // Oceania.
      { code: "oceania", name: "Oceania", aliases: ["Australasia"] },
      place("australia", "Australia", "AU", "oceania"),
      place("new_zealand", "New Zealand", "NZ", "oceania"),
      place("fiji", "Fiji", "FJ", "oceania"),
      place("papua_new_guinea", "Papua New Guinea", "PG", "oceania"),
      place("samoa", "Samoa", "WS", "oceania"),
      place("tonga", "Tonga", "TO", "oceania"),
      place("vanuatu", "Vanuatu", "VU", "oceania"),
      place("solomon_islands", "Solomon Islands", "SB", "oceania"),
      place("kiribati", "Kiribati", "KI", "oceania"),
      place("tuvalu", "Tuvalu", "TV", "oceania"),
      place("nauru", "Nauru", "NR", "oceania"),
      place("marshall_islands", "Marshall Islands", "MH", "oceania"),
      place("micronesia", "Micronesia", "FM", "oceania", [
        "Federated States of Micronesia",
      ]),
      place("palau", "Palau", "PW", "oceania"),
      place("new_caledonia", "New Caledonia", "NC", "oceania"),
      place("french_polynesia", "French Polynesia", "PF", "oceania"),
      place("guam", "Guam", "GU", "oceania"),
      place("american_samoa", "American Samoa", "AS", "oceania"),
      place(
        "northern_mariana_islands",
        "Northern Mariana Islands",
        "MP",
        "oceania",
      ),
      place("cook_islands", "Cook Islands", "CK", "oceania"),
      place("niue", "Niue", "NU", "oceania"),
      place("tokelau", "Tokelau", "TK", "oceania"),
      place("wallis_and_futuna", "Wallis and Futuna", "WF", "oceania"),
      place("pitcairn_islands", "Pitcairn Islands", "PN", "oceania", [
        "Pitcairn",
      ]),
      place("norfolk_island", "Norfolk Island", "NF", "oceania"),
      place("christmas_island", "Christmas Island", "CX", "oceania"),
      place("cocos_islands", "Cocos (Keeling) Islands", "CC", "oceania", [
        "Cocos Islands",
      ]),
      place(
        "us_minor_outlying_islands",
        "United States Minor Outlying Islands",
        "UM",
        "oceania",
      ),
      // Antarctica: the continent is ISO 3166-1 AQ, with the territories
      // around it.
      {
        code: "antarctica",
        name: "Antarctica",
        metadata: { iso3166Alpha2: "AQ" },
        aliases: [{ alias: "AQ", type: "ABBREVIATION" }],
      },
      place("bouvet_island", "Bouvet Island", "BV", "antarctica"),
      place(
        "heard_and_mcdonald_islands",
        "Heard Island and McDonald Islands",
        "HM",
        "antarctica",
      ),
      place(
        "french_southern_territories",
        "French Southern Territories",
        "TF",
        "antarctica",
      ),
      place(
        "south_georgia_and_south_sandwich_islands",
        "South Georgia and the South Sandwich Islands",
        "GS",
        "antarctica",
        ["South Georgia"],
      ),
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
  // Live 2026-10-29: a founder's Telehealth (a product category) never met
  // an investor's Healthcare (an industry). Healthcare is broader than both
  // of its product categories; matching follows `broader_than` edges.
  {
    from: ["industry", "healthcare"],
    type: "broader_than",
    to: ["product_category", "telehealth"],
  },
  {
    from: ["industry", "healthcare"],
    type: "broader_than",
    to: ["product_category", "health_records"],
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
