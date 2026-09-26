import {
  COMPANIES_PATH,
  COMPANY_FOUNDER_PROFILE_ME_SUFFIX,
  COMPANY_TEAM_FACTS_SUFFIX,
  COMPANY_TEAM_ME_SUFFIX,
  COMPANY_VISIBILITY_SEGMENT,
  CompanyDtoSchema,
  INVESTORS_CURRENT_PATH,
  INVESTORS_PATH,
  INVESTOR_MANDATE_ACTIVATE_SUFFIX,
  INVESTOR_MANDATES_SUFFIX,
  INVESTOR_REPRESENTATIVE_ME_SUFFIX,
  INVESTOR_VISIBILITY_SEGMENT,
  IncomingInterestListDtoSchema,
  InvestorMandateSummaryDtoSchema,
  InvestorOrganisationDtoSchema,
  ME_PROFILE_PATH,
  NETWORK_COMPANY_EXPRESS_INTEREST_PATH,
  NETWORK_COMPANY_INCOMING_INTEREST_PATH,
  NETWORK_INTEREST_ACCEPT_PATH,
  NETWORK_INTEREST_DECLINE_PATH,
  OnboardingResponseValueSchema,
  OnboardingSessionViewSchema,
  TAXONOMY_NODES_SEGMENT,
  TAXONOMY_PATH,
  TAXONOMY_VOCABULARIES_SEGMENT,
  type OnboardingSessionView,
} from "@capital-q/contracts";
import type { z } from "zod";

import {
  FICTIONAL_ACCOUNT_DOMAIN,
  SeedError,
  asRecord,
  type SeedHttp,
} from "./http.js";
import type {
  FictionalCompany,
  FictionalInterest,
  FictionalInvestor,
} from "./types.js";

/**
 * Fictional founders and investors, through the product's own front
 * doors (SEED): the onboarding runtime creates the organisation, the
 * membership and the canonical company or investor organisation; the
 * profile, team, visibility, mandate and interest routes do the rest.
 * Every step is read before it is written, so a rerun changes nothing
 * that is already as described.
 */

type ResponseValue = z.infer<typeof OnboardingResponseValueSchema>;
type Answer = { readonly value: ResponseValue } | "skip" | null;

export type SeedLog = (line: string) => void;

export function founderEmail(key: string): string {
  return `founder.${key}@${FICTIONAL_ACCOUNT_DOMAIN}`;
}
export function investorEmail(key: string): string {
  return `investor.${key}@${FICTIONAL_ACCOUNT_DOMAIN}`;
}

const select = (optionKey: string): Answer => ({
  value: { type: "SINGLE_SELECT", optionKey },
});
const multi = (optionKeys: readonly string[]): Answer =>
  optionKeys.length === 0
    ? "skip"
    : { value: { type: "MULTI_SELECT", optionKeys: [...optionKeys] } };
const text = (value: string): Answer => ({
  value: { type: "TEXT", text: value },
});
const range = (value: number | string): Answer => ({
  value: { type: "RANGE", value: String(value) },
});
const confirm: Answer = { value: { type: "CONFIRMATION", confirmed: true } };
const nodes = (resourceType: string, ids: readonly string[]): Answer =>
  ids.length === 0
    ? "skip"
    : {
        value: {
          type: "RESOURCE_REFERENCE",
          resourceType,
          resourceIds: [...ids],
        } as ResponseValue,
      };

/**
 * Canonical taxonomy code → node id, read once through the taxonomy route
 * by the first person who needs it. Reading taxonomy needs an organisation
 * context, so it is loaded lazily, after a journey has created one.
 */
export type Taxonomy = (token: string) => Promise<ReadonlyMap<string, string>>;

export function lazyTaxonomy(http: SeedHttp): Taxonomy {
  let loaded: Promise<ReadonlyMap<string, string>> | null = null;
  return (token) => {
    loaded ??= loadTaxonomy(http, token);
    return loaded;
  };
}

