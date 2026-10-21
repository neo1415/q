import type { PromptDefinition } from "../definition.js";
import {
  COMPANY_ANALYST_V2_SCHEMA_NAME,
  COMPANY_ANALYST_V26_SCHEMA_VERSION,
  CompanyAnalystV26ResultSchema,
  type CompanyAnalystV26Result,
  type CompanyAnalystV5Variables,
} from "../schemas/company-analyst.js";
import { V22_VISUAL_LINE } from "./company-analyst.v22.js";
import { V23_ALLOWED_ROOT_KEYS } from "./company-analyst.v23.js";
import { COMPANY_ANALYST_V25 } from "./company-analyst.v25.js";

/**
 * COMPANY_ANALYST v26 -- a picture when seeing the thing helps (L-13,
 * owner ask 2026-10-20). The visual line gains PICTURE with a few plain
 * search words; Capital Q composes what may leave from the person's own
 * words and shows the picture credited. Output schema v26 adds PICTURE to
 * `visual` and the optional `pictureQuery`.
 */
export const V26_VISUAL_LINE =
  "- visual: MAP, TABLE, CHART or TIMELINE (from Capital Q's reads), or PICTURE with pictureQuery (2-4 plain words, no names), when clearer.";

export const V26_ALLOWED_ROOT_KEYS = [
  ...V23_ALLOWED_ROOT_KEYS,
  "pictureQuery",
] as const;

const V25_KEYS_LINE = V23_ALLOWED_ROOT_KEYS.join(", ");
for (const [anchor, name] of [
  [V22_VISUAL_LINE, "visual line"],
  [V25_KEYS_LINE, "allowed root keys"],
] as const) {
  if (COMPANY_ANALYST_V25.template.split(anchor).length !== 2) {
    throw new Error(`COMPANY_ANALYST v26 extends v25, which changed: ${name}`);
  }
}

export const COMPANY_ANALYST_V26: PromptDefinition<
  CompanyAnalystV5Variables,
  CompanyAnalystV26Result
> = {
  ...COMPANY_ANALYST_V25,
  version: 26,
  status: "ACTIVE",
  changeDescription:
    "L-13 (owner ask 2026-10-20): the model may ask for a PICTURE with a short pictureQuery; Capital Q composes the outbound words from the person's own (egress allowlist) and shows a credited stock picture. Output schema v26.",
  effectiveFrom: "2026-10-21",
  output: {
    kind: "STRUCTURED",
    schemaName: COMPANY_ANALYST_V2_SCHEMA_NAME,
    schemaVersion: COMPANY_ANALYST_V26_SCHEMA_VERSION,
    schema: CompanyAnalystV26ResultSchema,
  },
  template: COMPANY_ANALYST_V25.template
    .replace(V22_VISUAL_LINE, V26_VISUAL_LINE)
    .replace(V25_KEYS_LINE, V26_ALLOWED_ROOT_KEYS.join(", ")),
};
