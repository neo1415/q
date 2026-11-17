import { z } from "zod";

import type { DatabaseExecutor } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import type {
  EligibilityPorts,
  MandateHardConstraint,
  MandateTaxonomyRule,
} from "../eligibility/ports.js";
import { DECLARED_TAXONOMY_SOURCES } from "../eligibility/policy.js";
import type { DeclaredFitFacts, FitFeatureSource } from "../fit/observe.js";
import type { FitCompanyInputs, FitInputSource } from "../fit/service.js";
import type { FitStatedEvidence } from "../fit/stated.js";
import type { FxReferenceRates } from "../fx/ecb.js";
import { scoredMandateSimilarityFeature } from "../features/policy.js";
import type { SemanticProvenance } from "../semantic/contracts.js";
import type { FilterMoney } from "../slates/filters.js";

import { readCurrentFeatureSnapshots } from "./postgres-feature-snapshot-store.js";

/**
 * The fit model's inputs, read from what already exists (B1; ADR 0052):
 *
 *   snapshot   the CURRENT feature snapshot the slate builder persisted for
 *              this (investor organisation, mandate, company) — stage,
 *              geography, sector, thesis similarity; one indexed read each
 *   mandate    the investor's own ACTIVE mandate: stage range, typical
 *              cheque, lead / co-invest / follow, business attributes
 *   company    canonical stage and headquarters (eligibility's facts), the
 *              company's name, and its raise ONLY where disclosure lets
 *              this reader see it (the app's `raises` port)
 *
 * The fit service calls this only for companies eligibility already
 * admitted for this actor. Nothing here is a model, a behaviour signal or
 * a private founder field; what has no source today (traction, team,
 * round terms) is simply absent, which the model reads as unknown — never
 * as a mismatch. The company's business model is its own declared
 * taxonomy (founder-confirmed categories on its network profile).
 */

export type FitInputSourceDependencies = {
  readonly sql: DatabaseExecutor;
  readonly eligibilityPorts: Pick<EligibilityPorts, "mandates" | "companies">;
  /** Names (and the one-liner) the reader may see; ids the reader may not see are absent. */
  readonly identities: (
    companyIds: readonly string[],
    /** lines false: names only, no profile read (a ranking). */
    options?: { readonly lines: boolean },
  ) => Promise<
    ReadonlyMap<
      string,
      { readonly name: string; readonly shortDescription: string | null }
    >
  >;
  /** The current raise, only where disclosure allows THIS reader. */
  readonly raises?:
    | ((
        actor: ActorContext,
        companyIds: readonly string[],
      ) => Promise<ReadonlyMap<string, FilterMoney>>)
    | undefined;
  /**
   * What each company STATED where this reader may see it (a pitch they
   * may play, the deck sections confirmed for investors): context beside
   * the fit and evidence for Q's view, never scored (fit/stated.ts).
   */
  readonly stated?:
    | ((
        actor: ActorContext,
        companyIds: readonly string[],
      ) => Promise<ReadonlyMap<string, FitStatedEvidence>>)
    | undefined;
  /**
   * Owner 23 Oct 2026: the current exchange rate sets (stored, or fetched
   * from the internet when none is current; fx/live.ts), so a round in
   * another currency than the cheque is compared as an estimate.
   */
  readonly fxRates?:
    | (() => Promise<FxReferenceRates | readonly FxReferenceRates[] | null>)
    | undefined;
  /**
   * Live e11 (2026-10-29): the declared-fit features for companies the
   * ranker never made a snapshot for (FeatureService.computeForView), so
   * a profile reads the stage and place on record instead of "Unknown".
   * Read-only, never persisted. Absent: such a company stays unknown.
   */
  readonly viewFeatures?:
    | ((input: {
        readonly actor: ActorContext;
        readonly mandateId: string;
        readonly companyIds: readonly string[];
      }) => Promise<ReadonlyMap<string, FitFeatureSource>>)
    | undefined;
  /**
   * Live 17 Nov 2026 (Zino): REC-003's mandate similarity for exactly the
   * given companies (SemanticCandidateService.scoreCompanies: the same
   * cosine, model, configuration and dimension guards, CURRENT and
   * discoverable vectors only; read-only, never embeds). Keyed by
   * lower-case company id; a company absent from the map stays unknown.
   * Absent: such a snapshot's thesis stays as persisted.
   */
  readonly mandateSimilarities?:
    | ((input: {
        readonly actor: ActorContext;
        readonly mandateId: string;
        readonly companyIds: readonly string[];
      }) => Promise<ReadonlyMap<string, SemanticProvenance>>)
    | undefined;
};

