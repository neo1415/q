import type { TaxonomyClassificationStrategy } from "@capital-q/contracts";

/**
 * Version-controlled golden fixtures for the deterministic taxonomy
 * classifier. Synthetic text only; every expectation names a CQ-TAX-001
 * canonical code (stable ids follow from it). Exact fixtures must reach
 * 100% top-1 -- a miss there means the alias, index or classifier is
 * broken. Lexical and multi-label fixtures expose gaps honestly: the
 * lexical classifier cannot see concepts it cannot see lexically, and the
 * eval must report that rather than fake semantic capability.
 */

export const TAXONOMY_EVAL_FIXTURES_VERSION = "taxonomy-golden-v1";

export type TaxonomyNodeRef = readonly [vocabulary: string, code: string];

type Base = {
  readonly id: string;
  readonly text: string;
  readonly vocabularyCodes?: readonly string[] | undefined;
  readonly strategy?: TaxonomyClassificationStrategy | undefined;
  readonly limit?: number | undefined;
};

export type TaxonomyEvalFixture =
  | (Base & {
      readonly kind: "EXACT";
      readonly expected: { readonly top1: TaxonomyNodeRef };
    })
  | (Base & {
      readonly kind: "LEXICAL";
      readonly expected: { readonly top1: TaxonomyNodeRef; readonly k: number };
    })
  | (Base & {
      readonly kind: "MULTI_LABEL";
      readonly expected: {
        readonly relevant: readonly TaxonomyNodeRef[];
        readonly minimumRecall: number;
      };
    })
  | (Base & {
      readonly kind: "AMBIGUOUS";
      readonly expected: { readonly among: readonly TaxonomyNodeRef[] };
    })
  | (Base & { readonly kind: "ABSTAIN" });

