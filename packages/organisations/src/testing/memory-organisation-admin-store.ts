import {
  resourceKey,
  type ActivityPerson,
  type ActivityRecord,
  type MemberRecord,
  type OrganisationAdminStore,
  type ResolvedResource,
  type RoleSpan,
  type SentInvitation,
  type TouchedRelationship,
} from "../application/organisation-admin-ports.js";

/**
 * An in-memory OrganisationAdminStore for tests, with the same filtering
 * semantics as the Postgres store: organisation and tenant scoping,
 * privacy patterns over the effective action type, kind patterns and a
 * keyset cursor over (occurredAt desc, key desc). No database, no network.
 */

export type MemoryAuditRow = {
  readonly key: number;
  readonly eventId: string;
  readonly tenantId: string;
  readonly organisationId: string | null;
  readonly occurredAt: string;
  readonly actorType: ActivityRecord["actorType"];
  readonly actorId: string | null;
  readonly authorityUserId: string | null;
  readonly actionType: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly outcome: ActivityRecord["outcome"];
  readonly metadata: Readonly<Record<string, unknown>>;
};

export type MemoryAdminMembership = {
  readonly membershipId: string;
  readonly organisationId: string;
  readonly userId: string;
  readonly status: MemberRecord["status"];
  readonly joinedAt: string;
  readonly leftAt: string | null;
  readonly roleCodes: readonly string[];
  readonly roleHistory: readonly RoleSpan[];
};

/** SQL LIKE with backslash escapes, as Postgres applies it. */
export function likeMatches(value: string, pattern: string): boolean {
  let source = "^";
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i] ?? "";
    if (ch === "\\") {
      i += 1;
      source += (pattern[i] ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    } else if (ch === "%") source += ".*";
    else if (ch === "_") source += ".";
    else source += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`${source}$`, "su").test(value);
}

const ACTION_FORMAT = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

export class MemoryOrganisationAdminDb {
  readonly audit: MemoryAuditRow[] = [];
  readonly people = new Map<string, ActivityPerson>();
  readonly memberships: MemoryAdminMembership[] = [];
  readonly invitations: (SentInvitation & {
    readonly organisationId: string;
    readonly invitedBy: string;
  })[] = [];
  /** Pre-resolved labels per organisation, as the SQL would resolve them. */
  readonly labels = new Map<
    string,
    { readonly resolved: ResolvedResource; readonly relationship: boolean }
  >();
  readonly touched = new Map<string, TouchedRelationship[]>();
  /** Every organisation id any store call was scoped to. */
  readonly scopedTo: string[] = [];

  private effective(row: MemoryAuditRow, qExecuted: readonly string[]) {
    const inner = row.metadata["actionType"];
    return qExecuted.includes(row.actionType) &&
      typeof inner === "string" &&
      ACTION_FORMAT.test(inner)
      ? inner
      : row.actionType;
  }

  private shown(
    row: MemoryAuditRow,
    effective: string,
    privatePatterns: readonly string[],
    qExecuted: readonly string[],
  ) {
    if (privatePatterns.some((p) => likeMatches(effective, p))) return false;
    return (
      qExecuted.includes(row.actionType) ||
      !privatePatterns.some((p) => likeMatches(row.actionType, p))
    );
  }