const SIMILARITY_FEATURE = "semantic_fit.mandate_similarity";
const TAXONOMY_FEATURE = "declared_fit.taxonomy";

/**
 * A snapshot persisted before the thesis was scored outside top-K (before
 * semantic-mandate.v2): its similarity is MISSING with
 * SEMANTIC_NOT_RETRIEVED although both vectors may exist. Under v2 the
 * builder scores every admitted candidate, so a v2 snapshot names this
 * only when a vector was missing at build time; asking again is one
 * bounded read and finds a vector that has since been made.
 */
function thesisNotScored(source: FitFeatureSource | undefined): boolean {
  const f = source?.features.find((v) => v.featureId === SIMILARITY_FEATURE);
  return (
    f !== undefined &&
    f.status === "MISSING" &&
    f.missingReason === "SEMANTIC_NOT_RETRIEVED"
  );
}

/**
 * A snapshot persisted before the sector overlap was kept on a MISSING
 * category (5b4bd13a2): the category is unknown and no `sectorOverlap` was
 * recorded, so the fit read "Sector not set" for a company that declares
 * one. (A mandate that names no sector also records none; recomputing it
 * gives the same answer.)
 */
function sectorNotRecorded(source: FitFeatureSource | undefined): boolean {
  const f = source?.features.find((v) => v.featureId === TAXONOMY_FEATURE);
  return (
    f !== undefined &&
    f.status === "MISSING" &&
    f.missingReason === "COMPANY_TAXONOMY_UNKNOWN" &&
    f.provenance["sectorOverlap"] === undefined
  );
}

/** The source with one feature value replaced; never persisted. */
function withFeature(
  source: FitFeatureSource,
  value: FitFeatureSource["features"][number],
): FitFeatureSource {
  return {
    features: source.features.map((f) =>
      f.featureId === value.featureId ? value : f,
    ),
  };
}

/**
 * At most this many companies of one read are computed on read: a profile,
 * a comparison or the companies a list shows, never a rank over the
 * network (that one reads the persisted snapshots only).
 */
export const FIT_VIEW_FEATURES_MAX = 24;

const MODE = "INVESTOR_DISCOVER";

