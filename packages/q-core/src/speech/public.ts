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
