import { randomUUID } from "node:crypto";

import {
  createJobSchema,
  JobIdSchema,
  UtcTimestampSchema,
  type CapitalQEvent,
} from "@capital-q/contracts";
import { getMeter, type Logger } from "@capital-q/observability";
import { z } from "zod";

import { DISCOVERABLE_VISIBILITIES } from "../eligibility/policy.js";
import {
  RECOMMENDATION_REFRESH_QUEUE,
  RefreshRecommendationSlateJob,
} from "../jobs/index.js";
import type {
  RefreshPriority,
  RefreshReason,
  SlateInvalidationReason,
} from "./contracts.js";
import type {
  RefreshRequest,
  RefreshRequestStore,
  SlateKey,
  SlateRepository,
} from "./ports.js";

/**
 * Refresh and invalidation (CQ-REC-006 Checkpoint C; doc 19 §148–§151).
 *
 *   domain event → directive (which slates, invalidate or not, how urgent)
 *   → invalidation (lifecycle only, never content)
 *   → refresh request (one coalescing row per key) → one queue message
 *   → worker claim → builder → new slate
 *
 * Nothing here reads a mandate, a company or a feature: it moves lifecycle
 * columns and identifiers. A material safety change (a company withdrawn
 * from the marketplace, a hard mandate rule, a revoked disclosure) makes
 * the served slate INVALIDATED at once and asks for a HIGH rebuild; an
 * ordinary change asks for a NORMAL one and keeps serving the old slate
 * until the new one is published.
 */

const MODE = "INVESTOR_DISCOVER" as const;

// The producing contexts' event names, as the worker registry validates
// them. Payload fields are re-validated here from `unknown`.
export const REFRESH_TRIGGER_EVENTS = {
  MANDATE_ACTIVATED: "core.investor_mandate.activated",
  MANDATE_UPDATED: "core.investor_mandate.updated",
  MANDATE_CLOSED: "core.investor_mandate.closed",
  COMPANY_UPDATED: "core.company.updated",
  COMPANY_VISIBILITY_CHANGED: "core.company.visibility_changed",
  COMPANY_READINESS_CHANGED: "core.company.marketplace_readiness_changed",
  TAXONOMY_ASSIGNMENTS_CHANGED: "taxonomy.entity_assignments.changed",
  DISCLOSURE_GRANTED: "permissions.disclosure.granted",
  DISCLOSURE_REVOKED: "permissions.disclosure.revoked",
  RELATIONSHIP_CREATED: "network.relationship.created",
} as const;

/** Mandate change kinds that change what is eligible, not only how it ranks. */
const HARD_MANDATE_CHANGE_KINDS: readonly string[] = ["HARD_EXCLUSION"];
const MARKETPLACE_READY_STATE = "marketplace_ready";

const MandateData = z
  .object({
    investorMandateId: z.string().uuid(),
    investorOrganisationId: z.string().uuid(),
    changeKinds: z.array(z.string()).optional(),
  })
  .passthrough();
const CompanyData = z
  .object({
    companyId: z.string().uuid(),
    visibility: z.string().optional(),
    readinessState: z.string().optional(),
  })
  .passthrough();
const SubjectData = z
  .object({ subjectType: z.string(), subjectId: z.string().uuid() })
  .passthrough();
const ResourceData = z
  .object({ resourceType: z.string(), resourceId: z.string().uuid() })
  .passthrough();

export type RefreshDirective =
  | {
      readonly kind: "MANDATE";
      readonly key: SlateKey;
      readonly invalidate: SlateInvalidationReason | null;
      /** False when no ACTIVE mandate remains to build for. */
      readonly refresh: boolean;
      readonly reason: RefreshReason;
      readonly priority: RefreshPriority;
    }
  | {
      readonly kind: "COMPANY";
      readonly companyId: string;
      /** CONTAINING: slates that serve the company; ALL: every CURRENT slate, bounded. */
      readonly scope: "CONTAINING" | "ALL";
      readonly invalidate: SlateInvalidationReason | null;
      readonly reason: RefreshReason;
      readonly priority: RefreshPriority;
    }
  | { readonly kind: "IGNORED"; readonly why: string };

