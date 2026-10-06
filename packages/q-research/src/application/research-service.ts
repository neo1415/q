import type { CorrelationId } from "@capital-q/contracts";
import { getMeter, type Logger } from "@capital-q/observability";
import type { ActorContext } from "@capital-q/security";

import {
  RESEARCH_BOUNDS,
  type PublicWebFreshness,
  type PublicWebSearchHit,
} from "../contracts.js";
import {
  compareSourcesWithSubject,
  temporalClassOf,
  type ComparisonNote,
  type TemporalClass,
} from "../domain/comparison.js";
import { composeEgressQuery, searchPhrase } from "../domain/egress.js";
import {
  boundExcerpt,
  type InstructionRiskCategory,
} from "../domain/excerpt.js";
import { countryName, mentionedCountries } from "../domain/geography.js";
import {
  mergePlannedHits,
  matchOf,
  rankForReading,
  resolveEntity,
  textNames,
  type EntityResolution,
  type FoundHit,
  type NamedEntity,
  type SubjectMatch,
} from "../domain/ranking.js";
import {
  judgePublicUrl,
  normaliseWebAddress,
  publicDomainOf,
  webAddressesIn,
} from "../domain/url-safety.js";
import {
  isResearchProviderFailure,
  type PublicWebResearchProvider,
  type ResearchProviderFailure,
} from "../ports.js";

/**
 * The application capability Q's tools call (CQ-Q-RESEARCH-001 §8-§9,
 * §13-§17, §33-§36). One research turn: compose what may leave, search once
 * (a second time only when the first found nothing), read the top sources,
 * bound and scan the text, persist the sources through the Evidence owner
 * when the subject is one the actor's organisation owns, and attach the
 * deterministic comparison notes. Nothing here decides truth, writes
 * canonical state, or keeps a store of its own.
 */

/** The subject a research turn is about, as the tool layer resolved and authorised it. */
export type ResearchSubject =
  | {
      readonly kind: "COMPANY";
      readonly companyId: string;
      readonly name: string;
      readonly websiteUrl: string | null;
      readonly headquartersCountry: string | null;
      /** Whether policy authorised the name/website to leave Capital Q (§9). */
      readonly identityAuthorised: boolean;
      /** Set when the actor's organisation owns the company: sources are recorded as its evidence. */
      readonly persistAsEvidence: boolean;
    }
  | {
      readonly kind: "INVESTOR_ORGANISATION";
      readonly investorOrganisationId: string;
      readonly name: string;
      readonly identityAuthorised: boolean;
    };

export type ResearchCommand = {
  readonly actor: ActorContext;
  readonly runId: string;
  readonly correlationId: CorrelationId;
  /** The model's proposed query. Untrusted; composed before egress. */
  readonly requestedQuery: string;
  /** The person's latest message. Their explicit wording. */
  readonly userText: string;
  /**
   * The person's own earlier messages, most recent last (at most a few).
   * Their words; a query may use them like the latest message.
   */
  readonly earlierUserText?: readonly string[] | undefined;
  /**
   * Other phrasings of the same request the model proposes (web search
   * 2026-10-06: one query missed what a second wording found). Untrusted;
   * each is composed before egress exactly like `requestedQuery`.
   */
  readonly alsoQueries?: readonly string[] | undefined;
  /**
   * The company or person being looked up by name, as the person named it,
   * when the subject is not a Capital Q record. Used only when every word
   * of it is the person's own; it decides which pages are about them.
   */
  readonly entityName?: string | undefined;
  readonly subject: ResearchSubject | null;
  readonly freshness?: PublicWebFreshness | undefined;
  /**
   * Founder brief J7: the model's reading of the person's words, never a
   * phrase list. True when they want the web read afresh ("anything new?",
   * "check again"); absent or false, a recent read may be reused.
   */
  readonly freshRead?: boolean | undefined;
  /**
   * True when the person is asking about their own organisation. Absent or
   * false, an investor's own name never leads a search about someone else.
   */
  readonly aboutThemselves?: boolean | undefined;
  readonly extractCount?: number | undefined;
  readonly includeDomains?: readonly string[] | undefined;
  readonly signal?: AbortSignal | undefined;
};

