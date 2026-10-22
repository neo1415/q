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
 * An in-memory OrganisationAdminStore for tests, with the same semantics as
 * the Postgres store: the union of audit rows, relationship events and
 * notes (with the same dedupe), organisation and tenant scoping, privacy
 * patterns over the effective action type, kind patterns and a keyset
 * cursor over (occurredAt desc, source desc, key desc). No database.
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
  readonly correlationId?: string | null | undefined;
};

export type MemoryRelationship = {
  readonly id: string;
  readonly companyId: string;
  readonly investorOrganisationId: string;
  /** The organisations behind each side. */
  readonly companyOrganisationId: string;
  readonly investorOrgOrganisationId: string;
  readonly companyName: string;
  readonly investorName: string;
};

export type MemoryRelationshipEvent = {
  readonly id: string;
  readonly relationshipId: string;
  readonly sequence: number;
  readonly eventType: string;
  readonly actorType: "HUMAN" | "Q" | "SYSTEM" | "CONNECTED_SYSTEM";
  readonly actorId: string;
  readonly visibility: string;
  readonly occurredAt: string;
  /** `cor_<uuid>`, as the table stores it. */
  readonly correlationId: string;
};

export type MemoryRelationshipNote = {
  readonly id: string;
  readonly tenantId: string;
  readonly organisationId: string;
  readonly relationshipId: string;
  readonly authorUserId: string;
  readonly body: string;
  readonly supersedesNoteId: string | null;
  readonly createdAt: string;
};

type FeedRow = ActivityRecord & { readonly at: number };

