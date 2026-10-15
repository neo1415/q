// The bulk fictional demo world (SEED, fictional-bulk.v1): a deterministic
// generator of invented companies and investor organisations. Pure: no
// network, no clock, no randomness beyond a seeded PRNG keyed by the
// company's own natural key, so a rerun builds byte-identical records and
// the runner can look each one up by key instead of writing it twice.
//
// Every company, person, figure and document here is INVENTED. Websites use
// the reserved `.example` domain; accounts use the non-deliverable
// `fictional.capitalq.local` domain; every long text opens by saying so.
//
// Invariants this file keeps (CLAUDE.md, ADR-001):
// - money is a decimal string plus an ISO 4217 code, never a float;
// - unknown stays unknown: a figure a company has not given is ABSENT (the
//   runner skips that step), never 0;
// - founders get no mandate; investors' GateQ criteria are derived from
//   their own declared mandate, never invented separately;
// - figures are drawn per company, not from a uniform grid.

export const SEED_MARKER = "fictional-bulk.v1";
export const ACCOUNT_DOMAIN = "fictional.capitalq.local";

// ------------------------------------------------------------- PRNG

function hash32(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 over a string key: the same key always draws the same stream. */
export function rngFor(key) {
  let a = hash32(key);
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
    weighted: (pairs) => {
      const total = pairs.reduce((s, [, w]) => s + w, 0);
      let x = next() * total;
      for (const [v, w] of pairs) {
        x -= w;
        if (x < 0) return v;
      }
      return pairs[pairs.length - 1][0];
    },
    /** Log-uniform between lo and hi: raises and revenues are not linear. */
    logUniform: (lo, hi) => Math.exp(Math.log(lo) + next() * Math.log(hi / lo)),
    sample: (list, n) => {
      const copy = [...list];
      const out = [];
      while (out.length < n && copy.length > 0) {
        out.push(copy.splice(Math.floor(next() * copy.length), 1)[0]);
      }
      return out;
    },
  };
  return r;
}

/**
 * A figure a person would actually write: rounded to a granularity that
 * itself varies (some founders say 2.5m, some 2,350,000, some 2,372,500),
 * so the population never sits on one grid.
 */
export function humanAmount(r, value) {
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(value)) - 2);
  const step = r.weighted([
    [magnitude * 50, 2],
    [magnitude * 25, 2],
    [magnitude * 10, 3],
    [magnitude * 5, 3],
    [magnitude, 2],
  ]);
  const rounded = Math.max(step, Math.round(value / step) * step);
  return String(Math.round(rounded));
}

// ----------------------------------------------------- reference data

/** Founder onboarding country option → profile facts. */
export const COUNTRIES = {
  ng: {
    iso: "NG",
    geo: "nigeria",
    region: "west_africa",
    cities: ["Lagos", "Abuja", "Ibadan", "Port Harcourt"],
    local: "ngn",
    w: 16,
  },
  ke: {
    iso: "KE",
    geo: "kenya",
    region: "east_africa",
    cities: ["Nairobi", "Mombasa", "Kisumu"],
    local: "kes",
    w: 12,
  },
  za: {
    iso: "ZA",
    geo: "south_africa",
    region: "southern_africa",
    cities: ["Cape Town", "Johannesburg", "Durban"],
    local: "zar",
    w: 10,
  },
  gh: {
    iso: "GH",
    geo: "ghana",
    region: "west_africa",
    cities: ["Accra", "Kumasi"],
    local: "usd",
    w: 7,
  },
  eg: {
    iso: "EG",
    geo: "egypt",
    region: "north_africa",
    cities: ["Cairo", "Alexandria"],
    local: "usd",
    w: 7,
  },
  ae: {
    iso: "AE",
    geo: "united_arab_emirates",
    region: "middle_east",
    cities: ["Dubai", "Abu Dhabi"],
    local: "aed",
    w: 9,
  },
  gb: {
    iso: "GB",
    geo: "united_kingdom",
    region: "europe",
    cities: ["London", "Manchester", "Edinburgh", "Bristol"],
    local: "gbp",
    w: 8,
  },
  us: {
    iso: "US",
    geo: "united_states",
    region: "north_america",
    cities: ["New York", "Austin", "San Francisco", "Atlanta"],
    local: "usd",
    w: 6,
  },
  de: {
    iso: "DE",
    geo: "germany",
    region: "europe",
    cities: ["Berlin", "Munich", "Hamburg"],
    local: "eur",
    w: 4,
  },
  fr: {
    iso: "FR",
    geo: "france",
    region: "europe",
    cities: ["Paris", "Lyon"],
    local: "eur",
    w: 4,
  },
  nl: {
    iso: "NL",
    geo: "netherlands",
    region: "europe",
    cities: ["Amsterdam", "Rotterdam"],
    local: "eur",
    w: 3,
  },
  in: {
    iso: "IN",
    geo: "india",
    region: "asia",
    cities: ["Bengaluru", "Mumbai", "Pune"],
    local: "inr",
    w: 5,
  },
  sg: {
    iso: "SG",
    geo: "singapore",
    region: "asia",
    cities: ["Singapore"],
    local: "sgd",
    w: 4,
  },
  br: {
    iso: "BR",
    geo: "brazil",
    region: "latin_america",
    cities: ["São Paulo", "Belo Horizonte"],
    local: "usd",
    w: 2,
  },
  ca: {
    iso: "CA",
    geo: "canada",
    region: "north_america",
    cities: ["Toronto", "Vancouver"],
    local: "usd",
    w: 3,
  },
};

/** Units of each currency per US dollar: an approximate demo rate, only to size raises plausibly. */
const PER_USD = {
  usd: 1,
  eur: 0.92,
  gbp: 0.78,
  ngn: 1550,
  kes: 129,
  zar: 18,
  aed: 3.67,
  inr: 84,
  sgd: 1.33,
};
const CURRENCY_CODE = {
  usd: "USD",
  eur: "EUR",
  gbp: "GBP",
  ngn: "NGN",
  kes: "KES",
  zar: "ZAR",
  aed: "AED",
  inr: "INR",
  sgd: "SGD",
};
export const currencyCode = (option) => CURRENCY_CODE[option];

/**
 * Sector archetypes. Taxonomy codes are the hosted canonical codes
 * (industry, product_category, business_model, customer_type).
 */
