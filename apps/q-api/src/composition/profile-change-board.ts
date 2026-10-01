import type { QActionType } from "@capital-q/contracts";
import { normaliseWebsite } from "@capital-q/founder-onboarding";
import type { Logger } from "@capital-q/observability";
import type { QActionProposer } from "@capital-q/q-actions";
import type { ProfileChangePort } from "@capital-q/q-tools";

import {
  COMPANY_PROFILE_UPDATE,
  CompanyProfileUpdatePayloadSchema,
  describeCompanyProfileChanges,
  refusalReason,
  refusedFields,
} from "./company-profile-action.js";
import {
  INVESTOR_PROFILE_UPDATE,
  InvestorProfileUpdatePayloadSchema,
  describeInvestorProfileChanges,
} from "./investor-profile-action.js";
import {
  PERSON_PROFILE_UPDATE,
  PersonProfileUpdatePayloadSchema,
  describePersonProfileChanges,
} from "./person-profile-action.js";

/**
 * Where `propose_profile_change` (BIZ-002) leaves a change for the run's
 * Approval Engine proposer.
 *
 * The change is shaped here into the exact payload of the action that
 * owns it -- person.profile.update, company.profile.update or
 * investor.profile.update -- with the same website normalisation the
 * onboarding and company writes use, and checked against that payload
 * schema before anything is held. A value that does not fit is REFUSED
 * with code's own reason, never the model's. One prepared action per run,
 * for the run's own person and tenant; nothing on the board executes.
 */

const READING_TTL_MS = 10 * 60 * 1000;

type Prepared = {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly actionType: QActionType;
  readonly payload: unknown;
  readonly at: number;
};

const PERSON_SHAPES: Readonly<Record<string, string>> = {
  displayName: "a name needs to be between 1 and 80 characters",
  headline: "a headline needs to be between 1 and 160 characters",
  timeZone: "the time zone needs to be one like Africa/Lagos or Europe/London",
};

const INVESTOR_SHAPES: Readonly<Record<string, string>> = {
  investorType:
    "the investor type needs to be one Capital Q records (angel, VC, family office, CVC, syndicate, accelerator, scout, institutional or other)",
  displayName: "the name needs to be between 1 and 200 characters",
  websiteUrl:
    "the website needs to be a web address, such as https://example.com",
  hqCountry:
    "the country needs to be one Capital Q can record, such as GB for the United Kingdom",
  publicDescription: "the description is longer than the profile holds",
  deploymentState:
    "whether you're deploying needs to be actively investing, selective, paused or exploring only",
};

function reasonFor(
  shapes: Readonly<Record<string, string>>,
  issues: readonly { readonly path: readonly PropertyKey[] }[],
  fieldIndex: number,
): string {
  const fields = new Set<string>();
  for (const issue of issues) {
    const field = issue.path[fieldIndex];
    if (typeof field === "string" && shapes[field] !== undefined) {
      fields.add(field);
    }
  }
  return fields.size === 0
    ? "the change didn't fit what the profile holds"
    : [...fields].map((field) => shapes[field]).join("; ");
}

type Shaped =
  | {
      readonly ok: true;
      readonly actionType: QActionType;
      readonly payload: unknown;
      readonly summary: string;
    }
  | { readonly ok: false; readonly reason: string };

