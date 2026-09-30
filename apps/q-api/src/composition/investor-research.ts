import { z } from "zod";

import type { ModelDataPosture } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  FounderResearchReaderResultSchema,
  InvestorResearchReaderResultSchema,
  renderPrompt,
  type FounderResearchReaderResult,
  type FounderResearchReaderVariables,
  type InvestorResearchReaderResult,
  type InvestorResearchReaderVariables,
} from "@capital-q/q-core";
import { PRESENCE_BOUNDS, type PresenceReadPort } from "@capital-q/q-presence";

import {
  READER_OPTIONS,
  type InvestorResearchDependencies,
  type ResearchPage,
} from "../voice/investor-research.js";
import {
  FOUNDER_READER_OPTIONS,
  validateFounderReading,
} from "../voice/founder-research.js";

/**
 * Investor research, composed (BIZ-009).
 *
 * Thin adapters onto what already owns each rule. The public web and a
 * declared profile link are read through the presence read port, the same
 * one founder presence research uses (Research decides what may leave in
 * a query; the Bright Data lookup reads only a link the person gave, C5).
 * The reader runs through the Model Gateway by task class. Registries are
 * composed only when their key or contact is configured.
 */

const READER_BUDGET = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.05,
  maxOutputTokens: 1_500,
  attemptTimeoutMs: 40_000,
} as const;

/** The public web and a declared link, through founder presence's read port. */
export function investorResearchReadFrom(
  presenceRead: PresenceReadPort,
): InvestorResearchDependencies["read"] {
  return async ({ actor, correlationId, identity }) => {
    const pages = await presenceRead.read({
      actor,
      correlationId,
      // An investor organisation is never a research subject the query is
      // composed around (CQ-Q-RESEARCH-001 §9); the id only labels the read.
      subject: {
        subjectType: "INVESTOR_ORGANISATION",
        subjectId: actor.userId,
      },
      identity: {
        name: identity.firmName.slice(0, 160),
        websiteUrl: identity.websiteUrl,
        profileUrl: identity.profileUrls[0] ?? null,
        // The one extra public term that finds an investor's own pages
        // rather than a namesake's.
        qualifier:
          identity.personName === undefined || identity.personName === null
            ? "investors portfolio"
            : `${identity.personName.slice(0, 80)} investor`,
      },
    });
    return pages.map((page) => ({
      url: page.url,
      title: page.title,
      excerpt: page.excerpt.slice(0, PRESENCE_BOUNDS.maxExcerptChars),
      provider: page.provider,
      retrievedAt: page.retrievedAt,
    }));
  };
}

/** The reader model. It proposes; code validates; the investor decides. */
export function createInvestorResearchReader(dependencies: {
  readonly gateway: ModelGateway;
  readonly dataPosture?: ModelDataPosture | undefined;
  readonly logger?: Logger | undefined;
}): InvestorResearchDependencies["reader"] {
  const registry = createDefaultPromptRegistry();
  const { gateway, logger } = dependencies;
  return async (request) => {
    const rendered = renderPrompt<InvestorResearchReaderVariables>(registry, {
      task: "INVESTOR_RESEARCH_READER",
      operatingMode: "ASSESSMENT",
      communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
      environmentNotes:
        "No tools are available to you. Report only what the supplied pages say.",
      variables: {
        firmName: request.firmName.slice(0, 160),
        websiteUrl: request.websiteUrl,
        ...READER_OPTIONS,
        sources: request.pages.slice(0, 12).map((page, index) => ({
          index,
          url: page.url.slice(0, 500),
          title: page.title === null ? null : page.title.slice(0, 300),
          excerpt: page.excerpt.slice(0, 6_000),
        })),
      },
    });
    try {
      const result = await gateway.execute<InvestorResearchReaderResult>(
        {
          taskClass: "STRUCTURED_EXTRACTION",
          budget: READER_BUDGET,
          ...(dependencies.dataPosture === undefined
            ? {}
            : { dataPosture: dependencies.dataPosture }),
          // Public pages about the person's own firm. Nothing confidential
          // is in the prompt, and nothing may be added to it.
          sensitivity: "INTERNAL",
          messages: [...rendered.messages],
          output: rendered.output,
          attribution: {
            tenantId: request.actor.tenantId,
            userId: request.actor.userId,
            correlationId: request.correlationId,
          },
        },
        { schema: LENIENT_INVESTOR_READING },
      );
      return result.output.kind === "STRUCTURED" ? result.output.value : null;
    } catch (error: unknown) {
      logger?.warn(
        { err: error, correlationId: request.correlationId },
        "investor research reader produced nothing",
      );
      return null;
    }
  };
}

type Fetch = typeof fetch;

const REGISTRY_TIMEOUT_MS = 8_000;

