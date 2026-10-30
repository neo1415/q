import {
  countryName as canonicalName,
  countryOfCanonicalCode,
} from "@capital-q/taxonomy/countries";

/**
 * Country mentions in public text (CQ-Q-RESEARCH-001 §17-§20).
 *
 * The countries and their names come from the one canonical country list
 * (@capital-q/taxonomy/countries, the geography taxonomy). What this table
 * adds is a different concept: the forms a public page uses for a market
 * Capital Q detects (demonyms, main cities, short forms), so a
 * deterministic comparison can say "this public source mentions Kenya;
 * Capital Q records headquarters in Nigeria" without a model deciding what
 * counts as a geography. Detection covers these markets only, because a
 * bare country name that is also a word or a person's name ("Jordan",
 * "Chad", "Georgia") would otherwise be read as a place; a country not
 * detected is simply not detected -- absence is not a negative finding.
 */

export type CountryEntry = {
  readonly code: string;
  readonly name: string;
  /** Adjectival and short forms a page uses. */
  readonly aliases: readonly string[];
};

/** The forms a page uses for each detected market, by ISO code. */
const PAGE_FORMS: readonly (readonly [string, readonly string[]])[] = [
  ["NG", ["nigerian", "lagos", "abuja"]],
  ["KE", ["kenyan", "nairobi"]],
  ["GH", ["ghanaian", "accra"]],
  ["ZA", ["south african", "johannesburg", "cape town"]],
  ["EG", ["egyptian", "cairo"]],
  ["MA", ["moroccan", "casablanca"]],
  ["TN", ["tunisian"]],
  ["DZ", ["algerian"]],
  ["ET", ["ethiopian", "addis ababa"]],
  ["UG", ["ugandan", "kampala"]],
  ["TZ", ["tanzanian", "dar es salaam"]],
  ["RW", ["rwandan", "kigali"]],
  ["SN", ["senegalese", "dakar"]],
  [
    "CI",
    ["ivory coast", "côte d'ivoire", "cote d'ivoire", "ivorian", "abidjan"],
  ],
  ["CM", ["cameroonian", "douala", "yaoundé"]],
  ["ZM", ["zambian", "lusaka"]],
  ["ZW", ["zimbabwean", "harare"]],
  ["MZ", ["mozambican", "maputo"]],
  ["AO", ["angolan", "luanda"]],
  ["BW", ["gaborone"]],
  ["NA", ["namibian", "windhoek"]],
  ["MU", ["mauritian"]],
  ["SD", ["sudanese", "khartoum"]],
  ["CD", ["dr congo", "democratic republic of congo", "drc", "kinshasa"]],
  ["ML", ["malian", "bamako"]],
  ["BF", ["ouagadougou"]],
  ["BJ", ["cotonou"]],
  ["TG", ["lomé", "lome"]],
  ["SL", ["freetown"]],
  ["LR", ["monrovia"]],
  ["MW", ["lilongwe"]],
  ["SO", ["somali", "mogadishu"]],
  ["US", ["usa", "u.s.", "america", "american"]],
  ["GB", ["uk", "britain", "british", "london"]],
  ["FR", ["french", "paris"]],
  ["DE", ["german", "berlin"]],
  ["NL", ["dutch", "amsterdam"]],
  ["AE", ["uae", "emirati", "emirates", "dubai", "abu dhabi"]],
  ["SA", ["saudi", "saudi arabian", "riyadh", "jeddah"]],
  ["QA", ["qatari", "doha"]],
  ["KW", ["kuwaiti"]],
  ["BH", ["bahraini", "manama"]],
  ["OM", ["omani", "muscat"]],
  ["JO", ["jordanian", "amman"]],
  ["LB", ["lebanese", "beirut"]],
  ["IQ", ["iraqi", "baghdad"]],
  ["LY", ["libyan", "tripoli"]],
  ["IN", ["indian", "bangalore", "bengaluru", "mumbai"]],
  ["SG", ["singaporean"]],
  ["CN", ["chinese"]],
  ["BR", ["brazilian", "são paulo", "sao paulo"]],
  ["CA", ["canadian", "toronto"]],
  ["PK", ["pakistani", "karachi"]],
  ["ID", ["indonesian", "jakarta"]],
];

