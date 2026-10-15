import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
} from "@capital-q/database";
import {
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import {
  createArtifactService,
  createPostgresArtifactRepository,
  createPostgresDocumentJobRepository,
} from "../src/index.js";
import type { PermittedContextPlan } from "@capital-q/contracts";

/**
 * The artifact tables against real PostgreSQL (`pnpm db:start`), run with
 * `pnpm test:integration`.
 *
 * The in-memory test beside this one can only prove the service passes the
 * actor along. What has to be true in SQL, and is asserted here: an
 * artifact belonging to another tenant or another organisation is never
 * selected, so "not yours" and "not found" are the same answer; and the
 * unique constraint on (artifact_id, version), not application code, is
 * what stops two revisions claiming the same number.
 *
 * Every test builds its own synthetic tenants inside a transaction that is
 * rolled back.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

class Rollback extends Error {}

type Party = {
  readonly actor: ActorContext;
  readonly tenantId: string;
  readonly organisationId: string;
  readonly userId: string;
};

async function createParty(
  tx: TransactionContext,
  slug: string,
): Promise<Party> {
  const { sql } = tx;
  const authId = randomUUID();
  await sql`insert into auth.users (id) values (${authId})`;
  const [profile] = await sql<{ id: string }[]>`
    select id from identity.user_profiles where auth_user_id = ${authId}`;
  const userId = profile?.id ?? "";
  const tenantId = randomUUID();
  const organisationId = randomUUID();
  const membershipId = randomUUID();
  await sql`insert into identity.tenants (id, name) values (${tenantId}, ${`Artifacts ${slug}`})`;
  await sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
    values (${organisationId}, ${tenantId}, 'company', ${`Org ${slug}`}, ${`artifacts-${slug}`})`;
  await sql`insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id)
    values (${membershipId}, ${tenantId}, ${organisationId}, ${userId})`;
  return {
    tenantId,
    organisationId,
    userId,
    actor: {
      userId: UserIdSchema.parse(userId),
      tenantId: TenantIdSchema.parse(tenantId),
      organisationId: OrganisationIdSchema.parse(organisationId),
      membershipId: MembershipIdSchema.parse(membershipId),
      actorType: "HUMAN",
    },
  };
}

const CONTENT = {
  sections: [
    { heading: "Business", body: "What the record supports.", findings: [] },
  ],
  gaps: ["Traction"],
};

describe("@capital-q/q-artifacts against local Supabase Postgres", () => {
  let db: RequestDatabase;

  beforeAll(() => {
    db = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_POOL_MAX: "3",
        DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
      }),
    );
  });

  afterAll(async () => {
    await db.close();
  });

  async function rolledBack(
    work: (tx: TransactionContext) => Promise<void>,
  ): Promise<void> {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        await work(tx);
        completed = true;
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    expect(completed).toBe(true);
  }

  it("two independent transactions claim one artifact and enqueue one worker job", async () => {
    const jobId = randomUUID();
    const runId = randomUUID();
    const party = await db.transactions.run(async (tx) => {
      const mine = await createParty(
        tx,
        `workforce-race-${randomUUID().slice(0, 8)}`,
      );
      await tx.sql`insert into q_runtime.workforce_jobs
        (id, tenant_id, user_id, source_kind, goal, rubric_version)
        values (${jobId}, ${mine.tenantId}, ${mine.userId}, 'JOB', 'Prepare a memo', 'workforce-rubric/v1')`;
      return mine;
    });
    try {
      const repository = createPostgresArtifactRepository({ sql: db.sql });
      const jobs = createPostgresDocumentJobRepository({ sql: db.sql });
      let entered = 0;
      let release: () => void = () => undefined;
      const bothEntered = new Promise<void>((resolve) => {
        release = resolve;
      });
      const service = createArtifactService({
        repository: {
          ...repository,
          createForWorkforce: (tx, artifact, binding) => {
            if (++entered === 2) release();
            if (repository.createForWorkforce === undefined)
              throw new Error("Missing replay adapter");
            return repository.createForWorkforce(tx, artifact, binding);
          },
        },
        transactions: db.transactions,
        jobs: {
          ...jobs,
          enqueue: async (tx, job) => {
            // Hold the winning transaction until the competing request
            // actually enters the repository, rather than sequentially
            // calling the service and labelling that a race.
            await bothEntered;
            await jobs.enqueue(tx, job);
          },
        },
      });
      const input = {
        actorContext: party.actor,
        qRunId: runId,
        permittedContextPlan: {
          runId,
          tenantId: party.tenantId,
          actor: { userId: party.userId, organisationId: party.organisationId },
          subjects: [],
          revalidateAfter: "2099-01-01T00:00:00.000Z",
        } as unknown as PermittedContextPlan,
        artifactType: "MEMO",
        kind: "MEMO" as const,
        content: {
          title: "Memo",
          summary: "From the record.",
          content: CONTENT,
        },
        job: {
          grounding: [],
          sectorCodes: [],
          directionChosen: false,
          brand: null,
          sensitivity: "INTERNAL" as const,
        },
        workforce: { jobId, stepKey: "memo", intentSha256: "a".repeat(64) },
      };
      const [first, second] = await Promise.all([
        service.requestDocument(input),
        service.requestDocument(input),
      ]);
      expect(first.artifact.artifactId).toBe(second.artifact.artifactId);
      const artifacts =
        await db.sql`select id from artifacts.artifacts where workforce_job_id = ${jobId}`;
      expect(artifacts).toHaveLength(1);
      const enqueued =
        await db.sql`select id from artifacts.document_jobs where artifact_id = ${first.artifact.artifactId}`;
      expect(enqueued).toHaveLength(1);
      // A crash after this transaction but before recording the workforce
      // result must recover this identity, not create a second document.
      expect((await service.requestDocument(input)).artifact.artifactId).toBe(
        first.artifact.artifactId,
      );
    } finally {
      await db.transactions.run(async (tx) => {
        await tx.sql`delete from artifacts.document_jobs where artifact_id in
          (select id from artifacts.artifacts where workforce_job_id = ${jobId})`;
        await tx.sql`delete from artifacts.artifacts where workforce_job_id = ${jobId}`;
        await tx.sql`delete from q_runtime.workforce_jobs where id = ${jobId}`;
        await tx.sql`delete from identity.organisation_memberships where organisation_id = ${party.organisationId}`;
        await tx.sql`delete from identity.organisations where id = ${party.organisationId}`;
        await tx.sql`delete from identity.tenants where id = ${party.tenantId}`;
        await tx.sql`delete from auth.users where id =
          (select auth_user_id from identity.user_profiles where id = ${party.userId})`;
      });
    }
  });

  it("never selects an artifact belonging to another tenant or organisation", async () => {
    await rolledBack(async (tx) => {
      // The repository reads outside the transaction by design, so for
      // this test both reads and writes go through the transaction's own
      // executor: what is under test is the `where` clause, not pooling.
      const repository = createPostgresArtifactRepository({ sql: tx.sql });
      const mine = await createParty(tx, `mine-${randomUUID().slice(0, 8)}`);
      const stranger = await createParty(
        tx,
        `other-${randomUUID().slice(0, 8)}`,
      );

      const artifact = await repository.create(tx, {
        tenantId: mine.tenantId,
        organisationId: mine.organisationId,
        type: "INVESTMENT_BRIEF",
        companyId: null,
        investorOrganisationId: null,
        createdByUserId: mine.userId,
      });
      const version = await repository.appendVersion(tx, {
        artifactId: artifact.id,
        tenantId: mine.tenantId,
        version: 1,
        title: "Investment brief",
        summary: "What the record supports.",
        content: CONTENT,
        instruction: null,
        composedByRunId: null,
        createdByUserId: mine.userId,
      });
      expect(version?.version).toBe(1);

      // Mine.
      expect(await repository.findById(mine.actor, artifact.id)).not.toBeNull();
      expect(
        await repository.findVersion(mine.actor, artifact.id, 1),
      ).not.toBeNull();
      expect(await repository.history(mine.actor, artifact.id)).toHaveLength(1);
      expect(await repository.list(mine.actor, { limit: 20 })).toHaveLength(1);

      // Another tenant's, which is to say nobody's.
      expect(await repository.findById(stranger.actor, artifact.id)).toBeNull();
      expect(
        await repository.findVersion(stranger.actor, artifact.id, 1),
      ).toBeNull();
      expect(await repository.history(stranger.actor, artifact.id)).toEqual([]);
      expect(await repository.list(stranger.actor, { limit: 20 })).toEqual([]);

      // And the same tenant under a different organisation: ownership is
      // the organisation's, not the tenant's.
      const sibling = await createParty(
        tx,
        `sibling-${randomUUID().slice(0, 8)}`,
      );
      const crossOrganisation: ActorContext = {
        ...mine.actor,
        organisationId: OrganisationIdSchema.parse(sibling.organisationId),
      };
      expect(
        await repository.findById(crossOrganisation, artifact.id),
      ).toBeNull();
    });
  });

  it("lets the database decide a version race, and never overwrites the version that won", async () => {
    await rolledBack(async (tx) => {
      const repository = createPostgresArtifactRepository({ sql: tx.sql });
      const mine = await createParty(tx, `race-${randomUUID().slice(0, 8)}`);
      const artifact = await repository.create(tx, {
        tenantId: mine.tenantId,
        organisationId: mine.organisationId,
        type: "INVESTMENT_BRIEF",
        companyId: null,
        investorOrganisationId: null,
        createdByUserId: mine.userId,
      });
      const write = (version: number, title: string) =>
        repository.appendVersion(tx, {
          artifactId: artifact.id,
          tenantId: mine.tenantId,
          version,
          title,
          summary: "s",
          content: CONTENT,
          instruction: null,
          composedByRunId: null,
          createdByUserId: mine.userId,
        });

      expect((await write(1, "First"))?.title).toBe("First");
      // The same number twice: refused, rather than silently replacing.
      expect(await write(1, "Overwrite")).toBeNull();
      const kept = await repository.findVersion(mine.actor, artifact.id, 1);
      expect(kept?.title).toBe("First");

      expect((await write(2, "Second"))?.version).toBe(2);
      const moved = await repository.findById(mine.actor, artifact.id);
      expect(moved?.currentVersion).toBe(2);

      // History is newest first and carries no content.
      const history = await repository.history(mine.actor, artifact.id);
      expect(history.map((entry) => entry.version)).toEqual([2, 1]);
    });
  });

  it("stores and returns the content through the public contract, gaps and all", async () => {
    await rolledBack(async (tx) => {
      const repository = createPostgresArtifactRepository({ sql: tx.sql });
      const mine = await createParty(tx, `content-${randomUUID().slice(0, 8)}`);
      const artifact = await repository.create(tx, {
        tenantId: mine.tenantId,
        organisationId: mine.organisationId,
        type: "INVESTMENT_BRIEF",
        companyId: null,
        investorOrganisationId: null,
        createdByUserId: mine.userId,
      });
      await repository.appendVersion(tx, {
        artifactId: artifact.id,
        tenantId: mine.tenantId,
        version: 1,
        title: "Investment brief",
        summary: "What the record supports.",
        content: CONTENT,
        instruction: null,
        composedByRunId: null,
        createdByUserId: mine.userId,
      });
      const read = await repository.findVersion(mine.actor, artifact.id, 1);
      expect(read?.content).toEqual(CONTENT);
      // Unknown stays unknown: the gap is stored as a gap, not as a zero.
      expect(read?.content.gaps).toEqual(["Traction"]);
      expect(artifact.status).toBe("PREPARING");
      expect(artifact.visibilityScope).toBe("organisation_private");
    });
  });
});
