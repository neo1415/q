// Maps the KUUZA AI research (docs/flagship/kuuza/facts.json + research.md)
// into the company object shape that scripts/seed/tavus20/steps.mjs uses.
// Unknown stays unknown: every field the research marks UNKNOWN is null here
// and the runner skips it rather than inventing a value.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
export const DIR = join(ROOT, "docs/flagship/kuuza");

const facts = JSON.parse(readFileSync(join(DIR, "facts.json"), "utf8"));
const brand = JSON.parse(readFileSync(join(DIR, "brand.json"), "utf8"));
const fact = (field) => facts.find((f) => f.field === field);
const val = (field) => fact(field)?.value ?? null;

/** Steward, never a founder: the fictional account that builds the profile. */
export const STEWARD = "founder.capitalq@fictional.capitalq.local";

/** Taxonomy display names (production taxonomy.nodes; no sales-enablement node exists). */
export const CATEGORIES = [
  "Artificial Intelligence",
  "Enterprise Software",
  "HR Technology",
  "B2B SaaS",
  "Edtech",
];

export function company() {
  const [city, country] = String(val("headquartersOperating")).split(/,\s*/);
  return {
    n: "kuuza",
    company: "KUUZA AI",
    websiteUrl: "https://www.kuuza.ai",
    // Operating base is an ASSUMPTION (medium confidence); legal domicile UNKNOWN.
    headquarters: { country: country === "Nigeria" ? "NG" : null, city },
    headquartersConfidence: fact("headquartersOperating").status,
    // Stage is not published: the runner picks the form's "not sure" option.
    currentStageCode: null,
    // SELF_REPORTED proposition, kept as the company's own claim.
    shortDescription:
      "AI simulator and coach for practising sales, customer-service and other workplace conversations.",
    primaryDescription:
      "KUUZA AI describes itself as an AI simulator and coach for sales, service and human communication. " +
      "Users practise scenarios such as cold calls, discovery calls, objection handling and customer complaints " +
      "by speaking with an AI persona over voice, video or text, then receive scoring and a debrief; managers see " +
      "team analytics. It sells to sales and customer-service teams and offers a free tier to individuals. " +
      "The company says its personas are built for the accents, cultural context and noisy call conditions of " +
      "African, Asian and Middle Eastern markets. (Company's own description, not independently tested.)",
    categories: CATEGORIES,
    legalName: val("legalName"), // UNKNOWN → null, not filled
    foundedDate: val("incorporationDate"), // UNKNOWN → null
    founders: val("founders"), // names only; no accounts, no invitations
    founderPerson: null, // the steward is not a founder and claims no founder role
    team: [],
    headcount: null,
    capital: null, // raise amount, instrument, close date: UNKNOWN
    metrics: null, // revenue, customers: UNKNOWN (never zero)
    brand: {
      logoUrl: brand.logos[0].url,
      charcoal: brand.colors.find((c) => c.token === "charcoal").hex,
      crimson: brand.colors.find((c) => c.token === "crimson").hex,
      ice: brand.colors.find((c) => c.token === "ice-blue").hex,
      usageTerms: brand.usageTerms,
    },
  };
}
