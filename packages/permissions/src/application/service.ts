import { UtcTimestampSchema } from "@capital-q/contracts";

import { createPostgresDisclosurePolicyRepository } from "../infrastructure/postgres-disclosure-policy-repository.js";
import {
  createDisclosureAccessService,
  type DisclosureAccessService,
} from "./access-service.js";
import type { PermissionsServiceDependencies } from "./dependencies.js";
import {
  createInspectResourceDisclosure,
  type InspectResourceDisclosure,
} from "./inspection.js";
import {
  createDisclosurePolicyManager,
  type DisclosurePolicyManager,
} from "./policy-manager.js";
import type { DisclosureClock } from "./ports.js";
import {
  createProtectedDisclosureGuard,
  type ProtectedDisclosureGuard,
} from "./protected-guard.js";

/**
 * The Permissions application service: the disclosure predicate (single
 * and batch), the grant/revoke manager, owner inspection and the combined
 * capability + disclosure guard. No HTTP surface exists in this packet;
 * owning product workflows (onboarding visibility, Data Room, relationship
 * commands, public projections) call these after their own command shape.
 */
export type PermissionsService = {
  readonly access: DisclosureAccessService;
  readonly policies: DisclosurePolicyManager;
  readonly inspectResourceDisclosure: InspectResourceDisclosure;
  readonly guard: ProtectedDisclosureGuard;
};

export type PermissionsServiceOptions = Omit<
  PermissionsServiceDependencies,
  "repositories" | "clock"
> & {
  readonly repositories?:
    PermissionsServiceDependencies["repositories"] | undefined;
  readonly clock?: DisclosureClock | undefined;
};

/** Server UTC time. Tests inject a pinned clock instead. */
export const systemDisclosureClock: DisclosureClock = {
  now: () => UtcTimestampSchema.parse(new Date().toISOString()),
};

export function createPermissionsService(
  options: PermissionsServiceOptions,
): PermissionsService {
  const dependencies: PermissionsServiceDependencies = {
    ...options,
    clock: options.clock ?? systemDisclosureClock,
    repositories: options.repositories ?? {
      policies: createPostgresDisclosurePolicyRepository(),
    },
  };
  const shared = {
    sql: dependencies.sql,
    clock: dependencies.clock,
    policies: dependencies.repositories.policies,
    resolvers: dependencies.resolvers,
    relationshipParties: dependencies.relationshipParties,
  };
  const access = createDisclosureAccessService(shared);
  return {
    access,
    policies: createDisclosurePolicyManager({
      ...shared,
      transactions: dependencies.transactions,
      authorization: dependencies.authorization,
      outbox: dependencies.outbox,
      audit: dependencies.audit,
    }),
    inspectResourceDisclosure: createInspectResourceDisclosure({
      ...shared,
      authorization: dependencies.authorization,
    }),
    guard: createProtectedDisclosureGuard({
      authorization: dependencies.authorization,
      disclosure: access,
    }),
  };
}