async function getJson(
  fetchImpl: Fetch,
  url: string,
  headers: Record<string, string>,
): Promise<unknown> {
  const response = await fetchImpl(url, {
    headers,
    signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  return await response.json();
}

function field(from: unknown, key: string): unknown {
  return typeof from === "object" && from !== null
    ? (from as Record<string, unknown>)[key]
    : undefined;
}

function text(from: unknown, key: string, max = 200): string | null {
  const value = field(from, key);
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().slice(0, max)
    : null;
}

/**
 * UK Companies House: the firm's registered entities, by name. Free, with
 * an API key; composed only when the key is configured.
 */
export function createCompaniesHouseRegistry(options: {
  readonly apiKey: string;
  readonly fetch?: Fetch | undefined;
}): NonNullable<InvestorResearchDependencies["registries"]>[number] {
  const fetchImpl = options.fetch ?? fetch;
  const auth = `Basic ${Buffer.from(`${options.apiKey}:`).toString("base64")}`;
  return {
    name: "companies_house",
    lookup: async (firmName) => {
      const url = `https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(firmName.slice(0, 120))}&items_per_page=3`;
      const body = await getJson(fetchImpl, url, { authorization: auth });
      const items = field(body, "items");
      if (!Array.isArray(items)) return [];
      const retrievedAt = new Date().toISOString();
      return items.slice(0, 3).flatMap((item): ResearchPage[] => {
        const title = text(item, "title");
        const number = text(item, "company_number", 20);
        if (title === null || number === null) return [];
        const lines = [
          `Companies House record: ${title} (company number ${number}).`,
          text(item, "company_status", 40) === null
            ? null
            : `Status: ${text(item, "company_status", 40) ?? ""}.`,
          text(item, "address_snippet", 300) === null
            ? null
            : `Registered office: ${text(item, "address_snippet", 300) ?? ""}.`,
          text(item, "date_of_creation", 20) === null
            ? null
            : `Incorporated: ${text(item, "date_of_creation", 20) ?? ""}.`,
          text(item, "description", 300),
        ];
        return [
          {
            url: `https://find-and-update.company-information.service.gov.uk/company/${encodeURIComponent(number)}`,
            title: `Companies House: ${title}`,
            excerpt: lines.filter((l): l is string => l !== null).join("\n"),
            provider: "public_registry",
            retrievedAt,
          },
        ];
      });
    },
  };
}

/**
 * SEC EDGAR: the firm's filer record and recent forms (Form D, ADV), by
 * name. No key, but a declared contact User-Agent is required by the SEC's
 * fair-access policy; composed only when that contact is configured.
 */
export function createSecEdgarRegistry(options: {
  readonly userAgent: string;
  readonly fetch?: Fetch | undefined;
}): NonNullable<InvestorResearchDependencies["registries"]>[number] {
  const fetchImpl = options.fetch ?? fetch;
  const headers = {
    "user-agent": options.userAgent,
    accept: "application/json",
  };
  return {
    name: "sec_edgar",
    lookup: async (firmName) => {
      const search = await getJson(
        fetchImpl,
        `https://efts.sec.gov/LATEST/search-index?keysTyped=${encodeURIComponent(firmName.slice(0, 120))}`,
        headers,
      );
      const hits = field(field(search, "hits"), "hits");
      if (!Array.isArray(hits)) return [];
      const first: unknown = hits[0];
      const cikRaw = text(first, "_id", 20);
      if (cikRaw === null || !/^\d{1,10}$/.test(cikRaw)) return [];
      const cik = cikRaw.padStart(10, "0");
      const filer = await getJson(
        fetchImpl,
        `https://data.sec.gov/submissions/CIK${cik}.json`,
        headers,
      );
      const name = text(filer, "name");
      if (name === null) return [];
      const recent = field(field(filer, "filings"), "recent");
      const forms = field(recent, "form");
      const dates = field(recent, "filingDate");
      const listed =
        Array.isArray(forms) && Array.isArray(dates)
          ? forms
              .slice(0, 8)
              .map((form, i) =>
                typeof form === "string" && typeof dates[i] === "string"
                  ? `${form} (${String(dates[i])})`
                  : null,
              )
              .filter((l): l is string => l !== null)
          : [];
      const business = field(field(filer, "addresses"), "business");
      const place = [
        text(business, "city", 80),
        text(business, "stateOrCountryDescription", 80),
      ]
        .filter((p): p is string => p !== null)
        .join(", ");
      return [
        {
          url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}`,
          title: `SEC EDGAR: ${name}`,
          excerpt: [
            `SEC EDGAR filer: ${name} (CIK ${cik}).`,
            place.length === 0 ? null : `Business address: ${place}.`,
            listed.length === 0
              ? null
              : `Recent filings: ${listed.join(", ")}.`,
          ]
            .filter((l): l is string => l !== null)
            .join("\n"),
          provider: "public_registry",
          retrievedAt: new Date().toISOString(),
        },
      ];
    },
  };
}

// ---------------------------------------------------------------------------
// Founder research (founder direction 2026-09-30): the same engine, reading
// the founder's own company while Q interviews them.
// ---------------------------------------------------------------------------

/** The public web and a declared link, about the founder's own company. */
export function founderResearchReadFrom(
  presenceRead: PresenceReadPort,
): InvestorResearchDependencies["read"] {
  return async ({ actor, correlationId, identity }) => {
    const pages = await presenceRead.read({
      actor,
      correlationId,
      // The id only labels the read; the query is composed around the
      // company name the founder gave.
      subject: { subjectType: "COMPANY", subjectId: actor.userId },
      identity: {
        name: identity.firmName.slice(0, 160),
        websiteUrl: identity.websiteUrl,
        profileUrl: identity.profileUrls[0] ?? null,
        qualifier:
          identity.personName === undefined || identity.personName === null
            ? "startup company"
            : `startup ${identity.personName.slice(0, 80)}`,
      },
    });
    return pages.map((page) => ({
      url: page.url,
      title: page.title,
      excerpt: page.excerpt.slice(0, PRESENCE_BOUNDS.maxExcerptChars),
      provider: page.provider,
      retrievedAt: page.retrievedAt,
    }));
  };
}

/**
 * One unusable field is unknown, not a reason to lose the rest (live
 * 2026-09-30: an empty team size refused the whole reading, and Nixo's
 * description and country with it). Only a field's own value is ever
 * dropped to null; nothing is repaired or rewritten.
 */
function lenientReading<T extends z.ZodType>(schema: T) {
  return z.preprocess((raw) => {
    const checked = schema.safeParse(raw);
    if (checked.success || typeof raw !== "object" || raw === null) return raw;
    const kept: Record<string, unknown> = {
      ...(raw as Record<string, unknown>),
    };
    for (const issue of checked.error.issues) {
      const field = issue.path[0];
      if (
        typeof field === "string" &&
        field !== "wrongSubject" &&
        field in kept
      ) {
        kept[field] = null;
      }
    }
    return kept;
  }, schema);
}

const LENIENT_FOUNDER_READING = lenientReading(
  FounderResearchReaderResultSchema,
);
// The same for investors (bench 2026-09-30: too many geographies refused
// Ventures Platform's whole reading, and Q "found nothing useful").
const LENIENT_INVESTOR_READING = lenientReading(
  InvestorResearchReaderResultSchema,
);

/** The founder reader model, then code's checks: findings or nothing. */
export function createFounderResearchReader(dependencies: {
  readonly gateway: ModelGateway;
  readonly dataPosture?: ModelDataPosture | undefined;
  readonly logger?: Logger | undefined;
}): NonNullable<InvestorResearchDependencies["readFindings"]> {
  const registry = createDefaultPromptRegistry();
  const { gateway, logger } = dependencies;
  return async (request) => {
    const rendered = renderPrompt<FounderResearchReaderVariables>(registry, {
      task: "FOUNDER_RESEARCH_READER",
      operatingMode: "ASSESSMENT",
      communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
      environmentNotes:
        "No tools are available to you. Report only what the supplied pages say.",
      variables: {
        companyName: request.identity.firmName.slice(0, 160),
        websiteUrl: request.identity.websiteUrl,
        ...FOUNDER_READER_OPTIONS,
        sources: request.pages.slice(0, 12).map((page, index) => ({
          index,
          url: page.url.slice(0, 500),
          title: page.title === null ? null : page.title.slice(0, 300),
          excerpt: page.excerpt.slice(0, 6_000),
        })),
      },
    });
    try {
      const result = await gateway.execute<FounderResearchReaderResult>(
        {
          taskClass: "STRUCTURED_EXTRACTION",
          budget: READER_BUDGET,
          ...(dependencies.dataPosture === undefined
            ? {}
            : { dataPosture: dependencies.dataPosture }),
          // Public pages about the founder's own company.
          sensitivity: "INTERNAL",
          messages: [...rendered.messages],
          output: rendered.output,
          attribution: {
            tenantId: request.actor.tenantId,
            userId: request.actor.userId,
            correlationId: request.correlationId,
          },
        },
        { schema: LENIENT_FOUNDER_READING },
      );
      return result.output.kind === "STRUCTURED"
        ? validateFounderReading(
            result.output.value,
            request.pages,
            request.identity.websiteUrl,
            request.identity.firmName,
          )
        : [];
    } catch (error: unknown) {
      logger?.warn(
        { err: error, correlationId: request.correlationId },
        "founder research reader produced nothing",
      );
      return [];
    }
  };
}
