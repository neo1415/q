import { z } from "zod";

import { UuidSchema, type CompanyRaiseView } from "@capital-q/contracts";
import { actorPrincipal } from "@capital-q/permissions";
import type { QToolExecutionContext } from "@capital-q/q-runtime";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import { actorWideScope } from "../plan.js";
import type { QToolPorts } from "../ports.js";

/**
 * DISCOVER_COMPANIES — `discovery.companies` v1 (founder brief K1,
 * 2026-10-09).
 *
 * "Show me three fintech companies" is a catalog question: which companies
 * on the network are in a sector, a country or a stage. Live (15:57 UTC)
 * it fell to the analyst, which answered with mandate prose and no cards.
 * This reads the declared taxonomy (confirmed assignments only, never an
 * unconfirmed Q inference that may come from a founder's private
 * material), in name order, and decides every candidate through the
 * Permissions context before it is returned: only a NETWORK_VISIBLE or
 * PUBLIC_EXTERNAL disclosure lets one through (ADR-001). It never ranks
 * by itself: with order FIT, every match (up to CATALOG_FIT_SCAN_MAX) is
 * scored by the fit service on the investor's mandate and the first
 * `limit` come back in that deterministic order (owner 2026-10-23: never
 * the first companies by name, then ranked).
 */

export const DISCOVER_COMPANIES = "discovery.companies" as const;

const LIMIT_MAX = 24;
const FILTER_MAX = 8;
/**
 * How many matches a FIT order scores (the fit service's own rank bound).
 * F-82: the whole network (463 live), never the first 200 by name.
 */
export const CATALOG_FIT_SCAN_MAX = 1000;
/** The most of the slate one unscoped fit ask reads (the answer shows <= 10). */
const SLATE_TOP_MAX = 10;
/** The Permissions context's own bound per evaluateMany (DISCLOSURE_BATCH_MAX). */
const DISCLOSURE_BATCH = 200;

export const DiscoverCompaniesInputSchema = z
  .object({
    sectors: z
      .array(z.string().trim().min(1).max(64))
      .max(FILTER_MAX)
      .default([])
      .describe(
        "Sector taxonomy codes, lower_snake_case (fintech, payments, insurtech, digital_health, clean_energy, agritech, edtech, ...). A sector includes its sub-sectors. Empty for any sector.",
      ),
    countries: z
      .array(z.string().regex(/^[A-Za-z]{2}$/u))
      .max(FILTER_MAX)
      .default([])
      .describe("ISO 3166-1 alpha-2 head-office countries. Empty for any."),
    stages: z
      .array(
        z
          .string()
          .regex(/^[a-z][a-z0-9_]*$/u)
          .max(64),
      )
      .max(FILTER_MAX)
      .default([])
      .describe("Company stage codes (pre_seed, seed, series_a, ...)."),
    limit: z.number().int().min(1).max(LIMIT_MAX).default(10),
    order: z
      .enum(["NAME", "FIT"])
      .default("NAME")
      .describe(
        "NAME: in name order. FIT: every match scored on the investor's own mandate and returned best first (an investor only; otherwise name order).",
      ),
    raising: z
      .boolean()
      .default(false)
      .describe(
        "true when they ask for companies raising now: only companies stating a current raise this reader may see are returned.",
      ),
  })
  .strict();
export type DiscoverCompaniesInput = z.input<
  typeof DiscoverCompaniesInputSchema
>;

export const DiscoverCompaniesOutputSchema = z
  .object({
    companies: z
      .array(
        z
          .object({
            companyId: UuidSchema,
            name: z.string(),
            stageCode: z.string().nullable(),
            headquartersCountry: z.string().nullable(),
            shortDescription: z.string().nullable(),
            sectors: z.array(z.string()).max(FILTER_MAX),
          })
          .strict(),
      )
      .max(LIMIT_MAX),
    /** The order the list is in, said to the person as the basis. */
    order: z.enum(["NAME", "FIT"]),
    /**
     * SLATE: an unscoped FIT ask answered from the investor's precomputed
     * Discover ranking (owner 2026-10-24), not ranked here. Absent: the
     * catalog's own matches.
     */
    basis: z.literal("SLATE").optional(),
    /**
     * How many companies matched and may be seen, when counted (FIT reads
     * them all); `totalAtLeast` when the scan's bound was reached.
     */
    total: z.number().int().min(0).optional(),
    totalAtLeast: z.boolean().optional(),
    /**
     * Asked for companies raising now: APPLIED when only companies stating
     * a current raise were kept (`matched` is how many matched before
     * that); UNAVAILABLE when raises could not be read, so nothing was
     * kept or dropped for it. A company with no raise on record is not
     * "not raising": it is unknown, and only left out of this list.
     */
    raising: z
      .object({
        filter: z.enum(["APPLIED", "UNAVAILABLE"]),
        matched: z.number().int().min(0),
      })
      .strict()
      .optional(),
    sectors: z
      .array(z.object({ code: z.string(), name: z.string() }).strict())
      .max(FILTER_MAX),
    unknownSectors: z.array(z.string()).max(FILTER_MAX),
    /**
     * FIT was asked for and the fit service failed (it threw): the list is
     * in name order and must never be presented as a ranking. The cause is
     * the error's class name only, for the log.
     */
    fitRankFailed: z
      .object({ cause: z.string().min(1).max(80) })
      .strict()
      .optional(),
    /** Declared profiles, not an assessment and not a recommendation. */
    truthClass: z.literal("USER_CLAIM"),
  })
  .strict();
