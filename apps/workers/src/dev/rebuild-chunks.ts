/* eslint-disable no-console */
import { loadDatabaseConfig } from "@capital-q/config/database";
import { loadWorkerConfig } from "@capital-q/config/workers";
import { createRequestDatabaseClient } from "@capital-q/database";
import { createSupabaseDocumentStorageProvider } from "@capital-q/evidence";
import { createQKnowledgeService } from "@capital-q/q-knowledge";

/**
 * Chunk rebuild and inspection (CQ-RAG-001 §76).
 *
 *   pnpm rag:rebuild-chunks -- --tenant <id> --document-version <id>
 *       [--chunking-version q-chunking-vN] [--pipeline-version evidence-processing-v1]
 *   pnpm rag:rebuild-chunks -- --tenant <id> --document-version <id> --list
 *
 * An operator command over the worker's own credentials: it reads the
 * recorded extraction artifact from private storage, verifies its hash,
 * and derives a chunk set under the named chunking version. Source and
 * extraction rows are never touched; an existing identical set is reported,
 * not rewritten. Not an HTTP endpoint and never will be.
 */

function parseArgs(argv: readonly string[]): Record<string, string | true> {
  const flags: Record<string, string | true> = {};
  for (let at = 0; at < argv.length; at += 1) {
    const arg = argv[at] ?? "";
    if (!arg.startsWith("--")) continue;
    const next = argv[at + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[arg.slice(2)] = next;
      at += 1;
    } else {
      flags[arg.slice(2)] = true;
    }
  }
  return flags;
}

async function main(): Promise<number> {
  const flags = parseArgs(process.argv.slice(2));
  const tenantId = flags["tenant"];
  const documentVersionId = flags["document-version"];
  if (typeof tenantId !== "string" || typeof documentVersionId !== "string") {
    console.error(
      "usage: rag:rebuild-chunks -- --tenant <id> --document-version <id> [--chunking-version v] [--pipeline-version v] [--list]",
    );
    return 2;
  }
  const config = loadWorkerConfig();
  const database = createRequestDatabaseClient(loadDatabaseConfig());
  try {
    const storage =
      config.public.supabaseUrl !== undefined &&
      config.secrets.supabaseSecretKey !== undefined
        ? createSupabaseDocumentStorageProvider({
            supabaseUrl: config.public.supabaseUrl,
            secretKey: config.secrets.supabaseSecretKey,
          })
        : undefined;
    const knowledge = createQKnowledgeService({
      sql: database.sql,
      transactions: database.transactions,
      storage,
    });

    if (flags["list"] === true) {
      const sets = await knowledge.listChunkSets({
        tenantId,
        documentVersionId,
      });
      console.log(
        `${String(sets.length)} chunk set(s) for version ${documentVersionId}`,
      );
      for (const set of sets) {
        console.log(
          `  ${set.id} ${set.status.padEnd(10)} ${set.chunkingVersion} ${set.chunkingStrategy.padEnd(11)} ${set.extractorId}@${set.extractorVersion} chunks ${String(set.chunkCount)} tokens ~${String(set.tokenEstimate)} ${set.visibilityScope}/${set.sensitivityClass}${set.statusReason === null ? "" : ` (${set.statusReason})`}`,
        );
      }
      return 0;
    }

    if (storage === undefined) {
      console.error(
        "rebuild needs the private storage credential (SUPABASE_URL and SUPABASE_SECRET_KEY): NOT AVAILABLE",
      );
      return 2;
    }
    const chunkingVersion = flags["chunking-version"];
    const pipelineVersion = flags["pipeline-version"];
    const result = await knowledge.rebuildChunkSet({
      tenantId,
      documentVersionId,
      ...(typeof chunkingVersion === "string" ? { chunkingVersion } : {}),
      ...(typeof pipelineVersion === "string" ? { pipelineVersion } : {}),
    });
    switch (result.outcome) {
      case "BUILT":
        console.log(
          `BUILT set ${result.chunkSet.id}: ${String(result.chunkCount)} chunks, strategy ${result.plan.strategy}, ${result.chunkSet.chunkingVersion}, status ${result.chunkSet.status}${result.supersededSetIds.length === 0 ? "" : `, superseded ${String(result.supersededSetIds.length)} set(s)`}`,
        );
        return 0;
      case "ALREADY_BUILT":
        console.log(
          `ALREADY_BUILT set ${result.chunkSet.id} (${result.chunkSet.chunkingVersion}, status ${result.chunkSet.status}); an identical rebuild is a no-op by design — name a new --chunking-version to derive a new set`,
        );
        return 0;
      case "SKIPPED":
        console.log(`SKIPPED: ${result.reason}`);
        return 1;
    }
  } finally {
    await database.close();
  }
}

process.exitCode = await main();
