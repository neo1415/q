// Pure mappings from the tavus-20 dataset to the product's reference codes.

/** Dataset folder → evidence.data_room_folders code. */
export const FOLDER = {
  incorporation: "corporate",
  cap_table: "cap_table",
  financials: "financials",
  tax: "tax",
  legal_ip: "legal_ip",
  contracts: "commercial",
  team: "team",
  kyc_kyb: "kyc_kyb",
};

/** Dataset visibility → data room level (ADR-001 scope is derived by the product). */
export const LEVEL = {
  PUBLIC: "PUBLIC",
  ON_REQUEST: "ON_REQUEST",
  SHARED_ONLY: "SHARED_ONLY",
  PRIVATE: "PRIVATE",
};

/** Best checklist item for a document title within its folder, or null. */
export function checklistItem(folderCode, title) {
  const t = title.toLowerCase();
  const rules = [
    [
      "corporate",
      /certificate of incorporation/,
      "certificate_of_incorporation",
    ],
    ["corporate", /board minutes|^board/, "board_minutes"],
    ["corporate", /good standing/, "good_standing"],
    ["cap_table", /cap table/, "cap_table_full"],
    ["cap_table", /share option|esop/, "esop"],
    ["team", /share option|esop/, "esop"],
    ["financials", /management accounts/, "management_accounts"],
    ["financials", /unit economics|cohort|retention/, "unit_economics"],
    ["financials", /business plan|capex|model/, "financial_model"],
    [
      "tax",
      /clearance|compliance (certificate|status)|good standing|régularité|tax status/,
      "tax_clearance",
    ],
    ["tax", /return|filing|ct600|position|finalisation/, "tax_returns"],
    ["legal_ip", /ip assignment/, "ip_assignment_founders"],
    [
      "legal_ip",
      /iso 27001|soc 2|penetration|security|hipaa|toolkit/,
      "security_overview",
    ],
    ["legal_ip", /insurance/, "insurance"],
    ["commercial", /reference/, "customer_references"],
    ["commercial", /contract|agreement/, "customer_contracts"],
    ["kyc_kyb", /kyc|kyb/, "registry_extract"],
  ];
  for (const [folder, re, item] of rules) {
    if (folder === folderCode && re.test(t)) return item;
  }
  return null;
}

/** Instrument as the onboarding / round forms word it. */
export function instrumentOf(text) {
  const t = text.toLowerCase();
  if (t.includes("safe")) return { onboarding: "SAFE", round: "SAFE" };
  if (t.includes("convertible"))
    return { onboarding: "Convertible note", round: "Convertible" };
  return { onboarding: "Priced equity round", round: "Equity" };
}

export const STAGE_LABEL = {
  pre_seed: "Pre-seed",
  seed: "Seed",
  series_a: "Series A",
};
export const COUNTRY_LABEL = {
  NG: "Nigeria",
  KE: "Kenya",
  ZA: "South Africa",
  GH: "Ghana",
  EG: "Egypt",
  GB: "United Kingdom",
  US: "United States",
  DE: "Germany",
  FR: "France",
  IN: "India",
  BR: "Brazil",
};
export const PERSONALITY_LABEL = {
  WARM: "Warm",
  WITTY: "Witty",
  DIRECT: "Direct",
  FORMAL: "Formal",
  AUTO: "Auto",
};

/** Founders: the founder plus team members whose title says co-founder. */
export function founderCount(c) {
  return 1 + c.team.filter((p) => /co-?founder/i.test(p.title)).length;
}

/** Founding-team strengths from titles (checkbox labels in onboarding). */
export function strengthsOf(c) {
  const titles = [c.founderPerson.role, ...c.team.map((p) => p.title)]
    .join(" ")
    .toLowerCase();
  const s = new Set(["Product"]);
  if (/cto|engineer|technolog|machine learning|cryptograph/.test(titles))
    s.add("Engineering");
  if (/sales|revenue|partnership|commercial/.test(titles))
    s.add("Sales and partnerships");
  if (/coo|operations/.test(titles)) s.add("Operations");
  if (/cfo|finance|treasury|credit/.test(titles)) s.add("Finance");
  s.add("Deep industry expertise");
  return [...s];
}

/** Onboarding "Main use of funds" checkboxes from the use-of-funds lines. */
export function useOfFundsBoxes(c) {
  const lines = c.capital.useOfFunds
    .map((u) => u.line.toLowerCase())
    .join(" | ");
  const s = new Set();
  if (
    /engineer|product|platform|r&d|research|integration|technolog|model/.test(
      lines,
    )
  )
    s.add("Product and engineering");
  if (/hire|hiring|team|people|talent/.test(lines)) s.add("Key hires");
  if (
    /sales|go-to-market|marketing|growth|channel|partner|customer/.test(lines)
  )
    s.add("Sales and go-to-market");
  if (/working capital|reserve|operations|runway|general/.test(lines))
    s.add("Runway and operations");
  if (/expan|market|countr|launch|new /.test(lines)) s.add("New markets");
  if (s.size === 0) s.add("Product and engineering");
  return [...s];
}

/** Onboarding "Target close" radio from the close date, relative to today. */
export function closeWindow(dateText, today = new Date("2026-10-06")) {
  const months = (new Date(dateText) - today) / (30.4 * 86400000);
  if (months <= 3) return "Within 3 months";
  if (months <= 6) return "3–6 months";
  if (months <= 12) return "6–12 months";
  return "Not sure yet";
}

/** Registration number from the certificate summary, e.g. "RC 6894215". */
export function registrationNumber(c) {
  const cert = c.dataRoom.find((d) =>
    /certificate of incorporation/i.test(d.title),
  );
  const line =
    cert?.summary.find((s) =>
      /registration number|company number|number/i.test(s),
    ) ?? "";
  const m = /Registration number (?:Company number )?([^;]+);/i.exec(line);
  return m ? m[1].trim() : null;
}
