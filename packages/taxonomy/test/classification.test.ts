import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  TAXONOMY_ABSTENTION_REASONS,
  TAXONOMY_CLASSIFICATION_RESOLUTIONS,
  TAXONOMY_CLASSIFICATION_STRATEGIES,
  TAXONOMY_MATCH_TYPES,
  TaxonomyCandidateRequestSchema,
  TaxonomyCandidateResponseSchema,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";

import type { TaxonomyReferenceRepository } from "../src/application/ports.js";
import {
  createTaxonomyClassifier,
  type TaxonomyClassifier,
} from "../src/classification/application/candidate-service.js";
import type {
  TaxonomyCandidateGenerator,
  TaxonomyLexicalSearchRepository,
} from "../src/classification/application/ports.js";
import {
  TAXONOMY_CLASSIFIER_IDENTITY,
  TAXONOMY_CLASSIFIER_MODEL,
  TAXONOMY_CLASSIFIER_PROVIDER,
  TAXONOMY_CLASSIFIER_VERSION,
  TaxonomyClassificationRunMetadataSchema,
  type TaxonomyCandidate,
} from "../src/classification/contracts/index.js";
import { TaxonomyClassifierNotAvailableError } from "../src/classification/domain/errors.js";
import { TAXONOMY_CLASSIFICATION_POLICY_V1 as policy } from "../src/classification/domain/policy.js";
import {
  mergeCandidates,
  resolveCandidates,
} from "../src/classification/domain/resolve.js";
import {
  formatConfidence,
  lexicalConfidence,
  lexicalScore,
  tokenCoverage,
} from "../src/classification/domain/scoring.js";
import {
  hashClassificationInput,
  normalizeClassificationInput,
  tokenizeForLexicalSearch,
} from "../src/classification/domain/tokenize.js";
import {
  TAXONOMY_EVAL_FIXTURES,
  TAXONOMY_EVAL_FIXTURES_VERSION,
} from "../src/classification/evaluation/fixtures.js";
import {
  gradeFixture,
  summarizeEval,
} from "../src/classification/evaluation/graders.js";
import { TaxonomyVocabularyNotFoundError } from "../src/domain/errors.js";
import { normalizeTaxonomyAlias } from "../src/domain/normalize-alias.js";
import type {
  TaxonomyNode,
  TaxonomyVocabulary,
} from "../src/contracts/index.js";

/**
 * Deterministic classification behaviour without a database: contract
 * bounds, tokenisation, the versioned scoring formula, merge / rank /
 * ambiguity / abstention, strategy handling and the eval graders. The
 * same pipeline is proven against PostgreSQL in the integration suite.
 */

const V = (code: string): TaxonomyVocabulary => ({
  id: `9e323247-8a4b-575b-acdc-6f682f0d6a7${code.length}` as never,
  code,
  name: code,
  description: null,
  version: 1,
  status: "ACTIVE",
  createdAt: "2026-09-04T00:00:00.000Z",
});

let counter = 0;
const N = (
  vocabularyCode: string,
  canonicalCode: string,
  displayName = canonicalCode,
  status: TaxonomyNode["status"] = "ACTIVE",
): TaxonomyNode => ({
  id: `f0000000-0000-4000-8000-${String(++counter).padStart(12, "0")}` as never,
  vocabularyId: V(vocabularyCode).id,
  vocabularyCode,
  canonicalCode,
  displayName,
  description: null,
  parentNodeId: null,
  depth: 0,
  status,
  validFrom: null,
  validTo: null,
  metadata: {},
});

const INDUSTRY_PI = N(
  "industry",
  "payment_infrastructure",
  "Payment Infrastructure",
);
const PRODUCT_PI = N(
  "product_category",
  "payment_infrastructure",
  "Payment Infrastructure",
);
const CLAIMS = N("product_category", "claims_automation", "Claims Automation");
const AI = N(
  "technology",
  "artificial_intelligence",
  "Artificial Intelligence",
);
const DEPRECATED = N("industry", "old_thing", "Old Thing", "DEPRECATED");

const hit = (
  node: TaxonomyNode,
  matchType: TaxonomyCandidate["matchType"],
  score = 1,
  matchedText = node.canonicalCode,
): TaxonomyCandidate => ({ node, matchType, score, matchedText });

