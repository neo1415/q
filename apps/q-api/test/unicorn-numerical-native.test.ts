/**
 * OPT-IN SYNTHETIC proof: real scorer/service/PG source guards and fit HTTP reader.
 * Thin SQL parents and auth/visibility/entitlement fixture ports are NOT complete
 * Supabase or production authentication. Static SSR UI uses baseline local CSS;
 * production design/browser acceptance remains a separate release gate.
 */
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { chromium } from "@playwright/test";
import {
  UnicornPotentialDtoSchema,
  notAssessedUnicornPotential,
  type UnicornPotentialDto,
} from "@capital-q/contracts";
import { parseDatabaseConfig } from "@capital-q/config/database";
import { createRequestDatabaseClient } from "@capital-q/database";
import { createFitService } from "@capital-q/discovery";
import {
  assessUnicornPotential,
  createPostgresUnicornPotentialStore,
  createUnicornPotentialService,
  UNICORN_POTENTIAL_METHOD_VERSION,
} from "@capital-q/readiness";
import { ActorContextSchema, AuthUserIdSchema } from "@capital-q/security";
import { registerFitRoutes } from "../src/http/fit.js";

const configured = process.env["CQ_UNICORN_NUMERIC_PROOF_DATABASE_URL"];
const id = (n: number) =>
  `f1000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const company = id(1),
  tenant = id(2),
  organisation = id(3),
  emptyCompany = id(4);
const texts = [
  "Founder previously built a customer solution",
  "Founder delivered a milestone",
  "Accessible market has validated demand",
  "Expansion has paying customers",
  "Paid pilots validate the product",
  "Customers renewed",
  "Revenue growth last quarter 2026 through 2026-09-30",
  "Revenue is non-recurring through 2026-09-30",
  "Modelled contribution margin",
  "Acquisition payback forecast",
  "Proprietary technology deployed",
  "Independent competitive benchmark shows advantage",
  "Acquisition channel pilot",
  "Referrals initial",
  "Measured current cash runway",
  "Investor support proposed",
  "Technical commercial operations covered",
  "Milestones delivered on time",
  "Structural demand documented",
  "Market window deployed",
  "Operating leverage modelled",
  "Repeat deployment pilot",
  "Ecosystem partnership proposed",
  "Strategic option hypothesis",
];
const weights = [15, 15, 15, 8, 6, 8, 5, 5, 8, 5, 6, 4];
const expectedGrades = [3, 3, 3, 2, 2, 3, 2, 2, 3, 3, 2, 2];
const arithmetic = (grades: readonly number[]) =>
  grades.reduce(
    (sum, grade, index) => sum + (grade * (weights[index] ?? 0)) / 4,
    0,
  );

// Never runs in normal CI without the explicit dedicated local DB selector.
describe("SYNTHETIC numerical native round trip (thin parents/auth fixture ports)", () => {
  it.skipIf(configured === undefined)(
    "round trips actual input→engine→append/current→HTTP→real UI, then withdraws source access",
    async () => {
      if (configured === undefined)
        throw new Error("Explicit local database required");
      const target = new URL(configured);
      expect(target.hostname).toBe("127.0.0.1");
      expect(target.pathname).toBe("/cq_unicorn_numeric_proof");
      expect(target.password).toBe("");
      expect(new Date().getUTCFullYear()).toBe(2026);
      const database = createRequestDatabaseClient(
        parseDatabaseConfig({
          NODE_ENV: "test",
          CAPITAL_Q_ENV: "local",
          DATABASE_URL: configured,
          DATABASE_WARM_INTERVAL_SECONDS: "0",
          DATABASE_POOL_MAX: "2",
        }),
      );
      // The web project checks its own React/Next dependencies. Load its real
      // test renderer at runtime without pulling web aliases into backend tsc.
      const rendererModule = new URL(
        "../../web/test/support/unicorn-native-render.ts",
        import.meta.url,
      ).href;
      const { renderSyntheticUnicornAssessment } = (await import(
        /* @vite-ignore */ rendererModule
      )) as {
        renderSyntheticUnicornAssessment: (
          companyId: string,
          score: UnicornPotentialDto,
        ) => string;
      };
      const { sql } = database;
      const server = Fastify();
      let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
      const receipts = mkdtempSync(
        join(tmpdir(), "cq-unicorn-SYNTHETIC-numeric-"),
      );
      chmodSync(receipts, 0o700);
      try {
        const existing = await sql<
          { count: number }[]
        >`select count(*)::int as count from core.companies`;
        expect(existing[0]?.count).toBe(0); // Fresh fixture DB; never overwrite/rerun in-place.
        await sql`insert into identity.tenants(id) values (${tenant}::uuid)`;
        await sql`insert into identity.organisations(id) values (${organisation}::uuid)`;
        for (const companyId of [company, emptyCompany])
          await sql`insert into core.companies(id,tenant_id,organisation_id,canonical_name,marketplace_visibility,current_stage_code) values (${companyId}::uuid,${tenant}::uuid,${organisation}::uuid,'SYNTHETIC numerical fixture only','network_visible','pre_seed')`;
        const stamp = new Date().toISOString();
        const measured = stamp.slice(0, 10);
        for (const [index, statement] of texts.entries()) {
          const claimId = id(100 + index),
            revisionId = id(200 + index);
          const structured =
            index === 14 ? { kind: "MONTHS", value: 8, asOf: measured } : null;
          await sql`insert into evidence.claims(id,tenant_id,subject_type,subject_id,claim_type,claim_key,statement,structured_value,asserted_at,truth_class,evidence_status,lifecycle_status,visibility_scope,current_revision_id,current_revision_number) values (${claimId}::uuid,${tenant}::uuid,'COMPANY',${company}::uuid,'research',${index === 14 ? "financial.runway_months" : `synthetic-${index}`},${statement},${sql.json(structured)},${stamp}::timestamptz,'USER_CLAIM','SELF_REPORTED','CURRENT','network_visible',${revisionId}::uuid,1)`;
          await sql`insert into evidence.claim_revisions(id,tenant_id,claim_id,revision_number,statement,structured_value,truth_class,evidence_status,lifecycle_status) values (${revisionId}::uuid,${tenant}::uuid,${claimId}::uuid,1,${statement},${sql.json(structured)},'USER_CLAIM','SELF_REPORTED','CURRENT')`;
        }
        const store = createPostgresUnicornPotentialStore(database);
        const service = createUnicornPotentialService({
          store,
          deck: () => Promise.resolve(null),
          assess: assessUnicornPotential,
          methodVersion: UNICORN_POTENTIAL_METHOD_VERSION,
        });
        const inputs = await store.inputs(company);
        expect(inputs?.inputs.claims).toHaveLength(24);
        expect(
          inputs?.inputs.claims.find(
            (claim) => claim.claimKey === "financial.runway_months",
          )?.structuredValue,
        ).toEqual({ kind: "MONTHS", value: 8, asOf: measured });
        expect(await service.recompute(company)).toEqual({
          kind: "RECORDED",
          revision: 1,
        });
        expect(await service.recompute(company)).toEqual({
          kind: "UNCHANGED",
          revision: 1,
        });
        const first = (
          await store.current([company], UNICORN_POTENTIAL_METHOD_VERSION)
        ).get(company);
        expect(first?.inputRulesVersion).toBe("unicorn-potential-inputs.v4");
        expect(first?.pillars.map((pillar) => pillar.grade)).toEqual(
          expectedGrades,
        );
        expect(first?.pillars.map((pillar) => pillar.weight)).toEqual(weights);
        expect(first?.coverage).toBe(1);
        expect(arithmetic(expectedGrades)).toBe(66.5);
        expect(first?.overallScore).toBe(
          Math.round(arithmetic(expectedGrades)),
        );
        for (const [index, pillar] of (first?.pillars ?? []).entries())
          expect(pillar.contribution).toBeCloseTo(
            ((expectedGrades[index] ?? 0) * (weights[index] ?? 0)) / 4,
          );
        expect(await service.recompute(emptyCompany)).toEqual({
          kind: "RECORDED",
          revision: 1,
        });
        const empty = (
          await store.current([emptyCompany], UNICORN_POTENTIAL_METHOD_VERSION)
        ).get(emptyCompany);
        expect(empty?.overallScore).toBeNull();
        expect(empty?.coverage).toBe(0);

        // A measured zero is adverse evidence, not missing data. Keep the original revision.
        const changed = { kind: "MONTHS", value: 0, asOf: measured };
        await sql`insert into evidence.claim_revisions(id,tenant_id,claim_id,revision_number,statement,structured_value,truth_class,evidence_status,lifecycle_status) values (${id(900)}::uuid,${tenant}::uuid,${id(114)}::uuid,2,'Measured current cash runway',${sql.json(changed)},'USER_CLAIM','SELF_REPORTED','CURRENT')`;
        await sql`update evidence.claims set structured_value=${sql.json(changed)},current_revision_id=${id(900)}::uuid,current_revision_number=2 where id=${id(114)}::uuid`;
        expect(await service.recompute(company)).toEqual({
          kind: "RECORDED",
          revision: 2,
        });
        const second = (
          await store.current([company], UNICORN_POTENTIAL_METHOD_VERSION)
        ).get(company);
        const revisedGrades = expectedGrades.map((grade, index) =>
          index === 7 ? 1 : grade,
        );
        expect(second?.pillars.map((pillar) => pillar.grade)).toEqual(
          revisedGrades,
        );
        expect(arithmetic(revisedGrades)).toBe(65.25);
        expect(second?.overallScore).toBe(65);
        expect(second?.momentum?.delta).toBe(-2);
        expect(
          (await store.history(company, UNICORN_POTENTIAL_METHOD_VERSION)).map(
            (row) => row.revision,
          ),
        ).toEqual([2, 1]);
        const rows = await sql<
          { revision: number; score: number }[]
        >`select revision,score from core.company_unicorn_potential_assessments where company_id=${company}::uuid order by revision`;
        expect(rows).toEqual([
          { revision: 1, score: 67 },
          { revision: 2, score: 65 },
        ]);
        await expect(
          sql`update core.company_unicorn_potential_assessments set score=0 where company_id=${company}::uuid`,
        ).rejects.toThrow("append-only");

        const actor = (user: number) =>
          ActorContextSchema.parse({
            userId: id(user),
            tenantId: tenant,
            organisationId: organisation,
            membershipId: id(user + 10),
            actorType: "HUMAN",
          });
        const premium = actor(500),
          free = actor(501),
          foreign = actor(502);
        const fit = createFitService({
          investorSubject: {
            investorOrganisationFor: () =>
              Promise.resolve({ investorOrganisationId: id(600) }),
          },
          companyIdentities: (ids) =>
            Promise.resolve(
              new Map(
                ids.map((companyId) => [
                  companyId,
                  { name: "SYNTHETIC numerical fixture only" },
                ]),
              ),
            ),
          eligibility: {
            evaluate: (query) =>
              Promise.resolve({
                context: {} as never,
                results: query.companyIds.map((companyId) => ({
                  companyId,
                  mandateId: null,
                  reasonCodes:
                    query.actor.userId === foreign.userId
                      ? ["COMPANY_NOT_DISCOVERABLE_BY_INVESTOR"]
                      : [],
                })),
              } as never),
          },
          inputs: {
            read: () => {
              throw new Error(
                "No synthetic mandate or alternate score inputs allowed",
              );
            },
          },
          candidates: () => Promise.resolve([]),
          // Explicit fixture entitlement port; actual fit reader and SQL source checks remain real.
          unicornPotential: async (reader, ids) => {
            if (reader.userId !== premium.userId)
              return new Map<string, UnicornPotentialDto>();
            const values = await store.current(
              ids,
              UNICORN_POTENTIAL_METHOD_VERSION,
            );
            // Same authorized no-current-assessment fallback as current q-api composition.
            return new Map(
              ids.map((companyId) => [
                companyId,
                values.get(companyId) ??
                  notAssessedUnicornPotential(UNICORN_POTENTIAL_METHOD_VERSION),
              ]),
            );
          },
        });
        registerFitRoutes(server, {
          fit,
          qViews: {} as never,
          authenticator: {
            authenticate: (request) => {
              const key = request.headers.authorization;
              return Promise.resolve(
                key === "Bearer synthetic-premium"
                  ? { authUserId: AuthUserIdSchema.parse(premium.userId) }
                  : key === "Bearer synthetic-free"
                    ? { authUserId: AuthUserIdSchema.parse(free.userId) }
                    : key === "Bearer synthetic-foreign"
                      ? { authUserId: AuthUserIdSchema.parse(foreign.userId) }
                      : null,
              );
            },
          },
          resolver: {
            resolveHumanContext: ({ principal }) =>
              Promise.resolve({
                status: "RESOLVED",
                context:
                  String(principal.authUserId) === String(premium.userId)
                    ? premium
                    : String(principal.authUserId) === String(free.userId)
                      ? free
                      : foreign,
              }),
          },
        });
        const endpoint = `/v1/companies/${company}/unicorn-potential`;
        server.get("/synthetic-proof", async (_request, reply) => {
          void reply.type("text/html; charset=utf-8");
          const read = await server.inject({
            method: "GET",
            url: endpoint,
            headers: { authorization: "Bearer synthetic-premium" },
          });
          expect(read.statusCode).toBe(200);
          const component = renderSyntheticUnicornAssessment(
            company,
            UnicornPotentialDtoSchema.parse(read.json<unknown>()),
          );
          return `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}body{margin:16px;font:16px system-ui;overflow-wrap:anywhere}details{max-width:100%;padding:8px;border:1px solid}summary{cursor:pointer}li{overflow-wrap:anywhere}</style><h1>SYNTHETIC numerical fixture — not a production company</h1><p>Actual Unicorn component with baseline local CSS. Production layout is separately verified.</p>${component}`;
        });
        const response = await server.inject({
          method: "GET",
          url: endpoint,
          headers: { authorization: "Bearer synthetic-premium" },
        });
        expect(response.statusCode).toBe(200);
        expect(response.headers["cache-control"]).toBe("no-store");
        expect(response.json()).toEqual(second);
        for (const role of ["free", "foreign"])
          expect(
            (
              await server.inject({
                method: "GET",
                url: endpoint,
                headers: { authorization: `Bearer synthetic-${role}` },
              })
            ).statusCode,
          ).toBe(404);
        const address = await server.listen({ host: "127.0.0.1", port: 0 });
        browser = await chromium.launch({
          executablePath:
            process.env["CQ_CHROMIUM_PATH"] ??
            "/workspace/q-cloud/pw-browsers/chromium-1234/chrome-linux64/chrome",
          args: ["--no-sandbox"],
        });
        for (const width of [1440, 390]) {
          const page = await browser.newPage({
            viewport: { width, height: 1000 },
          });
          await page.route("**/*", (route) =>
            new URL(route.request().url()).hostname === "127.0.0.1"
              ? route.continue()
              : route.abort(),
          );
          await page.goto(`${address}/synthetic-proof`);
          const detail = page.locator('[data-score="unicorn-potential"]');
          await detail.locator(":scope > summary").click();
          expect(await detail.locator("[data-unicorn-pillar]").count()).toBe(
            12,
          );
          expect(await detail.innerText()).toContain("65");
          expect(await detail.innerText()).toContain(
            "Only the final score is rounded",
          );
          const p8 = detail.locator('[data-unicorn-pillar="P8"]');
          const p8Summary = await p8.locator(":scope > summary").innerText();
          expect(p8Summary).toContain("1/4 grade");
          expect(p8Summary).toContain("5% weight");
          expect(p8Summary).toContain("1.25 points");
          await p8.locator(":scope > summary").click();
          expect(await p8.innerText()).toContain("0/4");
          const layout = await page.evaluate(() => ({
            viewport: innerWidth,
            width: document.documentElement.scrollWidth,
          }));
          expect(layout.width).toBeLessThanOrEqual(layout.viewport + 2);
          const screenshot = join(receipts, `SYNTHETIC-${width}.png`);
          await page.screenshot({ path: screenshot, fullPage: true });
          chmodSync(screenshot, 0o600);
          await page.close();
        }
        await sql`update evidence.claims set visibility_scope='founder_private' where id=${id(114)}::uuid`;
        expect(
          (
            await store.current([company], UNICORN_POTENTIAL_METHOD_VERSION)
          ).has(company),
        ).toBe(false);
        const withdrawn = await server.inject({
          method: "GET",
          url: endpoint,
          headers: { authorization: "Bearer synthetic-premium" },
        });
        expect(withdrawn.statusCode).toBe(200);
        expect(withdrawn.json()).toEqual(
          notAssessedUnicornPotential(UNICORN_POTENTIAL_METHOD_VERSION),
        );
        expect(withdrawn.body).not.toContain("Measured current cash runway");
        expect(
          await store.history(company, UNICORN_POTENTIAL_METHOD_VERSION),
        ).toHaveLength(0);
        const retained = await sql<
          { count: number }[]
        >`select count(*)::int as count from core.company_unicorn_potential_assessments where company_id=${company}::uuid`;
        expect(retained[0]?.count).toBe(2);
        const report = {
          label: "SYNTHETIC ONLY",
          fixture:
            "thin parents and authentication/visibility/entitlement fixture ports; not full Supabase/authserver",
          css: "actual React component; baseline static CSS, not production layout",
          method: UNICORN_POTENTIAL_METHOD_VERSION,
          inputRules: second?.inputRulesVersion,
          weightedSumBeforeRound: 65.25,
          persistedScores: rows,
          sourceWithdrawal:
            "store.current omitted; authorized HTTP200 NOT_ASSESSED without score/lineage; private history withheld and append rows retained",
          screenshotWidths: [1440, 390],
        };
        writeFileSync(
          join(receipts, "proof.json"),
          JSON.stringify(report, null, 2),
          { mode: 0o600 },
        );
        process.stdout.write(
          `${JSON.stringify({ syntheticProof: "PASS", receiptDir: receipts })}\n`,
        );
      } finally {
        await browser?.close();
        await server.close();
        await database.close();
      }
    },
    120_000,
  );
});
