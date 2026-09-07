import type { SecurityEventWriter } from "@capital-q/audit";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { Logger } from "@capital-q/observability";

import type { QSubjectResolverRegistry } from "../domain/subjects.js";
import type { QRuntimeRepositories } from "./ports.js";

/**
 * Everything a Q runtime use case needs, injected.
 *
 * What is absent is the packet: no orchestrator, no model gateway, no
 * retrieval, no tool registry, no approval engine, no Context Firewall.
 * Nothing in this set can make Q reason, and a use case cannot reach for
 * one of those by accident. Each arrives in its own packet as a new port
 * without changing what exists here.
 *
 * The security-event writer and the logger are optional so the runtime can
 * be composed in a test without either; production supplies both.
 */
export type QRuntimeDependencies = {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly subjects: QSubjectResolverRegistry;
  readonly repositories: QRuntimeRepositories;
  /** Records a refused access. Identifiers only; never message content. */
  readonly securityEvents?: SecurityEventWriter | undefined;
  /** Identifiers and coded outcomes only; never a message body. */
  readonly logger?: Logger | undefined;
};
