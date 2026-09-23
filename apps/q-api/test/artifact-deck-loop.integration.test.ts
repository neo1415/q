import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import type {
  PermittedContextPlan,
  QArtifactDetail,
  QSubjectRef,
} from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
  type TransactionManager,
} from "@capital-q/database";
import { deckToPdf, deckToPptx, layOutDeck } from "@capital-q/deck-render";
import {
  createArtifactService,
  createPostgresArtifactRepository,
} from "@capital-q/q-artifacts";
import { composePitchDeck } from "@capital-q/q-specialists";
import {
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

/**
 * The whole artifact loop against real PostgreSQL (`pnpm db:start`), run
 * with `pnpm test:integration`.
 *
 * Every part of this existed separately and the join had never been made:
 * the local database holds eight Q runs and, before this packet, zero
 * artifacts, so nothing had ever proved that a deck Q composed survives
 * being written down. The unit tests beside this one use a fake
 * repository and a fake service, which can only prove that arguments are
 * passed along.
 *
 * What is proved here, in order, and nothing is stubbed between them:
 *
 *   1. `composePitchDeck` turns findings into slides — the same composer
 *      the answer seam calls, with no model in the path;
 *   2. the artifact application service writes the artifact and its first
 *      version to `artifacts.artifacts` and `artifacts.artifact_versions`;
 *   3. a SECOND service, built over a second repository, reads it back —
 *      which is what a refresh is: nothing in memory carries over, so
 *      what comes back came out of Postgres;
 *   4. `layOutDeck` and the writers turn what came back into a real PPTX
 *      and a real PDF, checked by their magic bytes rather than by the
 *      content type somebody hoped for;
 *   5. the words on the slides are the composed findings' words.
 *
 * It also pins the thing the product must never do: a dimension the
 * record says nothing about becomes a named gap, not a confident slide.
 *
 * Every row is created inside a transaction that is rolled back, so this
 * leaves the shared local database exactly as it found it.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

class Rollback extends Error {}

type Party = {
  readonly actor: ActorContext;
  readonly companyId: string;
};

/**
 * A tenant, an organisation, a person in it and a company it owns.
 *
 * Synthetic and short-lived. The slug carries this workstream's prefix so
 * a row that somehow escaped the rollback is attributable at a glance.
 */
async function createParty(tx: TransactionContext): Promise<Party> {
  const { sql } = tx;
  const slug = `d-actions-${randomUUID().slice(0, 8)}`;
  const authId = randomUUID();
  await sql`insert into auth.users (id) values (${authId})`;
  const [profile] = await sql<{ id: string }[]>`
    select id from identity.user_profiles where auth_user_id = ${authId}`;
  const userId = profile?.id ?? "";
  const tenantId = randomUUID();
  const organisationId = randomUUID();
  const membershipId = randomUUID();
  const companyId = randomUUID();
  await sql`insert into identity.tenants (id, name) values (${tenantId}, ${`Deck ${slug}`})`;
  await sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
    values (${organisationId}, ${tenantId}, 'company', ${`Org ${slug}`}, ${slug})`;
  await sql`insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id)
    values (${membershipId}, ${tenantId}, ${organisationId}, ${userId})`;
  await sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
    values (${companyId}, ${tenantId}, ${organisationId}, ${"Northstar Logistics"}, ${slug})`;
  return {
    companyId,
    actor: {
      userId: UserIdSchema.parse(userId),
      tenantId: TenantIdSchema.parse(tenantId),
      organisationId: OrganisationIdSchema.parse(organisationId),
      membershipId: MembershipIdSchema.parse(membershipId),
      actorType: "HUMAN",
    },
  };
}

/** Findings as the company specialist produces them, with one gap left. */
function findings(companyId: string) {
  let sequence = 0;
  const finding = (
    dimension: string,
    statement: string,
    truthClass: "USER_CLAIM" | "VERIFIED" = "USER_CLAIM",
  ) => {
    sequence += 1;
    return {
      findingId: `a0000000-0000-4000-8000-0000000000${String(sequence).padStart(2, "0")}`,
      type: "FACT",
      statement,
      truthClass,
      evidenceStatus:
        truthClass === "VERIFIED" ? "DOCUMENT_SUPPORTED" : "SELF_REPORTED",
      confidence: "MODERATE",
      subjects: [{ kind: "COMPANY", companyId }],
      evidenceRefs: [],
      dimension,
      derivation: "MODEL",
    };
  };
  return {
    companyId,
    specialistVersion: "company-intelligence/v1",
    asOf: new Date().toISOString(),
    blocked: null,
    artifactRequest: null,
    uncertainties: [],
    contradictions: [],
    userStatements: [],
    // Deliberately nothing under FINANCIAL: the deck must name the gap
    // rather than fill the slide.
    findings: [
      finding(
        "DESCRIPTION",
        "The company is named Northstar Logistics and moves freight between Lagos, Abuja and Kano.",
      ),
      finding(
        "PRODUCT",
        "It sells spare capacity on trucks that are already running.",
      ),
      finding("MARKET", "Nigerian road freight between three northern cities."),
      finding(
        "TRACTION",
        "Forty shippers used the platform in the last quarter.",
        "VERIFIED",
      ),
    ],
  } as unknown as Parameters<typeof composePitchDeck>[0]["result"];
}

