import type { PromptDefinition } from "../definition.js";
import {
  CLAIM_EXTRACTION_SCHEMA_NAME,
  CLAIM_EXTRACTION_V3_SCHEMA_VERSION,
  ClaimExtractionResultV3Schema,
  type ClaimExtractionResultV3,
  type ClaimExtractionVariables,
} from "../schemas/claim-extraction.js";
import {
  MEMORY_EXTRACTOR_SCHEMA_NAME,
  MEMORY_EXTRACTOR_V3_SCHEMA_VERSION,
  MemoryExtractorResultV3Schema,
  type MemoryExtractorResultV3,
  type MemoryExtractorVariables,
} from "../schemas/memory-extractor.js";
import {
  FOUNDER_EXTRACTION_V2_SCHEMA_NAME,
  FOUNDER_EXTRACTION_V3_SCHEMA_VERSION,
  FounderExtractionV3ResultSchema,
  type FounderExtractionV2Variables,
  type FounderExtractionV3Result,
} from "../schemas/founder-extraction.js";
import { CLAIM_EXTRACTION_V2 } from "./claim-extraction.v2.js";
import { FOUNDER_ONBOARDING_EXTRACTION_V3 } from "./founder-onboarding-extraction.v3.js";
import { MEMORY_EXTRACTOR_V2 } from "./memory-extractor.v2.js";

export const FOUNDER_ONBOARDING_EXTRACTION_V4: PromptDefinition<
  FounderExtractionV2Variables,
  FounderExtractionV3Result
> = {
  ...FOUNDER_ONBOARDING_EXTRACTION_V3,
  version: 4,
  status: "ACTIVE",
  changeDescription:
    "Decision 97: v3's template; no count ceiling on conflicts, ambiguous readings or opinions (a ninth conflict was cut by the gateway).",
  effectiveFrom: "2026-11-14",
  output: {
    kind: "STRUCTURED",
    schemaName: FOUNDER_EXTRACTION_V2_SCHEMA_NAME,
    schemaVersion: FOUNDER_EXTRACTION_V3_SCHEMA_VERSION,
    schema: FounderExtractionV3ResultSchema,
  },
};

/**
 * Decision 97 (2026-11-14): extraction lists with no count ceiling. Each
 * keeps its predecessor's template word for word; only the output schema
 * changes, so nothing the model read beyond a bound is lost (claims were
 * cut to their first 20 by the gateway's DROP; a 13th memory item refused
 * the whole reading). Every item still passes its own checks.
 */
export const MEMORY_EXTRACTOR_V3: PromptDefinition<
  MemoryExtractorVariables,
  MemoryExtractorResultV3
> = {
  ...MEMORY_EXTRACTOR_V2,
  version: 3,
  status: "ACTIVE",
  changeDescription:
    "Decision 97: v2's template; no count ceiling on items (a 13th item refused the whole reading).",
  effectiveFrom: "2026-11-14",
  output: {
    kind: "STRUCTURED",
    schemaName: MEMORY_EXTRACTOR_SCHEMA_NAME,
    schemaVersion: MEMORY_EXTRACTOR_V3_SCHEMA_VERSION,
    schema: MemoryExtractorResultV3Schema,
  },
};

export const CLAIM_EXTRACTION_V3: PromptDefinition<
  ClaimExtractionVariables,
  ClaimExtractionResultV3
> = {
  ...CLAIM_EXTRACTION_V2,
  version: 3,
  status: "ACTIVE",
  changeDescription:
    "Decision 97: v2's template; no count ceiling on claims (the gateway kept the first 20 of a longer list).",
  effectiveFrom: "2026-11-14",
  output: {
    kind: "STRUCTURED",
    schemaName: CLAIM_EXTRACTION_SCHEMA_NAME,
    schemaVersion: CLAIM_EXTRACTION_V3_SCHEMA_VERSION,
    schema: ClaimExtractionResultV3Schema,
  },
};
