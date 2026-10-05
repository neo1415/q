import { randomUUID } from "node:crypto";

import type { ApiSession } from "@capital-q/api-client";
import { CorrelationIdSchema, type CorrelationId } from "@capital-q/contracts";
import {
  CURRENCY_OPTIONS,
  INVESTOR_STEPS,
  INVESTOR_TYPE_OPTIONS,
  STAGE_OPTIONS,
} from "@capital-q/investor-onboarding";
import type { Logger } from "@capital-q/observability";
import type { QRecommendationPublicSourceType } from "@capital-q/onboarding";
import type { InvestorResearchReaderResult } from "@capital-q/q-core";
import { quoteOccursIn } from "@capital-q/q-knowledge";
import type { ActorContext } from "@capital-q/security";

import type {
  FoundRecommendation,
  FoundRecommendationPort,
} from "./onboarding-port.js";

/**
 * Research-first investor onboarding (BIZ-009, R13).
 *
 * As soon as an investor has named their firm (and, if they give them,
 * their website or a profile link of their own), Q reads what their own
 * public sources say about how they invest and offers it back as
 * recommendations: "here's what I found, is this right?". The investor
 * confirms or corrects in a turn or two instead of answering a dozen
 * questions.
 *
 * Meaning by the model, authority by code (ADR 0011/0016):
 * - a reader model reads the pages into the mandate's shape, citing a
 *   page and its exact words for every field;
 * - code checks each field against the journey's own choices and checks
 *   the cited words are really on the cited page; anything that fails is
 *   dropped, which leaves that field unknown;
 * - what survives is held as a recommendation with its source, never an
 *   answer. Only the investor's acceptance makes it theirs, and a finding
 *   that differs from what they said is held beside their answer until
 *   they decide.
 *
 * Detached and best effort: research never delays or fails a turn, and
 * the first feed never waits for it. Hard exclusions are never pre-filled
 * (doc 10 §5.5): no field here maps to one.
 */

/** A public page as research hands it over: bounded, data, never instruction. */
export type ResearchPage = {
  readonly url: string;
  readonly title: string | null;
  readonly excerpt: string;
  /** public_web, public_profile, public_registry. */
  readonly provider: string;
  readonly retrievedAt: string;
};

export type InvestorResearchIdentity = {
  readonly firmName: string;
  readonly websiteUrl: string | null;
  readonly profileUrls: readonly string[];
  /**
   * The person's own name from sign-up: searching the company together
   * with its founder or partner keeps a same-named company out (live
   * 2026-09-30: "Greenbox" found an unrelated solar maker).
   */
  readonly personName?: string | null | undefined;
};

export type InvestorResearchDependencies = {
  /**
   * Whose journey this engine reads for. The same engine reads a
   * founder's company; its log said "investor research" for a founder
   * (founder report 2026-10-05). Default: investor.
   */
  readonly journey?: "investor" | "founder" | undefined;
  /** The public web: the firm's site and a declared profile link (Bright Data, C5). */
  readonly read: (request: {
    readonly actor: ActorContext;
    readonly correlationId: CorrelationId;
    readonly identity: InvestorResearchIdentity;
  }) => Promise<readonly ResearchPage[]>;
  /**
   * Public registries (Companies House, SEC EDGAR), each composed only when
   * its key or contact is configured. Empty: registries are skipped.
   */
  readonly registries?:
    | readonly {
        readonly name: string;
        readonly lookup: (firmName: string) => Promise<readonly ResearchPage[]>;
      }[]
    | undefined;
  /**
   * Another journey's own reading (founder direction 2026-09-30: the
   * founder's company researched during setup): the pages read and
   * checked into findings by that journey's reader and validation. When
   * given, it replaces the investor reader below.
   */
  readonly readFindings?:
    | ((request: {
        readonly actor: ActorContext;
        readonly correlationId: CorrelationId;
        readonly identity: InvestorResearchIdentity;
        readonly pages: readonly ResearchPage[];
      }) => Promise<readonly ResearchFinding[]>)
    | undefined;
  /** The reader model, through the Model Gateway. Null: nothing read. */
  readonly reader?:
    | ((request: {
        readonly actor: ActorContext;
        readonly correlationId: CorrelationId;
        readonly firmName: string;
        readonly websiteUrl: string | null;
        readonly pages: readonly ResearchPage[];
      }) => Promise<InvestorResearchReaderResult | null>)
    | undefined;
  /**
   * The person's own onboarding, bound to their session, to hold what was
   * found the moment it is found (so it survives a restart as a durable
   * recommendation, and the screen can show it before the next turn).
   */
  readonly portFor: (context: {
    readonly actor: ActorContext;
    readonly session: ApiSession;
    readonly onboardingSessionId: string;
  }) => FoundRecommendationPort;
  readonly logger?: Logger | undefined;
  /** Sessions remembered in this process. */
  readonly maxSessions?: number | undefined;
};

