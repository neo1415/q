import type { QIqEntity, QIqFact } from "./contracts.js";

/**
 * The Q-IQ world: every company, investor, person and document here is
 * INVENTED for the benchmark. Names are chosen in confusable pairs
 * (Silo Credit / Silo Health, Ledgerfold / Ledgerline, Brightwell /
 * Brightpath) because that is where wrong-entity answers come from.
 * Some fields are deliberately absent (the UNKNOWN category asks for
 * them) and two companies carry conflicting sources (CONTRADICTIONS).
 */

type Pronoun = "she" | "he" | "they";

export type QIqPerson = {
  readonly id: string;
  readonly name: string;
  readonly first: string;
  readonly pronoun: Pronoun;
  readonly role: string;
  readonly companyId: string;
  readonly joined: number;
  readonly background: string;
  /** A word a correct answer about their background contains. */
  readonly signature: string;
};

export type QIqCompany = {
  readonly id: string;
  readonly name: string;
  readonly short: string;
  readonly sector: string;
  readonly city: string;
  readonly founded: number;
  /** USD; null = not in the evidence (unknown, never zero). */
  readonly arr: number | null;
  readonly burn: number | null;
  readonly runwayMonths: number | null;
  readonly customers: number | null;
  readonly customerNoun: string;
  readonly grossMarginPct: number | null;
  readonly raising: number | null;
  readonly round: string;
  readonly ceo: string;
  readonly cfo: string | null;
};

export const Q_IQ_COMPANIES: readonly QIqCompany[] = [
  {
    id: "co-silo-credit",
    name: "Silo Credit",
    short: "Silo Credit",
    sector: "SME lending",
    city: "Lagos",
    founded: 2021,
    arr: 2_400_000,
    burn: 180_000,
    runwayMonths: 14,
    customers: 38,
    customerNoun: "lending partners",
    grossMarginPct: 62,
    raising: 6_000_000,
    round: "Series A",
    ceo: "p-tunde-bakare",
    cfo: "p-ngozi-eze",
  },
  {
    id: "co-silo-health",
    name: "Silo Health",
    short: "Silo Health",
    sector: "clinic software",
    city: "Nairobi",
    founded: 2022,
    arr: 1_100_000,
    burn: 95_000,
    runwayMonths: 22,
    customers: 14,
    customerNoun: "clinic groups",
    grossMarginPct: 48,
    raising: 3_000_000,
    round: "seed extension",
    ceo: "p-wanjiru-kamau",
    cfo: null,
  },
  {
    id: "co-ledgerfold",
    name: "Ledgerfold",
    short: "Ledgerfold",
    sector: "accounting software",
    city: "Accra",
    founded: 2020,
    arr: 3_600_000,
    burn: 240_000,
    runwayMonths: 18,
    customers: 410,
    customerNoun: "business customers",
    grossMarginPct: 78,
    raising: 10_000_000,
    round: "Series A",
    ceo: "p-kofi-mensah",
    cfo: "p-amara-osei",
  },
  {
    id: "co-ledgerline",
    name: "Ledgerline",
    short: "Ledgerline",
    sector: "payroll software",
    city: "Cape Town",
    founded: 2022,
    arr: 900_000,
    burn: 120_000,
    runwayMonths: 9,
    customers: 130,
    customerNoun: "employers",
    grossMarginPct: 71,
    raising: 4_000_000,
    round: "seed",
    ceo: "p-lindiwe-dube",
    cfo: "p-jason-naidoo",
  },
  {
    id: "co-brightwell",
    name: "Brightwell Energy",
    short: "Brightwell",
    sector: "solar mini-grids",
    city: "Kisumu",
    founded: 2019,
    arr: 5_200_000,
    burn: 310_000,
    runwayMonths: 11,
    customers: 18_000,
    customerNoun: "connected households",
    grossMarginPct: 34,
    raising: 12_000_000,
    round: "Series B",
    ceo: "p-achieng-odhiambo",
    cfo: null,
  },
  {
    id: "co-brightpath",
    name: "Brightpath Logistics",
    short: "Brightpath",
    sector: "freight logistics",
    city: "Kigali",
    founded: 2021,
    arr: 2_000_000,
    burn: 150_000,
    runwayMonths: 16,
    customers: 120,
    customerNoun: "trucks under contract",
    grossMarginPct: null,
    raising: 5_000_000,
    round: "Series A",
    ceo: "p-eric-habimana",
    cfo: "p-grace-uwase",
  },
  {
    id: "co-kora-farms",
    name: "Kora Farms",
    short: "Kora Farms",
    sector: "agritech",
    city: "Tamale",
    founded: 2023,
    arr: null,
    burn: 60_000,
    runwayMonths: null,
    customers: 900,
    customerNoun: "smallholder farmers",
    grossMarginPct: null,
    raising: 1_500_000,
    round: "pre-seed",
    ceo: "p-esi-asante",
    cfo: null,
  },
  {
    id: "co-tamarind-pay",
    name: "Tamarind Pay",
    short: "Tamarind",
    sector: "merchant payments",
    city: "Lagos",
    founded: 2020,
    arr: 4_100_000,
    burn: 260_000,
    runwayMonths: 13,
    customers: 2_300,
    customerNoun: "merchants",
    grossMarginPct: 41,
    raising: 8_000_000,
    round: "Series A",
    ceo: "p-chidi-okafor",
    cfo: "p-funmi-adeyemi",
  },
  {
    id: "co-quaywise",
    name: "Quaywise Freight",
    short: "Quaywise",
    sector: "port freight booking",
    city: "Mombasa",
    founded: 2022,
    arr: 1_700_000,
    burn: 130_000,
    runwayMonths: null,
    customers: 85,
    customerNoun: "shippers",
    grossMarginPct: 29,
    raising: 4_500_000,
    round: "seed",
    ceo: "p-hassan-ali",
    cfo: null,
  },
  {
    id: "co-nyota-learn",
    name: "Nyota Learn",
    short: "Nyota",
    sector: "edtech",
    city: "Dar es Salaam",
    founded: 2021,
    arr: 750_000,
    burn: 70_000,
    runwayMonths: 20,
    customers: null,
    customerNoun: "schools",
    grossMarginPct: 66,
    raising: null,
    round: "seed",
    ceo: "p-neema-mushi",
    cfo: null,
  },
];