async function loadTaxonomy(
  http: SeedHttp,
  token: string,
): Promise<ReadonlyMap<string, string>> {
  const found = new Map<string, string>();
  for (const vocabulary of [
    "industry",
    "product_category",
    "business_model",
    "customer_type",
    "geography",
  ]) {
    let cursor: string | undefined;
    for (let guard = 0; guard < 20; guard += 1) {
      const query = new URLSearchParams({ limit: "100" });
      if (cursor !== undefined) query.set("cursor", cursor);
      const page = asRecord(
        await http.apiOk(
          token,
          "GET",
          `${TAXONOMY_PATH}${TAXONOMY_VOCABULARIES_SEGMENT}/${vocabulary}${TAXONOMY_NODES_SEGMENT}?${query.toString()}`,
        ),
      );
      const items = Array.isArray(page["items"]) ? page["items"] : [];
      for (const item of items) {
        const node = asRecord(item);
        if (
          typeof node["canonicalCode"] === "string" &&
          typeof node["id"] === "string"
        ) {
          found.set(node["canonicalCode"], node["id"]);
        }
      }
      const next = page["nextCursor"];
      if (typeof next !== "string") break;
      cursor = next;
    }
  }
  return found;
}

function idsFor(
  taxonomy: ReadonlyMap<string, string>,
  codes: readonly string[],
): string[] {
  return codes.map((code) => {
    const id = taxonomy.get(code);
    if (id === undefined) throw new SeedError(`no taxonomy node ${code}`);
    return id;
  });
}

function parseView(body: unknown): OnboardingSessionView {
  return OnboardingSessionViewSchema.parse(body);
}

/**
 * Walk a journey with the answers this fictional person would give.
 *
 * Every write carries the session version it was based on. A step with
 * no scripted answer is skipped when the journey allows it; a required
 * one stops the run and says which, rather than inventing an answer.
 */
async function driveJourney(
  http: SeedHttp,
  token: string,
  journeyType: "founder" | "investor",
  answerFor: (view: OnboardingSessionView, token: string) => Promise<Answer>,
  log: SeedLog,
): Promise<OnboardingSessionView> {
  const current = await http.api(
    token,
    "GET",
    `/v1/onboarding/sessions/current?journeyType=${journeyType}`,
  );
  let view =
    current.status === 200
      ? parseView(current.body)
      : parseView(
          await http.apiOk(token, "POST", "/v1/onboarding/sessions", {
            journeyType,
          }),
        );
  let answered = 0;
  let skipped = 0;
  for (let guard = 0; guard < 80; guard += 1) {
    if (view.session.status === "COMPLETED") break;
    const path = `/v1/onboarding/sessions/${view.session.id}`;
    const expectedSessionVersion = view.session.version;
    if (view.progress.canComplete) {
      view = parseView(
        await http.apiOk(token, "POST", `${path}/complete`, {
          expectedSessionVersion,
        }),
      );
      continue;
    }
    const step = view.currentStep;
    if (step === null) break;
    const answer = await answerFor(view, token);
    if (answer === null && step.required) {
      throw new SeedError(
        `${journeyType} step ${step.stepKey} (${step.stepType}) is required and has no scripted answer`,
      );
    }
    const result =
      answer === null || answer === "skip"
        ? await http.apiOk(
            token,
            "POST",
            `${path}/steps/${encodeURIComponent(step.stepKey)}/skip`,
            { expectedSessionVersion },
          )
        : await http.apiOk(token, "POST", `${path}/responses`, {
            stepKey: step.stepKey,
            response: {
              value: answer.value,
              sourceModality:
                answer.value.type === "TEXT" ? "TYPED_TEXT" : "SELECTION",
            },
            expectedSessionVersion,
          });
    if (answer === null || answer === "skip") skipped += 1;
    else answered += 1;
    view = parseView(result);
  }
  log(
    `    ${journeyType} journey ${view.session.status} (${String(answered)} answered, ${String(skipped)} skipped this run)`,
  );
  return view;
}