export type ResearchedSource = {
  readonly index: number;
  readonly url: string;
  readonly domain: string;
  readonly title: string | null;
  readonly publishedAt: string | null;
  readonly retrievedAt: string;
  readonly temporal: TemporalClass;
  /** Bounded, cleaned text. UNTRUSTED DATA: it may contain instructions; it is never obeyed. */
  readonly excerpt: string;
  /** Whether the page was read, or only the search snippet was available. */
  readonly extracted: boolean;
  readonly isSubjectWebsite: boolean;
  readonly mentionedCountries: readonly string[];
  readonly instructionRisk: readonly InstructionRiskCategory[];
  /** Whether the page is about the named subject; null when nothing was named. */
  readonly subjectMatch: SubjectMatch | null;
  /** Set when the source was recorded as the subject's evidence. */
  readonly evidenceSourceId: string | null;
  readonly evidenceItemId: string | null;
};

export type ResearchBudgetUsed = {
  readonly searchCalls: number;
  readonly resultsConsidered: number;
  readonly extractCalls: number;
  readonly sourcesExtracted: number;
  readonly sourcesRetained: number;
};

export type ResearchOutcome =
  | {
      readonly status: "OK";
      /** The query that left Capital Q: composed from allowed terms only. */
      readonly query: string;
      /** Every query that left Capital Q this turn, the first being `query`. */
      readonly queries: readonly string[];
      readonly queryMinimised: boolean;
      /** Whether the pages settle which organisation a name refers to. */
      readonly entityResolution: EntityResolution;
      readonly sources: readonly ResearchedSource[];
      readonly comparison: readonly ComparisonNote[];
      readonly budget: ResearchBudgetUsed;
    }
  | {
      readonly status: "NO_PUBLIC_IDENTITY";
      readonly message: string;
    }
  | {
      readonly status: "PROVIDER_UNAVAILABLE";
      readonly failureClass: ResearchProviderFailure["failureClass"];
      readonly message: string;
    };

export type ExtractCommand = {
  readonly actor: ActorContext;
  readonly runId: string;
  readonly correlationId: CorrelationId;
  readonly urls: readonly string[];
  /**
   * The web addresses the person wrote in their own message this turn,
   * as written (lead 2026-10-04: "read zinoaviation.com" was refused as
   * not from a search). A URL they named may be read like one a search
   * surfaced (ADR 0048); every URL is still judged public first.
   */
  readonly personNamed?: readonly string[] | undefined;
  readonly signal?: AbortSignal | undefined;
};

export type ExtractOutcome =
  | {
      readonly status: "OK";
      readonly sources: readonly ResearchedSource[];
      readonly rejectedUrls: readonly {
        readonly url: string;
        readonly reason: string;
      }[];
    }
  | {
      readonly status: "PROVIDER_UNAVAILABLE";
      readonly failureClass: ResearchProviderFailure["failureClass"];
      readonly message: string;
    };

/**
 * The Evidence owner, as this capability needs it (§13-§15). Implemented in
 * the composition root over the Evidence service, whose use cases enforce
 * capability, subject ownership and the private-scope rule. Nothing here
 * writes a row.
 */
export type ResearchEvidenceRecorder = {
  readonly listSources: (
    actor: ActorContext,
    companyId: string,
  ) => Promise<
    readonly { readonly id: string; readonly sourceUrl: string | null }[]
  >;
  readonly registerSource: (
    actor: ActorContext,
    input: {
      readonly companyId: string;
      readonly provider: string;
      readonly title: string | null;
      readonly sourceUrl: string;
      readonly retrievedAt: string;
      readonly publishedAt: string | null;
      readonly metadata: Readonly<Record<string, string | number | boolean>>;
    },
    correlationId: CorrelationId,
  ) => Promise<{ readonly id: string }>;
  readonly listItems: (
    actor: ActorContext,
    sourceId: string,
  ) => Promise<
    readonly { readonly id: string; readonly structuredValue: unknown }[]
  >;
  readonly createItem: (
    actor: ActorContext,
    input: {
      readonly sourceId: string;
      readonly summary: string;
      readonly structuredValue: Readonly<
        Record<string, string | number | boolean>
      >;
    },
    correlationId: CorrelationId,
  ) => Promise<{ readonly id: string }>;
};

