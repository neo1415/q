import { z } from "zod";

import {
  COMPANY_EDITABLE_FIELDS,
  QActionTypeSchema,
  UpdateCompanyRequestSchema,
  UuidSchema,
  type CompanyEditableField,
  type QSubjectRef,
} from "@capital-q/contracts";
import {
  CompanyIdSchema,
  type CompanyQueryPort,
  type CompanyService,
} from "@capital-q/companies";
import type {
  QProfileUpdateNotebook,
  QProfileUpdateReading,
} from "@capital-q/model-gateway/q";
import type { Logger } from "@capital-q/observability";
import {
  defineQAction,
  type AnyQActionDefinition,
  type QActionProposer,
} from "@capital-q/q-actions";
import type { QActionPrepareContext } from "@capital-q/q-runtime";
import {
  ActorContextSchema,
  capability,
  type AuthorizationService,
} from "@capital-q/security";

import {
  PERSON_PROFILE_UPDATE,
  PersonProfileUpdatePayloadSchema,
} from "./person-profile-action.js";

/**
 * The first real Q action: a change to the person's own company profile
 * (ADR 0011; CQ-Q-008).
 *
 *   the model reads "put our website as x.com" → the answer seam notes it
 *   → the proposer turns it into a proposal → the Approval Engine binds
 *   the exact payload and asks the person → a yes, on screen or aloud,
 *   is the approval → the gate executes it through the companies
 *   context, under the approver's own authority.
 *
 * Nothing in this file writes anything on its own. `authorize` is asked
 * at proposal and again at execution; `execute` goes through the owning
 * context's command, which checks `company.edit` on the exact company and
 * refuses a stale version. A model's reading is the least trusted thing
 * here: it reaches the schema below and nothing else.
 */

export const COMPANY_PROFILE_UPDATE = QActionTypeSchema.parse(
  "company.profile.update",
);

/** The editable fields, without the version the executor reads for itself. */
const { expectedVersion: _expectedVersion, ...editableShape } =
  UpdateCompanyRequestSchema.shape;
const ChangesSchema = z
  .object(editableShape)
  .strict()
  .refine(
    (value) =>
      COMPANY_EDITABLE_FIELDS.some((field) => value[field] !== undefined),
    { message: "expected at least one field to change" },
  );

export const CompanyProfileUpdatePayloadSchema = z
  .object({
    companyId: UuidSchema,
    changes: ChangesSchema,
  })
  .strict();
export type CompanyProfileUpdatePayload = z.infer<
  typeof CompanyProfileUpdatePayloadSchema
>;

export const CompanyProfileUpdateResultSchema = z
  .object({
    companyId: UuidSchema,
    version: z.number().int(),
    fields: z.array(z.enum(COMPANY_EDITABLE_FIELDS)),
  })
  .strict();
export type CompanyProfileUpdateResult = z.infer<
  typeof CompanyProfileUpdateResultSchema
>;

const FIELD_LABELS: Readonly<Record<CompanyEditableField, string>> = {
  canonicalName: "Name",
  legalName: "Legal name",
  websiteUrl: "Website",
  foundedDate: "Founded",
  headquartersCountry: "Country",
  headquartersCity: "City",
  currentStageCode: "Stage",
  primaryDescription: "Description",
  shortDescription: "In short",
};

function changedFields(
  changes: CompanyProfileUpdatePayload["changes"],
): readonly CompanyEditableField[] {
  return COMPANY_EDITABLE_FIELDS.filter(
    (field) => changes[field] !== undefined,
  );
}

function describeChanges(changes: CompanyProfileUpdatePayload["changes"]): {
  readonly summary: string;
  readonly preview: string;
} {
  const lines = changedFields(changes).map((field) => {
    const value = changes[field];
    return value === null || value === undefined
      ? `${FIELD_LABELS[field]}: cleared`
      : `${FIELD_LABELS[field]}: ${value}`;
  });
  const brief = lines
    .map((line) => (line.length > 120 ? `${line.slice(0, 117)}…` : line))
    .join("; ");
  return {
    summary: `Update your company profile. ${brief}`.slice(0, 1000),
    preview: lines.join("\n").slice(0, 4000),
  };
}

export type CompanyProfileUpdateActionDependencies = {
  readonly profiles: CompanyQueryPort;
  readonly service: CompanyService;
  readonly authorization: AuthorizationService;
  readonly logger?: Logger | undefined;
};

