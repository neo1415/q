import "server-only";

import {
  getCompanyNetworkPreview,
  getFitCompare,
  getFitProfiles,
  getFitTop,
  listInvestorMandates,
  listPassedCompanies,
  listSavedCompanies,
} from "@capital-q/api-client";
import {
  FIT_IDS_MAX,
  FitCompareQuerySchema,
  type CompanyNetworkPreview,
  type FitBand,
  type FitComparisonDto,
  type FitProfileDto,
} from "@capital-q/contracts";

import { countryLabel, stageLabel } from "@/features/company/declared-labels";
import { compareByFit } from "@/features/fit/fit-words";
import {
  apiSession,
  qApiSession,
  resolveOwnContext,
} from "@/features/q/context";

/**
 * Saved, Passed and Compare in one place (app prototype "shortlist",
 * option 1): the investor's own interaction state, each company read back
 * through the ordinary company path (which re-checks disclosure, so one no
 * longer discoverable is simply absent), its fit with the investor's own
 * mandate from the Q API, and the top three as the fit model orders them.
 * Q does not choose: the order is the fit model's, and nothing watched or
 * skipped changes it. Every read is under the investor's own session.
 */

export type ShortlistRow = {
  readonly companyId: string;
  readonly name: string;
  readonly description: string | null;
  /** "Seed · Kenya"; null when nothing is declared. */
  readonly facts: string | null;
  /** Fit with the reader's mandate; null when it could not be read. */
  readonly band: FitBand | null;
};

export type TopState =
  | { readonly kind: "READY"; readonly comparison: FitComparisonDto }
  | { readonly kind: "NO_MANDATE" }
  | { readonly kind: "ERROR" };

export type Shortlist = {
  /** Null: the list could not be read (never "nothing saved"). */
  readonly saved: readonly ShortlistRow[] | null;
  readonly passed: readonly ShortlistRow[] | null;
  readonly top: TopState;
  /** The picked companies, when the address names 2 to 4 valid ids. */
  readonly picked: FitComparisonDto | null;
  readonly pickedAsked: boolean;
};

function row(
  company: CompanyNetworkPreview,
  profile: FitProfileDto | null,
): ShortlistRow {
  const facts = [
    stageLabel(company.currentStageCode),
    countryLabel(company.headquartersCountry),
  ].filter((part): part is string => part !== null);
  return {
    companyId: company.companyId,
    name: company.canonicalName,
    description: company.shortDescription,
    facts: facts.length === 0 ? null : facts.join(" · "),
    band: profile?.band ?? null,
  };
}

export async function loadShortlist(compareIds?: string): Promise<Shortlist> {
  const [session, q, context] = await Promise.all([
    apiSession(),
    qApiSession(),
    resolveOwnContext(),
  ]);
  const query =
    compareIds === undefined
      ? null
      : FitCompareQuerySchema.safeParse({ ids: compareIds });
  const [savedIds, passedIds, top, picked] = await Promise.all([
    session === null
      ? Promise.resolve(null)
      : listSavedCompanies(session)
          .then((list) => list.companyIds)
          .catch(() => null),
    session === null
      ? Promise.resolve(null)
      : listPassedCompanies(session)
          .then((list) => list.companyIds)
          .catch(() => null),
    topState(
      q,
      context.kind === "INVESTOR" ? context.investorOrganisationId : null,
    ),
    query === null || !query.success || q === null
      ? Promise.resolve(null)
      : getFitCompare(q, query.data.ids).catch(() => null),
  ]);
  const ids = [...new Set([...(savedIds ?? []), ...(passedIds ?? [])])];
  const [previews, fits] = await Promise.all([
    session === null
      ? Promise.resolve(new Map<string, CompanyNetworkPreview>())
      : Promise.all(
          ids.map((id) =>
            getCompanyNetworkPreview(session, id).catch(() => null),
          ),
        ).then(
          (found) =>
            new Map(
              found
                .filter((company) => company !== null)
                .map((company) => [company.companyId, company]),
            ),
        ),
    q === null || (savedIds ?? []).length === 0
      ? Promise.resolve(new Map<string, FitProfileDto>())
      : getFitProfiles(q, (savedIds ?? []).slice(0, FIT_IDS_MAX))
          .then(
            (found) =>
              new Map(
                found.items.map((item) => [item.companyId, item.profile]),
              ),
          )
          .catch(() => new Map<string, FitProfileDto>()),
  ]);
  const rows = (list: readonly string[] | null) =>
    list === null
      ? null
      : list.flatMap((id) => {
          const company = previews.get(id);
          return company === undefined
            ? []
            : [row(company, fits.get(id) ?? null)];
        });
  const saved = rows(savedIds);
  return {
    // Best fit first: band, then confidence, then strong parameters; a
    // company without a fit goes last, never hidden (fit-words.ts).
    saved:
      saved === null
        ? null
        : [...saved].sort((a, b) =>
            compareByFit(
              fits.get(a.companyId) ?? null,
              fits.get(b.companyId) ?? null,
            ),
          ),
    passed: rows(passedIds),
    top,
    picked,
    pickedAsked: query !== null,
  };
}

async function topState(
  q: Awaited<ReturnType<typeof qApiSession>>,
  investorOrganisationId: string | null,
): Promise<TopState> {
  if (q === null) return { kind: "ERROR" };
  try {
    const comparison = await getFitTop(q, 3);
    if (
      comparison.considered === 0 &&
      investorOrganisationId !== null &&
      (await hasNoActiveMandate(investorOrganisationId))
    ) {
      return { kind: "NO_MANDATE" };
    }
    return { kind: "READY", comparison };
  } catch {
    return { kind: "ERROR" };
  }
}

async function hasNoActiveMandate(
  investorOrganisationId: string,
): Promise<boolean> {
  const session = await apiSession();
  if (session === null) return false;
  try {
    const mandates = await listInvestorMandates(
      session,
      investorOrganisationId,
      { status: "ACTIVE", limit: 1 },
    );
    return mandates.items.length === 0;
  } catch {
    return false;
  }
}
