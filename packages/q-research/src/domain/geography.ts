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
 * or null for a region or a place not listed.
 */
export function countryOfCode(code: string): string | null {
  const wanted = code.toLowerCase().replace(/[_-]+/gu, " ").trim();
  if (wanted.length === 0) return null;
  const entry = COUNTRIES.find(
    (one) =>
      one.name.toLowerCase() === wanted ||
      one.code.toLowerCase() === wanted ||
      one.aliases.includes(wanted),
  );
  return entry?.code ?? null;
}