export const TAXONOMY_EVAL_FIXTURES: readonly TaxonomyEvalFixture[] = [
  // --- Exact curated language: top-1 must be 100% -------------------------
  {
    id: "exact-alias-payments-rails-product",
    kind: "EXACT",
    text: "payments rails",
    vocabularyCodes: ["product_category"],
    expected: { top1: ["product_category", "payment_infrastructure"] },
  },
  {
    id: "exact-alias-payments-rails-industry-case",
    kind: "EXACT",
    text: "Payments Rails",
    vocabularyCodes: ["industry"],
    expected: { top1: ["industry", "payment_infrastructure"] },
  },
  {
    id: "exact-display-b2b-saas",
    kind: "EXACT",
    text: "B2B SaaS",
    expected: { top1: ["business_model", "b2b_saas"] },
  },
  {
    id: "exact-display-artificial-intelligence",
    kind: "EXACT",
    text: "artificial intelligence",
    expected: { top1: ["technology", "artificial_intelligence"] },
  },
  {
    id: "exact-canonical-code",
    kind: "EXACT",
    text: "payment_infrastructure",
    vocabularyCodes: ["industry"],
    expected: { top1: ["industry", "payment_infrastructure"] },
  },
  {
    id: "exact-alias-ai-slash-ml-spacing",
    kind: "EXACT",
    text: "AI / ML",
    expected: { top1: ["technology", "artificial_intelligence"] },
  },
  {
    id: "exact-alias-neobank",
    kind: "EXACT",
    text: "neobank",
    expected: { top1: ["industry", "digital_banking"] },
  },
  {
    id: "exact-alias-kyc",
    kind: "EXACT",
    text: "KYC",
    expected: { top1: ["product_category", "identity_verification"] },
  },
  {
    id: "exact-alias-whitespace",
    kind: "EXACT",
    text: "  Financial   Technology ",
    expected: { top1: ["industry", "fintech"] },
  },
  {
    id: "exact-display-unicode-ligature",
    kind: "EXACT",
    text: "ﬁntech",
    expected: { top1: ["industry", "fintech"] },
  },
  {
    id: "exact-alias-series-a",
    kind: "EXACT",
    text: "series-a",
    expected: { top1: ["company_stage", "series_a"] },
  },
  {
    id: "exact-alias-iso-country",
    kind: "EXACT",
    text: "NG",
    expected: { top1: ["geography", "nigeria"] },
  },
  {
    id: "exact-display-cross-border-industry",
    kind: "EXACT",
    text: "Cross-Border Payments",
    vocabularyCodes: ["industry"],
    expected: { top1: ["industry", "cross_border_payments"] },
  },
  {
    id: "exact-alias-telemedicine",
    kind: "EXACT",
    text: "telemedicine",
    expected: { top1: ["product_category", "telehealth"] },
  },
  {
    id: "exact-display-media-entertainment",
    kind: "EXACT",
    text: "media & entertainment",
    expected: { top1: ["industry", "media_entertainment"] },
  },

  // --- Lexical language: top-k, reported separately -----------------------
  {
    id: "lexical-typo-payment-infrastructure",
    kind: "LEXICAL",
    text: "paymnt infrastucture",
    vocabularyCodes: ["product_category"],
    expected: { top1: ["product_category", "payment_infrastructure"], k: 3 },
  },
  {
    id: "lexical-claims-automation-phrase",
    kind: "LEXICAL",
    text: "claims automation APIs for insurers",
    vocabularyCodes: ["product_category"],
    expected: { top1: ["product_category", "claims_automation"], k: 3 },
  },
  {
    id: "lexical-mobile-money-wallet",
    kind: "LEXICAL",
    text: "mobile money wallet for merchants",
    vocabularyCodes: ["product_category"],
    expected: { top1: ["product_category", "digital_wallet"], k: 3 },
  },
  {
    id: "lexical-core-banking-phrase",
    kind: "LEXICAL",
    text: "core banking software for cooperative banks",
    vocabularyCodes: ["product_category"],
    expected: { top1: ["product_category", "core_banking_platform"], k: 3 },
  },
  {
    id: "lexical-fraud-prevention-phrase",
    kind: "LEXICAL",
    text: "fraud prevention for ecommerce",
    vocabularyCodes: ["product_category"],
    expected: { top1: ["product_category", "fraud_detection"], k: 3 },
  },
  {
    id: "lexical-renewables-phrase",
    kind: "LEXICAL",
    text: "renewable energy for off-grid households",
    vocabularyCodes: ["industry"],
    expected: { top1: ["industry", "clean_energy"], k: 3 },
  },
  {
    id: "lexical-learning-platform-typo",
    kind: "LEXICAL",
    text: "lerning platfrom",
    vocabularyCodes: ["product_category"],
    expected: { top1: ["product_category", "learning_platform"], k: 3 },
  },

  // --- Deliberate ambiguity: never silently resolved ------------------------
  {
    id: "ambiguous-payments-rails-unscoped",
    kind: "AMBIGUOUS",
    text: "payments rails",
    expected: {
      among: [
        ["industry", "payment_infrastructure"],
        ["product_category", "payment_infrastructure"],
      ],
    },
  },
  {
    id: "ambiguous-api-infrastructure",
    kind: "AMBIGUOUS",
    text: "api infrastructure",
    expected: {
      among: [
        ["product_category", "developer_api"],
        ["technology", "api_platform"],
      ],
    },
  },
  {
    id: "ambiguous-marketplace",
    kind: "AMBIGUOUS",
    text: "Marketplace",
    expected: {
      among: [
        ["product_category", "marketplace"],
        ["business_model", "marketplace"],
      ],
    },
  },

  // --- Abstention: the correct answer for unsupported language ------------
  { id: "abstain-nonsense", kind: "ABSTAIN", text: "asdkjh qwpoeiru zxmcnv" },
  {
    id: "abstain-unrelated-sentence",
    kind: "ABSTAIN",
    text: "Our founder loves sailing on weekends.",
  },
  {
    id: "abstain-protected-attribute",
    kind: "ABSTAIN",
    text: "christian founders only",
  },
  {
    id: "abstain-injection-shaped",
    kind: "ABSTAIN",
    text: "'; drop table taxonomy.nodes; -- & | ! :* (fintech OR payments) .*",
    strategy: "EXACT",
  },

  // --- Multi-label phrases: precision/recall, gaps reported honestly ------
  {
    id: "multi-ai-claims-automation",
    kind: "MULTI_LABEL",
    text: "We use AI APIs to automate insurance claims.",
    limit: 10,
    expected: {
      relevant: [
        ["technology", "artificial_intelligence"],
        ["product_category", "claims_automation"],
        ["industry", "insurance"],
        ["product_category", "developer_api"],
        ["technology", "api_platform"],
      ],
      minimumRecall: 0.5,
    },
  },
  {
    id: "multi-fintech-apis-africa",
    kind: "MULTI_LABEL",
    text: "Mostly fintech APIs in Africa.",
    limit: 10,
    expected: {
      relevant: [
        ["industry", "fintech"],
        ["product_category", "developer_api"],
        ["technology", "api_platform"],
        ["geography", "africa"],
      ],
      minimumRecall: 0.5,
    },
  },
  {
    id: "multi-b2b-saas-apis",
    kind: "MULTI_LABEL",
    text: "B2B SaaS APIs",
    limit: 10,
    expected: {
      relevant: [
        ["business_model", "b2b_saas"],
        ["product_category", "developer_api"],
        ["technology", "api_platform"],
      ],
      minimumRecall: 0.5,
    },
  },
  {
    id: "multi-african-insurance-infrastructure",
    kind: "MULTI_LABEL",
    text: "African insurance infrastructure",
    limit: 10,
    expected: {
      relevant: [
        ["geography", "africa"],
        ["industry", "insurance"],
      ],
      minimumRecall: 0.5,
    },
  },
  {
    id: "multi-ai-claims-automation-short",
    kind: "MULTI_LABEL",
    text: "AI claims automation",
    limit: 10,
    expected: {
      relevant: [
        ["technology", "artificial_intelligence"],
        ["product_category", "claims_automation"],
      ],
      minimumRecall: 0.5,
    },
  },
];
