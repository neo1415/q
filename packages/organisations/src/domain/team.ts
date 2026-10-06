import { createHash, randomBytes } from "node:crypto";

import type {
  InvitableRole,
  OrganisationType,
  TeamKind,
  TeamRole,
} from "@capital-q/contracts";

/**
 * G1/G2 team rules, pure. The service applies them under a lock on the
 * organisation row; the database's constraint trigger is the second layer
 * for the one invariant that must never break: an organisation with
 * members keeps at least one owner.
 *
 * Roles are role TEMPLATES held through membership_roles, never a column
 * and never a client claim:
 *
 *   OWNER  = organisation_admin + organisation_owner
 *   ADMIN  = organisation_admin
 *   MEMBER = organisation_member
 */

export const OWNER_ROLE_CODE = "organisation_owner" as const;
export const ADMIN_ROLE_CODE = "organisation_admin" as const;
export const MEMBER_ROLE_CODE = "organisation_member" as const;

/** The role templates this context manages; any other role is left alone. */
export const TEAM_ROLE_CODES = [
  OWNER_ROLE_CODE,
  ADMIN_ROLE_CODE,
  MEMBER_ROLE_CODE,
] as const;

export const ROLE_CODES_FOR: Readonly<Record<TeamRole, readonly string[]>> = {
  OWNER: [ADMIN_ROLE_CODE, OWNER_ROLE_CODE],
  ADMIN: [ADMIN_ROLE_CODE],
  MEMBER: [MEMBER_ROLE_CODE],
};

/** What a membership's current role codes mean as one of the three roles. */
export function teamRoleOf(roleCodes: readonly string[]): TeamRole {
  if (roleCodes.includes(OWNER_ROLE_CODE)) return "OWNER";
  if (roleCodes.includes(ADMIN_ROLE_CODE)) return "ADMIN";
  return "MEMBER";
}

/** The stored code for an invitation's role. */
export function invitationRoleCode(role: InvitableRole): "admin" | "member" {
  return role === "ADMIN" ? "admin" : "member";
}
export function invitationRoleOf(code: string): InvitableRole {
  return code === "admin" ? "ADMIN" : "MEMBER";
}

/** A founder's company or an investor's firm: the UI's word. */
export function teamKindOf(type: OrganisationType): TeamKind {
  return type === "company" ? "COMPANY" : "FIRM";
}
export function teamWord(kind: TeamKind): "company" | "firm" {
  return kind === "COMPANY" ? "company" : "firm";
}

export type TeamAbilities = {
  readonly invite: boolean;
  readonly changeRoles: boolean;
  readonly removeMembers: boolean;
  readonly own: boolean;
};

export function abilitiesOf(role: TeamRole): TeamAbilities {
  const admin = role === "OWNER" || role === "ADMIN";
  return {
    invite: admin,
    changeRoles: admin,
    removeMembers: admin,
    own: role === "OWNER",
  };
}

/** A refusal in the person's words, with the reason as a code for tests. */
export type TeamRefusal = {
  readonly ok: false;
  readonly code:
    | "NOT_ALLOWED"
    | "NOT_FOUND"
    | "LAST_OWNER"
    | "OWNERS_ONLY"
    | "NOT_YOURSELF"
    | "ALREADY_MEMBER"
    | "EXPIRED"
    | "NOT_PENDING"
    | "WRONG_EMAIL"
    | "ALREADY_OWNER";
  readonly message: string;
};
export type TeamVerdict = { readonly ok: true } | TeamRefusal;

const OK: TeamVerdict = { ok: true };

export function refuse(
  code: TeamRefusal["code"],
  message: string,
): TeamRefusal {
  return { ok: false, code, message };
}

/**
 * Changing someone's role between Admin and Member, or an owner stepping
 * down. Admins change Members and Admins; only an owner changes an owner;
 * the last owner never steps down.
 */