export const Q_IQ_PEOPLE: readonly QIqPerson[] = [
  {
    id: "p-tunde-bakare",
    name: "Tunde Bakare",
    first: "Tunde",
    pronoun: "he",
    role: "CEO",
    companyId: "co-silo-credit",
    joined: 2021,
    background: "a former credit risk lead at a commercial bank",
    signature: "bank",
  },
  {
    id: "p-ngozi-eze",
    name: "Ngozi Eze",
    first: "Ngozi",
    pronoun: "she",
    role: "CFO",
    companyId: "co-silo-credit",
    joined: 2022,
    background: "a chartered accountant from audit practice",
    signature: "accountant",
  },
  {
    id: "p-wanjiru-kamau",
    name: "Wanjiru Kamau",
    first: "Wanjiru",
    pronoun: "she",
    role: "CEO",
    companyId: "co-silo-health",
    joined: 2022,
    background: "a doctor who ran a chain of clinics",
    signature: "doctor",
  },
  {
    id: "p-peter-otieno",
    name: "Peter Otieno",
    first: "Peter",
    pronoun: "he",
    role: "CTO",
    companyId: "co-silo-health",
    joined: 2023,
    background: "a backend engineer from a mobile money company",
    signature: "mobile money",
  },
  {
    id: "p-kofi-mensah",
    name: "Kofi Mensah",
    first: "Kofi",
    pronoun: "he",
    role: "CEO",
    companyId: "co-ledgerfold",
    joined: 2020,
    background: "a product manager who built tax filing tools",
    signature: "tax",
  },
  {
    id: "p-amara-osei",
    name: "Amara Osei",
    first: "Amara",
    pronoun: "she",
    role: "CFO",
    companyId: "co-ledgerfold",
    joined: 2023,
    background: "a former finance director at a telecoms group",
    signature: "telecoms",
  },
  {
    id: "p-lindiwe-dube",
    name: "Lindiwe Dube",
    first: "Lindiwe",
    pronoun: "she",
    role: "CEO",
    companyId: "co-ledgerline",
    joined: 2022,
    background: "an HR software consultant",
    signature: "HR",
  },
  {
    id: "p-jason-naidoo",
    name: "Jason Naidoo",
    first: "Jason",
    pronoun: "he",
    role: "CFO",
    companyId: "co-ledgerline",
    joined: 2021,
    background: "an investment banking associate",
    signature: "banking",
  },
  {
    id: "p-achieng-odhiambo",
    name: "Achieng Odhiambo",
    first: "Achieng",
    pronoun: "she",
    role: "CEO",
    companyId: "co-brightwell",
    joined: 2019,
    background: "an electrical engineer from a utility",
    signature: "utility",
  },
  {
    id: "p-eric-habimana",
    name: "Eric Habimana",
    first: "Eric",
    pronoun: "he",
    role: "CEO",
    companyId: "co-brightpath",
    joined: 2021,
    background: "a former fleet manager",
    signature: "fleet",
  },
  {
    id: "p-grace-uwase",
    name: "Grace Uwase",
    first: "Grace",
    pronoun: "she",
    role: "CFO",
    companyId: "co-brightpath",
    joined: 2024,
    background: "a corporate treasury analyst",
    signature: "treasury",
  },
  {
    id: "p-esi-asante",
    name: "Esi Asante",
    first: "Esi",
    pronoun: "she",
    role: "CEO",
    companyId: "co-kora-farms",
    joined: 2023,
    background: "an agronomist",
    signature: "agronomist",
  },
  {
    id: "p-chidi-okafor",
    name: "Chidi Okafor",
    first: "Chidi",
    pronoun: "he",
    role: "CEO",
    companyId: "co-tamarind-pay",
    joined: 2020,
    background: "a payments engineer",
    signature: "payments",
  },
  {
    id: "p-funmi-adeyemi",
    name: "Funmi Adeyemi",
    first: "Funmi",
    pronoun: "she",
    role: "CFO",
    companyId: "co-tamarind-pay",
    joined: 2021,
    background: "a fintech controller",
    signature: "controller",
  },
  {
    id: "p-hassan-ali",
    name: "Hassan Ali",
    first: "Hassan",
    pronoun: "he",
    role: "CEO",
    companyId: "co-quaywise",
    joined: 2022,
    background: "a shipping line operations manager",
    signature: "shipping",
  },
  {
    id: "p-neema-mushi",
    name: "Neema Mushi",
    first: "Neema",
    pronoun: "she",
    role: "CEO",
    companyId: "co-nyota-learn",
    joined: 2021,
    background: "a secondary school teacher",
    signature: "teacher",
  },
];

