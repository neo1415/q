import { foldLatin } from "./script.js";
import { scoreOrgNames } from "./org.js";
import { scorePersonNames, type NameGrade } from "./person.js";

/**
 * Proper-name intelligence, step 6: a name with its clues. "Shadi Qishta,
 * Doha, from Midmac" is a name, a city and an employer. Clues corroborate
 * or contradict; an UNKNOWN clue is neither. A name match alone never
 * makes two records one person: callers get ranked candidates with the
 * evidence behind each, and `decide` only names ONE when a corroborating
 * clue and a clear margin say so.
 */

type PlaceKind = "city" | "country";
const PLACES: Record<
  string,
  { kind: PlaceKind; canonical: string; country?: string }
> = {};
const place = (
  kind: PlaceKind,
  canonical: string,
  country: string | undefined,
  aliases: readonly string[],
): void => {
  for (const alias of [canonical, ...aliases]) {
    PLACES[placeKey(alias)] = {
      kind,
      canonical,
      ...(country === undefined ? {} : { country }),
    };
  }
};
function placeKey(text: string): string {
  return /[؀-ۿ]/u.test(text) ? text.replace(/\s+/gu, "") : foldLatin(text);
}
place("country", "qatar", undefined, ["قطر", "state of qatar"]);
place("country", "nigeria", undefined, ["نيجيريا"]);
place("country", "uae", undefined, [
  "united arab emirates",
  "الامارات",
  "الإمارات",
]);
place("country", "saudi arabia", undefined, ["ksa", "saudi", "السعودية"]);
place("country", "kuwait", undefined, ["الكويت"]);
place("country", "bahrain", undefined, ["البحرين"]);
place("country", "oman", undefined, ["عمان", "سلطنة عمان"]);
place("country", "egypt", undefined, ["مصر"]);
place("country", "united kingdom", undefined, ["uk", "britain", "england"]);
place("city", "doha", "qatar", ["الدوحة"]);
place("city", "lusail", "qatar", ["لوسيل"]);
place("city", "al khor", "qatar", ["الخور"]);
place("city", "al wakrah", "qatar", ["الوكرة", "wakra"]);
place("city", "lagos", "nigeria", ["لاغوس"]);
place("city", "abuja", "nigeria", []);
place("city", "port harcourt", "nigeria", ["ph"]);
place("city", "kano", "nigeria", []);
place("city", "ibadan", "nigeria", []);
place("city", "dubai", "uae", ["دبي"]);
place("city", "abu dhabi", "uae", ["ابوظبي", "أبوظبي"]);
place("city", "riyadh", "saudi arabia", ["الرياض"]);
place("city", "jeddah", "saudi arabia", ["jedda", "جدة"]);
place("city", "kuwait city", "kuwait", []);
place("city", "manama", "bahrain", ["المنامة"]);
place("city", "muscat", "oman", ["مسقط"]);
place("city", "cairo", "egypt", ["القاهرة"]);
place("city", "london", "united kingdom", []);

export type Place = { kind: PlaceKind; canonical: string; country?: string };

/** A known place named by the whole of `text`, in either script. */
export function findPlace(text: string): Place | null {
  return PLACES[placeKey(text.trim())] ?? null;
}

export type NameClues = {
  readonly city?: string | undefined;
  readonly country?: string | undefined;
  readonly employer?: string | undefined;
};

export type Mention = { readonly name: string; readonly clues: NameClues };

/**
 * "Shadi Qishta, Doha, from Midmac" / "Shadi Qishta from Midmac in Doha"
 * to the name and its clues. A segment that is neither a known place nor
 * introduced by from/at/with/of is left out: unknown stays unknown.
 */
export function parseMention(text: string): Mention {
  const pieces = text
    .split(/\s*[,;،]\s*|\s+(?=(?:from|at|with|of|in|based in)\s)/iu)
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0);
  const name = pieces.shift() ?? "";
  let city: string | undefined;
  let country: string | undefined;
  let employer: string | undefined;
  const take = (found: Place): void => {
    if (found.kind === "city") {
      city ??= found.canonical;
      country ??= found.country;
    } else country ??= found.canonical;
  };
  for (const piece of pieces) {
    const lead = /^(from|at|with|of|in|based in)\s+(?:the\s+)?(.+)$/iu.exec(
      piece,
    );
    const body = lead?.[2]?.trim() ?? piece;
    const found = findPlace(body);
    if (found !== null) take(found);
    else if (lead !== null && lead[1]?.toLowerCase() !== "in") {
      employer ??= body.replace(/[.?!]+$/u, "");
    }
  }
  return {
    name,
    clues: {
      ...(city === undefined ? {} : { city }),
      ...(country === undefined ? {} : { country }),
      ...(employer === undefined ? {} : { employer }),
    },
  };
}

export type NameCandidate = {
  readonly id: string;
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly city?: string | undefined;
  readonly country?: string | undefined;
  readonly employer?: string | undefined;
  /** Other names of the employer (e.g. a seeded organisation's aliases). */
  readonly employerAliases?: readonly string[];
};

export type Corroboration = "EMPLOYER" | "CITY" | "COUNTRY";

