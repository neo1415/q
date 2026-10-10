/**
 * Country mentions in public text (CQ-Q-RESEARCH-001 §17-§20).
 *
 * A small, static table of ISO 3166-1 alpha-2 codes and the names a page
 * would use. It exists so a deterministic comparison can say "this public
 * source mentions Kenya; Capital Q records headquarters in Nigeria" without
 * a model deciding what counts as a geography. Coverage favours the markets
 * Capital Q serves; a country not listed is simply not detected — absence
 * is not a negative finding.
 */

export type CountryEntry = {
  readonly code: string;
  readonly name: string;
  /** Adjectival and short forms a page uses. */
  readonly aliases: readonly string[];
};

export const COUNTRIES: readonly CountryEntry[] = [
  { code: "NG", name: "Nigeria", aliases: ["nigerian", "lagos", "abuja"] },
  { code: "KE", name: "Kenya", aliases: ["kenyan", "nairobi"] },
  { code: "GH", name: "Ghana", aliases: ["ghanaian", "accra"] },
  {
    code: "ZA",
    name: "South Africa",
    aliases: ["south african", "johannesburg", "cape town"],
  },
  { code: "EG", name: "Egypt", aliases: ["egyptian", "cairo"] },
  { code: "MA", name: "Morocco", aliases: ["moroccan", "casablanca"] },
  { code: "TN", name: "Tunisia", aliases: ["tunisian"] },
  { code: "DZ", name: "Algeria", aliases: ["algerian"] },
  { code: "ET", name: "Ethiopia", aliases: ["ethiopian", "addis ababa"] },
  { code: "UG", name: "Uganda", aliases: ["ugandan", "kampala"] },
  { code: "TZ", name: "Tanzania", aliases: ["tanzanian", "dar es salaam"] },
  { code: "RW", name: "Rwanda", aliases: ["rwandan", "kigali"] },
  { code: "SN", name: "Senegal", aliases: ["senegalese", "dakar"] },
  {
    code: "CI",
    name: "Ivory Coast",
    aliases: ["côte d'ivoire", "cote d'ivoire", "ivorian", "abidjan"],
  },
  {
    code: "CM",
    name: "Cameroon",
    aliases: ["cameroonian", "douala", "yaoundé"],
  },
  { code: "ZM", name: "Zambia", aliases: ["zambian", "lusaka"] },
  { code: "ZW", name: "Zimbabwe", aliases: ["zimbabwean", "harare"] },
  { code: "MZ", name: "Mozambique", aliases: ["mozambican", "maputo"] },
  { code: "AO", name: "Angola", aliases: ["angolan", "luanda"] },
  { code: "BW", name: "Botswana", aliases: ["gaborone"] },
  { code: "NA", name: "Namibia", aliases: ["namibian", "windhoek"] },
  { code: "MU", name: "Mauritius", aliases: ["mauritian"] },
  { code: "SD", name: "Sudan", aliases: ["sudanese", "khartoum"] },
  {
    code: "CD",
    name: "DR Congo",
    aliases: ["democratic republic of congo", "drc", "kinshasa"],
  },
  { code: "ML", name: "Mali", aliases: ["malian", "bamako"] },
  { code: "BF", name: "Burkina Faso", aliases: ["ouagadougou"] },
  { code: "BJ", name: "Benin", aliases: ["cotonou"] },
  { code: "TG", name: "Togo", aliases: ["lomé", "lome"] },
  { code: "SL", name: "Sierra Leone", aliases: ["freetown"] },
  { code: "LR", name: "Liberia", aliases: ["monrovia"] },
  { code: "MW", name: "Malawi", aliases: ["lilongwe"] },
  { code: "SO", name: "Somalia", aliases: ["somali", "mogadishu"] },
  {
    code: "US",
    name: "United States",
    aliases: ["usa", "u.s.", "america", "american"],
  },
  {
    code: "GB",
    name: "United Kingdom",
    aliases: ["uk", "britain", "british", "london"],
  },
  { code: "FR", name: "France", aliases: ["french", "paris"] },
  { code: "DE", name: "Germany", aliases: ["german", "berlin"] },
  { code: "NL", name: "Netherlands", aliases: ["dutch", "amsterdam"] },
  {
    code: "AE",
    name: "United Arab Emirates",
    aliases: ["uae", "emirati", "emirates", "dubai", "abu dhabi"],
  },
  {
    code: "SA",
    name: "Saudi Arabia",
    aliases: ["saudi", "saudi arabian", "riyadh", "jeddah"],
  },
  { code: "QA", name: "Qatar", aliases: ["qatari", "doha"] },
  { code: "KW", name: "Kuwait", aliases: ["kuwaiti"] },
  { code: "BH", name: "Bahrain", aliases: ["bahraini", "manama"] },
  { code: "OM", name: "Oman", aliases: ["omani", "muscat"] },
  { code: "JO", name: "Jordan", aliases: ["jordanian", "amman"] },
  { code: "LB", name: "Lebanon", aliases: ["lebanese", "beirut"] },
  { code: "IQ", name: "Iraq", aliases: ["iraqi", "baghdad"] },
  { code: "LY", name: "Libya", aliases: ["libyan", "tripoli"] },
  {
    code: "IN",
    name: "India",
    aliases: ["indian", "bangalore", "bengaluru", "mumbai"],
  },
  { code: "SG", name: "Singapore", aliases: ["singaporean"] },
  { code: "CN", name: "China", aliases: ["chinese"] },
  {
    code: "BR",
    name: "Brazil",
    aliases: ["brazilian", "são paulo", "sao paulo"],
  },
  { code: "CA", name: "Canada", aliases: ["canadian", "toronto"] },
  { code: "PK", name: "Pakistan", aliases: ["pakistani", "karachi"] },
  { code: "ID", name: "Indonesia", aliases: ["indonesian", "jakarta"] },
];

