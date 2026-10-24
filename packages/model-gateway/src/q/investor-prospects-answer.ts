import {
  QAnswerCardsBlockSchema,
  type QAnswerCard,
  type QAnswerCardsBlock,
} from "@capital-q/contracts/q";
import type {
  QAnswerRequest,
  QToolCallOutcome,
  QToolExecutionContext,
  QToolPort,
} from "@capital-q/q-runtime";

/**
 * TURN_READER v58 (owner 2026-10-23): "Which investors should I talk to
 * first, and why?" from a founder, answered by code. It was read as
 * advice about their own company and answered from the company record
 * alone ("no investor mandates, prior interest or fit evidence is
 * available"), though both reads below existed.
 *
 * Two reads, both under this run's plan and both about their own company:
 * - list_incoming_interest: investors who have actually expressed interest
 *   in it (their own relationship history). These come first.
 * - find_prospective_investors: likely fits ranked from what investors
 *   publish to the network (profile, published gate). Context Firewall:
 *   no investor's private mandate is read, and each is labelled a likely
 *   fit, never interest.
 * The sentence, each one-line why and every card are composed here; no
 * analyst model call. Each card carries its investor organisation, so
 * "why might the top one pass?" resolves to a named investor.
 */

export type InvestorProspectsAsk = NonNullable<
  QAnswerRequest["investorProspects"]
>;

const PROSPECTS_TOOL = "find_prospective_investors";
const INTEREST_TOOL = "list_incoming_interest";
const COUNT_DEFAULT = 3;
const COUNT_MAX = 5;
const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five"] as const;

type Interest = {
  readonly investorOrganisationId: string;
  readonly investorName: string;
  readonly investorType: string;
  readonly expressedAt: string;
  readonly answer: "PENDING" | "ACCEPTED" | "DECLINED";
};

type Prospect = {
  readonly investorOrganisationId: string;
  readonly name: string;
  readonly investorType: string | null;
  readonly hqCountry: string | null;
  readonly publicDescription: string | null;
  readonly deploymentState?: string | null;
  readonly reasons: readonly {
    readonly kind: string;
    readonly detail: string;
  }[];
  readonly gate?: {
    readonly acceptingApplications: boolean;
    readonly criteria: readonly {
      readonly required: boolean;
      readonly dimension?: string | undefined;
      readonly standing: "MET" | "NOT_MET" | "UNKNOWN";
    }[];
  } | null;
  /** Their published sector against this company (from their gate). */
  readonly sector?: {
    readonly fit: "MATCH" | "MISMATCH" | "UNKNOWN";
    readonly focus: string | null;
    /** EXACT: one of the company's own sectors; ADJACENT: a related one. */
    readonly closeness?: "EXACT" | "ADJACENT" | null;
    /** Where they published it: their gate, or their Q Card. */
    readonly source?: "GATE" | "CARD";
    /** The company's own declared sectors, by name. */
    readonly yours?: readonly string[];
  };
  /** QO-42 / QA F-77: their published stage, sector and geography. */
  readonly publishedFit?: PublishedFit;
};

type Standing = "MET" | "NOT_MET" | "UNKNOWN";
type PublishedFit = {
  readonly stage: Standing;
  readonly sector: Standing;
  readonly geography: Standing;
};

/** One investor to approach, with the one line that says why. */
export type ProspectPick = {
  readonly investorOrganisationId: string;
  readonly name: string;
  readonly kind: "INTERESTED" | "LIKELY_FIT";
  readonly line: string | null;
  readonly about: string | null;
  readonly why: string;
  /** How well, by what they publish on their Q Card; absent: not read. */
  readonly fit?: PublishedFit | undefined;
};

export type InvestorProspectsAnswer = {
  readonly text: string;
  readonly block: QAnswerCardsBlock | null;
  readonly shown: number;
  readonly calls: readonly QToolCallOutcome[];
};

const TYPE_WORDS: Readonly<Record<string, string>> = {
  ANGEL: "Angel investor",
  ANGEL_NETWORK: "Angel network",
  VC: "Venture capital",
  CVC: "Corporate venture",
  FAMILY_OFFICE: "Family office",
  ACCELERATOR: "Accelerator",
  DFI: "Development finance",
  PRIVATE_EQUITY: "Private equity",
};