export type RankedCandidate = {
  readonly id: string;
  /** Name evidence alone. */
  readonly nameScore: number;
  readonly grade: NameGrade;
  /** Name evidence adjusted by clues; still not a probability. */
  readonly score: number;
  readonly corroborations: readonly Corroboration[];
  readonly conflicts: readonly Corroboration[];
  /**
   * The name is at least a possible match AND an independent clue
   * agrees (the employer, or city and country together) AND no clue
   * disagrees. Only then may a caller treat it as the same one.
   */
  readonly corroborated: boolean;
};

const placeOf = (text: string | undefined): Place | null =>
  text === undefined ? null : findPlace(text);

export type RankOptions = {
  readonly kind: "person" | "organisation";
  /** Candidates below this name score are not returned. */
  readonly floor?: number;
};

export function rankCandidates(
  query: Mention,
  candidates: readonly NameCandidate[],
  options: RankOptions,
): readonly RankedCandidate[] {
  const scorer = options.kind === "person" ? scorePersonNames : scoreOrgNames;
  const floor = options.floor ?? 0.5;
  const wantCity = placeOf(query.clues.city);
  const wantCountry = placeOf(query.clues.country);
  const ranked: RankedCandidate[] = [];
  for (const candidate of candidates) {
    const names = [candidate.name, ...(candidate.aliases ?? [])];
    const best = names
      .map((name) => scorer(query.name, name))
      .reduce((a, b) => (b.score > a.score ? b : a));
    if (best.score < floor) continue;
    const corroborations: Corroboration[] = [];
    const conflicts: Corroboration[] = [];
    let score = best.score;
    if (
      query.clues.employer !== undefined &&
      candidate.employer !== undefined
    ) {
      const clue = query.clues.employer;
      const employer = [
        candidate.employer,
        ...(candidate.employerAliases ?? []),
      ]
        .map((name) => scoreOrgNames(clue, name))
        .reduce((a, b) => (b.score > a.score ? b : a));
      if (employer.score >= 0.85) {
        corroborations.push("EMPLOYER");
        score += 0.12;
      } else if (employer.score < 0.5) {
        conflicts.push("EMPLOYER");
        score -= 0.1;
      }
    }
    const haveCity = placeOf(candidate.city);
    if (wantCity !== null && haveCity !== null) {
      if (wantCity.canonical === haveCity.canonical) {
        corroborations.push("CITY");
        score += 0.05;
      } else {
        conflicts.push("CITY");
        score -= 0.08;
      }
    }
    const haveCountry =
      placeOf(candidate.country) ??
      (haveCity?.country === undefined ? null : findPlace(haveCity.country));
    const wantCountryResolved =
      wantCountry ??
      (wantCity?.country === undefined ? null : findPlace(wantCity.country));
    if (wantCountryResolved !== null && haveCountry !== null) {
      if (wantCountryResolved.canonical === haveCountry.canonical) {
        corroborations.push("COUNTRY");
        score += 0.03;
      } else {
        conflicts.push("COUNTRY");
        score -= 0.08;
      }
    }
    score = Math.max(0, Math.min(1, score));
    const places = corroborations.filter((c) => c !== "EMPLOYER").length;
    ranked.push({
      id: candidate.id,
      nameScore: best.score,
      grade: best.grade,
      score,
      corroborations,
      conflicts,
      corroborated:
        best.score >= 0.7 &&
        !best.partial &&
        conflicts.length === 0 &&
        (corroborations.includes("EMPLOYER") || places >= 2),
    });
  }
  return ranked.sort((a, b) => b.score - a.score);
}

export type Decision =
  | { readonly kind: "ONE"; readonly candidate: RankedCandidate }
  | {
      readonly kind: "SEVERAL";
      readonly candidates: readonly RankedCandidate[];
    }
  | { readonly kind: "NONE" };

export type DecideOptions = {
  /** Minimum adjusted score for the top candidate. */
  readonly minScore?: number;
  /** The top must lead the runner-up by at least this much. */
  readonly margin?: number;
  /**
   * Candidates are the asker's own records (their contacts, their
   * company), so a strong name match may stand without a clue. Public or
   * cross-tenant search keeps this false: corroboration is then required.
   */
  readonly withinOwnRecords?: boolean;
};

/** A caller's default threshold policy; callers may use their own. */
export function decide(
  ranked: readonly RankedCandidate[],
  options: DecideOptions = {},
): Decision {
  const minScore = options.minScore ?? 0.85;
  const margin = options.margin ?? 0.1;
  const usable = ranked.filter(
    (one) =>
      one.score >= minScore &&
      one.conflicts.length === 0 &&
      (options.withinOwnRecords === true || one.corroborated),
  );
  const top = usable[0];
  if (top === undefined)
    return ranked.length === 0
      ? { kind: "NONE" }
      : { kind: "SEVERAL", candidates: ranked };
  const next = ranked.find((one) => one.id !== top.id);
  if (next !== undefined && top.score - next.score < margin) {
    return { kind: "SEVERAL", candidates: ranked };
  }
  return { kind: "ONE", candidate: top };
}
