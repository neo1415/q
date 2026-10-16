import type { QResultBlock } from "@capital-q/contracts";
import { asksForDrawing } from "@capital-q/q-core";
import type {
  QToolCallOutcome,
  QToolExecutionContext,
  QToolPort,
} from "@capital-q/q-runtime";

import { RunRead } from "./card-subjects.js";
import { refersToShown, type FitSweepResult, ownSetOf } from "./fit-sweep.js";
import {
  companyNameCandidates,
  countryWords,
  profileOf,
  readNamedVisibleCompany,
  type DeclaredProfile,
} from "./named-company-fact.js";
import { companiesMapBlock } from "./result-blocks.js";

/**
 * Lead 2026-10-16 (live 2026-10-15/16: "show me on a map where my top
 * companies are based" came back as fit cards and no map; "show me a map
 * of where Tensorgate is" ran a public web search and took 22 s): a map of
 * companies is drawn by code from what the companies declare on Capital Q
 * -- their headquarters country, read through the same tool port,
 * registry, authorize step and Context Firewall the model would use
 * (`search_companies` / `get_company`). No model call and no web search.
 *
 * Which companies: the ones named outright; else "them" (the cards just
 * shown); else their own set (the fit sweep's ranking when it ran, else
 * their relationships). A company that has not declared a country is
 * listed as not known, never placed by a guess. Public research happens
 * only when no company's location is known AND the person asked for
 * public information: then this returns null and the full path answers.
 */

const MAP_WORDS = /\b(?:maps?|mapped|map\s+out)\b/iu;
const ABOUT_INVESTORS =
  /\b(?:investors?|funds?|firms?|vcs?|angels?|backers?|lps?|syndicates?)\b/iu;
const PUBLIC_ASKED =
  /\b(?:online|on\s+the\s+(?:web|internet)|public(?:ly)?|google|look\s+(?:it|them)?\s*up|search\s+(?:the\s+web|online)|news)\b/iu;
const OWN_SET =
  /\b(?:my|our)\s+(?:(?:top|best|strongest|current|own|saved)\s+)*(?:companies|startups|businesses|portfolio|pipeline|relationships|deals|matches|candidates)\b|\btop\s+(?:\w+\s+)?(?:companies|startups|matches)\b/iu;
const PLACE_CAP = 10;

export type CompaniesMapAsk = {
  readonly scope: "NAMED" | "PREVIOUS" | "OWN";
  /** Names as written, for NAMED. */
  readonly names: readonly string[];
};

/** A map of companies asked for; null when the words ask for anything else. */
export function companiesMapAskOf(
  text: string,
  shownBefore: readonly string[],
): CompaniesMapAsk | null {
  const said = text.replace(/[’]/gu, "'");
  if (!MAP_WORDS.test(said) || !asksForDrawing(said)) return null;
  if (ABOUT_INVESTORS.test(said)) return null;
  const names = companyNameCandidates(said, 4).filter(
    (name) => !MAP_WORDS.test(name),
  );
  if (names.length > 0) return { scope: "NAMED", names };
  if (shownBefore.length > 0 && refersToShown(said)) {
    return { scope: "PREVIOUS", names: [] };
  }
  if (OWN_SET.test(said)) return { scope: "OWN", names: [] };
  return null;
}

/**
 * Whether this turn may be answered with a map drawn by code. A research
 * request counts (live 2026-10-16, batch R: "show me a map of where
 * Tensorgate is in the world" was read as RESEARCH_REQUEST and ran an 18 s
 * web search for a company whose country Capital Q holds); the map then
 * hands back to research only when no location is known and they asked
 * for public information (runCompaniesMap). Never for a document being
 * written or an action they asked for.
 */
export function mayDrawCompaniesMap(request: {
  readonly writingDocument?: boolean | undefined;
  readonly askedAction?: string | undefined;
  readonly turnKind?: string | undefined;
}): boolean {
  return (
    request.writingDocument !== true &&
    request.askedAction === undefined &&
    (request.turnKind === undefined ||
      request.turnKind === "QUESTION_TO_Q" ||
      request.turnKind === "RESEARCH_REQUEST")
  );
}

export type CompaniesMapAnswer = {
  readonly text: string;
  readonly blocks: readonly QResultBlock[];
  readonly calls: readonly QToolCallOutcome[];
};

function placeLine(profile: DeclaredProfile): string {
  const country =
    profile.headquartersCountry === null
      ? null
      : countryWords(profile.headquartersCountry);
  return country === null
    ? `${profile.canonicalName} (not declared)`
    : `${profile.canonicalName} (${[profile.headquartersCity, country].filter((part) => part !== null).join(", ")})`;
}

