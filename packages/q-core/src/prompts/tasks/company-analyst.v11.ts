import type { PromptDefinition } from "../definition.js";
import type {
  CompanyAnalystV5Variables,
  CompanyAnalystV8Result,
} from "../schemas/company-analyst.js";
import {
  COMPANY_ANALYST_V10,
  COMPANY_ANALYST_V10_SECTION,
} from "./company-analyst.v10.js";

/**
 * COMPANY_ANALYST v11 — the answer may be written as simple Markdown
 * structure (founder direction D, 2026-09-28).
 *
 * The Home thread now renders the answer's text as structure while it
 * streams: lists, tables, headings, bold, and quoted callouts marked by
 * meaning. The client renders only that subset, as text (never HTML), and
 * voice strips the syntax before speaking. The model was never told the
 * subset exists, so lists and comparisons arrived as run-on prose. This
 * paragraph tells it when structure helps and when plain sentences are
 * better. It changes presentation only: every evidence rule stands, and a
 * callout label never upgrades what it contains.
 *
 * Same schema as v8-v10. A new version, because a published prompt is
 * immutable.
 */
export const COMPANY_ANALYST_V11_FORMAT_SECTION = `ANSWER FORMAT
Short answers are plain sentences. To list, compare or summarise, use simple Markdown: "- " bullets or "1. " steps; a table (header row, then |---|) to compare on shared attributes, a cell left empty when not known; "**Label:** value" bullets for key facts; a "> [!RISK]", "> [!GAP]", "> [!STRENGTH]" or "> [!NOTE]" callout for one point that matters. No HTML, images or code. Structure never changes what is claimed: an inference stays worded as one.

`;

if (!COMPANY_ANALYST_V10.template.includes(COMPANY_ANALYST_V10_SECTION)) {
  throw new Error(
    "COMPANY_ANALYST v11 appends to v10's involved-versus-suited section, and v10 no longer carries it",
  );
}

export const COMPANY_ANALYST_V11: PromptDefinition<
  CompanyAnalystV5Variables,
  CompanyAnalystV8Result
> = {
  ...COMPANY_ANALYST_V10,
  version: 11,
  // Deprecated by v12 (comparison cards, founder design 2026-09-28).
  status: "DEPRECATED",
  changeDescription:
    "Founder direction D: the answer may use a small Markdown subset (bullets, numbered steps, comparison tables with empty cells for unknowns, bold key facts, [!RISK]/[!GAP]/[!STRENGTH]/[!NOTE] callouts); plain sentences for short answers; no HTML, images or code; structure never upgrades a claim.",
  effectiveFrom: "2026-09-28",
  template: COMPANY_ANALYST_V10.template.replace(
    COMPANY_ANALYST_V10_SECTION,
    `${COMPANY_ANALYST_V10_SECTION}${COMPANY_ANALYST_V11_FORMAT_SECTION}`,
  ),
};
