import type { CorrelationId } from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import type {
  PresenceBuild,
  PresenceBuildStatus,
  PresenceIdentity,
  PresenceKey,
  PresenceSubject,
} from "./contracts.js";

/**
 * The seams this context reaches the rest of Capital Q through. Every one
 * is a port because every one is somebody else's rule: what may leave in a
 * query belongs to Research, what may be recorded belongs to Evidence,
 * what may be held belongs to the Knowledge Write Gate, and what a model
 * may be asked belongs to the Model Gateway. This package owns the order
 * they happen in and nothing else.
 */

/** One public page, as the research context brought it back. */
export type PresenceSource = {
  /** The page. Provenance; never fetched again from here. */
  readonly url: string;
  readonly title: string | null;
  readonly publishedAt: string | null;
  /** Bounded, instruction-scanned text. Data to read, never instruction. */
  readonly excerpt: string;
  readonly provider: string;
  readonly retrievedAt: string;
};

export type PresenceReadRequest = {
  readonly actor: ActorContext;
  readonly correlationId: CorrelationId;
  /** Whose presence this is: the research context composes around it. */
  readonly subject: PresenceSubject;
  readonly identity: PresenceIdentity;
  readonly signal?: AbortSignal | undefined;
};

/**
 * The public web, under the research context's own egress rules. The
 * implementation composes the queries; it may narrow what this asks for
 * and never widens it.
 */
export type PresenceReadPort = {
  /**
   * Several reads at once — a search for the name, the subject's own site,
   * a public profile they gave. Every one is independent, so one failing
   * costs its own result and not the build.
   */
  readonly read: (
    request: PresenceReadRequest,
  ) => Promise<readonly PresenceSource[]>;
};

/** Where a public page is recorded so an understanding can cite it. */
export type PresenceEvidencePort = {
  readonly registerSource: (
    actor: ActorContext,
    input: {
      readonly subject: PresenceSubject;
      readonly provider: string;
      readonly title: string | null;
      readonly sourceUrl: string;
      readonly retrievedAt: string;
      readonly publishedAt: string | null;
    },
    correlationId: CorrelationId,
  ) => Promise<{ readonly id: string }>;
  readonly createItem: (
    actor: ActorContext,
    input: {
      readonly sourceId: string;
      readonly summary: string;
    },
    correlationId: CorrelationId,
  ) => Promise<{ readonly id: string }>;
};

/** One understanding a model proposed, before anything has accepted it. */
export type ProposedUnderstanding = {
  readonly key: PresenceKey;
  readonly statement: string;
  /** Indexes into the sources handed to the model. Its only way to cite. */
  readonly sourceIndexes: readonly number[];
};

export type PresenceReaderRequest = {
  readonly actor: ActorContext;
  readonly correlationId: CorrelationId;
  readonly subjectType: PresenceSubject["subjectType"];
  readonly identity: PresenceIdentity;
  readonly sources: readonly {
    readonly index: number;
    readonly url: string;
    readonly title: string | null;
    readonly excerpt: string;
  }[];
  readonly signal?: AbortSignal | undefined;
};

/** The model that reads the pages. It proposes; it never persists. */
export type PresenceReaderPort = {
  readonly read: (
    request: PresenceReaderRequest,
  ) => Promise<readonly ProposedUnderstanding[]>;
};

/** The Knowledge Write Gate, as this context needs it. */
export type PresenceKnowledgePort = {
  readonly propose: (
    actor: ActorContext,
    input: {
      readonly subject: PresenceSubject;
      readonly key: PresenceKey;
      readonly statement: string;
      readonly supportingSourceIds: readonly string[];
      readonly supportingEvidenceItemIds: readonly string[];
    },
    correlationId: CorrelationId,
  ) => Promise<{ readonly accepted: boolean }>;
};

/** The log of attempts, so a build is refreshed rather than repeated. */
export type PresenceBuildLog = {
  readonly latest: (
    actor: ActorContext,
    subject: PresenceSubject,
  ) => Promise<PresenceBuild | null>;
  readonly start: (
    actor: ActorContext,
    subject: PresenceSubject,
    correlationId: CorrelationId,
  ) => Promise<{ readonly id: string }>;
  readonly finish: (
    actor: ActorContext,
    input: {
      readonly buildId: string;
      readonly status: Exclude<PresenceBuildStatus, "RUNNING">;
      readonly sourceCount: number;
      readonly understandingCount: number;
      readonly failureCode: string | null;
    },
  ) => Promise<void>;
};