export function createCompanyProfileUpdateAction(
  dependencies: CompanyProfileUpdateActionDependencies,
): AnyQActionDefinition {
  const { profiles, service, authorization, logger } = dependencies;
  return defineQAction<CompanyProfileUpdatePayload, CompanyProfileUpdateResult>(
    {
      actionType: COMPANY_PROFILE_UPDATE,
      version: 1,
      riskClass: "CONFIRM_REQUIRED",
      owner: "q-api",
      description:
        "Changes declared fields of the approver's own company profile, exactly as approved.",
      payload: CompanyProfileUpdatePayloadSchema,
      result: CompanyProfileUpdateResultSchema,
      targets: (payload): readonly QSubjectRef[] => [
        { kind: "COMPANY", companyId: payload.companyId },
      ],
      describe: (payload) => describeChanges(payload.changes),
      authorize: async (payload, actor) => {
        if (actor.actorType !== "HUMAN") {
          return { outcome: "DENY", code: "NOT_A_PERSON" };
        }
        const profile = await profiles.findCanonicalCompanyProfile(
          CompanyIdSchema.parse(payload.companyId),
        );
        // Absent, another tenant's and another organisation's are one
        // answer, so nothing about any company's existence leaks.
        if (
          profile === null ||
          profile.tenantId !== actor.tenantId ||
          actor.organisationId === undefined ||
          profile.organisationId !== actor.organisationId
        ) {
          return { outcome: "DENY", code: "NOT_AVAILABLE" };
        }
        const decision = await authorization.authorize({
          actor,
          capability: capability("company.edit"),
          resource: {
            kind: "RESOURCE",
            tenantId: profile.tenantId,
            organisationId: profile.organisationId,
            resourceType: "company",
            resourceId: profile.id,
          },
        });
        return decision.outcome === "ALLOW"
          ? { outcome: "ALLOW" }
          : { outcome: "DENY", code: "NOT_PERMITTED" };
      },
      executor: {
        execute: async (action, context) => {
          // The approver's own authority, reconstructed from what the
          // approval recorded; the companies context checks it again.
          const actor = ActorContextSchema.parse({
            userId: action.approvedByUserId,
            tenantId: action.tenantId,
            ...(action.organisationId === null
              ? {}
              : { organisationId: action.organisationId }),
            actorType: "HUMAN",
          });
          const companyId = CompanyIdSchema.parse(action.payload.companyId);
          try {
            const current = await service.getCompany({ actor, companyId });
            const updated = await service.updateCompany({
              actor,
              companyId,
              input: UpdateCompanyRequestSchema.parse({
                expectedVersion: current.version,
                ...action.payload.changes,
              }),
              correlationId: context.correlationId,
            });
            return {
              outcome: "EXECUTED",
              result: {
                companyId: updated.id,
                version: updated.version,
                fields: [...changedFields(action.payload.changes)],
              },
            };
          } catch (error: unknown) {
            logger?.warn(
              {
                err: error,
                actionId: action.actionId,
                attempt: context.attempt,
              },
              "company profile update was not applied",
            );
            return {
              outcome: "FAILED",
              failureCode: "COMPANY_UPDATE_REFUSED",
              retryable: false,
            };
          }
        },
      },
    },
  );
}

/** How long a reading waits for its run's prepare step before it is forgotten. */
const READING_TTL_MS = 10 * 60 * 1000;

type Noted = {
  readonly tenantId: string;
  readonly companyId: string;
  readonly updates: readonly QProfileUpdateReading[];
  readonly at: number;
};

/** A request to be called something else, per run (ADR 0011). */
type NotedName = {
  readonly tenantId: string;
  readonly userId: string;
  readonly displayName: string;
  readonly quote: string;
  readonly at: number;
};

/**
 * The hand-off between the answer seam and the action proposer, per run.
 *
 * In-memory and process-local on purpose: the reading is only ever
 * consumed by the same run's prepare step, moments later, in the same
 * process that produced it. A restart between the two loses a proposal,
 * never a fact; the person asks again. What crosses this board is a
 * model's reading of the person's own words, already quote-checked, and
 * it is validated against the payload schema again on the way out.
 */
/**
 * What Q itself would like to put into a profile: a description read from
 * the company's own public website, offered when the profile has none.
 * Keyed by the person and proposed on their next run about that company,
 * so it is approved the same way as anything else and never applied on
 * Q's own say-so.
 */
