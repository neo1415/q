import type { PromptDefinition } from "../definition.js";
import {
  COMPANY_ANALYST_V2_SCHEMA_NAME,
  COMPANY_ANALYST_V35_SCHEMA_VERSION,
  CompanyAnalystV35ResultSchema,
  type CompanyAnalystV35Result,
  type CompanyAnalystV5Variables,
} from "../schemas/company-analyst.js";
import { COMPANY_ANALYST_V34 } from "./company-analyst.v34.js";

/**
 * COMPANY_ANALYST v35 -- owner addendum "resolving investor uncertainty"
 * (14 Nov 2026, audit slice 3): v34's template, word for word, with output
 * schema v35, which adds `uncertainties[]` (statement, standing, material,
 * mattersFor, resolveBy) and the offer's `about` (the uncertainty it would
 * resolve). Their meaning is in the field descriptions; code decides from
 * the fields alone whether an offer to resolve one stands (only for a
 * material uncertainty, through the vehicle the relationship allows).
 * Additive: every v34 answer is a valid v35 answer.
 */
export const COMPANY_ANALYST_V35: PromptDefinition<
  CompanyAnalystV5Variables,
  CompanyAnalystV35Result
> = {
  ...COMPANY_ANALYST_V34,
  version: 35,
  status: "ACTIVE",
  changeDescription:
    "Owner addendum (14 Nov 2026): v34's template unchanged; output schema v35 adds uncertainties[] (statement, standing, material, mattersFor, resolveBy; never from KYB) and the offer's about, so an offer to resolve an uncertainty is kept only for a material one through an authorised vehicle.",
  effectiveFrom: "2026-11-14",
  output: {
    kind: "STRUCTURED",
    schemaName: COMPANY_ANALYST_V2_SCHEMA_NAME,
    schemaVersion: COMPANY_ANALYST_V35_SCHEMA_VERSION,
    schema: CompanyAnalystV35ResultSchema,
  },
};