export type QIqDocument = {
  readonly id: string;
  readonly name: string;
  readonly companyId: string;
  readonly date: string;
  readonly arr: number;
  readonly ask: number;
};

/** Two decks per company for "the other deck" turns. */
export const Q_IQ_DOCUMENTS: readonly QIqDocument[] = [
  {
    id: "doc-silo-credit-a",
    name: "Silo Credit Series A deck",
    companyId: "co-silo-credit",
    date: "September 2026",
    arr: 2_400_000,
    ask: 6_000_000,
  },
  {
    id: "doc-silo-credit-seed",
    name: "Silo Credit seed deck",
    companyId: "co-silo-credit",
    date: "March 2024",
    arr: 400_000,
    ask: 1_200_000,
  },
  {
    id: "doc-ledgerfold-a",
    name: "Ledgerfold Series A deck",
    companyId: "co-ledgerfold",
    date: "August 2026",
    arr: 3_600_000,
    ask: 10_000_000,
  },
  {
    id: "doc-ledgerfold-seed",
    name: "Ledgerfold seed deck",
    companyId: "co-ledgerfold",
    date: "May 2023",
    arr: 700_000,
    ask: 2_000_000,
  },
];

/** Conflicting sources: both must be shown, never the favourable one alone. */
export type QIqContradiction = {
  readonly id: string;
  readonly companyId: string;
  readonly metric: string;
  readonly question: string;
  readonly a: {
    readonly value: number;
    readonly source: string;
    readonly unit: string;
  };
  readonly b: {
    readonly value: number;
    readonly source: string;
    readonly unit: string;
  };
};

