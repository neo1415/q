import {
  ACTIVITY_PAGE_DEFAULT,
  ActivityQuerySchema,
  ORGANISATION_ACTIVITY_VIEW,
  type ActivityActor,
  type ActivityItemDto,
  type ActivityKind,
  type ActivityPageDto,
  type MeCapabilitiesDto,
  type MemberSummaryDto,
  type TeamRole,
} from "@capital-q/contracts";
import {
  ActorContextRequiredError,
  capability,
  REFERENCE_CAPABILITIES,
  type ActorContext,
  type AuthorizationService,
  type Capability,
  type ResourceScope,
} from "@capital-q/security";
import { z } from "zod";

import {
  PRIVATE_ACTION_PATTERNS,
  Q_EXECUTED_ACTION_TYPES,
  activityKindOf,
  decodeActivityCursor,
  describeAction,
  encodeActivityCursor,
  genericLabel,
  roleWord,
  kindPatterns,
} from "../domain/activity.js";
import {
  OrganisationActivityQueryError,
  OrganisationMemberNotFoundError,
} from "../domain/errors.js";
import {
  ADMIN_ROLE_CODE,
  MEMBER_ROLE_CODE,
  OWNER_ROLE_CODE,
  abilitiesOf,
  invitationRoleOf,
  invitationState,
  teamRoleOf,
} from "../domain/team.js";
import {
  resourceKey,
  type ActivityPerson,
  type ActivityRecord,
  type OrganisationAdminStore,
} from "./organisation-admin-ports.js";

/**
 * Organisation administration reads: the caller's effective capabilities,
 * the organisation's activity feed and one member's summary.
 *
 * Authority:
 *   - the organisation is ALWAYS the actor context's active organisation
 *     (server-resolved); no input names one;
 *   - the feed and summaries require organisation.activity.view over that
 *     organisation, decided by AuthorizationService from policy facts;
 *   - a filtered or summarised person must be, or have been, a member of
 *     THIS organisation, else the one enumeration-safe not-found.
 *
 * Privacy (Q Memory ≠ Audit History): the source is the accountability
 * record only. Personal Q content, Q proposals, delegations, workforce
 * jobs, standing instructions, reminders and chats are filtered out in the
 * store's SQL; what remains of Q is "Q, under <person>'s approval".
 * Resource labels name something only where the admin can already see it
 * (their own team and organisation; relationships only when they hold the
 * pipeline read); otherwise they are generic.
 */

export const ORGANISATION_ACTIVITY_VIEW_CAPABILITY = capability(
  ORGANISATION_ACTIVITY_VIEW,
);
const ORGANISATION_OWN = capability("organisation.own");
const ORGANISATION_ADMIN_CAPABILITY = capability("organisation.admin");
/** The pipeline reads that let a side see its own relationships. */
const PIPELINE_READS = [
  capability("company.interest.view"),
  capability("investor.view"),
] as const;

/** Every capability the web may gate on, probed over the active organisation. */
export const PROBED_CAPABILITIES: readonly Capability[] = [
  ...new Set<string>([...REFERENCE_CAPABILITIES, "organisation.own"]),
].map((code) => capability(code));

export type OrganisationAdminService = {
  readonly myCapabilities: (actor: ActorContext) => Promise<MeCapabilitiesDto>;
  readonly activity: (
    actor: ActorContext,
    query: unknown,
  ) => Promise<ActivityPageDto>;
  readonly memberSummary: (
    actor: ActorContext,
    userId: string,
  ) => Promise<MemberSummaryDto>;
};

export type OrganisationAdminServiceDependencies = {
  readonly authorization: AuthorizationService;
  readonly store: OrganisationAdminStore;
  readonly now?: (() => Date) | undefined;
};

type ActiveOrganisation = {
  readonly tenantId: ActorContext["tenantId"];
  readonly organisationId: NonNullable<ActorContext["organisationId"]>;
  readonly membershipId: NonNullable<ActorContext["membershipId"]>;
};

function active(actor: ActorContext): ActiveOrganisation {
  if (actor.organisationId === undefined || actor.membershipId === undefined) {
    throw new ActorContextRequiredError();
  }
  return {
    tenantId: actor.tenantId,
    organisationId: actor.organisationId,
    membershipId: actor.membershipId,
  };
}

function organisationScope(org: ActiveOrganisation): ResourceScope {
  return {
    kind: "ORGANISATION",
    tenantId: org.tenantId,
    organisationId: org.organisationId,
  };
}

const UserIdParamSchema = z.uuid();

function personName(person: ActivityPerson | undefined): string | null {
  if (person === undefined) return null;
  const name = person.name?.trim() ?? "";
  if (name.length > 0) return name.slice(0, 200);
  const local = person.email?.split("@")[0]?.trim() ?? "";
  return local.length > 0 ? local.slice(0, 200) : null;
}

const SOMEONE = "Someone outside your team";

