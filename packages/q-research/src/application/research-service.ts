import type { CorrelationId } from "@capital-q/contracts";
import { getMeter, type Logger } from "@capital-q/observability";
import type { ActorContext } from "@capital-q/security";

import { isResting } from "../providers/breaker.js";
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
import {
  composeEgressQuery,
  namesShown,
  searchPhrase,
} from "../domain/egress.js";
import {
  boundExcerpt,
  type InstructionRiskCategory,
} from "../domain/excerpt.js";
import { countryName, mentionedCountries } from "../domain/geography.js";
import { textNamesEntity } from "../domain/names.js";
import {
  rejectOnAbort,
  SYSTEM_RESEARCH_TIME,
  type ResearchTime,
} from "../time.js";
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
  ResearchProviderFailure,
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
   * What Q said to the person earlier in this conversation (a few messages,
   * most recent last). Only a name in it of whom the turn is about may leave
   * (`namesShown`), when they point back at it; never Q's other words.
   */
  readonly shownText?: readonly string[] | undefined;
  /**
   * Other phrasings of the same request the model proposes (web search
   * 2026-10-06: one query missed what a second wording found). Untrusted;
   * each is composed before egress exactly like `requestedQuery`.
   */
  readonly alsoQueries?: readonly string[] | undefined;
  /**
   * The company or person being looked up by name, as the person named it,
   * when the subject is not a Capital Q record. Used only when every word
   * of it is the person's own, or it is a name Q showed them in this
   * conversation (`shownText`); it decides which pages are about them.
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
  /**
   * Deep research (owner 2026-10-23): one focused question of a planned
   * set. Only `requestedQuery` and `alsoQueries` are searched -- not the
   * person's whole sentence, the subject's name or the month's news again
   * for every question of the set.
   */
  readonly focused?: boolean | undefined;
  /**
   * One of a planned job's own questions (deep research): bounded by its
   * plan and its job's search budget (`maxSearches`), so not by the per-run
   * budget that holds a turn to what it needs. Its page reads get the
   * longer background budget (`plannedExtractBudgetMs`): nobody is waiting
   * on a turn.
   */
  readonly planned?: boolean | undefined;
  /**
   * The most searches this call may send to the providers, its refinement
   * included (diligence audit 2026-10-28: a planned job's questions went
   * unbounded, up to ~32 searches a step). The caller's job budget grants
   * it, at least one (a caller with none left does not call). Absent: the
   * service's own bounds.
   */
  readonly maxSearches?: number | undefined;
  /** Deep research: words from public pages this run already read (egress.ts). */
  readonly publicTerms?: readonly string[] | undefined;
  /** Deep research: research vocabulary may travel (egress.ts). */
  readonly researchVocabulary?: boolean | undefined;
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
  /**
   * The clock and deadlines the page reads are bounded by (time.ts); the
   * system's by default. When given without `clock`, it is the clock too.
   */
  readonly time?: ResearchTime | undefined;
  readonly logger?: Logger | undefined;
  /** How long the page reads may hold the answer (EXTRACT_BUDGET_MS). */
  readonly extractBudgetMs?: number | undefined;
  /** A planned (background) call's page reads (PLANNED_EXTRACT_BUDGET_MS). */
  readonly plannedExtractBudgetMs?: number | undefined;
};

/**
 * A planned job's page reads (diligence audit 2026-10-28): 3 s is a turn's
 * budget, and a background job's pages were cut off at it, so its facts
 * came from search snippets. Nobody waits on a job's turn.
 */
export const PLANNED_EXTRACT_BUDGET_MS = 8_000;

/**
 * How long the page reads may hold the answer once the searches have
 * landed (production 2026-10-25, run 37b56282: "Who is the founder of
 * Paystack?" waited 8 s for an extract after the snippets already held the
 * answer -- 16.5 s in all). Past it, the answer goes on the search
 * snippets, as when a read fails, and says pages were not read.
 */
export const EXTRACT_BUDGET_MS = 3_000;

const RUN_ALLOWLIST_TTL_MS = 6 * 60 * 60 * 1000;
const RUN_ALLOWLIST_MAX_RUNS = 500;
const MAX_PER_DOMAIN = 2;
/** Research calls one run may send to the providers (see `budgeted`). */
export const RESEARCH_RUN_BUDGET = 1;

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

