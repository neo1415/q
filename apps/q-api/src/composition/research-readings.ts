import { randomUUID } from "node:crypto";

import { CorrelationIdSchema } from "@capital-q/contracts";
import {
  ClaimProposalBlockedError,
  ExtractionPassageSchema,
  linkResearchReadings,
  listResearchReadings,
  readingKey,
  recordResearchReadings,
  RESEARCH_READING_CLAIM_KEYS,
  RESEARCH_READING_KEY_GUIDE,
  RESEARCH_READINGS_STANDING,
  researchContentHash,
  researchReadingLines,
  researchReadingsFromProposals,
  type ClaimProposerPort,
  type ResearchReading,
  type ResearchReadingEvidence,
  type ResearchReadingPage,
} from "@capital-q/evidence";
import type { Logger } from "@capital-q/observability";
import { independenceKeys } from "@capital-q/q-research";
import type { ActorContext } from "@capital-q/security";

import type { KeptReading } from "./research-claim-cards.js";

/**
 * Research readings (decisions 92-96, owner addendum 14 Nov): figures that
 * public pages report about a company, read selectively AFTER a research
 * turn -- never inside it, never one model call per page -- and offered to
 * the next answer as cited, dated, attributed readings.
 *
 *   relevance   only a fetched page (never a snippet alone) that is about
 *               the company and carries a figure with a metric word;
 *   reuse       a page whose content hash was read before (in this
 *               process, or kept as the owning company's evidence) is
 *               never sent again;
 *   batching    up to PAGES_PER_CALL pages share one extraction call;
 *   bounds      at most CALLS_PER_HOUR calls per process.
 *
 * Context Firewall: a reading is derived from public page text alone. The
 * investor path reads only this cache (no evidence, no claims, no founder-
 * private value can reach it). Readings are written as evidence only for
 * pages already recorded as the OWNING company's evidence (ADR 0009 §6);
 * an investor's research stays transient.
 *
 * Off unless `enabled` (CQ_RESEARCH_FIGURE_CARDS=on).
 */

export const PAGES_PER_CALL = 4;
export const BATCH_TEXT_MAX = 7_600;
export const CALLS_PER_HOUR = 30;
const CACHE_MAX = 2_000;

/** A source as the research tool returned it. */
export type ResearchReadingsSource = {
  readonly url: string;
  readonly domain: string;
  readonly title: string | null;
  readonly publishedAt: string | null;
  readonly retrievedAt: string;
  readonly excerpt: string;
  readonly extracted: boolean;
  readonly isSubjectWebsite: boolean;
  readonly subjectMatch: "MATCH" | "POSSIBLE" | "NONE" | null;
  readonly evidenceSourceId: string | null;
  readonly evidenceItemId: string | null;
};

export type ResearchReadingsSubject = {
  readonly companyId: string;
  readonly name: string;
};

export type ResearchReadingsOutcome =
  | { readonly kind: "OFF" | "NOTHING_RELEVANT" | "ALL_KNOWN" }
  | { readonly kind: "BUSY"; readonly calls: number }
  | {
      readonly kind: "READ";
      readonly calls: number;
      readonly readings: number;
    };

export type ResearchReadingsDependencies = {
  readonly proposer: ClaimProposerPort;
  readonly enabled: boolean;
  /** The Evidence owner, for the owning company's kept readings only. */
  readonly evidence?: ResearchReadingEvidence | undefined;
  /** Newly kept readings of their own company -> adoption cards. */
  readonly onKept?:
    | ((
        actor: ActorContext,
        companyId: string,
        kept: readonly KeptReading[],
      ) => Promise<unknown>)
    | undefined;
  readonly today?: (() => string) | undefined;
  readonly now?: (() => number) | undefined;
  readonly logger?: Logger | undefined;
};

const METRIC_WORD =
  /\b(?:revenue|turnover|sales|mrr|arr|recurring|raised|raising|raise|funding|round|seed|series [a-h]|valu(?:ed|ation)|investors?|customers|clients|users|subscribers|merchants)\b/iu;
const FIGURE =
  /(?:[$€£₦₹¥]|\b[A-Z]{3}\b|\bKSh\b)\s?\d|\b\d[\d,.]*\s?(?:k|m|mn|bn|million|billion|thousand)\b|\b\d{1,3}(?:,\d{3})+\b/iu;

function dayOf(value: string | null): string | null {
  if (value === null) return null;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : new Date(at).toISOString().slice(0, 10);
}