export const Q_IQ_CONTRADICTIONS: readonly QIqContradiction[] = [
  {
    id: "x-brightwell-sites",
    companyId: "co-brightwell",
    metric: "operating mini-grid sites",
    question: "How many sites does Brightwell run?",
    a: { value: 41, source: "pitch deck (October 2026)", unit: "sites" },
    b: {
      value: 36,
      source: "operations report (September 2026)",
      unit: "sites",
    },
  },
  {
    id: "x-tamarind-churn",
    companyId: "co-tamarind-pay",
    metric: "monthly merchant churn",
    question: "What's Tamarind's merchant churn?",
    a: { value: 3, source: "founder statement on a call", unit: "%" },
    b: { value: 7, source: "data room metrics workbook", unit: "%" },
  },
  {
    id: "x-quaywise-gmv",
    companyId: "co-quaywise",
    metric: "annual booking volume",
    question: "What booking volume does Quaywise do a year?",
    a: { value: 22_000_000, source: "pitch deck", unit: "USD" },
    b: { value: 15_000_000, source: "audited accounts 2025", unit: "USD" },
  },
  {
    id: "x-nyota-schools",
    companyId: "co-nyota-learn",
    metric: "paying schools",
    question: "How many schools pay for Nyota?",
    a: { value: 64, source: "founder update (October 2026)", unit: "schools" },
    b: {
      value: 52,
      source: "billing export (September 2026)",
      unit: "schools",
    },
  },
  {
    id: "x-brightpath-margin",
    companyId: "co-brightpath",
    metric: "gross margin",
    question: "What's Brightpath's gross margin?",
    a: { value: 22, source: "management accounts", unit: "%" },
    b: { value: 17, source: "investor memo from a previous round", unit: "%" },
  },
];

export const Q_IQ_INVESTORS = [
  {
    id: "inv-baobab-ridge",
    name: "Baobab Ridge Capital",
    chequeMin: 250_000,
    chequeMax: 1_000_000,
    stage: "seed",
  },
  {
    id: "inv-kestrel-lane",
    name: "Kestrel Lane Ventures",
    chequeMin: 2_000_000,
    chequeMax: 5_000_000,
    stage: "Series A",
  },
] as const;

export function company(id: string): QIqCompany {
  const found = Q_IQ_COMPANIES.find((c) => c.id === id);
  if (found === undefined) throw new Error(`unknown Q-IQ company ${id}`);
  return found;
}

export function person(id: string): QIqPerson {
  const found = Q_IQ_PEOPLE.find((p) => p.id === id);
  if (found === undefined) throw new Error(`unknown Q-IQ person ${id}`);
  return found;
}

export function companyByShort(short: string): QIqCompany {
  const found = Q_IQ_COMPANIES.find((c) => c.short === short);
  if (found === undefined) throw new Error(`unknown Q-IQ company ${short}`);
  return found;
}

