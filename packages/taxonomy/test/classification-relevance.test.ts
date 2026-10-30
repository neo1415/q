import { describe, expect, it } from "vitest";

import type { DatabaseExecutor } from "@capital-q/database";

import type { TaxonomyReferenceRepository } from "../src/application/ports.js";
import { createTaxonomyClassifier } from "../src/classification/application/candidate-service.js";
import type {
  LexicalSearchHit,
  TaxonomyLexicalSearchRepository,
} from "../src/classification/application/ports.js";
import {
  TaxonomyCanonicalCodeSchema,
  TaxonomyNodeIdSchema,
  TaxonomyVocabularyCodeSchema,
  TaxonomyVocabularyIdSchema,
  type TaxonomyNode,
} from "../src/contracts/index.js";
import { REFERENCE_TAXONOMY } from "../src/reference-data/index.js";

/**
 * Onboarding suggestion relevance over the real V1 reference taxonomy,
 * without a database (live finding 2026-10-19: KUUZA AI was offered
 * "Hardware Sales" and "Identity Verification"). Retrieval mirrors the
 * PostgreSQL repository: token overlap, or pg_trgm word_similarity at the
 * floor. word_similarity is reproduced here as the best contiguous extent
 * of the query's trigrams, |shared| / (|label| + |extent| - |shared|), the
 * pg_trgm definition, so the scores are the ones production computes.
 */

function trigramsInOrder(text: string): string[] {
  const out: string[] = [];
  for (const word of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (word.length === 0) continue;
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i += 1) {
      out.push(padded.slice(i, i + 3));
    }
  }
  return out;
}

function wordSimilarity(label: string, query: string): number {
  const wanted = new Set(trigramsInOrder(label));
  const ordered = trigramsInOrder(query);
  let best = 0;
  for (let lower = 0; lower < ordered.length; lower += 1) {
    if (!wanted.has(ordered[lower] ?? "")) continue;
    const seen = new Set<string>();
    let shared = 0;
    for (let upper = lower; upper < ordered.length; upper += 1) {
      const trigram = ordered[upper] ?? "";
      if (!seen.has(trigram)) {
        seen.add(trigram);
        if (wanted.has(trigram)) shared += 1;
      }
      if (wanted.has(trigram)) {
        best = Math.max(best, shared / (wanted.size + seen.size - shared));
      }
    }
  }
  return best;
}

const nodes = new Map<string, TaxonomyNode>(
  REFERENCE_TAXONOMY.nodes.map((node) => [
    node.id,
    {
      id: TaxonomyNodeIdSchema.parse(node.id),
      vocabularyId: TaxonomyVocabularyIdSchema.parse(node.vocabularyId),
      vocabularyCode: TaxonomyVocabularyCodeSchema.parse(node.vocabularyCode),
      canonicalCode: TaxonomyCanonicalCodeSchema.parse(node.canonicalCode),
      displayName: node.displayName,
      description: node.description,
      parentNodeId:
        node.parentNodeId === null
          ? null
          : TaxonomyNodeIdSchema.parse(node.parentNodeId),
      depth: node.depth,
      status: node.status,
      validFrom: null,
      validTo: null,
      metadata: node.metadata,
    },
  ]),
);

const nodeOf = (id: string): TaxonomyNode => {
  const node = nodes.get(id);
  if (node === undefined) throw new Error(`unknown node ${id}`);
  return node;
};

const searchable: readonly {
  readonly nodeId: string;
  readonly field: LexicalSearchHit["field"];
  readonly text: string;
}[] = [
  ...REFERENCE_TAXONOMY.nodes.flatMap((node) => [
    {
      nodeId: node.id,
      field: "display_name" as const,
      text: node.displayName.trim().toLowerCase(),
    },
    {
      nodeId: node.id,
      field: "canonical_code" as const,
      text: node.canonicalCode.replaceAll("_", " ").replaceAll(".", " "),
    },
  ]),
  ...REFERENCE_TAXONOMY.aliases.map((alias) => ({
    nodeId: alias.nodeId,
    field: "alias" as const,
    text: alias.normalizedAlias,
  })),
];

const lexical: TaxonomyLexicalSearchRepository = {
  search: (_executor, query) =>
    Promise.resolve(
      searchable.flatMap((entry): LexicalSearchHit[] => {
        const node = nodeOf(entry.nodeId);
        if (!query.vocabularyCodes.includes(node.vocabularyCode)) return [];
        const similarity = wordSimilarity(entry.text, query.normalizedText);
        const overlap = entry.text
          .split(" ")
          .some((word) => query.tokens.includes(word));
        const similar =
          entry.text.length >= query.similarityMinCandidateLength &&
          similarity >= query.similarityFloor;
        return overlap || similar
          ? [
              {
                node,
                field: entry.field,
                text: entry.text,
                wordSimilarity: similarity,
              },
            ]
          : [];
      }),
    ),
  findByNormalizedDisplayName: (_executor, name, vocabularyCodes) =>
    Promise.resolve(
      [...nodes.values()].filter(
        (node) =>
          vocabularyCodes.includes(node.vocabularyCode) &&
          node.displayName.trim().toLowerCase() === name,
      ),
    ),
};

const unused = (): never => {
  throw new Error("not used by the classifier");
};

