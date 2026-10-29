import type { PromptDefinition } from "../definition.js";
import {
  RESEARCH_FACTS_SCHEMA_NAME,
  RESEARCH_FACTS_V3_SCHEMA_VERSION,
  RESEARCH_PLAN_SCHEMA_NAME,
  RESEARCH_PLAN_V4_SCHEMA_VERSION,
  RESEARCH_PLAN_V4_UNTRUSTED,
  ResearchFactsResultV3Schema,
  ResearchPlanResultV4Schema,
  ResearchPlanVariablesV4Schema,
  type AnalysisDocumentResultV3,
  type AnalysisWriteVariables,
  type ResearchFactsResultV3,
  type ResearchFactsVariables,
  type ResearchPlanResultV4,
  type ResearchPlanVariablesV4,
} from "../schemas/analyst.js";
import {
  ANALYSIS_WRITE_V4,
  RESEARCH_FACTS_V2,
  RESEARCH_PLAN_V3,
} from "./analyst.v1.js";

/**
 * Investigation-grade research (owner 2026-10-29): "Q, investigate the
 * <sector>. Give me an evidence-backed report." A chatbot writes from a
 * handful of results; Q plans, searches in rounds on what is still open,
 * reads facts, cross-checks them in code, and writes a sourced report
 * that states its uncertainty.
 *
 *   RESEARCH_PLAN v4   primary sources first (the market's own regulator,
 *                      registry or statistics office, found by search);
 *                      later rounds plan only for the open questions code
 *                      found, never repeating a query already sent; words
 *                      for Capital Q's own company search, which never
 *                      leave Capital Q.
 *   RESEARCH_FACTS v3  each fact labels what it measures and what it is
 *                      about, so code can group and compare figures.
 *   ANALYSIS_WRITE v5  the investigation report's sections; code adds
 *                      Contradictions, What public sources cannot establish
 *                      and the tiered Sources.
 */

export const RESEARCH_PLAN_INVESTIGATION_RULES = `- PRIMARY SOURCES FIRST: for a line an official body governs or records -- regulation, licensing, enforcement, official statistics, company filings or registries -- the query asks for that body's own publication: name the regulator, central bank, statistics office, official gazette or company registry of the country in question when you know it (never another country's), or ask for it by role ("<country> <topic> regulator circular", "<country> company registry <name>") so search finds it. Set primary: true on such a question, otherwise false. A company's own annual report or investor page is its claim about itself, still worth finding.
- INVESTIGATION ROUNDS: when OPEN QUESTIONS is not empty this is a later round. Plan only for those open questions -- at most two questions each, each with the open question's own lane label -- and nothing else. Sources that disagree want the primary source or a third independent one; out-of-date facts want the latest figures or publications; a missing primary source wants the official body's own page; a line that found nothing wants a different angle or term. Never repeat a query in ALREADY ASKED. When nothing new is worth searching, return no questions.
- internalQuery: 2 to 6 words of sector, place and stage for Capital Q's own company records (for example "payments seed"), when the request is about a sector or market; otherwise null. It is never sent outside Capital Q, and it carries nothing private.
`;

export const RESEARCH_PLAN_V4: PromptDefinition<
  ResearchPlanVariablesV4,
  ResearchPlanResultV4
> = {
  id: "RESEARCH_PLAN",
  version: 4,
  status: "ACTIVE",
  kind: "TASK",
  taskClass: "STRUCTURED_EXTRACTION",
  owner: "q-core",
  effectiveFrom: "2026-10-29",
  changeDescription:
    "Investigation 2026-10-29: v3 plus primary sources first (the market's own regulator, registry, statistics office or gazette, found by search, with primary marked), investigation rounds that plan only for the open questions code found and never repeat a query already sent, and words for Capital Q's own company search that never leave Capital Q.",
  variables: {
    schema: ResearchPlanVariablesV4Schema,
    untrusted: [...RESEARCH_PLAN_V4_UNTRUSTED],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: RESEARCH_PLAN_SCHEMA_NAME,
    schemaVersion: RESEARCH_PLAN_V4_SCHEMA_VERSION,
    schema: ResearchPlanResultV4Schema,
  },
  template: RESEARCH_PLAN_V3.template
    .replace(
      "THE SUBJECT, AS PUBLICLY KNOWN\n{{subject}}\n",
      "THE SUBJECT, AS PUBLICLY KNOWN\n{{subject}}\n\nOPEN QUESTIONS (code's findings after the last round; empty on the first round)\n{{gaps}}\n\nALREADY ASKED (never ask these again)\n{{asked}}\n",
    )
    .replace(
      "- Between 6 and 12 questions",
      "- On the first round (OPEN QUESTIONS empty): between 6 and 12 questions",
    )
    .replace(
      "- query: what you would type",
      `${RESEARCH_PLAN_INVESTIGATION_RULES}- query: what you would type`,
    ),
};

