import { describe, expect, it } from "vitest";

import type { Logger } from "@capital-q/observability";
import {
  EMBEDDING_DOCUMENT_INSTRUCTION_VERSION,
  EmbeddingConfigurationSchema,
  EmbeddingProviderFailure,
  instructionFor,
  type EmbeddingConfiguration,
  type EmbeddingResult,
} from "@capital-q/q-embeddings";
import type { ActorContext } from "@capital-q/security";

import type { StructuredRetrievalPorts } from "../src/candidates/ports.js";
import { createStructuredCandidateService } from "../src/candidates/service.js";
import { createNotComputableChequeRetrieval } from "../src/candidates/ports.js";
import { evaluateHardEligibility } from "../src/eligibility/policy.js";
import type {
  ActiveMandateLookup,
  EligibilityPorts,
  MandateSnapshotForEligibility,
} from "../src/eligibility/ports.js";
import type { EligibilityService } from "../src/eligibility/service.js";
import { createHybridCandidateService } from "../src/hybrid/service.js";
import {
  SEMANTIC_TOP_K,
  SemanticCandidateResultSchema,
  RepresentationRefreshReportSchema,
} from "../src/semantic/contracts.js";
import type {
  CompanyInvestmentFactsPort,
  InvestorMandateNarrativePort,
  SemanticEmbedder,
  SemanticRepresentationStore,
  StoredRepresentation,
  VectorIdentity,
  VocabularyDescriptionPort,
} from "../src/semantic/ports.js";
import { createSemanticCandidateService } from "../src/semantic/service.js";

/**
 * The semantic mandate generator over a fake world (CQ-REC-003 §41, golden
 * A–O). The world holds canonical, investor-visible facts and — deliberately
 * — everything that must not matter: founder-private memory, a
 * conversation summary, a private document, public-web findings. The
 * embedder is a deterministic concept-bucket model, so "different words,
 * same investment concept" is testable without a runtime; the store is in
 * memory with real cosine distance; eligibility is the real REC-001 policy.
 */

const TENANT_I = "11111111-0000-4000-8000-000000000011";
const ORG_I = "11111111-0000-4000-8000-000000000012";
const INVESTOR = "11111111-0000-4000-8000-000000000013";
const TENANT_C = "22222222-0000-4000-8000-000000000021";
const ORG_C = "22222222-0000-4000-8000-000000000022";
const ACTIVE_MANDATE = "33333333-0000-4000-8000-000000000031";
const DRAFT_MANDATE = "33333333-0000-4000-8000-000000000032";
const LOGISTICS = "44444444-0000-4000-8000-000000000041";
const GAMBLING = "44444444-0000-4000-8000-000000000044";
const WEST_AFRICA = "44444444-0000-4000-8000-000000000046";
const ENTERPRISE_SOFTWARE = "44444444-0000-4000-8000-000000000047";
const FOOD_RETAIL = "44444444-0000-4000-8000-000000000048";
const HARDWARE = "44444444-0000-4000-8000-000000000043";
const MARKER = "REC003_PRIVATE_FOUNDER_SEMANTIC_MARKER_DO_NOT_EMBED";
const PUBLIC_WEB_MARKER = "REC003_RAW_PUBLIC_WEB_FINDING_NOT_CANONICAL";

const ACTOR = {
  userId: "11111111-0000-4000-8000-000000000014",
  tenantId: TENANT_I,
  organisationId: ORG_I,
  membershipId: "11111111-0000-4000-8000-000000000015",
  actorType: "HUMAN",
} as unknown as ActorContext;

const companyId = (n: number) =>
  `55555555-0000-4000-8000-${String(n).padStart(12, "0")}`;

// ---------------------------------------------------------------------------
// A deterministic concept embedder: eight investment concepts, cosine space.
// ---------------------------------------------------------------------------

const CONCEPTS: readonly (readonly string[])[] = [
  [
    "logistics",
    "freight",
    "supply",
    "chain",
    "shipping",
    "distributors",
    "fleet",
    "cargo",
  ],
  ["software", "saas", "platform", "workflow", "app", "tooling"],
  [
    "africa",
    "african",
    "nigeria",
    "nigerian",
    "ghana",
    "lagos",
    "kenya",
    "west",
  ],
  ["fintech", "payments", "lending", "banking", "wallet"],
  ["media", "entertainment", "streaming", "gambling", "betting", "casino"],
  ["hardware", "devices", "robotics", "sensors"],
  ["europe", "european", "berlin", "germany", "german", "london", "paris"],
  ["enterprise", "b2b", "operations", "business"],
];
const DIMENSION = CONCEPTS.length + 1;

function conceptVector(text: string): readonly number[] {
  const values = new Array<number>(DIMENSION).fill(0);
  const tokens = text.toLowerCase().match(/[a-z]+/g) ?? [];
  for (const token of tokens) {
    let hit = false;
    for (const [index, words] of CONCEPTS.entries()) {
      if (words.includes(token)) {
        values[index] = (values[index] ?? 0) + 1;
        hit = true;
      }
    }
    if (!hit) values[DIMENSION - 1] = (values[DIMENSION - 1] ?? 0) + 0.05;
  }
  const norm = Math.sqrt(values.reduce((s, v) => s + v * v, 0));
  return norm === 0 ? values : values.map((v) => v / norm);
}

const CONFIGURATION: EmbeddingConfiguration =
  EmbeddingConfigurationSchema.parse({
    configurationVersion: "capital-q-concept-test-v1",
    providerCode: "fake",
    runtime: "IN_PROCESS_FAKE",
    modelCode: "fake/concept-buckets",
    modelFamily: "fake",
    modelRevision: null,
    dimension: DIMENSION,
    maxDimension: DIMENSION,
    normalization: "L2_UNIT",
    instructionStrategy: "QUERY_ONLY",
    maxInputCharacters: 4_000,
    maxBatchItems: 16,
    maxBatchCharacters: 64_000,
  });

