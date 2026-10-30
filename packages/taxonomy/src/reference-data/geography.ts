import type { NodeSpec, VocabularySpec } from "./spec.js";

/**
 * The geography vocabulary of the reference taxonomy: regions and every
 * ISO 3166-1 country, each country with its alpha-2 code in metadata.
 *
 * This is Capital Q's one canonical country list. It is pure data (no
 * node:crypto, no database), so `@capital-q/taxonomy/countries` can read it
 * in the browser as well as on the server. Rendered into migrations by the
 * reference-data builder; adding a country is a reviewed change here plus
 * a migration.
 */

export function country(
  code: string,
  name: string,
  iso: string,
  parent: string,
): NodeSpec {
  return {
    code,
    name,
    parent,
    metadata: { iso3166Alpha2: iso },
    aliases: [{ alias: iso, type: "ABBREVIATION" }],
  };
}

/** A node spec with extra plain-language synonyms (e.g. "Ivory Coast"). */
export function withAliases(
  spec: NodeSpec,
  synonyms: readonly string[],
): NodeSpec {
  return { ...spec, aliases: [...(spec.aliases ?? []), ...synonyms] };
}

/**
 * ISO 3166-1 alpha-2 codes that are also everyday words or investment
 * shorthand ("no", "it", "me", "VC", "PE", "AI", "ML", "BD"): never an
 * alias, so a phrase such as "no restriction" or "VC-backed" does not name
 * a place.
 * The country is still found by its name and synonyms; its ISO code stays
 * in metadata for headquarters matching. Curated reference data.
 */
const ISO_CODES_NOT_ALIASES: ReadonlySet<string> = new Set(
  (
    "AD AG AI AL AM AR AS AT BD BE BI BS BY CC CO CV CX DM DO ER " +
    "FM GA GP HR ID IM IO IQ IR IS IT LA MD ME ML MS MY NA NE NO " +
    "PA PE PM PR PS SO ST TM TO TV VA VC"
  ).split(" "),
);

/**
 * A country added by geography v5 (every ISO 3166-1 country): as
 * `country`, with its synonyms, and without an ISO alias that is a word.
 */
function place(
  code: string,
  name: string,
  iso: string,
  parent: string,
  synonyms: readonly string[] = [],
): NodeSpec {
  const spec = country(code, name, iso, parent);
  return {
    ...spec,
    aliases: [
      ...(ISO_CODES_NOT_ALIASES.has(iso) ? [] : (spec.aliases ?? [])),
      ...synonyms,
    ],
  };
}