function founderAnswers(
  company: FictionalCompany,
  taxonomy: Taxonomy,
): (view: OnboardingSessionView, token: string) => Promise<Answer> {
  return async (view, token) => {
    const step = view.currentStep;
    if (step === null) return null;
    switch (step.stepKey) {
      case "F0.intent":
        return select("raising_now");
      case "F1.company_name":
        return text(company.name);
      case "F1.website":
        return text(company.website);
      case "F1.country":
        return select(company.countryOption);
      case "F1.stage":
        return select(company.stageOption);
      case "F1.description":
        return text(company.shortDescription);
      case "F1.categories":
        return nodes(
          "TAXONOMY_NODE",
          idsFor(await taxonomy(token), company.categories),
        );
      case "F2.materials":
        return "skip";
      case "F3.review":
      case "F6.confirm":
      case "F8.snapshot":
        return confirm;
      case "F4.founder_role":
        return select(company.founder.roleOption);
      case "F4.founder_count":
        return range(company.team.founderCount);
      case "F4.full_time":
        return select(company.team.fullTimeOption);
      case "F4.team_size":
        return range(company.team.teamSize);
      case "F4.functions":
        return multi(company.team.functions);
      case "F5.signal":
        return select(company.signal ?? "none");
      case "F5.pilots":
        return company.pilots === undefined ? "skip" : range(company.pilots);
      case "F5.revenue_status":
        return select(company.revenueStatus ?? "early");
      case "F5.customers":
        return company.customers === undefined
          ? "skip"
          : range(company.customers);
      case "F5.growth":
        return company.growth === undefined ? "skip" : select(company.growth);
      case "F6.raising":
        return select("active");
      case "F6.currency":
        return select(company.raise.currencyOption);
      case "F6.target_amount":
        return range(company.raise.target.amount);
      case "F6.instrument":
        return select(company.raise.instrument);
      case "F6.timeframe":
        return select(company.raise.timeframe);
      case "F6.use_of_funds":
        return multi(company.raise.useOfFunds);
      case "F7.follow_up":
        return "skip";
      default:
        return step.required ? null : "skip";
    }
  };
}

function investorAnswers(
  investor: FictionalInvestor,
  taxonomy: Taxonomy,
): (view: OnboardingSessionView, token: string) => Promise<Answer> {
  return async (view, token) => {
    const step = view.currentStep;
    if (step === null) return null;
    switch (step.stepKey) {
      case "I0.investor_type":
        return select(investor.typeOption);
      case "I0.organisation_name":
        return text(investor.name);
      case "I0.business_title":
        return text(investor.person.businessTitle);
      case "I1.deployment_status":
        return select("actively_investing");
      case "I1.mandate_context": {
        // The runtime names the mandates this person may choose from; the
        // one it suggests (the mandate I1 just ensured) is taken.
        const context = step.context ?? {};
        const suggested = Object.entries(context)
          .filter(
            ([key, value]) =>
              /^suggested.*Id$/.test(key) && typeof value === "string",
          )
          .map(([, value]) => value as string);
        const candidates = Array.isArray(context["candidates"])
          ? context["candidates"]
              .map((candidate) => asRecord(candidate))
              .map(
                (candidate) =>
                  Object.entries(candidate).find(
                    ([key, value]) =>
                      /Id$|^id$/.test(key) && typeof value === "string",
                  )?.[1],
              )
              .filter((id): id is string => typeof id === "string")
          : [];
        const ids = suggested.length > 0 ? suggested : candidates.slice(0, 1);
        return ids.length === 0
          ? null
          : nodes("INVESTOR_MANDATE", ids.slice(0, 1));
      }
      case "I2.stages":
        return multi(investor.stages);
      case "I2.currency":
        return select(investor.currencyOption);
      case "I2.cheque_min":
        return range(investor.cheque.min);
      case "I2.cheque_typical":
        return range(investor.cheque.typical);
      case "I2.cheque_max":
        return range(investor.cheque.max);
      case "I2.investment_role":
        return multi(investor.roles);
      case "I3.geography":
        return nodes(
          "TAXONOMY_NODE",
          idsFor(await taxonomy(token), investor.geographies),
        );
      case "I3.geography_strength":
      case "I3.sector_strength":
        return select("strong");
      case "I3.sectors":
        return nodes(
          "TAXONOMY_NODE",
          idsFor(await taxonomy(token), investor.sectors),
        );
      case "I4.capital_intensity":
        return select("any");
      case "I4.regulatory_appetite":
        return select("any");
      case "I4.revenue_state":
        return select(
          investor.stages.includes("pre_seed")
            ? "pre_revenue_ok"
            : investor.stages.includes("seed")
              ? "revenue_preferred"
              : "revenue_required",
        );
      case "I6.custom_criteria":
        return text(investor.thesis.slice(0, 1000));
      case "I9.discovery_mode":
        return select(investor.discoveryMode);
      case "I10.inbound_preference":
        return select("qualified");
      case "I11.additional_context":
        return text(investor.thesis);
      case "I11.review":
      case "I12.handoff":
        return confirm;
      default:
        return step.required ? null : "skip";
    }
  };
}