type FakeEmbedder = SemanticEmbedder & {
  readonly inputs: string[];
  readonly queries: string[];
  calls: number;
  down: boolean;
};

function embedder(): FakeEmbedder {
  const result = (
    text: string,
    instructionVersion: string,
  ): EmbeddingResult => ({
    vector: conceptVector(text),
    dimension: DIMENSION,
    providerCode: "fake",
    modelCode: CONFIGURATION.modelCode,
    modelRevision: null,
    configurationVersion: CONFIGURATION.configurationVersion,
    instructionVersion,
    inputSha256: "0".repeat(64),
    inputCharacters: text.length,
    latencyMs: 0,
  });
  const fail = () =>
    new EmbeddingProviderFailure("the embedding runtime is down", {
      failureClass: "UNAVAILABLE",
      providerCode: "fake",
    });
  const self: FakeEmbedder = {
    inputs: [],
    queries: [],
    calls: 0,
    down: false,
    describe: () => ({
      providerCode: "fake",
      configuration: CONFIGURATION,
      endpoint: null,
    }),
    embedDocuments: (inputs) => {
      self.calls += 1;
      if (self.down) return Promise.reject(fail());
      self.inputs.push(...inputs);
      const embeddings = inputs.map((text) =>
        result(text, EMBEDDING_DOCUMENT_INSTRUCTION_VERSION),
      );
      return Promise.resolve({
        embeddings,
        batchSize: inputs.length,
        latencyMs: 0,
      });
    },
    embedQuery: (query, task) => {
      self.calls += 1;
      if (self.down) return Promise.reject(fail());
      self.queries.push(query);
      return Promise.resolve(
        result(query, instructionFor(task).instructionVersion),
      );
    },
  };
  return self;
}

// ---------------------------------------------------------------------------
// The world.
// ---------------------------------------------------------------------------

type Company = {
  id: string;
  tenantId: string;
  organisationId: string;
  status: "active" | "closed";
  visibility: string;
  ready: boolean;
  version: number;
  name: string;
  summary: string | null;
  stage: string | null;
  country: string | null;
  nodes: { nodeId: string; vocabularyCode: string; canonicalCode: string }[];
  permitted: boolean;
  // Never read by any port.
  founderMemory: string[];
  conversationSummary: string;
  privateDocument: string;
  publicWeb: string[];
};

type Mandate = MandateSnapshotForEligibility & {
  name: string;
  rawMandateText: string | null;
  mandateVersion: number;
};

type World = {
  companies: Company[];
  mandates: Mandate[];
  activeIds: string[];
  nodes: Record<
    string,
    { vocabularyCode: string; canonicalCode: string; displayName: string }
  >;
  queries: string[];
};

function company(n: number, overrides: Partial<Company> = {}): Company {
  return {
    id: companyId(n),
    tenantId: TENANT_C,
    organisationId: ORG_C,
    status: "active",
    visibility: "network_visible",
    ready: true,
    version: 1,
    name: `Company ${String(n)}`,
    summary: null,
    stage: null,
    country: null,
    nodes: [],
    permitted: true,
    founderMemory: [],
    conversationSummary: "",
    privateDocument: "",
    publicWeb: [],
    ...overrides,
  };
}

function mandate(overrides: Partial<Mandate> = {}): Mandate {
  return {
    mandateId: ACTIVE_MANDATE,
    investorOrganisationId: INVESTOR,
    version: 1,
    mandateVersion: 1,
    status: "ACTIVE",
    name: "Africa enterprise logistics",
    rawMandateText:
      "We back enterprise logistics software companies serving African markets.",
    constraints: [
      {
        dimension: "stage",
        operator: "IN",
        value: { kind: "codes", values: ["seed"] },
        importance: "MUST",
        isHardExclusion: false,
        automatedUse: "ELIGIBLE",
      },
      {
        dimension: "geography.country",
        operator: "IN",
        value: { kind: "codes", values: ["NG"] },
        importance: "STRONG",
        isHardExclusion: false,
        automatedUse: "ELIGIBLE",
      },
    ],
    taxonomyPreferences: [
      {
        nodeId: LOGISTICS,
        vocabularyCode: "industry",
        preferenceStrength: "STRONG",
        isExclusion: false,
        source: "user_selected",
      },
      {
        nodeId: GAMBLING,
        vocabularyCode: "industry",
        preferenceStrength: "HARD_EXCLUSION",
        isExclusion: true,
        source: "user_selected",
      },
    ],
    ...overrides,
  };
}