export function createFitInputSource(
  dependencies: FitInputSourceDependencies,
): FitInputSource {
  return {
    read: async (query) => {
      const ids = [...query.companyIds];
      const [
        mandate,
        facts,
        identities,
        raises,
        persisted,
        models,
        stated,
        fx,
      ] = await Promise.all([
        dependencies.eligibilityPorts.mandates.activeMandate({
          tenantId: query.actor.tenantId,
          investorOrganisationId: query.investorOrganisationId,
          mandateId: query.mandateId,
        }),
        dependencies.eligibilityPorts.companies.findMany(ids),
        // A ranking needs names, not the one-liner each card shows.
        dependencies.identities(ids, { lines: query.purpose !== "RANK" }),
        dependencies.raises === undefined
          ? Promise.resolve(new Map<string, FilterMoney>())
          : dependencies
              .raises(query.actor, ids)
              .catch(() => new Map<string, FilterMoney>()),
        // One query for all of them (owner 2026-10-24, egress incident).
        readCurrentFeatureSnapshots(dependencies.sql, {
          investorOrganisationId: query.investorOrganisationId,
          mandateId: query.mandateId,
          companyIds: ids,
          mode: MODE,
        }),
        businessModelsOf(dependencies.sql, ids, query.mandateId).catch(
          () => EMPTY_MODELS,
        ),
        // What they stated is context for Q's view, never scored: a
        // ranking does not read it (owner 2026-10-24, egress incident).
        dependencies.stated === undefined || query.purpose === "RANK"
          ? Promise.resolve(new Map<string, FitStatedEvidence>())
          : dependencies
              .stated(query.actor, ids)
              .catch(() => new Map<string, FitStatedEvidence>()),
        dependencies.fxRates === undefined
          ? Promise.resolve(null)
          : dependencies.fxRates().catch(() => null),
      ]);
      const unscored = ids.filter((id) => !persisted.has(id));
      const read: ReadonlyMap<string, FitFeatureSource> =
        dependencies.viewFeatures === undefined ||
        query.purpose === "RANK" ||
        unscored.length === 0 ||
        unscored.length > FIT_VIEW_FEATURES_MAX
          ? persisted
          : new Map([
              ...(await dependencies
                .viewFeatures({
                  actor: query.actor,
                  mandateId: query.mandateId,
                  companyIds: unscored,
                })
                // A failed read is what it was before: unknown.
                .catch(() => new Map<string, FitFeatureSource>())),
              ...persisted,
            ]);
      const snapshots = await refreshStale(dependencies, query, read);
      const fromMandate =
        mandate.kind === "FOUND" ? mandateFacts(mandate.mandate) : {};
      // The mandate's business-model taxonomy preferences (b2b_saas, …) are
      // what the investor declared; business attributes stay a fallback.
      const declaredMandate: DeclaredFitFacts =
        models.preferred.length + models.avoided.length > 0
          ? {
              ...fromMandate,
              businessModelPreferences: {
                preferred: models.preferred,
                avoided: models.avoided,
              },
            }
          : fromMandate;
      const factsById = new Map(facts.map((f) => [f.companyId, f] as const));

      const out = new Map<string, FitCompanyInputs>();
      ids.forEach((companyId) => {
        const identity = identities.get(companyId);
        if (identity === undefined) return;
        const company = factsById.get(companyId);
        const raise = raises.get(companyId);
        const said = stated.get(companyId) ?? null;
        const stage = stageLabel(company?.currentStageCode ?? null);
        const place = countryName(company?.headquartersCountry ?? null);
        const declared: DeclaredFitFacts = {
          ...declaredMandate,
          businessModel: pickModel(
            models.byCompany.get(companyId) ?? [],
            declaredMandate.businessModelPreferences ?? null,
          ),
          companyStage: stage,
          companyPlace: place,
          statedRound: said?.statedRound ?? null,
          round:
            raise !== undefined
              ? {
                  amount: raise.amount,
                  currency: raise.currency,
                  // A raise the founder declared on their capital objective.
                  evidenceStatus: "SELF_REPORTED",
                  source: "SHARED",
                }
              : said?.pitchMoney !== null && said?.pitchMoney !== undefined
                ? {
                    // Owner 23 Oct 2026: the raise said in a pitch this
                    // reader may play counts, recorded as from the pitch.
                    amount: said.pitchMoney.amount,
                    currency: said.pitchMoney.currency,
                    evidenceStatus: "SELF_REPORTED",
                    source: "PITCH",
                  }
                : null,
          fx,
        };
        out.set(companyId, {
          snapshot: snapshots.get(companyId) ?? null,
          declared,
          name: identity.name,
          line:
            [stage, place].filter((s) => s !== undefined).join(" · ") || null,
          // The company's own one line and its raise, each only as this
          // reader may see them (identities and raises are reader-scoped).
          about: identity.shortDescription,
          raise:
            raise === undefined
              ? null
              : { amount: raise.amount, currency: raise.currency },
          evidence: said?.evidence ?? [],
          evidenceConfidential: said?.confidential ?? false,
          ...(said?.raiseView === undefined
            ? {}
            : { raiseView: said.raiseView }),
        });
      });
      return out;
    },
  };
}

