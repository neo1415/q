import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresMaterialActionAuditWriter } from "@capital-q/audit";
import { createPostgresCompanyQueryPort } from "@capital-q/companies";
import { parseDatabaseConfig } from "@capital-q/config/database";
import { createEventRegistry, type CorrelationId } from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
  type TransactionManager,
} from "@capital-q/database";
import { createOutboxWriter } from "@capital-q/eventing";
import { createPostgresInvestorOrganisationQueryPort } from "@capital-q/investors";
import {
  AuthUserIdSchema,
  createAuthorizationService,
  resolveHumanActorContext,
  type ActorContext,
  type AuthenticatedPrincipal,
} from "@capital-q/security";
import {
  createPostgresActorContextResolver,
  createPostgresAuthorizationPolicySource,
} from "@capital-q/security/postgres";

import { NETWORK_EVENTS } from "../src/events/index.js";
import {
  createPipelineImportService,
  type PipelineImportFile,
  type PipelineImportService,
} from "../src/index.js";

/**
 * CRM import (decision 106) against the real local database, one rolled-
 * back transaction per test. Real authorisation policy, real relationship
 * spine; the file reader, the company-visibility rule and the board are the
 * thinnest honest doubles (a map of uploads, a set, a list).
 *
 * Covers: prepare (matched, ambiguous, new, invalid) and nothing written
 * but the staged import; apply onto the ONE canonical relationship with
 * private stage history and notes; an ambiguous row resolved by the
 * importer; replay and re-import with no duplicates; the approval binding
 * (hash, counts, file, resolutions); another organisation, a hidden
 * company and an unscanned file; the founder side.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;

class Rollback extends Error {}

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

const INVESTOR_SHEET = [
  "Company,Website,Status,Stage date,Check size,Notes,Next step,Follow-up date",
  "NexaRail Technologies,https://nexarail.example,Partner meeting,2026-03-12,$500k,Strong team,Send memo,2026-12-01",
  "Twin Robotics,,Lead,,,,,",
  "Not On Capital Q Ltd,https://hidden-gem.example,Research,,,Met at a dinner,,",
  ",,Lead,,,,,",
  "Quiet Co,https://quiet.example,Lead,,,,,",
].join("\n");

const FOUNDER_SHEET = [
  "Investor,Status,Ticket size,Notes",
  "Apex Ventures,Soft circled,$250k,Wants monthly updates",
  "Unknown Angels,Contacted,,",
].join("\n");

type World = {
  readonly tx: TransactionContext;
  readonly service: PipelineImportService;
  readonly investorRep: ActorContext;
  readonly otherInvestorRep: ActorContext;
  readonly founder: ActorContext;
  readonly files: Map<string, PipelineImportFile>;
  readonly tasks: string[];
  readonly companyA: string;
  readonly twins: readonly string[];
  readonly quietCo: string;
  readonly investorA: string;
  readonly companyOfFounder: string;
};

describe("CRM import against local PostgreSQL", () => {
  let db: RequestDatabase;

  beforeAll(() => {
    db = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_POOL_MAX: "4",
        DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
      }),
    );
  });

  afterAll(async () => {
    await db.close();
  });

  async function insertTenant(tx: TransactionContext, name: string) {
    const id = randomUUID();
    await tx.sql`insert into identity.tenants (id, name) values (${id}, ${name})`;
    return id;
  }

  async function insertOrganisation(
    tx: TransactionContext,
    tenantId: string,
    type: string,
    name: string,
  ) {
    const id = randomUUID();
    await tx.sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
      values (${id}, ${tenantId}, ${type}, ${name}, ${`org-${id.slice(0, 8)}`})`;
    await tx.sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantId}, ${id})`;
    return id;
  }

  async function insertCompany(
    tx: TransactionContext,
    tenantId: string,
    name: string,
    website: string | null,
    visibility = "network_visible",
  ) {
    const organisationId = await insertOrganisation(
      tx,
      tenantId,
      "company",
      name,
    );
    const id = randomUUID();
    await tx.sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, website_url, marketplace_visibility)
      values (${id}, ${tenantId}, ${organisationId}, ${name}, ${`co-${id.slice(0, 8)}`}, ${website}, ${visibility})`;
    return { id, organisationId };
  }

  async function insertInvestor(
    tx: TransactionContext,
    tenantId: string,
    organisationId: string,
    name: string,
  ) {
    const id = randomUUID();
    await tx.sql`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
      values (${id}, ${tenantId}, ${organisationId}, 'VC', ${name})`;
    return id;
  }

  async function insertMember(
    tx: TransactionContext,
    tenantId: string,
    organisationId: string,
  ): Promise<ActorContext> {
    const authUserId = randomUUID();
    await tx.sql`insert into auth.users (id) values (${authUserId})`;
    const [profile] = await tx.sql<{ id: string }[]>`
      select id from identity.user_profiles where auth_user_id = ${authUserId}`;
    if (profile === undefined) throw new Error("profile trigger did not run");
    const membershipId = randomUUID();
    await tx.sql`insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id)
      values (${membershipId}, ${tenantId}, ${organisationId}, ${profile.id})`;
    await tx.sql`insert into identity.membership_roles (membership_id, role_id)
      select ${membershipId}, r.id from permissions.roles r where r.code = 'organisation_admin'`;
    await tx.sql`insert into identity.user_active_contexts (user_id, membership_id) values (${profile.id}, ${membershipId})`;
    const principal: AuthenticatedPrincipal = {
      authUserId: AuthUserIdSchema.parse(authUserId),
    };
    const resolution = await resolveHumanActorContext(
      createPostgresActorContextResolver({ sql: tx.sql }),
      { principal },
    );
    if (resolution.status !== "RESOLVED") {
      throw new Error(`context not resolved: ${resolution.status}`);
    }
    return resolution.context;
  }

  async function withWorld(work: (world: World) => Promise<void>) {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        const tenantC = await insertTenant(tx, "Import Company Tenant");
        const tenantI = await insertTenant(tx, "Import Investor Tenant");
        const companyA = await insertCompany(
          tx,
          tenantC,
          "NexaRail Technologies",
          "https://www.nexarail.example",
        );
        const twinOne = await insertCompany(tx, tenantC, "Twin Robotics", null);
        const twinTwo = await insertCompany(
          tx,
          tenantC,
          "Twin Robotics Ltd",
          null,
        );
        // Discoverable, but the disclosure rule hides it from this investor.
        const quietCo = await insertCompany(
          tx,
          tenantC,
          "Quiet Co",
          "https://quiet.example",
        );
        // Organisation-private: never a match, whatever its name.
        await insertCompany(
          tx,
          tenantC,
          "Not On Capital Q Ltd",
          "https://hidden-gem.example",
          "organisation_private",
        );
        const investorOrg = await insertOrganisation(
          tx,
          tenantI,
          "investment_firm",
          "Apex Ventures",
        );
        const investorA = await insertInvestor(
          tx,
          tenantI,
          investorOrg,
          "Apex Ventures",
        );
        const otherOrg = await insertOrganisation(
          tx,
          tenantI,
          "investment_firm",
          "Beta Capital",
        );
        await insertInvestor(tx, tenantI, otherOrg, "Beta Capital");
        const visible = new Set<string>([companyA.id, twinOne.id, twinTwo.id]);
        const files = new Map<string, PipelineImportFile>();
        const tasks: string[] = [];
        const investorSubject = {
          investorOrganisationFor: async (actor: ActorContext) => {
            if (actor.organisationId === undefined) return null;
            const [row] = await tx.sql<{ id: string }[]>`
              select id from core.investor_organisations
               where tenant_id = ${actor.tenantId} and organisation_id = ${actor.organisationId}`;
            return row === undefined
              ? null
              : { investorOrganisationId: row.id };
          },
        };
        const service = createPipelineImportService({
          sql: tx.sql,
          transactions: nestedTransactions(tx),
          companies: createPostgresCompanyQueryPort({ sql: tx.sql }),
          investors: createPostgresInvestorOrganisationQueryPort({
            sql: tx.sql,
          }),
          outbox: createOutboxWriter({
            registry: createEventRegistry([...NETWORK_EVENTS]),
          }),
          audit: createPostgresMaterialActionAuditWriter(),
          authorization: createAuthorizationService(
            createPostgresAuthorizationPolicySource({ sql: tx.sql }),
          ),
          investorSubject,
          companyVisibility: {
            isVisibleToInvestor: (_actor, companyId) =>
              Promise.resolve(visible.has(companyId)),
          },
          files: {
            readOwnFile: (actor, documentId) =>
              Promise.resolve(
                files.get(`${actor.userId}:${documentId}`) ?? {
                  ok: false,
                  code: "NOT_FOUND",
                },
              ),
          },
          tasks: {
            addTask: (_actor, task, options) => {
              if (tasks.includes(options.idempotencyKey))
                return Promise.resolve(false);
              tasks.push(options.idempotencyKey);
              expect(task.title.length).toBeGreaterThan(0);
              return Promise.resolve(true);
            },
          },
        });
        await work({
          tx,
          service,
          investorRep: await insertMember(tx, tenantI, investorOrg),
          otherInvestorRep: await insertMember(tx, tenantI, otherOrg),
          founder: await insertMember(tx, tenantC, companyA.organisationId),
          files,
          tasks,
          companyA: companyA.id,
          twins: [twinOne.id, twinTwo.id],
          quietCo: quietCo.id,
          investorA,
          companyOfFounder: companyA.id,
        });
        completed = true;
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    expect(completed).toBe(true);
  }

  function upload(
    world: World,
    actor: ActorContext,
    text: string,
    fileName = "pipeline.csv",
  ) {
    const documentId = randomUUID();
    world.files.set(`${actor.userId}:${documentId}`, {
      ok: true,
      documentId,
      documentVersionId: randomUUID(),
      fileName,
      mimeType: "text/csv",
      bytes: new TextEncoder().encode(text),
    });
    return documentId;
  }

  async function count(
    tx: TransactionContext,
    query: "relationships" | "events" | "notes",
    investorId: string,
  ) {
    const [row] =
      query === "relationships"
        ? await tx.sql<
            { n: number }[]
          >`select count(*)::int as n from network.relationships where investor_organisation_id = ${investorId}`
        : query === "events"
          ? await tx.sql<
              { n: number }[]
            >`select count(*)::int as n from network.relationship_events e join network.relationships r on r.id = e.relationship_id
              where r.investor_organisation_id = ${investorId} and e.event_type = 'crm_stage_imported'`
          : await tx.sql<
              { n: number }[]
            >`select count(*)::int as n from network.relationship_notes where investor_organisation_id = ${investorId}`;
    return row?.n ?? -1;
  }

  it("prepares a proposal: matched, ambiguous, new and invalid rows, nothing else written", async () => {
    await withWorld(async (world) => {
      const documentId = upload(world, world.investorRep, INVESTOR_SHEET);
      const prepared = await world.service.prepare(world.investorRep, {
        documentId,
        correlationId: CORRELATION(),
      });
      if (prepared.outcome !== "OK") throw new Error(prepared.message);
      const preview = prepared.value;
      expect(preview.mappingSource).toBe("HEADERS");
      expect(preview.counts).toEqual({
        rows: 5,
        matched: 1,
        ambiguous: 1,
        new: 2,
        invalid: 1,
      });
      const byRow = new Map(preview.rows.map((row) => [row.rowNumber, row]));
      expect(byRow.get(1)).toMatchObject({
        match: "MATCHED",
        stage: "MEETING",
        matched: { id: world.companyA },
      });
      expect(
        byRow
          .get(2)
          ?.candidates.map((c) => c.id)
          .sort(),
      ).toEqual([...world.twins].sort());
      // Organisation-private and hidden-by-disclosure companies are never candidates.
      expect(byRow.get(3)?.match).toBe("NEW");
      expect(byRow.get(5)?.match).toBe("NEW");
      expect(await count(world.tx, "relationships", world.investorA)).toBe(0);
      expect(await count(world.tx, "notes", world.investorA)).toBe(0);
      expect(preview.columns).toEqual([
        "Company",
        "Website",
        "Status",
        "Stage date",
        "Check size",
        "Notes",
        "Next step",
        "Follow-up date",
      ]);

      // The import screen: the person's own columns, read again as PERSON;
      // an unusable choice is refused, never mixed with Q's.
      const mine = await world.service.prepare(world.investorRep, {
        documentId,
        mapping: { counterpartName: "Company", stage: "Status" },
        correlationId: CORRELATION(),
      });
      if (mine.outcome !== "OK") throw new Error(mine.message);
      expect(mine.value.mappingSource).toBe("PERSON");
      expect(mine.value.mapping).toEqual({
        counterpartName: "Company",
        stage: "Status",
      });
      expect(mine.value.proposalHash).not.toBe(preview.proposalHash);
      expect(
        await world.service.prepare(world.investorRep, {
          documentId,
          mapping: { counterpartName: "Company", stage: "Company" },
          correlationId: CORRELATION(),
        }),
      ).toMatchObject({ outcome: "REFUSED", code: "INVALID_MAPPING" });
      expect(
        await world.service.prepare(world.investorRep, {
          documentId,
          mapping: { counterpartName: "No such column" },
          correlationId: CORRELATION(),
        }),
      ).toMatchObject({ outcome: "REFUSED", code: "INVALID_MAPPING" });
    });
  });

  it("applies onto the one canonical relationship, privately, and a replay or re-import duplicates nothing", async () => {
    await withWorld(async (world) => {
      const documentId = upload(world, world.investorRep, INVESTOR_SHEET);
      const prepared = await world.service.prepare(world.investorRep, {
        documentId,
        correlationId: CORRELATION(),
      });
      if (prepared.outcome !== "OK") throw new Error(prepared.message);
      const { importId, proposalHash, counts } = prepared.value;
      // An existing relationship for the matched pair: the import converges on it.
      await world.tx
        .sql`insert into network.relationships (tenant_id, company_id, investor_organisation_id)
        select c.tenant_id, c.id, ${world.investorA} from core.companies c where c.id = ${world.companyA}`;
      const twin = world.twins[0] ?? "";
      const apply = (key: string) =>
        world.service.apply(world.investorRep, {
          importId,
          documentId,
          request: {
            proposalHash,
            counts,
            resolutions: [{ rowNumber: 2, choice: twin }],
          },
          idempotencyKey: key,
          correlationId: CORRELATION(),
          byQ: false,
        });
      const applied = await apply("screen-key-0001");
      if (applied.outcome !== "OK") throw new Error(applied.message);
      expect(applied.value.replayed).toBe(false);
      expect(applied.value.result).toEqual({
        linked: 2,
        relationshipsCreated: 1,
        keptPrivate: 2,
        skipped: 1,
        stageEvents: 2,
        notes: 1,
        tasks: 1,
        details: 2,
      });
      // The result links the relationships it filled, by canonical name.
      expect(
        applied.value.relationships.map((link) => link.counterpartId).sort(),
      ).toEqual([world.companyA, twin].sort());
      // Decision 106 gaps: the side's own stage and expected ticket, exact,
      // on the investor's side only; the company's side has none.
      const sides = await world.tx.sql<
        {
          party: string;
          stage: string | null;
          stage_label: string | null;
          expected_amount: string | null;
          expected_currency: string | null;
          organisation_id: string;
        }[]
      >`
        select d.party, d.stage, d.stage_label, d.expected_amount::text as expected_amount,
               d.expected_currency, d.organisation_id
          from network.relationship_side_details d
          join network.relationships r on r.id = d.relationship_id
         where r.company_id = ${world.companyA}`;
      expect(sides).toEqual([
        {
          party: "INVESTOR",
          stage: "MEETING",
          stage_label: "Partner meeting",
          expected_amount: "500000.00",
          expected_currency: "USD",
          organisation_id: world.investorRep.organisationId,
        },
      ]);
      // Gap 7: the rows kept private are the organisation's prospects, and
      // only its own.
      const prospects = await world.service.prospects(world.investorRep);
      expect(prospects.items.map((one) => one.name).sort()).toEqual([
        "Not On Capital Q Ltd",
        "Quiet Co",
      ]);
      expect(prospects.visibility).toBe("organisation_private");
      expect(
        (await world.service.prospects(world.otherInvestorRep)).items,
      ).toEqual([]);
      expect(await count(world.tx, "relationships", world.investorA)).toBe(2);
      const events = await world.tx.sql<
        {
          visibility_scope: string;
          payload: { stage: string; stageDate: string | null };
        }[]
      >`
        select e.visibility_scope, e.payload from network.relationship_events e
          join network.relationships r on r.id = e.relationship_id
         where r.company_id = ${world.companyA} and e.event_type = 'crm_stage_imported'`;
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        visibility_scope: "investor_private",
        payload: { stage: "MEETING", stageDate: "2026-03-12" },
      });
      // The relationship the import created is discovered privately, never shared.
      const [origin] = await world.tx.sql<
        { visibility_scope: string; source_type: string }[]
      >`
        select e.visibility_scope, e.source_type from network.relationship_events e
          join network.relationships r on r.id = e.relationship_id
         where r.company_id = ${twin} and e.event_type = 'discovered'`;
      expect(origin).toEqual({
        visibility_scope: "investor_private",
        source_type: "MANUAL",
      });
      // No canonical company was created from the sheet.
      const [made] = await world.tx.sql<
        { n: number }[]
      >`select count(*)::int as n from core.companies where canonical_name = 'Not On Capital Q Ltd'`;
      expect(made?.n).toBe(1);
      const outcomes = await world.tx.sql<
        { row_number: number; outcome: string }[]
      >`
        select row_number, outcome from network.pipeline_import_rows where import_id = ${importId} order by row_number`;
      expect(outcomes.map((row) => row.outcome)).toEqual([
        "LINKED",
        "LINKED",
        "KEPT_PRIVATE",
        "SKIPPED",
        "KEPT_PRIVATE",
      ]);

      // The same approval again: what the first did, nothing more.
      const replay = await apply("screen-key-0001");
      expect(replay).toMatchObject({
        outcome: "OK",
        value: { replayed: true },
      });
      const second = await apply("another-key-0002");
      expect(second).toMatchObject({
        outcome: "OK",
        value: { replayed: true },
      });

      // The same file imported again, approved again: no duplicates.
      const again = await world.service.prepare(world.investorRep, {
        documentId,
        correlationId: CORRELATION(),
      });
      if (again.outcome !== "OK") throw new Error(again.message);
      const reapplied = await world.service.apply(world.investorRep, {
        importId: again.value.importId,
        documentId,
        request: {
          proposalHash: again.value.proposalHash,
          counts: again.value.counts,
          resolutions: [{ rowNumber: 2, choice: twin }],
        },
        idempotencyKey: "screen-key-0003",
        correlationId: CORRELATION(),
        byQ: true,
      });
      expect(reapplied).toMatchObject({
        outcome: "OK",
        value: {
          result: {
            linked: 2,
            relationshipsCreated: 0,
            stageEvents: 0,
            notes: 0,
            tasks: 0,
          },
        },
      });
      expect(await count(world.tx, "relationships", world.investorA)).toBe(2);
      expect(await count(world.tx, "events", world.investorA)).toBe(2);
      expect(await count(world.tx, "notes", world.investorA)).toBe(1);
      expect(world.tasks).toHaveLength(1);
    });
  });

  it("binds the approval to the exact proposal: hash, counts, file and resolutions", async () => {
    await withWorld(async (world) => {
      const documentId = upload(world, world.investorRep, INVESTOR_SHEET);
      const prepared = await world.service.prepare(world.investorRep, {
        documentId,
        correlationId: CORRELATION(),
      });
      if (prepared.outcome !== "OK") throw new Error(prepared.message);
      const { importId, proposalHash, counts } = prepared.value;
      const apply = (request: unknown, file = documentId) =>
        world.service.apply(world.investorRep, {
          importId,
          documentId: file,
          request,
          idempotencyKey: "screen-key-binding",
          correlationId: CORRELATION(),
          byQ: false,
        });
      expect(
        await apply({ proposalHash: "0".repeat(64), counts }),
      ).toMatchObject({ outcome: "REFUSED", code: "STALE" });
      expect(
        await apply({
          proposalHash,
          counts: { ...counts, matched: counts.matched + 1 },
        }),
      ).toMatchObject({ outcome: "REFUSED", code: "STALE" });
      expect(await apply({ proposalHash, counts }, randomUUID())).toMatchObject(
        { outcome: "REFUSED", code: "STALE" },
      );
      // A row that was never ambiguous cannot be pointed at another company.
      expect(
        await apply({
          proposalHash,
          counts,
          resolutions: [{ rowNumber: 1, choice: world.quietCo }],
        }),
      ).toMatchObject({ outcome: "REFUSED", code: "INVALID_RESOLUTION" });
      // An ambiguous row only takes one of its own candidates.
      expect(
        await apply({
          proposalHash,
          counts,
          resolutions: [{ rowNumber: 2, choice: world.companyA }],
        }),
      ).toMatchObject({ outcome: "REFUSED", code: "INVALID_RESOLUTION" });
      expect(await count(world.tx, "relationships", world.investorA)).toBe(0);
    });
  });

  it("keeps an import to its organisation, and reads only a scanned upload of the actor's own", async () => {
    await withWorld(async (world) => {
      const documentId = upload(world, world.investorRep, INVESTOR_SHEET);
      const prepared = await world.service.prepare(world.investorRep, {
        documentId,
        correlationId: CORRELATION(),
      });
      if (prepared.outcome !== "OK") throw new Error(prepared.message);
      const { importId, proposalHash, counts } = prepared.value;
      // Another firm (same tenant) can neither read nor apply it.
      expect(
        await world.service.preview(world.otherInvestorRep, importId),
      ).toMatchObject({ outcome: "REFUSED", code: "NOT_FOUND" });
      expect(
        await world.service.apply(world.otherInvestorRep, {
          importId,
          documentId,
          request: { proposalHash, counts },
          idempotencyKey: "other-firm-key",
          correlationId: CORRELATION(),
          byQ: false,
        }),
      ).toMatchObject({ outcome: "REFUSED", code: "NOT_FOUND" });
      // Nor read the first firm's upload.
      expect(
        await world.service.prepare(world.otherInvestorRep, {
          documentId,
          correlationId: CORRELATION(),
        }),
      ).toMatchObject({ outcome: "REFUSED", code: "NOT_FOUND" });
      // A file still being scanned is not read.
      const pending = randomUUID();
      world.files.set(`${world.investorRep.userId}:${pending}`, {
        ok: false,
        code: "NOT_SCANNED",
      });
      expect(
        await world.service.prepare(world.investorRep, {
          documentId: pending,
          correlationId: CORRELATION(),
        }),
      ).toMatchObject({ outcome: "REFUSED", code: "NOT_SCANNED" });
      // A founder cannot import onto the investor side.
      await expect(
        world.service.prepare(world.founder, {
          documentId,
          correlationId: CORRELATION(),
        }),
      ).rejects.toThrow();
    });
  });

  it("imports a founder's investor tracker onto their company's side", async () => {
    await withWorld(async (world) => {
      const documentId = upload(
        world,
        world.founder,
        FOUNDER_SHEET,
        "raise.csv",
      );
      const prepared = await world.service.prepare(world.founder, {
        documentId,
        companyId: world.companyOfFounder,
        correlationId: CORRELATION(),
      });
      if (prepared.outcome !== "OK") throw new Error(prepared.message);
      expect(prepared.value.side).toBe("COMPANY");
      expect(prepared.value.counts).toMatchObject({ matched: 1, new: 1 });
      const applied = await world.service.apply(world.founder, {
        importId: prepared.value.importId,
        documentId,
        companyId: world.companyOfFounder,
        request: {
          proposalHash: prepared.value.proposalHash,
          counts: prepared.value.counts,
        },
        idempotencyKey: "founder-key-0001",
        correlationId: CORRELATION(),
        byQ: false,
      });
      expect(applied).toMatchObject({
        outcome: "OK",
        value: {
          result: { linked: 1, keptPrivate: 1, stageEvents: 1, notes: 1 },
        },
      });
      const scopes = await world.tx.sql<
        { visibility_scope: string; event_type: string }[]
      >`
        select e.visibility_scope, e.event_type from network.relationship_events e
          join network.relationships r on r.id = e.relationship_id
         where r.company_id = ${world.companyOfFounder} and r.investor_organisation_id = ${world.investorA}
         order by e.sequence`;
      expect(scopes).toEqual([
        { visibility_scope: "founder_private", event_type: "discovered" },
        {
          visibility_scope: "founder_private",
          event_type: "crm_stage_imported",
        },
      ]);
      // The founder's own stage and expected cheque, on their side only.
      const founderSide = await world.tx.sql<
        { party: string; stage: string | null; expected: string | null }[]
      >`
        select d.party, d.stage, d.expected_amount::text || ' ' || d.expected_currency as expected
          from network.relationship_side_details d
          join network.relationships r on r.id = d.relationship_id
         where r.company_id = ${world.companyOfFounder} and r.investor_organisation_id = ${world.investorA}`;
      expect(founderSide).toEqual([
        { party: "COMPANY", stage: "COMMITTED", expected: "250000.00 USD" },
      ]);
      // Another company's id in the path is input, never proof.
      await expect(
        world.service.prepare(world.founder, {
          documentId,
          companyId: world.quietCo,
          correlationId: CORRELATION(),
        }),
      ).rejects.toThrow();
    });
  });
});
