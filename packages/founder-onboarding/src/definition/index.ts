/**
 * Browser-safe subpath: the Founder Definition v1 manifest and its
 * vocabularies as plain data. No database, no services, no Node built-ins,
 * so a development fixture or a test can read the journey without pulling
 * the server-only integration layer.
 */
export {
  CATEGORY_VOCABULARIES,
  COUNTRY_OPTIONS,
  COUNTRY_OTHER_OPTION,
  CURRENCY_OPTIONS,
  EARLY_STAGE_OPTIONS,
  FOUNDER_DEFINITION_NAME,
  FOUNDER_DEFINITION_V1,
  FOUNDER_DEFINITION_VERSION,
  FOUNDER_JOURNEY_TYPE,
  FOUNDER_PHASES,
  FOUNDER_ROLE_OPTIONS,
  FOUNDER_ROLE_TITLES,
  FOUNDER_STEP_CONTEXTS,
  FOUNDER_STEPS,
  FOUNDER_WRITE_TARGETS,
  FULL_TIME_OPTIONS,
  FUNCTION_OPTIONS,
  GROWTH_OPTIONS,
  INSTRUMENT_CODES,
  INSTRUMENT_OPTIONS,
  INTENT_OPTIONS,
  LATER_STAGE_OPTIONS,
  MATERIAL_NONE_OPTION,
  MATERIAL_OPTIONS,
  RAISING_ACTIVE_OPTIONS,
  RAISING_OPTIONS,
  REVENUE_STATUS_OPTIONS,
  SIGNAL_OPTIONS,
  STAGE_OPTIONS,
  STAGE_UNKNOWN_OPTION,
  TIMEFRAME_OPTIONS,
  USE_OF_FUNDS_OPTIONS,
  type FounderStepKey,
} from "./founder-v1.js";
export {
  FounderRaiseContextSchema,
  FounderReviewContextSchema,
  FounderSnapshotContextSchema,
  type FounderRaiseContext,
  type FounderReviewContext,
  type FounderSnapshotContext,
} from "./contexts.js";
