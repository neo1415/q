import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";

import { resolveHumanActorContext } from "../src/actor-context/resolver.js";
import { AuthUserIdSchema, OrganisationIdSchema } from "../src/identity/ids.js";
import type { AuthenticatedPrincipal } from "../src/identity/principal.js";
import { createPostgresActorContextResolver } from "../src/postgres/actor-context-resolver.js";
import { createPostgresApplicationIdentityLookup } from "../src/postgres/application-identity.js";
import { createSupabaseAccessTokenAuthenticator } from "../src/supabase/access-token-authenticator.js";

/**
 * Real local Supabase (`pnpm db:start`), run with `pnpm test:integration`.
 *
 * End to end through the real provider: a synthetic account is created with
 * GoTrue, its access token is verified by the authenticator, the CQ-DATA-002
 * trigger's profile is read back, and the ActorContext resolver is driven
 * through no-membership, active-membership and revoked-membership states.
 *
 * The auth user must be committed for GoTrue to issue a session, so this
 * suite cannot run inside a rolled-back transaction; it creates uniquely
 * named rows and removes them in afterAll.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const SUPABASE_URL =
  process.env["CQ_TEST_SUPABASE_URL"] ?? "http://127.0.0.1:54321";
// The Supabase CLI's fixed local publishable key: public by design, identical
// for every local project, and useless against anything but a local stack.
const PUBLISHABLE_KEY =
  process.env["CQ_TEST_SUPABASE_PUBLISHABLE_KEY"] ??
  "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

const PASSWORD = "synthetic-integration-passphrase";

describe("Supabase authentication -> canonical identity -> ActorContext", () => {
  let db: RequestDatabase;
  let email: string;
  let authUserId: string;
  let accessToken: string;
  let principal: AuthenticatedPrincipal;
  const created = { tenantId: "", orgId: "", membershipId: "", userId: "" };

  const authenticator = createSupabaseAccessTokenAuthenticator({
    url: SUPABASE_URL,
    publishableKey: PUBLISHABLE_KEY,
  });

  const supabase = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  beforeAll(async () => {
    db = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_POOL_MAX: "2",
        DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
      }),
    );

    email = `auth-int-${randomUUID()}@example.invalid`;
    const { data, error } = await supabase.auth.signUp({
      email,
      password: PASSWORD,
    });
    if (error !== null || data.user === null) {
      throw new Error(`local sign-up failed: ${error?.message ?? "no user"}`);
    }
    if (data.session === null) {
      throw new Error(
        "local sign-up returned no session; supabase/config.toml must keep auth.email.enable_confirmations = false for this suite",
      );
    }
    authUserId = data.user.id;
    accessToken = data.session.access_token;
    principal = { authUserId: AuthUserIdSchema.parse(authUserId) };
  });

  afterAll(async () => {
    const { sql } = db;
    // Reverse dependency order; every statement is scoped to this suite's rows.
    if (created.userId !== "") {
      await sql`delete from identity.user_active_contexts where user_id = ${created.userId}`;
      await sql`delete from identity.organisation_memberships where user_id = ${created.userId}`;
    }
    if (created.tenantId !== "") {
      await sql`delete from identity.tenant_organisations where tenant_id = ${created.tenantId}`;
      await sql`delete from identity.organisations where tenant_id = ${created.tenantId}`;
      await sql`delete from identity.tenants where id = ${created.tenantId}`;
    }
    await sql`delete from identity.user_profiles where auth_user_id = ${authUserId}`;
    await sql`delete from auth.users where id = ${authUserId}`;
    await db.close();
  });

  it("signup created exactly one Person, distinct from the auth subject, with no organisation authority", async () => {
    const profiles = await db.sql<{ id: string; status: string }[]>`
      select id, status from identity.user_profiles where auth_user_id = ${authUserId}`;
    expect(profiles).toHaveLength(1);
    const profile = profiles[0];
    if (profile === undefined) {
      throw new Error("unreachable");
    }
    created.userId = profile.id;
    expect(profile.status).toBe("active");
    expect(profile.id).not.toBe(authUserId);

    const [memberships] = await db.sql<{ count: number }[]>`
      select count(*)::int as count from identity.organisation_memberships where user_id = ${profile.id}`;
    expect(memberships?.count).toBe(0);
    const [grants] = await db.sql<{ count: number }[]>`
      select count(*)::int as count from permissions.grants where principal_type = 'user' and principal_id = ${profile.id}`;
    expect(grants?.count).toBe(0);
  });

  it("verifies the real access token into the principal, and only that token", async () => {
    await expect(authenticator.authenticate(accessToken)).resolves.toEqual(
      principal,
    );

    // Tamper with the signature: same header and claims, one signature
    // character changed. Not the last character: its low bits are base64url
    // padding that a lenient decoder ignores, which made the old check flaky.
    const index = accessToken.length - 2;
    const original = accessToken.charAt(index);
    const tampered =
      accessToken.slice(0, index) +
      (original === "a" ? "b" : "a") +
      accessToken.slice(index + 1);
    await expect(authenticator.authenticate(tampered)).resolves.toBeNull();

    // A structurally valid but unrelated token.
    await expect(
      authenticator.authenticate("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln"),
    ).resolves.toBeNull();
  });

  it("wrong credentials yield no session", async () => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password: `${PASSWORD}-wrong`,
    });
    expect(error).not.toBeNull();
    expect(data.session).toBeNull();
  });

  it("a Person with no membership is authenticated and CONTEXT_REQUIRED, never denied", async () => {
    const identities = createPostgresApplicationIdentityLookup({ sql: db.sql });
    const identity = await identities.lookup(principal);
    expect(identity?.userId).toBe(created.userId);

    const resolver = createPostgresActorContextResolver({ sql: db.sql });
    await expect(
      resolveHumanActorContext(resolver, { principal }),
    ).resolves.toEqual({ status: "CONTEXT_REQUIRED" });
  });

  it("with an active membership and persisted context the ActorContext resolves from the database", async () => {
    const { sql } = db;
    created.tenantId = randomUUID();
    created.orgId = randomUUID();
    created.membershipId = randomUUID();
    const slug = `auth-int-${created.orgId.slice(0, 8)}`;
    await sql`insert into identity.tenants (id, name) values (${created.tenantId}, 'Auth integration tenant')`;
    await sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
      values (${created.orgId}, ${created.tenantId}, 'company', 'Auth integration org', ${slug})`;
    await sql`insert into identity.tenant_organisations (tenant_id, organisation_id)
      values (${created.tenantId}, ${created.orgId})`;
    await sql`insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id, primary_business_title)
      values (${created.membershipId}, ${created.tenantId}, ${created.orgId}, ${created.userId}, 'Founder')`;
    await sql`insert into identity.user_active_contexts (user_id, membership_id)
      values (${created.userId}, ${created.membershipId})`;

    const resolver = createPostgresActorContextResolver({ sql });
    const resolution = await resolveHumanActorContext(resolver, { principal });
    expect(resolution.status).toBe("RESOLVED");
    if (resolution.status !== "RESOLVED") {
      return;
    }
    expect(resolution.context).toEqual({
      userId: created.userId,
      tenantId: created.tenantId,
      organisationId: created.orgId,
      membershipId: created.membershipId,
      actorType: "HUMAN",
    });

    // An explicit selector for an organisation this person does not belong to
    // is refused, and refused identically to one that does not exist.
    await expect(
      resolveHumanActorContext(resolver, {
        principal,
        selection: { organisationId: OrganisationIdSchema.parse(randomUUID()) },
      }),
    ).resolves.toEqual({ status: "CONTEXT_NOT_ACCESSIBLE" });
  });

  it("after revocation the session still authenticates but organisation context no longer resolves", async () => {
    const { sql } = db;
    await sql`update identity.organisation_memberships
      set membership_status = 'revoked', left_at = now()
      where id = ${created.membershipId}`;

    await expect(authenticator.authenticate(accessToken)).resolves.toEqual(
      principal,
    );

    const resolver = createPostgresActorContextResolver({ sql });
    await expect(
      resolveHumanActorContext(resolver, { principal }),
    ).resolves.toEqual({ status: "CONTEXT_REQUIRED" });
    await expect(
      resolveHumanActorContext(resolver, {
        principal,
        selection: {
          organisationId: OrganisationIdSchema.parse(created.orgId),
        },
      }),
    ).resolves.toEqual({ status: "CONTEXT_NOT_ACCESSIBLE" });
  });
});
