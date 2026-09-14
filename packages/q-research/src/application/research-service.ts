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
import { composeEgressQuery } from "../domain/egress.js";
import {
  boundExcerpt,
  type InstructionRiskCategory,
} from "../domain/excerpt.js";
import { mentionedCountries } from "../domain/geography.js";
import { judgePublicUrl, publicDomainOf } from "../domain/url-safety.js";
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
  readonly subject: ResearchSubject | null;
  readonly freshness?: PublicWebFreshness | undefined;
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
      readonly queryMinimised: boolean;
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
  "Nothing about this subject is authorised for public research yet: the company is private to its organisation and has no declared website. Ask the person which public name or website to search for.";

/** "us", "our", "we", "my": the person is asking about their own organisation. */
const SELF_REFERENCE = /\b(?:we|us|our|ours|ourselves|my|me|mine)\b/i;

/**
 * A company subject is what the conversation is about, so its name leads
 * the query when the person did not say it. An investor's own organisation
 * leads the query only when the person is asking about themselves;
 * otherwise their name would become the subject of a search about someone
 * else (CQ-Q-RESEARCH-001 §9).
 */
function prependIdentityFor(
  subject: ResearchSubject | null,
  userText: string,
): boolean {
  if (subject === null) {
    return true;
  }
  return subject.kind === "COMPANY" ? true : SELF_REFERENCE.test(userText);
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
  }
  return terms;
}

function selectForExtraction(
  hits: readonly PublicWebSearchHit[],
  count: number,
): readonly PublicWebSearchHit[] {
  const perDomain = new Map<string, number>();
  const chosen: PublicWebSearchHit[] = [];
  const ordered = [...hits].sort(
    (a, b) => (b.relevance ?? 0) - (a.relevance ?? 0),
  );
  for (const hit of ordered) {
    const domain = publicDomainOf(hit.url) ?? hit.url;
    const used = perDomain.get(domain) ?? 0;
    if (used >= MAX_PER_DOMAIN || chosen.some((c) => c.url === hit.url)) {
      continue;
    }
    perDomain.set(domain, used + 1);
    chosen.push(hit);
    if (chosen.length >= count) {
      break;
    }
  }
  return chosen;
}

export function createPublicWebResearchService(
  dependencies: PublicWebResearchServiceDependencies,
): PublicWebResearchService {
  const { provider, evidence, logger } = dependencies;
  const clock = dependencies.clock ?? (() => new Date());
  const meter = getMeter("@capital-q/q-research");
  const metrics = {
    requested: meter.createCounter("q.research.requested"),
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
  ): {
    source: Omit<ResearchedSource, "evidenceSourceId" | "evidenceItemId">;
    sha256: string;
  } => {
    const bounded = boundExcerpt(page?.text ?? hit.snippet ?? "");
    const domain = publicDomainOf(hit.url) ?? "";
    const ownDomain =
      subject?.kind === "COMPANY" ? publicDomainOf(subject.websiteUrl) : null;
    return {
      sha256: bounded.sha256,
      source: {
        index,
        url: hit.url,
        domain,
        title: page?.title ?? hit.title,
        publishedAt: hit.publishedAt,
        retrievedAt: now.toISOString(),
        temporal: temporalClassOf(hit.publishedAt, now),
        excerpt: bounded.text,
        extracted: page !== undefined,
        isSubjectWebsite: ownDomain !== null && ownDomain === domain,
        mentionedCountries: mentionedCountries(bounded.text),
        instructionRisk: bounded.instructionRisk,
      },
    };
  };

  return {
    seenInRun: (runId) => [...(allowlist.get(runId)?.urls ?? [])],

    research: async (command) => {
      metrics.requested.add(1, { operation: "research" });
      const identity = identityTerms(command.subject);
      const egress = composeEgressQuery({
        requestedQuery: command.requestedQuery,
        userText: command.userText,
        publicIdentity: identity,
        prependIdentity: prependIdentityFor(command.subject, command.userText),
      });
      if (!egress.ok) {
        return { status: "NO_PUBLIC_IDENTITY", message: NO_IDENTITY_MESSAGE };
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
      const context = { signal: command.signal };

      let searchCalls = 0;
      let hits: readonly PublicWebSearchHit[];
      try {
        searchCalls += 1;
        const first = await provider.search(
          {
            query: egress.query,
            maxResults: RESEARCH_BOUNDS.maxSearchResults,
            freshness: command.freshness ?? "ANY",
            includeDomains,
          },
          context,
        );
        metrics.searchLatency.record(first.latencyMs, {
          provider: provider.code,
        });
        hits = first.hits;
        // One refinement, only when the composed query found nothing and the
        // subject's public identity alone is a different, allowed query.
        const identityQuery = identity.join(" ").trim();
        if (
          hits.length === 0 &&
          identityQuery.length > 0 &&
          identityQuery !== egress.query &&
          searchCalls < RESEARCH_BOUNDS.maxSearchCalls
        ) {
          searchCalls += 1;
          const second = await provider.search(
            {
              query: identityQuery,
              maxResults: RESEARCH_BOUNDS.maxSearchResults,
              freshness: command.freshness ?? "ANY",
              includeDomains,
            },
            context,
          );
          metrics.searchLatency.record(second.latencyMs, {
            provider: provider.code,
          });
          hits = second.hits;
        }
      } catch (error: unknown) {
        if (isResearchProviderFailure(error)) {
          providerUnavailable(error, "search");
          return {
            status: "PROVIDER_UNAVAILABLE",
            failureClass: error.failureClass,
            message: PROVIDER_UNAVAILABLE_MESSAGE,
          };
        }
        throw error;
      }

      const safeHits = hits.filter((hit) => judgePublicUrl(hit.url).ok);
      remember(
        command.runId,
        safeHits.map((hit) => hit.url),
      );
      const chosen = selectForExtraction(safeHits, extractCount);
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
        sources.map((source) => ({
          index: source.index,
          url: source.url,
          text: source.excerpt,
          publishedAt: source.publishedAt,
        })),
        now,
      );
      metrics.sourcesRetained.add(sources.length, { provider: provider.code });
      metrics.comparisons.add(comparison.length, { provider: provider.code });
      logger?.info(
        {
          runId: command.runId,
          provider: provider.code,
          searchCalls,
          resultsConsidered: safeHits.length,
          extractCalls,
          sourcesExtracted: sources.filter((s) => s.extracted).length,
          sourcesRetained: sources.length,
          persisted: sources.filter((s) => s.evidenceSourceId !== null).length,
          comparisonNotes: comparison.length,
          queryMinimised: egress.droppedTokens > 0 || egress.fellBackToIdentity,
          instructionRiskSources: sources.filter(
            (s) => s.instructionRisk.length > 0,
          ).length,
        },
        "public research completed",
      );
      return {
        status: "OK",
        query: egress.query,
        queryMinimised: egress.droppedTokens > 0 || egress.fellBackToIdentity,
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
    },

    extract: async (command) => {
      metrics.requested.add(1, { operation: "extract" });
      const seen = new Set(allowlist.get(command.runId)?.urls ?? []);
      const accepted: string[] = [];
      const rejectedUrls: { url: string; reason: string }[] = [];
      for (const candidate of command.urls.slice(
        0,
        RESEARCH_BOUNDS.maxExtractCount,
      )) {
        const verdict = judgePublicUrl(candidate);
        if (!verdict.ok) {
          rejectedUrls.push({
            url: candidate.slice(0, 200),
            reason: verdict.reason,
          });
          continue;
        }
        if (!seen.has(verdict.url)) {
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