export type ProfileSuggestion = {
  readonly actorUserId: string;
  readonly tenantId: string;
  readonly companyId: string;
  readonly updates: readonly QProfileUpdateReading[];
};

export type ProfileSuggestionBoard = {
  readonly offer: (suggestion: ProfileSuggestion) => void;
};

/** How long a suggestion waits for the person's next run before it is forgotten. */
const SUGGESTION_TTL_MS = 60 * 60 * 1000;

export function createProfileUpdateBoard(
  options: {
    readonly logger?: Logger | undefined;
    readonly now?: (() => number) | undefined;
  } = {},
): QProfileUpdateNotebook & QActionProposer & ProfileSuggestionBoard {
  const now = options.now ?? (() => Date.now());
  const noted = new Map<string, Noted>();
  const names = new Map<string, NotedName>();
  const offered = new Map<
    string,
    ProfileSuggestion & { readonly at: number }
  >();
  const sweep = () => {
    const cutoff = now() - READING_TTL_MS;
    for (const [runId, entry] of noted) {
      if (entry.at < cutoff) noted.delete(runId);
    }
    for (const [runId, entry] of names) {
      if (entry.at < cutoff) names.delete(runId);
    }
    const stale = now() - SUGGESTION_TTL_MS;
    for (const [userId, entry] of offered) {
      if (entry.at < stale) offered.delete(userId);
    }
  };
  /** The reading for this run: what the person asked, else what Q offers. */
  const take = (context: QActionPrepareContext): Noted | undefined => {
    const asked = noted.get(context.runId);
    if (asked !== undefined) {
      noted.delete(context.runId);
      return asked;
    }
    const suggestion = offered.get(context.actorUserId);
    if (suggestion === undefined) return undefined;
    const about = context.subjects.some(
      (subject) =>
        subject.kind === "COMPANY" &&
        subject.companyId === suggestion.companyId,
    );
    if (!about) return undefined;
    offered.delete(context.actorUserId);
    return { ...suggestion, at: suggestion.at };
  };
  return {
    note: (entry) => {
      sweep();
      noted.set(entry.runId, { ...entry, at: now() });
    },
    noteDisplayName: (entry) => {
      sweep();
      names.set(entry.runId, { ...entry, at: now() });
    },
    offer: (suggestion) => {
      sweep();
      // One offer per person at a time; a newer read replaces an older one.
      offered.set(suggestion.actorUserId, { ...suggestion, at: now() });
    },
    propose: (context) => {
      // Their own name first: it needs no company and no organisation,
      // and it is only ever proposed for the acting person in the tenant
      // the reading came from.
      const name = names.get(context.runId);
      if (name !== undefined) {
        names.delete(context.runId);
        if (
          name.userId === context.actorUserId &&
          name.tenantId === context.plan.tenantId
        ) {
          const parsed = PersonProfileUpdatePayloadSchema.safeParse({
            userId: context.actorUserId,
            displayName: name.displayName,
          });
          if (parsed.success) {
            return Promise.resolve({
              actionType: PERSON_PROFILE_UPDATE,
              payload: parsed.data,
            });
          }
          options.logger?.info(
            { qRunId: context.runId },
            "a requested name did not fit a display name's shape",
          );
        }
      }
      const entry = take(context);
      if (entry === undefined) return Promise.resolve(null);
      // Only for the company this run is about, and only in this tenant.
      const about = context.subjects.some(
        (subject) =>
          subject.kind === "COMPANY" && subject.companyId === entry.companyId,
      );
      if (!about || entry.tenantId !== context.plan.tenantId) {
        return Promise.resolve(null);
      }
      const changes: Record<string, string | null> = {};
      for (const update of entry.updates) {
        changes[update.field] = update.value;
      }
      const parsed = CompanyProfileUpdatePayloadSchema.safeParse({
        companyId: entry.companyId,
        changes,
      });
      if (!parsed.success) {
        // Which fields the model got into the wrong shape, never the values.
        options.logger?.info(
          {
            qRunId: context.runId,
            refusals: parsed.error.issues
              .slice(0, 6)
              .map((issue) => issue.path.join(".")),
          },
          "a requested profile change did not fit the profile's own shape",
        );
        return Promise.resolve(null);
      }
      return Promise.resolve({
        actionType: COMPANY_PROFILE_UPDATE,
        payload: parsed.data,
      });
    },
  };
}
