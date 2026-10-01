/**
 * The Q Daily (DAILY, docs/specs/2026-10/daily.md): a personal newspaper
 * of the public news that concerns one founder or investor.
 */
export {
  DAILY_BUDGET,
  clusterBudget,
  personalBudget,
  createBudgetMeter,
  type BudgetMeter,
} from "./budget.js";
export {
  formatUsd,
  inventedNumbers,
  numbersIn,
  quoteIsVerbatim,
  usdAmount,
} from "./checks.js";
export {
  dateline,
  editionEmail,
  editionText,
  escapeHtml,
  longDate,
  type EditionEmail,
} from "./email.js";
export {
  checkedStory,
  composeEdition,
  dealsChart,
  gatherCluster,
  gatherPeople,
  SECTION_TITLES,
  storyIdOf,
  writeTake,
} from "./pipeline.js";
export {
  clusterKeyOf,
  clusterQueries,
  GENERAL_TOPICS,
  publicInterests,
  topicsOf,
  type InterestProfile,
  type PublicInterests,
} from "./profile.js";
export type * from "./ports.js";
export {
  canonicalUrl,
  namesTopic,
  rankCandidates,
  sameStory,
  type Candidate,
} from "./relevance.js";
export {
  decodeEntities,
  parseFeed,
  plainText,
  readFeed,
  type FeedItem,
} from "./rss.js";
export { DELIVERY_HOUR, localDate, nextDueAt } from "./schedule.js";
export {
  createDailyEditionService,
  createDailyReaderService,
  defaultPreferences,
  type DailyActor,
  type DailyTickResult,
} from "./service.js";
export {
  DAILY_FEEDS,
  feedsFor,
  publisherOf,
  type DailyFeed,
} from "./sources.js";
export { createGatewayDailyWriters } from "./infrastructure/model.js";
export { createPexelsDailyPhotos } from "./infrastructure/pexels.js";
export {
  createPostgresDailyReaderStore,
  createPostgresDailyWorkerStore,
  readInterestProfile,
} from "./infrastructure/postgres.js";
