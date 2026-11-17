// Supersede the stale conversation summaries that carry Q's wrong counts of
// Halyard Security's 2027 hiring plan, for Thames Arc's investor (16 Nov
// 2026; conversations 8811f9c7, e7e3c866, 2a26d43b, 28071f0c, and on 17 Nov
// 1de1cf20).
//
// Q said "4 public-sector account managers" and "five in Q1"; the plan's
// rows say 3 and Q1 = 4. Those answers were folded into the conversations'
// summaries and recalled into later conversations. This script holds each
// summary's counts to the plan's own text with the product's code
// (`summaryCorrections`, the same check the answer runs on recalled
// summaries) and supersedes a contradicted one through the product's own
// route (`supersedeConversationSummary`): an appended summary revision with
// the counts put right, the conversation's digest moved to it, the stale
// revision kept as history. Nothing is deleted; no ad-hoc SQL write.
//
// Idempotent: a summary that no longer holds the text the correction was
// computed from (already corrected, or moved on by a newer turn) is left
// alone, and a summary whose counts agree with the plan needs nothing.
//
//   node scripts/seed/evidence/supersede-stale-summaries.mjs           # dry run (default)
//   node scripts/seed/evidence/supersede-stale-summaries.mjs --apply   # the lead only
//
// Dry run: read-only SQL through the Supabase management API
// (SUPABASE_ACCESS_TOKEN; NODE_USE_ENV_PROXY=1 in the cloud sandbox). It
// prints ids and counts only, never summary text.
// --apply: DATABASE_URL (the services' own database URL, never printed);
// writes only through supersedeConversationSummary.
// Needs built package dist: pnpm exec turbo run build --filter=./packages/*
//
// Logs ids and counts only: no summary, document text, email or key.

import { createRequire } from "node:module";

const require = createRequire(
  new URL("../../../apps/q-api/package.json", import.meta.url),
);
const load = (name) => import(require.resolve(name));

const PROJECT = "vcohxiqsmnkzxnvawgri";
const TENANT = "47677daa-109b-4b92-add7-a5a94f91ed9c";
const USER = "fd9945d9-a463-4b01-949f-0be1aee9e5c8";
const CONVERSATIONS = [
  "8811f9c7-9d7a-42f6-9cae-4ae22c069a08",
  "e7e3c866-46d4-4982-a799-d839c6ab2fed",
  "2a26d43b-a752-4888-a8e4-b4997feea592",
  "28071f0c-b1e1-45c6-b68c-2e089c5a385b",
  // 17 Nov, runs 434ead80 and 2b4011a0: answered from recall alone.
  "1de1cf20-91d2-4563-b144-31041fa12c13",
];
// Halyard Security's "Team and hiring plan", the document the counts are
// held to (q_knowledge.chunks, ACTIVE, in order).
const PLAN_VERSION = "876b3b30-b39b-4eda-aec4-50636c0685a8";
const HALYARD = "1ab2cc02-160f-4812-a6b1-8be7e43afd3e";

const apply = process.argv.includes("--apply");
const UUID = /^[0-9a-f-]{36}$/u;

async function readOnly(query) {
  if (!/^\s*select\b/iu.test(query)) throw new Error("select only");
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (token === undefined || token.length === 0) {
    throw new Error("SUPABASE_ACCESS_TOKEN is not set");
  }
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT}/database/query`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, read_only: true }),
    },
  );
  if (!response.ok) throw new Error(`read failed: ${response.status}`);
  return response.json();
}

const ids = CONVERSATIONS.map((id) => `'${id}'`).join(",");

const conversations = await readOnly(
  `select c.id::text as id, c.summary,
          (select max(r.revision) from q_runtime.conversation_summary_revisions r
            where r.conversation_id = c.id) as revision
     from q_runtime.conversations c
    where c.id in (${ids})
      and c.tenant_id = '${TENANT}' and c.user_id = '${USER}'
      and c.summary is not null
    order by c.created_at`,
);
const chunks = await readOnly(
  `select content from q_knowledge.chunks
    where document_version_id = '${PLAN_VERSION}'
      and subject_type = 'COMPANY' and subject_id = '${HALYARD}'
      and status = 'ACTIVE'
    order by chunk_index`,
);
if (chunks.length === 0) throw new Error("the plan's chunks were not read");

const { summaryCorrections } = await load("@capital-q/model-gateway/q");
const runtime = await load("@capital-q/q-runtime");

const corrections = summaryCorrections(
  conversations.map((c) => ({ conversationId: c.id, summary: c.summary })),
  chunks.map((chunk) => chunk.content),
  [],
);
const corrected = new Map(corrections.map((c) => [c.conversationId, c]));

for (const c of conversations) {
  const correction = corrected.get(c.id);
  if (correction === undefined) {
    console.log(`conversation=${c.id} revision=${c.revision} UNCHANGED`);
    continue;
  }
  const gated = runtime.gateConversationSummary({
    summary: correction.summary,
    sources: [correction.from, ...correction.grounds],
  });
  console.log(
    `conversation=${c.id} revision=${c.revision} -> ${Number(c.revision) + 1}` +
      ` corrected=${correction.corrected} dropped=${correction.dropped}` +
      ` gate=${gated.kind}${apply ? "" : " (dry run)"}`,
  );
}
console.log(
  `summaries=${conversations.length} to-supersede=${corrections.length}`,
);

if (apply && corrections.length > 0) {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url.length === 0) {
    throw new Error("--apply needs DATABASE_URL");
  }
  // The driver the database package itself uses (no dependency added).
  const fromDatabase = createRequire(
    new URL("../../../packages/database/package.json", import.meta.url),
  );
  const postgres = (await import(fromDatabase.resolve("postgres"))).default;
  const database = await load("@capital-q/database");
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    const repositories = runtime.createPostgresQRuntimeRepositories();
    for (const correction of corrections) {
      if (!UUID.test(correction.conversationId)) continue;
      const outcome = await runtime.supersedeConversationSummary(
        {
          sql,
          transactions: database.createTransactionManager(sql),
          conversations: repositories.conversations,
          states: repositories.conversationStates,
        },
        {
          tenantId: TENANT,
          userId: USER,
          conversationId: correction.conversationId,
          from: correction.from,
          summary: correction.summary,
          grounds: correction.grounds,
        },
      );
      console.log(
        `conversation=${correction.conversationId} ${outcome.kind}${
          outcome.kind === "SUPERSEDED" ? ` revision=${outcome.revision}` : ""
        }`,
      );
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}
