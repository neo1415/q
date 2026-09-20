#!/usr/bin/env node
/* global process, console, URL */
/**
 * Which provider carries demo traffic (CQ-REC-007 §15, §46).
 *
 *   node scripts/demo-routing-smoke.mjs
 *
 * Sends two bounded requests of SYNTHETIC text through the real Model
 * Gateway against the local catalogue, identical but for their data
 * posture, and prints the route each one took:
 *
 *   SYNTHETIC_DEMO  attested demo material — doc 15 §62 lets free
 *                   inference carry it, so the configured preference
 *                   (Gemini first) applies
 *   REAL_CUSTOMER   the same words treated as a customer's — the
 *                   reviewed ceilings decide, as they always have
 *
 * It proves the posture is doing the work rather than a raised ceiling:
 * if both rows name the same provider, nothing changed. LOCAL ONLY — the
 * allowance refuses to exist unless CAPITAL_Q_ENV is local/test and the
 * database is loopback. The prompt is about a fictional company and
 * carries no customer material of any kind.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

const envFile = resolve(root, ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match === null) continue;
    const [, name, value] = match;
    process.env[name] ??= value.replace(/^["']|["']$/g, "");
  }
}
process.env.NODE_ENV ??= "development";
process.env.CAPITAL_Q_ENV ??= "local";
// Pinned, not inherited, exactly as scripts/q-eval.mjs pins it. A
// developer's .env.local may name the hosted project; this smoke is about
// the local demo stack, and the allowance would refuse a hosted database
// anyway — which is the point, not an inconvenience.
process.env.DATABASE_URL =
  process.env.CQ_EVAL_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const gatewayDist = resolve(
  root,
  "packages",
  "model-gateway",
  "dist",
  "index.js",
);
if (!existsSync(gatewayDist)) {
  console.error("Build first: pnpm build --filter=@capital-q/model-gateway...");
  process.exit(2);
}

const {
  createModelGateway,
  createModelProviderRegistry,
  createPostgresModelCatalog,
  createInMemoryModelUsageRepository,
  createProcessLocalProviderHealth,
  createSyntheticDemoRoutingAllowance,
} = await import(
  pathToFileURL(resolve(root, "packages/model-gateway/dist/index.js")).href
);
const { createGoogleModelProvider } = await import(
  pathToFileURL(
    resolve(root, "packages/model-gateway/dist/providers/google.js"),
  ).href
);
const { createGroqModelProvider } = await import(
  pathToFileURL(resolve(root, "packages/model-gateway/dist/providers/groq.js"))
    .href
);
const { budgetForTaskClass } = await import(
  pathToFileURL(resolve(root, "packages/model-gateway/dist/q/index.js")).href
);
const { createRequestDatabaseClient } = await import(
  pathToFileURL(resolve(root, "packages/database/dist/index.js")).href
);
const { loadDatabaseConfig } = await import(
  pathToFileURL(resolve(root, "packages/config/dist/database.js")).href
);

const providers = [];
if (process.env.GEMINI_API_KEY !== undefined) {
  providers.push(
    createGoogleModelProvider({ apiKey: process.env.GEMINI_API_KEY }),
  );
}
if (process.env.GROQ_API_KEY !== undefined) {
  providers.push(createGroqModelProvider({ apiKey: process.env.GROQ_API_KEY }));
}
if (providers.length === 0) {
  console.error("No provider key configured; nothing to smoke.");
  process.exit(2);
}

const databaseConfig = loadDatabaseConfig();
const database = createRequestDatabaseClient(databaseConfig);

const syntheticDemo = createSyntheticDemoRoutingAllowance({
  operatorEnabled: true,
  environment: process.env.CAPITAL_Q_ENV,
  databaseUrl: databaseConfig.secrets.url,
});
console.log(`attestation: ${syntheticDemo.attestation.join(" · ")}\n`);

const gateway = createModelGateway({
  catalog: createPostgresModelCatalog({ sql: database.sql }),
  registry: createModelProviderRegistry(providers),
  usage: createInMemoryModelUsageRepository(),
  health: createProcessLocalProviderHealth(),
  syntheticDemo,
});

/** Invented company, invented investor. Nothing here belongs to anyone. */
const PROMPT =
  "In two sentences, explain that a fictional Seed-stage logistics software " +
  "company based in Nigeria aligns with a fictional investor's stated " +
  "preference for African B2B software at Seed. Do not invent any figures.";

async function run(dataPosture) {
  const started = Date.now();
  try {
    const result = await gateway.execute(
      {
        taskClass: "NORMAL_DIALOGUE",
        sensitivity: "NETWORK_VISIBLE",
        dataPosture,
        budget: budgetForTaskClass("NORMAL_DIALOGUE"),
        messages: [{ role: "USER", content: PROMPT }],
        output: { kind: "TEXT" },
        attribution: {
          tenantId: "00000000-0000-4000-8000-000000000000",
          correlationId: `cor_${randomUUID()}`,
        },
      },
      {},
    );
    const admitted = result.route.candidates.find(
      (c) => c.providerCode === result.providerCode,
    );
    console.log(
      [
        `posture        ${dataPosture}`,
        `task class     NORMAL_DIALOGUE`,
        `sensitivity    NETWORK_VISIBLE (declared, unchanged)`,
        `provider       ${result.providerCode}`,
        `model          ${result.modelCode}`,
        `admitted by    ${admitted?.reason ?? "unknown"}`,
        `fallback used  ${result.fallbackUsed}`,
        `latency        ${result.latencyMs} ms`,
        `answer         ${String(result.output.text ?? "")
          .slice(0, 160)
          .replace(/\s+/g, " ")}`,
      ].join("\n"),
    );
  } catch (error) {
    console.log(
      [
        `posture        ${dataPosture}`,
        `refused        ${error.failureClass ?? error.name}`,
        `candidates     ${(error.candidates ?? [])
          .map((c) => `${c.providerCode}/${c.modelCode}:${c.reason}`)
          .join(", ")}`,
        `latency        ${Date.now() - started} ms`,
      ].join("\n"),
    );
  }
  console.log("");
}

await run("SYNTHETIC_DEMO");
await run("REAL_CUSTOMER");
await database.close();
