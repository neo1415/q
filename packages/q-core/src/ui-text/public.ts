/** `@capital-q/q-core/ui-text`: the source catalogue and the translation checks (server side). */
export { UI_TEXT_HAND_GAPS, UI_TEXT_SOURCE } from "./source.generated.js";
export {
  acceptUiTranslations,
  checkUiTranslation,
  UI_TEXT_BATCH_SIZE,
  UI_TEXT_CATALOG_VERSION,
  UI_TRANSLATION_JSON_SCHEMA,
  UiTranslationBatchResultSchema,
  uiTextBatches,
  uiTranslationMessages,
  type UiTranslationBatchResult,
  type UiTranslationVerdict,
} from "./translate.js";
export {
  answerSkeletons,
  localisedAnswer,
  skeletonOf,
  type Skeleton,
} from "./skeleton.js";
