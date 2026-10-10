/**
 * `@capital-q/q-core/names`: multilingual proper-name intelligence (English
 * and Arabic script, alternate romanisations, organisation variants,
 * clue-based disambiguation, ASR repair, pronunciation hints). Pure: no
 * database, no provider. Every score is name EVIDENCE; none is a verdict
 * that two records are one person.
 */
export { hasArabicScript, romanizeArabic } from "./script.js";
export {
  gradeOf,
  parsePersonName,
  scorePersonNames,
  type NameGrade,
  type NameMatch,
  type PersonName,
} from "./person.js";
export { parseOrgName, scoreOrgNames, type OrgName } from "./org.js";
export {
  decide,
  findPlace,
  parseMention,
  rankCandidates,
  type Corroboration,
  type DecideOptions,
  type Decision,
  type Mention,
  type NameCandidate,
  type NameClues,
  type RankedCandidate,
  type RankOptions,
} from "./resolve.js";
export {
  repairTranscript,
  type LexiconEntry,
  type Repair,
  type RepairResult,
} from "./repair.js";
export {
  isVerifiedPronunciation,
  nameKeyOf,
  parseNameCorrection,
  pronunciationHintLines,
  PRONUNCIATION_HINTS_MAX,
  type NameCorrection,
  type NamePronunciation,
  type PronunciationKind,
  type PronunciationSource,
} from "./pronunciation.js";
