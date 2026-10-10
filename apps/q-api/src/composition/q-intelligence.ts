import type { EtiquetteGuides } from "@capital-q/q-core";
import { APP_ACTIONS, appActionToolNames } from "@capital-q/app-actions";
import { loadEmbeddingConfig } from "@capital-q/config/embeddings";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import { createPostgresCompanyKnowledge } from "@capital-q/discovery";
import { createPostgresContextEpochReader } from "@capital-q/security/postgres";
import type { ModelGateway } from "@capital-q/model-gateway";
import {
  createModelGatewayQAnswer,
  createQTurnReader,
  createSmallTalkReply,
  createTurnSkimmer,
  type QArtifactReviser,
  type QReceiptPort,
  type ClearCheck,
  type QProfileUpdateNotebook,
  type QUserStatementRecorder,
  type QMemoryRecall,
  type QOnboardingNudgePort,
  type QOwnOnboardingPort,
  type ModelGatewayQAnswerDependencies,
} from "@capital-q/model-gateway/q";
import type { ArrivalSnapshot, ModelDataPosture } from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import {
  createEmbeddingService,
  createLocalTeiEmbeddingProvider,
  QWEN3_EMBEDDING_CONFIGURATION,
  type EmbeddingService,
} from "@capital-q/q-embeddings";
import {
  createAuthorisedRetrievalService,
  createKnowledgeQueryService,
  createPostgresChunkHydration,
  createPostgresKnowledgeRepository,
  createPostgresLexicalSearch,
  createPostgresSemanticSearch,
  createQEvidenceRetrieval,
} from "@capital-q/q-knowledge";
import type {
  ContextFirewallPort,
  QAnswerPort,
  QAnswerRequest,
  QLiveDeltaBus,
  QRetrievalPort,
  QRuntimeRepositories,
  QToolPort,
} from "@capital-q/q-runtime";
import {
  createCompanyIntelligenceSpecialist,
  createToolResearchPort,
  createKnowledgeCompanyPort,
  createRetrievalEvidencePort,
  createSpecialistQAnswer,
  createToolCanonicalPort,
  createToolHandOverPort,
  createToolDelegationPort,
  createToolReadinessLead,
  createToolAppActionPort,
  createToolOpenRecordPort,
  createToolProfileGapsPort,
  createToolOwnMandatePort,
  createToolOwnRecordsPort,
  type ArtifactPreparation,
  type PendingDecisionPort,
  type QVisibilityNotebook,
  type SpecialistQAnswerDependencies,
} from "@capital-q/q-specialists";
import { createAppActionArgumentReader } from "./app-action-arguments.js";
import { createPostgresAwaitingActions } from "./awaiting-actions.js";
import { createPostgresConversationCore } from "./conversation-core-state.js";
import {
  createOwnMandateReads,
  createWorkingSnapshots,
} from "./working-snapshot.js";
import { createAppActionRouter } from "./app-action-router.js";
import { createProfileGapReader } from "./profile-gap-reader.js";

import { MANDATE_LABELS } from "./mandate-labels.js";

/**
 * Q's intelligence composition (CQ-C5-R1 §6-§12).
 *
 * The C5 checkpoint found that every Wave-5 capability was real, tested
 * and composed nowhere: `apps/q-api` wired `createUnconfiguredQRetrieval()`
 * and gave the answer seam no context port, so the deployed product
 * answered with zero authorised facts. This module is that gap closed.
 *
 * It builds one path and returns the two ports the orchestrator takes:
 *
 *   Context Firewall plan
 *     → retrieval seam        does this plan reach ANY source material?
 *     → answer seam           specialist if the question is a company
 *                             investigation, conversational otherwise
 *         → authorised context: canonical state (tools) → authorised
 *           Q Knowledge → authorised hybrid retrieval
 *         → Model Gateway
 *
 * Every read below is constrained by the plan the firewall produced, and
 * nothing here decides a permission: the tool registry authorises canonical
 * reads, and the knowledge and retrieval services each re-apply the plan's
 * envelope in SQL. Composition is all this file does — no business logic,
 * no query, no credential handed onward.
 *
 * The seams are exactly the ones the CQ-Q-020 developer smoke has been
 * exercising since that packet, with one deliberate difference: sensitivity
 * is `FROM_PLAN` here. The smoke may declare its inputs synthetic; a
 * production run may not, so provider eligibility is decided from the
 * plan's own ceiling before any provider is contacted.
 */