export type PublicWebResearchService = {
  readonly research: (command: ResearchCommand) => Promise<ResearchOutcome>;
  readonly extract: (command: ExtractCommand) => Promise<ExtractOutcome>;
  /** URLs a search in this run surfaced: the only ones extract may read. */
  readonly seenInRun: (runId: string) => readonly string[];
};

export type PublicWebResearchServiceDependencies = {
  readonly provider: PublicWebResearchProvider;
  readonly evidence?: ResearchEvidenceRecorder | undefined;
  readonly clock?: (() => Date) | undefined;
  readonly logger?: Logger | undefined;
};

const RUN_ALLOWLIST_TTL_MS = 6 * 60 * 60 * 1000;
const RUN_ALLOWLIST_MAX_RUNS = 500;
const MAX_PER_DOMAIN = 2;
const PROVIDER_UNAVAILABLE_MESSAGE =
  "Public sources couldn't be checked right now. Capital Q's own information is still available.";
const NO_IDENTITY_MESSAGE =
  "There was nothing in the person's words to search for yet. Ask them which name (a company or a person) to look up; a name is enough, no website is needed.";

/**
 * A company subject is what the conversation is about, so its name leads
 * the query when the person did not say it. An investor's own organisation
 * leads the query only when the person is asking about themselves;
 * otherwise their name would become the subject of a search about someone
 * else (CQ-Q-RESEARCH-001 §9).
 */
function prependIdentityFor(
  subject: ResearchSubject | null,
  aboutThemselves: boolean,
): boolean {
  if (subject === null) {
    return true;
  }
  return subject.kind === "COMPANY" ? true : aboutThemselves;
}

function identityTerms(subject: ResearchSubject | null): readonly string[] {
  if (subject === null || !subject.identityAuthorised) {
    return [];
  }
  const terms = [subject.name];
  if (subject.kind === "COMPANY") {
    const domain = publicDomainOf(subject.websiteUrl);
    if (domain !== null) {
      terms.push(domain);
    }
    // Name + country tells one organisation from another of the same name.
    const country = countryName(subject.headquartersCountry);
    if (country !== null) {
      terms.push(country);
    }
  }
  return terms;
}

/**
 * The organisation (or person) the pages should be about: the authorised
 * subject, else the name the person gave — only when every word of it is
 * theirs, so a model cannot name somebody to look up.
 */
function namedEntityOf(command: ResearchCommand): NamedEntity | null {
  const subject = command.subject;
  // The subject leads only where its name may lead the query: an
  // investor's own organisation is never the subject of a search about
  // somebody else (§9).
  const fromSubject: NamedEntity | null =
    subject !== null &&
    subject.identityAuthorised &&
    prependIdentityFor(subject, command.aboutThemselves === true)
      ? subject.kind === "COMPANY"
        ? {
            name: subject.name,
            domain: publicDomainOf(subject.websiteUrl),
            country: subject.headquartersCountry,
          }
        : { name: subject.name, domain: null, country: null }
      : null;
  const named = command.entityName?.trim() ?? "";
  if (named.length < 2) return fromSubject;
  if (
    fromSubject !== null &&
    named.toLowerCase() === fromSubject.name.toLowerCase()
  ) {
    return fromSubject;
  }
  const composed = composeEgressQuery({
    requestedQuery: named,
    userText: command.userText,
    earlierUserText: command.earlierUserText,
    publicIdentity: [],
  });
  return composed.ok && composed.droppedTokens === 0
    ? { name: composed.query, domain: null, country: null }
    : fromSubject;
}

