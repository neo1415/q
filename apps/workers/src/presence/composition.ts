import { randomUUID } from "node:crypto";

import type { ResearchProviderSecrets } from "@capital-q/config/research-providers";
import { type ModelDataPosture } from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import {
  EvidenceSourceIdSchema,
  type EvidenceRepositories,
} from "@capital-q/evidence";
import type { ModelGateway } from "@capital-q/model-gateway";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  PresenceReaderResultSchema,
  renderPrompt,
  type PresenceReaderResult,
  type PresenceReaderVariables,
} from "@capital-q/q-core";
import {
  createKnowledgeWriteGate,
  createPostgresContradictionRepository,
  createPostgresKnowledgeRepository,
  type KnowledgeWriteGate,
} from "@capital-q/q-knowledge";
import {
  createPostgresPresenceBuildLog,
  createPresenceService,
  PRESENCE_BOUNDS,
  type PresenceEvidencePort,
  type PresenceKnowledgePort,
  type PresenceReaderPort,
  type PresenceReadPort,
  type PresenceService,
  type PresenceSource,
} from "@capital-q/q-presence";
import {
  createPublicWebResearchService,
  type PublicProfileLookupProvider,
  type PublicWebResearchProvider,
  type PublicWebResearchService,
  type ResearchSubject,
} from "@capital-q/q-research";
import {
  createBrightDataProfileLookup,
  createBrightDataResearchProvider,
} from "@capital-q/q-research/providers/brightdata";
import { createCachedResearchProvider } from "@capital-q/q-research/providers/cached";
import { createFallbackResearchProvider } from "@capital-q/q-research/providers/fallback";
import { createSerpApiResearchProvider } from "@capital-q/q-research/providers/serpapi";
import { createTavilyResearchProvider } from "@capital-q/q-research/providers/tavily";

/**
 * Public presence, composed for the worker (CQ-C2: research wiring).
 *
 * Every typed onboarding session ran a whole interview and Q never once
 * read the public web about the company being described, because the only
 * caller of `@capital-q/q-presence` was the voice turn (`apps/q-api/src/
 * voice/turn.ts`). This is the same package, the same rules, composed a
 * second time for a channel that has no live request to hang a background
 * read off: the worker's own domain-event consumer, which already fires for
 * both channels because `onboarding.response.committed` is written to the
 * outbox regardless of whether the answer arrived by voice or by typing.
 *
 * Deliberately smaller than the q-api composition it mirrors
 * (`apps/q-api/src/composition/presence.ts` + `.../research.ts`): a worker
 * has no live actor request and no authorized `EvidenceService` to reach
 * for, so this writes evidence sources and items through Evidence's own
 * repositories directly (parameterised SQL, tenant-scoped, exactly the
 * shape `EvidenceService.createEvidenceItem` itself would insert) rather
 * than standing up an `AuthorizationService` a background job has no use
 * for. Nothing here reaches a canonical table Evidence does not already own.
 */

const PRESENCE_BUDGET = {
  maxAttempts: 3,
  maxEstimatedCostUsd: 0.05,
  maxOutputTokens: 2_048,
  attemptTimeoutMs: 40_000,
} as const;

/**
 * The public web, several reads at once (mirrors
 * `apps/q-api/src/composition/presence.ts`'s read port: apps cannot import
 * one another, so the composition is duplicated, not the domain logic it
 * calls into).
 */
