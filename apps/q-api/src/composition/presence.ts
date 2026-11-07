import { randomUUID } from "node:crypto";

import {
  CorrelationIdSchema,
  type CorrelationId,
  type ModelDataPosture,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import {
  EvidenceSourceIdSchema,
  type EvidenceService,
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
import type { KnowledgeWriteGate } from "@capital-q/q-knowledge";
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
  PLANNED_EXTRACT_BUDGET_MS,
  type PublicWebResearchService,
  type ResearchSubject,
} from "@capital-q/q-research";
import type { PublicProfileLookupProvider } from "@capital-q/q-research";

/**
 * Public presence, composed (CQ-Q-PRESENCE-001).
 *
 * Each port here is a thin adapter onto a context that already owns the
 * rule: Research decides what may leave in a query, Evidence decides what
 * may be recorded, the Write Gate decides what may be held, and the Model
 * Gateway decides which model runs. This file only connects them, and it
 * is the one place the reads are made to happen at the same time rather
 * than one after another.
 */

const PRESENCE_BUDGET = {
  maxAttempts: 3,
  maxEstimatedCostUsd: 0.05,
  maxOutputTokens: 2_048,
  attemptTimeoutMs: 40_000,
} as const;

function correlation(): CorrelationId {
  return CorrelationIdSchema.parse(`cor_${randomUUID()}`);
}

/**
 * The public web, several reads at once.
 *
 * A name search, the subject's own site, and a public profile they gave
 * are three independent network calls of a few seconds each; run in turn
 * they are the difference between a person waiting and not noticing.
 * `allSettled` because one read failing is one read's worth of loss.
 */
export function createPresenceReadPort(dependencies: {
  readonly research: PublicWebResearchService;
  readonly profiles?: PublicProfileLookupProvider | undefined;
  readonly logger?: Logger | undefined;
}): PresenceReadPort {
  const { research, profiles, logger } = dependencies;
  return {
    read: async ({ actor, correlationId, subject, identity, signal }) => {
      // One run id per build: the research context uses it to decide which
      // URLs an extract may read, and these reads belong together.
      const runId = randomUUID();
      const queries: string[] = [identity.name];
      if (identity.qualifier !== null && identity.qualifier.length > 0) {
        queries.push(`${identity.name} ${identity.qualifier}`);
      }
      if (identity.websiteUrl !== null && identity.websiteUrl.length > 0) {
        queries.push(`${identity.name} ${identity.websiteUrl}`);
      }

      // A company the actor owns is a subject the research context can
      // compose a query around: its declared name and website are the
      // public identity, so an obscure name is not minimised away. Sources
      // are not persisted there — this context registers them itself,
      // because it needs the ids to cite.
      const researchSubject =
        subject.subjectType === "COMPANY"
          ? ({
              kind: "COMPANY" as const,
              companyId: subject.subjectId,
              name: identity.name,
              websiteUrl: identity.websiteUrl,
              headquartersCountry: null,
              identityAuthorised: true,
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
            // P1-5 (onboarding plan §7): nobody waits on this read, so its
            // pages get the background budget (8 s), not a turn's 3 s that
            // cut them to search snippets.
            planned: true,
            maxSearches: 2,
            ...(signal === undefined ? {} : { signal }),
          }),
        );

      // P1-5: the site they gave, read directly. A young company's site is
      // often not indexed, and searching for it was the only way it was
      // ever reached. It is their own link, read as a public page.
      const website = identity.websiteUrl?.trim() ?? "";
      const readingOwnSite =
        website.length === 0
          ? Promise.resolve(null)
          : research
              .extract({
                actor,
                runId,
                correlationId,
                urls: [website],
                personNamed: [website],
                signal:
                  signal === undefined
                    ? AbortSignal.timeout(PLANNED_EXTRACT_BUDGET_MS)
                    : AbortSignal.any([
                        signal,
                        AbortSignal.timeout(PLANNED_EXTRACT_BUDGET_MS),
                      ]),
              })
              .catch((error: unknown) => {
                logger?.warn(
                  { err: error, correlationId },
                  "their own site could not be read",
                );
                return null;
              });

      // A profile URL the person gave is read directly: it is their own
      // link, and searching for it would be a worse way to reach it.
      const lookingUp =
        profiles !== undefined &&
        identity.profileUrl !== null &&
        identity.profileUrl.length > 0
          ? profiles.lookup(
              { url: identity.profileUrl },
              { ...(signal === undefined ? {} : { signal }) },
            )
          : null;

      const [searches, profile, ownSite] = await Promise.all([
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
        readingOwnSite,
      ]);

      const found: PresenceSource[] = [];
      if (ownSite !== null) {
        if (ownSite.status === "OK") {
          for (const source of ownSite.sources) {
            found.push({
              url: source.url,
              title: source.title,
              publishedAt: source.publishedAt,
              excerpt: source.excerpt,
              provider: "public_web",
              retrievedAt: source.retrievedAt,
            });
          }
        } else {
          // Logged, never said (DECISIONS 77): their site could not be read.
          logger?.warn(
            {
              correlationId,
              status: ownSite.status,
              failureClass: ownSite.failureClass,
            },
            "their own site had no provider to read it",
          );
        }
      }
      for (const outcome of searches) {
        if (outcome.status !== "fulfilled") {
          logger?.warn(
            { correlationId },
            "a public presence search did not complete",
          );
          continue;
        }
        if (outcome.value.status !== "OK") {
          // P0-3 (onboarding plan 2026-11-07): a refused or spent provider
          // is not "nothing found". The person still hears nothing
          // (DECISIONS 77); the logs say which, so a failing search can be
          // told apart from a subject with no public presence.
          const status = outcome.value.status;
          if (status === "PROVIDER_UNAVAILABLE") {
            logger?.warn(
              {
                correlationId,
                status,
                failureClass: outcome.value.failureClass,
              },
              "a public presence search had no provider to answer",
            );
          } else {
            logger?.info(
              { correlationId, status },
              "a public presence search found no public identity",
            );
          }
          continue;
        }
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
        // The provider's own fields, flattened into the same bounded text
        // every other page arrives as. No field is interpreted here.
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

/** Pages recorded as the subject's own evidence, so an understanding can cite one. */
export function createPresenceEvidencePort(
  evidence: EvidenceService,
): PresenceEvidencePort {
  return {
    registerSource: async (actor, input, correlationId) => {
      const source = await evidence.registerEvidenceSource({
        actor,
        correlationId,
        input: {
          sourceType: "PUBLIC_WEB",
          subject: {
            subjectType: input.subject.subjectType,
            subjectId: input.subject.subjectId,
          },
          provider: input.provider,
          ...(input.title === null ? {} : { title: input.title.slice(0, 200) }),
          sourceUrl: input.sourceUrl,
          retrievedAt: input.retrievedAt,
          ...(input.publishedAt === null ||
          Number.isNaN(Date.parse(input.publishedAt))
            ? {}
            : { publishedAt: new Date(input.publishedAt).toISOString() }),
          // A page's own account of somebody is secondary external
          // material; being online is not credibility.
          reliabilityClass: "SECONDARY_EXTERNAL",
          // The page is public; that this organisation read it is not.
          visibilityScope: "organisation_private",
          sensitivityClass: "INTERNAL",
          metadata: { capability: "presence" },
        },
      });
      return { id: source.id };
    },
    createItem: async (actor, input, correlationId) => {
      const item = await evidence.createEvidenceItem({
        actor,
        correlationId,
        input: {
          sourceId: EvidenceSourceIdSchema.parse(input.sourceId),
          evidenceType: "public_web.excerpt",
          summary: input.summary,
          structuredValue: { capability: "presence" },
          locator: { kind: "statement" },
          // What the page says; nothing has verified it.
          evidenceStatus: "SELF_REPORTED",
        },
      });
      return { id: item.id };
    },
  };
}

/** The model that reads the pages. It proposes; the gate decides. */
export function createPresenceReaderPort(dependencies: {
  readonly gateway: ModelGateway;
  /** Doc 15 section 62; set by a composition root holding an attestation. */
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
            // Public pages about a subject this organisation owns. Nothing
            // confidential is in the prompt, and nothing may be added to it.
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
        // A namesake is the usual reason a search returns strangers.
        // Recording a stranger's page against this person is worse than
        // recording nothing, so the whole build is discarded.
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
export function createPresenceKnowledgePort(dependencies: {
  readonly gate: KnowledgeWriteGate;
  readonly logger?: Logger | undefined;
}): PresenceKnowledgePort {
  const { gate } = dependencies;
  return {
    propose: async (actor, input, correlationId) => {
      const result = await gate.submit({
        actor,
        correlationId,
        // Public text a model interpreted is exactly what §11 says a person
        // should see before it becomes authoritative: never automatic.
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
          // Q read a page and is saying what it says. Not the subject's own
          // claim to us, not a measurement, not verified.
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
      // Whether the store holds it now. HELD is the normal outcome here —
      // a model reading public prose is exactly what §11 says a person
      // should confirm — and it writes a CANDIDATE row, so it counts. Only
      // an outcome with no object behind it does not.
      return { accepted: result.objectId !== null };
    },
  };
}

export type PresenceComposition = {
  readonly presence: PresenceService;
};

export function composePresence(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly evidence: EvidenceService;
  readonly gateway: ModelGateway;
  readonly dataPosture?: ModelDataPosture | undefined;
  readonly gate: KnowledgeWriteGate;
  readonly research?: PublicWebResearchService | undefined;
  readonly profiles?: PublicProfileLookupProvider | undefined;
  readonly logger?: Logger | undefined;
}): PresenceComposition | undefined {
  // Without a way to read the public web there is no presence to build;
  // saying so is better than a service that always finds nothing.
  if (dependencies.research === undefined) return undefined;
  const logger = dependencies.logger;
  return {
    presence: createPresenceService({
      web: createPresenceReadPort({
        research: dependencies.research,
        ...(dependencies.profiles === undefined
          ? {}
          : { profiles: dependencies.profiles }),
        ...(logger === undefined ? {} : { logger }),
      }),
      evidence: createPresenceEvidencePort(dependencies.evidence),
      reader: createPresenceReaderPort({
        gateway: dependencies.gateway,
        ...(dependencies.dataPosture === undefined
          ? {}
          : { dataPosture: dependencies.dataPosture }),
        ...(logger === undefined ? {} : { logger }),
      }),
      knowledge: createPresenceKnowledgePort({
        gate: dependencies.gate,
        ...(logger === undefined ? {} : { logger }),
      }),
      log: createPostgresPresenceBuildLog({ sql: dependencies.sql }),
      ...(logger === undefined ? {} : { logger }),
    }),
  };
}

export { correlation as presenceCorrelationId };