export function canChangeRole(input: {
  readonly actorRole: TeamRole;
  readonly targetRole: TeamRole;
  readonly to: InvitableRole;
  readonly isSelf: boolean;
  readonly ownerCount: number;
}): TeamVerdict {
  const { actorRole, targetRole, isSelf, ownerCount } = input;
  if (targetRole === "OWNER") {
    if (actorRole !== "OWNER") {
      return refuse("OWNERS_ONLY", "Only an owner can change an owner's role.");
    }
    if (ownerCount <= 1) {
      return refuse(
        "LAST_OWNER",
        "You're the only owner. Make someone else owner first.",
      );
    }
    return OK;
  }
  if (isSelf) {
    // Stepping down from Admin to Member is allowed; promoting yourself is not.
    return targetRole === "ADMIN" && input.to === "MEMBER"
      ? OK
      : refuse("NOT_ALLOWED", "Ask an admin to change your role.");
  }
  if (actorRole === "MEMBER") {
    return refuse("NOT_ALLOWED", "Only admins can change roles.");
  }
  return OK;
}

/** Removing someone else. Never yourself (that is leaving). */
export function canRemove(input: {
  readonly actorRole: TeamRole;
  readonly targetRole: TeamRole;
  readonly isSelf: boolean;
  readonly ownerCount: number;
}): TeamVerdict {
  if (input.isSelf) {
    return refuse("NOT_YOURSELF", "To leave, use Leave instead.");
  }
  if (input.actorRole === "MEMBER") {
    return refuse("NOT_ALLOWED", "Only admins can remove people.");
  }
  if (input.targetRole === "OWNER") {
    if (input.actorRole !== "OWNER") {
      return refuse("OWNERS_ONLY", "Only an owner can remove an owner.");
    }
    if (input.ownerCount <= 1) {
      return refuse("LAST_OWNER", "Every team keeps at least one owner.");
    }
  }
  return OK;
}

/** Leaving: blocked for the last owner. */
export function canLeave(input: {
  readonly role: TeamRole;
  readonly ownerCount: number;
}): TeamVerdict {
  if (input.role === "OWNER" && input.ownerCount <= 1) {
    return refuse(
      "LAST_OWNER",
      "You're the only owner. Make someone else owner first. Then you can leave.",
    );
  }
  return OK;
}

/** Offering ownership: an owner, to someone who isn't one yet. */
export function canOfferOwnership(input: {
  readonly actorRole: TeamRole;
  readonly targetRole: TeamRole;
  readonly isSelf: boolean;
}): TeamVerdict {
  if (input.actorRole !== "OWNER") {
    return refuse("OWNERS_ONLY", "Only an owner can make someone an owner.");
  }
  if (input.isSelf || input.targetRole === "OWNER") {
    return refuse("ALREADY_OWNER", "They're already an owner.");
  }
  return OK;
}

// --- emails ---------------------------------------------------------------

const EMAIL = /^[^@\s<>,;"]+@[^@\s<>,;"]+\.[^@\s<>,;"]+$/u;

export function normaliseEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return email.length >= 3 && email.length <= 254 && EMAIL.test(email)
    ? email
    : null;
}

/** Many addresses as typed (commas, semicolons, spaces, new lines), once each. */
export function splitEmails(raw: string): readonly string[] {
  return [
    ...new Set(
      raw
        .split(/[\s,;]+/u)
        .map((part) => part.trim())
        .filter((part) => part.length > 0),
    ),
  ];
}

// --- invitation tokens and expiry -----------------------------------------

/** A link token (only ever in the email) and the hash that is stored. */
export function createInvitationToken(): {
  readonly token: string;
  readonly hash: string;
} {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashInvitationToken(token) };
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export type InvitationStatus = "pending" | "accepted" | "revoked";

export function invitationState(
  status: InvitationStatus,
  expiresAt: Date,
  now: Date,
): "PENDING" | "EXPIRED" | "ACCEPTED" | "REVOKED" {
  if (status === "accepted") return "ACCEPTED";
  if (status === "revoked") return "REVOKED";
  return expiresAt.getTime() <= now.getTime() ? "EXPIRED" : "PENDING";
}

export function invitationExpiry(now: Date, days: number): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Initials for a name, for the accept page (never a photo of a stranger). */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}