function world(overrides: Partial<World> = {}): World {
  return {
    companies: [
      // A: the obvious semantic match; also structured (seed, NG, logistics).
      company(1, {
        name: "Kobo Logistics",
        summary: "Logistics workflow SaaS for African distributors.",
        stage: "seed",
        country: "NG",
        nodes: [
          {
            nodeId: LOGISTICS,
            vocabularyCode: "industry",
            canonicalCode: "logistics",
          },
        ],
      }),
      // B: different words, same concept; no structured overlap (series_b, KE, no taxonomy).
      company(2, {
        name: "Haulr",
        summary:
          "Freight and supply chain operations platform for Nigerian distributors.",
        stage: "series_b",
        country: "KE",
        nodes: [
          {
            nodeId: ENTERPRISE_SOFTWARE,
            vocabularyCode: "industry",
            canonicalCode: "enterprise_software",
          },
        ],
      }),
      // C: structured-only — seed in NG, but semantically unrelated.
      company(3, {
        name: "Bakehouse",
        summary: "Artisan bread and pastry retail.",
        stage: "seed",
        country: "NG",
        nodes: [
          {
            nodeId: FOOD_RETAIL,
            vocabularyCode: "industry",
            canonicalCode: "food_retail",
          },
        ],
      }),
      // F: semantically close but a DECLARED hard exclusion (gambling).
      company(4, {
        name: "BetHaul",
        summary: "Betting and casino logistics platform for African operators.",
        stage: "seed",
        country: "NG",
        nodes: [
          {
            nodeId: GAMBLING,
            vocabularyCode: "industry",
            canonicalCode: "gambling",
          },
        ],
      }),
      // G: similar but not marketplace-ready.
      company(5, {
        name: "Fleetly",
        summary: "Fleet and cargo software for West Africa.",
        stage: "seed",
        country: "GH",
        ready: false,
        nodes: [
          {
            nodeId: LOGISTICS,
            vocabularyCode: "industry",
            canonicalCode: "logistics",
          },
        ],
      }),
      // G: similar but private — never listed as discoverable.
      company(6, {
        name: "Shadow Freight",
        summary: "Freight software for Africa.",
        stage: "seed",
        country: "NG",
        visibility: "organisation_private",
        permitted: false,
        tenantId: "99999999-0000-4000-8000-000000000099",
      }),
      // Unrelated: European robotics hardware.
      company(7, {
        name: "Berlin Robotics",
        summary: "Robotics hardware and sensors for German factories.",
        stage: "series_a",
        country: "DE",
        nodes: [
          {
            nodeId: HARDWARE,
            vocabularyCode: "technology",
            canonicalCode: "hardware",
          },
        ],
      }),
    ],
    mandates: [
      mandate(),
      mandate({
        mandateId: DRAFT_MANDATE,
        status: "DRAFT",
        name: "Draft",
        rawMandateText: "Draft: European robotics hardware.",
        constraints: [],
        taxonomyPreferences: [],
      }),
    ],
    activeIds: [ACTIVE_MANDATE],
    nodes: {
      [LOGISTICS]: {
        vocabularyCode: "industry",
        canonicalCode: "logistics",
        displayName: "Logistics",
      },
      [GAMBLING]: {
        vocabularyCode: "industry",
        canonicalCode: "gambling",
        displayName: "Gambling",
      },
      [WEST_AFRICA]: {
        vocabularyCode: "geography",
        canonicalCode: "west_africa",
        displayName: "West Africa",
      },
      [ENTERPRISE_SOFTWARE]: {
        vocabularyCode: "industry",
        canonicalCode: "enterprise_software",
        displayName: "Enterprise software",
      },
      [FOOD_RETAIL]: {
        vocabularyCode: "industry",
        canonicalCode: "food_retail",
        displayName: "Food retail",
      },
      [HARDWARE]: {
        vocabularyCode: "technology",
        canonicalCode: "hardware",
        displayName: "Hardware",
      },
    },
    queries: [],
    ...overrides,
  };
}

const discoverable = (c: Company) =>
  c.status === "active" &&
  (c.visibility === "network_visible" || c.visibility === "public_external");

// ---------------------------------------------------------------------------
// Ports over the world.
// ---------------------------------------------------------------------------

function facts(w: World): CompanyInvestmentFactsPort {
  return {
    listDiscoverable: ({ companyIds, limit }) => {
      w.queries.push("facts.listDiscoverable");
      return Promise.resolve(
        w.companies
          .filter(discoverable)
          .filter((c) => companyIds === null || companyIds.includes(c.id))
          .sort((a, b) => a.id.localeCompare(b.id))
          .slice(0, limit)
          .map((c) => ({
            companyId: c.id,
            tenantId: c.tenantId,
            organisationId: c.organisationId,
            canonicalName: c.name,
            shortDescription: c.summary,
            currentStageCode: c.stage,
            headquartersCountry: c.country,
            sourceVersion: c.version,
            classifications: c.nodes,
          })),
      );
    },
  };
}

function narratives(w: World): InvestorMandateNarrativePort {
  return {
    narrativeFor: ({ mandateId }) => {
      const m = w.mandates.find((x) => x.mandateId === mandateId);
      return Promise.resolve(
        m === undefined
          ? null
          : {
              mandateId: m.mandateId,
              version: m.mandateVersion,
              name: m.name,
              rawMandateText: m.rawMandateText,
            },
      );
    },
  };
}

function vocabulary(w: World): VocabularyDescriptionPort {
  return {
    describeNodes: (nodeIds) =>
      Promise.resolve(
        nodeIds.flatMap((nodeId) => {
          const n = w.nodes[nodeId];
          return n === undefined ? [] : [{ nodeId, ...n }];
        }),
      ),
  };
}

type Row = StoredRepresentation & {
  tenantId: string;
  subjectId: string;
  purpose: string;
  version: string;
  content: string;
  status: "CURRENT" | "SUPERSEDED";
};
type Vector = {
  representationId: string;
  subjectId: string;
  contentSha256: string;
  identity: VectorIdentity;
  vector: readonly number[];
};