function typeWords(type: string | null): string | null {
  if (type === null || type.length === 0) return null;
  return (
    TYPE_WORDS[type] ??
    `${type.charAt(0)}${type.slice(1).toLowerCase().replace(/_/gu, " ")}`
  );
}

function day(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "recently"
    : date.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      });
}

function listOf(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function sentence(text: string): string {
  const trimmed = text.trim().replace(/[.;,\s]+$/u, "");
  return trimmed.length === 0
    ? ""
    : `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}.`;
}

/** What their published gate says about this company, in a few words. */
function gateWords(gate: Prospect["gate"]): string | null {
  if (gate === null || gate === undefined) return null;
  // The sector is said on its own (sectorClause); these are the rest.
  const required = gate.criteria.filter(
    (c) =>
      c.required &&
      c.dimension !== "TAXONOMY" &&
      c.dimension !== "EXCLUDED_TAXONOMY",
  );
  if (required.length === 0) return null;
  const met = required.filter((c) => c.standing === "MET").length;
  const missed = required.filter((c) => c.standing === "NOT_MET").length;
  if (missed > 0) {
    return `you miss ${String(missed)} of the other ${String(required.length)} required criteria on their published gate`;
  }
  return met === required.length
    ? `you meet the other required criteria on their published gate`
    : `you meet ${String(met)} of the other ${String(required.length)} required criteria on their published gate; the rest are not known yet`;
}

/** Their own words for what they back, quoted as they published them. */
function focusOf(description: string | null | undefined): string | null {
  const text = description
    ?.replace(/\s+/gu, " ")
    .trim()
    .replace(/[.\s]+$/u, "");
  if (text === undefined || text.length < 8) return null;
  return text.length > 110 ? `${text.slice(0, 107).trimEnd()}…` : text;
}

/**
 * Why approach them first, as an analyst would put it: the interest event
 * itself, or what they say they back, then how that meets this company
 * and their published gate. Every clause is read from a record; nothing
 * is a stock line.
 */
function interestWhy(one: Interest, focus: string | null): string {
  const event =
    one.answer === "ACCEPTED"
      ? `they approached you first, expressing interest on ${day(one.expressedAt)}, and you accepted, so this is a conversation already under way rather than a cold approach`
      : `they approached you first, expressing interest on ${day(one.expressedAt)}, and are still waiting for your answer, so reply to them before you pitch anyone cold`;
  return focus === null
    ? event
    : `${event}; they describe their focus as \u201c${focus}\u201d`;
}

const REGIONS = new Intl.DisplayNames(["en"], { type: "region" });

function countryName(code: string | null): string | null {
  if (code === null || !/^[A-Za-z]{2}$/u.test(code)) return null;
  try {
    return REGIONS.of(code.toUpperCase()) ?? null;
  } catch {
    return null;
  }
}

/** One clause per reason, from the reason's kind and the investor's own fields. */
function reasonClause(
  reason: Prospect["reasons"][number],
  one: Prospect,
): string | null {
  switch (reason.kind) {
    case "SAME_COUNTRY": {
      const country = countryName(one.hqCountry);
      return country === null
        ? "they are based where you are"
        : `they are based in ${country}, as you are`;
    }
    // A generic inference about investors of their type, not something
    // they published or did (owner 2026-10-23): never said.
    case "TYPICAL_STAGE":
      return null;
    case "DEPLOYING":
      return one.deploymentState === "SELECTIVE"
        ? "they say they are investing selectively"
        : "they say they are actively investing";
    default:
      return reason.detail.trim().length === 0 ? null : reason.detail.trim();
  }
}

/** Their published sector against this company, said honestly. */
/**
 * Their published sector against the company, said exactly as far as it
 * goes and no further (owner 2026-10-23): a match is named against how the
 * company is classified, a related sector is "close ... not the same", and
 * nothing is ever called "your sector" -- the classification is not the
 * business (Maji Loop sells water; it is classified clean energy).
 */
function sectorClause(sector: Prospect["sector"]): string | null {
  if (sector === undefined || sector.focus === null) return null;
  const said =
    sector.source === "CARD"
      ? `their Q Card lists ${sector.focus}`
      : `their published gate looks for ${sector.focus}`;
  const yours =
    sector.yours === undefined || sector.yours.length === 0
      ? null
      : sector.yours.join(", ");
  if (sector.fit === "MATCH") {
    if (sector.closeness === "EXACT" && yours !== null) {
      return `${said}, which matches how your company is classified (${yours})`;
    }
    if (sector.closeness === "ADJACENT" && yours !== null) {
      return `${said}, which is close to how your company is classified (${yours}) but not the same`;
    }
    // GateQ found the rule met; how closely is not known here.
    return `you meet the sector rule on their published gate (${sector.focus})`;
  }
  if (sector.fit === "MISMATCH") {
    return `${said}, which is not how your company is classified${yours === null ? "" : ` (${yours})`}, so this is a stretch`;
  }
  return null;
}

const FIT_PARTS = ["stage", "sector", "geography"] as const;

/**
 * QA F-77 (founder: "which investors fit Maji Loop best, and how well?"):
 * how well, per investor, from what their Q Card publishes against your
 * company -- each of stage, sector and geography met, not met, or not
 * known yet. Unknown is said as unknown, never as a no.
 */
export function fitWords(fit: PublishedFit | undefined): string | null {
  if (fit === undefined) return null;
  const met = FIT_PARTS.filter((part) => fit[part] === "MET");
  const missed = FIT_PARTS.filter((part) => fit[part] === "NOT_MET");
  const unknown = FIT_PARTS.filter((part) => fit[part] === "UNKNOWN");
  if (unknown.length === FIT_PARTS.length) {
    return "their Q Card does not say yet how you fit on stage, sector or geography";
  }
  const parts = [
    ...(met.length === 0 ? [] : [`you fit their published ${listOf(met)}`]),
    ...(missed.length === 0 ? [] : [`not their ${listOf(missed)}`]),
    ...(unknown.length === 0 ? [] : [`${listOf(unknown)} not known yet`]),
  ];
  return `${String(met.length)} of 3 on what they publish: ${parts.join("; ")}`;
}

function prospectWhy(one: Prospect): string {
  const focus = focusOf(one.publicDescription);
  const clauses = one.reasons
    .map((reason) => reasonClause(reason, one))
    .filter((clause): clause is string => clause !== null)
    .slice(0, 2);
  const sector = sectorClause(one.sector);
  const gate = gateWords(one.gate);
  const parts = [
    ...(sector === null ? [] : [sector]),
    ...(focus === null
      ? []
      : [`they describe their focus as \u201c${focus}\u201d`]),
    ...clauses,
    ...(gate === null ? [] : [gate]),
  ];
  return parts.length === 0
    ? "what they publish matches your company"
    : parts.join("; ");
}

/**
 * Who to approach first: investors already interested (accepted, then
 * waiting on the founder), then likely fits in the prospect ranking's
 * order, each once. Declined interest is left out.
 */
export function pickProspects(
  interests: readonly Interest[],
  prospects: readonly Prospect[],
  count: number,
): ProspectPick[] {
  const picks: ProspectPick[] = [];
  const seen = new Set<string>();
  const live = interests
    .filter((one) => one.answer !== "DECLINED")
    .sort(
      (a, b) =>
        (a.answer === "ACCEPTED" ? 0 : 1) - (b.answer === "ACCEPTED" ? 0 : 1) ||
        b.expressedAt.localeCompare(a.expressedAt),
    );
  const profileOf = new Map(
    prospects.map((one) => [one.investorOrganisationId, one]),
  );
  for (const one of live) {
    if (picks.length >= count || seen.has(one.investorOrganisationId)) continue;
    seen.add(one.investorOrganisationId);
    const profile = profileOf.get(one.investorOrganisationId);
    picks.push({
      investorOrganisationId: one.investorOrganisationId,
      name: one.investorName,
      kind: "INTERESTED",
      line: typeWords(profile?.investorType ?? one.investorType),
      about: profile?.publicDescription ?? null,
      why: interestWhy(one, focusOf(profile?.publicDescription)),
      fit: profile?.publishedFit,
    });
  }
  // A published sector that is not theirs is named only when nothing
  // better is left (owner 2026-10-23), and then said to be a stretch.
  const better = prospects.filter((one) => one.sector?.fit !== "MISMATCH");
  const stretch = prospects.filter((one) => one.sector?.fit === "MISMATCH");
  const fill = picks.length + better.length > 0 ? better : stretch;
  for (const one of fill) {
    if (picks.length >= count || seen.has(one.investorOrganisationId)) continue;
    seen.add(one.investorOrganisationId);
    const why = prospectWhy(one);
    picks.push({
      investorOrganisationId: one.investorOrganisationId,
      name: one.name,
      kind: "LIKELY_FIT",
      line:
        [typeWords(one.investorType), one.hqCountry]
          .filter((part): part is string => part !== null && part.length > 0)
          .join(" · ") || null,
      about: one.publicDescription,
      why,
      fit: one.publishedFit,
    });
  }
  return picks;
}

/**
 * Capital Q's own investors among those asked for in a discovery (owner's
 * own conversation, 2026-10-24: "three Qatari investors"): the ones based
 * in the countries the ask names, of the kind it names, read beside the
 * public search. Each is a likely fit from what it publishes, never
 * interest.
 */
export function networkInvestorsIn(
  data: unknown,
  wanted: {
    readonly countries: readonly string[];
    readonly kinds: readonly string[];
    readonly count: number;
  },
): ProspectPick[] {
  const prospects = (data as { prospects?: unknown } | null)?.prospects;
  if (!Array.isArray(prospects)) return [];
  const stems = wanted.kinds.map((kind) =>
    kind.toLowerCase().replace(/s\b/gu, "").replace(/\s+/gu, "_"),
  );
  const places = new Set(wanted.countries.map((code) => code.toUpperCase()));
  return (prospects as Prospect[])
    .filter(
      (one) =>
        (places.size === 0 ||
          (one.hqCountry !== null &&
            places.has(one.hqCountry.toUpperCase()))) &&
        (stems.length === 0 ||
          stems.some((stem) =>
            `${one.investorType ?? ""} ${one.publicDescription ?? ""}`
              .toLowerCase()
              .replace(/\s+/gu, "_")
              .includes(stem === "vc" ? "vc" : stem),
          )),
    )
    .slice(0, wanted.count)
    .map((one) => ({
      investorOrganisationId: one.investorOrganisationId,
      name: one.name,
      kind: "LIKELY_FIT" as const,
      line:
        [typeWords(one.investorType), countryName(one.hqCountry)]
          .filter((part): part is string => part !== null && part.length > 0)
          .join(" · ") || null,
      about: one.publicDescription,
      why: prospectWhy(one),
      fit: one.publishedFit,
    }));
}

export function investorProspectsText(
  picks: readonly ProspectPick[],
  asked: number,
): string {
  if (picks.length === 0) {
    return "No investor on Capital Q has shown interest in your company yet, and none has published a profile that matches it, so I have nobody to name. As investors make their profiles visible, I'll rank them for you; I can also look for investors outside Capital Q by region or sector.";
  }
  const names = picks.map((pick) => pick.name);
  const count = NUMBER_WORDS[Math.min(picks.length, 5)] ?? "some";
  const parts = [
    picks.length < asked
      ? `I found ${count} worth talking to first: ${listOf(names)}.`
      : `Talk to ${listOf(names)} first.`,
  ];
  for (const pick of picks) {
    const how = fitWords(pick.fit);
    parts.push(
      `${pick.name}: ${sentence(how === null ? pick.why : `${how}. ${pick.why}`)}`,
    );
  }
  const interested = picks.filter((pick) => pick.kind === "INTERESTED").length;
  const others = picks.filter((pick) => pick.kind !== "INTERESTED");
  if (others.length > 0) {
    // QA F-77: "likely fit" only where what they publish says so.
    const allLikely = others.every((pick) => viewOf(pick) === "Likely fit");
    parts.push(
      !allLikely
        ? interested > 0
          ? "The others are picked from what each publishes, not interest they have shown."
          : "Each is picked from what they publish, not interest they have shown."
        : interested > 0
          ? "The others are likely fits from what each publishes, not interest they have shown."
          : "Each is a likely fit from what they publish, not interest they have shown.",
    );
  }
  return parts.join(" ");
}

/** Stage, sector and geography as card rows: met, not met, not known yet. */
function fitMeasures(fit: PublishedFit | undefined): QAnswerCard["measures"] {
  if (fit === undefined) return [];
  return FIT_PARTS.map((part) => ({
    label: `${part.charAt(0).toUpperCase()}${part.slice(1)}`,
    level:
      fit[part] === "MET"
        ? ("STRONG" as const)
        : fit[part] === "NOT_MET"
          ? ("MISMATCH" as const)
          : ("UNKNOWN" as const),
    value:
      fit[part] === "MET"
        ? "Matches what they publish"
        : fit[part] === "NOT_MET"
          ? "Not what they publish"
          : null,
  }));
}

/**
 * The card's verdict follows its rows (QA F-77): "Likely fit" over Stage,
 * Sector and Geography all unknown contradicted the card. Interest shown is
 * their own act and stands on its own.
 */
export function viewOf(pick: ProspectPick): string {
  if (pick.kind === "INTERESTED") return "Has shown interest";
  const fit = pick.fit;
  // No rows (their card was not read): the ranking's own reasons stand.
  if (fit === undefined) return "Likely fit";
  const met = FIT_PARTS.filter((part) => fit[part] === "MET").length;
  const missed = FIT_PARTS.filter((part) => fit[part] === "NOT_MET").length;
  if (met === 0 && missed === 0) {
    return "Fit not known yet: their Q Card doesn't say how you fit on stage, sector or geography";
  }
  if (missed === 0) return "Likely fit";
  return met === 0 ? "Not a fit on what they publish" : "Partial fit";
}

export function prospectCardsBlock(
  picks: readonly ProspectPick[],
): QAnswerCardsBlock | null {
  const cards: QAnswerCard[] = picks.map((pick, at) => ({
    key: `${String(at + 1)}-${pick.investorOrganisationId}`.slice(0, 64),
    name: pick.name.slice(0, 80),
    line: pick.line === null ? null : pick.line.slice(0, 140),
    about: pick.about === null ? null : pick.about.slice(0, 160),
    hue: (at % 7) + 1,
    fit: null,
    reasons: [clip(sentence(pick.why), 160)],
    measures: fitMeasures(pick.fit),
    view: viewOf(pick),
    said: null,
    sourceCount: 1,
    subject: {
      kind: "INVESTOR_ORGANISATION",
      investorOrganisationId: pick.investorOrganisationId,
    },
  }));
  if (cards.length === 0) return null;
  const parsed = QAnswerCardsBlockSchema.safeParse({
    kind: "ANSWER_CARDS",
    shape: "RANKED",
    title: "Investors to talk to first",
    cards,
    followUps:
      picks[0] === undefined
        ? []
        : [`Why might ${picks[0].name} pass on us?`.slice(0, 120)],
  });
  return parsed.success ? parsed.data : null;
}

function dataOf(outcome: QToolCallOutcome | null): unknown {
  return outcome !== null && outcome.result.ok ? outcome.result.data : null;
}

export async function runInvestorProspects(input: {
  readonly ask: InvestorProspectsAsk;
  readonly companyId: string;
  readonly tools: Pick<QToolPort, "execute">;
  readonly context: QToolExecutionContext;
  readonly available: ReadonlySet<string>;
}): Promise<InvestorProspectsAnswer | null> {
  const { ask, companyId, tools, context, available } = input;
  if (!available.has(PROSPECTS_TOOL)) return null;
  const [prospected, interested] = await Promise.all([
    tools
      .execute(
        {
          callId: "q-investor-prospects",
          name: PROSPECTS_TOOL,
          arguments: { companyId, limit: 10 },
        },
        context,
      )
      .catch(() => null),
    available.has(INTEREST_TOOL)
      ? tools
          .execute(
            {
              callId: "q-incoming-interest",
              name: INTEREST_TOOL,
              arguments: { companyId },
            },
            context,
          )
          .catch(() => null)
      : Promise.resolve(null),
  ]);
  const prospectData = dataOf(prospected) as { prospects?: unknown } | null;
  // Without the ranking there is nothing honest to say by code: the full
  // path answers instead.
  if (prospectData === null || !Array.isArray(prospectData.prospects)) {
    return null;
  }
  const interestData = dataOf(interested) as { interests?: unknown } | null;
  const prospects = prospectData.prospects as Prospect[];
  const interests = Array.isArray(interestData?.interests)
    ? (interestData.interests as Interest[])
    : [];
  const asked = Math.min(COUNT_MAX, Math.max(1, ask.count ?? COUNT_DEFAULT));
  const picks = pickProspects(interests, prospects, asked);
  return {
    text: investorProspectsText(picks, asked),
    block: prospectCardsBlock(picks),
    shown: picks.length,
    calls: [prospected, interested].filter(
      (call): call is QToolCallOutcome => call !== null,
    ),
  };
}