export function createWorkerPresenceReadPort(dependencies: {
  readonly research: PublicWebResearchService;
  readonly profiles?: PublicProfileLookupProvider | undefined;
  readonly logger?: Logger | undefined;
}): PresenceReadPort {
  const { research, profiles, logger } = dependencies;
  return {
    read: async ({ actor, correlationId, subject, identity, signal }) => {
      const runId = randomUUID();
      const queries: string[] = [identity.name];
      if (identity.qualifier !== null && identity.qualifier.length > 0) {
        queries.push(`${identity.name} ${identity.qualifier}`);
      }
      if (identity.websiteUrl !== null && identity.websiteUrl.length > 0) {
        queries.push(`${identity.name} ${identity.websiteUrl}`);
      }

      const researchSubject =
        subject.subjectType === "COMPANY"
          ? ({
              kind: "COMPANY" as const,
              companyId: subject.subjectId,
              name: identity.name,
              websiteUrl: identity.websiteUrl,
              headquartersCountry: null,
              identityAuthorised: true,
              // The worker registers sources itself, below; the research
              // context must not also try to persist them a second way.
              persistAsEvidence: false,
            } satisfies ResearchSubject)
          : null;
      const searching = queries
        .slice(0, PRESENCE_BOUNDS.maxReads)
        .map((query) =>
          research.research({
            actor,
            runId,
            correlationId,
            requestedQuery: query,
            userText: query,
            subject: researchSubject,
            extractCount: PRESENCE_BOUNDS.maxSourcesPerRead,
            ...(signal === undefined ? {} : { signal }),
          }),
        );

      const lookingUp =
        profiles !== undefined &&
        identity.profileUrl !== null &&
        identity.profileUrl.length > 0
          ? profiles.lookup(
              { url: identity.profileUrl },
              { ...(signal === undefined ? {} : { signal }) },
            )
          : null;

      const [searches, profile] = await Promise.all([
        Promise.allSettled(searching),
        lookingUp === null
          ? Promise.resolve(null)
          : lookingUp.catch((error: unknown) => {
              logger?.warn(
                { err: error, correlationId },
                "a public profile could not be read",
              );
              return null;
            }),
      ]);

      const found: PresenceSource[] = [];
      for (const outcome of searches) {
        if (outcome.status !== "fulfilled") {
          logger?.warn(
            { correlationId },
            "a public presence search did not complete",
          );
          continue;
        }
        if (outcome.value.status !== "OK") continue;
        for (const source of outcome.value.sources) {
          found.push({
            url: source.url,
            title: source.title,
            publishedAt: source.publishedAt,
            excerpt: source.excerpt,
            provider: "public_web",
            retrievedAt: source.retrievedAt,
          });
        }
      }
      if (
        profile !== null &&
        profile.status === "FOUND" &&
        profile.profile !== null
      ) {
        const page = profile.profile;
        const lines =
          page.kind === "PERSON"
            ? [
                page.name,
                page.headline,
                page.location,
                page.currentCompany === null
                  ? null
                  : [page.currentCompany.title, page.currentCompany.name]
                      .filter((part) => part !== null)
                      .join(" at "),
                page.about,
              ]
            : [page.name, page.about, page.headquarters];
        found.push({
          url: page.url,
          title: page.name,
          publishedAt: null,
          excerpt: lines
            .filter((line): line is string => line !== null && line.length > 0)
            .join("\n")
            .slice(0, PRESENCE_BOUNDS.maxExcerptChars),
          provider: "public_profile",
          retrievedAt: new Date().toISOString(),
        });
      }
      return found;
    },
  };
}

/**
 * Pages recorded as the subject's own evidence, through Evidence's own
 * repositories rather than its authorized service (see file header).
 * `createItem` re-reads the source it was just handed the id of: the
 * subject a source was registered against is what an item must inherit
 * (`packages/evidence/src/application/evidence-item-use-cases.ts` does the
 * same lookup before inserting), and the port's own shape has nowhere else
 * to carry it.
 */
