/**
 * `@capital-q/q-core/language`: the language registry and the provider
 * capability table, without the prompt registry (safe for the browser).
 */
export {
  ISO_639_1,
  isEnglish,
  isOfferedLanguage,
  languageDirection,
  languageInfo,
  languageNameIn,
  listSeparator,
  offeredLanguages,
  resolveLanguage,
  type LanguageDirection,
  type LanguageInfo,
  type LanguageResolution,
} from "./registry.js";
export {
  LANGUAGE_CAPABILITY_SOURCES,
  languageChannels,
  voiceLineAvailable,
  type LanguageChannels,
  type VideoPlan,
  type VoiceListenPlan,
  type VoiceSpeakPlan,
} from "./capability.js";
export { scriptLanguageOf, textIsEnglish } from "./text-language.js";