export const ARCHETYPES = [
  {
    id: "sme_lending",
    codes: [
      "fintech",
      "digital_lending",
      "lending_platform",
      "small_business",
      "transaction_fee",
    ],
    noun: "working-capital credit",
    buyer: "small retailers and traders",
    unit: "borrowers",
    pain: "cannot get credit that matches how fast their stock turns",
    fix: "underwrites short loans from the sales and stock records merchants already keep",
    words: ["Ledger", "Kopa", "Till", "Float", "Credo"],
    hard: false,
    regulated: true,
  },
  {
    id: "xborder",
    codes: [
      "payments",
      "cross_border_payments",
      "business_customer",
      "transaction_fee",
    ],
    noun: "cross-border business payments",
    buyer: "importers and exporters",
    unit: "paying businesses",
    pain: "wait days and lose several percent to settle supplier invoices abroad",
    fix: "nets payment corridors through local collection accounts and settles same day",
    words: ["Corridor", "Remit", "Bridge", "Swift", "Lane"],
    hard: false,
    regulated: true,
  },
  {
    id: "merchant",
    codes: [
      "merchant_payments",
      "payment_infrastructure",
      "small_business",
      "transaction_fee",
    ],
    noun: "merchant acceptance",
    buyer: "informal and small merchants",
    unit: "active merchants",
    pain: "lose sales because they cannot take card or wallet payments cheaply",
    fix: "turns a phone into a terminal and settles to any account the next morning",
    words: ["Tap", "Pay", "Kiosk", "Counter", "Mint"],
    hard: false,
    regulated: true,
  },
  {
    id: "claims",
    codes: ["insurtech", "claims_automation", "insurance_company", "b2b_saas"],
    noun: "claims automation",
    buyer: "mid-sized insurers",
    unit: "insurer clients",
    pain: "settle motor and health claims by paper over weeks",
    fix: "reads claim documents and photos and routes clean claims to straight-through payment",
    words: ["Claim", "Assure", "Adjust", "Cover", "Shield"],
    hard: false,
    regulated: true,
  },
  {
    id: "telehealth",
    codes: ["digital_health", "telehealth", "consumer", "b2c_subscription"],
    noun: "primary-care teleconsultation",
    buyer: "urban families without a regular doctor",
    unit: "subscribing households",
    pain: "queue for hours at clinics for routine care",
    fix: "offers a monthly plan of nurse-led video consults with pharmacy delivery",
    words: ["Care", "Clinic", "Medi", "Vita", "Well"],
    hard: false,
    regulated: true,
  },
  {
    id: "records",
    codes: ["healthcare", "health_records", "enterprise", "b2b_saas"],
    noun: "hospital records software",
    buyer: "private hospital groups",
    unit: "facilities live",
    pain: "run patient records on paper and spreadsheets that do not talk to billing",
    fix: "provides an offline-first records and billing system priced per bed",
    words: ["Chart", "Ward", "Record", "Triage", "Pulse"],
    hard: false,
    regulated: true,
  },
  {
    id: "agri",
    codes: ["agritech", "marketplace", "small_business", "marketplace"],
    noun: "farm-to-buyer trading",
    buyer: "smallholder cooperatives and food processors",
    unit: "active farmers",
    pain: "sell through layers of middlemen at prices set after harvest",
    fix: "aggregates harvests and sells them forward to processors with quality grading at collection",
    words: ["Harvest", "Shamba", "Grain", "Field", "Agro"],
    hard: false,
    regulated: false,
  },
  {
    id: "fleet",
    codes: ["logistics", "fleet_management", "mid_market", "b2b_saas"],
    noun: "fleet operations software",
    buyer: "trucking and last-mile operators",
    unit: "vehicles managed",
    pain: "cannot see where vehicles are or what each trip really costs",
    fix: "combines telematics, fuel cards and trip costing in one operator dashboard",
    words: ["Haul", "Route", "Depot", "Cargo", "Axle"],
    hard: true,
    regulated: false,
  },
  {
    id: "energy",
    codes: ["energy_access", "energy_management", "consumer", "usage_based"],
    noun: "pay-as-you-go solar",
    buyer: "off-grid and under-grid households",
    unit: "connected homes",
    pain: "pay more for diesel and kerosene than grid customers pay for power",
    fix: "leases solar home systems paid in small mobile instalments with remote lockout",
    words: ["Sola", "Volt", "Lumen", "Grid", "Sun"],
    hard: true,
    regulated: false,
  },
  {
    id: "edtech",
    codes: ["edtech", "learning_platform", "consumer", "freemium"],
    noun: "exam-preparation learning",
    buyer: "secondary-school students",
    unit: "monthly learners",
    pain: "prepare for national exams without enough teachers or practice material",
    fix: "runs adaptive practice and short video lessons that work on low-end phones",
    words: ["Learn", "Tutor", "Class", "Quill", "Scholar"],
    hard: false,
    regulated: false,
  },
  {
    id: "hr",
    codes: ["hr_technology", "workflow_automation", "mid_market", "b2b_saas"],
    noun: "payroll and HR software",
    buyer: "companies with 20 to 500 staff",
    unit: "employers",
    pain: "run payroll, tax filings and leave by hand every month",
    fix: "automates payroll, statutory filings and staff records with local compliance built in",
    words: ["Staff", "Roster", "Payslip", "Crew", "Team"],
    hard: false,
    regulated: false,
  },
  {
    id: "security",
    codes: ["cybersecurity", "security_platform", "enterprise", "b2b_saas"],
    noun: "managed security monitoring",
    buyer: "banks, telcos and mid-sized enterprises",
    unit: "enterprise clients",
    pain: "cannot afford a security operations team and learn about breaches late",
    fix: "provides a monitored detection platform with an on-call analyst team",
    words: ["Sentry", "Guard", "Vault", "Fort", "Cipher"],
    hard: false,
    regulated: false,
  },
  {
    id: "identity",
    codes: [
      "identity_security",
      "identity_verification",
      "financial_institution",
      "usage_based",
    ],
    noun: "identity verification",
    buyer: "lenders, wallets and exchanges",
    unit: "API clients",
    pain: "onboard customers slowly and still let fraudulent identities through",
    fix: "checks documents, faces and registry records in one API call priced per check",
    words: ["Verify", "Ident", "Proof", "Kyc", "Trust"],
    hard: false,
    regulated: true,
  },
  {
    id: "data",
    codes: [
      "data_infrastructure",
      "data_analytics_platform",
      "enterprise",
      "usage_based",
    ],
    noun: "data pipeline infrastructure",
    buyer: "data teams at growing companies",
    unit: "paying teams",
    pain: "spend most of their time moving and cleaning data instead of using it",
    fix: "offers managed connectors and a query layer billed by data processed",
    words: ["Stream", "Lake", "Query", "Schema", "Pipe"],
    hard: false,
    regulated: false,
  },
  {
    id: "devtools",
    codes: ["developer_tools", "developer_api", "developer", "freemium"],
    noun: "developer messaging APIs",
    buyer: "product and engineering teams",
    unit: "active developer accounts",
    pain: "stitch together SMS, voice and chat providers country by country",
    fix: "gives one API and dashboard across local carriers with usage-based pricing",
    words: ["Stack", "Hook", "Relay", "Signal", "Byte"],
    hard: false,
    regulated: false,
  },
  {
    id: "proptech",
    codes: ["proptech", "marketplace", "consumer", "transaction_fee"],
    noun: "rental marketplace",
    buyer: "renters and small landlords",
    unit: "monthly active renters",
    pain: "pay a year's rent upfront and deal with unverified listings",
    fix: "verifies listings and lets tenants pay rent monthly while landlords are paid upfront",
    words: ["Nest", "Keys", "Tenant", "Abode", "Dwell"],
    hard: false,
    regulated: false,
  },
  {
    id: "retail",
    codes: ["retail_technology", "ecommerce", "small_business", "b2b_saas"],
    noun: "retail restocking",
    buyer: "neighbourhood shops",
    unit: "ordering shops",
    pain: "travel to wholesale markets to restock and run out of best-sellers",
    fix: "takes orders by app or USSD and delivers next day from partner distributors",
    words: ["Shelf", "Duka", "Stock", "Basket", "Store"],
    hard: false,
    regulated: false,
  },
  {
    id: "wealth",
    codes: ["wealthtech", "digital_wallet", "consumer", "freemium"],
    noun: "savings and investment",
    buyer: "salaried young professionals",
    unit: "funded accounts",
    pain: "keep savings in current accounts that lose value to inflation",
    fix: "offers round-up savings into money-market and dollar funds from a wallet",
    words: ["Save", "Nest", "Yield", "Coin", "Purse"],
    hard: false,
    regulated: true,
  },
  {
    id: "corebank",
    codes: [
      "banking",
      "core_banking_platform",
      "financial_institution",
      "licensing",
    ],
    noun: "core banking software",
    buyer: "microfinance banks and credit unions",
    unit: "institutions live",
    pain: "run on legacy cores that cannot launch digital products",
    fix: "licenses a cloud core with digital channels and regulatory reporting",
    words: ["Core", "Teller", "Branch", "Ledger", "Vault"],
    hard: false,
    regulated: true,
  },
  {
    id: "supply",
    codes: [
      "supply_chain",
      "workflow_automation",
      "business_customer",
      "b2b_saas",
    ],
    noun: "procurement workflow",
    buyer: "manufacturers and distributors",
    unit: "buyer companies",
    pain: "manage suppliers, purchase orders and deliveries in email threads",
    fix: "puts sourcing, approvals and supplier payments in one workflow",
    words: ["Source", "Supply", "Order", "Vendor", "Chain"],
    hard: false,
    regulated: false,
  },
  {
    id: "mobility",
    codes: ["mobility", "fleet_management", "consumer", "transaction_fee"],
    noun: "electric two-wheeler leasing",
    buyer: "motorcycle-taxi riders",
    unit: "riders on lease",
    pain: "spend a large share of daily earnings on fuel and repairs",
    fix: "leases electric motorcycles with battery swapping, paid daily",
    words: ["Moto", "Ride", "Boda", "Spark", "Wheel"],
    hard: true,
    regulated: false,
  },
  {
    id: "embedded",
    codes: [
      "embedded_payments",
      "embedded_finance",
      "business_customer",
      "usage_based",
    ],
    noun: "embedded finance APIs",
    buyer: "software platforms serving merchants",
    unit: "platform partners",
    pain: "want to offer accounts and cards but cannot become banks",
    fix: "lets platforms launch wallets, cards and payouts through one licensed API",
    words: ["Embed", "Rail", "Weave", "Plug", "Layer"],
    hard: false,
    regulated: true,
  },
  {
    id: "fraud",
    codes: ["fintech", "fraud_detection", "financial_institution", "b2b_saas"],
    noun: "transaction fraud detection",
    buyer: "banks and payment processors",
    unit: "institution clients",
    pain: "catch card and transfer fraud only after customers complain",
    fix: "scores transactions in real time with models trained on regional fraud patterns",
    words: ["Sentinel", "Watch", "Radar", "Flag", "Lens"],
    hard: false,
    regulated: true,
  },
  {
    id: "insdist",
    codes: [
      "insurance",
      "insurance_distribution",
      "consumer",
      "transaction_fee",
    ],
    noun: "micro-insurance distribution",
    buyer: "informal workers",
    unit: "active policies",
    pain: "have no affordable cover for hospital stays or lost income",
    fix: "sells weekly health and income cover through wallets and agent networks",
    words: ["Cover", "Safety", "Umbrella", "Haven", "Ward"],
    hard: false,
    regulated: true,
  },
  {
    id: "manufacturing",
    codes: ["manufacturing", "workflow_automation", "mid_market", "b2b_saas"],
    noun: "factory production planning",
    buyer: "small and mid-sized manufacturers",
    unit: "factories live",
    pain: "plan production on whiteboards and find stock-outs too late",
    fix: "connects orders, inventory and machine time in a planning tool built for small plants",
    words: ["Forge", "Plant", "Lathe", "Mill", "Batch"],
    hard: false,
    regulated: false,
  },
  {
    id: "media",
    codes: ["media_entertainment", "marketplace", "consumer", "advertising"],
    noun: "local-language audio streaming",
    buyer: "listeners outside the big-label catalogues",
    unit: "monthly listeners",
    pain: "find little content in their own languages on global platforms",
    fix: "licenses and produces local-language podcasts and music, funded by ads and tips",
    words: ["Echo", "Wave", "Sauti", "Tune", "Studio"],
    hard: false,
    regulated: false,
  },
  {
    id: "devices",
    codes: [
      "medical_devices",
      "health_records",
      "government",
      "hardware_sales",
    ],
    noun: "point-of-care diagnostics",
    buyer: "public clinics and NGOs",
    unit: "devices deployed",
    pain: "send samples away and wait days for basic test results",
    fix: "builds a low-cost reader for rapid tests that uploads results to health records",
    words: ["Assay", "Scope", "Sample", "Lab", "Dx"],
    hard: true,
    regulated: true,
  },
];