export const GEOGRAPHY_VOCABULARY: VocabularySpec = {
  code: "geography",
  name: "Geography",
  description:
    "Operating and target markets: regions and countries. Regional containment is a pragmatic MVP grouping, not a political statement.",
  // v2 (CQ-ACCEPT-001): an investor named Côte d'Ivoire and only Ghana
  // could be recorded. More of the markets investors here name, and a
  // Central Africa region. v3 (2026-10-15): Qatar and the other GCC
  // countries under the Middle East. v4 (2026-10-24): the Gulf (GCC)
  // region between them. v5 (live recheck 2026-10-30): every ISO 3166-1
  // country ("Benelux and the Nordics" could not be placed), with the
  // regions investors name whose members are all new (the Nordics,
  // Central & Eastern Europe, Southern Europe, East and Central Asia,
  // Central America, the Caribbean), Oceania and Antarctica. Countries
  // already listed keep their parents: a region that would contain one
  // of them (Benelux, Western Europe, Southeast Asia) is not added here,
  // as that means re-parenting existing rows.
  version: 5,
  nodes: [
    {
      code: "global",
      name: "Global",
      description: "No geographic restriction.",
    },
    { code: "africa", name: "Africa" },
    { code: "west_africa", name: "West Africa", parent: "africa" },
    country("nigeria", "Nigeria", "NG", "west_africa"),
    country("ghana", "Ghana", "GH", "west_africa"),
    withAliases(country("cote_divoire", "Côte d'Ivoire", "CI", "west_africa"), [
      "Ivory Coast",
      "Cote d'Ivoire",
      "Cote dIvoire",
    ]),
    country("senegal", "Senegal", "SN", "west_africa"),
    country("benin", "Benin", "BJ", "west_africa"),
    country("togo", "Togo", "TG", "west_africa"),
    { code: "east_africa", name: "East Africa", parent: "africa" },
    country("kenya", "Kenya", "KE", "east_africa"),
    country("rwanda", "Rwanda", "RW", "east_africa"),
    country("uganda", "Uganda", "UG", "east_africa"),
    country("tanzania", "Tanzania", "TZ", "east_africa"),
    country("ethiopia", "Ethiopia", "ET", "east_africa"),
    { code: "central_africa", name: "Central Africa", parent: "africa" },
    country("cameroon", "Cameroon", "CM", "central_africa"),
    withAliases(
      country(
        "dr_congo",
        "Democratic Republic of the Congo",
        "CD",
        "central_africa",
      ),
      ["DRC", "DR Congo", "Congo-Kinshasa"],
    ),
    { code: "southern_africa", name: "Southern Africa", parent: "africa" },
    country("south_africa", "South Africa", "ZA", "southern_africa"),
    country("zambia", "Zambia", "ZM", "southern_africa"),
    country("botswana", "Botswana", "BW", "southern_africa"),
    { code: "north_africa", name: "North Africa", parent: "africa" },
    country("egypt", "Egypt", "EG", "north_africa"),
    country("morocco", "Morocco", "MA", "north_africa"),
    country("tunisia", "Tunisia", "TN", "north_africa"),
    { code: "europe", name: "Europe" },
    country("united_kingdom", "United Kingdom", "GB", "europe"),
    country("germany", "Germany", "DE", "europe"),
    country("france", "France", "FR", "europe"),
    country("netherlands", "Netherlands", "NL", "europe"),
    { code: "north_america", name: "North America" },
    country("united_states", "United States", "US", "north_america"),
    country("canada", "Canada", "CA", "north_america"),
    { code: "middle_east", name: "Middle East" },
    // v4 (QA F-81, 2026-10-24): "Egypt, Morocco and the Gulf" kept only
    // Egypt and Morocco, as nothing named the Gulf. The six GCC countries
    // now sit under their own region (same ids), so "the Gulf" means those
    // six and the Middle East still contains them.
    {
      code: "gcc",
      name: "Gulf (GCC)",
      parent: "middle_east",
      description: "The Gulf Cooperation Council countries.",
      aliases: [
        "the Gulf",
        "Gulf",
        "Gulf states",
        "Arabian Gulf",
        { alias: "GCC", type: "ABBREVIATION" },
      ],
    },
    country("united_arab_emirates", "United Arab Emirates", "AE", "gcc"),
    // v3 (2026-10-15): the Gulf. Qatar-based founders and investors had
    // no node to name their own market.
    withAliases(country("qatar", "Qatar", "QA", "gcc"), ["Doha"]),
    withAliases(country("saudi_arabia", "Saudi Arabia", "SA", "gcc"), [
      "KSA",
      "Saudi",
    ]),
    country("kuwait", "Kuwait", "KW", "gcc"),
    country("bahrain", "Bahrain", "BH", "gcc"),
    country("oman", "Oman", "OM", "gcc"),
    { code: "asia", name: "Asia" },
    country("india", "India", "IN", "asia"),
    country("singapore", "Singapore", "SG", "asia"),
    { code: "latin_america", name: "Latin America" },
    country("brazil", "Brazil", "BR", "latin_america"),
    // v5 (live recheck 2026-10-30): every other ISO 3166-1 country.
    // Africa, into the existing regions.
    place("burkina_faso", "Burkina Faso", "BF", "west_africa"),
    place("cabo_verde", "Cabo Verde", "CV", "west_africa", ["Cape Verde"]),
    place("gambia", "Gambia", "GM", "west_africa", ["The Gambia"]),
    place("guinea", "Guinea", "GN", "west_africa"),
    place("guinea_bissau", "Guinea-Bissau", "GW", "west_africa"),
    place("liberia", "Liberia", "LR", "west_africa"),
    place("mali", "Mali", "ML", "west_africa"),
    place("mauritania", "Mauritania", "MR", "west_africa"),
    place("niger", "Niger", "NE", "west_africa"),
    place("sierra_leone", "Sierra Leone", "SL", "west_africa"),
    place(
      "saint_helena",
      "Saint Helena, Ascension and Tristan da Cunha",
      "SH",
      "west_africa",
      ["Saint Helena", "St Helena"],
    ),
    place("burundi", "Burundi", "BI", "east_africa"),
    place("comoros", "Comoros", "KM", "east_africa"),
    place("djibouti", "Djibouti", "DJ", "east_africa"),
    place("eritrea", "Eritrea", "ER", "east_africa"),
    place("madagascar", "Madagascar", "MG", "east_africa"),
    place("mauritius", "Mauritius", "MU", "east_africa"),
    place("seychelles", "Seychelles", "SC", "east_africa"),
    place("somalia", "Somalia", "SO", "east_africa"),
    place("south_sudan", "South Sudan", "SS", "east_africa"),
    place("reunion", "Réunion", "RE", "east_africa", ["Reunion"]),
    place("mayotte", "Mayotte", "YT", "east_africa"),
    place(
      "british_indian_ocean_territory",
      "British Indian Ocean Territory",
      "IO",
      "east_africa",
    ),
    place("angola", "Angola", "AO", "central_africa"),
    place(
      "central_african_republic",
      "Central African Republic",
      "CF",
      "central_africa",
    ),
    place("chad", "Chad", "TD", "central_africa"),
    place(
      "republic_of_the_congo",
      "Republic of the Congo",
      "CG",
      "central_africa",
      ["Congo-Brazzaville", "Congo Republic"],
    ),
    place("gabon", "Gabon", "GA", "central_africa"),
    place("equatorial_guinea", "Equatorial Guinea", "GQ", "central_africa"),
    place(
      "sao_tome_and_principe",
      "São Tomé and Príncipe",
      "ST",
      "central_africa",
      ["Sao Tome and Principe"],
    ),
    place("namibia", "Namibia", "NA", "southern_africa"),
    place("zimbabwe", "Zimbabwe", "ZW", "southern_africa"),
    place("mozambique", "Mozambique", "MZ", "southern_africa"),
    place("malawi", "Malawi", "MW", "southern_africa"),
    place("lesotho", "Lesotho", "LS", "southern_africa"),
    place("eswatini", "Eswatini", "SZ", "southern_africa", ["Swaziland"]),
    place("algeria", "Algeria", "DZ", "north_africa"),
    place("libya", "Libya", "LY", "north_africa"),
    place("sudan", "Sudan", "SD", "north_africa"),
    place("western_sahara", "Western Sahara", "EH", "north_africa"),
    // Europe: the rest of Western Europe beside the countries already
    // under Europe, then the regions whose members are all new.
    place("ireland", "Ireland", "IE", "europe", ["Republic of Ireland"]),
    place("belgium", "Belgium", "BE", "europe"),
    place("luxembourg", "Luxembourg", "LU", "europe"),
    place("austria", "Austria", "AT", "europe"),
    place("switzerland", "Switzerland", "CH", "europe"),
    place("liechtenstein", "Liechtenstein", "LI", "europe"),
    place("monaco", "Monaco", "MC", "europe"),
    place("isle_of_man", "Isle of Man", "IM", "europe"),
    place("jersey", "Jersey", "JE", "europe"),
    place("guernsey", "Guernsey", "GG", "europe"),
    {
      code: "nordics",
      name: "Nordics",
      parent: "europe",
      description: "The Nordic countries and their territories.",
      aliases: [
        "the Nordics",
        "Nordic countries",
        "Nordic region",
        "Scandinavia",
      ],
    },
    place("denmark", "Denmark", "DK", "nordics"),
    place("sweden", "Sweden", "SE", "nordics"),
    place("norway", "Norway", "NO", "nordics"),
    place("finland", "Finland", "FI", "nordics"),
    place("iceland", "Iceland", "IS", "nordics"),
    place("faroe_islands", "Faroe Islands", "FO", "nordics"),
    place("aland_islands", "Åland Islands", "AX", "nordics", ["Aland Islands"]),
    place("greenland", "Greenland", "GL", "nordics"),
    place("svalbard_and_jan_mayen", "Svalbard and Jan Mayen", "SJ", "nordics"),
    {
      code: "central_eastern_europe",
      name: "Central & Eastern Europe",
      parent: "europe",
      aliases: [
        "Central and Eastern Europe",
        "Eastern Europe",
        { alias: "CEE", type: "ABBREVIATION" },
      ],
    },
    place("poland", "Poland", "PL", "central_eastern_europe"),
    place("czechia", "Czechia", "CZ", "central_eastern_europe", [
      "Czech Republic",
    ]),
    place("slovakia", "Slovakia", "SK", "central_eastern_europe"),
    place("hungary", "Hungary", "HU", "central_eastern_europe"),
    place("romania", "Romania", "RO", "central_eastern_europe"),
    place("bulgaria", "Bulgaria", "BG", "central_eastern_europe"),
    place("slovenia", "Slovenia", "SI", "central_eastern_europe"),
    place("croatia", "Croatia", "HR", "central_eastern_europe"),
    place("estonia", "Estonia", "EE", "central_eastern_europe"),
    place("latvia", "Latvia", "LV", "central_eastern_europe"),
    place("lithuania", "Lithuania", "LT", "central_eastern_europe"),
    place("serbia", "Serbia", "RS", "central_eastern_europe"),
    place(
      "bosnia_and_herzegovina",
      "Bosnia and Herzegovina",
      "BA",
      "central_eastern_europe",
      ["Bosnia"],
    ),
    place("montenegro", "Montenegro", "ME", "central_eastern_europe"),
    place("north_macedonia", "North Macedonia", "MK", "central_eastern_europe"),
    place("albania", "Albania", "AL", "central_eastern_europe"),
    place("moldova", "Moldova", "MD", "central_eastern_europe"),
    place("ukraine", "Ukraine", "UA", "central_eastern_europe"),
    place("belarus", "Belarus", "BY", "central_eastern_europe"),
    place("russia", "Russia", "RU", "central_eastern_europe", [
      "Russian Federation",
    ]),
    { code: "southern_europe", name: "Southern Europe", parent: "europe" },
    place("spain", "Spain", "ES", "southern_europe"),
    place("portugal", "Portugal", "PT", "southern_europe"),
    place("italy", "Italy", "IT", "southern_europe"),
    place("greece", "Greece", "GR", "southern_europe"),
    place("malta", "Malta", "MT", "southern_europe"),
    place("cyprus", "Cyprus", "CY", "southern_europe"),
    place("andorra", "Andorra", "AD", "southern_europe"),
    place("san_marino", "San Marino", "SM", "southern_europe"),
    place("vatican_city", "Vatican City", "VA", "southern_europe", [
      "Holy See",
    ]),
    place("gibraltar", "Gibraltar", "GI", "southern_europe"),
    // North America.
    place("bermuda", "Bermuda", "BM", "north_america"),
    place(
      "saint_pierre_and_miquelon",
      "Saint Pierre and Miquelon",
      "PM",
      "north_america",
    ),
    // Latin America and the Caribbean.
    place("mexico", "Mexico", "MX", "latin_america"),
    place("argentina", "Argentina", "AR", "latin_america"),
    place("bolivia", "Bolivia", "BO", "latin_america"),
    place("chile", "Chile", "CL", "latin_america"),
    place("colombia", "Colombia", "CO", "latin_america"),
    place("ecuador", "Ecuador", "EC", "latin_america"),
    place("falkland_islands", "Falkland Islands", "FK", "latin_america"),
    place("french_guiana", "French Guiana", "GF", "latin_america"),
    place("guyana", "Guyana", "GY", "latin_america"),
    place("paraguay", "Paraguay", "PY", "latin_america"),
    place("peru", "Peru", "PE", "latin_america"),
    place("suriname", "Suriname", "SR", "latin_america"),
    place("uruguay", "Uruguay", "UY", "latin_america"),
    place("venezuela", "Venezuela", "VE", "latin_america"),
    {
      code: "central_america",
      name: "Central America",
      parent: "latin_america",
    },
    place("belize", "Belize", "BZ", "central_america"),
    place("costa_rica", "Costa Rica", "CR", "central_america"),
    place("el_salvador", "El Salvador", "SV", "central_america"),
    place("guatemala", "Guatemala", "GT", "central_america"),
    place("honduras", "Honduras", "HN", "central_america"),
    place("nicaragua", "Nicaragua", "NI", "central_america"),
    place("panama", "Panama", "PA", "central_america"),
    {
      code: "caribbean",
      name: "Caribbean",
      parent: "latin_america",
      aliases: ["the Caribbean"],
    },
    place("anguilla", "Anguilla", "AI", "caribbean"),
    place("antigua_and_barbuda", "Antigua and Barbuda", "AG", "caribbean"),
    place("aruba", "Aruba", "AW", "caribbean"),
    place("bahamas", "Bahamas", "BS", "caribbean", ["The Bahamas"]),
    place("barbados", "Barbados", "BB", "caribbean"),
    place(
      "caribbean_netherlands",
      "Bonaire, Sint Eustatius and Saba",
      "BQ",
      "caribbean",
      ["Caribbean Netherlands", "Bonaire"],
    ),
    place(
      "british_virgin_islands",
      "British Virgin Islands",
      "VG",
      "caribbean",
      ["BVI"],
    ),
    place("cayman_islands", "Cayman Islands", "KY", "caribbean"),
    place("cuba", "Cuba", "CU", "caribbean"),
    place("curacao", "Curaçao", "CW", "caribbean", ["Curacao"]),
    place("dominica", "Dominica", "DM", "caribbean"),
    place("dominican_republic", "Dominican Republic", "DO", "caribbean"),
    place("grenada", "Grenada", "GD", "caribbean"),
    place("guadeloupe", "Guadeloupe", "GP", "caribbean"),
    place("haiti", "Haiti", "HT", "caribbean"),
    place("jamaica", "Jamaica", "JM", "caribbean"),
    place("martinique", "Martinique", "MQ", "caribbean"),
    place("montserrat", "Montserrat", "MS", "caribbean"),
    place("puerto_rico", "Puerto Rico", "PR", "caribbean"),
    place("saint_barthelemy", "Saint Barthélemy", "BL", "caribbean", [
      "Saint Barthelemy",
      "St Barts",
    ]),
    place("saint_kitts_and_nevis", "Saint Kitts and Nevis", "KN", "caribbean", [
      "St Kitts and Nevis",
    ]),
    place("saint_lucia", "Saint Lucia", "LC", "caribbean", ["St Lucia"]),
    place("saint_martin", "Saint Martin (French part)", "MF", "caribbean", [
      "Saint-Martin",
    ]),
    place(
      "saint_vincent_and_the_grenadines",
      "Saint Vincent and the Grenadines",
      "VC",
      "caribbean",
      ["St Vincent and the Grenadines"],
    ),
    place("sint_maarten", "Sint Maarten", "SX", "caribbean"),
    place("trinidad_and_tobago", "Trinidad and Tobago", "TT", "caribbean"),
    place(
      "turks_and_caicos_islands",
      "Turks and Caicos Islands",
      "TC",
      "caribbean",
    ),
    place("us_virgin_islands", "U.S. Virgin Islands", "VI", "caribbean", [
      "US Virgin Islands",
      "USVI",
    ]),
    // The Middle East beside the Gulf.
    place("israel", "Israel", "IL", "middle_east"),
    place("palestine", "Palestine", "PS", "middle_east", [
      "State of Palestine",
      "Palestinian Territories",
    ]),
    place("jordan", "Jordan", "JO", "middle_east"),
    place("lebanon", "Lebanon", "LB", "middle_east"),
    place("syria", "Syria", "SY", "middle_east"),
    place("iraq", "Iraq", "IQ", "middle_east"),
    place("iran", "Iran", "IR", "middle_east"),
    place("yemen", "Yemen", "YE", "middle_east"),
    place("turkey", "Turkey", "TR", "middle_east", ["Türkiye", "Turkiye"]),
    // Asia: South and Southeast Asia sit with India and Singapore under
    // Asia; East and Central Asia are regions of their own.
    place("pakistan", "Pakistan", "PK", "asia"),
    place("bangladesh", "Bangladesh", "BD", "asia"),
    place("sri_lanka", "Sri Lanka", "LK", "asia"),
    place("nepal", "Nepal", "NP", "asia"),
    place("bhutan", "Bhutan", "BT", "asia"),
    place("maldives", "Maldives", "MV", "asia"),
    place("afghanistan", "Afghanistan", "AF", "asia"),
    place("indonesia", "Indonesia", "ID", "asia"),
    place("malaysia", "Malaysia", "MY", "asia"),
    place("thailand", "Thailand", "TH", "asia"),
    place("vietnam", "Vietnam", "VN", "asia", ["Viet Nam"]),
    place("philippines", "Philippines", "PH", "asia", ["The Philippines"]),
    place("myanmar", "Myanmar", "MM", "asia", ["Burma"]),
    place("cambodia", "Cambodia", "KH", "asia"),
    place("laos", "Laos", "LA", "asia", ["Lao PDR"]),
    place("brunei", "Brunei", "BN", "asia", ["Brunei Darussalam"]),
    place("timor_leste", "Timor-Leste", "TL", "asia", ["East Timor"]),
    place("georgia", "Georgia", "GE", "asia"),
    place("armenia", "Armenia", "AM", "asia"),
    place("azerbaijan", "Azerbaijan", "AZ", "asia"),
    { code: "east_asia", name: "East Asia", parent: "asia" },
    place("china", "China", "CN", "east_asia", ["Mainland China", "PRC"]),
    place("hong_kong", "Hong Kong", "HK", "east_asia"),
    place("macao", "Macao", "MO", "east_asia", ["Macau"]),
    place("japan", "Japan", "JP", "east_asia"),
    place("south_korea", "South Korea", "KR", "east_asia", [
      "Korea",
      "Republic of Korea",
    ]),
    place("north_korea", "North Korea", "KP", "east_asia"),
    place("mongolia", "Mongolia", "MN", "east_asia"),
    place("taiwan", "Taiwan", "TW", "east_asia"),
    { code: "central_asia", name: "Central Asia", parent: "asia" },
    place("kazakhstan", "Kazakhstan", "KZ", "central_asia"),
    place("kyrgyzstan", "Kyrgyzstan", "KG", "central_asia"),
    place("tajikistan", "Tajikistan", "TJ", "central_asia"),
    place("turkmenistan", "Turkmenistan", "TM", "central_asia"),
    place("uzbekistan", "Uzbekistan", "UZ", "central_asia"),
    // Oceania.
    { code: "oceania", name: "Oceania", aliases: ["Australasia"] },
    place("australia", "Australia", "AU", "oceania"),
    place("new_zealand", "New Zealand", "NZ", "oceania"),
    place("fiji", "Fiji", "FJ", "oceania"),
    place("papua_new_guinea", "Papua New Guinea", "PG", "oceania"),
    place("samoa", "Samoa", "WS", "oceania"),
    place("tonga", "Tonga", "TO", "oceania"),
    place("vanuatu", "Vanuatu", "VU", "oceania"),
    place("solomon_islands", "Solomon Islands", "SB", "oceania"),
    place("kiribati", "Kiribati", "KI", "oceania"),
    place("tuvalu", "Tuvalu", "TV", "oceania"),
    place("nauru", "Nauru", "NR", "oceania"),
    place("marshall_islands", "Marshall Islands", "MH", "oceania"),
    place("micronesia", "Micronesia", "FM", "oceania", [
      "Federated States of Micronesia",
    ]),
    place("palau", "Palau", "PW", "oceania"),
    place("new_caledonia", "New Caledonia", "NC", "oceania"),
    place("french_polynesia", "French Polynesia", "PF", "oceania"),
    place("guam", "Guam", "GU", "oceania"),
    place("american_samoa", "American Samoa", "AS", "oceania"),
    place(
      "northern_mariana_islands",
      "Northern Mariana Islands",
      "MP",
      "oceania",
    ),
    place("cook_islands", "Cook Islands", "CK", "oceania"),
    place("niue", "Niue", "NU", "oceania"),
    place("tokelau", "Tokelau", "TK", "oceania"),
    place("wallis_and_futuna", "Wallis and Futuna", "WF", "oceania"),
    place("pitcairn_islands", "Pitcairn Islands", "PN", "oceania", [
      "Pitcairn",
    ]),
    place("norfolk_island", "Norfolk Island", "NF", "oceania"),
    place("christmas_island", "Christmas Island", "CX", "oceania"),
    place("cocos_islands", "Cocos (Keeling) Islands", "CC", "oceania", [
      "Cocos Islands",
    ]),
    place(
      "us_minor_outlying_islands",
      "United States Minor Outlying Islands",
      "UM",
      "oceania",
    ),
    // Antarctica: the continent is ISO 3166-1 AQ, with the territories
    // around it.
    {
      code: "antarctica",
      name: "Antarctica",
      metadata: { iso3166Alpha2: "AQ" },
      aliases: [{ alias: "AQ", type: "ABBREVIATION" }],
    },
    place("bouvet_island", "Bouvet Island", "BV", "antarctica"),
    place(
      "heard_and_mcdonald_islands",
      "Heard Island and McDonald Islands",
      "HM",
      "antarctica",
    ),
    place(
      "french_southern_territories",
      "French Southern Territories",
      "TF",
      "antarctica",
    ),
    place(
      "south_georgia_and_south_sandwich_islands",
      "South Georgia and the South Sandwich Islands",
      "GS",
      "antarctica",
      ["South Georgia"],
    ),
  ],
};