/** What one domain event means for persisted slates. Pure. */
export function refreshDirectiveFor(
  event: CapitalQEvent<unknown>,
): RefreshDirective {
  const mandateKey = (): SlateKey | null => {
    const parsed = MandateData.safeParse(event.data);
    if (!parsed.success || event.tenantId === undefined) return null;
    return {
      tenantId: event.tenantId,
      investorOrganisationId: parsed.data.investorOrganisationId,
      mandateId: parsed.data.investorMandateId,
      mode: MODE,
    };
  };
  switch (event.type) {
    case REFRESH_TRIGGER_EVENTS.MANDATE_ACTIVATED: {
      const key = mandateKey();
      if (key === null) return { kind: "IGNORED", why: "MALFORMED" };
      return {
        kind: "MANDATE",
        key,
        invalidate: null,
        refresh: true,
        reason: "MANDATE_ACTIVATED",
        priority: "HIGH",
      };
    }
    case REFRESH_TRIGGER_EVENTS.MANDATE_UPDATED: {
      const key = mandateKey();
      const parsed = MandateData.safeParse(event.data);
      if (key === null || !parsed.success) {
        return { kind: "IGNORED", why: "MALFORMED" };
      }
      const hard = (parsed.data.changeKinds ?? []).some((k) =>
        HARD_MANDATE_CHANGE_KINDS.includes(k),
      );
      return hard
        ? {
            kind: "MANDATE",
            key,
            invalidate: "MANDATE_HARD_CHANGED",
            refresh: true,
            reason: "MANDATE_HARD_CHANGED",
            priority: "HIGH",
          }
        : {
            kind: "MANDATE",
            key,
            invalidate: null,
            refresh: true,
            reason: "MANDATE_UPDATED",
            priority: "NORMAL",
          };
    }
    case REFRESH_TRIGGER_EVENTS.MANDATE_CLOSED: {
      const key = mandateKey();
      if (key === null) return { kind: "IGNORED", why: "MALFORMED" };
      return {
        kind: "MANDATE",
        key,
        invalidate: "MANDATE_CLOSED",
        refresh: false,
        reason: "MANDATE_CLOSED",
        priority: "HIGH",
      };
    }
    case REFRESH_TRIGGER_EVENTS.COMPANY_UPDATED: {
      const parsed = CompanyData.safeParse(event.data);
      if (!parsed.success) return { kind: "IGNORED", why: "MALFORMED" };
      return {
        kind: "COMPANY",
        companyId: parsed.data.companyId,
        scope: "CONTAINING",
        invalidate: null,
        reason: "COMPANY_UPDATED",
        priority: "NORMAL",
      };
    }
    case REFRESH_TRIGGER_EVENTS.COMPANY_VISIBILITY_CHANGED: {
      const parsed = CompanyData.safeParse(event.data);
      if (!parsed.success) return { kind: "IGNORED", why: "MALFORMED" };
      const discoverable = DISCOVERABLE_VISIBILITIES.includes(
        parsed.data.visibility ?? "",
      );
      return discoverable
        ? {
            // Newly discoverable: any investor's next slate may include it.
            kind: "COMPANY",
            companyId: parsed.data.companyId,
            scope: "ALL",
            invalidate: null,
            reason: "COMPANY_VISIBILITY_CHANGED",
            priority: "NORMAL",
          }
        : {
            kind: "COMPANY",
            companyId: parsed.data.companyId,
            scope: "CONTAINING",
            invalidate: "VISIBILITY_CHANGED",
            reason: "COMPANY_VISIBILITY_CHANGED",
            priority: "HIGH",
          };
    }
    case REFRESH_TRIGGER_EVENTS.COMPANY_READINESS_CHANGED: {
      const parsed = CompanyData.safeParse(event.data);
      if (!parsed.success) return { kind: "IGNORED", why: "MALFORMED" };
      return parsed.data.readinessState === MARKETPLACE_READY_STATE
        ? {
            kind: "COMPANY",
            companyId: parsed.data.companyId,
            scope: "ALL",
            invalidate: null,
            reason: "COMPANY_READINESS_CHANGED",
            priority: "NORMAL",
          }
        : {
            kind: "COMPANY",
            companyId: parsed.data.companyId,
            scope: "CONTAINING",
            invalidate: "MARKETPLACE_DISABLED",
            reason: "COMPANY_READINESS_CHANGED",
            priority: "HIGH",
          };
    }
    case REFRESH_TRIGGER_EVENTS.TAXONOMY_ASSIGNMENTS_CHANGED: {
      const parsed = SubjectData.safeParse(event.data);
      if (!parsed.success || parsed.data.subjectType !== "COMPANY") {
        return { kind: "IGNORED", why: "NOT_A_COMPANY" };
      }
      return {
        kind: "COMPANY",
        companyId: parsed.data.subjectId,
        scope: "CONTAINING",
        invalidate: null,
        reason: "TAXONOMY_CHANGED",
        priority: "NORMAL",
      };
    }
    case REFRESH_TRIGGER_EVENTS.DISCLOSURE_GRANTED:
    case REFRESH_TRIGGER_EVENTS.DISCLOSURE_REVOKED: {
      const parsed = ResourceData.safeParse(event.data);
      if (!parsed.success || parsed.data.resourceType !== "company") {
        return { kind: "IGNORED", why: "NOT_A_COMPANY" };
      }
      // The recipient stays in the server-only policy table, so a grant
      // cannot be routed to one investor; a revocation is a safety change.
      return event.type === REFRESH_TRIGGER_EVENTS.DISCLOSURE_REVOKED
        ? {
            kind: "COMPANY",
            companyId: parsed.data.resourceId,
            scope: "CONTAINING",
            invalidate: "SECURITY_RESTRICTION",
            reason: "DISCLOSURE_CHANGED",
            priority: "HIGH",
          }
        : {
            kind: "COMPANY",
            companyId: parsed.data.resourceId,
            scope: "ALL",
            invalidate: null,
            reason: "DISCLOSURE_CHANGED",
            priority: "NORMAL",
          };
    }
    case REFRESH_TRIGGER_EVENTS.RELATIONSHIP_CREATED: {
      const parsed = CompanyData.safeParse(event.data);
      if (!parsed.success) return { kind: "IGNORED", why: "MALFORMED" };
      return {
        kind: "COMPANY",
        companyId: parsed.data.companyId,
        scope: "CONTAINING",
        invalidate: null,
        reason: "RELATIONSHIP_CHANGED",
        priority: "NORMAL",
      };
    }
    default:
      return { kind: "IGNORED", why: "NOT_A_TRIGGER" };
  }
}

