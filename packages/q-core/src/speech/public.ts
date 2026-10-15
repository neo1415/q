/**
 * `@capital-q/q-core/speech`: the pure arrival and card-sequence code a
 * browser runs (the arrival briefing), without the Prompt Registry. Same
 * modules as the package root exports; nothing here reads or calls out.
 */
export {
  arrivalGreeting,
  arrivalSeed,
  cardFactsForVoice,
  cardLine,
  gistOf,
  isTimeZone,
  localHour,
  lowdownOf,
  partOfDay,
  summaryOfCards,
  type ActivityCount,
  type ArrivalActivity,
  type ArrivalFacts,
  type DecisionCardFacts,
  type Lowdown,
  type PartOfDay,
} from "./arrival.js";
export {
  applyCardEdit,
  bodyDigest,
  focusedCard,
  parseCardCommand,
  wordsAllowDismiss,
  wordsAllowSend,
  remainingAfterFocus,
  sameShownMessage,
  sentencesOf,
  startSequence,
  stepSequence,
  type CardCommand,
  type CardEdit,
  type CardOutcome,
  type SequenceCard,
  type SequenceEffect,
  type SequenceEvent,
  type SequenceNote,
  type SequenceState,
  type SequenceStep,
} from "./card-sequence.js";
export { movePhaseLine, pendingPlaceOf, type MovePhase } from "./move-line.js";
export {
  WELCOME_STORIES_MAX,
  dailyFollowUpKind,
  dailyGistWords,
  dailyMoreWords,
  editionDay,
  quietDayNewsWords,
  spokenHeadline,
  storyOrdinal,
  welcomeStories,
  type DailyFollowUpKind,
  type DailyNewsStory,
} from "./daily-news.js";
export { splitSentences } from "../communication/sentences.js";

// Owner 2026-10-15: a map asked for is drawn, never a move (shared with the
// browser's follow rule).
export {
  asksForDrawing,
  asksForMove,
  isDrawingObject,
} from "../conversation/drawing-request.js";