const BY_CODE = new Map(COUNTRIES.map((entry) => [entry.code, entry]));

export function countryName(code: string | null | undefined): string | null {
  if (code === null || code === undefined) {
    return null;
  }
  return BY_CODE.get(code.toUpperCase())?.name ?? null;
}

function mentions(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}])${escaped}(?![\\p{L}])`, "iu").test(text);
}

/** ISO codes of every listed country the text names, in table order. */
export function mentionedCountries(text: string): readonly string[] {
  if (text.length === 0) {
    return [];
  }
  return COUNTRIES.filter(
    (entry) =>
      mentions(text, entry.name) ||
      entry.aliases.some((alias) => mentions(text, alias)),
  ).map((entry) => entry.code);
}

const GCC = ["AE", "SA", "QA", "KW", "BH", "OM"] as const;
const LEVANT_AND_NORTH = [
  "EG",
  "JO",
  "LB",
  "IQ",
  "MA",
  "TN",
  "DZ",
  "LY",
] as const;

/**
 * Region words as a member says them, each with the countries it means.
 * "Arab" is the League's members the table covers; "Middle East" and "MENA"
 * add the same set, because the table lists no non-Arab Middle East market
 * an investor search should lean on. A word not here is simply not a region.
 */
const REGION_WORDS: readonly {
  readonly words: readonly string[];
  readonly countries: readonly string[];
}[] = [
  {
    words: [
      "gcc",
      "gulf",
      "khaleeji",
      "khaliji",
      "persian gulf",
      "الخليج",
      "خليجي",
    ],
    countries: GCC,
  },
  {
    words: [
      "arab",
      "arabs",
      "arabic",
      "arab world",
      "mena",
      "middle east",
      "middle eastern",
      "mideast",
      "عربي",
      "عرب",
    ],
    countries: [...GCC, ...LEVANT_AND_NORTH, "SD", "SO"],
  },
];

/**
 * The countries a member's region words mean, in table order: "Arab
 * investors", "Gulf money", "who in Qatar" all resolve here, with no
 * keyword list of asks. A named country (or its adjective or capital)
 * counts as itself. Pure; an unknown word yields no country, which callers
 * treat as "no region filter", never as a negative finding.
 */
export function regionCountries(text: string): readonly string[] {
  if (text.trim().length === 0) {
    return [];
  }
  // "United Arab Emirates" and "Saudi Arabia" name a country, not the Arab world.
  const plain = text
    .replace(/united\s+arab\s+emirates/giu, " uae ")
    .replace(/saudi\s+arabia/giu, " saudi ");
  const found = new Set<string>(mentionedCountries(plain));
  for (const region of REGION_WORDS) {
    if (region.words.some((word) => mentions(plain, word))) {
      for (const code of region.countries) {
        found.add(code);
      }
    }
  }
  return COUNTRIES.filter((entry) => found.has(entry.code)).map(
    (entry) => entry.code,
  );
}