export type DiscoverCompaniesOutput = z.infer<
  typeof DiscoverCompaniesOutputSchema
>;

/** The raise reader's own batch bound (RAISE_BATCH_MAX). */
const RAISE_BATCH = 50;

/**
 * Every company's raise as this reader may see it, read in the raise
 * reader's batches; null when it cannot be read (absent or failed), so no
 * company is kept or dropped for a raise nobody could read.
 */
async function raisesOf(
  ports: QToolPorts,
  actor: QToolExecutionContext["actor"],
  companyIds: readonly string[],
): Promise<ReadonlyMap<string, CompanyRaiseView> | null> {
  const reader = ports.companyRaise;
  if (reader === undefined) return null;
  const all = new Map<string, CompanyRaiseView>();
  try {
    for (let at = 0; at < companyIds.length; at += RAISE_BATCH) {
      const batch = await reader.raisesFor(
        actor,
        companyIds.slice(at, at + RAISE_BATCH),
      );
      for (const [id, view] of batch) all.set(id, view);
    }
  } catch {
    return null;
  }
  return all;
}

export function createDiscoverCompaniesTool(
  ports: QToolPorts,
): AnyQToolDefinition {
  return defineQTool<
    z.output<typeof DiscoverCompaniesInputSchema>,
    DiscoverCompaniesOutput,
    null
  >({
    id: DISCOVER_COMPANIES,
    version: 1,
    status: "ACTIVE",
    providerName: "discover_companies",
    description:
      'Lists the companies on Capital Q in a sector (taxonomy code, sub-sectors included), head-office country or stage, from their declared profiles. Call it when the person asks to see companies of a kind ("three fintech companies in Nigeria"). For an investor pass order FIT: every match is scored on their own mandate and the best come first; order NAME lists them by name. Use fit_profile on the ids it returns for the fit detail of each.',
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    requiredCapabilities: [],
    supportedPurposes: [
      "OWN_COMPANY_QUESTION",
      "COUNTERPARTY_COMPANY_QUESTION",
      "INVESTOR_QUESTION",
      "RELATIONSHIP_QUESTION",
      "COMPARISON",
      "GENERAL_QUESTION",
    ],
    requiredScopeKinds: ["NETWORK_VISIBLE_DATA"],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: "COMPARING_OPPORTUNITIES",
    input: DiscoverCompaniesInputSchema,
    output: DiscoverCompaniesOutputSchema,
    authorize: (_input, context) => {
      const network = actorWideScope(context.plan, "NETWORK_VISIBLE_DATA");
      return Promise.resolve(
        network === undefined || ports.companyCatalog === undefined
          ? deny<null>("NOT_AVAILABLE")
          : allow<null>(network.sensitivity, null),
      );
    },
    execute: async (input, context) => {
      const catalog = ports.companyCatalog;
      if (catalog === undefined) {
        return {
          companies: [],
          order: "NAME" as const,
          sectors: [],
          unknownSectors: [],
          truthClass: "USER_CLAIM" as const,
        };
      }
      // Owner 2026-10-24 (egress incident): an investor's unscoped "best
      // fit" is the precomputed slate's ranking (doc 19: precomputed
      // slates plus a read projection), the same ranking Discover shows:
      // a short page of it, nothing ranked here. The whole-network rank
      // below is the fallback when they have no servable slate (the
      // reader asks for a rebuild then).
      const unscoped =
        input.sectors.length === 0 &&
        input.countries.length === 0 &&
        input.stages.length === 0 &&
        !input.raising;
      const slate =
        input.order === "FIT" && unscoped && ports.investorFeed !== undefined
          ? await ports.investorFeed
              .page(context.actor, Math.min(input.limit, SLATE_TOP_MAX))
              .catch(() => null)
          : null;
      const fromSlate = slate !== null && slate.items.length > 0;
      const byFit =
        !fromSlate && input.order === "FIT" && ports.fit?.rank !== undefined;
      const found = fromSlate
        ? {
            candidates: slate.items.map((item) => ({
              companyId: item.companyId,
              name: item.name,
              stageCode: item.stageCode,
              headquartersCountry: item.headquartersCountry,
              shortDescription: item.shortDescription,
              // As the catalog does for an unscoped ask: no sector asked.
              sectors: [],
            })),
            sectors: [],
            unknownSectors: [],
          }
        : await catalog.find(context.actor, {
            sectors: input.sectors,
            countries: input.countries.map((code) => code.toUpperCase()),
            stages: input.stages,
            // FIT reads every match it may score; NAME leaves room for the
            // candidates disclosure turns away. Both bounded.
            limit:
              byFit || input.raising
                ? CATALOG_FIT_SCAN_MAX
                : Math.min(input.limit * 3, 60),
          });
      // F-82 (live 2026-10-24): disclosure decides at most
      // DISCLOSURE_BATCH more per call and throws past it; a scan of the
      // whole network is decided in batches, in order.
      const decisions: Awaited<
        ReturnType<typeof ports.disclosure.evaluateMany>
      >[number][] = [];
      for (
        let start = 0;
        start < found.candidates.length;
        start += DISCLOSURE_BATCH
      ) {
        decisions.push(
          ...(await ports.disclosure.evaluateMany(
            found.candidates
              .slice(start, start + DISCLOSURE_BATCH)
              .map((candidate) => ({
                principal: actorPrincipal(context.actor),
                resource: { type: "company" as const, id: candidate.companyId },
                requestedAccess: "view" as const,
              })),
          )),
        );
      }
      const seen = new Set<string>();
      const visible = found.candidates.filter((candidate, index) => {
        const decision = decisions[index];
        if (
          decision === undefined ||
          decision.outcome !== "ALLOW" ||
          (decision.reasonCode !== "NETWORK_VISIBLE" &&
            decision.reasonCode !== "PUBLIC_EXTERNAL") ||
          seen.has(candidate.companyId)
        ) {
          return false;
        }
        seen.add(candidate.companyId);
        return true;
      });
      // FIT: every visible match scored on their mandate, best first. A
      // reader who is not an investor, or has no mandate, gets name order.
      // Raising now: every visible match's raise, read as this reader may
      // see it (the card's own raise read), before any cut.
      const raises =
        input.raising && visible.length > 0
          ? await raisesOf(
              ports,
              context.actor,
              visible.map((candidate) => candidate.companyId),
            )
          : null;
      const raisingFilter = !input.raising
        ? null
        : raises === null
          ? ("UNAVAILABLE" as const)
          : ("APPLIED" as const);
      const eligible =
        raises === null
          ? visible
          : visible.filter((candidate) => {
              const view = raises.get(candidate.companyId);
              return (
                view !== undefined &&
                view.source !== "NONE" &&
                view.money !== null &&
                Number(view.money.amount) > 0
              );
            });
      // Owner 2026-10-24 (live bbb4b6773): a fit service that throws is
      // tried once more here (the run keeps this tool's result, so a retry
      // from the answer would read the same failure); a second failure is
      // said in the output with its cause, never hidden as name order.
      const rankFailure: { cause: string | null } = { cause: null };
      const rankOnce = async () => {
        rankFailure.cause = null;
        return (
          (await ports.fit
            ?.rank?.(
              context.actor,
              eligible.map((candidate) => candidate.companyId),
              input.limit,
            )
            .catch((error: unknown) => {
              rankFailure.cause = (
                error instanceof Error ? error.name : "UNKNOWN"
              ).slice(0, 80);
              return null;
            })) ?? null
        );
      };
      const first = byFit && eligible.length > 0 ? await rankOnce() : null;
      const ranked =
        first === null && rankFailure.cause !== null ? await rankOnce() : first;
      const order =
        ranked?.kind === "OK"
          ? ranked.comparison.entries.flatMap((entry) => {
              const one = eligible.find((c) => c.companyId === entry.companyId);
              return one === undefined ? [] : [one];
            })
          : null;
      // The slate is already best first, by the feed's ranking.
      const ordered = fromSlate ? eligible : order;
      const companies = (ordered ?? eligible)
        .slice(0, input.limit)
        .map((candidate) => ({
          companyId: candidate.companyId,
          name: candidate.name,
          stageCode: candidate.stageCode,
          headquartersCountry: candidate.headquartersCountry,
          shortDescription: candidate.shortDescription,
          sectors: candidate.sectors.slice(0, FILTER_MAX),
        }));
      return {
        companies,
        order: ordered === null ? ("NAME" as const) : ("FIT" as const),
        ...(fromSlate ? { basis: "SLATE" as const } : {}),
        ...(fromSlate
          ? {
              // How many they may discover, as the feed counts them.
              total: Math.max(slate.discoverableCount ?? 0, eligible.length),
              totalAtLeast: false,
            }
          : order === null && raisingFilter !== "APPLIED"
            ? {}
            : {
                total: eligible.length,
                totalAtLeast: found.candidates.length >= CATALOG_FIT_SCAN_MAX,
              }),
        ...(raisingFilter === null
          ? {}
          : { raising: { filter: raisingFilter, matched: visible.length } }),
        sectors: found.sectors.slice(0, FILTER_MAX).map((sector) => ({
          code: sector.code,
          name: sector.name,
        })),
        unknownSectors: found.unknownSectors.slice(0, FILTER_MAX),
        ...(rankFailure.cause === null
          ? {}
          : { fitRankFailed: { cause: rankFailure.cause } }),
        truthClass: "USER_CLAIM" as const,
      };
    },
  });
}