/**
 * Live 17 Nov 2026 (Zino): a slate rebuild rewrites only the companies in
 * the new pool, so a CURRENT snapshot for a company outside it (one the
 * investor is already in contact with) keeps what it said when it was
 * built. Rather than rebuild snapshots no slate needs, the two measures a
 * later fix changed are computed on read for exactly those companies, by
 * the same code, and never written:
 *
 *   THESIS  a similarity MISSING with SEMANTIC_NOT_RETRIEVED: REC-003's
 *           scoreCompanies, one bounded read (unknown when either vector
 *           is missing, never zero);
 *   SECTOR  a category MISSING with no recorded sector overlap: the
 *           declared features computed on read (computeForView), only the
 *           category is taken, at most FIT_VIEW_FEATURES_MAX companies.
 *
 * Both are read-only and keyed to this mandate; a failed read leaves the
 * snapshot as persisted (unknown), never worse.
 */
async function refreshStale(
  dependencies: FitInputSourceDependencies,
  query: {
    readonly actor: ActorContext;
    readonly mandateId: string;
  },
  read: ReadonlyMap<string, FitFeatureSource>,
): Promise<ReadonlyMap<string, FitFeatureSource>> {
  const thesisIds = [...read]
    .filter(([, source]) => thesisNotScored(source))
    .map(([id]) => id);
  const sectorIds = [...read]
    .filter(([, source]) => sectorNotRecorded(source))
    .map(([id]) => id)
    .slice(0, FIT_VIEW_FEATURES_MAX);
  const scoring = dependencies.mandateSimilarities;
  const viewing = dependencies.viewFeatures;
  if (
    (thesisIds.length === 0 || scoring === undefined) &&
    (sectorIds.length === 0 || viewing === undefined)
  ) {
    return read;
  }
  const [similarities, recomputed] = await Promise.all([
    thesisIds.length === 0 || scoring === undefined
      ? Promise.resolve(new Map<string, SemanticProvenance>())
      : scoring({
          actor: query.actor,
          mandateId: query.mandateId,
          companyIds: thesisIds,
        }).catch(() => new Map<string, SemanticProvenance>()),
    sectorIds.length === 0 || viewing === undefined
      ? Promise.resolve(new Map<string, FitFeatureSource>())
      : viewing({
          actor: query.actor,
          mandateId: query.mandateId,
          companyIds: sectorIds,
        }).catch(() => new Map<string, FitFeatureSource>()),
  ]);
  const out = new Map(read);
  for (const id of thesisIds) {
    const similarity = similarities.get(id.toLowerCase());
    const source = out.get(id);
    if (similarity === undefined || source === undefined) continue;
    out.set(
      id,
      withFeature(
        source,
        scoredMandateSimilarityFeature({
          sourceClass: "SEMANTIC_CANDIDATE_PROVENANCE",
          generatorVersion: similarity.generatorVersion,
          companyRepresentationVersion: similarity.companyRepresentationVersion,
          investorRepresentationVersion:
            similarity.investorRepresentationVersion,
          configurationVersion: similarity.configurationVersion,
          similarity: similarity.similarity,
        }),
      ),
    );
  }
  for (const id of sectorIds) {
    const category = recomputed
      .get(id)
      ?.features.find((f) => f.featureId === TAXONOMY_FEATURE);
    const source = out.get(id);
    if (category === undefined || source === undefined) continue;
    out.set(id, withFeature(source, category));
  }
  return out;
}