const SUFFIXES = [
  "ly",
  "io",
  "a",
  "o",
  "ra",
  "eon",
  "ix",
  "um",
  "ent",
  "ova",
  "ana",
  "ari",
  "isk",
  "ora",
  "elle",
];
const TAILS = [
  "",
  "",
  "",
  " Labs",
  " Technologies",
  " Africa",
  " Systems",
  " Works",
  " Hub",
  " Co",
];

const PEOPLE = {
  west_africa: {
    first: [
      "Adaeze",
      "Tunde",
      "Chioma",
      "Kwame",
      "Efua",
      "Ifeoma",
      "Segun",
      "Ama",
      "Kofi",
      "Ngozi",
      "Femi",
      "Yaw",
      "Halima",
      "Emeka",
      "Abena",
      "Obinna",
      "Zainab",
      "Kelechi",
    ],
    last: [
      "Okafor",
      "Adeyemi",
      "Mensah",
      "Boateng",
      "Eze",
      "Nwosu",
      "Asante",
      "Ogunleye",
      "Owusu",
      "Bello",
      "Danjuma",
      "Appiah",
      "Ibekwe",
      "Lawal",
      "Darko",
    ],
  },
  east_africa: {
    first: [
      "Wanjiru",
      "Otieno",
      "Achieng",
      "Kamau",
      "Njeri",
      "Mwangi",
      "Amani",
      "Baraka",
      "Zawadi",
      "Kiprono",
      "Nasra",
      "Juma",
    ],
    last: [
      "Kariuki",
      "Odhiambo",
      "Wambui",
      "Mutua",
      "Chege",
      "Omondi",
      "Kipchoge",
      "Njoroge",
      "Wekesa",
      "Abdi",
      "Barasa",
    ],
  },
  southern_africa: {
    first: [
      "Thandiwe",
      "Sipho",
      "Lerato",
      "Themba",
      "Naledi",
      "Pieter",
      "Ayanda",
      "Karabo",
      "Zanele",
      "Bongani",
      "Anika",
    ],
    last: [
      "Dlamini",
      "Nkosi",
      "van der Merwe",
      "Mokoena",
      "Khumalo",
      "Botha",
      "Ndlovu",
      "Pillay",
      "Mahlangu",
      "Naidoo",
    ],
  },
  north_africa: {
    first: [
      "Youssef",
      "Nour",
      "Omar",
      "Salma",
      "Karim",
      "Mariam",
      "Hassan",
      "Layla",
      "Tarek",
      "Dina",
    ],
    last: [
      "El-Sayed",
      "Mansour",
      "Hassan",
      "Fahmy",
      "Abdelrahman",
      "Saleh",
      "Farouk",
      "Naguib",
    ],
  },
  middle_east: {
    first: [
      "Rashid",
      "Aisha",
      "Khalid",
      "Fatima",
      "Omar",
      "Noura",
      "Faisal",
      "Huda",
      "Saeed",
      "Maryam",
      "Ravi",
      "Priya",
    ],
    last: [
      "Al Mansoori",
      "Haddad",
      "Khoury",
      "Al Suwaidi",
      "Nasser",
      "Rahman",
      "Saab",
      "Menon",
      "Al Hashimi",
    ],
  },
  europe: {
    first: [
      "Sophie",
      "Lukas",
      "Emma",
      "Jonas",
      "Claire",
      "Tom",
      "Amelia",
      "Felix",
      "Inès",
      "Daan",
      "Hannah",
      "Marcus",
    ],
    last: [
      "Fischer",
      "Laurent",
      "Clarke",
      "de Vries",
      "Moreau",
      "Bennett",
      "Schmidt",
      "Hughes",
      "Janssen",
      "Dubois",
    ],
  },
  north_america: {
    first: [
      "Jordan",
      "Maya",
      "Ethan",
      "Grace",
      "Daniel",
      "Olivia",
      "Marcus",
      "Chloe",
      "Andre",
      "Leah",
    ],
    last: [
      "Carter",
      "Nguyen",
      "Brooks",
      "Okonkwo",
      "Patel",
      "Reyes",
      "Sullivan",
      "Kim",
      "Thompson",
    ],
  },
  asia: {
    first: [
      "Arjun",
      "Ananya",
      "Wei",
      "Mei",
      "Rohan",
      "Kavya",
      "Jun",
      "Siddharth",
      "Aditi",
      "Hui",
    ],
    last: [
      "Sharma",
      "Iyer",
      "Tan",
      "Lim",
      "Reddy",
      "Krishnan",
      "Chen",
      "Ng",
      "Gupta",
    ],
  },
  latin_america: {
    first: ["Lucas", "Mariana", "Gabriel", "Beatriz", "Rafael", "Camila"],
    last: ["Silva", "Oliveira", "Souza", "Costa", "Pereira", "Almeida"],
  },
};