function memoryStore(w: World) {
  const companyRows: Row[] = [];
  const mandateRows: Row[] = [];
  const companyVectors: Vector[] = [];
  const mandateVectors: Vector[] = [];
  let sequence = 0;
  const nextId = () =>
    `66666666-0000-4000-8000-${String((sequence += 1)).padStart(12, "0")}`;
  const same = (a: VectorIdentity, b: VectorIdentity) =>
    a.modelCode === b.modelCode &&
    a.dimension === b.dimension &&
    a.configurationVersion === b.configurationVersion &&
    a.instructionVersion === b.instructionVersion;
  const current = (
    rows: Row[],
    subjectId: string,
    purpose: string,
    version: string,
  ) =>
    rows.find(
      (r) =>
        r.subjectId === subjectId &&
        r.purpose === purpose &&
        r.version === version &&
        r.status === "CURRENT",
    ) ?? null;
  const insert = (
    rows: Row[],
    input: {
      tenantId: string;
      subjectId: string;
      purpose: string;
      representationVersion: string;
      sourceFingerprint: string;
      contentSha256: string;
      content: string;
    },
  ): Row => {
    if (
      current(
        rows,
        input.subjectId,
        input.purpose,
        input.representationVersion,
      ) !== null
    ) {
      throw new Error(
        "one CURRENT representation per subject, purpose and version",
      );
    }
    const row: Row = {
      id: nextId(),
      tenantId: input.tenantId,
      subjectId: input.subjectId,
      purpose: input.purpose,
      version: input.representationVersion,
      sourceFingerprint: input.sourceFingerprint,
      contentSha256: input.contentSha256,
      content: input.content,
      status: "CURRENT",
    };
    rows.push(row);
    return row;
  };
  const strip = (r: Row): StoredRepresentation => ({
    id: r.id,
    contentSha256: r.contentSha256,
    sourceFingerprint: r.sourceFingerprint,
  });

  const store: SemanticRepresentationStore = {
    currentCompanyRepresentation: (i) => {
      const r = current(
        companyRows,
        i.companyId,
        i.purpose,
        i.representationVersion,
      );
      return Promise.resolve(r === null ? null : strip(r));
    },
    supersedeCompanyRepresentation: (id) => {
      const r = companyRows.find((x) => x.id === id);
      if (r !== undefined) r.status = "SUPERSEDED";
      return Promise.resolve();
    },
    insertCompanyRepresentation: (i) =>
      Promise.resolve(
        strip(insert(companyRows, { ...i, subjectId: i.companyId })),
      ),
    hasCompanyEmbedding: (i) =>
      Promise.resolve(
        companyVectors.some(
          (v) =>
            v.representationId === i.representationId &&
            same(v.identity, i.identity),
        ),
      ),
    findReusableCompanyVector: (i) =>
      Promise.resolve(
        companyVectors.find(
          (v) =>
            v.subjectId === i.companyId &&
            v.contentSha256 === i.contentSha256 &&
            same(v.identity, i.identity),
        )?.vector ?? null,
      ),
    insertCompanyEmbedding: (i) => {
      companyVectors.push({
        representationId: i.representationId,
        subjectId: i.companyId,
        contentSha256: i.contentSha256,
        identity: i.identity,
        vector: i.vector,
      });
      return Promise.resolve();
    },
    currentMandateRepresentation: (i) => {
      const r = current(
        mandateRows,
        i.mandateId,
        i.purpose,
        i.representationVersion,
      );
      return Promise.resolve(r === null ? null : strip(r));
    },
    supersedeMandateRepresentation: (id) => {
      const r = mandateRows.find((x) => x.id === id);
      if (r !== undefined) r.status = "SUPERSEDED";
      return Promise.resolve();
    },
    insertMandateRepresentation: (i) =>
      Promise.resolve(
        strip(insert(mandateRows, { ...i, subjectId: i.mandateId })),
      ),
    findMandateVector: (i) =>
      Promise.resolve(
        mandateVectors.find(
          (v) =>
            v.representationId === i.representationId &&
            same(v.identity, i.identity),
        )?.vector ?? null,
      ),
    insertMandateEmbedding: (i) => {
      mandateVectors.push({
        representationId: i.representationId,
        subjectId: i.representationId,
        contentSha256: i.contentSha256,
        identity: i.identity,
        vector: i.vector,
      });
      return Promise.resolve();
    },
    nearestCompanies: (i) => {
      w.queries.push("store.nearestCompanies");
      const hits = companyVectors
        .filter(
          (v) =>
            v.identity.configurationVersion === i.configurationVersion &&
            v.identity.instructionVersion === i.documentInstructionVersion,
        )
        .flatMap((v) => {
          const row = companyRows.find((r) => r.id === v.representationId);
          const c = w.companies.find((x) => x.id === v.subjectId);
          if (
            row === undefined ||
            row.status !== "CURRENT" ||
            row.purpose !== i.purpose ||
            row.version !== i.representationVersion ||
            c === undefined ||
            !discoverable(c)
          ) {
            return [];
          }
          const dot = v.vector.reduce(
            (s, x, k) => s + x * (i.queryVector[k] ?? 0),
            0,
          );
          return [
            {
              companyId: c.id,
              tenantId: c.tenantId,
              organisationId: c.organisationId,
              distance: 1 - dot,
            },
          ];
        })
        .sort(
          (a, b) =>
            a.distance - b.distance || a.companyId.localeCompare(b.companyId),
        )
        .slice(0, i.limit);
      return Promise.resolve(hits);
    },
  };
  return {
    store,
    companyRows,
    companyVectors,
    mandateRows,
    mandateVectors,
    text: (companyIdValue: string) =>
      current(
        companyRows,
        companyIdValue,
        "INVESTOR_DISCOVER",
        "company-investment-representation.v1",
      )?.content ?? null,
  };
}

