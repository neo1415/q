import { z } from "zod";

import type { DatabaseExecutor } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import type {
  EligibilityPorts,
  MandateHardConstraint,
} from "../eligibility/ports.js";
import type { DeclaredFitFacts } from "../fit/observe.js";
import type { FitCompanyInputs, FitInputSource } from "../fit/service.js";
import type { FilterMoney } from "../slates/filters.js";

import { readCurrentFeatureSnapshot } from "./postgres-feature-snapshot-store.js";

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
};

const MODE = "INVESTOR_DISCOVER";

export function createFitInputSource(
  dependencies: FitInputSourceDependencies,
): FitInputSource {
  return {
    read: async (query) => {
      const ids = [...query.companyIds];
      const [mandate, facts, identities, raises, snapshots, models] =
        await Promise.all([
          dependencies.eligibilityPorts.mandates.activeMandate({
            tenantId: query.actor.tenantId,
            investorOrganisationId: query.investorOrganisationId,
            mandateId: query.mandateId,
          }),
          dependencies.eligibilityPorts.companies.findMany(ids),
          dependencies.identities(ids),
          dependencies.raises === undefined
            ? Promise.resolve(new Map<string, FilterMoney>())
            : dependencies
                .raises(query.actor, ids)
                .catch(() => new Map<string, FilterMoney>()),
          Promise.all(
            ids.map((companyId) =>
              readCurrentFeatureSnapshot(dependencies.sql, {
                investorOrganisationId: query.investorOrganisationId,
                mandateId: query.mandateId,
                companyId,
                mode: MODE,
              }),
            ),
          ),
          businessModelsOf(dependencies.sql, ids, query.mandateId).catch(
            () => EMPTY_MODELS,
          ),
        ]);
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
      ids.forEach((companyId, index) => {
        const identity = identities.get(companyId);
        if (identity === undefined) return;
        const company = factsById.get(companyId);
        const raise = raises.get(companyId);
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
          round:
            raise === undefined
              ? null
              : {
                  amount: raise.amount,
                  currency: raise.currency,
                  // A raise the founder declared on their capital objective.
                  evidenceStatus: "SELF_REPORTED",
                },
        };
        out.set(companyId, {
          snapshot: snapshots[index] ?? null,
          declared,
          name: identity.name,
          line:
            [stage, place].filter((s) => s !== undefined).join(" · ") || null,
        });
      });
      return out;
    },
  };
}

function mandateFacts(mandate: {
  readonly constraints: readonly MandateHardConstraint[];
  readonly stage?:
    | {
        readonly minStageCode: string | null;
        readonly maxStageCode: string | null;
      }
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
  const cheque =
    typical !== undefined && typical.value.kind === "amount"
      ? { currency: typical.value.currency, typical: typical.value.amount }
      : null;

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

  return {
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
