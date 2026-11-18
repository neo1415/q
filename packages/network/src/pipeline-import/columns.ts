import {
  PIPELINE_IMPORT_FIELDS,
  type PipelineImportField,
  type PipelineImportMapping,
  type PipelineImportStage,
} from "@capital-q/contracts";

/**
 * The deterministic half of reading a pipeline file (decision 106): which
 * column is which, by the header words real CRM exports use (research
 * 2026-11-18 §2: Affinity, DealCloud, Attio, HubSpot, 4Degrees,
 * Foundersuite, Visible, Airtable/Notion/Sheets trackers), and how a
 * stage label in someone's own words reads on Capital Q's pipeline.
 *
 * Q may propose a better mapping for an unusual sheet; this is the
 * fallback that always works, and the check every proposal must pass.
 */

/** Header words per field, most specific first. Compared after normalising. */
export const FIELD_SYNONYMS: Readonly<
  Record<PipelineImportField, readonly string[]>
> = {
  counterpartName: [
    "company",
    "company name",
    "organization",
    "organisation",
    "organization name",
    "organisation name",
    "startup",
    "startup name",
    "deal name",
    "deal",
    "opportunity",
    "opportunity name",
    "investor",
    "investor name",
    "fund",
    "fund name",
    "firm",
    "firm name",
    "vc",
    "account",
    "account name",
    "entity",
    "name",
  ],
  website: [
    "website",
    "web site",
    "url",
    "domain",
    "company domain",
    "homepage",
    "site",
    "company website",
  ],
  stage: [
    "stage",
    "status",
    "deal stage",
    "pipeline stage",
    "list status",
    "phase",
    "pipeline status",
    "investor status",
    "state",
  ],
  stageDate: [
    "stage date",
    "status date",
    "date of status change",
    "stage changed",
    "stage change date",
    "last stage change",
    "date entered stage",
  ],
  addedOn: [
    "date added",
    "added",
    "created",
    "created at",
    "create date",
    "created date",
    "sourced date",
    "date sourced",
    "first contact",
    "first contact date",
  ],
  lastContactOn: [
    "last contact",
    "last contacted",
    "last contact date",
    "last interaction",
    "last activity",
    "last activity date",
    "last email",
    "last meeting",
    "last touch",
  ],
  contactName: [
    "contact",
    "contact name",
    "primary contact",
    "point of contact",
    "founder",
    "founders",
    "ceo",
    "partner",
    "name of investor",
    "key contact",
    "people",
  ],
  contactEmail: [
    "email",
    "e mail",
    "contact email",
    "email address",
    "primary email",
    "founder email",
  ],
  contactTitle: [
    "title",
    "role",
    "job title",
    "position",
    "title of the investor",
  ],
  owner: [
    "owner",
    "owners",
    "deal owner",
    "deal lead",
    "lead partner",
    "assigned to",
    "relationship owner",
    "team member",
    "point person",
  ],
  source: [
    "source",
    "deal source",
    "lead source",
    "referred by",
    "referral",
    "intro",
    "introduced by",
    "warm intro",
    "way in",
    "who can help get a meeting",
    "channel",
    "type of interest",
  ],
  amount: [
    "amount",
    "check size",
    "cheque size",
    "ticket size",
    "ticket",
    "investment amount",
    "round size",
    "raise",
    "raising",
    "deal size",
    "deal value",
    "target",
    "commitment",
    "committed",
    "soft circled",
    "investment amount average",
  ],
  currency: ["currency", "ccy"],
  valuation: [
    "valuation",
    "pre money",
    "post money",
    "pre money valuation",
    "post money valuation",
    "cap",
    "valuation cap",
  ],
  round: [
    "round",
    "series",
    "funding stage",
    "round stage",
    "investment stage",
    "funding round",
    "stage of company",
  ],
  sector: [
    "sector",
    "industry",
    "vertical",
    "focus",
    "primary focus",
    "category",
    "market",
    "thesis",
  ],
  location: [
    "location",
    "hq",
    "headquarters",
    "country",
    "city",
    "region",
    "geography",
  ],
  priority: [
    "priority",
    "ranking",
    "rank",
    "tier",
    "tranche",
    "rating",
    "score",
  ],
  notes: [
    "notes",
    "note",
    "comments",
    "comment",
    "description",
    "last note",
    "other notes",
    "summary",
    "memo",
  ],
  nextStep: [
    "next step",
    "next steps",
    "next action",
    "follow up",
    "follow-up",
    "to do",
    "todo",
    "action item",
  ],
  nextStepDue: [
    "next step date",
    "next step due",
    "follow up date",
    "follow-up date",
    "due date",
    "due",
    "reminder",
    "reminder date",
  ],
  passReason: [
    "pass reason",
    "reason lost",
    "lost reason",
    "declined reason",
    "reason for passing",
    "why passed",
  ],
  tags: ["tags", "tag", "labels", "label", "lists"],
};