export type QIntelligenceDependencies = {
  readonly sql: DatabaseExecutor;
  /** W1: what Q told them on arrival, prepared for every turn of theirs. */
  readonly arrivalSnapshot?:
    | ((actor: QAnswerRequest["actor"]) => Promise<ArrivalSnapshot | null>)
    | undefined;
  /** RECOVERY (C's request): receipt facts of the person's recent UI acts. */
  readonly uiActReceipts?:
    ((actor: QAnswerRequest["actor"]) => readonly string[]) | undefined;
  /**
   * Voice speculation (latency2): a spoken question's answer starts beside
   * the turn reader. `observe` hears whether each was adopted or cancelled
   * (the voice turn timing). Absent: no turn is speculated.
   */
  readonly speculation?:
    | {
        readonly observe?:
          | ((event: {
              readonly outcome: "ADOPTED" | "CANCELLED";
              readonly reason: string | null;
              readonly decidedAfterMs: number;
            }) => void)
          | undefined;
      }
    | undefined;
  readonly transactions: TransactionManager;
  readonly repositories: QRuntimeRepositories;
  /** The Safe Read tools, already composed. Canonical state is read through them. */
  readonly tools: QToolPort;
  /** Plans a relationship a hand-over names that the run's plan does not bind. */
  readonly firewall?: ContextFirewallPort | undefined;
  readonly gateway: ModelGateway;
  /**
   * What kind of material this deployment holds (doc 15 §62). Omitted
   * means REAL_CUSTOMER, which is every deployment that serves anybody.
   * A demo deployment that has attested its data is invented passes
   * SYNTHETIC_DEMO so free inference can carry the demo, exactly as §62
   * permits; the gateway still checks its own attestation before the
   * posture changes any route.
   */
  readonly dataPosture?: ModelDataPosture | undefined;
  /**
   * Query embeddings. Absent retrieves lexically and reports the
   * degradation; it never reaches for a paid embedding API instead.
   */
  readonly embeddings?: EmbeddingService | undefined;
  /**
   * Records a person's statement about their own company as their claim
   * (CQ-Q-RESEARCH-001 §21). Absent means a proposed statement is not kept.
   */
  readonly statements?: QUserStatementRecorder | undefined;
  /** Where a requested profile change is noted for the action proposer (ADR 0011). */
  readonly profileUpdates?: QProfileUpdateNotebook | undefined;
  /** J7: whether a quote asks to clear a field, read by meaning. */
  readonly clearCheck?: ClearCheck | undefined;
  /**
   * A typed yes or no to a change waiting in the conversation, read by
   * DECISION_READER and acted on through the Approval Engine (founder
   * fixture #1; pending-decision.ts).
   */
  readonly pendingDecisions?: PendingDecisionPort | undefined;
  /**
   * Their relationships' counterpart names, for what a request is about.
   * Required (lead 2026-10-03, run 9b4ef8d1): a composition without it does
   * not compile, rather than quietly never widening the offer.
   */
  /** Still-waiting reminders deferred to after the engine's step. */
  readonly waitingLines?:
    | {
        readonly defer: (
          runId: string,
          waiting: { readonly line: string; readonly actionId: string },
        ) => void;
      }
    | undefined;
  readonly counterpartNames: (
    request: QAnswerRequest,
  ) => Promise<readonly string[]>;
  /** W4: a researched entity reachable by name (seed or own research). */
  readonly externalEntities?: SpecialistQAnswerDependencies["externalEntities"];
  /** What Capital Q remembers about the person, for the prompts (ADR 0012). */
  readonly memory?: QMemoryRecall | undefined;
  /** The person's own onboarding, for Home Q (CQ-QX-007). Absent: not read. */
  readonly ownOnboarding?: QOwnOnboardingPort | undefined;
  /** Setup reminders at a natural pause (founder directive 2026-09-27). */
  readonly onboardingNudge?: QOnboardingNudgePort | undefined;
  /** ADR 0050: the business etiquette guides in force for this person. */
  readonly etiquetteOf?:
    | ((who: {
        readonly tenantId: string;
        readonly userId: string;
      }) => Promise<EtiquetteGuides | null>)
    | undefined;
  /** Who Q is with each person (founder direction 2026-09-30). */
  readonly personalityOf?:
    | ((request: {
        readonly tenantId: string;
        readonly userId: string;
      }) => Promise<string | null>)
    | undefined;
  /** Who is asking: their own name and company (founder live 2026-09-30). */
  /** Their own rehearsals and saved zone, for the own-day read. */
  readonly ownDay?: ModelGatewayQAnswerDependencies["ownDay"];
  readonly askerOf?: ModelGatewayQAnswerDependencies["askerOf"];
  /**
   * What exists on the person's own account, by kind (ADR 0040: QA's read
   * registry composes it). Absent: no index.
   */
  readonly ownIndex?: ModelGatewayQAnswerDependencies["ownIndex"];
  /**
   * Where an answer goes as it is written. Absent means it goes out only
   * when it is finished; the stored message and its completion event are
   * the same either way.
   */
  readonly deltas?: QLiveDeltaBus | undefined;
  /**
   * Preparing a document, when the artifact context is composed
   * (ADR 0013). Absent leaves the answer seam exactly as it was.
   */
  readonly artifacts?: ArtifactPreparation | undefined;
  /**
   * Changing a document from the conversational path (QX-003F): "make the
   * executive summary shorter" is about wording, not a company
   * investigation, so it never reaches the specialist seam.
   */
  readonly artifactReviser?: QArtifactReviser | undefined;
  /** What this conversation produced, read back from the owning records. */
  readonly receipts?: QReceiptPort | undefined;
  /**
   * Where a turn read as "show / hide my company" goes to be proposed
   * (CQ-QACT-001). Absent: such a turn is answered like any other.
   */
  readonly visibility?: QVisibilityNotebook | undefined;
  readonly logger?: Logger | undefined;
};

