import type { MaterialActionAuditWriter } from "@capital-q/audit";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";
import type { AuthorizationService } from "@capital-q/security";

import type { MediaOwnerResolverRegistry } from "../domain/owners.js";
import type { MediaRepositories } from "./ports.js";

/**
 * Everything a media use case needs, injected.
 *
 * There is no video provider here, and that absence is the packet: no
 * upload session can be created, no playback can be authorised and no asset
 * can be told it is READY, because nothing in this dependency set can talk
 * to a provider. `CQ-MEDIA-010` adds one behind the `VideoProvider` port
 * without changing anything else in this list.
 */
export type MediaServiceDependencies = {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly authorization: AuthorizationService;
  readonly owners: MediaOwnerResolverRegistry;
  readonly outbox: OutboxWriter;
  readonly audit: MaterialActionAuditWriter;
  readonly repositories: MediaRepositories;
};