const STAGE_WEIGHTS = [
  ["pre_seed", 24],
  ["seed", 36],
  ["series_a", 24],
  ["series_b", 10],
  ["series_c_plus", 3],
  ["unsure", 3],
];
/** Raise range in USD by stage. */
const RAISE_USD = {
  pre_seed: [120_000, 1_200_000],
  seed: [500_000, 4_500_000],
  series_a: [3_000_000, 16_000_000],
  series_b: [12_000_000, 45_000_000],
  series_c_plus: [30_000_000, 90_000_000],
  unsure: [200_000, 2_000_000],
};
const TEAM_SIZE = {
  pre_seed: [2, 7],
  seed: [4, 22],
  series_a: [15, 70],
  series_b: [45, 220],
  series_c_plus: [120, 600],
  unsure: [2, 10],
};
const STAGE_LABEL = {
  pre_seed: "pre-seed",
  seed: "seed",
  series_a: "Series A",
  series_b: "Series B",
  series_c_plus: "growth",
  unsure: "first",
};

const ROLE_TITLES = {
  ceo: "Co-founder and CEO",
  cto: "Co-founder and CTO",
  coo: "Co-founder and COO",
  cpo: "Co-founder and Chief Product Officer",
  other: "Founder and Managing Director",
};
const SECOND_ROLES = [
  {
    title: "Co-founder and CTO",
    isFounder: true,
    appRole: "ADMIN",
    fn: "engineering",
  },
  {
    title: "Co-founder and COO",
    isFounder: true,
    appRole: "ADMIN",
    fn: "operations",
  },
  {
    title: "Head of Finance",
    isFounder: false,
    appRole: "MEMBER",
    fn: "finance",
  },
  { title: "Head of Growth", isFounder: false, appRole: "MEMBER", fn: "sales" },
  {
    title: "Head of Product",
    isFounder: false,
    appRole: "MEMBER",
    fn: "product",
  },
  {
    title: "Head of Operations",
    isFounder: false,
    appRole: "MEMBER",
    fn: "operations",
  },
  {
    title: "Head of Engineering",
    isFounder: false,
    appRole: "MEMBER",
    fn: "engineering",
  },
];

const slug = (s) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const fmt = (n) => Number(n).toLocaleString("en-US");

function personName(r, region, taken) {
  const pool = PEOPLE[region] ?? PEOPLE.west_africa;
  for (let i = 0; i < 40; i += 1) {
    const name = `${r.pick(pool.first)} ${r.pick(pool.last)}`;
    if (!taken.has(name)) {
      taken.add(name);
      return name;
    }
  }
  const name = `${r.pick(pool.first)} ${r.pick(pool.last)}-${r.pick(pool.last)}`;
  taken.add(name);
  return name;
}

// --------------------------------------------------------- companies

function companyName(r, archetype, used) {
  for (let i = 0; i < 60; i += 1) {
    const base = r.pick(archetype.words);
    const name = `${base}${r.pick(SUFFIXES)}`;
    const full = `${name.charAt(0).toUpperCase()}${name.slice(1).toLowerCase()}${r.pick(TAILS)}`;
    if (!used.has(full.toLowerCase())) {
      used.add(full.toLowerCase());
      return full;
    }
  }
  throw new Error("company name space exhausted");
}

