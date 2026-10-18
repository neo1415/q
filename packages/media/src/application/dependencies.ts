import type { MaterialActionAuditWriter } from "@capital-q/audit";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";
import type { AuthorizationService } from "@capital-q/security";

import type { VideoProvider } from "../contracts/provider.js";
import type { MediaOwnerResolverRegistry } from "../domain/owners.js";
import type { MediaRepositories, PitchViewerAccessPort } from "./ports.js";

/**
 * Everything a media use case needs, injected.
 *
 * The video provider arrived with `CQ-MEDIA-010` behind the `VideoProvider`
 * port, and it is always present: a deployment without one holds the
 * explicit unconfigured provider, whose every call refuses by name. No use
 * case can optional-chain past an absent provider into a success that did
 * not happen.
 */
export type MediaServiceDependencies = {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly authorization: AuthorizationService;
  readonly owners: MediaOwnerResolverRegistry;
  readonly outbox: OutboxWriter;
  readonly audit: MaterialActionAuditWriter;
  readonly repositories: MediaRepositories;
  readonly videoProvider: VideoProvider;
  /**
   * Who, other than the owner, may view a pitch (CQ-MEDIA-011). The
   * Recommendation context's discoverability rule, handed in by the
   * composition root; a deployment that composes none admits no viewer.
   */
  readonly viewers: PitchViewerAccessPort;
};
