import type { PromptDefinition } from "../definition.js";
import {
  ANALYSIS_CRITIQUE_SCHEMA_NAME,
  ANALYSIS_CRITIQUE_V4_SCHEMA_VERSION,
  ANALYSIS_WRITE_SCHEMA_NAME,
  ANALYSIS_WRITE_V4_SCHEMA_VERSION,
  AnalysisCritiqueResultV4Schema,
  AnalysisDocumentResultV4Schema,
  type AnalysisCritiqueResultV4,
  type AnalysisCritiqueVariables,
  type AnalysisDocumentResultV4,
  type AnalysisWriteVariables,
} from "../schemas/analyst.js";
import { ANALYSIS_CRITIQUE_V3 } from "./analyst.v1.js";
import { ANALYSIS_WRITE_V7 } from "./analyst-investigation.v1.js";

/**
 * Decision 97 (2026-11-14): one more gap than v3's bound of 30, or one
 * malformed gap, emptied the whole list (`.max(30).catch([])`), and the
 * filed report said nothing was unknown. v8: v7's template; every gap the
 * model writes is its own item, with no count ceiling.
 */
export const ANALYSIS_WRITE_V8: PromptDefinition<
  AnalysisWriteVariables,
  AnalysisDocumentResultV4
> = {
  ...ANALYSIS_WRITE_V7,
  version: 8,
  status: "ACTIVE",
  effectiveFrom: "2026-11-14",
  changeDescription:
    "Decision 97: v7's template; gaps are independent items with no count ceiling -- one bad or extra gap costs that item (counted), never the list.",
  output: {
    kind: "STRUCTURED",
    schemaName: ANALYSIS_WRITE_SCHEMA_NAME,
    schemaVersion: ANALYSIS_WRITE_V4_SCHEMA_VERSION,
    schema: AnalysisDocumentResultV4Schema,
  },
};

/** v3's "at most three" strengths, now every strength the reviewer sees. */
export const ANALYSIS_CRITIQUE_STRENGTHS_RULE =
  "- strengths: the things it does well, specific to it -- each one its own item.";

export const ANALYSIS_CRITIQUE_V4: PromptDefinition<
  AnalysisCritiqueVariables,
  AnalysisCritiqueResultV4
> = {
  ...ANALYSIS_CRITIQUE_V3,
  version: 4,
  status: "ACTIVE",
  effectiveFrom: "2026-11-14",
  changeDescription:
    "Decision 97: strengths are independent items with no count ceiling; v3's `.max(8).catch([])` emptied them all for one extra.",
  template: ANALYSIS_CRITIQUE_V3.template.replace(
    "- strengths: at most three things it does well, specific to it.",
    ANALYSIS_CRITIQUE_STRENGTHS_RULE,
  ),
  output: {
    kind: "STRUCTURED",
    schemaName: ANALYSIS_CRITIQUE_SCHEMA_NAME,
    schemaVersion: ANALYSIS_CRITIQUE_V4_SCHEMA_VERSION,
    schema: AnalysisCritiqueResultV4Schema,
  },
};

if (!ANALYSIS_CRITIQUE_V4.template.includes(ANALYSIS_CRITIQUE_STRENGTHS_RULE)) {
  throw new Error("ANALYSIS_CRITIQUE v4 extends v3's template, which changed");
}
