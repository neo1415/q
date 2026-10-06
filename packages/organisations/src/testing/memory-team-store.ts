import type {
  InvitationRecord,
  JoinRequestRecord,
  OwnershipOfferRecord,
  TeamJournalEntry,
  TeamStore,
} from "../application/team-ports.js";

/**
 * An in-memory team store for tests (G1/G2): the same rules the database
 * keeps (one pending invitation per email, roles as templates, and, at
 * "commit", the last-owner check, rolling back a transaction that breaks
 * it). Never used outside tests.
 */

export type MemoryMembership = {
  id: string;
  tenantId: string;
  organisationId: string;
  userId: string;
  status: "active" | "left" | "revoked";
  roles: string[];
  joinedAt: string;
};

export type MemoryPerson = { id: string; name: string | null; email: string | null };

export class MemoryTeamDb {
  organisations = new Map<
    string,
    { id: string; tenantId: string; type: "company" | "investment_firm"; name: string; status: "active" }
  >();
  people = new Map<string, MemoryPerson>();
  memberships: MemoryMembership[] = [];
  invitations: (InvitationRecord & { tokenHash: string })[] = [];
  joinRequests: JoinRequestRecord[] = [];
  offers: OwnershipOfferRecord[] = [];
  contexts = new Map<string, string>();
  journal: TeamJournalEntry[] = [];
  private seq = 0;
  id(prefix: string): string {
    this.seq += 1;
    return `00000000-0000-4000-8000-${prefix}${String(this.seq).padStart(12 - prefix.length, "0")}`;
  }

  /** The database's own last-owner check, applied at "commit". */
  assertOwners(): void {
    for (const organisation of this.organisations.values()) {
      const active = this.memberships.filter(
        (m) => m.organisationId === organisation.id && m.status === "active",
      );
      if (active.length > 0 && !active.some((m) => m.roles.includes("organisation_owner"))) {
        throw new Error("LAST_OWNER (database)");
      }
    }
  }