function mandateFacts(mandate: {
  readonly constraints: readonly MandateHardConstraint[];
  readonly taxonomyPreferences?: readonly MandateTaxonomyRule[] | undefined;
  readonly stage?:
    | {
        readonly minStageCode: string | null;
        readonly maxStageCode: string | null;
      }
    | undefined;
  readonly cheque?:
    | {
        readonly currency: string;
        readonly min?: string | undefined;
        readonly max?: string | undefined;
      }
    | null
    | undefined;
}): DeclaredFitFacts {
  const codes = (
    dimension: string,
    keep: (c: MandateHardConstraint) => boolean,
  ) =>
    mandate.constraints
      .filter((c) => c.dimension === dimension && keep(c))
      .flatMap((c) => (c.value.kind === "codes" ? [...c.value.values] : []));

  const typical = mandate.constraints.find(
    (c) => c.dimension === "cheque.typical" && c.value.kind === "amount",
  );
  // The declared range too (owner 23 Oct 2026): a mandate with a min and
  // max but no typical cheque is still a cheque size, in its own currency.
  const range = mandate.cheque ?? null;
  const typicalAmount =
    typical !== undefined && typical.value.kind === "amount"
      ? { currency: typical.value.currency, amount: typical.value.amount }
      : null;
  const currency = typicalAmount?.currency ?? range?.currency ?? null;
  const sameCurrency = range !== null && range.currency === currency;
  const cheque =
    currency === null
      ? null
      : {
          currency,
          ...(typicalAmount === null ? {} : { typical: typicalAmount.amount }),
          ...(sameCurrency && range.min !== undefined
            ? { min: range.min }
            : {}),
          ...(sameCurrency && range.max !== undefined
            ? { max: range.max }
            : {}),
        };

  const roles = new Set(
    codes(
      "investment_role",
      (c) => c.importance !== "AVOID" && !c.isHardExclusion,
    ),
  );
  const leadPolicy =
    roles.size === 0
      ? null
      : roles.has("lead")
        ? roles.size === 1
          ? ("ALWAYS" as const)
          : ("SOMETIMES" as const)
        : ("NEVER" as const);

  const preferred = codes(
    "business.attribute",
    (c) =>
      !c.isHardExclusion &&
      (c.importance === "MUST" ||
        c.importance === "STRONG" ||
        c.importance === "NICE"),
  );
  const avoided = codes("business.attribute", (c) => c.importance === "AVOID");

  const min = stageLabel(mandate.stage?.minStageCode ?? null);
  const max = stageLabel(mandate.stage?.maxStageCode ?? null);
  const mandateStages =
    min !== undefined && max !== undefined
      ? min === max
        ? min
        : `${min} to ${max}`
      : (min ?? max);

  // "Must match" as the investor declared it, on their own selection
  // only: a positive geography preference, or a stage rule at MUST.
  const mustGeography =
    (mandate.taxonomyPreferences ?? []).some(
      (p) =>
        p.vocabularyCode === "geography" &&
        p.preferenceStrength === "MUST" &&
        !p.isExclusion &&
        (DECLARED_TAXONOMY_SOURCES as readonly string[]).includes(p.source),
    ) ||
    mandate.constraints.some(
      (c) =>
        c.dimension === "geography.country" &&
        c.importance === "MUST" &&
        !c.isHardExclusion,
    );
  // The firmest positive geography the investor declared (fit-order.v3).
  const geographyStrengths = new Set(
    (mandate.taxonomyPreferences ?? [])
      .filter(
        (p) =>
          p.vocabularyCode === "geography" &&
          !p.isExclusion &&
          (DECLARED_TAXONOMY_SOURCES as readonly string[]).includes(p.source),
      )
      .map((p) => p.preferenceStrength),
  );
  const geographyStrength = mustGeography
    ? ("MUST" as const)
    : geographyStrengths.has("STRONG")
      ? ("STRONG" as const)
      : geographyStrengths.has("NICE")
        ? ("NICE" as const)
        : undefined;
  const mustStage = mandate.constraints.some(
    (c) =>
      c.dimension === "stage" && c.importance === "MUST" && !c.isHardExclusion,
  );

  return {
    ...(mustGeography || mustStage
      ? { mustMatch: { geography: mustGeography, stage: mustStage } }
      : {}),
    ...(geographyStrength === undefined ? {} : { geographyStrength }),
    cheque,
    leadPolicy,
    businessModelPreferences:
      preferred.length + avoided.length === 0 ? null : { preferred, avoided },
    mandateStages,
  };
}

