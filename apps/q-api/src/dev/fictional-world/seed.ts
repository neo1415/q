/* eslint-disable no-console -- a developer CLI whose whole purpose is to report what it seeded */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { loadDatabaseConfig } from "@capital-q/config/database";
import { Q_ARTIFACTS_PATH, Q_ARTIFACT_EXPORT_SUFFIX } from "@capital-q/contracts";
import { createRequestDatabaseClient } from "@capital-q/database";

import {
  founderEmail,
  loadTaxonomy,
  seedCompany,
  seedInterest,
  seedInvestor,
  type SeededCompany,
  type SeededInterest,
  type SeededInvestor,
} from "./accounts.js";
import { FICTIONAL_COMPANIES } from "./companies.js";
import { SeedError, createSeedHttp } from "./http.js";
import { FICTIONAL_INTERESTS, FICTIONAL_INVESTORS } from "./investors.js";
import { createSeedRecords } from "./records.js";

/**
 * The fictional demo world (SEED): twelve invented companies, eight
 * invented investor organisations and the interest between them, written
 * through the product's own paths so Discover, Home Q, relationships and
 * profiles have something real-feeling to show.
 *
 *   pnpm seed:fictional            (see scripts/seed-fictional-world.mjs)
 *
 * Additive and idempotent: every person, company, claim, deck and interest
 * has a stable natural key and is looked for before it is written, so a
 * rerun reports what exists and changes nothing. Nothing is deleted.
 *
 * Where it writes comes only from explicit CQ_SEED_* variables. A target
 * that is not loopback is refused unless --hosted is passed. No model is
 * called: the stories and decks are handwritten in companies.ts.
 *
 * Output (--out, default .tmp/fictional-world): manifest.json naming every
 * seeded company, its founder account and its deck artifact, plus each
 * deck rendered as PDF and PPTX — the hook a narrated-deck video step
 * consumes.
 */

function argument(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new SeedError(`${name} is required (the seed never guesses its target)`);
  }
  return value;
}

function isLoopback(url: string): boolean {
  const host = new URL(url).hostname;
  return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(host);
}