  store(): TeamStore<MemoryTeamDb> {
    const db = this;
    const member = (m: MemoryMembership) => {
      const person = db.people.get(m.userId);
      return {
        membershipId: m.id,
        userId: m.userId,
        name: person?.name ?? null,
        email: person?.email ?? null,
        title: null,
        roleCodes: [...m.roles].sort(),
        joinedAt: m.joinedAt,
      };
    };
    return {
      transaction: async (work) => {
        const snapshot = JSON.stringify([db.memberships, db.invitations, db.joinRequests, db.offers, [...db.contexts]]);
        try {
          const out = await work(db);
          db.assertOwners();
          return out;
        } catch (error) {
          const [m, i, j, o, c] = JSON.parse(snapshot) as [MemoryMembership[], typeof db.invitations, JoinRequestRecord[], OwnershipOfferRecord[], [string, string][]];
          db.memberships = m;
          db.invitations = i.map((x) => ({ ...x, lastSentAt: new Date(x.lastSentAt), expiresAt: new Date(x.expiresAt) }));
          db.joinRequests = j;
          db.offers = o;
          db.contexts = new Map(c);
          throw error;
        }
      },
      lockOrganisation: (_tx, id) => Promise.resolve(db.organisations.get(id) ?? null),
      organisation: (_tx, id) => Promise.resolve(db.organisations.get(id) ?? null),
      members: (_tx, organisationId) =>
        Promise.resolve(
          db.memberships
            .filter((m) => m.organisationId === organisationId && m.status === "active")
            .map(member),
        ),
      person: (_tx, userId) =>
        Promise.resolve({
          name: db.people.get(userId)?.name ?? null,
          email: db.people.get(userId)?.email ?? null,
        }),
      pendingInvitations: (_tx, organisationId) =>
        Promise.resolve(db.invitations.filter((i) => i.organisationId === organisationId && i.status === "pending")),
      invitation: (_tx, organisationId, id) =>
        Promise.resolve(db.invitations.find((i) => i.organisationId === organisationId && i.id === id) ?? null),
      invitationByTokenHash: (_tx, hash) =>
        Promise.resolve(db.invitations.find((i) => i.tokenHash === hash) ?? null),
      insertInvitation: (_tx, input) => {
        if (db.invitations.some((i) => i.organisationId === input.organisationId && i.email === input.email && i.status === "pending")) {
          return Promise.reject(new Error("23505"));
        }
        const id = db.id("1");
        db.invitations.push({
          id,
          tenantId: input.tenantId,
          organisationId: input.organisationId,
          email: input.email,
          roleCode: input.roleCode,
          message: input.message,
          status: "pending",
          invitedByUserId: input.invitedByUserId,
          invitedByName: db.people.get(input.invitedByUserId)?.name ?? null,
          sentCount: 1,
          lastSentAt: new Date(),
          expiresAt: input.expiresAt,
          acceptedMembershipId: null,
          tokenHash: input.tokenHash,
        });
        return Promise.resolve(id);
      },
      rotateInvitation: (_tx, id, input) => {
        db.invitations = db.invitations.map((i) =>
          i.id === id ? { ...i, tokenHash: input.tokenHash, expiresAt: input.expiresAt, sentCount: i.sentCount + 1 } : i,
        );
        return Promise.resolve();
      },
      decideInvitation: (_tx, id, input) => {
        db.invitations = db.invitations.map((i) =>
          i.id === id && i.status === "pending"
            ? { ...i, status: input.status, acceptedMembershipId: input.membershipId }
            : i,
        );
        return Promise.resolve();
      },
      insertMembership: (_tx, input) => {
        const id = db.id("2");
        db.memberships.push({
          id,
          tenantId: input.tenantId,
          organisationId: input.organisationId,
          userId: input.userId,
          status: "active",
          roles: [],
          joinedAt: new Date().toISOString(),
        });
        return Promise.resolve(id);
      },
      setRoles: (_tx, membershipId, roles) => {
        const m = db.memberships.find((x) => x.id === membershipId);
        if (m !== undefined) m.roles = [...roles];
        return Promise.resolve();
      },
      endMembership: (_tx, membershipId, status) => {
        const m = db.memberships.find((x) => x.id === membershipId);
        if (m !== undefined) {
          m.status = status;
          m.roles = [];
        }
        return Promise.resolve();
      },
      activeContextOf: (_tx, userId) => Promise.resolve(db.contexts.get(userId) ?? null),
      setActiveContext: (_tx, userId, membershipId) => {
        db.contexts.set(userId, membershipId);
        return Promise.resolve();
      },
      anotherActiveMembership: (_tx, userId, except) => {
        const m = db.memberships.find((x) => x.userId === userId && x.status === "active" && x.organisationId !== except);
        return Promise.resolve(m === undefined ? null : { membershipId: m.id, organisationId: m.organisationId });
      },
      pendingJoinRequests: (_tx, organisationId) =>
        Promise.resolve(db.joinRequests.filter((j) => j.organisationId === organisationId && j.status === "pending")),
      joinRequest: (_tx, organisationId, id) =>
        Promise.resolve(db.joinRequests.find((j) => j.organisationId === organisationId && j.id === id) ?? null),
      insertJoinRequest: (_tx, input) => {
        if (db.joinRequests.some((j) => j.organisationId === input.organisationId && j.userId === input.userId && j.status === "pending")) {
          return Promise.resolve(null);
        }
        const id = db.id("3");
        db.joinRequests.push({
          id,
          tenantId: input.tenantId,
          organisationId: input.organisationId,
          userId: input.userId,
          name: db.people.get(input.userId)?.name ?? null,
          email: db.people.get(input.userId)?.email ?? null,
          message: input.message,
          status: "pending",
          createdAt: new Date().toISOString(),
        });
        return Promise.resolve(id);
      },
      decideJoinRequest: (_tx, id, input) => {
        db.joinRequests = db.joinRequests.map((j) => (j.id === id ? { ...j, status: input.status } : j));
        return Promise.resolve();
      },
      pendingOffers: (_tx, organisationId) =>
        Promise.resolve(db.offers.filter((o) => o.organisationId === organisationId && o.status === "pending")),
      offer: (_tx, organisationId, id) =>
        Promise.resolve(db.offers.find((o) => o.organisationId === organisationId && o.id === id) ?? null),
      insertOffer: (_tx, input) => {
        const id = db.id("4");
        db.offers.push({ id, ...input, status: "pending", createdAt: new Date().toISOString() });
        return Promise.resolve(id);
      },
      decideOffer: (_tx, id, status) => {
        db.offers = db.offers.map((o) => (o.id === id ? { ...o, status } : o));
        return Promise.resolve();
      },
      myOrganisations: (userId) =>
        Promise.resolve(
          db.memberships
            .filter((m) => m.userId === userId && m.status === "active")
            .map((m) => {
              const organisation = db.organisations.get(m.organisationId);
              return {
                organisationId: m.organisationId,
                name: organisation?.name ?? "",
                type: organisation?.type ?? "company",
                roleCodes: m.roles,
                memberCount: db.memberships.filter((x) => x.organisationId === m.organisationId && x.status === "active").length,
                active: db.contexts.get(userId) === m.id,
              };
            }),
        ),
    };
  }
}