// ---------------------------------------------------------------------------
// Requesting a refresh: one row per key, one message per real change.
// ---------------------------------------------------------------------------

/** The slice of the queue client a requester needs. */
export type RefreshQueue = {
  readonly send: (queue: string, message: unknown) => Promise<number>;
};

export type RequestRefreshInput = SlateKey & {
  readonly reason: RefreshReason;
  readonly priority: RefreshPriority;
  readonly correlationId?: string | undefined;
  /** What caused this request (an event id, a slate id); traceability only. */
  readonly causationId?: string | undefined;
};

export type RequestRefreshResult = {
  /** ENQUEUED: a message was sent; COALESCED: a pending request already covers it. */
  readonly kind: "ENQUEUED" | "COALESCED";
  readonly request: RefreshRequest;
};

export type RefreshRequester = {
  readonly request: (
    input: RequestRefreshInput,
  ) => Promise<RequestRefreshResult>;
};

const RefreshJobSchema = createJobSchema(
  RefreshRecommendationSlateJob.dataSchema,
);

export type RefreshJobInput = SlateKey & {
  readonly reason: RefreshReason;
  readonly priority: RefreshPriority;
  readonly requestSequence: number;
  readonly correlationId?: string | undefined;
  readonly causationId?: string | undefined;
};

/** One bounded message on the refresh queue: identifiers, a reason, a sequence. */
export async function sendRefreshJob(
  queue: RefreshQueue,
  input: RefreshJobInput,
  clock: () => Date = () => new Date(),
): Promise<void> {
  const job = RefreshJobSchema.parse({
    id: JobIdSchema.parse(randomUUID()),
    type: RefreshRecommendationSlateJob.name,
    jobVersion: RefreshRecommendationSlateJob.version,
    tenantId: input.tenantId,
    ...(input.correlationId === undefined
      ? {}
      : { correlationId: input.correlationId }),
    ...(input.causationId === undefined
      ? {}
      : { causationId: input.causationId }),
    createdAt: UtcTimestampSchema.parse(clock().toISOString()),
    data: {
      investorOrganisationId: input.investorOrganisationId,
      mandateId: input.mandateId,
      mode: MODE,
      reason: input.reason,
      priority: input.priority,
      requestSequence: input.requestSequence,
    },
  });
  await queue.send(RECOMMENDATION_REFRESH_QUEUE, job);
}