async function main(): Promise<number> {
  const hosted = process.argv.includes("--hosted");
  const target = {
    supabaseUrl: required("CQ_SEED_SUPABASE_URL").replace(/\/$/, ""),
    publishableKey: required("CQ_SEED_SUPABASE_PUBLISHABLE_KEY"),
    secretKey: required("CQ_SEED_SUPABASE_SECRET_KEY"),
    apiUrl: required("CQ_SEED_API_URL").replace(/\/$/, ""),
  };
  const databaseUrl = required("CQ_SEED_DATABASE_URL");
  for (const [name, url] of [
    ["CQ_SEED_SUPABASE_URL", target.supabaseUrl],
    ["CQ_SEED_API_URL", target.apiUrl],
    ["CQ_SEED_DATABASE_URL", databaseUrl],
  ] as const) {
    if (!isLoopback(url) && !hosted) {
      throw new SeedError(
        `${name} is not loopback (${new URL(url).hostname}); pass --hosted only if you mean a hosted synthetic project`,
      );
    }
  }
  const password =
    process.env["CQ_SEED_ACCOUNT_PASSWORD"] ??
    (hosted ? undefined : "CapitalQ-dev-2026!");
  if (password === undefined) {
    throw new SeedError("CQ_SEED_ACCOUNT_PASSWORD is required with --hosted");
  }
  const outDir = resolve(argument("--out") ?? ".tmp/fictional-world");

  // The in-process services read the database from the environment; only
  // the explicit seed target is allowed to be it.
  process.env["DATABASE_URL"] = databaseUrl;
  process.env["CAPITAL_Q_ENV"] ??= hosted ? "staging" : "local";

  console.log(
    `fictional world: supabase ${new URL(target.supabaseUrl).host} · api ${new URL(target.apiUrl).host} · db ${new URL(databaseUrl).host}${hosted ? " (HOSTED)" : ""}`,
  );
  const http = createSeedHttp(target);
  const database = createRequestDatabaseClient(loadDatabaseConfig());
  try {
    const records = createSeedRecords(database);

    console.log(`companies (${String(FICTIONAL_COMPANIES.length)}):`);
    const companies = new Map<string, SeededCompany>();
    // Any signed-in person may read the taxonomy; the first founder does.
    const first = FICTIONAL_COMPANIES[0];
    if (first === undefined) throw new SeedError("no companies to seed");
    await http.ensureAccount({
      email: founderEmail(first.key),
      displayName: first.founder.displayName,
      password,
      seedKey: first.key,
    });
    const taxonomy = await loadTaxonomy(
      http,
      await http.sessionFor(founderEmail(first.key)),
    );
    for (const company of FICTIONAL_COMPANIES) {
      companies.set(
        company.key,
        await seedCompany(http, company, taxonomy, password, (l) => console.log(l)),
      );
    }

    console.log(`investors (${String(FICTIONAL_INVESTORS.length)}):`);
    const investors = new Map<string, SeededInvestor>();
    for (const investor of FICTIONAL_INVESTORS) {
      investors.set(investor.key, await seedInvestor(http, investor, taxonomy, password, (l) => console.log(l)));
    }

    console.log("claims and decks:");
    const manifestCompanies = [];
    mkdirSync(outDir, { recursive: true });
    for (const company of FICTIONAL_COMPANIES) {
      const seeded = companies.get(company.key);
      if (seeded === undefined) continue;
      const actor = await records.actorFor(seeded.authUserId);
      const claims = await records.seedClaims(actor, seeded.companyId, company);
      const deck = await records.seedDeck(actor, seeded.companyId, company);
      const files = await records.renderDeck(actor, deck.artifactId, company.name);
      const dir = join(outDir, company.key);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "deck.pdf"), files.pdf);
      writeFileSync(join(dir, "deck.pptx"), files.pptx);
      console.log(
        `  ${company.name}: claims +${String(claims.created)} (${String(claims.existing)} existing) · deck ${deck.created ? "composed" : "existing"} v${String(files.version.version)} · ${String(files.version.content.deck?.slides.length ?? 0)} slides`,
      );
      manifestCompanies.push({
        key: company.key,
        name: company.name,
        companyId: seeded.companyId,
        founderEmail: seeded.email,
        country: company.countryOption.toUpperCase(),
        stage: company.stageOption,
        raise: company.raise.target,
        deck: {
          artifactId: deck.artifactId,
          version: files.version.version,
          title: files.version.title,
          direction: files.version.content.deck?.direction ?? null,
          exportPaths: {
            pdf: `${Q_ARTIFACTS_PATH}/${deck.artifactId}${Q_ARTIFACT_EXPORT_SUFFIX}/pdf`,
            pptx: `${Q_ARTIFACTS_PATH}/${deck.artifactId}${Q_ARTIFACT_EXPORT_SUFFIX}/pptx`,
          },
          files: { pdf: join(company.key, "deck.pdf"), pptx: join(company.key, "deck.pptx") },
          // What a narrated-deck video step reads aloud, slide by slide.
          slides: (files.version.content.deck?.slides ?? []).map((slide) => ({
            layout: slide.layout,
            title: slide.title,
            subtitle: slide.subtitle ?? null,
            bullets: [...slide.bullets, ...slide.bulletsRight],
          })),
        },
      });
    }

    console.log(`interests (${String(FICTIONAL_INTERESTS.length)}):`);
    const interests: SeededInterest[] = [];
    for (const interest of FICTIONAL_INTERESTS) {
      const investor = investors.get(interest.investorKey);
      const company = companies.get(interest.companyKey);
      if (investor === undefined || company === undefined) continue;
      try {
        interests.push(await seedInterest(http, interest, investor, company, (l) => console.log(l)));
      } catch (error) {
        // One refused interest (the company not yet discoverable to this
        // investor, say) is reported, not fatal to the rest of the world.
        console.log(`    ${interest.investorKey} -> ${interest.companyKey}: ${error instanceof Error ? error.message : String(error)}`);
        interests.push({ ...interest, interestId: null, response: "REFUSED" });
      }
    }

    const manifest = {
      kind: "capital-q.fictional-world.manifest",
      version: 1,
      generatedAt: new Date().toISOString(),
      note: "Fictional demo data. Every company, person and figure is invented.",
      target: { supabaseHost: new URL(target.supabaseUrl).host, apiHost: new URL(target.apiUrl).host },
      companies: manifestCompanies,
      investors: FICTIONAL_INVESTORS.map((investor) => ({
        key: investor.key,
        name: investor.name,
        investorOrganisationId: investors.get(investor.key)?.investorOrganisationId ?? null,
        mandateId: investors.get(investor.key)?.mandateId ?? null,
        email: investors.get(investor.key)?.email ?? null,
      })),
      interests,
    };
    writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    console.log(`manifest: ${join(outDir, "manifest.json")}`);
    if (!hosted) {
      console.log(`sign in as any founder.<key>@ / investor.<key>@fictional.capitalq.local with the local synthetic password (dev:bootstrap's).`);
    }
    return 0;
  } finally {
    await database.close();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`fictional world: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  },
);