describe("contracts (§181)", () => {
  it("bounds the candidate request and keeps the vocabularies closed", () => {
    const ok = TaxonomyCandidateRequestSchema.safeParse({
      text: "payments rails",
      vocabularyCodes: ["industry"],
      strategy: "AUTO",
      limit: 5,
    });
    expect(ok.success).toBe(true);
    for (const bad of [
      { text: "" },
      { text: "   " },
      { text: "x".repeat(2049) },
      { text: "x", limit: 0 },
      { text: "x", limit: 21 },
      { text: "x", vocabularyCodes: [] },
      { text: "x", vocabularyCodes: ["industry", "industry"] },
      { text: "x", vocabularyCodes: ["Industry"] },
      { text: "x", strategy: "LLM" },
      { text: "x", tenantId: "spoof" },
      { text: "x", assignmentSource: "admin_curated" },
    ]) {
      expect(
        TaxonomyCandidateRequestSchema.safeParse(bad).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
    expect([...TAXONOMY_CLASSIFICATION_STRATEGIES]).toEqual([
      "AUTO",
      "EXACT",
      "LEXICAL",
      "SEMANTIC",
      "MODEL",
    ]);
    expect([...TAXONOMY_MATCH_TYPES]).toEqual([
      "CANONICAL_CODE_EXACT",
      "ALIAS_EXACT",
      "DISPLAY_NAME_EXACT",
      "LEXICAL",
    ]);
    expect([...TAXONOMY_CLASSIFICATION_RESOLUTIONS]).toEqual([
      "EXACT",
      "CANDIDATES",
      "AMBIGUOUS",
      "ABSTAINED",
    ]);
    expect([...TAXONOMY_ABSTENTION_REASONS]).toEqual([
      "NO_CANDIDATES",
      "LOW_CONFIDENCE",
      "AMBIGUOUS_CANDIDATES",
      "NO_ACTIVE_VOCABULARY",
      "UNSUPPORTED_STRATEGY",
    ]);
  });

  it("validates the response: rank >= 1, four-place confidence, version set, honest classifier identity", () => {
    const base = {
      resolution: "EXACT",
      candidates: [
        {
          nodeId: INDUSTRY_PI.id,
          vocabularyCode: "industry",
          canonicalCode: "payment_infrastructure",
          displayName: "Payment Infrastructure",
          rank: 1,
          confidence: "1.0000",
          matchTypes: ["CANONICAL_CODE_EXACT"],
          rationaleSummary: "Exact canonical code match.",
        },
      ],
      taxonomyVersions: { industry: 1 },
      classifier: TAXONOMY_CLASSIFIER_IDENTITY,
    };
    expect(TaxonomyCandidateResponseSchema.safeParse(base).success).toBe(true);
    expect(
      TaxonomyCandidateResponseSchema.safeParse({
        ...base,
        candidates: [{ ...base.candidates[0], rank: 0 }],
      }).success,
    ).toBe(false);
    expect(
      TaxonomyCandidateResponseSchema.safeParse({
        ...base,
        candidates: [{ ...base.candidates[0], confidence: "0.82" }],
      }).success,
    ).toBe(false);
    expect(
      TaxonomyCandidateResponseSchema.safeParse({
        ...base,
        classifier: { provider: "openai", model: "gpt", version: "1" },
      }).success,
    ).toBe(false);
    expect(TAXONOMY_CLASSIFIER_PROVIDER).toBe("capital_q");
    expect(TAXONOMY_CLASSIFIER_MODEL).toBe("deterministic_lexical");
    expect(TAXONOMY_CLASSIFIER_VERSION).toBe("taxonomy-lexical-v1");
    expect(policy.version).toBe(TAXONOMY_CLASSIFIER_VERSION);
  });

  it("run metadata is bounded and can never carry raw text", () => {
    expect(
      TaxonomyClassificationRunMetadataSchema.safeParse({
        strategy: "AUTO",
        resolution: "CANDIDATES",
        candidateCount: 3,
        vocabularyCodes: ["industry"],
        inputHash: hashClassificationInput("x"),
        inputLength: 1,
      }).success,
    ).toBe(true);
    expect(
      TaxonomyClassificationRunMetadataSchema.safeParse({ text: "raw" })
        .success,
    ).toBe(false);
    expect(
      TaxonomyClassificationRunMetadataSchema.safeParse({ prompt: "p" })
        .success,
    ).toBe(false);
  });
});

describe("normalisation and tokenisation (§18-19, §159-161)", () => {
  it("reuses the CQ-TAX-001 normaliser exactly and never rewrites meaning", () => {
    for (const text of [
      "  B2B   Payment APIs ",
      "AI / ML",
      "ﬁntech",
      "Claims Ops",
    ]) {
      expect(normalizeClassificationInput(text)).toBe(
        normalizeTaxonomyAlias(text),
      );
    }
    expect(normalizeClassificationInput("claims ops")).toBe("claims ops");
  });

  it("tokenises to alphanumerics minus stop words; injection-shaped input is just data", () => {
    expect(
      tokenizeForLexicalSearch(
        normalizeClassificationInput(
          "We use AI APIs to automate insurance claims.",
        ),
        policy,
      ),
    ).toEqual(["use", "ai", "apis", "automate", "insurance", "claims"]);
    expect(
      tokenizeForLexicalSearch(
        normalizeClassificationInput(
          "'; drop table taxonomy.nodes; -- & | ! :* (fintech OR payments) .*",
        ),
        policy,
      ),
    ).toEqual(["drop", "table", "taxonomy", "nodes", "fintech", "payments"]);
    expect(tokenizeForLexicalSearch("a b c", policy)).toEqual([]);
    expect(tokenizeForLexicalSearch("payments payments", policy)).toEqual([
      "payments",
    ]);
  });

  it("hashes input deterministically as a 64-hex SHA-256", () => {
    expect(hashClassificationInput("payments rails")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashClassificationInput("payments rails")).toBe(
      hashClassificationInput("payments rails"),
    );
    expect(hashClassificationInput("payments rails")).not.toBe(
      hashClassificationInput("payment rails"),
    );
  });
});

describe("scoring formula taxonomy-lexical-v1 (§37-39)", () => {
  it("credits exact tokens fully and prefixes partially", () => {
    expect(
      tokenCoverage(["claims", "automation"], ["claims", "automation"], policy),
    ).toEqual({ coverage: 1, matched: 2 });
    expect(tokenCoverage(["apis"], ["developer", "api"], policy)).toEqual({
      coverage: policy.lexical.prefixTokenCredit / 2,
      matched: 1,
    });
    expect(tokenCoverage(["ai"], ["aid"], policy).coverage).toBe(0);
    expect(tokenCoverage([], ["x"], policy).coverage).toBe(0);
  });

  it("combines coverage and word similarity with central weights; aliases weigh slightly less", () => {
    const full = lexicalScore(
      {
        queryTokens: ["claims", "automation"],
        candidateTokens: ["claims", "automation"],
        candidateText: "claims automation",
        wordSimilarity: 1,
        field: "display_name",
      },
      policy,
    );
    expect(full.score).toBe(1);
    const alias = lexicalScore(
      {
        queryTokens: ["claims", "automation"],
        candidateTokens: ["claims", "automation"],
        candidateText: "claims automation",
        wordSimilarity: 1,
        field: "alias",
      },
      policy,
    );
    expect(alias.score).toBe(policy.lexical.aliasFieldWeight);
    const partial = lexicalScore(
      {
        queryTokens: ["insurers"],
        candidateTokens: ["insurance"],
        candidateText: "insurance",
        wordSimilarity: 0.5,
        field: "display_name",
      },
      policy,
    );
    // Similarity alone carries a misspelt / inflected label: max(blend, similarity).
    expect(partial.score).toBe(0.5);
    const short = lexicalScore(
      {
        queryTokens: ["zxmcnv"],
        candidateTokens: ["asia"],
        candidateText: "asia",
        wordSimilarity: 0.4,
        field: "display_name",
      },
      policy,
    );
    expect(short.score).toBe(0);
    expect(
      lexicalScore(
        {
          queryTokens: ["x"],
          candidateTokens: ["y"],
          candidateText: "yyyyyyy",
          wordSimilarity: Number.NaN,
          field: "alias",
        },
        policy,
      ).score,
    ).toBe(0);
  });

  it("formats confidence as an exact four-place string below the exact tiers", () => {
    expect(formatConfidence(1)).toBe("1.0000");
    expect(formatConfidence(0.95)).toBe("0.9500");
    expect(lexicalConfidence(1, policy)).toBe("0.8500");
    expect(lexicalConfidence(0.5, policy)).toBe("0.4250");
    expect(Number(lexicalConfidence(1, policy))).toBeLessThan(
      Number(policy.exactConfidence.ALIAS_EXACT),
    );
  });
});

describe("merge, rank, ambiguity, abstention (§29-32, §44-50)", () => {
  it("returns one node once with every match type and exact tiers first", () => {
    const merged = mergeCandidates([
      hit(AI, "LEXICAL", 0.9),
      hit(AI, "DISPLAY_NAME_EXACT"),
      hit(AI, "ALIAS_EXACT", 1, "ai"),
    ]);
    expect(merged).toHaveLength(1);
    expect([...(merged[0]?.matchTypes ?? [])].sort()).toEqual([
      "ALIAS_EXACT",
      "DISPLAY_NAME_EXACT",
      "LEXICAL",
    ]);
    const resolved = resolveCandidates(
      [hit(CLAIMS, "LEXICAL", 0.99), hit(INDUSTRY_PI, "CANONICAL_CODE_EXACT")],
      policy,
      5,
    );
    expect(resolved.resolution).toBe("EXACT");
    expect(resolved.candidates.map((c) => c.canonicalCode)).toEqual([
      "payment_infrastructure",
    ]);
    expect(resolved.candidates[0]?.confidence).toBe("1.0000");
    expect(resolved.candidates[0]?.rationaleSummary).toBe(
      "Exact canonical code match.",
    );
  });

  it("an alias shared by two nodes is AMBIGUOUS, never silently resolved", () => {
    const resolved = resolveCandidates(
      [
        hit(INDUSTRY_PI, "ALIAS_EXACT", 1, "payments rails"),
        hit(PRODUCT_PI, "ALIAS_EXACT", 1, "payments rails"),
      ],
      policy,
      5,
    );
    expect(resolved.resolution).toBe("AMBIGUOUS");
    expect(resolved.abstentionReason).toBe("AMBIGUOUS_CANDIDATES");
    expect(
      resolved.candidates.map((c) => [c.rank, c.vocabularyCode, c.confidence]),
    ).toEqual([
      [1, "industry", "0.9500"],
      [2, "product_category", "0.9500"],
    ]);
    expect(resolved.candidates[0]?.rationaleSummary).toContain(
      '"payments rails"',
    );
  });

  it("lexical hits are CANDIDATES above the minimum, AMBIGUOUS on a same-vocabulary tie, ABSTAINED otherwise", () => {
    const candidates = resolveCandidates(
      [hit(CLAIMS, "LEXICAL", 0.8), hit(AI, "LEXICAL", 0.7)],
      policy,
      5,
    );
    expect(candidates.resolution).toBe("CANDIDATES");
    expect(
      candidates.candidates.map((c) => [c.rank, c.canonicalCode, c.confidence]),
    ).toEqual([
      [1, "claims_automation", "0.6800"],
      [2, "artificial_intelligence", "0.5950"],
    ]);
    const tie = resolveCandidates(
      [hit(CLAIMS, "LEXICAL", 0.7), hit(PRODUCT_PI, "LEXICAL", 0.69)],
      policy,
      5,
    );
    expect(tie.resolution).toBe("AMBIGUOUS");
    const low = resolveCandidates([hit(CLAIMS, "LEXICAL", 0.2)], policy, 5);
    expect(low).toEqual({
      resolution: "ABSTAINED",
      candidates: [],
      abstentionReason: "LOW_CONFIDENCE",
    });
    expect(resolveCandidates([], policy, 5)).toEqual({
      resolution: "ABSTAINED",
      candidates: [],
      abstentionReason: "NO_CANDIDATES",
    });
  });

  it("bounds results, keeps ranks contiguous and orders deterministically", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      hit(N("industry", `n${i}`), "LEXICAL", 0.9 - i * 0.01),
    );
    const resolved = resolveCandidates(many, policy, 5);
    expect(resolved.candidates.map((c) => c.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(resolved.resolution).toBe("AMBIGUOUS");
    const a = resolveCandidates(
      [hit(AI, "LEXICAL", 0.5), hit(CLAIMS, "LEXICAL", 0.5)],
      policy,
      5,
    );
    const b = resolveCandidates(
      [hit(CLAIMS, "LEXICAL", 0.5), hit(AI, "LEXICAL", 0.5)],
      policy,
      5,
    );
    expect(a.candidates.map((c) => c.canonicalCode)).toEqual(
      b.candidates.map((c) => c.canonicalCode),
    );
    expect(a.candidates[0]?.rationaleSummary.length).toBeLessThanOrEqual(300);
  });
});

// ---------------------------------------------------------------------------
// Classifier over in-memory doubles
// ---------------------------------------------------------------------------

const notUnderTest = () => Promise.reject(new Error("not under test"));

function fakeReference(
  vocabularies: readonly TaxonomyVocabulary[],
  nodes: readonly TaxonomyNode[],
  aliases: ReadonlyMap<string, readonly TaxonomyNode[]>,
): TaxonomyReferenceRepository {
  return {
    listVocabularies: () =>
      Promise.resolve(vocabularies.filter((v) => v.status === "ACTIVE")),
    findVocabularyByCode: (_e, code) =>
      Promise.resolve(vocabularies.find((v) => v.code === code) ?? null),
    findNodeById: notUnderTest,
    findNodesByIds: notUnderTest,
    findNodeByCanonicalCode: (_e, vocabularyCode, canonicalCode) =>
      Promise.resolve(
        nodes.find(
          (n) =>
            n.vocabularyCode === vocabularyCode &&
            n.canonicalCode === canonicalCode,
        ) ?? null,
      ),
    listNodes: notUnderTest,
    listAncestors: notUnderTest,
    listDescendants: notUnderTest,
    listAliases: notUnderTest,
    findNodesByNormalizedAlias: (_e, alias) =>
      Promise.resolve(aliases.get(alias) ?? []),
    listEdges: notUnderTest,
    getVersionSet: () =>
      Promise.resolve(
        Object.fromEntries(
          vocabularies
            .filter((v) => v.status === "ACTIVE")
            .map((v) => [v.code, v.version]),
        ),
      ),
  };
}

function fakeLexical(
  nodes: readonly TaxonomyNode[],
): TaxonomyLexicalSearchRepository & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    search: (_e, query) => {
      calls.push(query.normalizedText);
      return Promise.resolve(
        nodes
          .filter(
            (n) =>
              n.status === "ACTIVE" &&
              query.vocabularyCodes.includes(n.vocabularyCode),
          )
          .map((n) => ({
            node: n,
            field: "display_name" as const,
            text: n.displayName.toLowerCase(),
            wordSimilarity: 0.4,
          })),
      );
    },
    findByNormalizedDisplayName: (_e, name, codes) =>
      Promise.resolve(
        nodes.filter(
          (n) =>
            codes.includes(n.vocabularyCode) &&
            n.displayName.toLowerCase() === name,
        ),
      ),
  };
}