async function ensurePersonProfile(
  http: SeedHttp,
  token: string,
  person: { readonly displayName: string; readonly headline: string },
): Promise<void> {
  const profile = asRecord(await http.apiOk(token, "GET", ME_PROFILE_PATH));
  if (
    profile["displayName"] === person.displayName &&
    profile["headline"] === person.headline
  ) {
    return;
  }
  await http.apiOk(token, "PATCH", ME_PROFILE_PATH, {
    expectedVersion: profile["version"],
    displayName: person.displayName,
    headline: person.headline,
  });
}

/**
 * Read, compare, and PATCH only what differs, under the version read: the
 * product's own optimistic-concurrency contract for an editable record.
 */
async function patchIfChanged(
  http: SeedHttp,
  token: string,
  path: string,
  wanted: Readonly<Record<string, unknown>>,
): Promise<void> {
  const current = await http.api(token, "GET", path);
  const body = current.status === 200 ? asRecord(current.body) : {};
  const changes = Object.fromEntries(
    Object.entries(wanted).filter(([field, value]) => body[field] !== value),
  );
  if (Object.keys(changes).length === 0) return;
  await http.apiOk(token, "PATCH", path, {
    ...(typeof body["version"] === "number"
      ? { expectedVersion: body["version"] }
      : {}),
    ...changes,
  });
}

/** The long profile text: the story, marked fictional in its first line. */
export function storyText(company: FictionalCompany): string {
  const s = company.story;
  return [
    `Fictional demo company. ${company.name} and everyone named here are invented for Capital Q demonstrations; no real company, person or customer data.`,
    `Problem. ${s.problem}`,
    `Solution. ${s.solution}`,
    `Traction. ${s.traction}`,
    `Team. ${s.team}`,
    `Market. ${s.market}`,
    `Competition. ${s.competition}`,
    `Risks. ${s.risks}`,
    `The raise. ${s.raise}`,
    `Not yet known. ${s.unknowns.join("; ")}.`,
  ].join("\n\n");
}

export type SeededCompany = {
  readonly key: string;
  readonly companyId: string;
  readonly authUserId: string;
  readonly email: string;
  readonly token: string;
};