const reference: TaxonomyReferenceRepository = {
  listVocabularies: unused,
  findVocabularyByCode: unused,
  getVersionSet: unused,
  findNodeById: unused,
  findNodesByIds: unused,
  findNodeByCanonicalCode: (_executor, vocabularyCode, canonicalCode) =>
    Promise.resolve(
      [...nodes.values()].find(
        (node) =>
          node.vocabularyCode === vocabularyCode &&
          node.canonicalCode === canonicalCode,
      ) ?? null,
    ),
  listNodes: unused,
  listAncestors: unused,
  listDescendants: unused,
  listAliases: unused,
  findNodesByNormalizedAlias: (_executor, alias) =>
    Promise.resolve(
      REFERENCE_TAXONOMY.aliases
        .filter((candidate) => candidate.normalizedAlias === alias)
        .map((candidate) => nodeOf(candidate.nodeId)),
    ),
  listEdges: unused,
};

const classifier = createTaxonomyClassifier({ reference, lexical });
const executor = {} as DatabaseExecutor;

/** The founder onboarding category scope (CATEGORY_VOCABULARIES). */
const FOUNDER_CATEGORIES = [
  "industry",
  "product_category",
  "business_model",
  "customer_type",
].map((code) => TaxonomyVocabularyCodeSchema.parse(code));

async function suggest(
  text: string,
  vocabularyCodes = FOUNDER_CATEGORIES,
): Promise<readonly string[]> {
  const result = await classifier.classifyInScope(
    executor,
    { vocabularyCodes, versions: {} },
    { text, strategy: "AUTO", limit: 8 },
  );
  return result.candidates.map((c) => c.displayName);
}

describe("onboarding category suggestions stay relevant (taxonomy-lexical-v5)", () => {
  it("KUUZA AI's live one-liner is not offered Hardware Sales or Identity Verification", async () => {
    const offered = await suggest(
      "AI simulator and coach for practising sales, customer-service and other workplace conversations.",
    );
    expect(offered).not.toContain("Hardware Sales");
    expect(offered).not.toContain("Identity Verification");
    // One shared generic word of a two-word label is not a match.
    expect(offered).not.toContain("Embedded Finance");
    expect(offered).not.toContain("Financial Services");
  });

  it("KUUZA AI's hiring description suggests B2B SaaS and nothing unrelated", async () => {
    const offered = await suggest(
      "AI-powered hiring and skills assessment for African employers. B2B SaaS.",
    );
    expect(offered).toContain("B2B SaaS");
    expect(offered).not.toContain("Hardware Sales");
    expect(offered).not.toContain("Identity Verification");
    expect(offered).not.toContain("Consumer Subscription");
  });

  it("a longer hiring description drops one-word partial matches", async () => {
    const offered = await suggest(
      "KUUZA AI is an AI-powered hiring and skills assessment platform for African employers. " +
        "Employers use it to screen candidates, verify skills and reduce hiring time. " +
        "We sell B2B SaaS subscriptions to businesses across Nigeria, Kenya and South Africa.",
    );
    expect(offered).toContain("B2B SaaS");
    expect(offered).toContain("Business Customer");
    for (const unrelated of [
      "Hardware Sales",
      "Identity Verification",
      "Consumer Subscription",
      "Lending Platform",
      "Learning Platform",
      "Security Platform",
    ]) {
      expect(offered).not.toContain(unrelated);
    }
  });

  it("a digital lending description keeps its categories and loses Learning Platform", async () => {
    const offered = await suggest(
      "Digital lending platform giving working-capital loans to small retailers in Nigeria, " +
        "with credit scoring from mobile money data.",
    );
    expect(offered).toEqual(
      expect.arrayContaining([
        "Digital Lending",
        "Lending Platform",
        "Digital Wallet",
      ]),
    );
    expect(offered).not.toContain("Learning Platform");
  });

  it("a misspelt label is still found on whole-label similarity", async () => {
    const offered = await suggest("payment infrastucture", [
      TaxonomyVocabularyCodeSchema.parse("product_category"),
    ]);
    expect(offered[0]).toBe("Payment Infrastructure");
  });

  it("the Artificial Intelligence node exists in the technology vocabulary", async () => {
    const offered = await suggest(
      "AI-powered hiring and skills assessment for African employers.",
      [TaxonomyVocabularyCodeSchema.parse("technology")],
    );
    expect(offered).toContain("Artificial Intelligence");
  });
});

describe("taxonomy-lexical-v5 (live onboarding sweep 2026-10-29)", () => {
  it("a water leak-detection company is not offered Nonprofit & NGO or Gambling & Betting", async () => {
    const offered = await suggest(
      "We make acoustic sensors and analytics software that detect water leaks in utility pipe networks, cutting non-revenue water.",
    );
    expect(offered).not.toContain("Nonprofit & NGO");
    expect(offered).not.toContain("Gambling & Betting");
  });

  it("a one-word search inside a label finds it", async () => {
    expect(await suggest("analytics")).toContain("Data & Analytics Platform");
  });

  it("a misspelt short search still stands on similarity", async () => {
    expect(await suggest("paymnt infrastucture")).toContain(
      "Payment Infrastructure",
    );
  });
});