/**
 * The detected markets: each country's canonical name, then the forms a
 * page uses for it.
 */
export const COUNTRIES: readonly CountryEntry[] = PAGE_FORMS.flatMap(
  ([code, forms]) => {
    const name = canonicalName(code);
    return name === null ? [] : [{ code, name, aliases: forms }];
  },
);

const BY_CODE = new Map(COUNTRIES.map((entry) => [entry.code, entry]));

/** Any ISO 3166-1 country's name, from the one canonical list. */
export function countryName(code: string | null | undefined): string | null {
  return canonicalName(code);
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
      "arabian",
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
  { words: ["قطر", "قطري"], countries: ["QA"] },
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

/**
 * Subnational units of the markets Capital Q serves (owner 2026-10-29:
 * "research must use context the way a human analyst would"): a person who
 * says "Kano" or "Western Cape" means Nigeria or South Africa. Reference
 * data, not a pattern over people's words. `named` units are recognised by
 * their name alone; `qualified` units share their name with an everyday
 * word ("Delta", "Plateau", "Central") and are recognised only with their
 * unit noun ("Delta State", "Central Region").
 */
type SubnationalSet = {
  readonly country: string;
  /** The unit nouns: "state", "county", "region", "province", "governorate". */
  readonly units: readonly string[];
  readonly named: readonly string[];
  readonly qualified: readonly string[];
};

export const SUBNATIONAL: readonly SubnationalSet[] = [
  {
    // The 36 states and the Federal Capital Territory.
    country: "NG",
    units: ["state"],
    named: [
      "Abia",
      "Adamawa",
      "Akwa Ibom",
      "Anambra",
      "Bauchi",
      "Bayelsa",
      "Benue",
      "Borno",
      "Cross River",
      "Ebonyi",
      "Edo",
      "Ekiti",
      "Enugu",
      "Gombe",
      "Imo",
      "Jigawa",
      "Kaduna",
      "Kano",
      "Katsina",
      "Kebbi",
      "Kogi",
      "Kwara",
      "Lagos",
      "Nasarawa",
      "Ogun",
      "Ondo",
      "Osun",
      "Oyo",
      "Sokoto",
      "Taraba",
      "Yobe",
      "Zamfara",
      "Federal Capital Territory",
      "Port Harcourt",
      "Ibadan",
    ],
    qualified: ["Delta", "Niger", "Plateau", "Rivers"],
  },
  {
    // The 47 counties.
    country: "KE",
    units: ["county"],
    named: [
      "Mombasa",
      "Kwale",
      "Kilifi",
      "Tana River",
      "Lamu",
      "Taita-Taveta",
      "Taita Taveta",
      "Garissa",
      "Wajir",
      "Mandera",
      "Marsabit",
      "Isiolo",
      "Meru",
      "Tharaka-Nithi",
      "Tharaka Nithi",
      "Embu",
      "Kitui",
      "Machakos",
      "Makueni",
      "Nyandarua",
      "Nyeri",
      "Kirinyaga",
      "Murang'a",
      "Muranga",
      "Kiambu",
      "Turkana",
      "West Pokot",
      "Samburu",
      "Trans-Nzoia",
      "Trans Nzoia",
      "Uasin Gishu",
      "Elgeyo-Marakwet",
      "Elgeyo Marakwet",
      "Nandi",
      "Baringo",
      "Laikipia",
      "Nakuru",
      "Narok",
      "Kajiado",
      "Kericho",
      "Bomet",
      "Kakamega",
      "Vihiga",
      "Bungoma",
      "Busia",
      "Siaya",
      "Kisumu",
      "Homa Bay",
      "Migori",
      "Kisii",
      "Nyamira",
      "Eldoret",
    ],
    qualified: [],
  },
  {
    // The 16 regions.
    country: "GH",
    units: ["region"],
    named: [
      "Greater Accra",
      "Ashanti",
      "Kumasi",
      "Ahafo",
      "Bono",
      "Bono East",
      "Oti",
      "Upper East",
      "Upper West",
      "Tamale",
      "Takoradi",
    ],
    qualified: [
      "Central",
      "Eastern",
      "Western",
      "Western North",
      "Northern",
      "North East",
      "Savannah",
      "Volta",
    ],
  },
  {
    // The 9 provinces.
    country: "ZA",
    units: ["province"],
    named: [
      "Eastern Cape",
      "Free State",
      "Gauteng",
      "KwaZulu-Natal",
      "KwaZulu Natal",
      "Limpopo",
      "Mpumalanga",
      "Northern Cape",
      "Western Cape",
      "Durban",
      "Pretoria",
    ],
    qualified: ["North West"],
  },
  {
    // The 27 governorates.
    country: "EG",
    units: ["governorate"],
    named: [
      "Alexandria",
      "Aswan",
      "Asyut",
      "Assiut",
      "Beheira",
      "Beni Suef",
      "Dakahlia",
      "Damietta",
      "Faiyum",
      "Fayoum",
      "Gharbia",
      "Giza",
      "Ismailia",
      "Kafr el-Sheikh",
      "Kafr El Sheikh",
      "Luxor",
      "Matrouh",
      "Minya",
      "Monufia",
      "North Sinai",
      "Port Said",
      "Qalyubia",
      "Qena",
      "Sharqia",
      "Sohag",
      "South Sinai",
      "Suez",
    ],
    qualified: ["New Valley", "Red Sea"],
  },
];

/** A country the text places the question in, and the words that did. */
export type PlaceMention = {
  readonly code: string;
  /** The person's word for it ("Lagos State", "Kenyan"). */
  readonly said: string;
};

/**
 * Every listed country the text names, directly (name, demonym, main
 * city) or through one of its subnational units, in table order, each with
 * the words that named it. Pure; a place not listed is simply not found,
 * never a negative finding.
 */
export function placesNamed(text: string): readonly PlaceMention[] {
  if (text.trim().length === 0) return [];
  const found = new Map<string, string>();
  for (const entry of COUNTRIES) {
    const said = [entry.name, ...entry.aliases].find((phrase) =>
      mentions(text, phrase),
    );
    if (said !== undefined) found.set(entry.code, said);
  }
  for (const set of SUBNATIONAL) {
    if (found.has(set.country)) continue;
    const phrases = [
      ...set.named,
      ...[...set.named, ...set.qualified].flatMap((name) =>
        set.units.map((unit) => `${name} ${unit}`),
      ),
    ];
    // The qualified forms first: "Lagos State" is reported whole.
    const said = phrases
      .slice()
      .sort((a, b) => b.length - a.length)
      .find((phrase) => mentions(text, phrase));
    if (said !== undefined) found.set(set.country, said);
  }
  return COUNTRIES.filter((entry) => found.has(entry.code)).map((entry) => ({
    code: entry.code,
    said: found.get(entry.code) ?? entry.name,
  }));
}

/** ISO codes of the countries `placesNamed` finds. */
export function placeCountries(text: string): readonly string[] {
  return placesNamed(text).map((place) => place.code);
}

/** A country's public forms: its name, demonym and main cities. */
export function countryForms(code: string): readonly string[] {
  const entry = BY_CODE.get(code.toUpperCase());
  return entry === undefined ? [] : [entry.name, ...entry.aliases];
}

/**
 * The country a taxonomy geography code names ("south_africa" -> "ZA"),
 * or null for a region: read from the one canonical country list.
 */
export function countryOfCode(code: string): string | null {
  return countryOfCanonicalCode(code.trim().toLowerCase())?.iso ?? null;
}