export async function seedCompany(
  http: SeedHttp,
  company: FictionalCompany,
  taxonomy: Taxonomy,
  password: string,
  log: SeedLog,
): Promise<SeededCompany> {
  const email = founderEmail(company.key);
  const account = await http.ensureAccount({
    email,
    displayName: company.founder.displayName,
    password,
    seedKey: company.key,
  });
  log(
    `  ${company.name} — ${email} (${account.created ? "created" : "existing"})`,
  );
  const token = await http.sessionFor(email);
  await ensurePersonProfile(http, token, company.founder);

  const view = await driveJourney(
    http,
    token,
    "founder",
    founderAnswers(company, taxonomy),
    log,
  );
  const companyId = view.session.subject?.id;
  if (companyId === undefined) {
    throw new SeedError(
      `${company.name}: the founder journey bound no company`,
    );
  }
  const base = `${COMPANIES_PATH}/${companyId}`;

  // The canonical profile: only the fields that differ are sent.
  const current = CompanyDtoSchema.parse(await http.apiOk(token, "GET", base));
  const wanted = {
    legalName: company.legalName,
    websiteUrl: company.website,
    foundedDate: company.foundedDate,
    headquartersCountry: company.countryOption.toUpperCase(),
    headquartersCity: company.city,
    shortDescription: company.shortDescription,
    primaryDescription: storyText(company),
  } as const;
  const changes = Object.fromEntries(
    Object.entries(wanted).filter(
      ([field, value]) => (current as Record<string, unknown>)[field] !== value,
    ),
  );
  if (current.currentStageCode === null) {
    changes["currentStageCode"] = company.stageOption;
  }
  let version = current.version;
  let visibility = current.marketplaceVisibility;
  if (Object.keys(changes).length > 0) {
    const updated = CompanyDtoSchema.parse(
      await http.apiOk(token, "PATCH", base, {
        expectedVersion: version,
        ...changes,
      }),
    );
    version = updated.version;
    visibility = updated.marketplaceVisibility;
  }

  await http.apiOk(token, "PUT", `${base}${COMPANY_TEAM_ME_SUFFIX}`, {
    relationshipType: "team_member",
    businessTitle: company.founder.businessTitle,
    isFounder: true,
  });
  await patchIfChanged(
    http,
    token,
    `${base}${COMPANY_FOUNDER_PROFILE_ME_SUFFIX}`,
    {
      professionalSummary: company.founder.professionalSummary,
      backgroundSummary: company.founder.backgroundSummary,
    },
  );
  await patchIfChanged(http, token, `${base}${COMPANY_TEAM_FACTS_SUFFIX}`, {
    founderCount: company.team.founderCount,
    fullTimeFounderCount: company.team.fullTimeFounderCount,
    teamSize: company.team.teamSize,
  });

  // Discoverability is the founder's declared choice; this founder makes it.
  if (visibility !== "network_visible") {
    await http.apiOk(token, "POST", `${base}${COMPANY_VISIBILITY_SEGMENT}`, {
      visibility: "network_visible",
      expectedVersion: version,
    });
  }

  // Ask Capital Q to verify, as the founder would; the worker decides it
  // under the deployment's own synthetic attestation, or leaves it pending.
  const standing = asRecord(
    await http.apiOk(token, "GET", `${base}/verification`),
  );
  if (standing["requestable"] === true) {
    await http.apiOk(token, "POST", `${base}/verification/requests`, undefined);
    log("    verification requested");
  }
  return {
    key: company.key,
    companyId,
    authUserId: account.authUserId,
    email,
    token,
  };
}

export type SeededInvestor = {
  readonly key: string;
  readonly investorOrganisationId: string;
  readonly mandateId: string | null;
  readonly authUserId: string;
  readonly email: string;
  readonly token: string;
};

export async function seedInvestor(
  http: SeedHttp,
  investor: FictionalInvestor,
  taxonomy: Taxonomy,
  password: string,
  log: SeedLog,
): Promise<SeededInvestor> {
  const email = investorEmail(investor.key);
  const account = await http.ensureAccount({
    email,
    displayName: investor.person.displayName,
    password,
    seedKey: investor.key,
  });
  log(
    `  ${investor.name} — ${email} (${account.created ? "created" : "existing"})`,
  );
  const token = await http.sessionFor(email);
  await ensurePersonProfile(http, token, investor.person);
  await driveJourney(
    http,
    token,
    "investor",
    investorAnswers(investor, taxonomy),
    log,
  );

  const organisation = InvestorOrganisationDtoSchema.parse(
    await http.apiOk(token, "GET", INVESTORS_CURRENT_PATH),
  );
  const byId = `${INVESTORS_PATH}/${organisation.id}`;
  await http.apiOk(
    token,
    "PUT",
    `${byId}${INVESTOR_REPRESENTATIVE_ME_SUFFIX}`,
    {
      businessTitle: investor.person.businessTitle,
    },
  );
  if (organisation.visibility !== "network_visible") {
    await http.apiOk(token, "POST", `${byId}${INVESTOR_VISIBILITY_SEGMENT}`, {
      visibility: "network_visible",
      expectedVersion: organisation.version,
    });
  }

  // The declared mandate the journey wrote; the thesis goes on it in the
  // investor's own words, and a draft is activated as the investor would.
  const list = asRecord(
    await http.apiOk(token, "GET", `${byId}${INVESTOR_MANDATES_SUFFIX}`),
  );
  const mandates = (Array.isArray(list["items"]) ? list["items"] : []).map(
    (item) => InvestorMandateSummaryDtoSchema.parse(item),
  );
  const mandate =
    mandates.find((m) => m.status === "ACTIVE") ??
    mandates.find((m) => m.status === "DRAFT") ??
    null;
  if (mandate !== null) {
    const mandatePath = `${byId}${INVESTOR_MANDATES_SUFFIX}/${mandate.id}`;
    const detail = asRecord(await http.apiOk(token, "GET", mandatePath));
    const name = `${investor.name.replace(/ \(fictional\)$/, "")} mandate`;
    let version = detail["version"];
    if (
      detail["rawMandateText"] !== investor.thesis ||
      detail["name"] !== name
    ) {
      const updated = asRecord(
        await http.apiOk(token, "PATCH", mandatePath, {
          expectedVersion: version,
          name,
          rawMandateText: investor.thesis,
        }),
      );
      version = updated["version"];
    }
    if (mandate.status === "DRAFT") {
      await http.apiOk(
        token,
        "POST",
        `${mandatePath}${INVESTOR_MANDATE_ACTIVATE_SUFFIX}`,
        {
          expectedVersion: version,
        },
      );
    }
  } else {
    log("    no mandate found after the journey");
  }
  return {
    key: investor.key,
    investorOrganisationId: organisation.id,
    mandateId: mandate?.id ?? null,
    authUserId: account.authUserId,
    email,
    token,
  };
}