/** Whether a hit is about the named entity (domain/names.ts). */
function namesEntity(
  name: string,
): (hit: {
  readonly url: string;
  readonly title: string | null;
  readonly snippet: string;
}) => boolean {
  return (hit) =>
    textNamesEntity(
      name,
      `${hit.title ?? ""} ${hit.snippet} ${hit.url.replace(/[/._-]+/gu, " ")}`,
      publicDomainOf(hit.url),
    );
}

/** LinkedIn's public people and company pages, searched by site. */
const LINKEDIN_LANE = ["linkedin.com/in", "linkedin.com/company"] as const;

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
    shownNames: namesShown([named], command.shownText),
  });
  return composed.ok && composed.droppedTokens === 0
    ? { name: composed.query, domain: null, country: null }
    : fromSubject;
}

export function createPublicWebResearchService(
  dependencies: PublicWebResearchServiceDependencies,
): PublicWebResearchService {
  const { provider, evidence, logger } = dependencies;
  const turnExtractBudgetMs = dependencies.extractBudgetMs ?? EXTRACT_BUDGET_MS;
  const plannedExtractBudgetMs =
    dependencies.plannedExtractBudgetMs ?? PLANNED_EXTRACT_BUDGET_MS;
  const time = dependencies.time ?? SYSTEM_RESEARCH_TIME;
  const clock =
    dependencies.clock ??
    (dependencies.time === undefined
      ? () => new Date()
      : () => new Date(time.now()));
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
    // Every index resting behind its breaker (2026-10-25): nothing was
    // called, so nothing failed -- said as a skip, not as a provider
    // failure (live: it read as ScrapingBee called past its breaker).
    if (isResting(failure)) {
      metrics.providerFailures.add(1, {
        provider: failure.providerCode,
        operation,
        failure_class: "RESTING",
      });
      logger?.info(
        {
          provider: failure.providerCode,
          operation,
          failureClass: failure.failureClass,
          status: failure.status,
          resting: true,
        },
        "public research skipped: every provider is resting",
      );
      return;
    }
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

  /**
   * Production 2026-10-25: the turn's early search and the model's own
   * research each searched again, with every index each time. A run makes
   * at most RESEARCH_RUN_BUDGET research calls that reach the providers;
   * beyond them, the run's last outcome answers (an identical query is
   * already reused above). By tenant and run, bounded like the allowlist.
   */
  const byRun = new Map<
    string,
    { calls: number; last: ResearchOutcome | null }
  >();
  const budgeted = async (
    command: Parameters<PublicWebResearchService["research"]>[0],
    run: (
      command: Parameters<PublicWebResearchService["research"]>[0],
    ) => Promise<ResearchOutcome>,
  ): Promise<ResearchOutcome> => {
    const key = `${command.actor.tenantId}:${command.runId}`;
    const spent = byRun.get(key) ?? { calls: 0, last: null };
    if (command.planned === true) return run(command);
    if (spent.calls >= RESEARCH_RUN_BUDGET && spent.last !== null) {
      metrics.reused.add(1, { operation: "research_run_budget" });
      logger?.info(
        { runId: command.runId, calls: spent.calls },
        "public research run budget spent; the run's last result answers",
      );
      return spent.last;
    }
    if (!byRun.has(key) && byRun.size >= RUN_ALLOWLIST_MAX_RUNS) {
      const oldest = byRun.keys().next().value;
      if (oldest !== undefined) byRun.delete(oldest);
    }
    spent.calls += 1;
    byRun.set(key, spent);
    const outcome = await run(command);
    spent.last = outcome;
    return outcome;
  };

  const service: PublicWebResearchService = {
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
      // The one they pointed at ("the top one"), when Q showed its name.
      const shownNames = namesShown([entity?.name], command.shownText);
      const compose = (requestedQuery: string, prepend = leadWithSubject) =>
        composeEgressQuery({
          requestedQuery,
          userText: command.userText,
          earlierUserText: command.earlierUserText,
          publicIdentity: identity,
          prependIdentity: prepend,
          shownNames,
          publicTerms: command.publicTerms,
          researchVocabulary: command.researchVocabulary,
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
      const focused = command.focused === true;
      plan(command.requestedQuery, focused ? false : leadWithSubject);
      // Two slots (2026-10-25), filled by what the question most needs:
      // the name with its country when a name is what is being looked up,
      // then the model's other phrasings, then the same words without the
      // subject in front (the question may be about the world, not them),
      // then their sentence as they put it.
      if (
        !focused &&
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
      for (const also of command.alsoQueries ?? [])
        plan(also, focused ? false : leadWithSubject);
      if (!focused) plan(command.requestedQuery, false);
      if (!focused) plan(searchPhrase(command.userText), false);
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
      // The job's grant, refinement included; at least the one search.
      const searchCap =
        command.maxSearches === undefined
          ? Number.POSITIVE_INFINITY
          : Math.max(1, Math.floor(command.maxSearches));
      const extractBudgetMs =
        command.planned === true ? plannedExtractBudgetMs : turnExtractBudgetMs;
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
      const search = (query: string) => ({
        query,
        maxResults: RESEARCH_BOUNDS.maxSearchResults,
        freshness,
        includeDomains,
      });
      // What the question needs, and no more (production 2026-10-25: up to
      // seven searches a turn, each asked of every index, ~25 paid calls for
      // "Who is the founder of Paystack?"): the first phrasing; then, for
      // someone named, LinkedIn's public people and company pages in one
      // search (owner 2026-10-23; only what the index shows, nothing behind
      // a sign-in); else the second phrasing; else the month's coverage
      // from the news verticals (founder direction 2026-09-29).
      const lane =
        !focused &&
        entity !== null &&
        aboutSomeoneElse &&
        includeDomains.length === 0
          ? [
              {
                query: entity.name,
                maxResults: RESEARCH_BOUNDS.maxRecentResults,
                freshness: "ANY" as const,
                includeDomains: [...LINKEDIN_LANE],
              },
            ]
          : [];
      const news =
        freshness === "ANY" && !focused
          ? [
              {
                query: primary,
                maxResults: RESEARCH_BOUNDS.maxRecentResults,
                freshness: "PAST_MONTH" as const,
                includeDomains,
                topic: "NEWS" as const,
              },
            ]
          : [];
      const requests = [
        search(primary),
        ...lane,
        ...planned.slice(1).map(search),
        ...news,
      ].slice(0, Math.min(RESEARCH_BOUNDS.searchesPerResearch, searchCap));
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
        searchCalls < Math.min(RESEARCH_BOUNDS.maxSearchCalls, searchCap)
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

      // A search about someone named keeps only pages that name them
      // (production 2026-10-23: a celebrity plane crash and a jet-charter
      // advert answered "Zino Aviation and its team"). Nothing is put in
      // their place: fewer sources, never padding.
      const gate =
        entity !== null && aboutSomeoneElse ? namesEntity(entity.name) : null;
      const safeHits = hits.filter(
        (hit) => judgePublicUrl(hit.url).ok && (gate === null || gate(hit)),
      );
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
      // Production 2026-10-23: where a search lost its hits, said once a
      // research call (the providers' own outcomes are logged by the
      // fan-out): what was found, what was safe, what will be read.
      logger?.info(
        {
          runId: command.runId,
          provider: provider.code,
          queries: requests.length,
          answered: lists.length,
          hits: hits.length,
          safe: safeHits.length,
          reading: chosen.length,
        },
        "public research searched",
      );
      let pages = new Map<string, { title: string | null; text: string }>();
      let extractCalls = 0;
      if (chosen.length > 0) {
        // Its own deadline: the reads never hold the answer past it (also
        // raced, for a provider that does not heed its signal).
        const deadline = time.timeout(extractBudgetMs);
        const reading = {
          ...context,
          signal:
            context.signal === undefined
              ? deadline.signal
              : AbortSignal.any([context.signal, deadline.signal]),
        };
        try {
          extractCalls += 1;
          const extracted = await Promise.race([
            provider.extract({ urls: chosen.map((hit) => hit.url) }, reading),
            rejectOnAbort(
              deadline.signal,
              () =>
                new ResearchProviderFailure({
                  providerCode: provider.code,
                  failureClass: "TIMEOUT",
                }),
            ),
          ]);
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
          if (error.failureClass === "TIMEOUT") {
            logger?.info(
              { runId: command.runId, budgetMs: extractBudgetMs },
              "public research page reads past their budget; the answer goes on the snippets",
            );
          } else {
            providerUnavailable(error, "extract");
          }
        } finally {
          deadline.cancel();
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
  const unbudgeted = service.research;
  return {
    ...service,
    research: (command) => budgeted(command, unbudgeted),
  };
}