function planFor(
  actor: ActorContext,
  runId: string,
  subject: QSubjectRef,
): PermittedContextPlan {
  return {
    contractVersion: 1,
    policyVersion: 1,
    planId: randomUUID(),
    fingerprint: "0".repeat(64),
    runId,
    tenantId: actor.tenantId,
    actor: { userId: actor.userId, organisationId: actor.organisationId },
    purpose: {
      capability: "COMPANY_INTELLIGENCE",
      taskClass: "EVIDENCE_SYNTHESIS",
    },
    subjects: [subject],
    scopes: [],
    denied: [],
    maxSensitivity: "INTERNAL",
    allowedLayers: [],
    combinationConstraints: [],
    evaluatedAt: new Date().toISOString(),
    revalidateAfter: new Date(Date.now() + 600_000).toISOString(),
    revalidateOnResume: true,
  } as unknown as PermittedContextPlan;
}

/**
 * Every write the service makes joins the test's own transaction, so the
 * rollback takes all of it. The service still decides what to write and
 * in how many transactions; this only decides where they land.
 */
function transactionsOn(tx: TransactionContext): TransactionManager {
  return {
    run: <T>(work: (context: TransactionContext) => Promise<T>) => work(tx),
  };
}

describe("a deck Q composed, written down, read back and drawn", () => {
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

  it("survives being written to Postgres and comes back as a file a founder can open", async () => {
    await rolledBack(async (tx) => {
      const party = await createParty(tx);
      const runId = randomUUID();
      const subject: QSubjectRef = {
        kind: "COMPANY",
        companyId: party.companyId,
      };

      // 1. Compose. The same composer the answer seam calls; no model.
      const composed = composePitchDeck({
        companyName: "Northstar Logistics",
        result: findings(party.companyId),
      });
      expect(composed).not.toBeNull();
      if (composed === null) return;
      expect(composed.content.deck?.slides.length ?? 0).toBeGreaterThan(1);
      // Unknown stays unknown: nothing on record about the finances, so
      // the deck says so instead of composing a confident slide.
      expect(composed.content.gaps.join(" ")).toMatch(/financial/i);

      // 2. Persist, through the application service that re-derives the
      //    caller's authority from the run's own plan.
      const written = await createArtifactService({
        repository: createPostgresArtifactRepository({ sql: tx.sql }),
        transactions: transactionsOn(tx),
      }).prepareArtifact({
        actorContext: party.actor,
        permittedContextPlan: planFor(party.actor, runId, subject),
        qRunId: runId,
        subject,
        artifactType: "PITCH_DECK",
        content: composed,
      });
      expect(written.artifact.status).toBe("READY");
      expect(written.artifact.currentVersion).toBe(1);

      // It is really in the tables, not in something's memory.
      const [row] = await tx.sql<{ n: number }[]>`
        select count(*)::int as n from artifacts.artifact_versions
        where artifact_id = ${written.artifact.artifactId}`;
      expect(row?.n).toBe(1);

      // 3. Refresh: a second service over a second repository, holding
      //    nothing from the first, reads it back.
      const reopened: QArtifactDetail = await createArtifactService({
        repository: createPostgresArtifactRepository({ sql: tx.sql }),
        transactions: transactionsOn(tx),
      }).read(party.actor, written.artifact.artifactId);
      const deck = reopened.current?.content.deck;
      expect(deck).toBeDefined();
      if (deck === undefined) return;
      expect(deck.slides).toEqual(composed.content.deck?.slides);

      // 4. Draw what came out of the database.
      const laid = layOutDeck(deck);
      const meta = { title: reopened.current?.title ?? "Deck" };
      const pptx = await deckToPptx(laid, meta);
      const pdf = await deckToPdf(laid, meta);
      // Real files, checked by what they actually are.
      expect(Buffer.from(pptx.subarray(0, 4))).toEqual(
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      );
      expect(Buffer.from(pdf.subarray(0, 5)).toString("ascii")).toBe("%PDF-");
      expect(pptx.byteLength).toBeGreaterThan(10_000);

      // 5. The words are the findings' words, carried the whole way.
      const drawn = laid.slides
        .flatMap((slide) =>
          slide.boxes.flatMap((box) => (box.kind === "TEXT" ? box.lines : [])),
        )
        .join(" ");
      expect(drawn).toContain("Northstar Logistics");
      expect(drawn).toMatch(/forty shippers/i);
      // And nothing the record did not say.
      expect(drawn).not.toMatch(/runway|burn|ARR/i);
    });
  });

  it("refuses to write a deck for a company the run was never authorised for", async () => {
    await rolledBack(async (tx) => {
      const party = await createParty(tx);
      const stranger = await createParty(tx);
      const runId = randomUUID();
      const composed = composePitchDeck({
        companyName: "Northstar Logistics",
        result: findings(party.companyId),
      });
      if (composed === null) throw new Error("expected a deck");

      await expect(
        createArtifactService({
          repository: createPostgresArtifactRepository({ sql: tx.sql }),
          transactions: transactionsOn(tx),
        }).prepareArtifact({
          actorContext: party.actor,
          // The plan authorises this person's own company; the argument
          // names somebody else's. The plan wins.
          permittedContextPlan: planFor(party.actor, runId, {
            kind: "COMPANY",
            companyId: party.companyId,
          }),
          qRunId: runId,
          subject: { kind: "COMPANY", companyId: stranger.companyId },
          artifactType: "PITCH_DECK",
          content: composed,
        }),
      ).rejects.toThrow(/not something you can prepare/i);

      const [row] = await tx.sql<{ n: number }[]>`
        select count(*)::int as n from artifacts.artifacts
        where company_id = ${stranger.companyId}`;
      expect(row?.n).toBe(0);
    });
  });
});