export function createWorkerPresenceEvidencePort(dependencies: {
  readonly transactions: TransactionManager;
  readonly sql: DatabaseExecutor;
  readonly evidence: EvidenceRepositories;
}): PresenceEvidencePort {
  const { transactions, sql, evidence } = dependencies;
  const sources = evidence.sources;
  const items = evidence.evidenceItems;
  return {
    registerSource: async (actor, input) => {
      const source = await transactions.run((tx) =>
        sources.insert(tx, {
          tenantId: actor.tenantId,
          sourceType: "PUBLIC_WEB",
          subjectType: input.subject.subjectType,
          subjectId: input.subject.subjectId,
          provider: input.provider,
          externalReference: null,
          title: input.title === null ? null : input.title.slice(0, 200),
          sourceUrl: input.sourceUrl,
          createdByUserId: actor.userId,
          retrievedAt: input.retrievedAt,
          publishedAt:
            input.publishedAt === null ||
            Number.isNaN(Date.parse(input.publishedAt))
              ? null
              : new Date(input.publishedAt).toISOString(),
          // A page's own account of a subject is secondary external
          // material; being online is not credibility.
          reliabilityClass: "SECONDARY_EXTERNAL",
          // The page is public; that this organisation read it is not.
          visibilityScope: "organisation_private",
          sensitivityClass: "INTERNAL",
          metadata: { capability: "presence" },
        }),
      );
      return { id: source.id };
    },
    createItem: async (actor, input) => {
      const sourceId = EvidenceSourceIdSchema.parse(input.sourceId);
      const source = await sources.findById(sql, actor.tenantId, sourceId);
      if (source === null) {
        throw new Error("presence evidence source vanished before its item");
      }
      const item = await transactions.run((tx) =>
        items.insert(tx, {
          tenantId: actor.tenantId,
          sourceId,
          subjectType: source.subjectType,
          subjectId: source.subjectId,
          evidenceType: "public_web.excerpt",
          summary: input.summary,
          structuredValue: { capability: "presence" },
          locator: { kind: "statement" },
          validFrom: null,
          validTo: null,
          // What the page says; nothing has verified it.
          evidenceStatus: "SELF_REPORTED",
          reliabilityClass: source.reliabilityClass,
          visibilityScope: source.visibilityScope,
          sensitivityClass: source.sensitivityClass,
          createdByUserId: actor.userId,
        }),
      );
      return { id: item.id };
    },
  };
}

/** The model that reads the pages. It proposes; the gate decides. */
export function createWorkerPresenceReaderPort(dependencies: {
  readonly gateway: ModelGateway;
  readonly dataPosture?: ModelDataPosture | undefined;
  readonly logger?: Logger | undefined;
}): PresenceReaderPort {
  const registry = createDefaultPromptRegistry();
  const { gateway, logger } = dependencies;
  return {
    read: async (request) => {
      const variables: Omit<
        PresenceReaderVariables,
        | "operatingMode"
        | "communicationProfile"
        | "communicationGuidance"
        | "environmentNotes"
      > = {
        subjectType: request.subjectType,
        subjectName: request.identity.name,
        subjectWebsite: request.identity.websiteUrl,
        sources: request.sources.map((source) => ({
          index: source.index,
          url: source.url,
          title: source.title,
          excerpt: source.excerpt,
        })),
      };
      const rendered = renderPrompt<PresenceReaderVariables>(registry, {
        task: "PRESENCE_READER",
        operatingMode: "ASSESSMENT",
        communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
        environmentNotes:
          "No tools are available to you. Report only what the supplied pages say; there is no scoring service and no assessment to produce.",
        variables,
      });
      try {
        const result = await gateway.execute<PresenceReaderResult>(
          {
            taskClass: "STRUCTURED_EXTRACTION",
            budget: PRESENCE_BUDGET,
            ...(dependencies.dataPosture === undefined
              ? {}
              : { dataPosture: dependencies.dataPosture }),
            sensitivity: "INTERNAL",
            messages: [...rendered.messages],
            output: rendered.output,
            attribution: {
              tenantId: request.actor.tenantId,
              userId: request.actor.userId,
              correlationId: request.correlationId,
            },
          },
          {
            schema: PresenceReaderResultSchema,
            ...(request.signal === undefined ? {} : { signal: request.signal }),
          },
        );
        if (result.output.kind !== "STRUCTURED") return [];
        const value = result.output.value;
        if (value.wrongSubject) return [];
        return value.understandings.map((understanding) => ({
          key: understanding.key,
          statement: understanding.statement,
          sourceIndexes: understanding.sourceIndexes,
        }));
      } catch (error: unknown) {
        logger?.warn(
          { err: error, correlationId: request.correlationId },
          "presence reader produced no understandings",
        );
        return [];
      }
    },
  };
}

/** The Knowledge Write Gate. Everything it refuses stays unheld. */
export function createWorkerPresenceKnowledgePort(dependencies: {
  readonly gate: KnowledgeWriteGate;
}): PresenceKnowledgePort {
  const { gate } = dependencies;
  return {
    propose: async (actor, input, correlationId) => {
      const result = await gate.submit({
        actor,
        correlationId,
        automatic: false,
        candidate: {
          subject: {
            subjectType: input.subject.subjectType,
            subjectId: input.subject.subjectId,
          },
          knowledgeType: "observation",
          knowledgeKey: input.key,
          statement: input.statement,
          structuredValue: null,
          truthClassProposal: "Q_INFERENCE",
          supportingClaimIds: [],
          supportingEvidenceItemIds: [...input.supportingEvidenceItemIds],
          supportingSourceIds: [...input.supportingSourceIds],
          validFrom: null,
          validTo: null,
          definitionQualifier: null,
          measurementBasis: "UNSPECIFIED",
          correctsEarlier: false,
          lineage: [],
          reason: "PUBLIC_PRESENCE_READ",
        },
      });
      return { accepted: result.objectId !== null };
    },
  };
}

