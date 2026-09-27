#!/usr/bin/env node
/* global console, fetch, process, URL */
/**
 * Hosted migrations over HTTPS (the cloud VM cannot open Postgres ports).
 *
 *   SUPABASE_ACCESS_TOKEN=<personal access token> node scripts/handoff/hosted-migrate-https.mjs
 *       status + dry run: lists the migrations hosted has not applied and
 *       prints each file's statements for review. Writes nothing.
 *   ... hosted-migrate-https.mjs --apply <version> [<version> ...]
 *       applies exactly the named pending versions, in order, each in one
 *       transaction together with its supabase_migrations.schema_migrations
 *       row, so migration history stays what `supabase db push` would write.
 *
 * Standing founder approval covers additive or fix-forward migrations only:
 * a file that drops, truncates, deletes rows or loosens RLS is refused here
 * and waits for the founder. The token comes from the environment only and is
 * never printed. The project ref is fixed to the synthetic staging project.
 */
import { readFileSync, readdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

const PROJECT_REF = "vcohxiqsmnkzxnvawgri";
const ENDPOINT = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

const root = resolve(
  new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
);
const dir = resolve(root, "supabase/migrations");

const token = (
  process.env.SUPABASE_ACCESS_TOKEN ?? process.env.SUPABASE_MANAGEMENT_TOKEN
)?.trim();
if (!token) {
  console.error(
    "SUPABASE_ACCESS_TOKEN must be set (Supabase personal access token).",
  );
  process.exit(2);
}

async function query(sql) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Management API ${response.status}: ${text.slice(0, 800)}`);
  }
  return text.length === 0 ? [] : JSON.parse(text);
}

// Not a parser: a conservative screen. Anything it flags is read by a human.
const REFUSED = [
  /\bdrop\s+(table|column|schema|type|function|view|policy|trigger|index)\b/i,
  /\btruncate\b/i,
  /\bdelete\s+from\b/i,
  /\bdisable\s+row\s+level\s+security\b/i,
  /\bgrant\b[^;]*\bto\s+(anon|public)\b/i,
];

function dollarQuote(text) {
  let tag;
  do {
    tag = `m${randomBytes(6).toString("hex")}`;
  } while (text.includes(`$${tag}$`));
  return `$${tag}$${text}$${tag}$`;
}

const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((file) => {
    const [version, ...rest] = file.replace(/\.sql$/, "").split("_");
    return { file, version, name: rest.join("_") };
  });

const applied = new Set(
  (
    await query(
      "select version from supabase_migrations.schema_migrations order by version",
    )
  ).map((row) => row.version),
);
const pending = files.filter((f) => !applied.has(f.version));
const unknown = [...applied].filter((v) => !files.some((f) => f.version === v));

console.log(`hosted applied: ${applied.size}, local: ${files.length}`);
console.log(
  "missing on hosted:",
  pending.map((f) => f.version).join(" ") || "none",
);
console.log("on hosted but not local:", unknown.join(" ") || "none");

const applyIndex = process.argv.indexOf("--apply");
if (applyIndex === -1) {
  for (const f of pending) {
    const sql = readFileSync(resolve(dir, f.file), "utf8");
    const flags = REFUSED.filter((pattern) => pattern.test(sql)).map(String);
    console.log(
      `\n==== ${f.file} (${sql.length} chars)${flags.length ? ` REFUSED: ${flags.join(", ")}` : ""}`,
    );
    console.log(sql);
  }
  process.exit(pending.length === 0 ? 0 : 1);
}

const wanted = process.argv.slice(applyIndex + 1);
if (wanted.length === 0) {
  console.error("--apply needs at least one pending version.");
  process.exit(2);
}
for (const version of wanted) {
  const f = pending.find((p) => p.version === version);
  if (!f) {
    console.error(
      `${version} is not a pending local migration; nothing applied.`,
    );
    process.exit(2);
  }
  // Migrations apply in version order: a later one may depend on an earlier.
  const earlier = pending.filter(
    (p) => p.version < version && !wanted.includes(p.version),
  );
  if (earlier.length > 0) {
    console.error(
      `${version} would skip pending ${earlier.map((p) => p.version).join(" ")}.`,
    );
    process.exit(2);
  }
}
for (const f of pending.filter((p) => wanted.includes(p.version))) {
  const sql = readFileSync(resolve(dir, f.file), "utf8");
  const flags = REFUSED.filter((pattern) => pattern.test(sql));
  if (flags.length > 0) {
    console.error(
      `${f.file}: refused (${flags.map(String).join(", ")}); needs the founder.`,
    );
    process.exit(3);
  }
  await query(
    [
      "begin;",
      sql,
      ";",
      "insert into supabase_migrations.schema_migrations (version, name, statements)",
      `values ('${f.version}', ${dollarQuote(f.name)}, array[${dollarQuote(sql)}]);`,
      "commit;",
    ].join("\n"),
  );
  console.log(`applied ${f.file}`);
}

const after = new Set(
  (
    await query("select version from supabase_migrations.schema_migrations")
  ).map((row) => row.version),
);
const stillMissing = files
  .filter((f) => !after.has(f.version))
  .map((f) => f.version);
console.log(
  `hosted applied now: ${after.size}; still missing: ${stillMissing.join(" ") || "none"}`,
);
