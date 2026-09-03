import { z } from "zod";

import type { DatabaseExecutor } from "@capital-q/database";

import {
  DisclosureAccessLevelSchema,
  DisclosurePrincipalSchema,
  DisclosureResourceRefSchema,
  type DisclosureAccessLevel,
  type DisclosurePolicy,
  type DisclosurePrincipal,
  type DisclosureResourceDescriptor,
  type DisclosureResourceRef,
  type RelationshipParties,
} from "../contracts/index.js";
import type { DisclosureDecision } from "../domain/decision.js";
import { evaluateDisclosure } from "../domain/evaluator.js";
import { policyRelationshipId } from "../domain/policy-rules.js";
import type {
  DisclosureClock,
  DisclosurePolicyRepository,
  DisclosureResourceResolverRegistry,
  RelationshipPartyResolver,
} from "./ports.js";

/**
 * "May this information be disclosed to this recipient in this context?"
 *
 * The one disclosure answer for API reads, the future Q Context Firewall,
 * permission-aware retrieval, Data Room and public projections. It gathers
 * trusted facts -- resolver, unrevoked policies, exact relationship parties,
 * the injected clock -- and hands them to the pure evaluator. No model, no
 * cache, no HTTP: correctness never depends on either.
 *
 * An unresolvable resource is DENY with UNKNOWN_RESOURCE; the caller maps
 * that and every other denial to the same enumeration-safe response.
 */

export type DisclosureAccessRequest = {
  readonly principal: DisclosurePrincipal;
  readonly resource: DisclosureResourceRef;
  readonly requestedAccess: DisclosureAccessLevel;
};

export const DisclosureAccessRequestSchema = z
  .object({
    principal: DisclosurePrincipalSchema,
    resource: DisclosureResourceRefSchema,
    requestedAccess: DisclosureAccessLevelSchema,
  })
  .strict();

export type DisclosureAccessService = {
  readonly canDisclose: (
    request: DisclosureAccessRequest,
  ) => Promise<DisclosureDecision>;
  /** Bounded batch (≤ DISCLOSURE_BATCH_MAX): one policy query for all resources, one party lookup per relationship. */
  readonly evaluateMany: (
    requests: readonly DisclosureAccessRequest[],
  ) => Promise<readonly DisclosureDecision[]>;
};

export const DISCLOSURE_BATCH_MAX = 200;

export type DisclosureAccessServiceDependencies = {
  readonly sql: DatabaseExecutor;
  readonly policies: DisclosurePolicyRepository;
  readonly resolvers: DisclosureResourceResolverRegistry;
  readonly relationshipParties: RelationshipPartyResolver;
  readonly clock: DisclosureClock;
};

function resourceKey(resource: DisclosureResourceRef): string {
  return `${resource.type}:${resource.id}`;
}

export function createDisclosureAccessService(
  dependencies: DisclosureAccessServiceDependencies,
): DisclosureAccessService {
  const { sql, policies, resolvers, relationshipParties, clock } = dependencies;

  const evaluateMany = async (
    requests: readonly DisclosureAccessRequest[],
  ): Promise<readonly DisclosureDecision[]> => {
    if (requests.length > DISCLOSURE_BATCH_MAX) {
      throw new RangeError(
        `disclosure batch exceeds ${String(DISCLOSURE_BATCH_MAX)} requests`,
      );
    }
    const now = clock.now();

    // 1. Validate every request; invalid ones are denied, never guessed.
    const parsed = requests.map((request) =>
      DisclosureAccessRequestSchema.safeParse(request),
    );

    // 2. Resolve each distinct resource once.
    const distinct = new Map<string, DisclosureResourceRef>();
    for (const result of parsed) {
      if (result.success) {
        distinct.set(resourceKey(result.data.resource), result.data.resource);
      }
    }
    const descriptors = new Map<string, DisclosureResourceDescriptor>();
    await Promise.all(
      [...distinct.entries()].map(async ([key, resource]) => {
        const descriptor = await resolvers.resolve(resource);
        if (descriptor !== null) {
          descriptors.set(key, descriptor);
        }
      }),
    );

    // 3. One policy query for every resolved resource.
    const resolvedRefs = [...descriptors.values()].map((d) => d.resource);
    const policyRows =
      resolvedRefs.length === 0
        ? []
        : resolvedRefs.length === 1 && resolvedRefs[0] !== undefined
          ? await policies.findUnrevokedForResource(sql, resolvedRefs[0])
          : await policies.findUnrevokedForResources(sql, resolvedRefs);
    const policiesByResource = new Map<string, DisclosurePolicy[]>();
    for (const policy of policyRows) {
      const key = resourceKey(policy.resource);
      const bucket = policiesByResource.get(key);
      if (bucket === undefined) {
        policiesByResource.set(key, [policy]);
      } else {
        bucket.push(policy);
      }
    }

    // 4. Exact parties of every relationship any fact refers to.
    const relationshipIds = new Set<string>();
    for (const descriptor of descriptors.values()) {
      if (descriptor.relationshipId !== undefined) {
        relationshipIds.add(descriptor.relationshipId);
      }
    }
    for (const policy of policyRows) {
      const relationshipId = policyRelationshipId(policy);
      if (relationshipId !== undefined) {
        relationshipIds.add(relationshipId);
      }
    }
    const parties: Record<string, RelationshipParties> = {};
    await Promise.all(
      [...relationshipIds].map(async (relationshipId) => {
        const resolved = await relationshipParties.resolve(relationshipId);
        if (resolved !== null) {
          parties[relationshipId] = resolved;
        }
      }),
    );

    // 5. Pure evaluation per request.
    return parsed.map((result, index) => {
      const original = requests[index];
      if (!result.success) {
        return {
          outcome: "DENY",
          resource: original?.resource ?? { type: "company", id: "" },
          requestedAccess: original?.requestedAccess ?? "view",
          reasonCode: "INVALID_REQUEST",
        };
      }
      const request = result.data;
      const descriptor = descriptors.get(resourceKey(request.resource));
      if (descriptor === undefined) {
        return {
          outcome: "DENY",
          resource: request.resource,
          requestedAccess: request.requestedAccess,
          reasonCode: "UNKNOWN_RESOURCE",
        };
      }
      return evaluateDisclosure({
        principal: request.principal,
        resource: descriptor,
        requestedAccess: request.requestedAccess,
        policies: policiesByResource.get(resourceKey(request.resource)) ?? [],
        relationshipParties: parties,
        now,
      });
    });
  };

  return {
    canDisclose: async (request) => {
      const [decision] = await evaluateMany([request]);
      if (decision === undefined) {
        // Unreachable: one request always yields one decision.
        return {
          outcome: "DENY",
          resource: request.resource,
          requestedAccess: request.requestedAccess,
          reasonCode: "INVALID_REQUEST",
        };
      }
      return decision;
    },
    evaluateMany,
  };
}