/**
 * What this composition can honestly do, for the startup log and the
 * capability check. Booleans about wiring, never about a run's outcome.
 */
export type QIntelligenceCapabilities = {
  readonly authorisedRetrieval: boolean;
  readonly knowledgeQuery: boolean;
  readonly companyIntelligence: boolean;
  readonly semanticRetrieval: boolean;
};

export type QIntelligenceComposition = {
  readonly retrieval: QRetrievalPort;
  readonly answer: QAnswerPort;
  readonly capabilities: QIntelligenceCapabilities;
};

/**
 * The production query-embedding service, over the local runtime that holds
 * document text on a private network (CQ-RAG-002).
 *
 * The configuration is the one chunks were embedded under; a query embedded
 * under a different model would search a space nothing was indexed in. The
 * runtime being unreachable is a per-request degradation the retrieval
 * service already reports — not a reason to withhold the port, and not a
 * reason to start without one.
 */
export function createProductionEmbeddingService(options?: {
  readonly onMissing?: (missing: readonly string[]) => void;
}): EmbeddingService {
  const config = loadEmbeddingConfig();
  if (config.missing.length > 0) options?.onMissing?.(config.missing);
  return createEmbeddingService({
    provider: createLocalTeiEmbeddingProvider({
      baseUrl: config.baseUrl,
      configuration: {
        ...QWEN3_EMBEDDING_CONFIGURATION,
        maxBatchItems: config.maxBatchItems,
      },
      timeoutMs: config.timeoutMs,
    }),
  });
}