function shape(
  entry: Parameters<ProfileChangePort["prepareForApproval"]>[0],
): Shaped {
  const values: Record<string, string | null> = {};
  for (const change of entry.changes) {
    values[change.field] = change.value;
  }
  // What people say ("kivu-freight.example") and what the field holds
  // (an http(s) URL) are reconciled the way every other write does it.
  if (typeof values["websiteUrl"] === "string") {
    try {
      values["websiteUrl"] = normaliseWebsite(values["websiteUrl"]);
    } catch {
      return {
        ok: false,
        reason:
          "the website needs to be a web address, such as https://example.com",
      };
    }
  }
  switch (entry.profile) {
    case "PERSON": {
      if (values["displayName"] === null) {
        return {
          ok: false,
          reason: "a name can be changed but not removed",
        };
      }
      const parsed = PersonProfileUpdatePayloadSchema.safeParse({
        userId: entry.subjectId,
        ...values,
      });
      return parsed.success
        ? {
            ok: true,
            actionType: PERSON_PROFILE_UPDATE,
            payload: parsed.data,
            summary: describePersonProfileChanges(parsed.data).summary,
          }
        : {
            ok: false,
            reason: reasonFor(PERSON_SHAPES, parsed.error.issues, 0),
          };
    }
    case "COMPANY": {
      const parsed = CompanyProfileUpdatePayloadSchema.safeParse({
        companyId: entry.subjectId,
        changes: values,
      });
      return parsed.success
        ? {
            ok: true,
            actionType: COMPANY_PROFILE_UPDATE,
            payload: parsed.data,
            summary: describeCompanyProfileChanges(parsed.data.changes).summary,
          }
        : {
            ok: false,
            reason: refusalReason(refusedFields(parsed.error.issues)),
          };
    }
    case "INVESTOR_ORGANISATION": {
      const parsed = InvestorProfileUpdatePayloadSchema.safeParse({
        investorOrganisationId: entry.subjectId,
        changes: values,
      });
      return parsed.success
        ? {
            ok: true,
            actionType: INVESTOR_PROFILE_UPDATE,
            payload: parsed.data,
            summary: describeInvestorProfileChanges(parsed.data.changes)
              .summary,
          }
        : {
            ok: false,
            reason: reasonFor(INVESTOR_SHAPES, parsed.error.issues, 1),
          };
    }
  }
}

export type ProfileChangeBoard = ProfileChangePort & {
  readonly proposer: QActionProposer;
};

export function createProfileChangeBoard(
  options: {
    readonly logger?: Logger | undefined;
    readonly now?: (() => number) | undefined;
  } = {},
): ProfileChangeBoard {
  const now = options.now ?? (() => Date.now());
  const prepared = new Map<string, Prepared>();
  const sweep = () => {
    const cutoff = now() - READING_TTL_MS;
    for (const [runId, entry] of prepared) {
      if (entry.at < cutoff) prepared.delete(runId);
    }
  };
  return {
    prepareForApproval: (entry) => {
      sweep();
      const shaped = shape(entry);
      if (!shaped.ok) {
        options.logger?.info(
          {
            qRunId: entry.runId,
            profile: entry.profile,
            fields: entry.changes.map((change) => change.field),
          },
          "a requested profile change did not fit the profile's own shape",
        );
        return Promise.resolve({
          status: "REFUSED",
          awaitingApprovalOf: null,
          reason: shaped.reason,
        });
      }
      const existing = prepared.get(entry.runId);
      if (existing !== undefined) {
        // The same change asked twice in one answer is one proposal; a
        // different one waits for the person to settle the first.
        const same =
          existing.actionType === shaped.actionType &&
          JSON.stringify(existing.payload) === JSON.stringify(shaped.payload);
        return Promise.resolve({
          status: same ? "PREPARED" : "ONE_PER_TURN",
          awaitingApprovalOf: same ? shaped.summary : null,
          reason: null,
        });
      }
      prepared.set(entry.runId, {
        tenantId: entry.tenantId,
        actorUserId: entry.actorUserId,
        actionType: shaped.actionType,
        payload: shaped.payload,
        at: now(),
      });
      return Promise.resolve({
        status: "PREPARED",
        awaitingApprovalOf: shaped.summary,
        reason: null,
      });
    },
    proposer: {
      propose: (context) => {
        const entry = prepared.get(context.runId);
        if (entry === undefined) return Promise.resolve(null);
        prepared.delete(context.runId);
        // Bound to the person and tenant the tool ran for.
        if (
          entry.tenantId !== context.actor.tenantId ||
          entry.actorUserId !== context.actor.userId
        ) {
          return Promise.resolve(null);
        }
        return Promise.resolve({
          actionType: entry.actionType,
          payload: entry.payload,
        });
      },
    },
  };
}
