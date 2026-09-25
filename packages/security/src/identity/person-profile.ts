import type { UserId } from "./ids.js";

/**
 * The person's own editable profile (BIZ-002): what Capital Q calls them
 * and a one-line headline, on the canonical Person, never on a membership
 * or an organisation (Person ≠ Organisation ≠ Membership/Role).
 *
 * One store, two front doors: the profile page edits through
 * `PATCH /v1/me/profile` and Q's approved `person.profile.update` executes
 * through the same `update`, so there is exactly one rule for what an edit
 * does. Keyed on the application user id; the caller is responsible for
 * that id being the acting person's own (the HTTP route resolves it from
 * the verified session, the Q action from the approver).
 */
export type PersonProfile = {
  readonly userId: UserId;
  readonly displayName: string | null;
  readonly headline: string | null;
  readonly version: number;
  readonly updatedAt: string;
};

export type PersonProfileChanges = {
  readonly displayName?: string | undefined;
  /** `null` returns the headline to not stated. */
  readonly headline?: string | null | undefined;
};

export type PersonProfileStore = {
  /** The active profile, or null when none exists (suspended or closed read as none). */
  readonly read: (userId: UserId) => Promise<PersonProfile | null>;
  /**
   * Apply the changes when `expectedVersion` is current. A replay of a
   * change that already holds (the version moved, every requested value is
   * already stored) returns the current profile rather than a conflict, so
   * a retried request is idempotent; any other stale write is refused.
   */
  readonly update: (input: {
    readonly userId: UserId;
    readonly expectedVersion: number;
    readonly changes: PersonProfileChanges;
  }) => Promise<PersonProfile>;
};

export class PersonProfileNotFoundError extends Error {
  constructor() {
    super("No active profile exists for this person.");
    this.name = "PersonProfileNotFoundError";
  }
}

export class PersonProfileVersionConflictError extends Error {
  readonly currentVersion: number;

  constructor(currentVersion: number) {
    super("The profile has changed since it was read.");
    this.name = "PersonProfileVersionConflictError";
    this.currentVersion = currentVersion;
  }
}

/** Only the requested values that differ from what is stored. */
export function effectivePersonChanges(
  current: Pick<PersonProfile, "displayName" | "headline">,
  changes: PersonProfileChanges,
): PersonProfileChanges {
  const effective: { displayName?: string; headline?: string | null } = {};
  if (
    changes.displayName !== undefined &&
    changes.displayName !== current.displayName
  ) {
    effective.displayName = changes.displayName;
  }
  if (changes.headline !== undefined && changes.headline !== current.headline) {
    effective.headline = changes.headline;
  }
  return effective;
}
