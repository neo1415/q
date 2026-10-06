import { z } from "zod";

import type { DiscoverFilters } from "./discovery.js";

/**
 * F3 (2026-10-06): "Find my startup" in GateQ, one tab, two jobs by role.
 *
 *   founder:  find your company on Capital Q and claim it (or ask to join it)
 *   investor: describe the company you want; Q turns it into filters
 *
 * A claim request is not a membership, and a saved search is not a mandate.
 */

export const COMPANY_CLAIMABLE_PATH = "/v1/companies/claimable" as const;
export const COMPANY_CLAIM_REQUESTS_PATH =
  "/v1/companies/:companyId/claim-requests" as const;
export const GATEQ_STARTUP_ALERTS_PATH = "/v1/gateq/startup-alerts" as const;

export const ClaimableCompanyDtoSchema = z
  .object({
    companyId: z.string().uuid(),
    /**
     * F8: the company's organisation, for "Ask to join" (a team join
     * request names the organisation). Null: nobody has claimed it.
     */
    organisationId: z.string().uuid().nullable(),
    name: z.string().max(200),
    website: z.string().max(2048).nullable(),
    city: z.string().max(120).nullable(),
    country: z.string().max(2).nullable(),
    /** Active members; 0 means nobody has claimed it yet. */
    members: z.number().int().min(0),
    /** The caller already belongs to it. */
    yours: z.boolean(),
    /** The caller has a request waiting on it. */
    requested: z.boolean(),
  })
  .strict();
export type ClaimableCompanyDto = z.infer<typeof ClaimableCompanyDtoSchema>;

export const ClaimableCompanyListDtoSchema = z
  .object({ companies: z.array(ClaimableCompanyDtoSchema).max(20) })
  .strict();
export type ClaimableCompanyListDto = z.infer<
  typeof ClaimableCompanyListDtoSchema
>;

export const COMPANY_CLAIM_METHODS = [
  "WORK_EMAIL",
  "REGISTRY_DOCUMENT",
  "ASK_MEMBERS",
] as const;
export const CompanyClaimMethodSchema = z.enum(COMPANY_CLAIM_METHODS);
export type CompanyClaimMethod = z.infer<typeof CompanyClaimMethodSchema>;

export const CompanyClaimRequestSchema = z
  .object({
    method: CompanyClaimMethodSchema,
    /** Only with WORK_EMAIL: an address at the company's own website domain. */
    workEmail: z.string().trim().toLowerCase().email().max(254).optional(),
    clientRequestId: z.string().regex(/^[A-Za-z0-9:_-]{8,128}$/),
  })
  .strict()
  .refine(
    (input) =>
      (input.method === "WORK_EMAIL") === (input.workEmail !== undefined),
    {
      message: "A work-email claim names the email, and only it does.",
    },
  );
export type CompanyClaimRequest = z.infer<typeof CompanyClaimRequestSchema>;

export const CompanyClaimResultDtoSchema = z
  .object({
    status: z.enum([
      "REQUESTED",
      "ALREADY_REQUESTED",
      "ALREADY_YOURS",
      "EMAIL_NOT_AT_COMPANY",
    ]),
    /** P14: a work-email claim: whether its one-time code was emailed. */
    codeSent: z.boolean().optional(),
  })
  .strict();
export type CompanyClaimResultDto = z.infer<typeof CompanyClaimResultDtoSchema>;

// ---------------------------------------------------------------------------
// P14: confirming a work-email code, and deciding a claim
// ---------------------------------------------------------------------------

export const COMPANY_CLAIM_CONFIRM_PATH =
  "/v1/companies/:companyId/claim-requests/confirm" as const;
export const COMPANY_CLAIM_DECISION_PATH =
  "/v1/companies/:companyId/claim-requests/:requestId/decision" as const;
export const ADMIN_COMPANY_CLAIMS_PATH = "/v1/admin/company-claims" as const;
export const ADMIN_COMPANY_CLAIM_DECISION_PATH =
  "/v1/admin/company-claims/:requestId/decision" as const;

