/* eslint-disable no-console -- a developer CLI whose whole purpose is to print what was recorded */
import { randomUUID } from "node:crypto";
import process from "node:process";

import { loadDatabaseConfig } from "@capital-q/config/database";
import { parseQApiConfig } from "@capital-q/config/q-api";
import { CorrelationIdSchema } from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type TransactionContext,
  type TransactionManager,
} from "@capital-q/database";
import {
  createModelGateway,
  createModelProviderRegistry,
  createPostgresModelCatalog,
  createPostgresModelUsageRepository,
  createProcessLocalProviderHealth,
  type ModelProvider,
} from "@capital-q/model-gateway";
import { createGoogleModelProvider } from "@capital-q/model-gateway/providers/google";
import { createGroqModelProvider } from "@capital-q/model-gateway/providers/groq";
import { createLogger } from "@capital-q/observability";
import { createPostgresInvestorOrganisationQueryPort } from "@capital-q/investors";
import {
  AuthUserIdSchema,
  createAuthorizationService,
  resolveHumanActorContext,
  type AuthenticatedPrincipal,
} from "@capital-q/security";
import {
  createPostgresActorContextResolver,
  createPostgresAuthorizationPolicySource,
} from "@capital-q/security/postgres";

import { composePresence } from "../composition/presence.js";
import { composeResearch } from "../composition/research.js";

/**
 * Public presence smoke (CQ-Q-PRESENCE-001).
 *
 * A synthetic tenant, organisation and company, then one real build
 * through the whole packet: the public web in parallel, each page
 * registered as evidence, a model reading the excerpts, the Knowledge
 * Write Gate deciding what is held, and the build log recording it.
 *
 * Everything is created inside one transaction that is rolled back, so it
 * leaves nothing behind. It does spend real search and model quota, which
 * is why it is a script and not a test.
 *
 *   pnpm presence:smoke
 *   pnpm presence:smoke -- "Paystack" https://paystack.com
 */

const logger = createLogger({
  serviceName: "presence-smoke",
  environment: "local",
});

function nestedTransactions(tx: TransactionContext): TransactionManager {
  return {
    run: async (work) => {
      const { value } = await tx.sql.savepoint(async (inner) => ({
        value: await work({ sql: inner }),
      }));
      return value;
    },
  };
}