export function createRefreshRequester(dependencies: {
  readonly requests: RefreshRequestStore;
  readonly queue: RefreshQueue;
  readonly clock?: (() => Date) | undefined;
  readonly logger?: Logger | undefined;
}): RefreshRequester {
  const { requests, queue, logger } = dependencies;
  const clock = dependencies.clock ?? (() => new Date());
  const meter = getMeter("@capital-q/discovery");
  const metrics = {
    requested: meter.createCounter("discovery.slates.refresh_requested"),
  };
  return {
    request: async (input) => {
      const now = clock().toISOString();
      const { request, coalesced } = await requests.requestRefresh({
        tenantId: input.tenantId,
        investorOrganisationId: input.investorOrganisationId,
        mandateId: input.mandateId,
        mode: input.mode,
        reason: input.reason,
        priority: input.priority,
        requestedAt: now,
      });
      // A pending request already has a message on the queue; a HIGH one
      // gets its own so it is not behind a long backoff. A duplicate
      // delivery is absorbed by the claim: a second worker finds nothing
      // pending and stands down.
      const send = !coalesced || input.priority === "HIGH";
      if (send) {
        await sendRefreshJob(
          queue,
          {
            tenantId: input.tenantId,
            investorOrganisationId: input.investorOrganisationId,
            mandateId: input.mandateId,
            mode: input.mode,
            reason: input.reason,
            priority: request.priority,
            requestSequence: request.requestSequence,
            correlationId: input.correlationId,
            causationId: input.causationId,
          },
          clock,
        );
      }
      metrics.requested.add(1, {
        reason: input.reason,
        priority: input.priority,
        outcome: send ? "ENQUEUED" : "COALESCED",
      });
      logger?.debug(
        {
          requestId: request.id,
          reason: input.reason,
          priority: request.priority,
          requestSequence: request.requestSequence,
          outcome: send ? "ENQUEUED" : "COALESCED",
        },
        "recommendation slate refresh requested",
      );
      return { kind: send ? "ENQUEUED" : "COALESCED", request };
    },
  };
}

// ---------------------------------------------------------------------------
// Invalidation: lifecycle only, then a refresh request per affected key.
// ---------------------------------------------------------------------------

export type InvalidationOutcome = {
  readonly invalidated: number;
  readonly enqueued: number;
  readonly coalesced: number;
};

export type SlateInvalidationService = {
  readonly apply: (
    directive: RefreshDirective,
    trace?: {
      readonly correlationId?: string | undefined;
      readonly causationId?: string | undefined;
    },
  ) => Promise<InvalidationOutcome>;
};

/** How many CURRENT slates an ALL-scope change fans out to per event. */
export const INVALIDATION_FAN_OUT_MAX = 500;

export function createSlateInvalidationService(dependencies: {
  readonly slates: SlateRepository;
  readonly requester: RefreshRequester;
  readonly clock?: (() => Date) | undefined;
  readonly logger?: Logger | undefined;
  readonly fanOutMax?: number | undefined;
}): SlateInvalidationService {
  const { slates, requester, logger } = dependencies;
  const clock = dependencies.clock ?? (() => new Date());
  const fanOutMax = dependencies.fanOutMax ?? INVALIDATION_FAN_OUT_MAX;
  const meter = getMeter("@capital-q/discovery");
  const metrics = {
    invalidated: meter.createCounter("discovery.slates.invalidated"),
  };

  return {
    apply: async (directive, trace = {}) => {
      if (directive.kind === "IGNORED") {
        return { invalidated: 0, enqueued: 0, coalesced: 0 };
      }
      const now = clock().toISOString();
      let invalidated = 0;
      let enqueued = 0;
      let coalesced = 0;
      const request = async (key: SlateKey) => {
        const result = await requester.request({
          ...key,
          reason: directive.reason,
          priority: directive.priority,
          correlationId: trace.correlationId,
          causationId: trace.causationId,
        });
        if (result.kind === "ENQUEUED") enqueued += 1;
        else coalesced += 1;
      };

      if (directive.kind === "MANDATE") {
        if (directive.invalidate !== null) {
          const current = await slates.findCurrent(directive.key);
          if (
            current !== null &&
            (await slates.invalidate(current.id, directive.invalidate, now))
          ) {
            invalidated += 1;
          }
        }
        if (directive.refresh) await request(directive.key);
      } else {
        const affected =
          directive.scope === "CONTAINING"
            ? await slates.findCurrentContaining(directive.companyId)
            : await slates.listCurrent(fanOutMax);
        // Distinct keys: one request per investor mandate and context.
        const seen = new Set<string>();
        for (const slate of affected) {
          if (
            directive.invalidate !== null &&
            (await slates.invalidate(slate.id, directive.invalidate, now))
          ) {
            invalidated += 1;
          }
          const key: SlateKey = {
            tenantId: slate.tenantId,
            investorOrganisationId: slate.investorOrganisationId,
            mandateId: slate.mandateId,
            mode: slate.mode,
          };
          const id = `${key.investorOrganisationId}:${key.mandateId}:${key.mode}`;
          if (seen.has(id)) continue;
          seen.add(id);
          await request(key);
        }
      }
      if (invalidated > 0) {
        metrics.invalidated.add(invalidated, {
          reason: directive.invalidate ?? "NONE",
        });
      }
      // Identifiers and counts only.
      logger?.info(
        {
          directive: directive.kind,
          reason: directive.reason,
          priority: directive.priority,
          invalidate: directive.invalidate,
          invalidated,
          enqueued,
          coalesced,
        },
        "recommendation slates refreshed after a domain event",
      );
      return { invalidated, enqueued, coalesced };
    },
  };
}