export const ConfirmClaimCodeRequestSchema = z
  .object({ code: z.string().regex(/^\d{6}$/u) })
  .strict();
export type ConfirmClaimCodeRequest = z.infer<
  typeof ConfirmClaimCodeRequestSchema
>;

export const ConfirmClaimCodeResultDtoSchema = z
  .object({
    status: z.enum(["CONFIRMED", "WRONG_CODE", "EXPIRED", "NOT_FOUND"]),
  })
  .strict();
export type ConfirmClaimCodeResultDto = z.infer<
  typeof ConfirmClaimCodeResultDtoSchema
>;

export const ClaimDecisionRequestSchema = z
  .object({
    approve: z.boolean(),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type ClaimDecisionRequest = z.infer<typeof ClaimDecisionRequestSchema>;

export const ClaimDecisionResultDtoSchema = z
  .object({ status: z.enum(["APPROVED", "DECLINED"]) })
  .strict();
export type ClaimDecisionResultDto = z.infer<
  typeof ClaimDecisionResultDtoSchema
>;

/** A pending claim, for whoever may decide it. Name and how, never the code. */
export const PendingClaimDtoSchema = z
  .object({
    requestId: z.string().uuid(),
    companyId: z.string().uuid(),
    companyName: z.string().max(200),
    requesterName: z.string().max(200).nullable(),
    method: CompanyClaimMethodSchema,
    /** WORK_EMAIL only: the domain (never the address) and whether its code was confirmed. */
    workEmailDomain: z.string().max(254).nullable(),
    emailConfirmed: z.boolean(),
    requestedAt: z.string(),
  })
  .strict();
export type PendingClaimDto = z.infer<typeof PendingClaimDtoSchema>;

export const PendingClaimListDtoSchema = z
  .object({ claims: z.array(PendingClaimDtoSchema).max(200) })
  .strict();
export type PendingClaimListDto = z.infer<typeof PendingClaimListDtoSchema>;

/** P14 item 7: an unclaimed company's profile, public or back to the network. */
export const ADMIN_COMPANY_PUBLISH_PATH =
  "/v1/admin/companies/:companyId/public-external" as const;

export const AdminCompanyPublishRequestSchema = z
  .object({
    publicExternal: z.boolean(),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
export type AdminCompanyPublishRequest = z.infer<
  typeof AdminCompanyPublishRequestSchema
>;

export const AdminCompanyPublishResultDtoSchema = z
  .object({
    outcome: z.enum(["CHANGED", "UNCHANGED", "CLAIMED"]),
    /** What it is now; public_external and network_visible stay distinct. */
    visibility: z.enum(["public_external", "network_visible"]).nullable(),
  })
  .strict();
export type AdminCompanyPublishResultDto = z.infer<
  typeof AdminCompanyPublishResultDtoSchema
>;

export const AdminClaimDecisionRequestSchema = z
  .object({
    approve: z.boolean(),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

export const StartupAlertRequestSchema = z
  .object({
    description: z.string().trim().min(3).max(500),
    clientRequestId: z.string().regex(/^[A-Za-z0-9:_-]{8,128}$/),
  })
  .strict();
export type StartupAlertRequest = z.infer<typeof StartupAlertRequestSchema>;

export const StartupAlertDtoSchema = z
  .object({ alertId: z.string().uuid(), deduplicated: z.boolean() })
  .strict();
export type StartupAlertDto = z.infer<typeof StartupAlertDtoSchema>;

// ---------------------------------------------------------------------------
// "Describe the company you're looking for": a deterministic reading
// ---------------------------------------------------------------------------

export type StartupQueryChip = {
  readonly dimension: "stage" | "sector" | "country" | "raise" | "revenue";
  readonly label: string;
  /** False when Capital Q cannot check it from what companies share. */
  readonly checkable: boolean;
};

export type StartupQuery = {
  readonly chips: readonly StartupQueryChip[];
  readonly filters: DiscoverFilters;
  /** Sector words that matched no sector option; used as text. */
  readonly words: readonly string[];
};

const STAGES: readonly (readonly [RegExp, string, string])[] = [
  [/\bpre[- ]?seed\b/i, "pre_seed", "Pre-seed"],
  [/(?<!pre[- ]?)\bseed\b/i, "seed", "Seed"],
  [/\bseries[- ]?a\b/i, "series_a", "Series A"],
  [/\bseries[- ]?b\b/i, "series_b", "Series B"],
];

const COUNTRIES: readonly (readonly [string, string])[] = [
  ["nigeria", "NG"],
  ["ghana", "GH"],
  ["kenya", "KE"],
  ["south africa", "ZA"],
  ["egypt", "EG"],
  ["senegal", "SN"],
  ["rwanda", "RW"],
  ["uganda", "UG"],
  ["tanzania", "TZ"],
  ["ethiopia", "ET"],
  ["morocco", "MA"],
  ["côte d'ivoire", "CI"],
  ["ivory coast", "CI"],
  ["united kingdom", "GB"],
  ["uk", "GB"],
  ["united states", "US"],
  ["usa", "US"],
  ["uae", "AE"],
  ["dubai", "AE"],
  ["india", "IN"],
];

const REGIONS: Readonly<Record<string, readonly string[]>> = {
  "west africa": ["NG", "GH", "SN", "CI"],
  "east africa": ["KE", "UG", "TZ", "RW", "ET"],
  "north africa": ["EG", "MA"],
};

function amount(value: string, unit: string | undefined): number {
  const n = Number(value.replace(/,/g, ""));
  const u = (unit ?? "").toLowerCase();
  return u === "m" || u === "mn" || u === "million"
    ? n * 1_000_000
    : u === "k"
      ? n * 1_000
      : n;
}

function money(n: number): string {
  return n >= 1_000_000
    ? `$${n / 1_000_000}M`
    : n >= 1_000
      ? `$${n / 1_000}k`
      : `$${n}`;
}

/**
 * The investor's description as visible chips and Discover filters. Pure and
 * deterministic: no model decides who appears. Revenue is shown back but
 * cannot be checked from what companies share, and the chip says so.
 */
export function parseStartupDescription(
  text: string,
  sectors: readonly { readonly nodeId: string; readonly label: string }[] = [],
): StartupQuery {
  const lower = ` ${text.toLowerCase()} `;
  const chips: StartupQueryChip[] = [];
  const stageCodes: string[] = [];
  for (const [pattern, code, label] of STAGES) {
    if (pattern.test(text)) {
      stageCodes.push(code);
      chips.push({ dimension: "stage", label, checkable: true });
    }
  }

  const sectorNodeIds: string[] = [];
  for (const sector of sectors) {
    const label = sector.label.toLowerCase();
    if (
      label.length >= 3 &&
      new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(
        lower,
      )
    ) {
      sectorNodeIds.push(sector.nodeId);
      chips.push({ dimension: "sector", label: sector.label, checkable: true });
    }
  }
  const words: string[] = [];
  if (sectorNodeIds.length === 0) {
    for (const word of [
      "fintech",
      "health",
      "agritech",
      "agriculture",
      "climate",
      "energy",
      "logistics",
      "education",
      "commerce",
      "payments",
      "insurance",
      "software",
    ]) {
      if (lower.includes(word)) {
        words.push(word);
        chips.push({
          dimension: "sector",
          label: word[0]?.toUpperCase() + word.slice(1),
          checkable: true,
        });
      }
    }
  }

  const countryCodes = new Set<string>();
  const places: string[] = [];
  for (const [region, codes] of Object.entries(REGIONS)) {
    if (lower.includes(region)) {
      codes.forEach((code) => countryCodes.add(code));
      places.push(region.replace(/\b\w/g, (c) => c.toUpperCase()));
    }
  }
  for (const [name, code] of COUNTRIES) {
    if (
      new RegExp(`[^a-z]${name}[^a-z]`).test(lower) &&
      !countryCodes.has(code)
    ) {
      countryCodes.add(code);
      places.push(
        name.length <= 3
          ? name.toUpperCase()
          : name.replace(/\b\w/g, (c) => c.toUpperCase()),
      );
    }
  }
  if (places.length > 0) {
    chips.push({
      dimension: "country",
      label: places.join(" or "),
      checkable: true,
    });
  }

  let raise: DiscoverFilters["raise"] = null;
  const raiseMatch =
    /rais\w*\s+(under|below|less than|up to|over|above|more than|at least)\s+\$?\s?([\d.,]+)\s?(k|m|mn|million)?/i.exec(
      text,
    );
  if (raiseMatch !== null) {
    const value = amount(raiseMatch[2] ?? "0", raiseMatch[3]);
    const upper = /under|below|less|up to/i.test(raiseMatch[1] ?? "");
    raise = upper
      ? { max: String(Math.round(value)), currency: "USD" }
      : { min: String(Math.round(value)), currency: "USD" };
    chips.push({
      dimension: "raise",
      label: `Raising ${upper ? "under" : "over"} ${money(value)}`,
      checkable: true,
    });
  }

  const revenue =
    /(?:at least|over|more than|above)?\s*\$?\s?([\d.,]+)\s?(k|m)?\+?\s*(?:a |per )?(?:month(?:ly)?|mrr)\s*(?:revenue)?/i.exec(
      text,
    );
  if (revenue !== null && /revenue|mrr/i.test(text)) {
    chips.push({
      dimension: "revenue",
      label: `Revenue ${money(amount(revenue[1] ?? "0", revenue[2]))}+ a month`,
      checkable: false,
    });
  }

  return {
    chips,
    words,
    filters: {
      sectorNodeIds,
      stageCodes,
      countryCodes: [...countryCodes],
      raise,
      raiseDisclosedOnly: false,
      verifiedOnly: false,
      hasPitch: false,
    },
  };
}

/** What a saved alert asked for, as stored (filters plus loose words). */
export type StoredAlertFilters = {
  readonly sectorNodeIds?: readonly string[] | undefined;
  readonly stageCodes?: readonly string[] | undefined;
  readonly countryCodes?: readonly string[] | undefined;
  readonly raise?: unknown;
  readonly raiseDisclosedOnly?: boolean | undefined;
  readonly words?: readonly string[] | undefined;
};

/** The company as the network sees it: declared, network-level facts only. */
export type AlertCompanyFacts = {
  readonly name: string;
  readonly description: string | null;
  readonly stageCode: string | null;
  readonly countryCode: string | null;
  /** Its sector nodes and every ancestor of them. */
  readonly sectorNodeIds: readonly string[];
};

/**
 * P14: does a newly ready company match a saved alert? Deterministic, over
 * network-level facts only. An alert that asks about the raise is never
 * matched here: whether this investor may see a raise is the disclosure
 * evaluator's to say, so it waits for Discover (a skipped match, never a
 * guess). Unknown is not a match: a company with no stage never matches a
 * stage filter. An alert with nothing to match on matches nothing.
 */
export function alertMatches(
  filters: StoredAlertFilters,
  company: AlertCompanyFacts,
): boolean {
  if (filters.raise !== null && filters.raise !== undefined) return false;
  if (filters.raiseDisclosedOnly === true) return false;
  const stages = filters.stageCodes ?? [];
  const countries = filters.countryCodes ?? [];
  const sectors = filters.sectorNodeIds ?? [];
  const words = (filters.words ?? [])
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word.length >= 3);
  if (
    stages.length === 0 &&
    countries.length === 0 &&
    sectors.length === 0 &&
    words.length === 0
  ) {
    return false;
  }
  if (
    stages.length > 0 &&
    (company.stageCode === null || !stages.includes(company.stageCode))
  ) {
    return false;
  }
  if (
    countries.length > 0 &&
    (company.countryCode === null || !countries.includes(company.countryCode))
  ) {
    return false;
  }
  if (
    sectors.length > 0 &&
    !sectors.some((id) => company.sectorNodeIds.includes(id))
  ) {
    return false;
  }
  if (words.length > 0) {
    const text = `${company.name} ${company.description ?? ""}`.toLowerCase();
    if (!words.some((word) => text.includes(word))) return false;
  }
  return true;
}
