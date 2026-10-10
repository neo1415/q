import type {
  ExternalEntityKind,
  ExternalPersonSource,
  ExternalPersonSubject,
  PersonBrief,
  PersonBriefAssertion,
} from "@capital-q/contracts/q";
import { PersonBriefSchema } from "@capital-q/contracts/q";

import { boundExcerpt } from "../domain/excerpt.js";
import {
  admitAssertions,
  BRIEF_FRESH_DAYS,
  withUnknowns,
  type BriefSource,
  type ProposedAssertion,
} from "../domain/person-brief.js";
import { judgePublicUrl, publicDomainOf } from "../domain/url-safety.js";
import {
  isResearchProviderFailure,
  type PublicWebResearchProvider,
} from "../ports.js";
import type { KnownEntityRecord } from "./known-entities.js";

/**
 * The person brief (W2, 2026-10-10): background to prepare a conversation
 * with a public person, company or government body. Built after the
 * identity card, never in front of it; stored versioned and scoped to the
 * member who asked; reused while fresh; "refresh" forces a new search.
 *
 * Only metadata, links, evidence references and derived summaries are
 * kept, never page bodies. Every assertion is classed and cited, and code
 * admits it only against a verbatim quote (domain/person-brief.ts).
 */

export type ResearchedEntityScope = {
  readonly tenantId: string;
  readonly userId: string;
};

export type ResearchedEntityStore = {
  /** Idempotent by profile key within the asker's scope. */
  readonly remember: (
    scope: ResearchedEntityScope,
    input: {
      readonly profileKey: string;
      readonly subject: ExternalPersonSubject;
      readonly sources: readonly ExternalPersonSource[];
    },
  ) => Promise<{
    readonly externalPersonId: string;
    readonly evidenceBundleId: string;
  }>;
  readonly latestBrief: (
    scope: ResearchedEntityScope,
    externalPersonId: string,
  ) => Promise<PersonBrief | null>;
  /** Append-only: a new version is a new row. */
  readonly appendBrief: (
    scope: ResearchedEntityScope,
    brief: PersonBrief,
  ) => Promise<void>;
};

/** Reads bounded text from the sources and proposes assertions (a model). */
export type PersonBriefSynthesiser = (input: {
  readonly subjectName: string;
  readonly entityKind: ExternalEntityKind;
  readonly sources: readonly BriefSource[];
  /** Whose research this is, for the model ledger. */
  readonly attribution: {
    readonly tenantId: string;
    readonly userId: string;
    readonly correlationId: string;
  };
  readonly signal?: AbortSignal | undefined;
}) => Promise<readonly ProposedAssertion[] | null>;

export type PersonBriefCommand = {
  readonly scope: ResearchedEntityScope;
  readonly subject: ExternalPersonSubject;
  readonly sources: readonly ExternalPersonSource[];
  /** The member asked for a fresh read: the stored brief is bypassed. */
  readonly refresh?: boolean | undefined;
  readonly signal?: AbortSignal | undefined;
};

export type PersonBriefOutcome = {
  readonly brief: PersonBrief;
  readonly reused: boolean;
};

const EXTRACT_DEADLINE_MS = 8_000;
const EXTRA_SEARCH_DEADLINE_MS = 4_000;
const MAX_PAGES = 4;

