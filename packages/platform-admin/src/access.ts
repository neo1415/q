import { jsonbParam, type DatabaseExecutor } from "@capital-q/database";

import {
  isAdminRole,
  permissionNeedsStepUp,
  roleHolds,
  STEP_UP_FRESHNESS_SECONDS,
  STEP_UP_MINUTES,
  type AdminPermission,
  type AdminRole,
} from "./permissions.js";

/**
 * The one door into the console (ADR 0033). Every operation takes an
 * `AdminGrant`, and the only way to hold one is `authorize`: the role comes
 * from `identity.platform_admins`, the permission from the code table, the
 * step-up from `platform_ops.step_ups`. Nothing a client sends is read.
 */

declare const GRANT: unique symbol;

export type AdminGrant = {
  readonly userId: string;
  readonly role: AdminRole;
  readonly permission: AdminPermission;
  readonly stepUpId: string | null;
  readonly [GRANT]: true;
};

export type AdminAccess =
  /** Not an admin, or the role lacks the permission: the console does not exist. */
  | { readonly kind: "NOT_FOUND" }
  | { readonly kind: "STEP_UP_REQUIRED"; readonly role: AdminRole }
  | { readonly kind: "GRANTED"; readonly grant: AdminGrant };

export type AdminActionRecord = {
  readonly actionType: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly reason?: string | null | undefined;
  readonly breakGlassId?: string | null | undefined;
  readonly outcome?: "SUCCEEDED" | "DENIED" | "FAILED" | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
};

export async function roleOf(
  sql: DatabaseExecutor,
  userId: string,
): Promise<AdminRole | null> {
  const rows = await sql<{ role: string }[]>`
    select role from identity.platform_admins where user_id = ${userId}`;
  const role = rows[0]?.role;
  return isAdminRole(role) ? role : null;
}

export async function liveStepUp(
  sql: DatabaseExecutor,
  userId: string,
): Promise<{ readonly id: string; readonly expiresAt: string } | null> {
  const rows = await sql<{ id: string; expires_at: Date }[]>`
    select id, expires_at from platform_ops.step_ups
     where user_id = ${userId} and expires_at > clock_timestamp()
     order by expires_at desc limit 1`;
  const row = rows[0];
  return row === undefined
    ? null
    : { id: row.id, expiresAt: new Date(row.expires_at).toISOString() };
}

export async function authorize(
  sql: DatabaseExecutor,
  userId: string,
  permission: AdminPermission,
): Promise<AdminAccess> {
  const role = await roleOf(sql, userId);
  if (role === null || !roleHolds(role, permission)) {
    return { kind: "NOT_FOUND" };
  }
  let stepUpId: string | null = null;
  if (permissionNeedsStepUp(permission)) {
    const stepUp = await liveStepUp(sql, userId);
    if (stepUp === null) return { kind: "STEP_UP_REQUIRED", role };
    stepUpId = stepUp.id;
  }
  return {
    kind: "GRANTED",
    grant: { userId, role, permission, stepUpId } as AdminGrant,
  };
}

/** Appends one row to the console's audit. Call inside the action's transaction. */
export async function recordAdminAction(
  sql: DatabaseExecutor,
  grant: AdminGrant,
  action: AdminActionRecord,
): Promise<void> {
  await sql`
    insert into platform_ops.admin_actions
      (actor_user_id, actor_role, action_type, resource_type, resource_id,
       reason, step_up_id, break_glass_id, outcome, metadata)
    values (${grant.userId}, ${grant.role}, ${action.actionType},
            ${action.resourceType}, ${action.resourceId}, ${action.reason ?? null},
            ${grant.stepUpId}, ${action.breakGlassId ?? null},
            ${action.outcome ?? "SUCCEEDED"},
            ${jsonbParam(sql, action.metadata ?? {})})`;
}

// --- step-up ---------------------------------------------------------------

export const STEP_UP_METHODS = ["password", "otp", "totp"] as const;
export type StepUpMethod = (typeof STEP_UP_METHODS)[number];

/**
 * The newest qualifying authentication in a VERIFIED Supabase access
 * token's `amr` claim. The caller must have verified the token with the
 * Auth server first; this only reads what that server signed.
 */
export function freshAuthenticationOf(
  accessToken: string,
): { readonly method: StepUpMethod; readonly at: number } | null {
  const payload = accessToken.split(".")[1];
  if (payload === undefined) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof claims !== "object" || claims === null) return null;
  const amr = (claims as { amr?: unknown }).amr;
  if (!Array.isArray(amr)) return null;
  let best: { method: StepUpMethod; at: number } | null = null;
  for (const entry of amr as unknown[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const { method, timestamp } = entry as {
      method?: unknown;
      timestamp?: unknown;
    };
    if (
      typeof method !== "string" ||
      !(STEP_UP_METHODS as readonly string[]).includes(method) ||
      typeof timestamp !== "number"
    ) {
      continue;
    }
    if (best === null || timestamp > best.at) {
      best = { method: method as StepUpMethod, at: timestamp };
    }
  }
  return best;
}

export type StepUpOutcome =
  | { readonly kind: "NOT_FOUND" }
  | { readonly kind: "STALE" }
  | {
      readonly kind: "RECORDED";
      readonly stepUpId: string;
      readonly expiresAt: string;
    };

/**
 * Records a step-up for an admin whose fresh re-authentication (verified
 * by the caller for THIS person) happened at most two minutes ago.
 */
export async function recordStepUp(
  sql: DatabaseExecutor,
  input: {
    readonly userId: string;
    readonly freshAuthUserId: string;
    readonly authentication: {
      readonly method: StepUpMethod;
      readonly at: number;
    } | null;
    readonly nowSeconds?: number | undefined;
  },
): Promise<StepUpOutcome> {
  const role = await roleOf(sql, input.userId);
  if (role === null) return { kind: "NOT_FOUND" };
  const same = await sql<{ one: number }[]>`
    select 1 as one from identity.user_profiles
     where id = ${input.userId} and auth_user_id = ${input.freshAuthUserId}`;
  if (same.length === 0) return { kind: "STALE" };
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const auth = input.authentication;
  if (auth === null || now - auth.at > STEP_UP_FRESHNESS_SECONDS) {
    return { kind: "STALE" };
  }
  const rows = await sql<{ id: string; expires_at: Date }[]>`
    insert into platform_ops.step_ups (user_id, method, verified_at, expires_at)
    values (${input.userId}, ${auth.method}, clock_timestamp(),
            clock_timestamp() + make_interval(mins => ${STEP_UP_MINUTES}))
    returning id, expires_at`;
  const row = rows[0];
  if (row === undefined) return { kind: "STALE" };
  await sql`
    insert into platform_ops.admin_actions
      (actor_user_id, actor_role, action_type, resource_type, resource_id,
       step_up_id, outcome, metadata)
    values (${input.userId}, ${role}, 'admin.step_up.recorded', 'step_up',
            ${row.id}, ${row.id}, 'SUCCEEDED',
            ${jsonbParam(sql, { method: auth.method })})`;
  return {
    kind: "RECORDED",
    stepUpId: row.id,
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}