function buildCompany(n, used, people) {
  const key = `fb${String(n).padStart(4, "0")}`;
  const r = rngFor(`${SEED_MARKER}:company:${key}`);
  const archetype = r.pick(ARCHETYPES);
  const countryOption = r.weighted(
    Object.entries(COUNTRIES).map(([k, v]) => [k, v.w]),
  );
  const country = COUNTRIES[countryOption];
  const stageOption = r.weighted(STAGE_WEIGHTS);
  const name = companyName(r, archetype, used);
  const city = r.pick(country.cities);
  const later = ["series_a", "series_b", "series_c_plus"].includes(stageOption);
  const foundedYear = {
    pre_seed: [2024, 2026],
    seed: [2022, 2025],
    series_a: [2019, 2023],
    series_b: [2016, 2021],
    series_c_plus: [2012, 2019],
    unsure: [2024, 2026],
  }[stageOption];
  const year = r.int(foundedYear[0], foundedYear[1]);
  const month = r.int(1, year === 2026 ? 6 : 12);
  const foundedDate = `${year}-${String(month).padStart(2, "0")}-${String(r.int(1, 28)).padStart(2, "0")}`;

  // Evidence quality is a property of the company, not of the generator:
  // a thin company leaves most figures unknown rather than inventing them.
  const evidence = r.weighted([
    ["strong", later ? 40 : 18],
    ["medium", 45],
    ["thin", later ? 15 : 37],
  ]);

  // Raise: currency is local or USD; amount drawn log-uniform per stage.
  const currencyOption =
    country.local !== "usd" && r.chance(0.35)
      ? country.local
      : r.chance(0.08) && countryOption !== "us"
        ? "eur"
        : "usd";
  const [lo, hi] = RAISE_USD[stageOption];
  const raiseUsd = r.logUniform(lo, hi);
  const target = humanAmount(r, raiseUsd * PER_USD[currencyOption]);
  const minCheque = r.chance(evidence === "thin" ? 0.25 : 0.55)
    ? humanAmount(
        r,
        (raiseUsd * PER_USD[currencyOption]) / r.pick([20, 25, 40, 50, 80]),
      )
    : undefined;
  const instrument = later
    ? r.weighted([
        ["priced", 85],
        ["convertible", 10],
        ["unsure", 5],
      ])
    : r.weighted([
        ["safe", 40],
        ["priced", 25],
        ["convertible", 20],
        ["unsure", 15],
      ]);
  const timeframe = r.weighted([
    ["under_3", 25],
    ["3_6", 40],
    ["6_12", 25],
    ["unsure", 10],
  ]);
  const useOfFunds = r.sample(
    ["product", "hiring", "gtm", "runway", "expansion"],
    r.int(1, 4),
  );
  const raising = r.chance(0.78) ? "active" : "preparing";
  const intent = raising === "active" ? "raising_now" : "preparing_to_raise";

  // Team: the founder plus at least one more real member account.
  const taken = people;
  const founderRole = r.weighted([
    ["ceo", 70],
    ["cto", 12],
    ["coo", 8],
    ["cpo", 5],
    ["other", 5],
  ]);
  const founderName = personName(r, country.region, taken);
  const memberCount = r.weighted([
    [1, 60],
    [2, 32],
    [3, 8],
  ]);
  const memberRoles = r.sample(
    SECOND_ROLES.filter(
      (m) =>
        !(founderRole === "cto" && m.title.includes("CTO")) &&
        !(founderRole === "coo" && m.title.includes("COO")),
    ),
    memberCount,
  );
  const members = memberRoles.map((role) => ({
    name: personName(r, country.region, taken),
    ...role,
  }));
  const founderCount =
    1 + members.filter((m) => m.isFounder).length + (r.chance(0.12) ? 1 : 0);
  const fullTime = r.weighted([
    ["all", 75],
    ["some", 20],
    ["none", 5],
  ]);
  const fullTimeFounderCount =
    fullTime === "all"
      ? founderCount
      : fullTime === "none"
        ? 0
        : Math.max(1, founderCount - 1);
  const [tlo, thi] = TEAM_SIZE[stageOption];
  const teamSize = Math.max(
    founderCount + members.filter((m) => !m.isFounder).length,
    Math.round(r.logUniform(tlo, thi)),
  );
  const functions = [
    ...new Set([
      ...members.map((m) => m.fn),
      ...r.sample(
        ["product", "engineering", "sales", "operations", "finance", "domain"],
        r.int(1, 3),
      ),
    ]),
  ];

  // Traction: early stage says a signal, later stage says revenue shape.
  const traction = {};
  if (!later) {
    traction.signal = r.weighted([
      ["pilots", 22],
      ["lois", 10],
      ["waitlist", 10],
      ["users", 20],
      ["paying", 25],
      ["partnerships", 6],
      ["none", 7],
    ]);
    if (traction.signal === "pilots" && evidence !== "thin")
      traction.pilots = r.int(2, 18);
  } else {
    traction.revenueStatus = r.weighted([
      ["recurring", 55],
      ["recurring_flat", 15],
      ["project", 15],
      ["early", 15],
    ]);
    if (evidence !== "thin")
      traction.customers = Math.round(
        r.logUniform(
          archetype.codes.includes("consumer") ? 2000 : 12,
          archetype.codes.includes("consumer") ? 400000 : 900,
        ),
      );
    if (evidence !== "thin" || r.chance(0.5))
      traction.growth = r.weighted([
        ["over_100", 25],
        ["50_100", 30],
        ["under_50", 30],
        ["flat", 15],
      ]);
  }
  const paying = later || traction.signal === "paying";

  // Financials: only what this company reports. Absent means unknown.
  const fin = {};
  const finCurrency = r.chance(0.7) ? currencyOption : country.local;
  if (evidence !== "thin" || r.chance(0.2)) {
    fin.currency = finCurrency;
    const stageRevenueUsd = {
      pre_seed: [800, 25_000],
      seed: [4_000, 120_000],
      series_a: [60_000, 700_000],
      series_b: [400_000, 3_500_000],
      series_c_plus: [2_000_000, 9_000_000],
      unsure: [500, 15_000],
    }[stageOption];
    if (paying) {
      fin.monthlyRevenue = humanAmount(
        r,
        r.logUniform(...stageRevenueUsd) * PER_USD[finCurrency],
      );
      fin.revenueTrend = r.weighted([
        ["growing", 60],
        ["flat", 15],
        ["declining", 8],
        ["lumpy", 17],
      ]);
      if (evidence === "strong" || r.chance(0.4))
        fin.grossMargin = String(
          r.int(archetype.hard ? 8 : 25, archetype.hard ? 45 : 82),
        );
    }
    const burnUsd = r.logUniform(
      stageRevenueUsd[0] * 1.5 + 15_000,
      stageRevenueUsd[1] * 1.6 + 60_000,
    );
    fin.monthlyBurn = humanAmount(r, burnUsd * PER_USD[finCurrency]);
    if (evidence === "strong" || r.chance(0.35)) {
      const runway = r.int(4, 26);
      fin.cash = humanAmount(r, burnUsd * runway * PER_USD[finCurrency]);
      fin.runwayMonths = String(runway);
    }
  }

  const shortDescription =
    `${capitalise(archetype.noun)} for ${archetype.buyer} in ${countryLabel(countryOption)}: ${name.split(" ")[0]} ${archetype.fix}.`.slice(
      0,
      280,
    );
  const unknowns = [];
  if (fin.grossMargin === undefined && paying) unknowns.push("Gross margin");
  if (fin.cash === undefined) unknowns.push("Cash position and runway");
  if (traction.customers === undefined && later)
    unknowns.push("Customer count");
  if (!paying) unknowns.push("Revenue (none reported yet)");
  if (fin.monthlyBurn === undefined) unknowns.push("Monthly burn");
  unknowns.push(
    r.pick([
      "Retention beyond the first year",
      "Unit economics at scale",
      "Payback period on acquisition spend",
      "Regulatory licence timeline",
      "Concentration in the largest customers",
    ]),
  );

  const story = {
    problem: `${capitalise(archetype.buyer)} in ${city} ${archetype.pain}.`,
    solution: `${name} ${archetype.fix}.`,
    traction: tractionText(traction, fin, archetype, currencyOption),
    team: `${founderName} (${ROLE_TITLES[founderRole]}) leads the company${members.map((m) => `, with ${m.name} (${m.title})`).join("")}. ${fmt(teamSize)} people in total.`,
    market: `The company sizes its first market as ${archetype.buyer} in ${countryLabel(countryOption)} and neighbouring markets (company estimate, not independently checked).`,
    raise: `Raising ${CURRENCY_CODE[currencyOption]} ${fmt(target)} (${STAGE_LABEL[stageOption]}, ${instrumentLabel(instrument)}) for ${useOfFunds.map(useLabel).join(", ")}.`,
    risks: r
      .sample(
        [
          "currency volatility against the raise",
          "dependence on one distribution partner",
          archetype.regulated
            ? "licensing and regulatory change"
            : "a well-funded competitor entering",
          "hiring senior engineers locally",
          "customer concentration",
          "working-capital intensity",
        ],
        2,
      )
      .join("; "),
    unknowns,
  };

  const documents = [
    {
      kind: "COMPANY_PROFILE",
      title: `${name} company overview (fictional)`,
      filename: `${slug(name)}-overview.txt`,
      mime: "text/plain",
    },
  ];
  if (evidence !== "thin" && fin.currency !== undefined) {
    documents.push({
      kind: "MANAGEMENT_ACCOUNTS",
      title: `${name} management accounts summary, H1 2026 (fictional)`,
      filename: `${slug(name)}-management-accounts-h1-2026.csv`,
      mime: "text/csv",
    });
  }
  if (evidence === "strong") {
    documents.push({
      kind: "COMMERCIAL",
      title: `${name} customer and pipeline summary (fictional)`,
      filename: `${slug(name)}-pipeline.csv`,
      mime: "text/csv",
    });
  }

  return {
    key,
    seedKey: `${SEED_MARKER}:${key}`,
    name,
    legalName: `${name.replace(/ (Labs|Technologies|Systems|Works|Hub|Co|Africa)$/, "")} ${r.pick(["Ltd", "Limited", "Inc.", "B.V.", "GmbH", "FZ-LLC", "Pvt Ltd", "(Pty) Ltd"])} (fictional)`,
    website: `https://${slug(name)}.example`,
    foundedDate,
    countryOption,
    country: country.iso,
    city,
    stageOption,
    archetype: archetype.id,
    categories: archetype.codes,
    evidence,
    shortDescription,
    intent,
    founder: {
      email: `founder.${key}.${slug(founderName)}@${ACCOUNT_DOMAIN}`,
      displayName: founderName,
      headline: `${ROLE_TITLES[founderRole]}, ${name} (fictional demo founder)`,
      roleOption: founderRole,
      businessTitle: ROLE_TITLES[founderRole],
      professionalSummary: `Leads ${name}. Previously spent ${r.int(3, 12)} years in ${r.pick(["banking operations", "consulting", "product management", "software engineering", "logistics", "public health", "sales leadership"])} at a fictional ${r.pick(["regional", "pan-African", "global", "local"])} firm.`,
      backgroundSummary: `${r.pick(["Economics", "Computer science", "Engineering", "Business", "Medicine", "Agricultural science"])} graduate; ${r.pick(["first-time founder", "second-time founder", "previously an early employee at a fictional scale-up"])}.`,
    },
    members: members.map((m, i) => ({
      email: `member.${key}.${i + 1}.${slug(m.name)}@${ACCOUNT_DOMAIN}`,
      displayName: m.name,
      headline: `${m.title}, ${name} (fictional demo team member)`,
      businessTitle: m.title,
      isFounder: m.isFounder,
      appRole: m.appRole,
    })),
    team: {
      founderCount,
      fullTimeOption: fullTime,
      fullTimeFounderCount,
      teamSize,
      functions,
    },
    traction,
    fin,
    raise: {
      raising,
      currencyOption,
      target: { amount: target, currency: CURRENCY_CODE[currencyOption] },
      instrument,
      timeframe,
      useOfFunds,
      minCheque,
    },
    story,
    documents,
    q: {
      personality: r.pick(["AUTO", "WARM", "WITTY", "SHARP", "CALM"]),
      guide: etiquetteGuide(r, founderName, name),
    },
  };
}