/** The answer's words: where each is, as declared, and what is not known. */
export function companiesMapLine(profiles: readonly DeclaredProfile[]): string {
  const placed = profiles.filter((one) => one.headquartersCountry !== null);
  const unknown = profiles.filter((one) => one.headquartersCountry === null);
  if (placed.length === 0) {
    return profiles.length === 1
      ? `${profiles[0]?.canonicalName ?? "That company"} hasn't declared where it is based on Capital Q, so I can't place it on a map.`
      : "None of them has declared where it is based on Capital Q, so I can't place them on a map.";
  }
  const lead =
    placed.length === 1 && profiles.length === 1
      ? `Here's ${placed[0]?.canonicalName ?? "it"} on the map: ${placed.map(placeLine).join("")}.`
      : `Here's where they're based: ${placed.map(placeLine).join("; ")}.`;
  const rest =
    unknown.length === 0
      ? ""
      : ` ${unknown.map((one) => one.canonicalName).join(", ")} ${unknown.length === 1 ? "hasn't" : "haven't"} declared a location, so ${unknown.length === 1 ? "it isn't" : "they aren't"} placed.`;
  return `${lead}${rest} Locations are what each company declares on Capital Q; they aren't verified.`;
}

/**
 * Null when the tools are not offered, no company can be read, or none
 * has a known location and they asked for public information.
 */
export async function runCompaniesMap(input: {
  readonly ask: CompaniesMapAsk;
  readonly asked: string;
  readonly shownBefore: readonly string[];
  /** The fit sweep this turn already started, when it applies. */
  readonly sweep: Promise<FitSweepResult | null>;
  readonly tools: Pick<QToolPort, "execute">;
  readonly context: QToolExecutionContext;
  readonly available: ReadonlySet<string>;
}): Promise<CompaniesMapAnswer | null> {
  const { ask, tools, context, available } = input;
  if (!available.has("get_company")) return null;
  const calls: QToolCallOutcome[] = [];
  const execute = async (
    name: string,
    args: Record<string, unknown>,
    callId: string,
  ): Promise<QToolCallOutcome | null> => {
    const outcome = await tools
      .execute({ callId, name, arguments: args }, context)
      .catch(() => null);
    if (outcome !== null) calls.push(outcome);
    return outcome;
  };
  let ids: string[] = [];
  const profiles = new Map<string, DeclaredProfile>();
  if (ask.scope === "NAMED") {
    const found = await Promise.all(
      ask.names.map((name, callIndex) =>
        readNamedVisibleCompany({
          name,
          exclude: new Set(),
          tools,
          context,
          available,
          callIndex,
        }),
      ),
    );
    for (const one of found) {
      if (one === null) continue;
      for (const call of one.calls) calls.push(call.outcome);
      const profile = profileOf(one.calls.at(-1)?.outcome ?? null);
      if (profile !== null && !profiles.has(profile.companyId)) {
        profiles.set(profile.companyId, profile);
        ids.push(profile.companyId);
      }
    }
  }
  // A capitalised word that names no visible company ("Now show me the
  // map") falls back to what was just shown.
  if (ask.scope === "PREVIOUS" || (ask.scope === "NAMED" && ids.length === 0)) {
    ids = [...input.shownBefore];
  } else if (ask.scope === "OWN") {
    const sweep = await input.sweep.catch(() => null);
    if (sweep !== null && sweep.fits.length > 0) {
      const count = sweep.ask.count ?? sweep.fits.length;
      ids = sweep.fits.slice(0, count).map((fit) => fit.companyId);
    } else if (available.has("list_my_relationships")) {
      const own = await execute(
        "list_my_relationships",
        {},
        "q-companies-map-own",
      );
      const set = ownSetOf(own?.result.ok === true ? own.result.data : null);
      ids = [...set.relationships, ...set.saved].map((row) => row.id);
    }
  }
  ids = [...new Set(ids.map((id) => id.toLowerCase()))].slice(0, PLACE_CAP);
  // Each company's own declared profile, side by side, as this person may
  // see it; one the plan does not admit is simply not on the map.
  const missing = ids.filter((id) => !profiles.has(id));
  const read = await Promise.all(
    missing.map((companyId, index) =>
      execute(
        "get_company",
        { companyId },
        `q-companies-map-get-${String(index)}`,
      ),
    ),
  );
  for (const outcome of read) {
    const profile = profileOf(outcome);
    if (profile !== null)
      profiles.set(profile.companyId.toLowerCase(), profile);
  }
  const ordered = ids.flatMap((id) => {
    const profile = profiles.get(id);
    return profile === undefined ? [] : [profile];
  });
  if (ordered.length === 0) return null;
  const located = ordered.some((one) => one.headquartersCountry !== null);
  if (!located && PUBLIC_ASKED.test(input.asked)) return null;
  const run = new RunRead();
  for (const profile of ordered) {
    run.companyNames.set(profile.companyId, profile.canonicalName);
    const code = profile.headquartersCountry?.toUpperCase() ?? null;
    if (code !== null && /^[A-Z]{2}$/u.test(code)) {
      run.countries.set(profile.companyId, code);
    }
  }
  const map = companiesMapBlock(run);
  return {
    text: companiesMapLine(ordered),
    blocks: map === null ? [] : [map],
    calls,
  };
}
