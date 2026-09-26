import type { FictionalInterest, FictionalInvestor } from "./types.js";

/**
 * Eight fictional investor organisations and the interest between them and
 * the fictional companies (SEED). Invented, all of them: no real fund, no
 * real person. Cheque sizes are decimal strings in the mandate's currency.
 */

export const FICTIONAL_INVESTORS: readonly FictionalInvestor[] = [
  {
    key: "lagoon-angels",
    name: "Lagoon Angels Circle (fictional)",
    typeOption: "syndicate",
    person: {
      displayName: "Ngozi Ubah-Martins",
      headline: "Lead, Lagoon Angels Circle (fictional demo investor)",
      businessTitle: "Syndicate lead",
    },
    stages: ["pre_seed", "seed"],
    currencyOption: "usd",
    cheque: { min: "25000", typical: "75000", max: "150000" },
    roles: ["co_invest"],
    geographies: ["nigeria", "west_africa"],
    sectors: ["fintech", "digital_health", "ecommerce"],
    thesis:
      "A syndicate of 40 fictional Lagos operators writing small first cheques into consumer and SME fintech and health founders we can help with distribution. We follow a credible lead and want to see real usage, not decks.",
    discoveryMode: "balanced",
  },
  {
    key: "chidi-nwosu-angel",
    name: "Chidi Nwosu Angel Investments (fictional)",
    typeOption: "angel",
    person: {
      displayName: "Chidi Nwosu",
      headline: "Angel investor (fictional demo investor)",
      businessTitle: "Angel investor",
    },
    stages: ["pre_seed", "seed"],
    currencyOption: "usd",
    cheque: { min: "10000", typical: "30000", max: "60000" },
    roles: ["co_invest", "follow"],
    geographies: ["nigeria", "ghana", "kenya"],
    sectors: ["agritech", "logistics", "enterprise_software"],
    thesis:
      "Former logistics operator (fictional) backing technical founders in agriculture, logistics and SME software. Small cheques, lots of time, and introductions to distributors.",
    discoveryMode: "exploratory",
  },
  {
    key: "savanna-seed",
    name: "Savanna Seed Partners (fictional)",
    typeOption: "vc",
    person: {
      displayName: "Amara Diallo-Benson",
      headline: "Partner, Savanna Seed Partners (fictional demo investor)",
      businessTitle: "Partner",
    },
    stages: ["seed"],
    currencyOption: "usd",
    cheque: { min: "250000", typical: "600000", max: "1000000" },
    roles: ["lead", "co_invest"],
    geographies: ["africa"],
    sectors: ["fintech", "enterprise_software", "logistics", "digital_lending"],
    thesis:
      "A USD 40m fictional seed fund leading rounds for African fintech, B2B software and logistics companies with early revenue and a clear path to Series A within 24 months.",
    discoveryMode: "balanced",
  },
  {
    key: "equator-line",
    name: "Equator Line Capital (fictional)",
    typeOption: "vc",
    person: {
      displayName: "Daniel Otieno-Brooks",
      headline: "General Partner, Equator Line Capital (fictional demo investor)",
      businessTitle: "General Partner",
    },
    stages: ["series_a"],
    currencyOption: "usd",
    cheque: { min: "2000000", typical: "5000000", max: "8000000" },
    roles: ["lead"],
    geographies: ["africa"],
    sectors: ["logistics", "fintech", "clean_energy", "enterprise_software"],
    thesis:
      "Fictional Series A fund leading USD 2-8m rounds in African companies with proven unit economics in one market and a credible plan for the second. Board seat, hands-on.",
    discoveryMode: "strict",
  },
  {
    key: "tidewater-growth",
    name: "Tidewater Growth Partners (fictional)",
    typeOption: "vc",
    person: {
      displayName: "Sipho Ndlovu-Carter",
      headline: "Managing Partner, Tidewater Growth Partners (fictional demo investor)",
      businessTitle: "Managing Partner",
    },
    stages: ["series_a", "series_b"],
    currencyOption: "usd",
    cheque: { min: "5000000", typical: "10000000", max: "20000000" },
    roles: ["lead", "co_invest"],
    geographies: ["nigeria", "kenya", "south_africa", "egypt"],
    sectors: ["enterprise_software", "fintech", "clean_energy", "retail_technology"],
    thesis:
      "Fictional growth fund for Series A and B companies in Africa's four largest tech markets with USD 3m+ ARR, strong retention and a route to profitability.",
    discoveryMode: "balanced",
  },
  {
    key: "pacdf",
    name: "Pan-African Climate Development Fund (fictional)",
    typeOption: "institutional",
    person: {
      displayName: "Aïcha Traoré-Williams",
      headline: "Investment Director, PACDF (fictional demo investor)",
      businessTitle: "Investment Director",
    },
    stages: ["series_a", "series_b"],
    currencyOption: "usd",
    cheque: { min: "3000000", typical: "10000000", max: "25000000" },
    roles: ["lead", "co_invest"],
    geographies: ["africa"],
    sectors: ["clean_energy", "energy_access", "agritech", "agriculture"],
    thesis:
      "A fictional development-finance-style fund investing blended equity and debt in climate and energy-access businesses with measurable impact (tonnes of CO2 avoided, households connected) and bankable project pipelines.",
    discoveryMode: "strict",
  },
  {
    key: "transcoastal-ventures",
    name: "Transcoastal Telecom Ventures (fictional)",
    typeOption: "cvc",
    person: {
      displayName: "Rania Haddad-Okoro",
      headline: "Head of Ventures, Transcoastal Telecom (fictional demo investor)",
      businessTitle: "Head of Ventures",
    },
    stages: ["seed", "series_a"],
    currencyOption: "usd",
    cheque: { min: "500000", typical: "1500000", max: "3000000" },
    roles: ["co_invest"],
    geographies: ["nigeria", "egypt", "kenya", "ghana"],
    sectors: ["fintech", "retail_technology", "logistics", "embedded_payments"],
    thesis:
      "The venture arm of a fictional pan-African telecom operator. We co-invest where our mobile-money and agent network can be a distribution channel for the company.",
    discoveryMode: "exploratory",
  },
  {
    key: "rift-valley-seed",
    name: "Rift Valley Seed Fund (fictional)",
    typeOption: "vc",
    person: {
      displayName: "Njeri Waweru",
      headline: "Partner, Rift Valley Seed Fund (fictional demo investor)",
      businessTitle: "Partner",
    },
    stages: ["pre_seed", "seed"],
    currencyOption: "usd",
    cheque: { min: "150000", typical: "400000", max: "750000" },
    roles: ["lead", "co_invest"],
    geographies: ["east_africa", "kenya"],
    sectors: ["agritech", "clean_energy", "digital_health", "enterprise_software"],
    thesis:
      "Fictional East African seed fund for founders solving everyday infrastructure gaps — water, energy, food and health — with hardware-light models where possible.",
    discoveryMode: "balanced",
  },
];

export const FICTIONAL_INTERESTS: readonly FictionalInterest[] = [
  { investorKey: "savanna-seed", companyKey: "ledgerfold", founderAnswer: "accept" },
  { investorKey: "equator-line", companyKey: "tarmacly", founderAnswer: "accept" },
  { investorKey: "pacdf", companyKey: "marketlight-grids", founderAnswer: "pending" },
  { investorKey: "tidewater-growth", companyKey: "tallyloom", founderAnswer: "accept" },
  { investorKey: "lagoon-angels", companyKey: "ajopot", founderAnswer: "decline" },
  { investorKey: "rift-valley-seed", companyKey: "maji-loop", founderAnswer: "pending" },
  { investorKey: "transcoastal-ventures", companyKey: "souqsheet", founderAnswer: "accept" },
  { investorKey: "chidi-nwosu-angel", companyKey: "yamfield-agro", founderAnswer: "pending" },
];
