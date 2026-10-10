import {
  PersonBriefSchema,
  type ExternalPersonSubject,
  type PersonBrief,
  type PersonBriefAssertion,
  type PersonBriefTopic,
} from "@capital-q/contracts";
import type {
  KnownEntityRecord,
  KnownEntityStore,
  ResearchedEntityReader,
  ResearchedEntityStore,
} from "@capital-q/q-research";

import type {
  ExternalSubjectRecord,
  ExternalSubjectScope,
} from "./external-subjects.js";

/**
 * Where a rehearsal gets its researched entity from, at the moment it is
 * prepared: the asker's own researched record and newest brief (the people
 * research, W2), else a prepared public seed. The result is handed to the
 * rehearsal service, which freezes it per brief version
 * (ExternalSubjectStore.save). Only records the asker owns, or the platform's
 * prepared seeds, can be resolved: an id from anywhere else is not found.
 */

export type ExternalSubjectResolver = (
  scope: ExternalSubjectScope,
  externalPersonId: string,
) => Promise<ExternalSubjectRecord | null>;

/** Seed facts about what the entity discusses or emphasises are fit themes. */
const THEME =
  /interest|focus|emphasi|discuss|highlight|advocate|publicly|strateg/iu;
/** A seed fact the loader flagged for a recheck: unconfirmed, not contradicted. */
const UNCONFIRMED = /verify|recheck|time-sensitive|third-party|report/iu;

/**
 * A prepared entity's brief for rehearsal, from its stored facts and
 * sources. A fact marked for recheck stays in as an unconfirmed report
 * (REASONABLE_INFERENCE, which the persona words softly); nothing is added
 * that the seed does not hold, and nothing is marked contradicted.
 */
export function briefFromSeed(record: KnownEntityRecord): PersonBrief | null {
  const refs = new Map(
    record.sources.map((source, at) => [source.sourceId, at] as const),
  );
  const assertions: PersonBriefAssertion[] = record.facts.flatMap((fact) => {
    const sourceRefs = fact.sourceIds
      .map((id) => refs.get(id))
      .filter((at): at is number => at !== undefined)
      .slice(0, 6);
    if (sourceRefs.length === 0) return [];
    const topic: PersonBriefTopic = THEME.test(fact.claim)
      ? "RECURRING_TOPICS"
      : "BACKGROUND";
    return [
      {
        topic,
        text: fact.claim.slice(0, 400),
        assertionClass: UNCONFIRMED.test(fact.evidenceClass ?? "")
          ? ("REASONABLE_INFERENCE" as const)
          : ("PUBLIC_STATEMENT" as const),
        sourceRefs,
        asOf: null,
      },
    ];
  });
  if (assertions.length === 0) return null;
  const parsed = PersonBriefSchema.safeParse({
    externalPersonId: record.externalPersonId,
    entityKind: record.entityKind,
    quotes: record.quotes,
    version: 1,
    builtAt: record.lastResearchedAt,
    freshUntil: record.lastResearchedAt,
    sources: record.sources.slice(0, 16).map((source) => ({
      id: source.sourceId,
      description: source.description,
      evidenceClass: source.evidenceClass,
      url: source.url,
      domain: hostOf(source.url),
      title: source.description,
      publishedAt: source.publishedAt,
      retrievedAt: record.lastResearchedAt,
      provider: "prepared",
    })),
    assertions,
  });
  return parsed.success ? parsed.data : null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./u, "");
  } catch {
    return "";
  }
}

export function createExternalSubjectResolver(dependencies: {
  readonly researched: ResearchedEntityReader &
    Pick<ResearchedEntityStore, "latestBrief">;
  readonly known: Pick<KnownEntityStore, "listPrepared">;
}): ExternalSubjectResolver {
  return async (scope, externalPersonId) => {
    const own = await dependencies.researched.find(scope, { externalPersonId });
    if (own !== null) {
      const brief = await dependencies.researched.latestBrief(
        scope,
        externalPersonId,
      );
      return {
        subject: {
          ...own.subject,
          briefVersion: brief?.version ?? own.subject.briefVersion,
        },
        brief,
      };
    }
    // A prepared public seed (the platform's, not any member's).
    const seeds = await dependencies.known.listPrepared();
    const seed = seeds.find((s) => s.externalPersonId === externalPersonId);
    if (seed === undefined) return null;
    const brief = briefFromSeed(seed);
    const subject: ExternalPersonSubject = {
      externalPersonId: seed.externalPersonId,
      entityKind: seed.entityKind,
      researchStatus: seed.researchStatus,
      requiresRefresh: seed.requiresRefresh,
      image: seed.image,
      quotes: [...seed.quotes],
      displayName: seed.displayName,
      nameVariants: [...seed.aliases].slice(0, 12),
      profileUrl: seed.profileUrl,
      role: seed.entityKind === "PERSON" ? seed.role : null,
      organization: seed.organization,
      location: seed.location,
      evidenceBundleId: null,
      briefVersion: brief?.version ?? 0,
      confidence: seed.confidence,
    };
    return { subject, brief };
  };
}
