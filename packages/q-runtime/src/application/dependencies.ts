import type { SecurityEventWriter } from "@capital-q/audit";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { Logger } from "@capital-q/observability";
import type { QViewingMoment } from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

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
  /**
   * The canonical investor organisation of the actor's own organisation,
   * when it is one (CQ-QX-007). Server-side, from the actor's membership,
   * never from the request. Absent: no run gains a subject it did not ask
   * for, which is the behaviour before fit questions were answerable.
   */
  readonly ownInvestorOrganisation?:
    ((actor: ActorContext) => Promise<string | null>) | undefined;
  /**
   * R18: may this actor be viewing this pitch moment -- the pitch playback
   * rule plus the company's visibility, answered by the media context.
   * Absent: no run carries a viewing moment, whatever the client sent.
   */
  readonly viewing?:
    | {
        readonly authorise: (
          actor: ActorContext,
          viewing: QViewingMoment,
        ) => Promise<boolean>;
      }
    | undefined;
  /**
   * The actor's own company, from their membership, on the server: what
   * "my company" means on a turn that names none (CQ-QX-008). Absent: no
   * run gains it.
   */
  readonly ownCompany?:
    ((actor: ActorContext) => Promise<string | null>) | undefined;
};