/** Lowercase words only: "Deal Stage (Current)" -> "deal stage current". */
export function headerKey(header: string): string {
  return header
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Map headers to fields: an exact header-word match first (field order),
 * then a header that starts with a synonym ("Stage (current)"). Each header
 * lands in one field at most and each field takes one header.
 */
export function mapHeadersBySynonyms(
  headers: readonly string[],
): PipelineImportMapping | null {
  const keys = headers.map(headerKey);
  const used = new Set<number>();
  const mapping: Partial<Record<PipelineImportField, string>> = {};
  const take = (
    field: PipelineImportField,
    matches: (key: string, synonym: string) => boolean,
  ) => {
    if (mapping[field] !== undefined) return;
    for (const synonym of FIELD_SYNONYMS[field]) {
      const index = keys.findIndex(
        (key, at) =>
          !used.has(at) && key !== "" && matches(key, headerKey(synonym)),
      );
      const header = headers[index];
      if (header !== undefined) {
        used.add(index);
        mapping[field] = header;
        return;
      }
    }
  };
  for (const field of PIPELINE_IMPORT_FIELDS)
    take(field, (key, s) => key === s);
  for (const field of PIPELINE_IMPORT_FIELDS) {
    take(
      field,
      (key, s) =>
        s.length >= 5 && (key.startsWith(`${s} `) || key.endsWith(` ${s}`)),
    );
  }
  return mapping.counterpartName === undefined ? null : mapping;
}

/**
 * Whether a proposed mapping (Q's) is usable on these headers: every
 * header it names exists, none is used twice, and the name column is set.
 * Anything else is refused and the synonym mapping is used instead.
 */
export function isUsableMapping(
  mapping: Readonly<Partial<Record<string, string>>>,
  headers: readonly string[],
): mapping is PipelineImportMapping {
  const known = new Set<string>(PIPELINE_IMPORT_FIELDS);
  const present = new Set(headers);
  const seen = new Set<string>();
  for (const [field, header] of Object.entries(mapping)) {
    if (header === undefined) continue;
    if (!known.has(field) || !present.has(header) || seen.has(header))
      return false;
    seen.add(header);
  }
  return typeof mapping["counterpartName"] === "string";
}

// --- stage --------------------------------------------------------------

const STAGE_EXACT: ReadonlyArray<
  readonly [PipelineImportStage, readonly string[]]
> = [
  [
    "PASSED",
    [
      "passed",
      "pass",
      "declined",
      "rejected",
      "lost",
      "closed lost",
      "dead",
      "not a fit",
      "no",
      "turned down",
      "dropped",
    ],
  ],
  [
    "CLOSED",
    [
      "closed",
      "closed won",
      "won",
      "invested",
      "wired",
      "funded",
      "portfolio",
      "done",
      "funds received",
      "money in the bank",
    ],
  ],
  [
    "COMMITTED",
    [
      "committed",
      "soft circled",
      "soft commit",
      "soft committed",
      "verbal",
      "verbal commit",
      "commitment",
      "signed",
      "hard commit",
    ],
  ],
  [
    "TERM_SHEET",
    [
      "term sheet",
      "terms",
      "ts",
      "loi",
      "negotiation",
      "negotiating",
      "legal",
      "closing",
    ],
  ],
  [
    "DILIGENCE",
    [
      "diligence",
      "due diligence",
      "dd",
      "light diligence",
      "evaluating",
      "evaluation",
      "ic",
      "investment committee",
      "deep dive",
      "review",
      "advancing",
      "partner review",
    ],
  ],
  [
    "MEETING",
    [
      "meeting",
      "first meeting",
      "call",
      "met",
      "partner meeting",
      "pitch",
      "pitched",
      "meeting scheduled",
      "intro call",
      "meeting booked",
      "second meeting",
    ],
  ],
  [
    "CONTACTED",
    [
      "contacted",
      "reached out",
      "outreach",
      "reaching out",
      "intro requested",
      "intro made",
      "introduced",
      "emailed",
      "follow up",
      "following up",
      "nurturing",
      "in touch",
      "first contact",
      "in conversation",
      "engaged",
    ],
  ],
  [
    "PAUSED",
    [
      "paused",
      "on hold",
      "hold",
      "keep in touch",
      "later",
      "revisit",
      "parked",
      "not now",
      "dormant",
      "too early",
    ],
  ],
  [
    "RESEARCH",
    [
      "research",
      "researching",
      "new",
      "lead",
      "sourced",
      "target",
      "to contact",
      "prospect",
      "prospecting",
      "qualifying",
      "qualified",
      "inbound",
      "backlog",
      "watchlist",
      "watch list",
      "triage",
      "screening",
      "pipeline",
      "identified",
      "longlist",
      "shortlist",
    ],
  ],
];

/** Keywords tried in this order when no exact phrase matched. */
const STAGE_KEYWORDS: ReadonlyArray<readonly [PipelineImportStage, RegExp]> = [
  ["PASSED", /\b(pass(ed)?|declin|reject|lost|dead)\b/],
  ["CLOSED", /\b(closed|won|invested|wired|funded|portfolio)\b/],
  ["COMMITTED", /\b(commit|soft circ|verbal|signed)/],
  ["TERM_SHEET", /\b(term sheet|terms|loi|negotiat|legal)\b/],
  ["DILIGENCE", /\b(diligence|dd|ic|committee|deep dive|evaluat)/],
  ["MEETING", /\b(meeting|call|met|pitch)/],
  ["CONTACTED", /\b(contact|outreach|intro|email|follow|touch)/],
  ["PAUSED", /\b(pause|hold|later|revisit|park)/],
  ["RESEARCH", /\b(research|lead|sourc|target|prospect|qualif|screen|new)\b/],
];

/** A stage label as Capital Q's pipeline reads it; UNKNOWN when unclear. */
export function readStage(label: string): PipelineImportStage {
  const key = headerKey(label).replace(/^\d+\s+/, "");
  if (key === "") return "UNKNOWN";
  for (const [stage, phrases] of STAGE_EXACT) {
    if (phrases.includes(key)) return stage;
  }
  for (const [stage, pattern] of STAGE_KEYWORDS) {
    if (pattern.test(key)) return stage;
  }
  return "UNKNOWN";
}