export function createPersonBriefService(dependencies: {
  readonly providers: readonly PublicWebResearchProvider[];
  readonly store: ResearchedEntityStore;
  readonly synthesise?: PersonBriefSynthesiser | undefined;
  readonly clock?: (() => Date) | undefined;
}): {
  readonly brief: (command: PersonBriefCommand) => Promise<PersonBriefOutcome>;
} {
  const clock = dependencies.clock ?? (() => new Date());
  const within = <T>(
    run: (signal: AbortSignal) => Promise<T>,
    ms: number,
    parent?: AbortSignal,
  ): Promise<T | null> => {
    const signal =
      parent === undefined
        ? AbortSignal.timeout(ms)
        : AbortSignal.any([parent, AbortSignal.timeout(ms)]);
    return new Promise<T | null>((resolve) => {
      signal.addEventListener("abort", () => resolve(null), { once: true });
      run(signal).then(resolve, (error: unknown) => {
        if (!isResearchProviderFailure(error)) resolve(null);
        else resolve(null);
      });
    });
  };

  return {
    brief: async (command) => {
      const now = clock();
      const { scope, subject } = command;
      const existing = await dependencies.store.latestBrief(
        scope,
        subject.externalPersonId,
      );
      if (
        existing !== null &&
        command.refresh !== true &&
        Date.parse(existing.freshUntil) > now.getTime()
      ) {
        return { brief: existing, reused: true };
      }

      // Pages: the identity sources first, read through the first index
      // that can read pages; then two bounded searches for statements.
      const urls = command.sources
        .map((s) => s.url)
        .filter((url) => judgePublicUrl(url).ok)
        .slice(0, MAX_PAGES);
      const pages = new Map<string, string>();
      const reader = dependencies.providers[0];
      if (reader !== undefined && urls.length > 0) {
        const extracted = await within(
          (signal) => reader.extract({ urls }, { signal }),
          EXTRACT_DEADLINE_MS,
          command.signal,
        );
        for (const page of extracted?.pages ?? []) {
          pages.set(page.url, page.text);
        }
      }
      const extraHits: {
        url: string;
        title: string | null;
        snippet: string;
        publishedAt: string | null;
        provider: string;
      }[] = [];
      if (reader !== undefined) {
        const statements = await Promise.all(
          [
            `${subject.displayName} interview OR keynote OR conference`,
            `${subject.displayName} ${subject.organization ?? ""} views OR outlook`,
          ].map((query) =>
            within(
              (signal) =>
                reader.search(
                  {
                    query: query.replace(/\s+/gu, " ").trim(),
                    maxResults: 4,
                    freshness: "ANY",
                    includeDomains: [],
                  },
                  { signal },
                ),
              EXTRA_SEARCH_DEADLINE_MS,
              command.signal,
            ),
          ),
        );
        for (const result of statements) {
          for (const hit of result?.hits ?? []) {
            if (!judgePublicUrl(hit.url).ok) continue;
            extraHits.push({
              url: hit.url,
              title: hit.title,
              snippet: hit.snippet,
              publishedAt: hit.publishedAt,
              provider: reader.code,
            });
          }
        }
      }

      const sources: BriefSource[] = [];
      const seen = new Set<string>();
      const push = (source: ExternalPersonSource, text: string): void => {
        if (seen.has(source.url) || sources.length >= 10) return;
        seen.add(source.url);
        const bounded = boundExcerpt(text);
        // A page that instructs is still only a page: it is dropped from
        // the reader's input rather than quoted.
        if (bounded.instructionRisk.length > 0) return;
        sources.push({ ...source, excerpt: bounded.text });
      };
      for (const source of command.sources) {
        push(
          source,
          `${source.title ?? ""}. ${source.description ?? ""} ${pages.get(source.url) ?? ""}`,
        );
      }
      for (const hit of extraHits) {
        push(
          {
            id: null,
            description: null,
            evidenceClass: null,
            url: hit.url,
            domain: publicDomainOf(hit.url) ?? "",
            title: hit.title === null ? null : hit.title.slice(0, 300),
            publishedAt: hit.publishedAt,
            retrievedAt: now.toISOString(),
            provider: hit.provider,
          },
          `${hit.title ?? ""}. ${hit.snippet}`,
        );
      }

      // Deterministic facts from the identity read itself, quoted from the
      // profile's own title and snippet; then whatever the reader proposes.
      const proposals: ProposedAssertion[] = [];
      const profile = sources[0];
      if (
        profile !== undefined &&
        subject.entityKind === "PERSON" &&
        subject.role !== null &&
        profile.excerpt.toLowerCase().includes(subject.role.toLowerCase())
      ) {
        proposals.push({
          topic: "CURRENT_ROLE",
          text: `${subject.displayName}: ${subject.role}${subject.organization === null ? "" : `, ${subject.organization}`}.`,
          assertionClass: "PUBLIC_STATEMENT",
          sourceRefs: [0],
          quote:
            subject.role.length >= 12
              ? subject.role
              : `${subject.role} ${subject.organization ?? ""}`.trim(),
        });
      }
      const synthesise = dependencies.synthesise;
      if (synthesise !== undefined && sources.length > 0) {
        const proposed = await within(
          (signal) =>
            synthesise({
              subjectName: subject.displayName,
              entityKind: subject.entityKind,
              sources,
              attribution: {
                tenantId: scope.tenantId,
                userId: scope.userId,
                correlationId:
                  `person-brief:${subject.externalPersonId}:${String((existing?.version ?? 0) + 1)}`.slice(
                    0,
                    128,
                  ),
              },
              signal,
            }),
          25_000,
          command.signal,
        );
        for (const item of proposed ?? []) proposals.push(item);
      }
      const admitted = admitAssertions(proposals, sources, now);
      const assertions: PersonBriefAssertion[] = [
        ...withUnknowns(admitted.admitted, subject.displayName),
      ];
      const version = (existing?.version ?? 0) + 1;
      const brief = PersonBriefSchema.parse({
        externalPersonId: subject.externalPersonId,
        entityKind: subject.entityKind,
        quotes: subject.quotes,
        version,
        builtAt: now.toISOString(),
        freshUntil: new Date(
          now.getTime() + BRIEF_FRESH_DAYS * 86_400_000,
        ).toISOString(),
        sources: sources.map((source) => ({
          id: source.id,
          description: source.description,
          evidenceClass: source.evidenceClass,
          url: source.url,
          domain: source.domain,
          title: source.title,
          publishedAt: source.publishedAt,
          retrievedAt: source.retrievedAt,
          provider: source.provider,
        })),
        assertions,
      });
      await dependencies.store.appendBrief(scope, brief);
      return { brief, reused: false };
    },
  };
}

