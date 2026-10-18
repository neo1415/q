/**
 * Company search text: one reading of what a person typed, shared by every
 * company search surface (Q's search_companies, "Find my startup", Explore).
 *
 * P13 (2026-10-06): measured on the network, a name search found only exact
 * substrings and listed them alphabetically ("Anchor" could rank below
 * "Anchorage"), "Koolbox" or "Ecko" found nothing, and "Nigerian fintech
 * seed" found nothing because every word had to be in the name. This module
 * reads a query once into:
 *
 *   letters    the name as letters and digits only ("Honey Coin" -> honeycoin)
 *   key        a sound-alike key (c/ck/ch/q -> k, ph -> f, doubles collapsed)
 *   countries  ISO codes from country names, demonyms, regions and capitals
 *   stages     stage codes ("pre-seed", "series A")
 *   terms      the remaining words, each with its sector synonyms
 *
 * and scores a company against it, deterministically. Only what the network
 * view already shows is matched (name, line, city, country, stage, declared
 * sectors); nothing private is searchable, and no score reaches the wire.
 */

export const COMPANY_SEARCH_QUERY_MAX = 120;
const TERMS_MAX = 6;

/** Lower case, accents dropped ("Orphéa" -> "orphea"). */
export function foldSearchText(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function searchLetters(text: string): string {
  return foldSearchText(text).replace(/[^a-z0-9]/g, "");
}

/**
 * Sound-alike key over letters. The SQL twin is SEARCH_KEY_SQL in the
 * repository; keep the two rules in the same order.
 */
export function searchKey(letters: string): string {
  return letters
    .replace(/ph/g, "f")
    .replace(/ck|ch|c|q/g, "k")
    .replace(/x/g, "ks")
    .replace(/z/g, "s")
    .replace(/y/g, "i")
    .replace(/(.)\1+/g, "$1");
}

const AFRICA = [
  "NG",
  "KE",
  "EG",
  "GH",
  "ZA",
  "RW",
  "UG",
  "TZ",
  "SN",
  "CI",
  "MA",
  "TN",
  "ET",
  "CM",
  "BJ",
  "TG",
  "ZM",
  "BW",
  "CD",
];
// Specific before general: "south africa" and "west africa" are read (and
// removed) before "africa" is.
const COUNTRY_WORDS: readonly (readonly [RegExp, readonly string[]])[] = [
  [/\bwest africa(n)?\b/, ["NG", "GH", "SN", "CI", "BJ", "TG"]],
  [/\beast africa(n)?\b/, ["KE", "UG", "TZ", "RW", "ET"]],
  [/\bnigeri(a|an|ans)\b|\blagos\b|\babuja\b/, ["NG"]],
  [/\bkenyan?s?\b|\bnairobi\b/, ["KE"]],
  [/\begypt(ian|ians)?\b|\bcairo\b/, ["EG"]],
  [/\bghana(ian|ians)?\b|\baccra\b/, ["GH"]],
  [/\bsouth african?s?\b|\bjohannesburg\b|\bcape town\b/, ["ZA"]],
  [/\brwand(a|an|ans)\b|\bkigali\b/, ["RW"]],
  [/\bugand(a|an|ans)\b|\bkampala\b/, ["UG"]],
  [/\btanzani(a|an|ans)\b/, ["TZ"]],
  [/\bsenegal(ese)?\b|\bdakar\b/, ["SN"]],
  [/\bmorocc(o|an|ans)\b/, ["MA"]],
  [/\btunisi(a|an|ans)\b/, ["TN"]],
  [/\bethiopi(a|an|ans)\b/, ["ET"]],
  [/\bcote d ?ivoire\b|\bivorian\b|\bivory coast\b/, ["CI"]],
  [
    /\bunited kingdom\b|\buk\b|\bbritain\b|\bbritish\b|\bengland\b|\blondon\b/,
    ["GB"],
  ],
  [
    /\bunited states\b|\busa\b|\bamerican?s?\b|\bnew york\b|\bnyc\b|\bsan francisco\b|\bsilicon valley\b/,
    ["US"],
  ],
  [/\bindia(n|ns)?\b|\bbangalore\b|\bbengaluru\b|\bmumbai\b/, ["IN"]],
  [/\bfrance\b|\bfrench\b|\bparis\b/, ["FR"]],
  [/\bgerman(y|s)?\b|\bberlin\b/, ["DE"]],
  [/\bbrazil(ian|ians)?\b|\bsao paulo\b/, ["BR"]],
  [/\bmexic(o|an|ans)\b/, ["MX"]],
  [/\bvietnam(ese)?\b/, ["VN"]],
  [/\bafrica(n|ns)?\b|\bpan african\b/, AFRICA],
];

const STAGE_WORDS: readonly (readonly [RegExp, string])[] = [
  [/\bpre ?seed\b/, "pre_seed"],
  [/\bseed\b/, "seed"],
  [/\bseries a\b/, "series_a"],
  [/\bseries b\b/, "series_b"],
  [/\bseries [c-z]\b|\bgrowth stage\b/, "series_c_plus"],
];

const STOP = new Set([
  "a",
  "an",
  "and",
  "any",
  "based",
  "building",
  "business",
  "businesses",
  "companies",
  "company",
  "find",
  "firm",
  "firms",
  "for",
  "from",
  "in",
  "is",
  "looking",
  "me",
  "of",
  "on",
  "or",
  "out",
  "round",
  "show",
  "stage",
  "startup",
  "startups",
  "that",
  "the",
  "to",
  "who",
  "with",
  // 2026-10-08: generic words that name no kind of company ("climate tech
  // in Germany" is a climate search).
  "tech",
  "technology",
  "technologies",
  "platform",
  "solution",
  "solutions",
]);

/** Sector words a person types, to what declared profiles say. */
const SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  fintech: ["fintech", "financial", "payment", "banking", "lending", "credit"],
  payment: ["payment"],
  payments: ["payment"],
  bank: ["bank"],
  banking: ["bank"],
  lending: ["lending", "credit", "loan"],
  credit: ["credit", "lending", "loan"],
  health: ["health", "medical", "clinic"],
  healthtech: ["health", "medical", "clinic"],
  healthcare: ["health", "medical", "clinic"],
  medtech: ["medical", "health"],
  climate: ["climate", "energy", "solar", "clean"],
  cleantech: ["climate", "energy", "solar", "clean"],
  solar: ["solar", "energy"],
  energy: ["energy", "solar", "power"],
  edtech: ["education", "edtech", "learning"],
  education: ["education", "edtech", "learning"],
  agritech: ["agri", "farm"],
  agtech: ["agri", "farm"],
  agriculture: ["agri", "farm"],
  logistics: ["logistics", "supply chain", "freight", "shipping"],
  insurtech: ["insur"],
  insurance: ["insur"],
  ai: ["artificial intelligence", "machine learning", " ai "],
  saas: ["saas", "software"],
  software: ["software", "saas"],
  devtools: ["developer"],
  developer: ["developer"],
  b2b: [
    "b2b",
    "business customer",
    "enterprise",
    "small business",
    "businesses",
  ],
  ecommerce: ["commerce"],
  commerce: ["commerce"],
  crypto: ["stablecoin", "crypto", "blockchain"],
  stablecoin: ["stablecoin", "crypto"],
  security: ["security"],
  cybersecurity: ["security"],
  proptech: ["property", "real estate", "proptech"],
  // 2026-10-08: words founders and investors used for the seeded companies
  // that their own descriptions say differently.
  construction: ["construction", "builder", "building site"],
  builder: ["builder", "construction"],
  battery: ["batter", "cell", "energy storage", "stationary storage"],
  batterie: ["batter", "cell", "energy storage", "stationary storage"],
  storage: ["storage", "stored", "cold room", "warehouse"],
  pharma: ["pharma", "medicine", "drug"],
  pharmaceutical: ["pharma", "medicine", "drug"],
  medicine: ["medicine", "pharma", "drug"],
  traceability: ["trac", "serialis", "serializ", "recall"],
  eye: ["eye", "retina", "vision"],
  retinopathy: ["retina", "diabet"],
  screening: ["screen", "refer", "diagnos"],
  regtech: ["regtech", "regulat", "compliance", "supervisor"],
  compliance: ["compliance", "regulat", "supervisor"],
  confidential: ["confidential", "enclave", "sensitive data"],
  invoicing: ["invoic"],
  tax: ["tax", "vat"],
  vat: ["vat", "tax"],
  school: ["school", "education", "fees"],
  customs: ["customs", "clearing", "clearance", "duty"],
  shipping: ["shipping", "freight", "customs", "clearing", "port"],
  homecare: ["home care", "care agenc"],
  grain: ["grain", "warehouse", "agri"],
};

