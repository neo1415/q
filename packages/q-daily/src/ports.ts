import type {
  QDailyEdition,
  QDailyEditionSummary,
  QDailyFrequency,
  QDailyImage,
  QDailyOptionalSection,
  QDailyPreferences,
  QDailyStory,
} from "@capital-q/contracts";
import type {
  DailyQTakeResult,
  DailyQTakeVariables,
  DailyStoryWriterResult,
  DailyStoryWriterVariables,
} from "@capital-q/q-core";
import type { PublicWebResearchProvider } from "@capital-q/q-research";

import type { InterestProfile } from "./profile.js";
import type { FeedItem } from "./rss.js";
import type { DailyFeed } from "./sources.js";

/** Who a model call or search is attributed to in usage records. */
export type DailyAttribution = {
  readonly tenantId: string;
  readonly userId: string;
  readonly correlationId: string;
};

/** The public web, through Capital Q's research providers (search + extract only). */
export type DailyNewsIndex = Pick<
  PublicWebResearchProvider,
  "search" | "extract"
>;

export type DailyFeedReader = (
  feed: DailyFeed,
  limit: number,
  signal?: AbortSignal,
) => Promise<readonly FeedItem[]>;

type ModelVariables<V> = Omit<
  V,
  | "operatingMode"
  | "communicationProfile"
  | "communicationGuidance"
  | "environmentNotes"
>;

export type DailyStoryWriterInput = ModelVariables<DailyStoryWriterVariables>;
export type DailyTakeInput = ModelVariables<DailyQTakeVariables>;

/** DAILY_STORY_WRITER through the Q Model Gateway; null when it failed. */
export type DailyStoryWriterPort = {
  readonly write: (
    input: DailyStoryWriterInput,
    attribution: DailyAttribution,
    signal?: AbortSignal,
  ) => Promise<DailyStoryWriterResult | null>;
};

/** DAILY_Q_TAKE through the Q Model Gateway; null when it failed. */
export type DailyTakePort = {
  readonly take: (
    input: DailyTakeInput,
    attribution: DailyAttribution,
    signal?: AbortSignal,
  ) => Promise<DailyQTakeResult | null>;
};

/** Licensed stock photographs (Pexels), credit attached. */
export type DailyPhotoPort = {
  readonly search: (
    query: string,
    signal?: AbortSignal,
  ) => Promise<readonly QDailyImage[]>;
};

/** A person whose edition is due, as the scheduler claimed them. */
export type DueReader = {
  readonly userId: string;
  readonly tenantId: string;
  readonly frequency: Exclude<QDailyFrequency, "OFF">;
  readonly email: boolean;
  readonly sections: readonly QDailyOptionalSection[];
  readonly timeZone: string | null;
  /** True when the person pressed "Prepare my edition". */
  readonly requested: boolean;
};

export type StoredClusterIssue = {
  readonly id: string;
  readonly stories: readonly QDailyStory[];
  readonly searchesUsed: number;
  readonly modelCallsUsed: number;
};

/** The worker's side of the store. */
export type DailyWorkerStore = {
  /** Weekly-default rows for people who have none yet; returns how many were created. */
  readonly ensureDefaults: (now: Date, limit: number) => Promise<number>;
  /** Claims due readers (a short lease), oldest first. */
  readonly claimDue: (
    now: Date,
    limit: number,
  ) => Promise<readonly DueReader[]>;
  readonly editionsToday: (now: Date) => Promise<number>;
  readonly profileOf: (
    userId: string,
    tenantId: string,
  ) => Promise<InterestProfile | null>;
  readonly clusterIssue: (
    clusterKey: string,
    issueDate: string,
  ) => Promise<StoredClusterIssue | null>;
  readonly saveClusterIssue: (issue: {
    readonly clusterKey: string;
    readonly issueDate: string;
    readonly topics: readonly string[];
    readonly stories: readonly QDailyStory[];
    readonly searchesUsed: number;
    readonly modelCallsUsed: number;
  }) => Promise<StoredClusterIssue>;
  readonly nextNumber: (userId: string) => Promise<number>;
  /** Stores the edition; null when one already exists for that date. */
  readonly saveEdition: (edition: {
    readonly id: string;
    readonly userId: string;
    readonly tenantId: string;
    readonly clusterIssueId: string | null;
    readonly content: QDailyEdition;
    readonly searchesUsed: number;
    readonly modelCallsUsed: number;
  }) => Promise<string | null>;
  readonly markEmailed: (
    editionId: string,
    outcome:
      { readonly ok: true } | { readonly ok: false; readonly error: string },
  ) => Promise<void>;
  /** Sets the next due time and clears any request. */
  readonly reschedule: (
    userId: string,
    nextDueAt: Date | null,
  ) => Promise<void>;
};

/** The Q API's side of the store: one person's own rows, by the resolved actor. */
export type DailyReaderStore = {
  readonly preferences: (
    userId: string,
    tenantId: string,
  ) => Promise<
    (QDailyPreferences & { readonly requestedAt: string | null }) | null
  >;
  readonly timeZoneOf: (userId: string) => Promise<string | null>;
  readonly savePreferences: (
    userId: string,
    tenantId: string,
    preferences: {
      readonly frequency: QDailyFrequency;
      readonly email: boolean;
      readonly sections: readonly QDailyOptionalSection[];
      readonly nextDueAt: Date | null;
    },
  ) => Promise<void>;
  readonly request: (
    userId: string,
    tenantId: string,
    now: Date,
  ) => Promise<void>;
  readonly latest: (
    userId: string,
    tenantId: string,
  ) => Promise<QDailyEdition | null>;
  readonly edition: (
    userId: string,
    tenantId: string,
    editionId: string,
  ) => Promise<QDailyEdition | null>;
  readonly archive: (
    userId: string,
    tenantId: string,
    options: { readonly before: string | null; readonly limit: number },
  ) => Promise<readonly QDailyEditionSummary[]>;
  readonly lastEditionAt: (
    userId: string,
    tenantId: string,
  ) => Promise<Date | null>;
};

/** The email of an edition, already rendered. */
export type DailyEmail = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
};

export type DailyEmailSender = {
  readonly available: boolean;
  readonly send: (email: DailyEmail) => Promise<void>;
};