/**
 * A prepared entity's brief, from its stored facts and sources. Facts the
 * seed marks as needing verification stay CONTRADICTORY_OR_STALE until a
 * fresh read; nothing is added that the seed does not hold.
 */
export function briefFromKnownEntity(
  record: KnownEntityRecord,
  now: Date,
): PersonBrief {
  const refs = new Map(
    record.sources.map((source, at) => [source.sourceId, at] as const),
  );
  const assertions: PersonBriefAssertion[] = record.facts.flatMap((fact) => {
    const sourceRefs = fact.sourceIds
      .map((id) => refs.get(id))
      .filter((at): at is number => at !== undefined)
      .slice(0, 6);
    if (sourceRefs.length === 0) return [];
    const needsCheck = /verify|recheck|time-sensitive/iu.test(
      fact.evidenceClass ?? "",
    );
    return [
      {
        topic: "BACKGROUND" as const,
        text: fact.claim.slice(0, 400),
        assertionClass: needsCheck
          ? ("CONTRADICTORY_OR_STALE" as const)
          : ("PUBLIC_STATEMENT" as const),
        sourceRefs,
        asOf: null,
      },
    ];
  });
  return PersonBriefSchema.parse({
    externalPersonId: record.externalPersonId,
    entityKind: record.entityKind,
    quotes: record.quotes,
    version: 1,
    builtAt: record.lastResearchedAt,
    freshUntil: new Date(
      Math.max(
        now.getTime(),
        Date.parse(record.lastResearchedAt) + BRIEF_FRESH_DAYS * 86_400_000,
      ),
    ).toISOString(),
    sources: record.sources.slice(0, 16).map((source) => ({
      id: source.sourceId,
      description: source.description,
      evidenceClass: source.evidenceClass,
      url: source.url,
      domain: publicDomainOf(source.url) ?? "",
      title: source.description,
      publishedAt: source.publishedAt,
      retrievedAt: record.lastResearchedAt,
      provider: "prepared",
    })),
    assertions: assertions.length === 0 ? [] : assertions,
  });
}