const sql = {} as DatabaseExecutor;

function classifier(): {
  readonly classifier: TaxonomyClassifier;
  readonly lexical: ReturnType<typeof fakeLexical>;
} {
  const nodes = [INDUSTRY_PI, PRODUCT_PI, CLAIMS, AI, DEPRECATED];
  const aliases = new Map<string, readonly TaxonomyNode[]>([
    ["payments rails", [INDUSTRY_PI, PRODUCT_PI]],
    ["ai", [AI]],
    ["old", [DEPRECATED]],
  ]);
  const lexical = fakeLexical(nodes);
  const vocabularies = [
    V("industry"),
    V("product_category"),
    V("technology"),
    { ...V("legacy"), status: "RETIRED" as const },
  ];
  return {
    classifier: createTaxonomyClassifier({
      reference: fakeReference(vocabularies, nodes, aliases),
      lexical,
    }),
    lexical,
  };
}

describe("classifier strategies and scope (§16-17, §22-25, §188)", () => {
  it("refuses SEMANTIC and MODEL with a typed error and never substitutes lexical search", () => {
    const { classifier: c } = classifier();
    expect(() => c.requireSupportedStrategy("SEMANTIC")).toThrow(
      TaxonomyClassifierNotAvailableError,
    );
    expect(() => c.requireSupportedStrategy("MODEL")).toThrow(
      TaxonomyClassifierNotAvailableError,
    );
    expect(c.requireSupportedStrategy(undefined)).toBe("AUTO");
  });

  it("AUTO stops after an exact hit; EXACT never touches lexical; LEXICAL merges both", async () => {
    const { classifier: c, lexical } = classifier();
    const scope = await c.resolveScope(sql, ["industry"]);
    const auto = await c.classifyInScope(sql, scope, {
      text: "payment_infrastructure",
      strategy: "AUTO",
      limit: 5,
    });
    expect(auto.resolution).toBe("EXACT");
    expect(lexical.calls).toEqual([]);
    const exact = await c.classifyInScope(sql, scope, {
      text: "some phrase",
      strategy: "EXACT",
      limit: 5,
    });
    expect(exact).toMatchObject({
      resolution: "ABSTAINED",
      abstentionReason: "NO_CANDIDATES",
    });
    expect(lexical.calls).toEqual([]);
    const lex = await c.classifyInScope(sql, scope, {
      text: "payment infrastructure",
      strategy: "LEXICAL",
      limit: 5,
    });
    expect(lexical.calls).toEqual(["payment infrastructure"]);
    expect(lex.candidates[0]).toMatchObject({
      canonicalCode: "payment_infrastructure",
      matchTypes: ["DISPLAY_NAME_EXACT", "LEXICAL"],
    });
  });

  it("scopes to requested vocabularies, rejects unknown ones, drops retired ones and reports the version set", async () => {
    const { classifier: c } = classifier();
    const scoped = await c.resolveScope(sql, ["product_category"]);
    expect(scoped).toEqual({
      vocabularyCodes: ["product_category"],
      versions: { product_category: 1 },
    });
    const result = await c.classifyInScope(sql, scoped, {
      text: "payments rails",
      strategy: "AUTO",
      limit: 5,
    });
    expect(result.resolution).toBe("EXACT");
    expect(result.candidates.map((x) => x.vocabularyCode)).toEqual([
      "product_category",
    ]);
    expect(result.taxonomyVersions).toEqual({ product_category: 1 });
    expect(result.classifier).toEqual(TAXONOMY_CLASSIFIER_IDENTITY);
    const unscoped = await c.classifyInScope(
      sql,
      await c.resolveScope(sql, undefined),
      { text: "Payments  Rails", strategy: "AUTO", limit: 5 },
    );
    expect(unscoped.resolution).toBe("AMBIGUOUS");
    await expect(c.resolveScope(sql, ["nope"])).rejects.toBeInstanceOf(
      TaxonomyVocabularyNotFoundError,
    );
    const retired = await c.resolveScope(sql, ["legacy"]);
    expect(retired.vocabularyCodes).toEqual([]);
    expect(
      await c.classifyInScope(sql, retired, {
        text: "ai",
        strategy: "AUTO",
        limit: 5,
      }),
    ).toMatchObject({
      resolution: "ABSTAINED",
      abstentionReason: "NO_ACTIVE_VOCABULARY",
    });
  });

  it("never suggests a DEPRECATED node", async () => {
    const { classifier: c } = classifier();
    const scope = await c.resolveScope(sql, undefined);
    const result = await c.classifyInScope(sql, scope, {
      text: "old",
      strategy: "LEXICAL",
      limit: 5,
    });
    expect(result.candidates.map((x) => x.canonicalCode)).not.toContain(
      "old_thing",
    );
  });

  it("accepts injected generators as the extension seam without touching provider SDKs", async () => {
    const seen: string[] = [];
    const generator: TaxonomyCandidateGenerator = {
      id: "test",
      version: "t1",
      generate: (_e, request) => {
        seen.push(request.rawText);
        return Promise.resolve([hit(AI, "LEXICAL", 0.9)]);
      },
    };
    const c = createTaxonomyClassifier({
      reference: fakeReference([V("technology")], [AI], new Map()),
      lexical: fakeLexical([AI]),
      generators: { exact: [], lexical: [generator] },
    });
    const scope = await c.resolveScope(sql, undefined);
    const result = await c.classifyInScope(sql, scope, {
      text: "raw text",
      strategy: "AUTO",
      limit: 5,
    });
    expect(seen).toEqual(["raw text"]);
    expect(result.candidates[0]?.confidence).toBe("0.7650");
  });
});