export function composeQIntelligence(
  dependencies: QIntelligenceDependencies,
): QIntelligenceComposition {
  const {
    sql,
    transactions,
    repositories,
    tools,
    gateway,
    embeddings,
    statements,
    logger,
  } = dependencies;

  // Authorised hybrid retrieval (CQ-RAG-004). Lexical and semantic are
  // parallel components of one step, each already constrained in SQL by the
  // plan's envelope before ranking; fusion admits nothing new.
  const hydration = createPostgresChunkHydration();
  const retrievalService = createAuthorisedRetrievalService({
    sql,
    lexical: createPostgresLexicalSearch(),
    semantic: createPostgresSemanticSearch(),
    hydration,
    ...(embeddings === undefined ? {} : { embeddings }),
    ...(logger === undefined ? {} : { logger }),
  });

  // Authorised Q Knowledge (CQ-KNW-002, CQ-KNW-003). What Capital Q
  // currently understands, read under the same envelope, with confidence
  // and freshness travelling beside every statement.
  const knowledge = createKnowledgeQueryService({
    sql,
    knowledge: createPostgresKnowledgeRepository(),
    ...(logger === undefined ? {} : { logger }),
  });

  const evidence = createQEvidenceRetrieval({
    sql,
    repositories,
    retrieval: retrievalService,
    hydration,
    knowledge,
    ...(logger === undefined ? {} : { logger }),
  });

  // The conversational answer path, now holding the real authorised context
  // port instead of falling through to `noAuthorisedContext`.
  const conversational = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql,
    transactions,
    tools,
    // K Part 4: their own mandate read, kept per actor (Tier A) while D's
    // version for it is current; F's scope key, epoch read per request.
    ownMandateReads: createOwnMandateReads({
      knowledge: createPostgresCompanyKnowledge({ sql }),
      epochs: createPostgresContextEpochReader({ sql }),
    }),
    // A founder's own company, from their working snapshot (Tier A).
    ownCompanySnapshot: (() => {
      const snapshots = createWorkingSnapshots({
        sql,
        knowledge: createPostgresCompanyKnowledge({ sql }),
        epochs: createPostgresContextEpochReader({ sql }),
      });
      return async (actor) =>
        (await snapshots.forActor(actor))?.company ?? null;
    })(),
    ...(dependencies.uiActReceipts === undefined
      ? {}
      : { uiActReceipts: dependencies.uiActReceipts }),
    ...(dependencies.arrivalSnapshot === undefined
      ? {}
      : { arrivalSnapshot: dependencies.arrivalSnapshot }),
    context: evidence.context,
    ...(statements === undefined ? {} : { statements }),
    ...(dependencies.profileUpdates === undefined
      ? {}
      : { profileUpdates: dependencies.profileUpdates }),
    ...(dependencies.clearCheck === undefined
      ? {}
      : { clearCheck: dependencies.clearCheck }),
    ...(dependencies.memory === undefined
      ? {}
      : { memory: dependencies.memory }),
    ...(dependencies.ownOnboarding === undefined
      ? {}
      : { ownOnboarding: dependencies.ownOnboarding }),
    ...(dependencies.onboardingNudge === undefined
      ? {}
      : { onboardingNudge: dependencies.onboardingNudge }),
    ...(dependencies.etiquetteOf === undefined
      ? {}
      : { etiquetteOf: dependencies.etiquetteOf }),
    ...(dependencies.personalityOf === undefined
      ? {}
      : { personalityOf: dependencies.personalityOf }),
    ...(dependencies.askerOf === undefined
      ? {}
      : { askerOf: dependencies.askerOf }),
    ...(dependencies.ownIndex === undefined
      ? {}
      : { ownIndex: dependencies.ownIndex }),
    ...(dependencies.ownDay === undefined
      ? {}
      : { ownDay: dependencies.ownDay }),
    ...(dependencies.deltas === undefined
      ? {}
      : { deltas: dependencies.deltas }),
    ...(dependencies.dataPosture === undefined
      ? {}
      : { dataPosture: dependencies.dataPosture }),
    ...(dependencies.artifactReviser === undefined
      ? {}
      : { artifacts: dependencies.artifactReviser }),
    ...(dependencies.receipts === undefined
      ? {}
      : { receipts: dependencies.receipts }),
    ...(logger === undefined ? {} : { logger }),
  });

  // Company Intelligence (CQ-Q-020) behind the same seam. A person never
  // selects it and never learns it ran: `supports()` decides, and a request
  // it does not support goes to the conversational path unchanged.
  const specialist = createCompanyIntelligenceSpecialist({
    gateway,
    // The same attestation the conversational seam already carries: where
    // the server says the data was invented, the free route may serve it.
    ...(dependencies.dataPosture === undefined
      ? {}
      : { dataPosture: dependencies.dataPosture }),
    canonical: createToolCanonicalPort(tools, logger),
    // Public-web research through the same registry (CQ-Q-RESEARCH-001):
    // present whether or not a provider is composed — the registry says
    // "not offered" when none is, and the specialist answers accordingly.
    research: createToolResearchPort(tools, logger),
    ...(statements === undefined ? {} : { statements }),
    ...(dependencies.profileUpdates === undefined
      ? {}
      : { profileUpdates: dependencies.profileUpdates }),
    ...(dependencies.clearCheck === undefined
      ? {}
      : { clearCheck: dependencies.clearCheck }),
    ...(dependencies.memory === undefined
      ? {}
      : { memory: dependencies.memory }),
    knowledge: createKnowledgeCompanyPort(knowledge),
    evidence: createRetrievalEvidencePort(retrievalService, logger),
    // The plan's ceiling, never a declaration made at composition time.
    sensitivity: { kind: "FROM_PLAN" },
    ...(logger === undefined ? {} : { logger }),
  });

  const answer = createSpecialistQAnswer({
    specialist,
    delegate: conversational,
    ...(dependencies.speculation === undefined
      ? {}
      : {
          speculation: {
            spoken: true,
            observe: dependencies.speculation.observe,
          },
        }),
    ...(dependencies.pendingDecisions === undefined
      ? {}
      : { pendingDecisions: dependencies.pendingDecisions }),
    counterpartNames: dependencies.counterpartNames,
    ...(dependencies.externalEntities === undefined
      ? {}
      : { externalEntities: dependencies.externalEntities }),
    ...(dependencies.waitingLines === undefined
      ? {}
      : { waitingLines: dependencies.waitingLines }),
    // A hand-over read by the turn reader (v22), prepared as Q's errand
    // for the subject on screen through the run's own propose_errand.
    // TURN_READER v27 saveToOwnProfile: their profile's open fields,
    // filled from public sources by code (HARDEN P0, 2026-10-02).
    profileGaps: createToolProfileGapsPort({
      tools,
      read: createProfileGapReader({
        gateway,
        ...(dependencies.dataPosture === undefined
          ? {}
          : { dataPosture: dependencies.dataPosture }),
        ...(logger === undefined ? {} : { logger }),
      }),
      ...(logger === undefined ? {} : { logger }),
    }),
    // ADR 0040: a declared app action the reading names, run by code.
    // The reader named the action but gave no arguments: one small read of
    // its inputs against the tool's own schema (parity eval 2026-10-02).
    appActionArguments: createAppActionArgumentReader({
      gateway,
      tools,
      ...(dependencies.dataPosture === undefined
        ? {}
        : { dataPosture: dependencies.dataPosture }),
      ...(logger === undefined ? {} : { logger }),
    }),
    // A request to act that named no declared action: which one, from the
    // closed list (APP_ACTION_ROUTER, lead 2026-10-03).
    appActionRouter: createAppActionRouter({
      gateway,
      ...(dependencies.dataPosture === undefined
        ? {}
        : { dataPosture: dependencies.dataPosture }),
      ...(logger === undefined ? {} : { logger }),
    }),
    // A declared action waiting on their reply, kept on the conversation
    // (20261129090000) so a restart or another instance still continues it.
    pendingAppActions: createPostgresAwaitingActions({ sql: dependencies.sql }),
    // RECOVERY B3: the core's state on the conversation (20261220200000);
    // until that migration is applied, its reads and writes fail and the
    // seam stays on memory, as before.
    coreState: createPostgresConversationCore({ sql: dependencies.sql }),
    // RECOVERY B5: small talk in one short tool-free call.
    smallTalk: createSmallTalkReply({
      gateway,
      ...(dependencies.dataPosture === undefined
        ? {}
        : { dataPosture: dependencies.dataPosture }),
      ...(logger === undefined ? {} : { logger }),
    }),
    appActions: createToolAppActionPort({
      tools,
      // A declared action served by its hand-written tool (`legacyTool`,
      // e.g. propose_express_interest) is as much a declared action as
      // one with its own: left out, the router never saw it and "Express
      // interest in Clinicrest" was asked back (QA run 4e3b1903).
      names: appActionToolNames(APP_ACTIONS),
      ...(logger === undefined ? {} : { logger }),
    }),
    // follow-55: the one record a turn names or points at, opened through
    // open_page's own authorize step (their own records only).
    openRecord: createToolOpenRecordPort({
      tools,
      ...(logger === undefined ? {} : { logger }),
    }),
    // Lead 2026-10-03: "what should I do next?" opens with their readiness.
    readinessLead: createToolReadinessLead({ tools }),
    // QA 2026-10-03: work handed over in general is a standing instruction.
    delegation: createToolDelegationPort({
      tools,
      ...(logger === undefined ? {} : { logger }),
    }),
    handOver: createToolHandOverPort({
      tools,
      ...(dependencies.firewall === undefined
        ? {}
        : { firewall: dependencies.firewall }),
      ...(logger === undefined ? {} : { logger }),
    }),
    repositories,
    sql,
    transactions,
    ...(dependencies.artifacts === undefined
      ? {}
      : { artifacts: dependencies.artifacts }),
    ...(dependencies.visibility === undefined
      ? {}
      : { visibility: dependencies.visibility }),
    // Their own mandate, for a mandate document (gap 3): read through the
    // same tool, under the run's plan.
    ownMandate: createToolOwnMandatePort(tools, logger, MANDATE_LABELS),
    // The names on their own records, so a company name they said —
    // misheard by speech-to-text or not — resolves to what is theirs
    // before anything is researched (founder live 2026-09-27, #6).
    ownRecords: createToolOwnRecordsPort({
      tools,
      ...(dependencies.ownOnboarding === undefined
        ? {}
        : {
            personName: async (actor) =>
              (await dependencies.ownOnboarding?.read(actor))?.name ?? null,
          }),
      ...(logger === undefined ? {} : { logger }),
    }),
    // The tools the answer's model is offered for this run: with what is
    // composed they pick the run's entries of the capability registry
    // (R20), which the turn reader and the answer's note are given.
    offeredTools: async (request) =>
      (
        await (tools.available ?? tools.offer)({
          actor: request.actor,
          runId: request.runId,
          correlationId: request.correlationId,
          capability: request.capability,
          plan: request.plan,
        })
      ).map((tool) => tool.definition.name),
    ...(logger === undefined ? {} : { logger }),
    // Every turn is read before it is answered (CQ-QX-005): research and
    // failure notices are decided by the conversation core, not by a word
    // list. Without a logger there is nothing to report a failed reading
    // to, and the reading is skipped rather than failing silently.
    ...(logger === undefined
      ? {}
      : {
          turns: createQTurnReader({
            gateway,
            logger,
            ...(dependencies.dataPosture === undefined
              ? {}
              : { dataPosture: dependencies.dataPosture }),
          }),
          // K fast lane: a short first read races the full one; only a
          // read-only app query ever acts on it.
          turnSkim: createTurnSkimmer({
            gateway,
            logger,
            ...(dependencies.dataPosture === undefined
              ? {}
              : { dataPosture: dependencies.dataPosture }),
          }),
        }),
  });

  return {
    retrieval: evidence.port,
    answer,
    capabilities: {
      authorisedRetrieval: true,
      knowledgeQuery: true,
      companyIntelligence: true,
      semanticRetrieval: embeddings !== undefined,
    },
  };
}
