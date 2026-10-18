import { randomUUID } from "node:crypto";

import { createPostgresMaterialActionAuditWriter } from "@capital-q/audit";
import { loadDatabaseConfig } from "@capital-q/config/database";
import { createEventRegistry, type CorrelationId } from "@capital-q/contracts";
import { createRequestDatabaseClient } from "@capital-q/database";
import { createOutboxWriter } from "@capital-q/eventing";
import { createPostgresOrganisationQueryPort } from "@capital-q/organisations";
import {
  AuthUserIdSchema,
  createAuthorizationService,
  resolveHumanActorContext,
} from "@capital-q/security";
import {
  createPostgresActorContextResolver,
  createPostgresAuthorizationPolicySource,
} from "@capital-q/security/postgres";

import { createCompanyService } from "../application/service.js";
import { CompanyIdSchema } from "../contracts/index.js";
import { COMPANY_EVENTS } from "../events/index.js";
import {
  assertSyntheticVerificationPermitted,
  createSyntheticVerificationClaimsPort,
} from "./synthetic-verification.js";

/**
 * Make the local development founder's company marketplace-ready through
 * the real assessment (CQ-MKT-001 §12).
 *
 *   pnpm dev:marketplace-ready [--company <uuid>]
 *
 * Runs against the LOCAL Supabase stack only: the synthetic verification
 * seam refuses any other host or environment before a connection is made.
 * Everything else is the production path — the founder's own actor context,
 * `company.edit` on the exact company, the readiness policy, the audited
 * transition and the outbox event — so what the Recommendation wave then
 * sees is a company the domain itself declared ready, with
 * `verificationSource = SYNTHETIC_LOCAL_FIXTURE` on the audit row saying
 * exactly how. Nothing here is reachable from a browser or an API.
 *
 * The founder must have chosen "visible to investors" first (F10); this
 * script does not and will not flip that choice.
 */

const DEV_FOUNDER_EMAIL = "dev-founder@capitalq.local";
const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<number> {
  const config = loadDatabaseConfig();
  assertSyntheticVerificationPermitted({
    environment: process.env["CAPITAL_Q_ENV"],
    databaseUrl: config.secrets.url,
  });
  const database = createRequestDatabaseClient(config);
  try {
    const { sql } = database;
    const [user] = await sql<
      { id: string; auth_user_id: string }[]
    >`select p.id, p.auth_user_id
        from identity.user_profiles p
        join auth.users u on u.id = p.auth_user_id
       where u.email = ${DEV_FOUNDER_EMAIL}`;
    if (user === undefined) {
      console.error(`no ${DEV_FOUNDER_EMAIL}; run pnpm dev:bootstrap first`);
      return 2;
    }
    const requested = argument("--company");
    const [company] = await sql<{ id: string }[]>`select c.id
        from core.companies c
        join identity.organisation_memberships m on m.organisation_id = c.organisation_id
       where m.user_id = ${user.id}
         and (${requested ?? null}::uuid is null or c.id = ${requested ?? null}::uuid)
       order by c.created_at
       limit 1`;
    if (company === undefined) {
      console.error(
        "the dev founder has no company yet; finish onboarding first",
      );
      return 2;
    }

    const resolution = await resolveHumanActorContext(
      createPostgresActorContextResolver({ sql }),
      { principal: { authUserId: AuthUserIdSchema.parse(user.auth_user_id) } },
    );
    if (resolution.status !== "RESOLVED") {
      console.error(`actor context not resolved: ${resolution.status}`);
      return 2;
    }

    const service = createCompanyService({
      sql,
      transactions: database.transactions,
      authorization: createAuthorizationService(
        createPostgresAuthorizationPolicySource({ sql }),
      ),
      organisations: createPostgresOrganisationQueryPort({ sql }),
      outbox: createOutboxWriter({
        registry: createEventRegistry([...COMPANY_EVENTS]),
      }),
      audit: createPostgresMaterialActionAuditWriter(),
      verification: createSyntheticVerificationClaimsPort({
        environment: process.env["CAPITAL_Q_ENV"],
        databaseUrl: config.secrets.url,
        verifiedCompanyIds: [company.id],
      }),
    });

    const assessment = await service.assessMarketplaceReadiness({
      actor: resolution.context,
      companyId: CompanyIdSchema.parse(company.id),
      correlationId: CORRELATION(),
    });
    console.log(`company ${company.id}`);
    console.log(`policy  ${assessment.policyVersion}`);
    console.log(`state   ${assessment.state}`);
    for (const requirement of assessment.requirements) {
      console.log(
        `  ${requirement.requirement.padEnd(32)} ${requirement.outcome}`,
      );
    }
    if (assessment.state !== "marketplace_ready") {
      console.log(
        "not ready: satisfy the outstanding requirements above (visibility is the founder's own choice at /company/visibility) and run again",
      );
      return 1;
    }
    console.log("verification source: SYNTHETIC_LOCAL_FIXTURE (local only)");
    return 0;
  } finally {
    await database.close();
  }
}

process.exitCode = await main();