/**
 * Which research indexes this deployment can reach, resolved from the same
 * env vars `@capital-q/config/research-providers` already validates for
 * q-api. The worker deployable has no research-provider config of its own
 * (CQ-Q-RESEARCH-001 was never wired for it); this reuses that package's
 * public parsing rather than inventing a second schema for the same keys.
 */
export function composeWorkerResearchProvider(
  secrets: ResearchProviderSecrets,
): {
  readonly provider: PublicWebResearchProvider | undefined;
  readonly profiles: PublicProfileLookupProvider | undefined;
} {
  const brightData = secrets.brightData;
  const indexes = [
    ...(brightData !== undefined &&
    brightData.serpZone !== undefined &&
    brightData.unlockerZone !== undefined
      ? [
          createBrightDataResearchProvider({
            apiKey: brightData.apiKey.reveal(),
            serpZone: brightData.serpZone,
            unlockerZone: brightData.unlockerZone,
          }),
        ]
      : []),
    ...(secrets.tavily === undefined
      ? []
      : [createTavilyResearchProvider({ apiKey: secrets.tavily.reveal() })]),
    ...(secrets.serpApi === undefined
      ? []
      : [
          createSerpApiResearchProvider({
            apiKey: secrets.serpApi.reveal(),
          }),
        ]),
  ];
  const provider =
    indexes.length === 0
      ? undefined
      : createCachedResearchProvider({
          provider: createFallbackResearchProvider({ providers: indexes }),
        });
  const profiles =
    brightData === undefined
      ? undefined
      : createBrightDataProfileLookup({ apiKey: brightData.apiKey.reveal() });
  return { provider, profiles };
}

export type WorkerPresenceComposition = {
  readonly presence: PresenceService;
};

export function composeWorkerPresence(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly evidence: EvidenceRepositories;
  readonly gateway: ModelGateway;
  readonly dataPosture?: ModelDataPosture | undefined;
  readonly researchSecrets: ResearchProviderSecrets;
  readonly logger?: Logger | undefined;
}): WorkerPresenceComposition | undefined {
  const { provider, profiles } = composeWorkerResearchProvider(
    dependencies.researchSecrets,
  );
  // Without a way to read the public web there is no presence to build;
  // saying so is better than a service that always finds nothing.
  if (provider === undefined) return undefined;
  const logger = dependencies.logger;
  const research = createPublicWebResearchService({
    provider,
    ...(logger === undefined ? {} : { logger }),
  });
  const gate = createKnowledgeWriteGate({
    sql: dependencies.sql,
    transactions: dependencies.transactions,
    knowledge: createPostgresKnowledgeRepository(),
    contradictions: createPostgresContradictionRepository(),
    evidence: dependencies.evidence,
    ...(logger === undefined ? {} : { logger }),
  });
  return {
    presence: createPresenceService({
      web: createWorkerPresenceReadPort({
        research,
        ...(profiles === undefined ? {} : { profiles }),
        ...(logger === undefined ? {} : { logger }),
      }),
      evidence: createWorkerPresenceEvidencePort({
        sql: dependencies.sql,
        transactions: dependencies.transactions,
        evidence: dependencies.evidence,
      }),
      reader: createWorkerPresenceReaderPort({
        gateway: dependencies.gateway,
        ...(dependencies.dataPosture === undefined
          ? {}
          : { dataPosture: dependencies.dataPosture }),
        ...(logger === undefined ? {} : { logger }),
      }),
      knowledge: createWorkerPresenceKnowledgePort({ gate }),
      log: createPostgresPresenceBuildLog({ sql: dependencies.sql }),
      ...(logger === undefined ? {} : { logger }),
    }),
  };
}