function capitalise(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function countryLabel(option) {
  return {
    ng: "Nigeria",
    ke: "Kenya",
    za: "South Africa",
    gh: "Ghana",
    eg: "Egypt",
    ae: "the UAE",
    gb: "the UK",
    us: "the US",
    de: "Germany",
    fr: "France",
    nl: "the Netherlands",
    in: "India",
    sg: "Singapore",
    br: "Brazil",
    ca: "Canada",
  }[option];
}
function instrumentLabel(i) {
  return {
    priced: "priced equity",
    safe: "SAFE",
    convertible: "convertible note",
    unsure: "instrument not yet decided",
  }[i];
}
function useLabel(u) {
  return {
    product: "product and engineering",
    hiring: "key hires",
    gtm: "sales and go-to-market",
    runway: "runway",
    expansion: "new markets",
  }[u];
}
function tractionText(t, fin, a, cur) {
  const parts = [];
  if (t.signal === "pilots")
    parts.push(
      t.pilots === undefined
        ? "Pilots are running; the company has not said how many."
        : `${t.pilots} pilots running.`,
    );
  if (t.signal === "lois")
    parts.push(
      "Signed letters of intent from early customers; counts not shared.",
    );
  if (t.signal === "waitlist") parts.push("A waitlist, size not shared.");
  if (t.signal === "users") parts.push(`Active ${a.unit}, not yet paying.`);
  if (t.signal === "partnerships")
    parts.push("Distribution partnerships signed; no revenue yet.");
  if (t.signal === "none") parts.push("Nothing measurable yet.");
  if (t.customers !== undefined) parts.push(`${fmt(t.customers)} ${a.unit}.`);
  if (fin.monthlyRevenue !== undefined)
    parts.push(
      `Monthly revenue around ${CURRENCY_CODE[fin.currency] ?? cur.toUpperCase()} ${fmt(fin.monthlyRevenue)} (company-reported).`,
    );
  else if (t.signal === "paying" || t.revenueStatus !== undefined)
    parts.push("Paying customers; revenue figures not shared.");
  return parts.join(" ");
}
function etiquetteGuide(r, person, company) {
  const tone = r.pick([
    "Direct and brief",
    "Warm but concise",
    "Formal and precise",
    "Plain English, no jargon",
  ]);
  return [
    `How Q writes and speaks for ${person} of ${company} (fictional demo account).`,
    `Tone: ${tone}.`,
    `Always: ${r.pick(["state the figure and its source", "say what is not known yet", "propose one next step"])}; ${r.pick(["keep emails under 150 words", "use the investor's name", "confirm the time zone for any meeting"])}.`,
    `Never: ${r.pick(["round figures up", "promise a close date", "send anything to an investor without my approval"])}.`,
  ].join("\n");
}

// --------------------------------------------------------- investors

/** Region geography codes → the country ISO codes companies here can declare. */
export const REGION_COUNTRIES = {
  west_africa: ["NG", "GH"],
  east_africa: ["KE"],
  southern_africa: ["ZA"],
  north_africa: ["EG"],
  africa: ["NG", "GH", "KE", "ZA", "EG"],
  middle_east: ["AE"],
  europe: ["GB", "DE", "FR", "NL"],
  north_america: ["US", "CA"],
  asia: ["IN", "SG"],
  latin_america: ["BR"],
  global: [
    "NG",
    "GH",
    "KE",
    "ZA",
    "EG",
    "AE",
    "GB",
    "US",
    "DE",
    "FR",
    "NL",
    "IN",
    "SG",
    "BR",
    "CA",
  ],
};
const GEO_COUNTRY = Object.fromEntries(
  Object.values(COUNTRIES).map((c) => [c.geo, c.iso]),
);
export function countriesOf(geographies) {
  return [
    ...new Set(
      geographies.flatMap(
        (g) => REGION_COUNTRIES[g] ?? (GEO_COUNTRY[g] ? [GEO_COUNTRY[g]] : []),
      ),
    ),
  ].sort();
}

/**
 * Twelve invented investor organisations. Each mandate is declared as a
 * coherent whole (stages ↔ cheques ↔ revenue appetite), and its GateQ
 * criteria are derived from it, never written separately.
 */
export const INVESTORS = [
  {
    key: "baobab-ridge",
    name: "Baobab Ridge Capital (fictional)",
    type: "vc",
    stages: ["pre_seed", "seed"],
    currency: "usd",
    cheque: ["50000", "250000", "600000"],
    roles: ["lead", "co_invest"],
    geographies: ["west_africa", "east_africa"],
    sectors: [
      "fintech",
      "digital_lending",
      "merchant_payments",
      "embedded_payments",
    ],
    avoidSectors: ["proptech"],
    businessModels: ["transaction_fee", "b2b_saas"],
    customerTypes: ["small_business", "business_customer"],
    capitalIntensity: "capital_light",
    regulatory: "any",
    revenue: "pre_revenue_ok",
    founderPrefs: ["technical_founding_capability"],
    greenFlags: ["capital_efficiency", "distribution_advantage"],
    hardExclusions: ["gambling", "crypto_speculation"],
    sectorExclusions: [],
    discovery: "balanced",
    inbound: "qualified",
    thesis:
      "Backs first institutional rounds of fintech infrastructure for small businesses in West and East Africa. Leads pre-seed and seed with USD 50k to 600k.",
    people: [
      ["Ifeoma Chukwu", "Partner"],
      ["Daniel Mwangi", "Associate"],
    ],
  },
  {
    key: "sahel-bridge",
    name: "Sahel Bridge Ventures (fictional)",
    type: "vc",
    stages: ["seed", "series_a"],
    currency: "usd",
    cheque: ["250000", "1200000", "3000000"],
    roles: ["lead"],
    geographies: ["africa"],
    sectors: ["agritech", "logistics", "supply_chain", "energy_access"],
    avoidSectors: [],
    businessModels: ["marketplace", "b2b_saas", "usage_based"],
    customerTypes: ["small_business", "mid_market"],
    capitalIntensity: "any",
    regulatory: "any",
    revenue: "revenue_preferred",
    founderPrefs: ["deep_domain_expertise"],
    greenFlags: ["strong_revenue_growth", "high_retention"],
    hardExclusions: ["weapons", "tobacco"],
    sectorExclusions: ["media_entertainment"],
    discovery: "strict",
    inbound: "qualified",
    thesis:
      "Real-economy software and marketplaces across Africa: food systems, logistics and energy access. Leads seed and Series A.",
    people: [
      ["Amadou Diallo", "Managing Partner"],
      ["Zanele Khumalo", "Principal"],
    ],
  },
  {
    key: "kilima-angels",
    name: "Kilima Angel Network (fictional)",
    type: "syndicate",
    stages: ["pre_seed", "seed"],
    currency: "usd",
    cheque: ["10000", "40000", "150000"],
    roles: ["co_invest", "follow"],
    geographies: ["east_africa"],
    sectors: ["edtech", "digital_health", "agritech", "fintech"],
    avoidSectors: ["cybersecurity"],
    businessModels: [],
    customerTypes: ["consumer", "small_business"],
    capitalIntensity: "capital_light",
    regulatory: "any",
    revenue: "pre_revenue_ok",
    founderPrefs: [],
    greenFlags: ["repeat_founder"],
    hardExclusions: ["gambling", "adult_content", "weapons"],
    sectorExclusions: [],
    discovery: "exploratory",
    inbound: "open",
    thesis:
      "An angel syndicate of operators in Nairobi co-investing small cheques in East African founders at pre-seed and seed.",
    people: [
      ["Njeri Kamau", "Syndicate Lead"],
      ["Juma Abdi", "Deal Partner"],
    ],
  },
  {
    key: "cape-meridian",
    name: "Cape Meridian Growth (fictional)",
    type: "vc",
    stages: ["series_a", "series_b"],
    currency: "usd",
    cheque: ["2000000", "6000000", "15000000"],
    roles: ["lead", "co_invest"],
    geographies: ["southern_africa", "east_africa", "west_africa"],
    sectors: [
      "enterprise_software",
      "cybersecurity",
      "data_infrastructure",
      "hr_technology",
    ],
    avoidSectors: [],
    businessModels: ["b2b_saas", "usage_based"],
    customerTypes: ["enterprise", "mid_market"],
    capitalIntensity: "avoid_hardware",
    regulatory: "any",
    revenue: "revenue_required",
    founderPrefs: ["enterprise_sales_experience"],
    greenFlags: [
      "strong_revenue_growth",
      "enterprise_customers",
      "high_retention",
    ],
    hardExclusions: ["hardware_heavy", "pre_product"],
    sectorExclusions: ["energy_access"],
    discovery: "strict",
    inbound: "qualified",
    thesis:
      "Series A and B growth capital for B2B software with recurring revenue in Sub-Saharan Africa. Revenue required.",
    people: [
      ["Pieter Botha", "General Partner"],
      ["Lerato Mokoena", "Vice President"],
    ],
  },
  {
    key: "nile-delta",
    name: "Nile Delta Partners (fictional)",
    type: "vc",
    stages: ["seed", "series_a"],
    currency: "usd",
    cheque: ["300000", "1000000", "2500000"],
    roles: ["lead", "co_invest"],
    geographies: ["north_africa", "middle_east"],
    sectors: ["fintech", "digital_health", "ecommerce", "logistics"],
    avoidSectors: [],
    businessModels: [],
    customerTypes: [],
    capitalIntensity: "any",
    regulatory: "prefer_regulated",
    revenue: "revenue_preferred",
    founderPrefs: ["repeat_founder_experience"],
    greenFlags: ["regulatory_moat", "strong_revenue_growth"],
    hardExclusions: ["gambling", "crypto_speculation", "tobacco"],
    sectorExclusions: [],
    discovery: "balanced",
    inbound: "qualified",
    thesis:
      "Seed and Series A in Egypt and the Gulf, with a bias to regulated fintech and health where licences are a moat.",
    people: [
      ["Karim Mansour", "Partner"],
      ["Salma Fahmy", "Associate"],
    ],
  },
  {
    key: "gulf-horizon",
    name: "Gulf Horizon Family Office (fictional)",
    type: "family_office",
    stages: ["series_a", "series_b", "series_c_plus"],
    currency: "aed",
    cheque: ["3500000", "11000000", "37000000"],
    roles: ["co_invest", "follow"],
    geographies: ["middle_east", "north_africa", "asia"],
    sectors: ["proptech", "fintech", "clean_energy", "logistics", "wealthtech"],
    avoidSectors: ["edtech"],
    businessModels: [],
    customerTypes: [],
    capitalIntensity: "any",
    regulatory: "any",
    revenue: "revenue_required",
    founderPrefs: [],
    greenFlags: ["strong_revenue_growth", "capital_efficiency"],
    hardExclusions: [
      "gambling",
      "tobacco",
      "adult_content",
      "weapons",
      "crypto_speculation",
    ],
    sectorExclusions: [],
    discovery: "strict",
    inbound: "closed",
    thesis:
      "A single-family office co-investing alongside established leads in later-stage Gulf, North African and South Asian companies. Shariah-sensitive exclusions apply.",
    people: [
      ["Rashid Al Suwaidi", "Chief Investment Officer"],
      ["Priya Menon", "Investment Manager"],
    ],
  },
  {
    key: "thames-arc",
    name: "Thames Arc Capital (fictional)",
    type: "vc",
    stages: ["seed", "series_a"],
    currency: "gbp",
    cheque: ["150000", "750000", "2000000"],
    roles: ["lead", "co_invest"],
    geographies: ["europe", "africa"],
    sectors: ["fintech", "payments", "cross_border_payments", "insurtech"],
    avoidSectors: [],
    businessModels: ["transaction_fee", "b2b_saas", "usage_based"],
    customerTypes: [],
    capitalIntensity: "capital_light",
    regulatory: "prefer_regulated",
    revenue: "revenue_preferred",
    founderPrefs: ["technical_founding_capability"],
    greenFlags: ["regulatory_moat", "distribution_advantage"],
    hardExclusions: ["crypto_speculation", "gambling"],
    sectorExclusions: [],
    discovery: "balanced",
    inbound: "qualified",
    thesis:
      "London-based seed and Series A fund for payments and insurance infrastructure connecting Europe and Africa.",
    people: [
      ["Amelia Hughes", "Partner"],
      ["Tom Bennett", "Investor"],
    ],
  },
  {
    key: "rhine-impact",
    name: "Rhine Impact Fund (fictional)",
    type: "institutional",
    stages: ["seed", "series_a", "series_b"],
    currency: "eur",
    cheque: ["500000", "2500000", "8000000"],
    roles: ["co_invest"],
    geographies: ["africa", "asia"],
    sectors: [
      "energy_access",
      "clean_energy",
      "digital_health",
      "agritech",
      "edtech",
    ],
    avoidSectors: [],
    businessModels: [],
    customerTypes: ["consumer", "small_business", "government"],
    capitalIntensity: "any",
    regulatory: "any",
    revenue: "revenue_preferred",
    founderPrefs: ["deep_domain_expertise"],
    greenFlags: ["high_retention", "distribution_advantage"],
    hardExclusions: ["tobacco", "weapons", "gambling", "adult_content"],
    sectorExclusions: ["capital_markets"],
    discovery: "exploratory",
    inbound: "open",
    thesis:
      "An impact fund co-investing in companies that widen access to energy, health, food and education in Africa and South Asia.",
    people: [
      ["Hannah Schmidt", "Investment Director"],
      ["Daan de Vries", "Analyst"],
    ],
  },
  {
    key: "lagos-forge",
    name: "Lagos Forge Fund (fictional)",
    type: "vc",
    stages: ["pre_seed", "seed"],
    currency: "ngn",
    cheque: ["40000000", "150000000", "450000000"],
    roles: ["lead", "co_invest"],
    geographies: ["nigeria"],
    sectors: [
      "fintech",
      "ecommerce",
      "retail_technology",
      "logistics",
      "media_entertainment",
    ],
    avoidSectors: [],
    businessModels: [],
    customerTypes: [],
    capitalIntensity: "capital_light",
    regulatory: "any",
    revenue: "pre_revenue_ok",
    founderPrefs: [],
    greenFlags: ["capital_efficiency", "repeat_founder"],
    hardExclusions: ["gambling"],
    sectorExclusions: [],
    discovery: "exploratory",
    inbound: "open",
    thesis:
      "A naira-denominated pre-seed and seed fund for Nigerian consumer and commerce companies.",
    people: [
      ["Tunde Adeyemi", "Founding Partner"],
      ["Halima Bello", "Associate"],
    ],
  },
  {
    key: "monsoon-cvc",
    name: "Monsoon Digital Ventures (fictional)",
    type: "cvc",
    stages: ["seed", "series_a"],
    currency: "usd",
    cheque: ["500000", "1500000", "4000000"],
    roles: ["co_invest"],
    geographies: ["asia", "middle_east", "africa"],
    sectors: [
      "telecommunications",
      "developer_tools",
      "data_infrastructure",
      "identity_security",
    ],
    avoidSectors: [],
    businessModels: ["usage_based", "b2b_saas"],
    customerTypes: ["developer", "enterprise", "financial_institution"],
    capitalIntensity: "avoid_hardware",
    regulatory: "any",
    revenue: "revenue_preferred",
    founderPrefs: ["technical_founding_capability"],
    greenFlags: ["enterprise_customers", "distribution_advantage"],
    hardExclusions: ["hardware_heavy", "adult_content"],
    sectorExclusions: [],
    discovery: "balanced",
    inbound: "qualified",
    thesis:
      "The venture arm of a fictional telecoms group, co-investing in API, identity and data businesses that its operators could distribute.",
    people: [
      ["Rohan Iyer", "Head of Ventures"],
      ["Mei Tan", "Investment Associate"],
    ],
  },
  {
    key: "atlas-health",
    name: "Atlas Health Partners (fictional)",
    type: "vc",
    stages: ["seed", "series_a", "series_b"],
    currency: "usd",
    cheque: ["400000", "2000000", "6000000"],
    roles: ["lead", "co_invest"],
    geographies: ["global"],
    sectors: ["digital_health", "healthcare", "medical_devices", "insurtech"],
    avoidSectors: [],
    businessModels: [],
    customerTypes: [],
    capitalIntensity: "any",
    regulatory: "prefer_regulated",
    revenue: "revenue_preferred",
    founderPrefs: ["deep_domain_expertise"],
    greenFlags: ["regulatory_moat", "high_retention"],
    hardExclusions: ["tobacco"],
    sectorExclusions: ["media_entertainment", "proptech"],
    discovery: "strict",
    inbound: "qualified",
    thesis:
      "A specialist health fund backing care delivery, health records, diagnostics and health insurance in emerging markets.",
    people: [
      ["Grace Okonkwo", "Partner"],
      ["Andre Reyes", "Principal"],
    ],
  },
  {
    key: "savanna-scale",
    name: "Savanna Scale Credit (fictional)",
    type: "institutional",
    stages: ["series_a", "series_b", "series_c_plus"],
    currency: "usd",
    cheque: ["3000000", "10000000", "25000000"],
    roles: ["lead", "co_invest"],
    geographies: ["africa"],
    sectors: ["energy_access", "mobility", "digital_lending", "insurance"],
    avoidSectors: [],
    businessModels: ["usage_based", "transaction_fee", "hardware_sales"],
    customerTypes: [],
    capitalIntensity: "any",
    regulatory: "any",
    revenue: "revenue_required",
    founderPrefs: [],
    greenFlags: ["strong_revenue_growth", "capital_efficiency"],
    hardExclusions: ["pre_product", "crypto_speculation"],
    sectorExclusions: [],
    discovery: "balanced",
    inbound: "qualified",
    thesis:
      "Growth equity and structured capital for asset-heavy, revenue-generating African businesses: solar, e-mobility, lending and insurance.",
    people: [
      ["Bongani Ndlovu", "Managing Director"],
      ["Achieng Odhiambo", "Investment Officer"],
    ],
  },
];

export function investorRecord(inv) {
  return {
    ...inv,
    seedKey: `${SEED_MARKER}:investor:${inv.key}`,
    logins: inv.people.map(([name, title], i) => ({
      email: `${i === 0 ? "investor" : "investor-team"}.${inv.key}.${slug(name)}@${ACCOUNT_DOMAIN}`,
      displayName: name,
      headline: `${title}, ${inv.name}`,
      businessTitle: title,
      appRole: i === 0 ? "OWNER" : "ADMIN",
    })),
    gateq: gateqCriteriaFor(inv),
  };
}

/**
 * GateQ criteria derived from the declared mandate: stage and geography are
 * REQUIRED exactly as the mandate declares them, sectors PREFERRED (the
 * mandate's sector strength is a preference, not a rule), raise size
 * bounded by the cheque range, and hard sector exclusions excluded. Node
 * ids are resolved at seed time from canonical codes.
 */
export function gateqCriteriaFor(inv) {
  const code = CURRENCY_CODE[inv.currency];
  const out = [
    {
      requiredness: "REQUIRED",
      label: "Stage we invest at",
      config: { type: "STAGE", allowedStageCodes: [...inv.stages] },
    },
    {
      requiredness: "REQUIRED",
      label: "Where the company is based",
      config: {
        type: "GEOGRAPHY",
        allowedCountries: countriesOf(inv.geographies),
      },
    },
    {
      requiredness: "PREFERRED",
      label: "Sectors we focus on",
      config: {
        type: "TAXONOMY",
        vocabularyCode: "industry",
        allowedCodes: inv.sectors,
      },
    },
    {
      requiredness: "PREFERRED",
      label: "Round size we can join",
      config: {
        type: "RAISE_SIZE",
        currency: code,
        minAmount: inv.cheque[0],
        maxAmount: String(
          Number(inv.cheque[2]) * (inv.roles.includes("lead") ? 4 : 10),
        ),
      },
    },
    {
      requiredness: "REQUIRED",
      label: "Our cheque size",
      config: {
        type: "CHEQUE_COMPATIBILITY",
        currency: code,
        minCheque: inv.cheque[0],
        maxCheque: inv.cheque[2],
      },
    },
  ];
  if (inv.sectorExclusions.length > 0) {
    out.push({
      requiredness: "REQUIRED",
      label: "Sectors we exclude",
      config: {
        type: "EXCLUDED_TAXONOMY",
        vocabularyCode: "industry",
        excludedCodes: inv.sectorExclusions,
      },
    });
  }
  return out.map((c, i) => ({ position: i + 1, ...c }));
}

// ------------------------------------------------------------ world

export function buildWorld({ count = 400 } = {}) {
  const used = new Set();
  const people = new Set();
  const companies = [];
  for (let n = 1; n <= count; n += 1)
    companies.push(buildCompany(n, used, people));
  return {
    marker: SEED_MARKER,
    companies,
    investors: INVESTORS.map(investorRecord),
  };
}

// ------------------------------------------------------- documents

/** The text of one fictional document. Provenance is stated in its first lines. */
export function documentText(company, doc, preparedOn = "2026-10-15") {
  const head = [
    `FICTIONAL DEMO DOCUMENT. ${company.name} and every person and figure below are invented for Capital Q demonstrations.`,
    `Prepared by: ${company.founder.displayName}, ${company.founder.businessTitle} (fictional). Source: the company's own records, self-reported and not audited. Prepared ${preparedOn}.`,
  ];
  if (doc.kind === "COMPANY_PROFILE") {
    const s = company.story;
    return [
      ...head,
      "",
      `${company.name} — company overview`,
      `Founded ${company.foundedDate} in ${company.city}. Stage: ${STAGE_LABEL[company.stageOption]}.`,
      `Problem: ${s.problem}`,
      `Solution: ${s.solution}`,
      `Traction: ${s.traction}`,
      `Team: ${s.team}`,
      `Market: ${s.market}`,
      `The raise: ${s.raise}`,
      `Risks we see: ${s.risks}.`,
      `Not yet known: ${s.unknowns.join("; ")}.`,
    ].join("\n");
  }
  if (doc.kind === "MANAGEMENT_ACCOUNTS") {
    const f = company.fin;
    const cur = CURRENCY_CODE[f.currency];
    const rows = [["line", "currency", "amount", "basis"]];
    if (f.monthlyRevenue !== undefined)
      rows.push([
        "monthly_revenue_sep_2026",
        cur,
        f.monthlyRevenue,
        "management accounts, unaudited",
      ]);
    if (f.monthlyBurn !== undefined)
      rows.push([
        "monthly_net_burn_sep_2026",
        cur,
        f.monthlyBurn,
        "management accounts, unaudited",
      ]);
    if (f.cash !== undefined)
      rows.push([
        "cash_30_sep_2026",
        cur,
        f.cash,
        "bank statements, unaudited",
      ]);
    if (f.grossMargin !== undefined)
      rows.push([
        "gross_margin_pct_h1_2026",
        "",
        f.grossMargin,
        "management accounts, unaudited",
      ]);
    rows.push(["audited_accounts", "", "", "not available (unknown)"]);
    return [
      `# ${head[0]}`,
      `# ${head[1]}`,
      ...rows.map((r) => r.map(csv).join(",")),
    ].join("\n");
  }
  const rows = [["segment", "count", "status", "basis"]];
  const r = rngFor(`${company.seedKey}:pipeline`);
  for (const seg of [
    "live customers",
    "pilots",
    "signed not live",
    "qualified pipeline",
  ]) {
    rows.push([
      seg,
      String(r.int(1, 40)),
      seg === "live customers" ? "billing" : "not billing",
      "CRM export, self-reported",
    ]);
  }
  return [
    `# ${head[0]}`,
    `# ${head[1]}`,
    ...rows.map((x) => x.map(csv).join(",")),
  ].join("\n");
}
function csv(v) {
  return /[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
}

/** The long profile text: the story, marked fictional in its first line. */
export function storyText(company) {
  const s = company.story;
  return [
    `Fictional demo company. ${company.name} and everyone named here are invented for Capital Q demonstrations; no real company, person or customer data.`,
    `Problem. ${s.problem}`,
    `Solution. ${s.solution}`,
    `Traction. ${s.traction}`,
    `Team. ${s.team}`,
    `Market. ${s.market}`,
    `Risks. ${capitalise(s.risks)}.`,
    `The raise. ${s.raise}`,
    `Not yet known. ${s.unknowns.join("; ")}.`,
  ].join("\n\n");
}