export type CompanySearchTerm = {
  readonly word: string;
  /** Any one of these, as a substring of the folded document, matches. */
  readonly any: readonly string[];
  /**
   * 2026-10-08: the word itself, as typed and stemmed. The same word as a
   * whole word in the document ranks above a longer word that only
   * contains it ("customs" above "customer").
   */
  readonly exact: readonly string[];
};

/**
 * 2026-10-08: how many of a described search's words must match. One or
 * two words: all of them. Three or more: all but one, so a long
 * description still finds the company whose page says one of its words
 * differently ("solar cold storage Kenya" finds solar cold rooms).
 */
export function requiredTermMatches(termCount: number): number {
  return termCount <= 2 ? termCount : termCount - 1;
}

/** Whole-word needles for a term: the word and its plural, space-bounded. */
export function exactNeedles(term: CompanySearchTerm): readonly string[] {
  return term.exact.flatMap((form) => [` ${form} `, ` ${form}s `]);
}

export type ParsedCompanySearch = {
  readonly text: string;
  readonly letters: string;
  readonly key: string;
  /** A website host when the query looks like one ("getanchor.co"). */
  readonly host: string | null;
  readonly countries: readonly string[];
  readonly stages: readonly string[];
  readonly terms: readonly CompanySearchTerm[];
};