export function createPublicWebResearchService(
  dependencies: PublicWebResearchServiceDependencies,
): PublicWebResearchService {
  const { provider, evidence, logger } = dependencies;
  const clock = dependencies.clock ?? (() => new Date());
  const meter = getMeter("@capital-q/q-research");
  const metrics = {
    requested: meter.createCounter("q.research.requested"),
    reused: meter.createCounter("q.research.reused"),
    providerFailures: meter.createCounter("q.research.provider_failures"),
    sourcesRetained: meter.createCounter("q.research.sources_retained"),
    comparisons: meter.createCounter("q.research.comparison_notes"),
    searchLatency: meter.createHistogram("q.research.search_latency_ms"),
    extractLatency: meter.createHistogram("q.research.extract_latency_ms"),
  };
  const allowlist = new Map<string, { urls: Set<string>; expiresAt: number }>();

  const remember = (runId: string, urls: readonly string[]) => {
    const now = clock().getTime();
    for (const [key, entry] of allowlist) {
      if (entry.expiresAt <= now) {
        allowlist.delete(key);
      }
    }
    if (!allowlist.has(runId) && allowlist.size >= RUN_ALLOWLIST_MAX_RUNS) {
      const oldest = allowlist.keys().next().value;
      if (oldest !== undefined) {
        allowlist.delete(oldest);
      }
    }
    const entry = allowlist.get(runId) ?? {
      urls: new Set<string>(),
      expiresAt: now + RUN_ALLOWLIST_TTL_MS,
    };
    for (const url of urls) {
      entry.urls.add(url);
    }
    entry.expiresAt = now + RUN_ALLOWLIST_TTL_MS;
    allowlist.set(runId, entry);
  };

  const providerUnavailable = (
    failure: ResearchProviderFailure,
    operation: "search" | "extract",
  ) => {
    metrics.providerFailures.add(1, {
      provider: failure.providerCode,
      operation,
      failure_class: failure.failureClass,
    });
    logger?.warn(
      {
        provider: failure.providerCode,
        operation,
        failureClass: failure.failureClass,
        status: failure.status,
      },
      "public research provider failed",
    );
  };

  const persist = async (
    command: ResearchCommand,
    subject: Extract<ResearchSubject, { kind: "COMPANY" }>,
    source: Omit<ResearchedSource, "evidenceSourceId" | "evidenceItemId">,
    sha256: string,
  ): Promise<{ sourceId: string | null; itemId: string | null }> => {
    if (evidence === undefined) {
      return { sourceId: null, itemId: null };
    }
    try {
      const existing = await evidence.listSources(
        command.actor,
        subject.companyId,
      );
      const match = existing.find((entry) => entry.sourceUrl === source.url);
      const sourceId =
        match?.id ??
        (
          await evidence.registerSource(
            command.actor,
            {
              companyId: subject.companyId,
              provider: provider.code,
              title: source.title,
              sourceUrl: source.url,
              retrievedAt: source.retrievedAt,
              publishedAt: source.publishedAt,
              metadata: {
                domain: source.domain,
                researchRunId: command.runId,
                ...(source.isSubjectWebsite ? { subjectWebsite: true } : {}),
              },
            },
            command.correlationId,
          )
        ).id;
      const items = await evidence.listItems(command.actor, sourceId);
      const duplicate = items.find((item) => {
        const value = item.structuredValue;
        return (
          typeof value === "object" &&
          value !== null &&
          (value as Record<string, unknown>)["sha256"] === sha256
        );
      });
      if (duplicate !== undefined) {
        return { sourceId, itemId: duplicate.id };
      }
      const item = await evidence.createItem(
        command.actor,
        {
          sourceId,
          summary: source.excerpt,
          structuredValue: {
            kind: "public_web_excerpt",
            sha256,
            retrievedAt: source.retrievedAt,
            extracted: source.extracted,
            instructionRiskSignals: source.instructionRisk.length,
          },
        },
        command.correlationId,
      );
      return { sourceId, itemId: item.id };
    } catch (error: unknown) {
      // Persistence is an addition to the answer, not a condition of it.
      logger?.warn(
        {
          runId: command.runId,
          reason: error instanceof Error ? error.name : "unknown",
        },
        "public web source was not recorded as evidence",
      );
      return { sourceId: null, itemId: null };
    }
  };

  const toSource = (
    index: number,
    hit: {
      url: string;
      title: string | null;
      publishedAt: string | null;
      snippet?: string;
    },
    page: { title: string | null; text: string } | undefined,
    subject: ResearchSubject | null,
    now: Date,
    entity: NamedEntity | null = null,
  ): {
    source: Omit<ResearchedSource, "evidenceSourceId" | "evidenceItemId">;
    sha256: string;
  } => {
    const bounded = boundExcerpt(page?.text ?? hit.snippet ?? "");
    const domain = publicDomainOf(hit.url) ?? "";
    const ownDomain =
      subject?.kind === "COMPANY" ? publicDomainOf(subject.websiteUrl) : null;
    const countries = mentionedCountries(bounded.text);
    const title = page?.title ?? hit.title;
    return {
      sha256: bounded.sha256,
      source: {
        index,
        url: hit.url,
        domain,
        title,
        publishedAt: hit.publishedAt,
        retrievedAt: now.toISOString(),
        temporal: temporalClassOf(hit.publishedAt, now),
        excerpt: bounded.text,
        extracted: page !== undefined,
        isSubjectWebsite: ownDomain !== null && ownDomain === domain,
        mentionedCountries: countries,
        instructionRisk: bounded.instructionRisk,
        subjectMatch:
          entity === null
            ? null
            : matchOf(
                { url: hit.url, domain, title, text: bounded.text, countries },
                entity,
              ),
      },
    };
  };

  /** Successful research outcomes by tenant, run and composed query. Bounded like the allowlist. */
  const completed = new Map<
    string,
    Extract<ResearchOutcome, { status: "OK" }>
  >();
  const rememberCompleted = (
    key: string,
    outcome: Extract<ResearchOutcome, { status: "OK" }>,
  ): void => {
    if (completed.size >= RUN_ALLOWLIST_MAX_RUNS) {
      const oldest = completed.keys().next().value;
      if (oldest !== undefined) {
        completed.delete(oldest);
      }
    }
    completed.set(key, outcome);
  };

  return {
    seenInRun: (runId) => [...(allowlist.get(runId)?.urls ?? [])],

    research: async (command) => {
      metrics.requested.add(1, { operation: "research" });
      const identity = identityTerms(command.subject);
      const entity = namedEntityOf(command);
      // Someone else named by the person: the conversation's own subject
      // is not put in front of a search about them.
      const aboutSomeoneElse =
        entity !== null &&
        (command.subject === null ||
          entity.name.toLowerCase() !== command.subject.name.toLowerCase());
      const leadWithSubject =
        !aboutSomeoneElse &&
        prependIdentityFor(command.subject, command.aboutThemselves === true);
      const compose = (requestedQuery: string, prepend = leadWithSubject) =>
        composeEgressQuery({
          requestedQuery,
          userText: command.userText,
          earlierUserText: command.earlierUserText,
          publicIdentity: identity,
          prependIdentity: prepend,
        });
      const egress = compose(command.requestedQuery);
      // Plan 2-4 differently-worded queries (web search 2026-10-06: one
      // query, the person's whole sentence, found "general background on
      // YC" and nothing that answered). Every one is composed through the
      // same egress policy: the model's phrasings, the person's own
      // sentence without the asking, and the subject's name with its
      // country. Nothing here can add a word the policy would not.
      const planned: string[] = [];
      let dropped = 0;
      let fellBack = false;
      const plan = (candidate: string, prepend = leadWithSubject) => {
        if (planned.length >= RESEARCH_BOUNDS.maxPlannedQueries) return;
        if (candidate.trim().length === 0) return;
        const composed = compose(candidate, prepend);
        if (!composed.ok) return;
        if (
          planned.some(
            (existing) =>
              existing.toLowerCase() === composed.query.toLowerCase(),
          )
        ) {
          return;
        }
        dropped += composed.droppedTokens;
        fellBack ||= composed.fellBackToIdentity;
        planned.push(composed.query);
      };
      plan(command.requestedQuery);
      // The same words without the subject in front, when it was put
      // there: the question may be about the world, not about them.
      plan(command.requestedQuery, false);
      for (const also of command.alsoQueries ?? []) plan(also);
      // Their sentence as they put it, with nothing put in front: a market
      // question is not a question about their own company.
      plan(searchPhrase(command.userText), false);
      // The name with its country, when a name is what is being looked up.
      if (
        entity !== null &&
        (aboutSomeoneElse ||
          command.aboutThemselves === true ||
          textNames(command.requestedQuery, entity.name))
      ) {
        const country = identity.includes(countryName(entity.country) ?? "")
          ? countryName(entity.country)
          : null;
        plan([entity.name, country ?? ""].join(" "));
      }
      const primary = planned[0];
      if (primary === undefined) {
        return { status: "NO_PUBLIC_IDENTITY", message: NO_IDENTITY_MESSAGE };
      }
      // One successful bounded research per run and query (CQ-Q-VOICE-001
      // R4): a model round, the deterministic seam call and an answer retry
      // that ask the same question in the same run get the same result
      // back, with no second provider call and no second evidence write.
      const reuseKey = `${command.actor.tenantId}:${command.runId}:${primary}`;
      const reused = completed.get(reuseKey);
      if (reused !== undefined) {
        metrics.reused.add(1, { operation: "research" });
        logger?.debug(
          { runId: command.runId, sources: reused.sources.length },
          "public research reused within the run",
        );
        return reused;
      }
      const extractCount = Math.min(
        Math.max(
          1,
          command.extractCount ?? RESEARCH_BOUNDS.defaultExtractCount,
        ),
        RESEARCH_BOUNDS.maxExtractCount,
      );
      const includeDomains = (command.includeDomains ?? [])
        .map((domain) =>
          domain
            .trim()
            .toLowerCase()
            .replace(/^www\./, ""),
        )
        .filter((domain) => domain.length > 0 && domain.includes("."))
        .slice(0, RESEARCH_BOUNDS.maxIncludeDomains);
      const context = {
        signal: command.signal,
        freshRead: command.freshRead === true,
      };

      const freshness = command.freshness ?? "ANY";
      // The planned queries side by side, and the first one again over the
      // past month (founder direction 2026-09-29: recent coverage is what a
      // general ranking buries). A query that fails costs only its own
      // hits; the turn fails only when every one did.
      const requests = [
        ...planned.map((query) => ({
          query,
          maxResults: RESEARCH_BOUNDS.maxSearchResults,
          freshness,
          includeDomains,
        })),
        ...(freshness === "ANY"
          ? [
              {
                query: primary,
                maxResults: RESEARCH_BOUNDS.maxRecentResults,
                freshness: "PAST_MONTH" as const,
                includeDomains,
              },
            ]
          : []),
      ].slice(0, RESEARCH_BOUNDS.maxSearchCalls - 1);
      let searchCalls = requests.length;
      const settled = await Promise.allSettled(
        requests.map((request) => provider.search(request, context)),
      );
      const lists: (readonly PublicWebSearchHit[])[] = [];
      let failure: ResearchProviderFailure | null = null;
      for (const outcome of settled) {
        if (outcome.status === "fulfilled") {
          metrics.searchLatency.record(outcome.value.latencyMs, {
            provider: provider.code,
          });
          lists.push(outcome.value.hits);
        } else if (isResearchProviderFailure(outcome.reason)) {
          failure = outcome.reason;
        } else {
          throw outcome.reason;
        }
      }
      if (lists.length === 0 && failure !== null) {
        providerUnavailable(failure, "search");
        return {
          status: "PROVIDER_UNAVAILABLE",
          failureClass: failure.failureClass,
          message: PROVIDER_UNAVAILABLE_MESSAGE,
        };
      }
      let hits: readonly FoundHit[] = mergePlannedHits(lists);
      // One refinement, only when every planned query found nothing and the
      // subject's public identity alone is a different, allowed query.
      const identityQuery = identity.join(" ").trim();
      if (
        hits.length === 0 &&
        identityQuery.length > 0 &&
        !planned.includes(identityQuery) &&
        searchCalls < RESEARCH_BOUNDS.maxSearchCalls
      ) {
        searchCalls += 1;
        try {
          const second = await provider.search(
            {
              query: identityQuery,
              maxResults: RESEARCH_BOUNDS.maxSearchResults,
              freshness,
              includeDomains,
            },
            context,
          );
          metrics.searchLatency.record(second.latencyMs, {
            provider: provider.code,
          });
          hits = mergePlannedHits([second.hits]);
        } catch (error: unknown) {
          if (!isResearchProviderFailure(error)) throw error;
          providerUnavailable(error, "search");
        }
      }

      const safeHits = hits.filter((hit) => judgePublicUrl(hit.url).ok);
      remember(
        command.runId,
        safeHits.map((hit) => hit.url),
      );
      const chosen = rankForReading(
        safeHits,
        extractCount,
        clock(),
        MAX_PER_DOMAIN,
      );
      let pages = new Map<string, { title: string | null; text: string }>();
      let extractCalls = 0;
      if (chosen.length > 0) {
        try {
          extractCalls += 1;
          const extracted = await provider.extract(
            { urls: chosen.map((hit) => hit.url) },
            context,
          );
          metrics.extractLatency.record(extracted.latencyMs, {
            provider: provider.code,
          });
          pages = new Map(
            extracted.pages.map((page) => [
              page.url,
              { title: page.title, text: page.text },
            ]),
          );
        } catch (error: unknown) {
          if (!isResearchProviderFailure(error)) {
            throw error;
          }
          // Search snippets still stand; the answer says pages were not read.
          providerUnavailable(error, "extract");
        }
      }

      const now = clock();
      const sources: ResearchedSource[] = [];
      for (const [position, hit] of chosen.entries()) {
        const built = toSource(
          position + 1,
          hit,
          pages.get(hit.url),
          command.subject,
          now,
          entity,
        );
        const persisted =
          command.subject?.kind === "COMPANY" &&
          command.subject.persistAsEvidence
            ? await persist(
                command,
                command.subject,
                built.source,
                built.sha256,
              )
            : { sourceId: null, itemId: null };
        sources.push({
          ...built.source,
          evidenceSourceId: persisted.sourceId,
          evidenceItemId: persisted.itemId,
        });
      }
      const entityResolution = resolveEntity(
        sources.map((source) => ({
          url: source.url,
          domain: source.domain,
          title: source.title,
          text: source.excerpt,
          countries: source.mentionedCountries,
        })),
        entity,
      );
      const comparison = compareSourcesWithSubject(
        command.subject?.kind === "COMPANY"
          ? {
              name: command.subject.name,
              websiteUrl: command.subject.websiteUrl,
              headquartersCountry: command.subject.headquartersCountry,
            }
          : command.subject === null
            ? null
            : {
                name: command.subject.name,
                websiteUrl: null,
                headquartersCountry: null,
              },
        // Only pages about this subject are compared with its record: a
        // namesake's country is not a contradiction.
        sources
          .filter(
            (source) =>
              source.subjectMatch !== "NONE" &&
              source.subjectMatch !== "POSSIBLE",
          )
          .map((source) => ({
            index: source.index,
            url: source.url,
            text: source.excerpt,
            publishedAt: source.publishedAt,
          })),
        now,
      );
      metrics.sourcesRetained.add(sources.length, { provider: provider.code });
      metrics.comparisons.add(comparison.length, { provider: provider.code });
      const queryMinimised =
        dropped > 0 || fellBack || (egress.ok && egress.droppedTokens > 0);
      logger?.info(
        {
          runId: command.runId,
          provider: provider.code,
          plannedQueries: planned.length,
          searchCalls,
          resultsConsidered: safeHits.length,
          extractCalls,
          sourcesExtracted: sources.filter((s) => s.extracted).length,
          sourcesRetained: sources.length,
          persisted: sources.filter((s) => s.evidenceSourceId !== null).length,
          comparisonNotes: comparison.length,
          entityResolution: entityResolution.status,
          queryMinimised,
          instructionRiskSources: sources.filter(
            (s) => s.instructionRisk.length > 0,
          ).length,
        },
        "public research completed",
      );
      const outcome: Extract<ResearchOutcome, { status: "OK" }> = {
        status: "OK",
        query: primary,
        queries: planned,
        queryMinimised,
        entityResolution,
        sources,
        comparison,
        budget: {
          searchCalls,
          resultsConsidered: safeHits.length,
          extractCalls,
          sourcesExtracted: sources.filter((s) => s.extracted).length,
          sourcesRetained: sources.length,
        },
      };
      rememberCompleted(reuseKey, outcome);
      return outcome;
    },

    extract: async (command) => {
      metrics.requested.add(1, { operation: "extract" });
      const seen = new Set(allowlist.get(command.runId)?.urls ?? []);
      // What the person named, normalised: https, with http as the one
      // fallback for a site that only serves plain http.
      const named = new Map<string, string>();
      for (const written of webAddressesIn(
        (command.personNamed ?? []).join(" "),
        RESEARCH_BOUNDS.maxExtractCount,
      )) {
        named.set(written.url, written.fallback);
      }
      const accepted: string[] = [];
      const rejectedUrls: { url: string; reason: string }[] = [];
      for (const candidate of command.urls.slice(
        0,
        RESEARCH_BOUNDS.maxExtractCount,
      )) {
        // "zinoaviation.com" from the model is the same address as
        // "https://zinoaviation.com/"; a non-web scheme stays refused.
        const written = /^[a-z][a-z0-9+.-]*:/iu.test(candidate.trim())
          ? null
          : normaliseWebAddress(candidate);
        const verdict =
          written === null
            ? judgePublicUrl(candidate)
            : judgePublicUrl(written.url);
        if (!verdict.ok) {
          rejectedUrls.push({
            url: candidate.slice(0, 200),
            reason: verdict.reason,
          });
          continue;
        }
        if (!seen.has(verdict.url) && !named.has(verdict.url)) {
          rejectedUrls.push({
            url: verdict.url,
            reason: "NOT_FROM_THIS_CONVERSATIONS_SEARCH",
          });
          continue;
        }
        if (!accepted.includes(verdict.url)) {
          accepted.push(verdict.url);
        }
      }
      if (accepted.length === 0) {
        return { status: "OK", sources: [], rejectedUrls };
      }
      let extracted;
      try {
        extracted = await provider.extract(
          { urls: accepted },
          { signal: command.signal },
        );
      } catch (error: unknown) {
        if (isResearchProviderFailure(error)) {
          providerUnavailable(error, "extract");
          return {
            status: "PROVIDER_UNAVAILABLE",
            failureClass: error.failureClass,
            message: PROVIDER_UNAVAILABLE_MESSAGE,
          };
        }
        throw error;
      }
      // A site the person named that https could not read: once over
      // plain http (its own, already-judged fallback form).
      const retry = extracted.failedUrls.flatMap((url) => {
        const fallback = named.get(url);
        return fallback === undefined ? [] : [fallback];
      });
      if (retry.length > 0) {
        try {
          const again = await provider.extract(
            { urls: retry },
            { signal: command.signal },
          );
          const recovered = new Set(
            retry
              .filter((url) => !again.failedUrls.includes(url))
              .map((url) => url.replace(/^http:/u, "https:")),
          );
          extracted = {
            ...extracted,
            pages: [...extracted.pages, ...again.pages],
            failedUrls: [
              ...extracted.failedUrls.filter((url) => !recovered.has(url)),
              ...again.failedUrls,
            ],
          };
        } catch (error: unknown) {
          if (!isResearchProviderFailure(error)) throw error;
        }
      }
      metrics.extractLatency.record(extracted.latencyMs, {
        provider: provider.code,
      });
      const now = clock();
      const sources = extracted.pages.map((page, position) => ({
        ...toSource(
          position + 1,
          { url: page.url, title: page.title, publishedAt: null },
          { title: page.title, text: page.text },
          null,
          now,
        ).source,
        evidenceSourceId: null,
        evidenceItemId: null,
      }));
      for (const url of extracted.failedUrls) {
        rejectedUrls.push({ url, reason: "COULD_NOT_READ" });
      }
      return { status: "OK", sources, rejectedUrls };
    },
  };
}
