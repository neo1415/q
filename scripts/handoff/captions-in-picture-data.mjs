/**
 * Data change (not a schema migration), QA F-31: mark the seeded pitch
 * videos whose picture already shows captions, so the player adds no
 * caption track of its own and offers no captions switch for them.
 *
 * The asset ids come from the read-only sweep of 2026-11-05:
 * docs/ai-handoff/receipts/2026-11-05-burned-captions/sweep.json (a frame
 * grab per asset sits beside it).
 *
 * Run only AFTER migration 20261231240000_media_captions_in_picture.sql is
 * applied:
 *   node scripts/handoff/captions-in-picture-data.mjs            # dry run: prints the SQL, checks the column
 *   node scripts/handoff/captions-in-picture-data.mjs --apply    # sets the flag, reports the rows changed
 *
 * Idempotent: rows already true are left alone. Only founder pitches with
 * these exact ids are touched; nothing is deleted or loosened. The token
 * comes from the environment only and is never printed; the project ref is
 * fixed, as in hosted-migrate-https.mjs.
 */
import { readFileSync } from "node:fs";

const PROJECT_REF = "vcohxiqsmnkzxnvawgri";
const ENDPOINT = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;
const SWEEP = new URL(
  "../../docs/ai-handoff/receipts/2026-11-05-burned-captions/sweep.json",
  import.meta.url,
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const sweep = JSON.parse(readFileSync(SWEEP, "utf8"));
const ids = sweep
  .filter((row) => row.captionsInPicture === true)
  .map((row) => row.mediaAssetId);
if (ids.length === 0 || !ids.every((id) => UUID.test(id))) {
  console.error("The sweep lists no valid asset ids; nothing to do.");
  process.exit(2);
}

const list = ids.map((id) => `'${id}'::uuid`).join(", ");
const UPDATE = `update media.media_assets
   set captions_in_picture = true
 where id in (${list})
   and purpose = 'FOUNDER_PITCH'
   and captions_in_picture = false
returning id`;
const COLUMN_CHECK = `select count(*)::int as n
  from information_schema.columns
 where table_schema = 'media' and table_name = 'media_assets'
   and column_name = 'captions_in_picture'`;

const apply = process.argv.includes("--apply");
console.log(`${ids.length} assets from the sweep:\n  ${ids.join("\n  ")}`);
console.log(`\nSQL${apply ? "" : " (dry run, not executed)"}:\n${UPDATE};\n`);

const token = (
  process.env.SUPABASE_ACCESS_TOKEN ?? process.env.SUPABASE_MANAGEMENT_TOKEN
)?.trim();
if (!token) {
  console.error(
    "SUPABASE_ACCESS_TOKEN must be set to check the column or apply.",
  );
  process.exit(apply ? 2 : 0);
}

async function query(sql, readOnly) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query: sql, read_only: readOnly }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Management API ${response.status}: ${text.slice(0, 400)}`);
  }
  return text.length === 0 ? [] : JSON.parse(text);
}

const [column] = await query(COLUMN_CHECK, true);
if (column?.n !== 1) {
  console.error(
    "media.media_assets.captions_in_picture does not exist yet: apply migration 20261231240000 first.",
  );
  process.exit(2);
}
console.log("Column present.");
if (!apply) {
  console.log("Dry run only. Re-run with --apply to set the flag.");
  process.exit(0);
}
const changed = await query(UPDATE, false);
console.log(
  `Set captions_in_picture on ${changed.length} of ${ids.length} assets (the rest were already set or are not founder pitches).`,
);