/** A uuid-shaped key for a page with no evidence source (attribution only). */
function passageId(hash: string): string {
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/**
 * Whether a page is worth reading for figures about the company. Code on
 * the fetched page's own text; never the person's words, never a model.
 */
export function pageIsRelevant(
  source: ResearchReadingsSource,
  subject: ResearchReadingsSubject,
): boolean {
  if (!source.extracted || source.excerpt.trim() === "") return false;
  if (source.subjectMatch === "NONE") return false;
  const name = subject.name.trim().toLowerCase();
  const about =
    source.subjectMatch === "MATCH" ||
    source.isSubjectWebsite ||
    (name.length >= 3 && source.excerpt.toLowerCase().includes(name));
  return (
    about && METRIC_WORD.test(source.excerpt) && FIGURE.test(source.excerpt)
  );
}

export function createResearchReadings(
  dependencies: ResearchReadingsDependencies,
) {
  const { proposer, evidence, logger } = dependencies;
  const today =
    dependencies.today ?? (() => new Date().toISOString().slice(0, 10));
  const now = dependencies.now ?? (() => Date.now());
  /** Content hash -> readings of that content (source fields rebound per page). */
  const cache = new Map<string, readonly ResearchReading[]>();
  const inFlight = new Set<string>();
  let window = { start: 0, calls: 0 };

  const remember = (hash: string, readings: readonly ResearchReading[]) => {
    if (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(hash, readings);
  };

  const withinBudget = (): boolean => {
    const at = now();
    if (at - window.start >= 3_600_000) window = { start: at, calls: 0 };
    if (window.calls >= CALLS_PER_HOUR) return false;
    window.calls += 1;
    return true;
  };

  /** The pages as readable pages, with independence keys and hashes. */
  const pagesOf = (
    sources: readonly ResearchReadingsSource[],
  ): (ResearchReadingPage & { readonly hash: string })[] => {
    const publishers = independenceKeys(
      sources.map((source, index) => ({
        source: index,
        domain: source.domain,
        title: source.title,
      })),
    );
    return sources.map((source, index) => ({
      text: source.excerpt,
      hash: researchContentHash(source.excerpt),
      url: source.url,
      domain: source.domain,
      publisher: publishers.get(index) ?? source.domain,
      title: source.title,
      publishedOn: dayOf(source.publishedAt),
      retrievedAt: new Date(
        Date.parse(source.retrievedAt) || now(),
      ).toISOString(),
      companyOwnSite: source.isSubjectWebsite,
      evidenceSourceId: source.evidenceSourceId,
      excerptItemId: source.evidenceItemId,
    }));
  };

  /** A cached reading, re-attributed to the page that carries that content now. */
  const rebind = (
    reading: ResearchReading,
    page: ResearchReadingPage & { readonly hash: string },
  ): ResearchReading => ({
    ...reading,
    source: {
      url: page.url,
      domain: page.domain,
      publisher: page.publisher,
      title: page.title,
      publishedOn: page.publishedOn,
      retrievedAt: page.retrievedAt,
      contentHash: page.hash,
      companyOwnSite: page.companyOwnSite,
      evidenceSourceId: page.evidenceSourceId,
      excerptItemId: page.excerptItemId,
    },
    evidenceStatus: page.companyOwnSite ? "SELF_REPORTED" : "NO_EVIDENCE",
    reportedBy: page.companyOwnSite ? "COMPANY_OWN_SITE" : "THIRD_PARTY",
  });

  /** The owning company's kept readings, into the cache (no model). */
  const warmFromEvidence = async (
    actor: ActorContext,
    companyId: string,
    sources: readonly ResearchReadingsSource[],
  ): Promise<void> => {
    if (
      evidence === undefined ||
      !sources.some((source) => source.evidenceSourceId !== null)
    ) {
      return;
    }
    const kept = await listResearchReadings(evidence, { actor, companyId });
    const byHash = new Map<string, ResearchReading[]>();
    for (const { reading } of kept) {
      const list = byHash.get(reading.source.contentHash) ?? [];
      list.push(reading);
      byHash.set(reading.source.contentHash, list);
    }
    for (const [hash, readings] of byHash) remember(hash, readings);
  };

  return {
    /**
     * The trusted reading lines for an answer, from readings already made:
     * never a model call. Null when there are none.
     */
    readingsFor: async (input: {
      readonly actor: ActorContext;
      readonly subject: ResearchReadingsSubject;
      readonly sources: readonly ResearchReadingsSource[];
    }): Promise<{
      readonly standing: string;
      readonly lines: readonly string[];
      /** Independent pages that agree or differ, by URL (never verification). */
      readonly pairs: readonly {
        readonly kind: "CORROBORATES" | "CONTRADICTS";
        readonly urls: readonly [string, string];
      }[];
    } | null> => {
      if (!dependencies.enabled) return null;
      try {
        await warmFromEvidence(
          input.actor,
          input.subject.companyId,
          input.sources,
        );
      } catch {
        // Kept readings are an addition, never a condition of the answer.
      }
      const pages = pagesOf(input.sources);
      const readings = pages.flatMap((page) =>
        (cache.get(page.hash) ?? []).map((reading) => rebind(reading, page)),
      );
      if (readings.length === 0) return null;
      const links = linkResearchReadings(readings);
      return {
        standing: RESEARCH_READINGS_STANDING,
        lines: researchReadingLines(readings, links),
        pairs: links.flatMap((link) => {
          const a = readings[link.between[0]];
          const b = readings[link.between[1]];
          return a === undefined || b === undefined
            ? []
            : [
                {
                  kind: link.kind,
                  urls: [a.source.url, b.source.url] as const,
                },
              ];
        }),
      };
    },

    /** After the turn: reads what is new, relevant and unread. Never throws. */
    afterResearch: async (input: {
      readonly actor: ActorContext;
      readonly subject: ResearchReadingsSubject;
      readonly sources: readonly ResearchReadingsSource[];
    }): Promise<ResearchReadingsOutcome> => {
      if (!dependencies.enabled) return { kind: "OFF" };
      const { actor, subject } = input;
      try {
        const relevant = input.sources.filter((source) =>
          pageIsRelevant(source, subject),
        );
        if (relevant.length === 0) return { kind: "NOTHING_RELEVANT" };
        await warmFromEvidence(actor, subject.companyId, relevant).catch(
          () => undefined,
        );
        const pages = pagesOf(relevant);
        const unread: typeof pages = [];
        const queued = new Set<string>();
        for (const page of pages) {
          if (cache.has(page.hash) || inFlight.has(page.hash)) continue;
          if (queued.has(page.hash)) continue;
          queued.add(page.hash);
          unread.push(page);
        }
        const fresh: ResearchReading[] = [];
        let calls = 0;
        if (unread.length > 0) {
          // Batches: several pages per call, within the passage bound.
          const batches: (typeof pages)[] = [];
          let batch: typeof pages = [];
          let size = 0;
          for (const page of unread) {
            const length = page.text.length + 200;
            if (
              batch.length > 0 &&
              (batch.length >= PAGES_PER_CALL || size + length > BATCH_TEXT_MAX)
            ) {
              batches.push(batch);
              batch = [];
              size = 0;
            }
            batch.push(page);
            size += length;
          }
          if (batch.length > 0) batches.push(batch);
          for (const group of batches) {
            if (!withinBudget()) {
              return { kind: "BUSY", calls };
            }
            for (const page of group) inFlight.add(page.hash);
            try {
              const text = group
                .map(
                  (page, index) =>
                    `--- Page ${String(index + 1)}: ${page.domain}${page.publishedOn === null ? "" : `, ${page.publishedOn}`} ---\n${page.text.slice(0, BATCH_TEXT_MAX)}`,
                )
                .join("\n\n")
                .slice(0, 8_000);
              const first = group[0];
              const passage = ExtractionPassageSchema.parse({
                sourceId:
                  first?.evidenceSourceId ??
                  passageId(first?.hash ?? "0".repeat(64)),
                subject: {
                  subjectType: "COMPANY",
                  subjectId: subject.companyId,
                },
                locator: { kind: "statement" },
                text,
                description:
                  `Public web pages that may report figures about one company. ${RESEARCH_READING_KEY_GUIDE}`.slice(
                    0,
                    400,
                  ),
              });
              calls += 1;
              const batchOut = await proposer.propose({
                passage,
                claimKeys: RESEARCH_READING_CLAIM_KEYS,
                actor,
              });
              const readings = researchReadingsFromProposals({
                proposals: batchOut.proposals,
                pages: group,
                today: today(),
              });
              for (const page of group) {
                remember(
                  page.hash,
                  readings.filter(
                    (reading) => reading.source.contentHash === page.hash,
                  ),
                );
              }
              fresh.push(...readings);
            } catch (error: unknown) {
              // Not cached: a later research turn may read it again, once.
              if (error instanceof ClaimProposalBlockedError) {
                logger?.info(
                  { reason: error.reason },
                  "public-page readings were not made",
                );
              } else {
                throw error;
              }
            } finally {
              for (const page of group) inFlight.delete(page.hash);
            }
          }
        }
        // The owning company's recorded pages: kept as its research
        // evidence, and offered for adoption on a card.
        const owned = fresh.filter(
          (reading) => reading.source.evidenceSourceId !== null,
        );
        if (owned.length > 0 && evidence !== undefined) {
          const correlationId = CorrelationIdSchema.parse(
            `cor_${randomUUID()}`,
          );
          await recordResearchReadings(evidence, {
            actor,
            companyId: subject.companyId,
            readings: owned,
            correlationId,
          });
          if (dependencies.onKept !== undefined) {
            const keys = new Set(owned.map((reading) => readingKey(reading)));
            const kept = (
              await listResearchReadings(evidence, {
                actor,
                companyId: subject.companyId,
              })
            ).filter((entry) => keys.has(readingKey(entry.reading)));
            await dependencies.onKept(actor, subject.companyId, kept);
          }
        }
        // Counts only: no figure, no quote, no page text in a log line.
        logger?.info(
          { calls, pages: unread.length, readings: fresh.length },
          "q read public pages for reported figures",
        );
        return unread.length === 0
          ? { kind: "ALL_KNOWN" }
          : { kind: "READ", calls, readings: fresh.length };
      } catch (error: unknown) {
        logger?.warn({ err: error }, "public-page readings failed");
        return { kind: "NOTHING_RELEVANT" };
      }
    },
  };
}