/** "pre_seed" → "pre-seed", "series_a" → "Series A". */
export function stageLabel(code: string | null): string | undefined {
  if (code === null || code.length === 0) return undefined;
  if (code.startsWith("series_")) {
    return `Series ${code.slice("series_".length).toUpperCase()}`;
  }
  return code.replace(/_/g, "-");
}

const COUNTRIES = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    return null;
  }
})();

function countryName(code: string | null): string | undefined {
  if (code === null || !/^[A-Z]{2}$/.test(code)) return undefined;
  return COUNTRIES?.of(code) ?? code;
}

const ModelRow = z.object({
  company_id: z.string(),
  code: z.string(),
  label: z.string(),
});
const PreferenceRow = z.object({
  code: z.string(),
  strength: z.string(),
  excluded: z.boolean(),
});

type BusinessModels = {
  readonly byCompany: ReadonlyMap<
    string,
    readonly { readonly code: string; readonly label: string }[]
  >;
  readonly preferred: readonly string[];
  readonly avoided: readonly string[];
};

const EMPTY_MODELS: BusinessModels = {
  byCompany: new Map(),
  preferred: [],
  avoided: [],
};

/** Companies' declared business models and the mandate's preferences, from taxonomy. */
async function businessModelsOf(
  sql: DatabaseExecutor,
  companyIds: readonly string[],
  mandateId: string,
): Promise<BusinessModels> {
  if (companyIds.length === 0) return EMPTY_MODELS;
  const [companyRows, preferenceRows] = await Promise.all([
    sql`
      select a.entity_id::text as company_id, n.canonical_code as code, n.display_name as label
        from taxonomy.entity_assignments a
        join taxonomy.nodes n on n.id = a.node_id
        join taxonomy.vocabularies v on v.id = n.vocabulary_id
       where v.code = 'business_model'
         and a.entity_type = 'COMPANY'
         and a.status = 'ACTIVE'
         and a.entity_id = any(${[...companyIds]}::uuid[])
       order by a.created_at`,
    sql`
      select n.canonical_code as code, p.preference_strength as strength, p.is_exclusion as excluded
        from taxonomy.mandate_preferences p
        join taxonomy.nodes n on n.id = p.node_id
        join taxonomy.vocabularies v on v.id = n.vocabulary_id
       where v.code = 'business_model'
         and p.mandate_id = ${mandateId}`,
  ]);
  const byCompany = new Map<string, { code: string; label: string }[]>();
  for (const row of ModelRow.array().parse(companyRows)) {
    const list = byCompany.get(row.company_id) ?? [];
    list.push({ code: row.code, label: row.label });
    byCompany.set(row.company_id, list);
  }
  const preferred: string[] = [];
  const avoided: string[] = [];
  for (const row of PreferenceRow.array().parse(preferenceRows)) {
    if (row.excluded || row.strength === "AVOID") avoided.push(row.code);
    else preferred.push(row.code);
  }
  return { byCompany, preferred, avoided };
}

/** The model that decides the fit: a preferred one, else an avoided one, else the first. */
function pickModel(
  models: readonly { readonly code: string; readonly label: string }[],
  prefs: {
    readonly preferred: readonly string[];
    readonly avoided: readonly string[];
  } | null,
): DeclaredFitFacts["businessModel"] {
  if (models.length === 0) return null;
  const chosen =
    models.find((m) => prefs?.preferred.includes(m.code) === true) ??
    models.find((m) => prefs?.avoided.includes(m.code) === true) ??
    models[0];
  if (chosen === undefined) return null;
  // Declared by the founder on their own profile.
  return {
    code: chosen.code,
    label: chosen.label,
    evidenceStatus: "SELF_REPORTED",
  };
}
