import type {
  RecordEngagementBatchRequest,
  RecordEngagementBatchResponse,
  ViewingPrivacyDto,
  ViewingVisibility,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import type {
  EngagementRepository,
  EngagementViewer,
} from "./postgres-engagement-repository.js";

/**
 * Engagement use cases. The viewer is always the actor; a batch can never
 * speak for anyone else, and the response says only how many events were
 * kept, never which were refused or why.
 */

export type EngagementService = {
  readonly record: (
    actor: ActorContext,
    batch: RecordEngagementBatchRequest,
  ) => Promise<RecordEngagementBatchResponse>;
  readonly privacy: (actor: ActorContext) => Promise<ViewingPrivacyDto>;
  /** NOT_ALLOWED when the platform does not offer that level. */
  readonly setPrivacy: (
    actor: ActorContext,
    visibility: ViewingVisibility,
  ) => Promise<ViewingPrivacyDto | "NOT_ALLOWED">;
};

export type EngagementServiceDependencies = {
  /**
   * Each append stands alone: analytics may be lost without corrupting
   * anything, so no batch-wide transaction holds a connection.
   */
  readonly repository: EngagementRepository;
};

/** Engagement is recorded only for a person acting for an organisation. */
export function viewerFrom(actor: ActorContext): EngagementViewer | null {
  if (actor.organisationId === undefined) return null;
  return {
    tenantId: actor.tenantId,
    userId: actor.userId,
    organisationId: actor.organisationId,
  };
}

export function createEngagementService(
  dependencies: EngagementServiceDependencies,
): EngagementService {
  return {
    record: async (actor, batch) => {
      const viewer = viewerFrom(actor);
      if (viewer === null) {
        return { accepted: 0, deduplicated: 0, dropped: batch.events.length };
      }
      // A batch holds one client id at most once: the second copy is a
      // duplicate whatever the database would say.
      const seen = new Set<string>();
      let accepted = 0;
      let deduplicated = 0;
      let dropped = 0;
      const repository = dependencies.repository;
      for (const event of batch.events) {
        if (seen.has(event.clientEventId)) {
          deduplicated += 1;
          continue;
        }
        seen.add(event.clientEventId);
        const outcome = await repository.append(viewer, event);
        if (outcome === "ACCEPTED") accepted += 1;
        else if (outcome === "DEDUPLICATED") deduplicated += 1;
        else dropped += 1;
      }
      return { accepted, deduplicated, dropped };
    },

    privacy: (actor) => dependencies.repository.privacyFor(actor.userId),

    setPrivacy: async (actor, visibility) => {
      const saved = await dependencies.repository.setPrivacy(
        actor.userId,
        visibility,
      );
      if (saved === "NOT_ALLOWED") return saved;
      return dependencies.repository.privacyFor(actor.userId);
    },
  };
}