const stem = (word: string) =>
  word.length > 4 && word.endsWith("s") && !word.endsWith("ss")
    ? word.slice(0, -1)
    : word;

function hostOf(text: string): string | null {
  if (!/^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(text)) {
    return null;
  }
  try {
    const url = new URL(text.includes("://") ? text : `https://${text}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Read a typed query once. Null when there is nothing to search for. */
export function parseCompanySearch(raw: string): ParsedCompanySearch | null {
  const text = raw.trim().slice(0, COMPANY_SEARCH_QUERY_MAX);
  const letters = searchLetters(text);
  if (letters.length === 0) return null;
  const host = hostOf(text);
  let rest = ` ${foldSearchText(text).replace(/[^a-z0-9]+/g, " ")} `;
  const countries = new Set<string>();
  const stages = new Set<string>();
  // "US" only in capitals: "us" is a pronoun ("companies like us").
  if (/\bUS\b/.test(text)) countries.add("US");
  rest = rest.replace(/ us /g, (match) => (countries.has("US") ? " " : match));
  for (const [re, codes] of COUNTRY_WORDS) {
    if (re.test(rest)) {
      for (const code of codes) countries.add(code);
      rest = rest.replace(new RegExp(re.source, "g"), " ");
    }
  }
  for (const [re, code] of STAGE_WORDS) {
    if (re.test(rest)) {
      stages.add(code);
      rest = rest.replace(new RegExp(re.source, "g"), " ");
    }
  }
  const terms = rest
    .split(" ")
    // A single letter ("e" of "e-invoicing") names nothing.
    .filter((word) => word.length > 1 && !STOP.has(word))
    .slice(0, TERMS_MAX)
    .map((word) => {
      const base = stem(word);
      return {
        word: base,
        any: [...new Set([base, ...(SYNONYMS[word] ?? SYNONYMS[base] ?? [])])],
        exact: [...new Set([word, base])],
      };
    });
  return {
    text,
    letters,
    key: searchKey(letters),
    host,
    countries: [...countries],
    stages: [...stages],
    terms,
  };
}

/** A described query: it names a place, a stage or more than one word. */
export function isDescriptiveSearch(parsed: ParsedCompanySearch): boolean {
  return (
    parsed.countries.length > 0 ||
    parsed.stages.length > 0 ||
    parsed.terms.length > 0
  );
}

function trigrams(value: string): Set<string> {
  const out = new Set<string>();
  const padded = `  ${value} `;
  for (let i = 0; i + 3 <= padded.length; i += 1)
    out.add(padded.slice(i, i + 3));
  return out;
}

/** pg_trgm similarity() over one word (both sides letters only). */
export function trigramSimilarity(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;
  const x = trigrams(a);
  const y = trigrams(b);
  let shared = 0;
  for (const t of x) if (y.has(t)) shared += 1;
  return shared / (x.size + y.size - shared);
}

const sortedLetters = (value: string) => [...value].sort().join("");

/**
 * Letters typed out of order ("Temrly" for Termly, "Mzian" for Mizan):
 * same first letter, same length, same letters. Trigrams miss these on
 * short names. The SQL twin compares the same three things.
 */
export function isTransposition(name: string, letters: string): boolean {
  return (
    letters.length >= 4 &&
    name.length === letters.length &&
    name[0] === letters[0] &&
    name !== letters &&
    sortedLetters(name) === sortedLetters(letters)
  );
}

/** Below this, a close name is noise rather than a misspelling. */
export const FUZZY_NAME_MIN = 0.35;

export type CompanySearchDocument = {
  readonly name: string;
  readonly shortDescription: string | null;
  readonly city?: string | null | undefined;
  readonly country: string | null;
  readonly stage: string | null;
  readonly website?: string | null | undefined;
  /** Declared sector labels (user-selected, admin-curated or confirmed only). */
  readonly labels?: readonly string[] | undefined;
};

/**
 * Score one company, higher first; null when it does not match. The SQL in
 * the repository computes the same tiers.
 *
 *   1000 the name exactly          900 sounds the same       800 name starts with it
 *    950 its website host          650 name contains it      600 sound-alike prefix
 *    550 same letters out of order    300-600 a close name (misspelling)
 *   200+ described: every place, stage and word matches what the profile says
 */
export function scoreCompanySearch(
  parsed: ParsedCompanySearch,
  doc: CompanySearchDocument,
): number | null {
  const name = searchLetters(doc.name);
  const key = searchKey(name);
  let best = 0;
  if (name === parsed.letters) best = 1000;
  else if (
    parsed.host !== null &&
    doc.website &&
    hostOf(doc.website) === parsed.host
  )
    best = 950;
  else if (parsed.letters.length >= 3 && key === parsed.key) best = 900;
  else if (name.startsWith(parsed.letters)) best = 800;
  else if (parsed.letters.length >= 3 && name.includes(parsed.letters))
    best = 650;
  else if (parsed.key.length >= 3 && key.startsWith(parsed.key)) best = 600;
  else if (isTransposition(name, parsed.letters)) best = 550;
  else if (parsed.letters.length >= 3) {
    const sim = Math.max(
      trigramSimilarity(name, parsed.letters),
      trigramSimilarity(key, parsed.key),
      // 2026-10-08: a misspelling of one word of a longer name ("dristi"
      // for Drishti Health).
      ...nameWords(doc.name).map((word) =>
        trigramSimilarity(word, parsed.letters),
      ),
    );
    if (sim >= FUZZY_NAME_MIN) best = 300 + Math.round(300 * sim);
  }
  if (isDescriptiveSearch(parsed)) {
    const described = describedScore(parsed, doc);
    if (described !== null) best = Math.max(best, described);
  }
  return best > 0 ? best : null;
}

/** The name's words of three letters or more, folded. */
export function nameWords(name: string): readonly string[] {
  return foldSearchText(name)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3);
}

function describedScore(
  parsed: ParsedCompanySearch,
  doc: CompanySearchDocument,
): number | null {
  if (
    parsed.countries.length > 0 &&
    !parsed.countries.includes(doc.country ?? "")
  )
    return null;
  if (parsed.stages.length > 0 && !parsed.stages.includes(doc.stage ?? ""))
    return null;
  const haystack = ` ${foldSearchText(
    [
      doc.name,
      doc.shortDescription ?? "",
      doc.city ?? "",
      ...(doc.labels ?? []),
    ].join(" "),
  ).replace(/[^a-z0-9]+/g, " ")} `;
  let matched = 0;
  let exact = 0;
  for (const term of parsed.terms) {
    if (term.any.some((needle) => haystack.includes(needle))) matched += 1;
    if (exactNeedles(term).some((needle) => haystack.includes(needle))) {
      exact += 1;
    }
  }
  if (matched < requiredTermMatches(parsed.terms.length)) return null;
  return (
    200 +
    20 * matched +
    5 * exact +
    10 * (parsed.countries.length > 0 ? 1 : 0) +
    10 * (parsed.stages.length > 0 ? 1 : 0)
  );
}