export function createOrganisationAdminService(
  dependencies: OrganisationAdminServiceDependencies,
): OrganisationAdminService {
  const { authorization, store } = dependencies;
  const now = dependencies.now ?? (() => new Date());

  async function holds(
    actor: ActorContext,
    org: ActiveOrganisation,
    cap: Capability,
  ): Promise<boolean> {
    const decision = await authorization.authorize({
      actor,
      capability: cap,
      resource: organisationScope(org),
    });
    return decision.outcome === "ALLOW";
  }

  async function requireActivityView(
    actor: ActorContext,
  ): Promise<ActiveOrganisation> {
    const org = active(actor);
    await authorization.requireCapability({
      actor,
      capability: ORGANISATION_ACTIVITY_VIEW_CAPABILITY,
      resource: organisationScope(org),
    });
    return org;
  }

  async function relationshipsVisible(
    actor: ActorContext,
    org: ActiveOrganisation,
  ): Promise<boolean> {
    const held = await Promise.all(
      PIPELINE_READS.map((cap) => holds(actor, org, cap)),
    );
    return held.some(Boolean);
  }

  async function requireMember(
    org: ActiveOrganisation,
    userId: string,
  ): Promise<
    NonNullable<Awaited<ReturnType<OrganisationAdminStore["member"]>>>
  > {
    const parsed = UserIdParamSchema.safeParse(userId);
    if (!parsed.success) throw new OrganisationMemberNotFoundError();
    const member = await store.member(org.organisationId, parsed.data);
    if (member === null) throw new OrganisationMemberNotFoundError();
    return member;
  }

  function actorOf(
    row: ActivityRecord,
    people: ReadonlyMap<string, ActivityPerson>,
  ): ActivityActor {
    switch (row.actorType) {
      case "human": {
        const userId = row.actorId;
        const name = userId === null ? null : personName(people.get(userId));
        return {
          type: "PERSON",
          userId: name === null ? null : userId,
          display: name ?? SOMEONE,
        };
      }
      case "q": {
        const userId = row.authorityUserId;
        const name = userId === null ? null : personName(people.get(userId));
        return {
          type: "Q",
          userId: name === null ? null : userId,
          display:
            name === null
              ? "Q, under a person's approval"
              : `Q, under ${name}'s approval`,
        };
      }
      case "capital_q_system":
        return { type: "CAPITAL_Q", userId: null, display: "Capital Q" };
      case "connected_system":
        return {
          type: "CONNECTED_SYSTEM",
          userId: null,
          display: "A connected app",
        };
    }
  }

  return {
    myCapabilities: async (actor) => {
      const org = active(actor);
      const held = await Promise.all(
        PROBED_CAPABILITIES.map(async (cap) =>
          (await holds(actor, org, cap)) ? cap : null,
        ),
      );
      const capabilities = held
        .filter((cap): cap is Capability => cap !== null)
        .map(String)
        .sort();
      // The team role is read from the same facts, so every control the web
      // gates agrees with what the server will enforce.
      const role: TeamRole = capabilities.includes(ORGANISATION_OWN)
        ? "OWNER"
        : capabilities.includes(ORGANISATION_ADMIN_CAPABILITY)
          ? "ADMIN"
          : "MEMBER";
      return {
        organisationId: org.organisationId,
        membershipId: org.membershipId,
        role,
        capabilities,
        team: abilitiesOf(role),
      };
    },

    activity: async (actor, input) => {
      const org = await requireActivityView(actor);
      const parsed = ActivityQuerySchema.safeParse(input ?? {});
      if (!parsed.success) throw new OrganisationActivityQueryError();
      const query = parsed.data;
      const before =
        query.cursor === undefined
          ? undefined
          : (decodeActivityCursor(query.cursor) ?? undefined);
      if (query.cursor !== undefined && before === undefined) {
        throw new OrganisationActivityQueryError();
      }
      if (
        query.from !== undefined &&
        query.to !== undefined &&
        Date.parse(query.from) > Date.parse(query.to)
      ) {
        throw new OrganisationActivityQueryError();
      }
      if (query.member !== undefined) {
        // A person from another organisation cannot be filtered on.
        await requireMember(org, query.member);
      }
      const limit = query.limit ?? ACTIVITY_PAGE_DEFAULT;
      const patterns =
        query.kind === undefined
          ? { include: [], exclude: [] }
          : kindPatterns(query.kind);
      const rows = await store.activity({
        tenantId: org.tenantId,
        organisationId: org.organisationId,
        userId: query.member,
        include: patterns.include,
        exclude: patterns.exclude,
        privatePatterns: PRIVATE_ACTION_PATTERNS,
        qExecutedTypes: Q_EXECUTED_ACTION_TYPES,
        from: query.from,
        to: query.to,
        before,
        limit: limit + 1,
      });
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      const nextCursor =
        rows.length > limit && last !== undefined
          ? encodeActivityCursor({ at: last.occurredAt, key: last.key })
          : null;

      const userIds = new Set<string>();
      for (const row of page) {
        if (row.actorType === "human" && row.actorId !== null)
          userIds.add(row.actorId);
        if (row.actorType === "q" && row.authorityUserId !== null)
          userIds.add(row.authorityUserId);
      }
      const visible = await relationshipsVisible(actor, org);
      const [people, resources] = await Promise.all([
        store.people(org.organisationId, [...userIds]),
        store.resources({
          tenantId: org.tenantId,
          organisationId: org.organisationId,
          refs: page.map((row) => ({
            type: row.resourceType,
            id: row.resourceId,
          })),
          relationshipsVisible: visible,
        }),
      ]);

      const items = page.map((row): ActivityItemDto => {
        const action = describeAction(row.effectiveActionType);
        const resolved = resources.get(
          resourceKey({ type: row.resourceType, id: row.resourceId }),
        );
        let change: ActivityItemDto["change"] = resolved?.change ?? null;
        if (action.code === "team.membership.role_changed") {
          const before = roleWord(row.roleFrom);
          const after = roleWord(row.roleTo);
          change = before === null && after === null ? null : { before, after };
        }
        return {
          id: row.eventId,
          at: row.occurredAt,
          actor: actorOf(row, people),
          action,
          outcome: row.outcome,
          resource: {
            kind: row.resourceType,
            label: resolved?.label ?? genericLabel(row.resourceType),
            link: resolved?.link ?? null,
          },
          change,
        };
      });
      return { items, nextCursor };
    },

    memberSummary: async (actor, userId) => {
      const org = await requireActivityView(actor);
      const member = await requireMember(org, userId);
      const at = now();
      const since = new Date(at.getTime() - 30 * 24 * 60 * 60_000);
      const visible = await relationshipsVisible(actor, org);
      const [roles, invitations, activity, touched] = await Promise.all([
        store.roleHistory(member.membershipId),
        store.invitationsSent(org.organisationId, member.userId),
        store.memberActivity({
          tenantId: org.tenantId,
          organisationId: org.organisationId,
          userId: member.userId,
          since: since.toISOString(),
          privatePatterns: PRIVATE_ACTION_PATTERNS,
          qExecutedTypes: Q_EXECUTED_ACTION_TYPES,
        }),
        store.relationshipsTouched({
          tenantId: org.tenantId,
          organisationId: org.organisationId,
          userId: member.userId,
        }),
      ]);

      const roleOfCode = new Map<string, TeamRole>([
        [OWNER_ROLE_CODE, "OWNER"],
        [ADMIN_ROLE_CODE, "ADMIN"],
        [MEMBER_ROLE_CODE, "MEMBER"],
      ]);
      const roleHistory = roles.flatMap((span) => {
        const role = roleOfCode.get(span.roleCode);
        return role === undefined
          ? []
          : [{ role, from: span.validFrom, until: span.validUntil }];
      });

      const byKind = new Map<ActivityKind, number>();
      for (const entry of activity.counts) {
        const kind = activityKindOf(entry.effectiveActionType);
        byKind.set(kind, (byKind.get(kind) ?? 0) + entry.count);
      }

      const status =
        member.status === "active"
          ? "ACTIVE"
          : member.status === "left"
            ? "LEFT"
            : "REMOVED";
      return {
        member: {
          userId: member.userId,
          membershipId: member.membershipId,
          name:
            personName({
              userId: member.userId,
              name: member.name,
              email: member.email,
            }) ?? "Someone",
          email: member.email,
          status,
          role: status === "ACTIVE" ? teamRoleOf(member.roleCodes) : null,
          joinedAt: member.joinedAt,
          leftAt: member.leftAt,
        },
        roleHistory: roleHistory.slice(0, 200),
        invitationsSent: invitations.slice(0, 200).map((invitation) => {
          const state = invitationState(
            invitation.status,
            new Date(invitation.expiresAt),
            at,
          );
          return {
            invitationId: invitation.invitationId,
            email: invitation.email,
            role: invitationRoleOf(invitation.roleCode),
            state,
            sentAt: invitation.sentAt,
          };
        }),
        lastActiveAt: activity.lastActiveAt,
        last30Days: {
          since: since.toISOString(),
          counts: [...byKind.entries()]
            .filter(([, count]) => count > 0)
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([kind, count]) => ({ kind, count })),
        },
        relationships: touched.slice(0, 100).map((relationship) => {
          const named =
            visible && relationship.counterpartName !== null
              ? relationship.counterpartName
              : null;
          const link = !visible
            ? null
            : relationship.side === "COMPANY"
              ? `/relationships/investor/${relationship.investorOrganisationId}`
              : `/relationships/company/${relationship.companyId}`;
          return {
            relationshipId: relationship.relationshipId,
            label:
              named === null
                ? genericLabel("relationship")
                : `Relationship with ${named}`.slice(0, 260),
            link,
            lastTouchedAt: relationship.lastTouchedAt,
            events: relationship.events,
            notes: relationship.notes,
          };
        }),
      };
    },
  };
}