/** One field, validated and cited, waiting to be offered. */
export type ResearchFinding = FoundRecommendation & {
  /** A step that must be answered before this one can be accepted. */
  readonly after: string | null;
};

export type InvestorResearchStatus =
  "NONE" | "RUNNING" | "FOUND" | "NOTHING_FOUND" | "FAILED";

export type InvestorResearch = {
  /**
   * Start a read if this identity has not been read for this session.
   * Returns true when one was started now. Never throws, never waits.
   */
  readonly consider: (input: {
    readonly actor: ActorContext;
    readonly session: ApiSession;
    readonly onboardingSessionId: string;
    readonly identity: InvestorResearchIdentity;
  }) => boolean;
  /**
   * Offer the findings whose prerequisites are now answered, once each.
   * Called at the start of a turn; a failure costs the offer, not the turn.
   */
  readonly offerReady: (
    onboardingSessionId: string,
    port: FoundRecommendationPort,
  ) => Promise<number>;
  readonly status: (onboardingSessionId: string) => InvestorResearchStatus;
  /**
   * The steps whose found recommendation is held but has not been said to
   * the person yet. A recommendation held between turns was never heard,
   * so it cannot be approved until a reply has said it.
   */
  readonly unsaid: (onboardingSessionId: string) => ReadonlySet<string>;
  /** A reply said these; from now on the person has heard them. */
  readonly markSaid: (
    onboardingSessionId: string,
    stepKeys: Iterable<string>,
  ) => void;
  /**
   * What to tell the person about the research, once per fact: that it is
   * starting (the notice), or that nothing useful was found.
   */
  readonly takeNote: (
    onboardingSessionId: string,
  ) => "STARTED" | "NOTHING_FOUND" | null;
};

// ---------------------------------------------------------------------------
// Validation: the reading, checked against the pages and the journey
// ---------------------------------------------------------------------------

const AMOUNT = /^\d{1,13}(?:\.\d{1,2})?$/;
const MAX_AMOUNT = 1_000_000_000_000;