export type SeededInterest = {
  readonly investorKey: string;
  readonly companyKey: string;
  readonly interestId: string | null;
  readonly response: string;
};

/**
 * Express Interest as the investor, then answer it as the founder. Both
 * are the relationship spine's own commands; the relationship state is
 * whatever its projector makes of those events.
 */
export async function seedInterest(
  http: SeedHttp,
  interest: FictionalInterest,
  investor: SeededInvestor,
  company: SeededCompany,
  log: SeedLog,
): Promise<SeededInterest> {
  const expressed = await http.api(
    investor.token,
    "POST",
    NETWORK_COMPANY_EXPRESS_INTEREST_PATH.replace(
      ":companyId",
      company.companyId,
    ),
    { surface: "COMPANY_PROFILE" },
    // Stable, so a rerun is the same request and the product deduplicates it.
    `seed-fictional-interest-${interest.investorKey}-${interest.companyKey}`,
  );
  if (expressed.status !== 200 && expressed.status !== 201) {
    throw new SeedError(
      `interest ${interest.investorKey} -> ${interest.companyKey}: HTTP ${String(expressed.status)} ${JSON.stringify(expressed.body).slice(0, 300)}`,
    );
  }
  const inbox = IncomingInterestListDtoSchema.parse(
    await http.apiOk(
      company.token,
      "GET",
      NETWORK_COMPANY_INCOMING_INTEREST_PATH.replace(
        ":companyId",
        company.companyId,
      ),
    ),
  );
  const item = inbox.items.find(
    (entry) => entry.investorOrganisationId === investor.investorOrganisationId,
  );
  if (item === undefined) {
    log(
      `    ${interest.investorKey} -> ${interest.companyKey}: not in the founder's inbox`,
    );
    return { ...interest, interestId: null, response: "UNSEEN" };
  }
  let response: string = item.response;
  if (item.response === "PENDING" && interest.founderAnswer !== "pending") {
    const path = (
      interest.founderAnswer === "accept"
        ? NETWORK_INTEREST_ACCEPT_PATH
        : NETWORK_INTEREST_DECLINE_PATH
    ).replace(":interestId", item.interestId);
    const answered = asRecord(
      await http.apiOk(
        company.token,
        "POST",
        path,
        {},
        `seed-fictional-answer-${interest.investorKey}-${interest.companyKey}`,
      ),
    );
    response = String(asRecord(answered["interest"])["response"] ?? response);
  }
  log(`    ${interest.investorKey} -> ${interest.companyKey}: ${response}`);
  return { ...interest, interestId: item.interestId, response };
}
