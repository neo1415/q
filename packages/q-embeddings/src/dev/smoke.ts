import { loadEmbeddingConfig } from "@capital-q/config/embeddings";

import {
  QWEN3_EMBEDDING_CONFIGURATION,
  EMBEDDING_DOCUMENT_INSTRUCTION_VERSION,
  EmbeddingProviderFailure,
  EVIDENCE_RETRIEVAL_INSTRUCTION,
} from "../contracts/index.js";
import { createEmbeddingService } from "../application/service.js";
import { cosineSimilarity, vectorNorm } from "../domain/vector.js";
import { createLocalTeiEmbeddingProvider } from "../infrastructure/local-tei-provider.js";

/**
 * The live local embedding smoke (CQ-RAG-002 §49-§50).
 *
 *   pnpm rag:embedding:smoke [--health-only]
 *
 * Asks the local runtime what it is serving, embeds synthetic documents and
 * a synthetic query, and checks the properties that would otherwise only
 * fail much later: 1024 finite values, unit length, and a clearly relevant
 * passage scoring above a clearly unrelated one.
 *
 * Every fixture below is invented. No private content, no external API, no
 * credential and no cost: the model runs on this machine.
 */

const SYNTHETIC_QUERY =
  "Which company is raising seed capital for infrastructure software?";

const SYNTHETIC_DOCUMENTS = [
  {
    label: "relevant",
    text: "Northstar Systems is a seed-stage B2B infrastructure software company raising GBP 2 million to expand its platform team.",
  },
  {
    label: "unrelated",
    text: "An agricultural cooperative in the eastern region exports cocoa beans and operates three drying facilities.",
  },
  {
    label: "adjacent",
    text: "Northwind Sensor Systems sells vibration sensors to manufacturing plants and reports four customers on annual contracts.",
  },
] as const;

const ms = (value: number) => `${String(Math.round(value))} ms`;

async function main(): Promise<number> {
  const healthOnly = process.argv.includes("--health-only");
  const config = loadEmbeddingConfig();
  const provider = createLocalTeiEmbeddingProvider({
    baseUrl: config.baseUrl,
    configuration: {
      ...QWEN3_EMBEDDING_CONFIGURATION,
      maxBatchItems: config.maxBatchItems,
    },
    timeoutMs: config.timeoutMs,
  });
  const service = createEmbeddingService({ provider });
  const descriptor = service.describe();

  console.log(`provider:      ${descriptor.providerCode}`);
  console.log(
    `endpoint:      ${descriptor.endpoint ?? "-"} (private network only)`,
  );
  console.log(`model:         ${descriptor.configuration.modelCode}`);
  console.log(
    `revision:      ${descriptor.configuration.modelRevision ?? "unpinned"}`,
  );
  console.log(
    `configuration: ${descriptor.configuration.configurationVersion}`,
  );
  console.log(
    `dimension:     ${String(descriptor.configuration.dimension)} · normalization ${descriptor.configuration.normalization} · instructions ${descriptor.configuration.instructionStrategy}`,
  );
  console.log("");

  const health = await service.health();
  console.log(
    `health:        ${health.state} — ${health.detail} (${ms(health.latencyMs)})`,
  );
  if (health.reportedModelCode !== null) {
    console.log(
      `runtime says:  ${health.reportedModelCode} @ ${health.reportedModelRevision ?? "unknown revision"} · TEI ${health.runtimeVersion ?? "?"} · max input ${String(health.reportedMaxInputTokens ?? 0)} tokens`,
    );
  }
  if (health.state !== "READY") {
    console.log("");
    console.log(
      "BLOCKED — the local embedding runtime is not serving the configured model.",
    );
    console.log(
      "Start it with: pnpm embedding:up   (first run downloads the weights)",
    );
    return 1;
  }
  if (healthOnly) {
    return 0;
  }

  console.log("");
  const documents = SYNTHETIC_DOCUMENTS.map((d) => d.text);
  const batch = await service.embedDocuments(documents);
  console.log(
    `documents:     ${String(batch.embeddings.length)} embedded in ${ms(batch.latencyMs)} (${ms(batch.latencyMs / batch.embeddings.length)} each)`,
  );
  let ok = true;
  batch.embeddings.forEach((embedding, at) => {
    const norm = vectorNorm(embedding.vector);
    const finite = embedding.vector.every((v) => Number.isFinite(v));
    const dimensionOk =
      embedding.dimension === descriptor.configuration.dimension;
    const normOk = Math.abs(norm - 1) < 1e-3;
    ok = ok && finite && dimensionOk && normOk;
    console.log(
      `  ${(SYNTHETIC_DOCUMENTS[at]?.label ?? "?").padEnd(10)} dim ${String(embedding.dimension)} ${dimensionOk ? "OK" : "WRONG"} · finite ${finite ? "OK" : "NO"} · norm ${norm.toFixed(6)} ${normOk ? "OK" : "NOT UNIT"} · instruction ${embedding.instructionVersion} · sha ${embedding.inputSha256.slice(0, 12)}`,
    );
  });
  if (
    batch.embeddings.some(
      (e) => e.instructionVersion !== EMBEDDING_DOCUMENT_INSTRUCTION_VERSION,
    )
  ) {
    console.log("  FAIL: a document carried a query instruction");
    ok = false;
  }

  console.log("");
  const query = await service.embedQuery(SYNTHETIC_QUERY, "EVIDENCE_RETRIEVAL");
  console.log(
    `query:         embedded in ${ms(query.latencyMs)} · dim ${String(query.dimension)} · norm ${vectorNorm(query.vector).toFixed(6)}`,
  );
  console.log(
    `instruction:   ${query.instructionVersion} — "${EVIDENCE_RETRIEVAL_INSTRUCTION.instruction}"`,
  );

  console.log("");
  console.log("similarity to the query (cosine):");
  const scores = batch.embeddings.map((embedding, at) => ({
    label: SYNTHETIC_DOCUMENTS[at]?.label ?? "?",
    score: cosineSimilarity(query.vector, embedding.vector),
  }));
  for (const { label, score } of [...scores].sort(
    (a, b) => b.score - a.score,
  )) {
    console.log(`  ${label.padEnd(10)} ${score.toFixed(4)}`);
  }
  const relevant = scores.find((s) => s.label === "relevant")?.score ?? 0;
  const unrelated = scores.find((s) => s.label === "unrelated")?.score ?? 1;
  const semantic = relevant > unrelated;
  console.log("");
  console.log(
    `semantic relevance: ${semantic ? "PASS" : "FAIL"} — the seed-stage infrastructure passage scores ${semantic ? "above" : "below"} the cocoa exporter`,
  );
  console.log(
    `vectors: ${String(batch.embeddings.length + 1)} produced locally · external API calls 0 · cost $0`,
  );
  return ok && semantic ? 0 : 1;
}

try {
  process.exitCode = await main();
} catch (error: unknown) {
  if (error instanceof EmbeddingProviderFailure) {
    console.error(
      `embedding failure: ${error.failureClass} — ${error.message}`,
    );
    console.error("Start the runtime with: pnpm embedding:up");
    process.exitCode = 1;
  } else {
    throw error;
  }
}
