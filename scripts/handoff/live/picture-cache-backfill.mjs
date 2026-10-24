// Picture cache backfill (egress, 2026-10-24): processed profile pictures
// were stored with `cache-control: no-store`, so every view fetched their
// bytes again from Storage. New pictures are stored cacheable
// (fix/egress-image-cache); this rewrites the ones already stored.
//
//   node scripts/handoff/live/picture-cache-backfill.mjs            # dry run
//   node scripts/handoff/live/picture-cache-backfill.mjs --apply    # rewrite
//   ... --apply --limit 50                                           # a batch
//
// Touches only processed pictures: bucket cq-profile-images, keys
// img/<tenant>/<row>.webp. Raw uploads (raw/...) and every other bucket are
// never read or written. Each picture is downloaded once and put back at
// the same key with the same bytes and content type; only its cache
// metadata changes. The key is the upload's alone and its bytes never
// change, so "immutable" is true of it.
//
// Cost: one download per picture rewritten (the dry run prints the total).
// Run it only after Storage is restored. Idempotent: a picture already
// carrying the target cache-control is skipped.
//
// Env: SUPABASE_ACCESS_TOKEN (Management API, read only: the listing),
// SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SECRET_KEY
// (--apply only: the Storage API). Set NODE_USE_ENV_PROXY=1 in the cloud
// sandbox. Nothing secret is printed.
const APPLY = process.argv.includes("--apply");
const limitAt = process.argv.indexOf("--limit");
const LIMIT =
  limitAt >= 0 ? Number.parseInt(process.argv[limitAt + 1] ?? "", 10) : null;
const PROJECT = "vcohxiqsmnkzxnvawgri";
const BUCKET = "cq-profile-images";
// Same value as PICTURE_CACHE_CONTROL in packages/public-identity.
const TARGET = "private, max-age=31536000, immutable";
const KEY = /^img\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/u;

if (LIMIT !== null && !(Number.isInteger(LIMIT) && LIMIT > 0)) {
  console.error("--limit takes a positive whole number");
  process.exit(2);
}

async function hostedRead(sql) {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT}/database/query`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: sql, read_only: true }),
    },
  );
  if (!r.ok) throw new Error(`hosted read ${r.status}: ${await r.text()}`);
  return r.json();
}

const rows = await hostedRead(`
  select name,
         coalesce((metadata->>'size')::bigint, 0) as size,
         metadata->>'mimetype' as mimetype,
         metadata->>'cacheControl' as cache_control
    from storage.objects
   where bucket_id = '${BUCKET}'
     and name like 'img/%'
     and coalesce(metadata->>'cacheControl', '') <> '${TARGET}'
   order by created_at`);

const wanted = rows.filter((row) => KEY.test(row.name));
const skipped = rows.length - wanted.length;
const batch = LIMIT === null ? wanted : wanted.slice(0, LIMIT);
const bytes = batch.reduce((sum, row) => sum + Number(row.size), 0);
const byControl = new Map();
for (const row of wanted) {
  const control = row.cache_control ?? "(none)";
  byControl.set(control, (byControl.get(control) ?? 0) + 1);
}
console.log(
  JSON.stringify(
    {
      mode: APPLY ? "apply" : "dry-run",
      bucket: BUCKET,
      target: TARGET,
      toRewrite: wanted.length,
      thisRun: batch.length,
      downloadBytesThisRun: bytes,
      unexpectedKeysLeftAlone: skipped,
      currentCacheControl: Object.fromEntries(byControl),
    },
    null,
    2,
  ),
);
if (!APPLY) process.exit(0);

const base = (
  process.env.SUPABASE_URL ??
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  ""
).replace(/\/+$/u, "");
const secret = process.env.SUPABASE_SECRET_KEY ?? "";
if (base === "" || secret === "" || secret.startsWith("disabled")) {
  console.error("--apply needs SUPABASE_URL and SUPABASE_SECRET_KEY");
  process.exit(2);
}
const credentials = { authorization: `Bearer ${secret}`, apikey: secret };
const path = (name) =>
  `${base}/storage/v1/object/${encodeURIComponent(BUCKET)}/${name
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;

let done = 0;
let failed = 0;
for (const row of batch) {
  try {
    const got = await fetch(path(row.name), { headers: credentials });
    if (!got.ok) throw new Error(`download ${got.status}`);
    const body = Buffer.from(await got.arrayBuffer());
    const put = await fetch(path(row.name), {
      method: "PUT",
      headers: {
        ...credentials,
        "content-type": row.mimetype ?? "image/webp",
        "cache-control": TARGET,
        "x-upsert": "true",
      },
      body,
    });
    if (!put.ok) throw new Error(`upload ${put.status}`);
    done += 1;
  } catch (error) {
    failed += 1;
    console.error(`${row.name}: ${error.message}`);
  }
}
console.log(JSON.stringify({ rewritten: done, failed }, null, 2));
process.exit(failed === 0 ? 0 : 1);