export async function runPresenceSmoke(argv: readonly string[]): Promise<void> {
  const name = argv[0] ?? "Paystack";
  const website = argv[1] ?? "https://paystack.com";
  const config = parseQApiConfig(process.env);
  const database = createRequestDatabaseClient(loadDatabaseConfig());

  try {
    await database.transactions.run(async (tx) => {
      const sql = tx.sql;
      const tenantId = randomUUID();
      const orgId = randomUUID();
      const companyId = randomUUID();
      const authUserId = randomUUID();

      await sql`insert into identity.tenants (id, name) values (${tenantId}, 'Presence smoke tenant')`;
      await sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
        values (${orgId}, ${tenantId}, 'company', 'Presence smoke org', ${`pres-org-${orgId.slice(0, 8)}`})`;
      await sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantId}, ${orgId})`;
      await sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, website_url)
        values (${companyId}, ${tenantId}, ${orgId}, ${name}, ${`pres-co-${companyId.slice(0, 8)}`}, ${website})`;
      await sql`insert into auth.users (id) values (${authUserId})`;
      const [profile] = await sql<
        { id: string }[]
      >`select id from identity.user_profiles where auth_user_id = ${authUserId}`;
      if (profile === undefined) {
        throw new Error("profile trigger did not run");
      }
      const membershipId = randomUUID();
      await sql`insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id)
        values (${membershipId}, ${tenantId}, ${orgId}, ${profile.id})`;
      await sql`insert into identity.membership_roles (membership_id, role_id)
        select ${membershipId}, r.id from permissions.roles r where r.code = 'organisation_admin'`;
      await sql`insert into identity.user_active_contexts (user_id, membership_id) values (${profile.id}, ${membershipId})`;

      const principal: AuthenticatedPrincipal = {
        authUserId: AuthUserIdSchema.parse(authUserId),
      };
      const resolution = await resolveHumanActorContext(
        createPostgresActorContextResolver({ sql }),
        { principal },
      );
      if (resolution.status !== "RESOLVED") {
        throw new Error(`actor context not resolved: ${resolution.status}`);
      }
      const actor = resolution.context;

      const authorization = createAuthorizationService(
        createPostgresAuthorizationPolicySource({ sql }),
      );
      const providers: ModelProvider[] = [];
      if (config.secrets.modelProviders.google !== undefined) {
        providers.push(
          createGoogleModelProvider({
            apiKey: config.secrets.modelProviders.google.reveal(),
          }),
        );
      }
      if (config.secrets.modelProviders.groq !== undefined) {
        providers.push(
          createGroqModelProvider({
            apiKey: config.secrets.modelProviders.groq.reveal(),
            additionalApiKeys: config.secrets.modelProviders.groqKeys
              .slice(1)
              .map((key) => key.reveal()),
          }),
        );
      }
      const gateway = createModelGateway({
        catalog: createPostgresModelCatalog({ sql: database.sql }),
        registry: createModelProviderRegistry(providers),
        usage: createPostgresModelUsageRepository({ sql: database.sql }),
        health: createProcessLocalProviderHealth(),
        logger,
      });

      const research = composeResearch({
        sql,
        transactions: nestedTransactions(tx),
        authorization,
        investorQueries: createPostgresInvestorOrganisationQueryPort({ sql }),
        secrets: config.secrets.researchProviders,
        logger,
      });
      const presence = composePresence({
        sql,
        evidence: research.evidence,
        gateway,
        gate: research.gate,
        ...(research.research === undefined
          ? {}
          : { research: research.research }),
        ...(research.profiles === undefined
          ? {}
          : { profiles: research.profiles }),
        logger,
      });
      if (presence === undefined) {
        console.log(
          "[presence] no research provider configured; nothing to read.",
        );
        return;
      }

      const startedAt = Date.now();
      const outcome = await presence.presence.build({
        actor,
        subject: { subjectType: "COMPANY", subjectId: companyId },
        identity: {
          name,
          websiteUrl: website,
          profileUrl: null,
          qualifier: null,
        },
        correlationId: CorrelationIdSchema.parse(`cor_${randomUUID()}`),
      });
      console.log(
        `[presence] ${JSON.stringify(outcome)} in ${String(
          Math.round((Date.now() - startedAt) / 100) / 10,
        )}s`,
      );

      // What was actually held, read back from the store. Statements are
      // printed because this is a developer's own synthetic company.
      const sources = await sql<
        { source_url: string | null }[]
      >`select source_url from evidence.sources
         where tenant_id = ${tenantId} and subject_id = ${companyId}`;
      console.log(`[presence] sources recorded: ${String(sources.length)}`);
      for (const source of sources) {
        console.log(`  - ${source.source_url ?? "(no url)"}`);
      }
      const objects = await sql<
        { knowledge_key: string; statement: string; status: string }[]
      >`select knowledge_key, statement, status from q_knowledge.objects
         where tenant_id = ${tenantId} and subject_id = ${companyId}
         order by knowledge_key`;
      console.log(`[presence] understandings: ${String(objects.length)}`);
      for (const object of objects) {
        console.log(`  - [${object.status}] ${object.knowledge_key}`);
        console.log(`      ${object.statement}`);
      }
      const builds = await sql<
        { status: string; source_count: number; understanding_count: number }[]
      >`select status, source_count, understanding_count
          from q_knowledge.presence_builds
         where tenant_id = ${tenantId}`;
      console.log(`[presence] build log: ${JSON.stringify(builds)}`);

      // Nothing is kept: this was a synthetic company.
      throw new RollbackSignal();
    });
  } catch (error: unknown) {
    if (!(error instanceof RollbackSignal)) {
      throw error;
    }
    console.log("[presence] rolled back; nothing was kept.");
  } finally {
    await database.close();
  }
}

class RollbackSignal extends Error {
  constructor() {
    super("rollback");
    this.name = "RollbackSignal";
  }
}
