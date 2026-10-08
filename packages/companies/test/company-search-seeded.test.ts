import { describe, expect, it } from "vitest";

import {
  parseCompanySearch,
  scoreCompanySearch,
  type CompanySearchDocument,
} from "../src/index.js";
import { companySearchJoins } from "../src/infrastructure/company-search-sql.js";

/**
 * 2026-10-08: search over the seeded companies (founder: "search doesn't
 * work well for them"). Each is found first by its name, a misspelling or
 * a split name, its country or city, and the words people use for what it
 * does, through the one shared reading and ranking (domain twin of the
 * SQL in company-search-sql.ts, checked against hosted data read-only).
 */

const doc = (
  name: string,
  more: Partial<CompanySearchDocument> = {},
): CompanySearchDocument => ({
  name,
  shortDescription: null,
  country: null,
  stage: null,
  ...more,
});

const SEEDED: readonly CompanySearchDocument[] = [
  doc("Ledgerline", {
    shortDescription:
      "Ledgerline checks every invoice at creation and files VAT returns for Nigerian SMEs, ready for FIRS e-invoicing.",
    city: "Lagos",
    country: "NG",
    stage: "seed",
    labels: [
      "Enterprise Software",
      "Workflow Automation",
      "B2B SaaS",
      "Business Customer",
      "Fintech",
      "Small & Medium Business",
    ],
  }),
  doc("Baridi", {
    shortDescription:
      "Solar cold rooms at Lake Victoria landing beaches; fish traders pay per crate per day on mobile money.",
    city: "Kisumu",
    country: "KE",
    stage: "seed",
    labels: [
      "Energy",
      "Agriculture",
      "Transaction Fee",
      "Services",
      "Consumer",
      "Clean Energy",
      "Energy Access",
      "Small & Medium Business",
    ],
  }),
  doc("Termly", {
    shortDescription:
      "Termly lets Lagos parents spread school fees across the term while the school is paid in full on day one.",
    city: "Lagos",
    country: "NG",
    stage: "pre_seed",
    labels: [
      "Education",
      "Embedded Finance",
      "Transaction Fee",
      "Business Customer",
      "Consumer",
      "Fintech",
      "Digital Lending",
    ],
  }),
  doc("MedTrail", {
    shortDescription:
      "MedTrail serialises medicine packs at Nigerian distributors and tracks each one, so a recall finds every pack in hours, not weeks.",
    city: "Lagos",
    country: "NG",
    stage: "seed",
    labels: [
      "Enterprise Software",
      "Healthcare",
      "B2B SaaS",
      "Transaction Fee",
      "Business Customer",
      "Supply Chain",
      "Enterprise",
    ],
  }),
  doc("Ferrolith", {
    shortDescription:
      "Sodium-ion cells for stationary storage, made in Europe without lithium, cobalt or nickel; validated past 4,000 cycles.",
    city: "Munich",
    country: "DE",
    stage: "series_a",
    labels: [
      "Energy",
      "Manufacturing & Industrial",
      "Licensing",
      "Hardware Sales",
      "Business Customer",
      "Clean Energy",
      "Enterprise",
    ],
  }),
  doc("Clearwater Assurance", {
    shortDescription:
      "Continuous, independent validation of UK banks' credit and AI models, with the evidence supervisors ask for.",
    city: "London",
    country: "GB",
    stage: "series_a",
    labels: [
      "Enterprise Software",
      "B2B SaaS",
      "Licensing",
      "Financial Institution",
      "Fintech",
      "Banking",
      "Enterprise",
    ],
  }),
  doc("Shiftwell", {
    shortDescription:
      "Scheduling, EVV, payroll and billing for US home-care agencies in one system, built by a former agency owner.",
    city: "Columbus",
    country: "US",
    stage: "series_a",
    labels: [
      "Enterprise Software",
      "Healthcare",
      "Workflow Automation",
      "B2B SaaS",
      "HR Technology",
      "Small & Medium Business",
      "Mid-Market",
    ],
  }),
  doc("Tensorgate", {
    shortDescription:
      "A gateway that runs LLM inference inside hardware enclaves and attests every request, so regulated firms can use AI on sensitive data.",
    city: "Austin",
    country: "US",
    stage: "seed",
    labels: [
      "Enterprise Software",
      "Cybersecurity",
      "B2B SaaS",
      "Usage-Based Pricing",
      "Financial Institution",
      "Enterprise",
    ],
  }),
  doc("Silo Credit", {
    shortDescription:
      "Silo Credit certifies warehouses and issues digital receipts that let Kano grain traders borrow against stored grain and sell later.",
    city: "Kano",
    country: "NG",
    stage: "seed",
    labels: [
      "Agriculture",
      "Transaction Fee",
      "Services",
      "Consumer",
      "Fintech",
      "Agritech",
      "Small & Medium Business",
      "Digital Lending",
    ],
  }),
  doc("Portside", {
    shortDescription:
      "The software Lagos clearing agents run customs clearance on, from documents to duty payments to sign-offs.",
    city: "Lagos",
    country: "NG",
    stage: "seed",
    labels: [
      "Enterprise Software",
      "Logistics & Mobility",
      "Workflow Automation",
      "B2B SaaS",
      "Transaction Fee",
      "Business Customer",
      "Supply Chain",
      "Small & Medium Business",
    ],
  }),
  doc("Drishti Health", {
    shortDescription:
      "Retinal cameras in neighbourhood pharmacies; AI reads the image in under a minute and refers at-risk diabetics the same day.",
    city: "Pune",
    country: "IN",
    stage: "seed",
    labels: [
      "Healthcare",
      "Transaction Fee",
      "Insurance Company",
      "Business Customer",
      "Digital Health",
    ],
  }),
  doc("Prumo", {
    shortDescription:
      "Prumo turns site photos and WhatsApp updates into budget tracking, warning Brazilian builders weeks before a line overruns.",
    city: "São Paulo",
    country: "BR",
    stage: "series_a",
    labels: [
      "Enterprise Software",
      "Real Estate",
      "B2B SaaS",
      "Business Customer",
      "Proptech",
      "Mid-Market",
    ],
  }),
];

