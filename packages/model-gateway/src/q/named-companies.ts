/**
 * The companies of their own a turn names (founder live 2026-10-01: "compare
 * Yamfield Agro, Tallyloom and Kazikit against my mandate" was answered
 * "I don't have enough company evidence", though Capital Q holds all three
 * profiles; and spoken names arrive misheard -- "Yamb Fielder grew",
 * "Kazakhit").
 *
 * Resolution is against the person's OWN records only (their relationships,
 * saves and passes, read for them this turn), never against Capital Q at
 * large: what can be found is what they already have. A name is matched
 * approximately, because speech recognition bends names, but only for names
 * long enough that a near miss is still that name; a short name must appear
 * as a word. Each match is then read through get_company under the run's
 * plan, so a company the firewall did not admit is never read.
 */

export type KnownCompany = {
  readonly companyId: string;
  readonly name: string;
};

type StandingRead = {
  readonly relationships?: readonly {
    readonly counterpart?: {
      readonly kind?: unknown;
      readonly id?: unknown;
      readonly name?: unknown;
    };
  }[];
  readonly saved?: readonly {
    readonly companyId?: unknown;
    readonly name?: unknown;
  }[];
  readonly passed?: readonly {
    readonly companyId?: unknown;
    readonly name?: unknown;
  }[];
};

/** Their own companies from list_my_relationships output, once each. */
export function knownCompaniesOf(data: unknown): KnownCompany[] {
  if (typeof data !== "object" || data === null) return [];
  const read = data as StandingRead;
  const seen = new Map<string, KnownCompany>();
  const add = (id: unknown, name: unknown) => {
    if (typeof id !== "string" || typeof name !== "string") return;
    if (name.trim().length === 0 || seen.has(id)) return;
    seen.set(id, { companyId: id, name: name.trim() });
  };
  for (const relationship of read.relationships ?? []) {
    if (relationship.counterpart?.kind === "COMPANY") {
      add(relationship.counterpart.id, relationship.counterpart.name);
    }
  }
  for (const entry of [...(read.saved ?? []), ...(read.passed ?? [])]) {
    add(entry.companyId, entry.name);
  }
  return [...seen.values()];
}

const SUFFIXES =
  /\b(fictional|ltd|limited|inc|plc|llc|technologies|technology|holdings|group|digital|nigeria|kenya|ghana)\b/g;

function letters(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ");
}

/** The distinctive part of a company name, without spaces. */
export function coreOf(name: string): string {
  return letters(name).replace(SUFFIXES, " ").replace(/\s+/g, "");
}

/**
 * The fewest edits that turn `needle` into some stretch of `haystack`
 * (approximate substring match, Sellers): 0 when it appears exactly.
 */
export function nearestDistance(needle: string, haystack: string): number {
  if (needle.length === 0) return 0;
  let previous = new Array<number>(haystack.length + 1).fill(0);
  for (let i = 1; i <= needle.length; i += 1) {
    const current = new Array<number>(haystack.length + 1).fill(i);
    for (let j = 1; j <= haystack.length; j += 1) {
      const cost = needle[i - 1] === haystack[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    previous = current;
  }
  return Math.min(...previous);
}

/** Shorter than this, a name must appear as a word; no near misses. */
const FUZZY_FROM = 6;

/**
 * Their companies the text names, best match first, at most `max`. A near
 * miss is allowed up to a third of the name's length.
 */
export function companiesNamedIn(
  text: string,
  known: readonly KnownCompany[],
  max = 5,
): KnownCompany[] {
  const words = letters(text);
  const squashed = words.replace(/\s+/g, "");
  const scored: { company: KnownCompany; distance: number }[] = [];
  for (const company of known) {
    const core = coreOf(company.name);
    if (core.length < 3) continue;
    if (core.length < FUZZY_FROM) {
      if (new RegExp(`\\b${core}\\b`).test(words)) {
        scored.push({ company, distance: 0 });
      }
      continue;
    }
    const distance = nearestDistance(core, squashed);
    if (distance <= Math.floor(core.length / 3)) {
      scored.push({ company, distance: distance / core.length });
    }
  }
  return scored
    .sort((a, b) => a.distance - b.distance)
    .slice(0, max)
    .map((entry) => entry.company);
}