  store(): OrganisationAdminStore {
    return {
      activity: (filter) => {
        this.scopedTo.push(filter.organisationId);
        const rows = this.audit
          .filter(
            (row) =>
              row.organisationId === filter.organisationId &&
              row.tenantId === filter.tenantId,
          )
          .filter(
            (row) =>
              filter.userId === undefined ||
              row.actorId === filter.userId ||
              row.authorityUserId === filter.userId,
          )
          .filter(
            (row) =>
              (filter.from === undefined ||
                Date.parse(row.occurredAt) >= Date.parse(filter.from)) &&
              (filter.to === undefined ||
                Date.parse(row.occurredAt) < Date.parse(filter.to)),
          )
          .filter((row) => {
            const before = filter.before;
            if (before === undefined) return true;
            const at = Date.parse(row.occurredAt);
            const cut = Date.parse(before.at);
            return at < cut || (at === cut && row.key < Number(before.key));
          })
          .map((row) => ({
            row,
            effective: this.effective(row, filter.qExecutedTypes),
          }))
          .filter(({ row, effective }) =>
            this.shown(
              row,
              effective,
              filter.privatePatterns,
              filter.qExecutedTypes,
            ),
          )
          .filter(
            ({ effective }) =>
              (filter.include.length === 0 ||
                filter.include.some((p) => likeMatches(effective, p))) &&
              !filter.exclude.some((p) => likeMatches(effective, p)),
          )
          .sort(
            (a, b) =>
              Date.parse(b.row.occurredAt) - Date.parse(a.row.occurredAt) ||
              b.row.key - a.row.key,
          )
          .slice(0, filter.limit)
          .map(({ row, effective }): ActivityRecord => ({
            key: String(row.key),
            eventId: row.eventId,
            occurredAt: row.occurredAt,
            actorType: row.actorType,
            actorId: row.actorId,
            authorityUserId: row.authorityUserId,
            actionType: row.actionType,
            effectiveActionType: effective,
            resourceType: row.resourceType,
            resourceId: row.resourceId,
            outcome: row.outcome,
            roleFrom:
              row.actionType === "team.membership.role_changed" &&
              typeof row.metadata["from"] === "string"
                ? row.metadata["from"]
                : null,
            roleTo:
              row.actionType === "team.membership.role_changed" &&
              typeof row.metadata["to"] === "string"
                ? row.metadata["to"]
                : null,
          }));
        return Promise.resolve(rows);
      },

      people: (organisationId, userIds) => {
        this.scopedTo.push(organisationId);
        const members = new Set(
          this.memberships
            .filter((m) => m.organisationId === organisationId)
            .map((m) => m.userId),
        );
        const out = new Map<string, ActivityPerson>();
        for (const id of userIds) {
          const person = this.people.get(id);
          if (person !== undefined && members.has(id)) out.set(id, person);
        }
        return Promise.resolve(out);
      },

      resources: ({ organisationId, refs, relationshipsVisible }) => {
        this.scopedTo.push(organisationId);
        const out = new Map<string, ResolvedResource>();
        for (const ref of refs) {
          const key = `${organisationId}|${resourceKey(ref)}`;
          const entry = this.labels.get(key);
          if (entry === undefined) continue;
          if (entry.relationship && !relationshipsVisible) continue;
          out.set(resourceKey(ref), entry.resolved);
        }
        return Promise.resolve(out);
      },

      member: (organisationId, userId) => {
        this.scopedTo.push(organisationId);
        const m = this.memberships
          .filter(
            (x) => x.organisationId === organisationId && x.userId === userId,
          )
          .sort(
            (a, b) =>
              Number(b.status === "active") - Number(a.status === "active") ||
              Date.parse(b.joinedAt) - Date.parse(a.joinedAt),
          )[0];
        if (m === undefined) return Promise.resolve(null);
        const person = this.people.get(userId);
        return Promise.resolve({
          membershipId: m.membershipId,
          userId,
          name: person?.name ?? null,
          email: person?.email ?? null,
          status: m.status,
          joinedAt: m.joinedAt,
          leftAt: m.leftAt,
          roleCodes: m.roleCodes,
        });
      },

      roleHistory: (membershipId) =>
        Promise.resolve(
          this.memberships.find((m) => m.membershipId === membershipId)
            ?.roleHistory ?? [],
        ),

      invitationsSent: (organisationId, userId) => {
        this.scopedTo.push(organisationId);
        return Promise.resolve(
          this.invitations.filter(
            (i) =>
              i.organisationId === organisationId && i.invitedBy === userId,
          ),
        );
      },

      memberActivity: (input) => {
        this.scopedTo.push(input.organisationId);
        const visible = this.audit
          .filter(
            (row) =>
              row.organisationId === input.organisationId &&
              row.tenantId === input.tenantId &&
              (row.actorId === input.userId ||
                row.authorityUserId === input.userId),
          )
          .map((row) => ({
            row,
            effective: this.effective(row, input.qExecutedTypes),
          }))
          .filter(({ row, effective }) =>
            this.shown(
              row,
              effective,
              input.privatePatterns,
              input.qExecutedTypes,
            ),
          );
        const counts = new Map<string, number>();
        for (const { row, effective } of visible) {
          if (Date.parse(row.occurredAt) >= Date.parse(input.since)) {
            counts.set(effective, (counts.get(effective) ?? 0) + 1);
          }
        }
        const last = visible
          .map(({ row }) => row.occurredAt)
          .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
        return Promise.resolve({
          lastActiveAt: last ?? null,
          counts: [...counts.entries()].map(([effectiveActionType, count]) => ({
            effectiveActionType,
            count,
          })),
        });
      },

      relationshipsTouched: ({ organisationId, userId }) => {
        this.scopedTo.push(organisationId);
        return Promise.resolve(
          this.touched.get(`${organisationId}|${userId}`) ?? [],
        );
      },
    };
  }
}