function eligibilityPorts(
  w: World,
): Pick<EligibilityPorts, "investorSubject" | "mandates" | "taxonomyVersions"> {
  return {
    investorSubject: {
      investorOrganisationFor: (actor) =>
        Promise.resolve(
          actor.organisationId === ORG_I
            ? { investorOrganisationId: INVESTOR }
            : null,
        ),
    },
    mandates: {
      activeMandate: ({ mandateId }) => {
        if (mandateId !== null) {
          const pinned = w.mandates.find((m) => m.mandateId === mandateId);
          return Promise.resolve<ActiveMandateLookup>(
            pinned === undefined
              ? { kind: "NONE" }
              : { kind: "FOUND", mandate: pinned },
          );
        }
        const active = w.mandates.filter(
          (m) => m.status === "ACTIVE" && w.activeIds.includes(m.mandateId),
        );
        if (active.length === 0)
          return Promise.resolve<ActiveMandateLookup>({ kind: "NONE" });
        if (active.length > 1)
          return Promise.resolve<ActiveMandateLookup>({ kind: "AMBIGUOUS" });
        const [only] = active;
        return Promise.resolve<ActiveMandateLookup>(
          only === undefined
            ? { kind: "NONE" }
            : { kind: "FOUND", mandate: only },
        );
      },
    },
    taxonomyVersions: {
      currentVersions: () => Promise.resolve({ industry: 1, geography: 1 }),
    },
  };
}

/** The real REC-001 policy over the world's canonical facts. */
function eligibility(w: World): EligibilityService {
  return {
    evaluate: ({ actor, mandateId, companyIds }) => {
      w.queries.push("eligibility.evaluate");
      const active = w.mandates.find(
        (m) => m.mandateId === mandateId && m.status === "ACTIVE",
      );
      const lookup: ActiveMandateLookup =
        active === undefined
          ? { kind: "NONE" }
          : { kind: "FOUND", mandate: active };
      const results = companyIds.flatMap((id) => {
        const c = w.companies.find((x) => x.id === id);
        if (c === undefined) return [];
        return [
          evaluateHardEligibility({
            mode: "INVESTOR_DISCOVER",
            investorOrganisationId: INVESTOR,
            mandate: lookup,
            company: {
              companyId: c.id,
              tenantId: c.tenantId,
              organisationId: c.organisationId,
              companyStatus: c.status,
              marketplaceVisibility: c.visibility,
              marketplaceParticipation: c.ready ? "ELIGIBLE" : "NOT_ELIGIBLE",
              currentStageCode: c.stage,
              headquartersCountry: c.country,
            },
            classifications: c.nodes.map((n) => ({
              nodeId: n.nodeId,
              vocabularyCode: n.vocabularyCode,
            })),
            permittedToView: c.permitted,
            relationship: { kind: "NONE" },
            taxonomyVersion: { industry: 1, geography: 1 },
            evaluatedAt: "2026-09-18T12:00:00.000Z",
          }),
        ];
      });
      return Promise.resolve({
        context: {
          tenantId: actor.tenantId,
          investorOrganisationId: INVESTOR,
          mode: "INVESTOR_DISCOVER",
          mandateId: active?.mandateId ?? null,
          taxonomyVersion: null,
          eligibilityPolicyVersion: "eligibility.v1",
        },
        results,
      });
    },
  };
}

/** Structured retrieval over the same world, for the hybrid scenarios. */
function structuredRetrieval(w: World): StructuredRetrievalPorts {
  const ref = (c: Company) => ({
    companyId: c.id,
    tenantId: c.tenantId,
    organisationId: c.organisationId,
  });
  const byId = (a: Company, b: Company) => a.id.localeCompare(b.id);
  return {
    companies: {
      byStageCodes: (codes, limit) =>
        Promise.resolve(
          w.companies
            .filter(
              (c) =>
                discoverable(c) && c.stage !== null && codes.includes(c.stage),
            )
            .sort(byId)
            .slice(0, limit)
            .map(ref),
        ),
      byHeadquartersCountries: (codes, limit) =>
        Promise.resolve(
          w.companies
            .filter(
              (c) =>
                discoverable(c) &&
                c.country !== null &&
                codes.includes(c.country),
            )
            .sort(byId)
            .slice(0, limit)
            .map(ref),
        ),
    },
    taxonomy: {
      subjectsByNodes: (nodeIds, limit) =>
        Promise.resolve(
          w.companies
            .filter(discoverable)
            .sort(byId)
            .flatMap((c) =>
              c.nodes
                .filter((n) => nodeIds.includes(n.nodeId))
                .map((n) => ({
                  companyId: c.id,
                  tenantId: c.tenantId,
                  nodeId: n.nodeId,
                  vocabularyCode: n.vocabularyCode,
                })),
            )
            .slice(0, limit),
        ),
      expandPreference: (nodeId) => {
        const n = w.nodes[nodeId];
        return Promise.resolve(
          n === undefined
            ? null
            : {
                preferredNodeId: nodeId,
                vocabularyCode: n.vocabularyCode,
                unrestricted: false,
                descendantNodeIds: [],
              },
        );
      },
    },
    cheque: createNotComputableChequeRetrieval(),
  };
}