type MineEntry = {
  readonly r: MemoryRelationship;
  readonly side: "COMPANY" | "INVESTOR";
  readonly counterpart: string;
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
  readonly relationships: MemoryRelationship[] = [];
  readonly events: MemoryRelationshipEvent[] = [];
  readonly notes: MemoryRelationshipNote[] = [];
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

  /** The relationships this organisation is a party to, with its side. */
  private mine(organisationId: string): MineEntry[] {
    return this.relationships.flatMap((r): MineEntry[] => {
      if (r.companyOrganisationId === organisationId)
        return [{ r, side: "COMPANY", counterpart: r.investorName }];
      if (r.investorOrgOrganisationId === organisationId)
        return [{ r, side: "INVESTOR", counterpart: r.companyName }];
      return [];
    });
  }

  /** The same union, dedupe and shape as the Postgres feedRows. */
  private feed(scope: {
    readonly tenantId: string;
    readonly organisationId: string;
    readonly qExecutedTypes: readonly string[];
    readonly stageEventTypes: readonly string[];
    readonly privatePatterns: readonly string[];
  }): FeedRow[] {
    const mine = new Map(
      this.mine(scope.organisationId).map((m) => [m.r.id, m]),
    );
    const members = new Set(
      this.memberships
        .filter((m) => m.organisationId === scope.organisationId)
        .map((m) => m.userId),
    );
    const stage = (t: string) => scope.stageEventTypes.includes(t);
    const audit = this.audit
      .filter(
        (row) =>
          row.organisationId === scope.organisationId &&
          row.tenantId === scope.tenantId,
      )
      .filter((row) => {
        const corr = row.correlationId ?? null;
        if (row.actorType !== "human" || corr === null) return true;
        const byEvent = this.events.some(
          (e) =>
            e.correlationId === `cor_${corr}` &&
            e.actorType === "HUMAN" &&
            e.actorId === row.actorId &&
            e.visibility !== "personal_private",
        );
        const byService =
          row.actionType.startsWith("app.") &&
          this.audit.some(
            (other) =>
              other.key !== row.key &&
              other.organisationId === row.organisationId &&
              other.correlationId === corr &&
              !other.actionType.startsWith("app."),
          );
        return !byEvent && !byService;
      })
      .map((row): FeedRow => ({
        source: "a",
        key: String(row.key).padStart(20, "0"),
        at: Date.parse(row.occurredAt),
        eventId: row.eventId,
        occurredAt: row.occurredAt,
        actorType: row.actorType,
        actorId: row.actorId,
        authorityUserId: row.authorityUserId,
        actionType: row.actionType,
        effectiveActionType: this.effective(row, scope.qExecutedTypes),
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
        stageFrom: null,
        stageTo: null,
      }));
    const events = this.events
      .filter(
        (e) =>
          e.actorType === "HUMAN" &&
          e.visibility !== "personal_private" &&
          mine.has(e.relationshipId) &&
          members.has(e.actorId),
      )
      .map((e): FeedRow => {
        const previous = this.events
          .filter(
            (p) =>
              p.relationshipId === e.relationshipId &&
              p.sequence < e.sequence &&
              stage(p.eventType) &&
              p.visibility !== "personal_private",
          )
          .sort((a, b) => b.sequence - a.sequence)[0];
        return {
          source: "e",
          key: e.id,
          at: Date.parse(e.occurredAt),
          eventId: e.id,
          occurredAt: e.occurredAt,
          actorType: "human",
          actorId: e.actorId,
          authorityUserId: e.actorId,
          actionType: "relationship.event",
          effectiveActionType: stage(e.eventType)
            ? "relationship.stage.change"
            : `relationship.event.${e.eventType}`,
          resourceType: "relationship",
          resourceId: e.relationshipId,
          outcome: "SUCCEEDED",
          roleFrom: null,
          roleTo: null,
          stageFrom: stage(e.eventType) ? (previous?.eventType ?? null) : null,
          stageTo: stage(e.eventType) ? e.eventType : null,
        };
      });
    const notes = this.notes
      .filter(
        (n) =>
          n.organisationId === scope.organisationId &&
          n.tenantId === scope.tenantId,
      )
      .map((n): FeedRow => ({
        source: "n",
        key: n.id,
        at: Date.parse(n.createdAt),
        eventId: n.id,
        occurredAt: n.createdAt,
        actorType: "human",
        actorId: n.authorUserId,
        authorityUserId: n.authorUserId,
        actionType: "relationship.note",
        effectiveActionType:
          n.supersedesNoteId === null
            ? "relationship.note.add"
            : "relationship.note.correct",
        resourceType: "relationship_note",
        resourceId: n.id,
        outcome: "SUCCEEDED",
        roleFrom: null,
        roleTo: null,
        stageFrom: null,
        stageTo: null,
      }));
    return [...audit, ...events, ...notes].filter((row) =>
      this.shownRow(row, scope.privatePatterns, scope.qExecutedTypes),
    );
  }

  private shownRow(
    row: ActivityRecord,
    privatePatterns: readonly string[],
    qExecuted: readonly string[],
  ) {
    if (privatePatterns.some((p) => likeMatches(row.effectiveActionType, p)))
      return false;
    return (
      qExecuted.includes(row.actionType) ||
      !privatePatterns.some((p) => likeMatches(row.actionType, p))
    );
  }

  store(): OrganisationAdminStore {
    return {
      activity: (filter) => {
        this.scopedTo.push(filter.organisationId);
        const before = filter.before;
        const rows = this.feed(filter)
          .filter(
            (row) =>
              filter.userId === undefined ||
              row.actorId === filter.userId ||
              row.authorityUserId === filter.userId,
          )
          .filter(
            (row) =>
              (filter.from === undefined ||
                row.at >= Date.parse(filter.from)) &&
              (filter.to === undefined || row.at < Date.parse(filter.to)),
          )
          .filter((row) => {
            if (before === undefined) return true;
            const cut = Date.parse(before.at);
            return (
              row.at < cut ||
              (row.at === cut &&
                (row.source < before.source ||
                  (row.source === before.source && row.key < before.key)))
            );
          })
          .filter(
            (row) =>
              (filter.include.length === 0 ||
                filter.include.some((p) =>
                  likeMatches(row.effectiveActionType, p),
                )) &&
              !filter.exclude.some((p) =>
                likeMatches(row.effectiveActionType, p),
              ),
          )
          .sort(
            (a, b) =>
              b.at - a.at ||
              (a.source === b.source ? 0 : a.source < b.source ? 1 : -1) ||
              (a.key === b.key ? 0 : a.key < b.key ? 1 : -1),
          )
          .slice(0, filter.limit)
          .map(({ at: _at, ...record }): ActivityRecord => record);
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
        const mine = new Map(this.mine(organisationId).map((m) => [m.r.id, m]));
        const placed = (relationshipId: string) => {
          const m = mine.get(relationshipId);
          if (m === undefined) return null;
          return {
            label: `Relationship with ${m.counterpart}`,
            link:
              m.side === "COMPANY"
                ? `/relationships/investor/${m.r.investorOrganisationId}`
                : `/relationships/company/${m.r.companyId}`,
          };
        };
        for (const ref of refs) {
          if (!relationshipsVisible) break;
          if (ref.type === "relationship") {
            const at = placed(ref.id);
            if (at !== null) out.set(resourceKey(ref), { ...at, change: null });
          }
          if (ref.type === "relationship_note") {
            const note = this.notes.find(
              (n) => n.id === ref.id && n.organisationId === organisationId,
            );
            const at = note === undefined ? null : placed(note.relationshipId);
            if (note === undefined || at === null) continue;
            const previous = this.notes.find(
              (n) =>
                n.id === note.supersedesNoteId &&
                n.organisationId === note.organisationId,
            );
            out.set(resourceKey(ref), {
              ...at,
              change:
                previous === undefined
                  ? null
                  : { before: previous.body, after: note.body },
            });
          }
        }
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
        const visible = this.feed(input).filter(
          (row) =>
            row.actorId === input.userId ||
            row.authorityUserId === input.userId,
        );
        const counts = new Map<string, number>();
        for (const row of visible) {
          if (row.at >= Date.parse(input.since)) {
            counts.set(
              row.effectiveActionType,
              (counts.get(row.effectiveActionType) ?? 0) + 1,
            );
          }
        }
        const last = [...visible].sort((a, b) => b.at - a.at)[0];
        return Promise.resolve({
          lastActiveAt: last?.occurredAt ?? null,
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