describe("eval graders (§143-152)", () => {
  it("grades every fixture kind and summarises exact and lexical separately", () => {
    const exactFixture = TAXONOMY_EVAL_FIXTURES.find((f) => f.kind === "EXACT");
    const abstainFixture = TAXONOMY_EVAL_FIXTURES.find(
      (f) => f.kind === "ABSTAIN",
    );
    const multiFixture = TAXONOMY_EVAL_FIXTURES.find(
      (f) => f.kind === "MULTI_LABEL",
    );
    if (
      exactFixture?.kind !== "EXACT" ||
      abstainFixture === undefined ||
      multiFixture?.kind !== "MULTI_LABEL"
    ) {
      throw new Error("fixtures missing");
    }
    const [vocab, code] = exactFixture.expected.top1;
    const exactResult = {
      resolution: "EXACT" as const,
      candidates: [
        {
          nodeId: AI.id,
          vocabularyCode: vocab,
          canonicalCode: code,
          displayName: code,
          rank: 1,
          confidence: "0.9500",
          matchTypes: ["ALIAS_EXACT" as const],
          rationaleSummary: "x",
        },
      ],
      taxonomyVersions: { [vocab]: 1 },
      classifier: TAXONOMY_CLASSIFIER_IDENTITY,
    };
    const good = gradeFixture(exactFixture, exactResult);
    expect(good).toMatchObject({ top1Hit: true, passed: true, kind: "EXACT" });
    const abstained = gradeFixture(abstainFixture, {
      ...exactResult,
      resolution: "ABSTAINED",
      candidates: [],
      abstentionReason: "NO_CANDIDATES",
    });
    expect(abstained.passed).toBe(true);
    const wrong = gradeFixture(abstainFixture, exactResult);
    expect(wrong.passed).toBe(false);
    const template = exactResult.candidates[0];
    if (template === undefined) {
      throw new Error("template candidate missing");
    }
    const multi = gradeFixture(multiFixture, {
      ...exactResult,
      resolution: "CANDIDATES",
      candidates: multiFixture.expected.relevant
        .slice(0, 3)
        .map(([v, cc], i) => ({
          ...template,
          vocabularyCode: v,
          canonicalCode: cc,
          rank: i + 1,
        })),
    });
    expect(multi.precision).toBe(1);
    expect(multi.recall).toBe(
      Math.round((3 / multiFixture.expected.relevant.length) * 1e4) / 1e4,
    );
    const report = summarizeEval({
      classifierVersion: TAXONOMY_CLASSIFIER_VERSION,
      taxonomyVersionSet: { industry: 1 },
      fixtureVersion: TAXONOMY_EVAL_FIXTURES_VERSION,
      grades: [good, abstained, wrong, multi],
    });
    expect(report.exact).toEqual({ count: 1, top1Accuracy: 1 });
    expect(report.abstention).toMatchObject({
      count: 2,
      correctAbstentions: 1,
      falseAbstentions: 0,
    });
    expect(report.failures).toEqual([abstainFixture.id]);
  });

  it("fixtures cover every kind, name canonical codes and include ambiguity + abstention cases", () => {
    const kinds = new Set(TAXONOMY_EVAL_FIXTURES.map((f) => f.kind));
    expect([...kinds].sort()).toEqual([
      "ABSTAIN",
      "AMBIGUOUS",
      "EXACT",
      "LEXICAL",
      "MULTI_LABEL",
    ]);
    expect(new Set(TAXONOMY_EVAL_FIXTURES.map((f) => f.id)).size).toBe(
      TAXONOMY_EVAL_FIXTURES.length,
    );
    expect(
      TAXONOMY_EVAL_FIXTURES.filter((f) => f.kind === "EXACT").length,
    ).toBeGreaterThanOrEqual(10);
  });
});

describe("no AI creep (§172, §200-201)", () => {
  it("the package declares no model-provider SDK, embedding or vector dependency", () => {
    const manifest = JSON.parse(
      readFileSync(
        fileURLToPath(new URL("../package.json", import.meta.url)),
        "utf8",
      ),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const names = Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
    });
    for (const name of names) {
      expect(name).not.toMatch(
        /openai|anthropic|google|gemini|deepseek|qwen|openrouter|langchain|langgraph|pgvector|embedding|vector/i,
      );
    }
    expect(names).toContain("@capital-q/observability");
  });
});