type LogLine = { readonly level: string; readonly line: string };
function capturingLogger(lines: LogLine[]): Logger {
  const record =
    (level: string) =>
    (...args: unknown[]) => {
      lines.push({ level, line: JSON.stringify(args) });
    };
  return {
    debug: record("debug"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
    fatal: record("fatal"),
    trace: record("trace"),
    child: () => capturingLogger(lines),
  } as unknown as Logger;
}

function harness(w: World = world()) {
  const fake = embedder();
  const memory = memoryStore(w);
  const logs: LogLine[] = [];
  const semantic = createSemanticCandidateService({
    ports: eligibilityPorts(w),
    facts: facts(w),
    narratives: narratives(w),
    vocabulary: vocabulary(w),
    store: memory.store,
    embeddings: fake,
    eligibility: eligibility(w),
    logger: capturingLogger(logs),
  });
  const structured = createStructuredCandidateService({
    ports: eligibilityPorts(w),
    retrieval: structuredRetrieval(w),
    eligibility: eligibility(w),
  });
  const hybrid = createHybridCandidateService({ structured, semantic });
  return { w, fake, memory, logs, semantic, structured, hybrid };
}

const TOP_K = 4;

async function generated(
  h: ReturnType<typeof harness>,
  query: { mandateId?: string | null; topK?: number } = {},
) {
  const result = await h.semantic.generate({
    actor: ACTOR,
    topK: TOP_K,
    ...query,
  });
  expect(SemanticCandidateResultSchema.parse(result)).toEqual(result);
  if (result.kind !== "GENERATED") throw new Error(result.kind);
  return result;
}

const ids = (r: { candidates: readonly { companyId: string }[] }) =>
  r.candidates.map((c) => c.companyId);
const similarityOf = (
  r: {
    candidates: readonly {
      companyId: string;
      provenance: { similarity: number };
    }[];
  },
  n: number,
) =>
  r.candidates.find((c) => c.companyId === companyId(n))?.provenance.similarity;

describe("representation refresh", () => {
  it("builds one representation and one vector per discoverable company; a second run is all cache (L)", async () => {
    const h = harness();
    const first = await h.semantic.refreshCompanyRepresentations();
    expect(RepresentationRefreshReportSchema.parse(first)).toEqual(first);
    // Six discoverable companies (the private one is never listed).
    expect(first).toMatchObject({
      considered: 6,
      built: 6,
      unchanged: 0,
      embedded: 6,
      reused: 0,
    });
    expect(h.fake.inputs).toHaveLength(6);
    const second = await h.semantic.refreshCompanyRepresentations();
    expect(second).toMatchObject({
      considered: 6,
      built: 0,
      unchanged: 6,
      embedded: 0,
      reused: 6,
    });
    expect(h.fake.inputs).toHaveLength(6);
    expect(h.memory.companyVectors).toHaveLength(6);
  });

  it("the representation reads like a compact investment projection (§35)", async () => {
    const h = harness();
    await h.semantic.refreshCompanyRepresentations();
    expect(h.memory.text(companyId(1))).toBe(
      [
        "Company: Kobo Logistics",
        "Stage: seed",
        "Headquarters: NG",
        "Sector: Logistics",
        "Summary: Logistics workflow SaaS for African distributors.",
      ].join("\n"),
    );
  });

  it("I: a network-visible summary change rebuilds the representation and re-embeds; a version bump alone does not", async () => {
    const h = harness();
    await h.semantic.refreshCompanyRepresentations();
    const before = h.memory.text(companyId(3));
    const target = h.w.companies.find((c) => c.id === companyId(3));
    if (target === undefined) throw new Error("fixture");
    target.version += 1;
    expect(await h.semantic.refreshCompanyRepresentations()).toMatchObject({
      built: 0,
      embedded: 0,
    });
    target.summary =
      "Logistics software for African bakeries and distributors.";
    target.version += 1;
    const report = await h.semantic.refreshCompanyRepresentations({
      companyIds: [companyId(3)],
    });
    expect(report).toMatchObject({
      considered: 1,
      built: 1,
      embedded: 1,
      reused: 0,
    });
    expect(h.memory.text(companyId(3))).not.toBe(before);
    expect(
      h.memory.companyRows.filter((r) => r.subjectId === companyId(3)),
    ).toHaveLength(2);
    // And retrieval may now legitimately change: the bakery became a logistics candidate.
    const r = await generated(h);
    expect(ids(r)).toContain(companyId(3));
  });

  it("a rebuild back to earlier content reuses that content's vector instead of embedding again", async () => {
    const h = harness();
    await h.semantic.refreshCompanyRepresentations();
    const target = h.w.companies.find((c) => c.id === companyId(3));
    if (target === undefined) throw new Error("fixture");
    const original = target.summary;
    target.summary = "Something else entirely.";
    await h.semantic.refreshCompanyRepresentations({
      companyIds: [companyId(3)],
    });
    target.summary = original;
    const report = await h.semantic.refreshCompanyRepresentations({
      companyIds: [companyId(3)],
    });
    expect(report).toMatchObject({ built: 1, embedded: 0, reused: 1 });
  });

  it("M: when the runtime is down the refresh fails typed and leaves no half-written vector", async () => {
    const h = harness();
    h.fake.down = true;
    await expect(
      h.semantic.refreshCompanyRepresentations(),
    ).rejects.toBeInstanceOf(EmbeddingProviderFailure);
    expect(h.memory.companyVectors).toHaveLength(0);
    h.fake.down = false;
    expect(await h.semantic.refreshCompanyRepresentations()).toMatchObject({
      embedded: 6,
    });
  });
});

describe("semantic candidate generation", () => {
  it("A/B: the obvious and the differently-worded logistics companies are semantic candidates; the unrelated one is not (N: bounded top-K)", async () => {
    const h = harness();
    await h.semantic.refreshCompanyRepresentations();
    const r = await generated(h);
    expect(r.diagnostics.rawHits).toBeLessThanOrEqual(TOP_K);
    expect(r.diagnostics.topK).toBe(TOP_K);
    expect(ids(r)).toContain(companyId(1));
    expect(ids(r)).toContain(companyId(2));
    expect(ids(r)).not.toContain(companyId(7));
    const a = similarityOf(r, 1);
    const b = similarityOf(r, 2);
    if (a === undefined || b === undefined) throw new Error("fixture");
    expect(Number.isFinite(a) && a >= -1 && a <= 1).toBe(true);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
    // Canonical order, never similarity order.
    expect(ids(r)).toEqual([...ids(r)].sort());
    expect(r.diagnostics.queryVector).toBe("COMPUTED");
    expect(r.diagnostics.investorRepresentation).toBe("BUILT");
  });

  it("F: a semantically similar company under a DECLARED hard exclusion is retrieved and removed by REC-001", async () => {
    const h = harness();
    await h.semantic.refreshCompanyRepresentations();
    const r = await generated(h, { topK: 6 });
    expect(ids(r)).not.toContain(companyId(4));
    expect(r.diagnostics.rawHits).toBe(6);
    expect(r.diagnostics.ineligible).toBeGreaterThanOrEqual(2);
  });

  it("G: a similar not-ready company is never rankable; a similar private company is never even represented", async () => {
    const h = harness();
    const refresh = await h.semantic.refreshCompanyRepresentations();
    expect(refresh.considered).toBe(6);
    expect(h.memory.text(companyId(6))).toBeNull();
    const r = await generated(h, { topK: 6 });
    expect(ids(r)).not.toContain(companyId(5));
    expect(ids(r)).not.toContain(companyId(6));
  });

  it("G: a company that goes private after it was represented drops out of retrieval immediately (§24)", async () => {
    const h = harness();
    await h.semantic.refreshCompanyRepresentations();
    expect(ids(await generated(h))).toContain(companyId(1));
    const target = h.w.companies.find((c) => c.id === companyId(1));
    if (target === undefined) throw new Error("fixture");
    target.visibility = "organisation_private";
    target.permitted = false;
    const after = await generated(h);
    expect(ids(after)).not.toContain(companyId(1));
    // The stale vector still exists; the store's discoverability join, not
    // vector deletion, is what keeps it out.
    expect(
      h.memory.companyVectors.some((v) => v.subjectId === companyId(1)),
    ).toBe(true);
  });

  it("H: founder-private, private-document, private-conversation and raw public-web markers never reach text, vectors, logs or output", async () => {
    const h = harness();
    await h.semantic.refreshCompanyRepresentations();
    const before = await generated(h);
    const beforeHash = h.memory.companyRows.map((r) => r.contentSha256);
    const target = h.w.companies.find((c) => c.id === companyId(1));
    if (target === undefined) throw new Error("fixture");
    target.founderMemory.push(
      `${MARKER}: Q remembers the founder is really a gambling company`,
    );
    target.conversationSummary = `${MARKER}: private voice transcript summary`;
    target.privateDocument = `${MARKER}: deck says ARR is $12m`;
    target.publicWeb.push(
      `${PUBLIC_WEB_MARKER}: a blog says they pivoted to hardware`,
    );
    const report = await h.semantic.refreshCompanyRepresentations();
    expect(report).toMatchObject({ built: 0, embedded: 0 });
    expect(h.memory.companyRows.map((r) => r.contentSha256)).toEqual(
      beforeHash,
    );
    const during = await generated(h);
    expect(during.candidates).toEqual(before.candidates);
    const everything = JSON.stringify({
      inputs: h.fake.inputs,
      queries: h.fake.queries,
      rows: h.memory.companyRows,
      vectors: h.memory.companyVectors,
      logs: h.logs,
      result: during,
    });
    expect(everything).not.toContain(MARKER);
    expect(everything).not.toContain(PUBLIC_WEB_MARKER);
  });

  it("J/K: an ACTIVE mandate change rebuilds the investor representation and query vector; a DRAFT change changes nothing", async () => {
    const h = harness();
    await h.semantic.refreshCompanyRepresentations();
    await generated(h);
    expect(h.fake.queries).toHaveLength(1);
    const draft = h.w.mandates.find((m) => m.mandateId === DRAFT_MANDATE);
    if (draft === undefined) throw new Error("fixture");
    draft.rawMandateText = "Draft now wants hardware in Europe";
    draft.mandateVersion += 1;
    const unchanged = await generated(h);
    expect(unchanged.diagnostics).toMatchObject({
      investorRepresentation: "UNCHANGED",
      queryVector: "REUSED",
    });
    expect(h.fake.queries).toHaveLength(1);
    const index = h.w.mandates.findIndex((m) => m.mandateId === ACTIVE_MANDATE);
    const active = h.w.mandates[index];
    if (active === undefined) throw new Error("fixture");
    // A new mandate version: the narrative and the declared intent change.
    h.w.mandates[index] = {
      ...active,
      rawMandateText:
        "We now back robotics hardware and sensors for European factories.",
      constraints: [],
      taxonomyPreferences: [],
      mandateVersion: active.mandateVersion + 1,
    };
    const changed = await generated(h);
    expect(changed.diagnostics).toMatchObject({
      investorRepresentation: "BUILT",
      queryVector: "COMPUTED",
    });
    expect(h.fake.queries).toHaveLength(2);
    expect(h.memory.mandateRows).toHaveLength(2);
    expect(ids(changed)).toContain(companyId(7));
  });

  it("L: the same representations embed to the same vectors and the same result, run after run", async () => {
    const h = harness();
    await h.semantic.refreshCompanyRepresentations();
    const first = await generated(h);
    for (let i = 0; i < 3; i += 1) {
      const again = await generated(h);
      expect(again.candidates).toEqual(first.candidates);
      expect(again.diagnostics.queryVector).toBe("REUSED");
    }
    const vectorsA = h.memory.companyVectors.map((v) => v.vector);
    const fresh = harness();
    await fresh.semantic.refreshCompanyRepresentations();
    expect(fresh.memory.companyVectors.map((v) => v.vector)).toEqual(vectorsA);
  });

  it("M: the embedding runtime being down is a typed UNAVAILABLE result, never a substitute vector", async () => {
    const h = harness();
    await h.semantic.refreshCompanyRepresentations();
    h.fake.down = true;
    const result = await h.semantic.generate({ actor: ACTOR });
    expect(result).toMatchObject({
      kind: "UNAVAILABLE",
      failureClass: "UNAVAILABLE",
      retryable: true,
    });
    expect(h.memory.mandateVectors).toHaveLength(0);
    expect(h.w.queries).not.toContain("store.nearestCompanies");
  });

  it("uses the ACTIVE mandate only: NONE, DRAFT-pinned and AMBIGUOUS mean no candidates, never a fallback", async () => {
    const h = harness();
    await h.semantic.refreshCompanyRepresentations();
    expect(
      (await h.semantic.generate({ actor: ACTOR, mandateId: DRAFT_MANDATE }))
        .kind,
    ).toBe("NO_ACTIVE_MANDATE");
    h.w.activeIds = [];
    expect((await h.semantic.generate({ actor: ACTOR })).kind).toBe(
      "NO_ACTIVE_MANDATE",
    );
    expect(h.fake.queries).toHaveLength(0);
  });

  it("O: the only provider reached is the local embedder; no generation provider, research tool or Q service exists in the path", async () => {
    const h = harness();
    await h.semantic.refreshCompanyRepresentations();
    await generated(h);
    expect(h.w.queries).toEqual(
      expect.arrayContaining([
        "facts.listDiscoverable",
        "store.nearestCompanies",
        "eligibility.evaluate",
      ]),
    );
    expect(JSON.stringify(h.w.queries)).not.toMatch(
      /groq|gemini|tavily|eleven|openai|anthropic/i,
    );
    expect(h.fake.describe().providerCode).toBe("fake");
  });

  it("J: no client-supplied vector, score or model reaches the generator (§40)", async () => {
    const h = harness();
    await h.semantic.refreshCompanyRepresentations();
    const r = await generated(h);
    // The result shape has no vector field to echo and the query type has
    // no vector field to accept; a caller can only name its own mandate.
    expect(JSON.stringify(r)).not.toMatch(/"vector"|"embedding"/);
    const shape = SemanticCandidateResultSchema.safeParse({
      ...r,
      candidates: r.candidates.map((c) => ({ ...c, vector: [1, 0] })),
    });
    expect(shape.success).toBe(false);
  });

  it("bounds top-K to the semantic budget", async () => {
    const h = harness();
    await h.semantic.refreshCompanyRepresentations();
    const r = await generated(h, { topK: 10_000 });
    expect(r.diagnostics.topK).toBe(SEMANTIC_TOP_K);
  });
});

describe("hybrid pool over the same world", () => {
  it("C/D/E: structured-only, semantic-only and both are one company each with the right provenances", async () => {
    const h = harness();
    await h.semantic.refreshCompanyRepresentations();
    const pool = await h.hybrid.generate({ actor: ACTOR, topK: TOP_K });
    if (pool.kind !== "GENERATED") throw new Error(pool.kind);
    expect(pool.semanticUnavailable).toBeNull();
    const byId = new Map(pool.candidates.map((c) => [c.companyId, c]));
    // E: Kobo Logistics — seed/NG/logistics and the obvious semantic match.
    expect(byId.get(companyId(1))?.structured?.reasonCodes).toEqual(
      expect.arrayContaining([
        "STAGE_OVERLAP",
        "GEOGRAPHY_OVERLAP",
        "TAXONOMY_OVERLAP",
      ]),
    );
    expect(byId.get(companyId(1))?.semantic?.similarity).toBeGreaterThan(0);
    // D: Haulr — semantic only (series_b, KE, no taxonomy), retained because ELIGIBLE.
    expect(byId.get(companyId(2))?.structured).toBeNull();
    expect(byId.get(companyId(2))?.semantic).not.toBeNull();
    // C: Bakehouse — structured only (seed, NG), retained after merge.
    expect(byId.get(companyId(3))?.structured).not.toBeNull();
    expect(byId.get(companyId(3))?.semantic).toBeNull();
    // One row per company, canonical order.
    expect(pool.candidates.map((c) => c.companyId)).toEqual(
      [...new Set(pool.candidates.map((c) => c.companyId))].sort(),
    );
    expect(pool.diagnostics).toMatchObject({ both: 1, semanticOnly: 1 });
    expect(pool.diagnostics.structuredOnly).toBeGreaterThanOrEqual(1);
  });

  it("M: a semantic outage leaves the structured pool exactly as the structured generator produced it", async () => {
    const h = harness();
    await h.semantic.refreshCompanyRepresentations();
    const structuredAlone = await h.structured.generate({ actor: ACTOR });
    if (structuredAlone.kind !== "GENERATED")
      throw new Error(structuredAlone.kind);
    h.fake.down = true;
    const pool = await h.hybrid.generate({ actor: ACTOR });
    if (pool.kind !== "GENERATED") throw new Error(pool.kind);
    expect(pool.semanticUnavailable).toEqual({
      failureClass: "UNAVAILABLE",
      retryable: true,
    });
    expect(pool.candidates.map((c) => c.companyId)).toEqual(
      structuredAlone.candidates.map((c) => c.companyId),
    );
    expect(pool.candidates.map((c) => c.structured)).toEqual(
      structuredAlone.candidates.map((c) => c.provenance),
    );
  });
});
