/**
 * Who may do what in Capital Q's operations console (ADR 0033, spec
 * docs/specs/2026-10/admin.md §3). Fixed, few, named roles; least
 * privilege; a versioned code table, so a change is a reviewed diff and the
 * console can say which version decided an action.
 */

export const ADMIN_ROLES = [
  "platform_owner",
  "operator",
  "trust_and_safety",
  "support",
  "analyst",
] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

// 2: BILLING permissions added (ADR 0034).
// 4: P14 company claims and publishing (claims.read/decide, companies.publish).
export const ADMIN_PERMISSIONS_VERSION = 4 as const;

const ALL: readonly AdminRole[] = ADMIN_ROLES;
const OWNER_OPERATOR_TS: readonly AdminRole[] = [
  "platform_owner",
  "operator",
  "trust_and_safety",
];

/**
 * Permission → roles that hold it, and whether it needs a live step-up.
 * Reads never need a step-up; every write does.
 */
export const ADMIN_PERMISSIONS = {
  "overview.read": { roles: ALL, stepUp: false },
  "ledger.read": {
    roles: ["platform_owner", "operator", "analyst"],
    stepUp: false,
  },
  "accounts.read": {
    roles: ["platform_owner", "operator", "trust_and_safety", "support"],
    stepUp: false,
  },
  "accounts.suspend": { roles: OWNER_OPERATOR_TS, stepUp: true },
  "accounts.reinstate_q": {
    roles: ["platform_owner", "operator", "trust_and_safety", "support"],
    stepUp: true,
  },
  "verification.read": {
    roles: ["platform_owner", "operator", "trust_and_safety", "support"],
    stepUp: false,
  },
  "verification.decide": { roles: OWNER_OPERATOR_TS, stepUp: true },
  "safety.read": { roles: OWNER_OPERATOR_TS, stepUp: false },
  "safety.decide": {
    roles: ["platform_owner", "trust_and_safety"],
    stepUp: true,
  },
  "breakglass.request": {
    roles: ["platform_owner", "trust_and_safety"],
    stepUp: true,
  },
  "breakglass.approve": {
    roles: ["platform_owner", "trust_and_safety"],
    stepUp: true,
  },
  "q.monitor.read": {
    roles: ["platform_owner", "operator", "analyst"],
    stepUp: false,
  },
  "q.trace.read": { roles: ["platform_owner", "operator"], stepUp: false },
  "audit.read": {
    roles: ["platform_owner", "operator", "trust_and_safety", "analyst"],
    stepUp: false,
  },
  "flags.read": { roles: ALL, stepUp: false },
  "flags.write": { roles: ["platform_owner", "operator"], stepUp: true },
  "email.read": { roles: ["platform_owner", "operator"], stepUp: false },
  "roles.manage": { roles: ["platform_owner"], stepUp: true },
  // BILLING block (ADR 0034): plans and limits per account, and the fee
  // ledger. Changing a plan or a limit is a write (step-up, audited); the
  // fee rate is the founder's alone.
  "billing.read": {
    roles: ["platform_owner", "operator", "support", "analyst"],
    stepUp: false,
  },
  "billing.write": { roles: ["platform_owner", "operator"], stepUp: true },
  "billing.fees.read": {
    roles: ["platform_owner", "operator", "analyst"],
    stepUp: false,
  },
  "billing.fees.accrue": {
    roles: ["platform_owner", "operator"],
    stepUp: true,
  },
  "billing.fees.rate": { roles: ["platform_owner"], stepUp: true },
  // end BILLING block
  // ADMIN-3 block: appeals Stage 4 (PADL #050). Support sees the queue;
  // a decision is a write (step-up, audited).
  "reviews.read": {
    roles: ["platform_owner", "operator", "trust_and_safety", "support"],
    stepUp: false,
  },
  "reviews.decide": { roles: OWNER_OPERATOR_TS, stepUp: true },
  // end ADMIN-3 block
  // P14: claims on companies nobody holds, and making such a company's
  // profile public at an external URL. Decisions and publishing are writes.
  "claims.read": {
    roles: ["platform_owner", "operator", "trust_and_safety", "support"],
    stepUp: false,
  },
  "claims.decide": { roles: OWNER_OPERATOR_TS, stepUp: true },
  "companies.publish": { roles: ["platform_owner", "operator"], stepUp: true },
} as const satisfies Record<
  string,
  { readonly roles: readonly AdminRole[]; readonly stepUp: boolean }
>;

export type AdminPermission = keyof typeof ADMIN_PERMISSIONS;

export const ADMIN_PERMISSION_NAMES = Object.keys(
  ADMIN_PERMISSIONS,
) as readonly AdminPermission[];

export function roleHolds(role: AdminRole, permission: AdminPermission) {
  return (ADMIN_PERMISSIONS[permission].roles as readonly AdminRole[]).includes(
    role,
  );
}

export function permissionNeedsStepUp(permission: AdminPermission): boolean {
  return ADMIN_PERMISSIONS[permission].stepUp;
}

export function permissionsOf(role: AdminRole): readonly AdminPermission[] {
  return ADMIN_PERMISSION_NAMES.filter((permission) =>
    roleHolds(role, permission),
  );
}

export function isAdminRole(value: unknown): value is AdminRole {
  return (
    typeof value === "string" &&
    (ADMIN_ROLES as readonly string[]).includes(value)
  );
}

/** How long a step-up lets an admin act (NIST 800-63B AAL3 idle bound). */
export const STEP_UP_MINUTES = 15;
/** How old the re-authentication may be when it is presented. */
export const STEP_UP_FRESHNESS_SECONDS = 120;
/** How long an approved break-glass lasts. */
export const BREAK_GLASS_MINUTES = 30;