function amountOf(raw: string | null): number | null {
  if (raw === null) return null;
  const text = raw.trim();
  if (!AMOUNT.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 && value <= MAX_AMOUNT
    ? value
    : null;
}

function domainOf(url: string | null): string | null {
  if (url === null) return null;
  try {
    const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Where a page sits, for the person: their site, their link, a registry. */
function sourceTypeOf(
  page: ResearchPage,
  websiteUrl: string | null,
): QRecommendationPublicSourceType {
  if (page.provider === "public_registry") return "PUBLIC_REGISTRY";
  if (page.provider === "public_profile") return "PUBLIC_PROFILE";
  const site = domainOf(websiteUrl);
  const host = domainOf(page.url);
  if (
    site !== null &&
    host !== null &&
    (host === site || host.endsWith(`.${site}`))
  ) {
    return "PUBLIC_WEBSITE";
  }
  return "PUBLIC_WEB";
}

function saidWhere(
  type: QRecommendationPublicSourceType,
  page: ResearchPage,
): string {
  const host = domainOf(page.url) ?? "the web";
  switch (type) {
    case "PUBLIC_WEBSITE":
      return `found on their website (${host})`;
    case "PUBLIC_PROFILE":
      return `found on the profile link they gave (${host})`;
    case "PUBLIC_REGISTRY":
      return `found in a public registry (${page.title ?? host})`;
    case "PUBLIC_WEB":
      return `found on a public page (${host})`;
  }
}

const TYPE_KEYS = new Set(INVESTOR_TYPE_OPTIONS.map((o) => o.optionKey));
const STAGE_KEYS = new Set(STAGE_OPTIONS.map((o) => o.optionKey));
const CURRENCY_KEYS = new Set(CURRENCY_OPTIONS.map((o) => o.optionKey));

/** The journey's choices, for the reader's prompt. */
export const READER_OPTIONS = {
  investorTypeOptions: INVESTOR_TYPE_OPTIONS.map((o) => ({
    key: o.optionKey,
    label: o.label,
  })),
  stageOptions: STAGE_OPTIONS.map((o) => ({
    key: o.optionKey,
    label: o.label,
  })),
  currencyOptions: CURRENCY_OPTIONS.map((o) => ({
    key: o.optionKey,
    label: o.label,
  })),
} as const;

const MANDATE = INVESTOR_STEPS.mandateContext;
const FIRM = INVESTOR_STEPS.organisationName;

/**
 * The reading, checked and mapped to the journey's steps.
 *
 * Code decides nothing about meaning here. It checks: the cited page
 * exists, the cited words are on it, a choice is one of the journey's
 * own, an amount is a plain number with a currency beside it and the
 * amounts are in order. Anything that fails is dropped and stays unknown.
 */
export function validateReading(
  reading: InvestorResearchReaderResult,
  pages: readonly ResearchPage[],
  websiteUrl: string | null,
): readonly ResearchFinding[] {
  if (reading.wrongSubject) return [];
  const findings: ResearchFinding[] = [];
  const cited = (
    field: { readonly sourceIndex: number; readonly quote: string } | null,
  ): { page: ResearchPage; type: QRecommendationPublicSourceType } | null => {
    if (field === null) return null;
    const page = pages[field.sourceIndex];
    if (page === undefined) return null;
    // The words must be on the page they cite: a citation, not a rumour.
    if (!quoteOccursIn(field.quote, page.excerpt)) return null;
    return { page, type: sourceTypeOf(page, websiteUrl) };
  };
  const push = (
    stepKey: string,
    value: FoundRecommendation["value"],
    from: { page: ResearchPage; type: QRecommendationPublicSourceType },
    after: string | null,
  ) => {
    findings.push({
      stepKey,
      value,
      because: saidWhere(from.type, from.page).slice(0, 300),
      sources: [{ sourceType: from.type, url: from.page.url }],
      after,
    });
  };

  const type = cited(reading.investorType);
  if (type !== null && reading.investorType !== null) {
    const key = reading.investorType.value.trim().toLowerCase();
    if (TYPE_KEYS.has(key)) push(INVESTOR_STEPS.investorType, key, type, null);
  }

  const stages = cited(reading.stages);
  if (stages !== null && reading.stages !== null) {
    const keys = [
      ...new Set(
        reading.stages.value
          .map((k) => k.trim().toLowerCase())
          .filter((k) => STAGE_KEYS.has(k)),
      ),
    ];
    if (keys.length > 0) push(INVESTOR_STEPS.stages, keys, stages, MANDATE);
  }

  const sectors = cited(reading.sectors);
  if (sectors !== null && reading.sectors !== null) {
    push(INVESTOR_STEPS.sectors, reading.sectors.value, sectors, MANDATE);
  }

  const geographies = cited(reading.geographies);
  if (geographies !== null && reading.geographies !== null) {
    push(
      INVESTOR_STEPS.geography,
      reading.geographies.value,
      geographies,
      MANDATE,
    );
  }

  const cheque = cited(reading.cheque);
  if (cheque !== null && reading.cheque !== null) {
    const currency = reading.cheque.currency.trim().toLowerCase();
    const min = amountOf(reading.cheque.min);
    const typical = amountOf(reading.cheque.typical);
    const max = amountOf(reading.cheque.max);
    const stated = [min, typical, max].filter((v): v is number => v !== null);
    const ordered = stated.every(
      (v, i) => i === 0 || (stated[i - 1] ?? v) <= v,
    );
    // A number without its currency is not a cheque size; nor is a range
    // that runs backwards. Either leaves the cheque unknown.
    if (CURRENCY_KEYS.has(currency) && stated.length > 0 && ordered) {
      push(INVESTOR_STEPS.currency, currency, cheque, MANDATE);
      if (min !== null) push(INVESTOR_STEPS.chequeMin, min, cheque, MANDATE);
      if (typical !== null) {
        push(INVESTOR_STEPS.chequeTypical, typical, cheque, MANDATE);
      }
      if (max !== null) push(INVESTOR_STEPS.chequeMax, max, cheque, MANDATE);
    }
  }

  const portfolio = cited(reading.portfolio);
  if (portfolio !== null && reading.portfolio !== null) {
    // The step keeps up to five names, one per line.
    push(
      INVESTOR_STEPS.portfolio,
      reading.portfolio.value.slice(0, 5).join("\n"),
      portfolio,
      FIRM,
    );
  }

  const thesis = cited(reading.thesis);
  if (thesis !== null && reading.thesis !== null) {
    push(
      INVESTOR_STEPS.additionalContext,
      reading.thesis.value,
      thesis,
      MANDATE,
    );
  }
  return findings;
}

// ---------------------------------------------------------------------------
// The research itself
// ---------------------------------------------------------------------------

type SessionResearch = {
  identity: InvestorResearchIdentity;
  identityKey: string;
  status: InvestorResearchStatus;
  findings: ResearchFinding[];
  offered: Set<string>;
  unsaid: Set<string>;
  noticeSaid: boolean;
  nothingSaid: boolean;
};

function identityKeyOf(identity: InvestorResearchIdentity): string {
  return JSON.stringify([
    identity.firmName.trim().toLowerCase(),
    domainOf(identity.websiteUrl),
    [...identity.profileUrls].sort(),
  ]);
}

export function createInvestorResearch(
  dependencies: InvestorResearchDependencies,
): InvestorResearch {
  const { logger } = dependencies;
  const maxSessions = dependencies.maxSessions ?? 2_000;
  const bySession = new Map<string, SessionResearch>();
  const keep = (id: string, research: SessionResearch) => {
    bySession.delete(id);
    bySession.set(id, research);
    while (bySession.size > maxSessions) {
      const oldest = bySession.keys().next().value;
      if (oldest === undefined) break;
      bySession.delete(oldest);
    }
  };

  const offer = async (
    research: SessionResearch,
    port: FoundRecommendationPort,
  ): Promise<number> => {
    const answered = await port.answeredSteps();
    const ready = research.findings.filter(
      (f) =>
        !research.offered.has(f.stepKey) &&
        (f.after === null || answered.has(f.after)),
    );
    if (ready.length === 0) return 0;
    // Marked before the write: a finding is offered once, even if the
    // write fails; the person can still say it themselves.
    for (const f of ready) research.offered.add(f.stepKey);
    const results = await port.recommendFound(ready);
    const held = results.filter(
      (r) => r.outcome === "RECOMMENDED" || r.outcome === "DIFFERS_FROM_ANSWER",
    );
    for (const r of held) research.unsaid.add(r.stepKey);
    return held.length;
  };

  const run = async (
    research: SessionResearch,
    input: Parameters<InvestorResearch["consider"]>[0],
  ): Promise<void> => {
    const correlationId = CorrelationIdSchema.parse(`cor_${randomUUID()}`);
    const { actor, identity } = input;
    const registries = dependencies.registries ?? [];
    const [web, ...fromRegistries] = await Promise.allSettled([
      dependencies.read({ actor, correlationId, identity }),
      ...registries.map((registry) => registry.lookup(identity.firmName)),
    ]);
    const pages: ResearchPage[] = [];
    if (web?.status === "fulfilled") pages.push(...web.value);
    for (const outcome of fromRegistries) {
      if (outcome.status === "fulfilled") pages.push(...outcome.value);
    }
    const bounded = pages.slice(0, 12);
    if (bounded.length === 0) {
      research.status = "NOTHING_FOUND";
      return;
    }
    let findings: readonly ResearchFinding[] = [];
    if (dependencies.readFindings !== undefined) {
      findings = await dependencies.readFindings({
        actor,
        correlationId,
        identity,
        pages: bounded,
      });
    } else if (dependencies.reader !== undefined) {
      const reading = await dependencies.reader({
        actor,
        correlationId,
        firmName: identity.firmName,
        websiteUrl: identity.websiteUrl,
        pages: bounded,
      });
      findings =
        reading === null
          ? []
          : validateReading(reading, bounded, identity.websiteUrl);
    }
    // A newer identity (a website given since) supersedes this read.
    if (bySession.get(input.onboardingSessionId) !== research) return;
    research.findings = [...findings];
    research.status = findings.length === 0 ? "NOTHING_FOUND" : "FOUND";
    // Counts only: never a page, a quote or a value.
    logger?.info(
      {
        journey: dependencies.journey ?? "investor",
        pages: bounded.length,
        findings: findings.length,
      },
      dependencies.journey === "founder"
        ? "founder research finished"
        : "investor research finished",
    );
    if (findings.length > 0) {
      await offer(
        research,
        dependencies.portFor({
          actor,
          session: input.session,
          onboardingSessionId: input.onboardingSessionId,
        }),
      );
    }
  };

  return {
    consider: (given) => {
      const earlier = bySession.get(given.onboardingSessionId);
      // What the person gave earlier still holds: a link given two turns
      // ago is not forgotten because this turn only named the firm.
      const identity: InvestorResearchIdentity = {
        firmName:
          given.identity.firmName.trim() || earlier?.identity.firmName || "",
        websiteUrl:
          given.identity.websiteUrl ?? earlier?.identity.websiteUrl ?? null,
        profileUrls: [
          ...new Set([
            ...(earlier?.identity.profileUrls ?? []),
            ...given.identity.profileUrls,
          ]),
        ].slice(0, 2),
      };
      if (identity.firmName.length < 2) return false;
      const identityKey = identityKeyOf(identity);
      if (earlier !== undefined && earlier.identityKey === identityKey) {
        return false;
      }
      const input = { ...given, identity };
      const research: SessionResearch = {
        identity,
        identityKey,
        status: "RUNNING",
        findings: [],
        // What an earlier read already offered is not offered again.
        offered: new Set(earlier?.offered ?? []),
        unsaid: new Set(earlier?.unsaid ?? []),
        noticeSaid: earlier?.noticeSaid ?? false,
        nothingSaid: earlier?.nothingSaid ?? false,
      };
      keep(input.onboardingSessionId, research);
      void run(research, input).catch((error: unknown) => {
        research.status = "FAILED";
        logger?.warn({ err: error }, "investor research failed");
      });
      return true;
    },
    offerReady: async (onboardingSessionId, port) => {
      const research = bySession.get(onboardingSessionId);
      if (research === undefined || research.status !== "FOUND") return 0;
      try {
        return await offer(research, port);
      } catch (error: unknown) {
        logger?.warn({ err: error }, "investor research findings not offered");
        return 0;
      }
    },
    status: (onboardingSessionId) =>
      bySession.get(onboardingSessionId)?.status ?? "NONE",
    unsaid: (onboardingSessionId) =>
      new Set(bySession.get(onboardingSessionId)?.unsaid ?? []),
    markSaid: (onboardingSessionId, stepKeys) => {
      const research = bySession.get(onboardingSessionId);
      if (research === undefined) return;
      for (const key of stepKeys) research.unsaid.delete(key);
    },
    takeNote: (onboardingSessionId) => {
      const research = bySession.get(onboardingSessionId);
      if (research === undefined) return null;
      if (!research.noticeSaid) {
        research.noticeSaid = true;
        return "STARTED";
      }
      if (research.status === "NOTHING_FOUND" && !research.nothingSaid) {
        research.nothingSaid = true;
        return "NOTHING_FOUND";
      }
      return null;
    },
  };
}