for (const piece of [
  "{{gaps}}",
  "{{asked}}",
  "On the first round",
  "PRIMARY SOURCES FIRST",
]) {
  if (!RESEARCH_PLAN_V4.template.includes(piece)) {
    throw new Error("RESEARCH_PLAN v4 extends v3's template, which changed");
  }
}

export const RESEARCH_FACTS_MEASURE_RULE = `- measure: what the figure measures, in 2 to 5 plain words ("market size", "licensed operators", "transaction value"); entity: what it is about (the market and place, or the organisation), as the page names it. Use the same words for the same measure across facts. Both null when the fact has no figure.
`;

export const RESEARCH_FACTS_V3: PromptDefinition<
  ResearchFactsVariables,
  ResearchFactsResultV3
> = {
  ...RESEARCH_FACTS_V2,
  version: 3,
  status: "ACTIVE",
  effectiveFrom: "2026-10-29",
  changeDescription:
    "Investigation 2026-10-29: v2 plus a measure and entity label on each fact, so code can group facts about the same measure and compare their figures across independent sources (code, not the model, decides agreement and contradiction).",
  output: {
    kind: "STRUCTURED",
    schemaName: RESEARCH_FACTS_SCHEMA_NAME,
    schemaVersion: RESEARCH_FACTS_V3_SCHEMA_VERSION,
    schema: ResearchFactsResultV3Schema,
  },
  template: RESEARCH_FACTS_V2.template.replace(
    "- kind: FIGURE,",
    `${RESEARCH_FACTS_MEASURE_RULE}- kind: FIGURE,`,
  ),
};

if (!RESEARCH_FACTS_V3.template.includes("- measure:")) {
  throw new Error("RESEARCH_FACTS v3 extends v2's template, which changed");
}

export const ANALYSIS_WRITE_INVESTIGATION_RULE = `- INVESTIGATION REPORT: when PUBLIC RESEARCH starts with "INVESTIGATION", the person asked Q to investigate a sector, market or question and the evidence is the deliverable. Write exactly these sections, with these headings, in this order: Executive summary; Key developments (each dated, newest first); Regulatory risks (cite official, primary facts before the press); Competitive landscape (the table "Name | What they offer | Where | Scale or funding | Source": a company from public research cites [S n]; a company from CAPITAL Q RECORDS in the record is marked "(Capital Q record)" -- its own declared profile, kept apart from web facts); Opportunities; Implications for your thesis (against WHO THIS IS FOR's declared mandate and pipeline: where it aligns and where it does not, the risks, and two or three scenarios; every implication is your judgement, labelled (Q's inference), never stated as fact; with no mandate on record, say so and write them for an investor in this sector); Gaps and next actions (each open question with its concrete next step: a document to request, a registry or regulator page to check, a person to ask). Do not write Contradictions, What public sources cannot establish, or Sources sections: Capital Q adds them by code from its cross-check.
- Each line of PUBLIC RESEARCH states its source tier (primary official, primary company claim, secondary, other), its evidence (one source, several independent sources, or the company's own claim) and its status (current, CONTRADICTORY, STALE). Prefer primary and multi-source facts; say when a point rests on one source or on a company's own claim; never present a STALE fact as current; never choose one side of a CONTRADICTORY pair -- name both, each with its source. No confidence percentages.
`;

export const ANALYSIS_WRITE_V5: PromptDefinition<
  AnalysisWriteVariables,
  AnalysisDocumentResultV3
> = {
  ...ANALYSIS_WRITE_V4,
  version: 5,
  status: "ACTIVE",
  effectiveFrom: "2026-10-29",
  changeDescription:
    "Investigation 2026-10-29: v4 plus the INVESTIGATION REPORT shape (executive summary, dated developments, regulatory risks primary-first, competitive landscape with Capital Q records labelled apart from web facts, opportunities, implications for their thesis as Q's inference, gaps and next actions) and reading each fact's tier, evidence and status; code adds Contradictions, What public sources cannot establish and the tiered Sources.",
  template: ANALYSIS_WRITE_V4.template.replace(
    "- Unknown stays unknown:",
    `${ANALYSIS_WRITE_INVESTIGATION_RULE}- Unknown stays unknown:`,
  ),
};

if (!ANALYSIS_WRITE_V5.template.includes("INVESTIGATION REPORT")) {
  throw new Error("ANALYSIS_WRITE v5 extends v4's rules, which changed");
}