function first(text: string): string | null {
  const parsed = parseCompanySearch(text);
  if (parsed === null) return null;
  const ranked = SEEDED.flatMap((d) => {
    const score = scoreCompanySearch(parsed, d);
    return score === null ? [] : [{ name: d.name, score }];
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return ranked[0]?.name ?? null;
}

describe("seeded company search (2026-10-08)", () => {
  it.each([
    ["Ledgerline", "Ledgerline"],
    ["ledger line", "Ledgerline"],
    ["ledgerlin", "Ledgerline"],
    ["clear water", "Clearwater Assurance"],
    ["dristi", "Drishti Health"],
    ["Drishti Health India", "Drishti Health"],
    ["silocredit", "Silo Credit"],
    ["med trail", "MedTrail"],
    ["Medtrial", "MedTrail"],
    ["tensor gate", "Tensorgate"],
    ["port side", "Portside"],
    ["shift well", "Shiftwell"],
    ["baridi kenya", "Baridi"],
    ["prumo brazil", "Prumo"],
    ["ferrolith germany", "Ferrolith"],
  ])("finds %s as %s by name", (text, name) => {
    expect(first(text)).toBe(name);
  });

  it.each([
    ["VAT invoicing Nigeria", "Ledgerline"],
    ["e-invoicing", "Ledgerline"],
    ["school fees nigeria", "Termly"],
    ["solar cold storage kenya", "Baridi"],
    ["sodium-ion batteries", "Ferrolith"],
    ["battery storage germany", "Ferrolith"],
    ["climate tech germany", "Ferrolith"],
    ["home care US", "Shiftwell"],
    ["customs lagos", "Portside"],
    ["construction software brazil", "Prumo"],
    ["model validation banks", "Clearwater Assurance"],
    ["regtech UK", "Clearwater Assurance"],
    ["AI security", "Tensorgate"],
    ["confidential AI", "Tensorgate"],
    ["warehouse receipts", "Silo Credit"],
    ["eye screening india", "Drishti Health"],
    ["diabetic retinopathy", "Drishti Health"],
    ["medicine traceability", "MedTrail"],
    ["pharma supply chain nigeria", "MedTrail"],
    ["proptech brazil", "Prumo"],
    ["cleantech kenya", "Baridi"],
    ["edtech nigeria", "Termly"],
  ])("finds %s as %s by what it does", (text, name) => {
    expect(first(text)).toBe(name);
  });

  it("a whole word ranks above a longer word that contains it", () => {
    // "customs" is Portside's word; Ledgerline only has "customer".
    expect(first("customs lagos")).toBe("Portside");
  });

  it("two words must both match; a third may be said differently", () => {
    expect(first("fintech germany")).toBeNull();
    expect(first("solar cold storage kenya")).toBe("Baridi");
    expect(first("solar quantum widgets kenya")).toBeNull();
  });

  it("the SQL twin sends no undefined segment for any of these", () => {
    for (const text of [
      "dristi",
      "customs lagos",
      "solar cold storage kenya",
    ]) {
      const parsed = parseCompanySearch(text);
      expect(parsed).not.toBeNull();
      if (parsed === null) continue;
      const sent: (string | undefined)[][] = [];
      const sql = (strings: TemplateStringsArray) => {
        sent.push([...strings]);
        return {};
      };
      companySearchJoins(sql as never, parsed);
      for (const strings of sent) {
        expect(strings.every((s) => typeof s === "string")).toBe(true);
      }
    }
  });
});