/** USD as a person would say it: $2.4M, $180k. */
export function usd(value: number): string {
  if (value >= 1_000_000) {
    const m = value / 1_000_000;
    return `$${Number.isInteger(m) ? m.toFixed(0) : m.toFixed(m >= 10 ? 1 : 2).replace(/0$/, "")}M`;
  }
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}k`;
  return `$${value}`;
}

function companyFacts(c: QIqCompany): QIqFact[] {
  const facts: QIqFact[] = [];
  const add = (
    key: string,
    statement: string,
    figures: number[],
    source = "company profile and data room",
  ): void => {
    facts.push({
      id: `${c.id}:${key}`,
      entityId: c.id,
      statement,
      figures,
      source,
      truthClass: "USER_CLAIM",
      evidenceStatus: "DOCUMENT_SUPPORTED",
      asOf: "2026-10",
    });
  };
  add(
    "profile",
    `${c.name} is a ${c.sector} company based in ${c.city}, founded in ${c.founded}.`,
    [c.founded],
  );
  if (c.arr !== null)
    add("arr", `${c.name} annual recurring revenue (ARR) is ${usd(c.arr)}.`, [
      c.arr,
    ]);
  if (c.burn !== null)
    add("burn", `${c.name} net monthly burn is ${usd(c.burn)}.`, [c.burn]);
  if (c.runwayMonths !== null)
    add("runway", `${c.name} cash runway is ${c.runwayMonths} months.`, [
      c.runwayMonths,
    ]);
  if (c.customers !== null)
    add("customers", `${c.name} has ${c.customers} ${c.customerNoun}.`, [
      c.customers,
    ]);
  if (c.grossMarginPct !== null)
    add("margin", `${c.name} gross margin is ${c.grossMarginPct}%.`, [
      c.grossMarginPct,
    ]);
  if (c.raising !== null)
    add("raise", `${c.name} is raising a ${usd(c.raising)} ${c.round}.`, [
      c.raising,
    ]);
  else add("raise", `${c.name} is not currently raising.`, []);
  return facts;
}

function personFacts(p: QIqPerson): QIqFact {
  const c = company(p.companyId);
  return {
    id: `${p.id}:role`,
    entityId: p.id,
    statement: `${p.name} (${p.pronoun === "they" ? "they/them" : p.pronoun === "she" ? "she/her" : "he/him"}) is the ${p.role} of ${c.name}, in the role since ${p.joined}; ${p.pronoun} is ${p.background}.`,
    figures: [p.joined],
    source: "company team page",
    truthClass: "USER_CLAIM",
    evidenceStatus: "SELF_REPORTED",
  };
}

function documentFacts(d: QIqDocument): QIqFact {
  return {
    id: `${d.id}:summary`,
    entityId: d.id,
    statement: `The ${d.name} (dated ${d.date}) states ARR of ${usd(d.arr)} and asks for ${usd(d.ask)}.`,
    figures: [d.arr, d.ask],
    source: d.name,
    truthClass: "USER_CLAIM",
    evidenceStatus: "DOCUMENT_SUPPORTED",
  };
}

function contradictionFacts(x: QIqContradiction): QIqFact[] {
  const c = company(x.companyId);
  const render = (v: { value: number; unit: string }): string =>
    v.unit === "USD"
      ? usd(v.value)
      : v.unit === "%"
        ? `${v.value}%`
        : `${v.value} ${v.unit}`;
  return [x.a, x.b].map((side, i) => ({
    id: `${x.id}:${i === 0 ? "a" : "b"}`,
    entityId: c.id,
    statement: `${c.name} ${x.metric}: ${render(side)} according to the ${side.source}.`,
    figures: [side.value],
    source: side.source,
    truthClass: "USER_CLAIM" as const,
    evidenceStatus: "DOCUMENT_SUPPORTED" as const,
  }));
}

/** Every authorised fact a case may use: the same list Q and the bare model receive. */
export const Q_IQ_FACTS: readonly QIqFact[] = [
  ...Q_IQ_COMPANIES.flatMap(companyFacts),
  ...Q_IQ_PEOPLE.map(personFacts),
  ...Q_IQ_DOCUMENTS.map(documentFacts),
  ...Q_IQ_CONTRADICTIONS.flatMap(contradictionFacts),
  ...Q_IQ_INVESTORS.map((i) => ({
    id: `${i.id}:mandate`,
    entityId: i.id,
    statement: `${i.name} invests at ${i.stage} with cheques from ${usd(i.chequeMin)} to ${usd(i.chequeMax)}.`,
    figures: [i.chequeMin, i.chequeMax],
    source: "declared mandate",
    truthClass: "USER_CLAIM" as const,
    evidenceStatus: "SELF_REPORTED" as const,
  })),
];

export const Q_IQ_ENTITIES: readonly QIqEntity[] = [
  ...Q_IQ_COMPANIES.map((c) => ({
    id: c.id,
    kind: "COMPANY" as const,
    name: c.name,
    aliases: c.short === c.name ? [] : [c.short],
  })),
  ...Q_IQ_PEOPLE.map((p) => ({
    id: p.id,
    kind: "PERSON" as const,
    name: p.name,
    aliases: [p.first],
  })),
  ...Q_IQ_DOCUMENTS.map((d) => ({
    id: d.id,
    kind: "DOCUMENT" as const,
    name: d.name,
    aliases: [],
  })),
  ...Q_IQ_INVESTORS.map((i) => ({
    id: i.id,
    kind: "INVESTOR" as const,
    name: i.name,
    aliases: [],
  })),
];
