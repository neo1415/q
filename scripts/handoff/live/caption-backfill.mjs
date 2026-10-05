/* global process, console, fetch */
// Caption backfill (R18): ask Cloudflare Stream to generate English
// captions for every live, READY pitch that has none.
//
//   node scripts/handoff/live/caption-backfill.mjs          # dry run
//   node scripts/handoff/live/caption-backfill.mjs --apply  # request
//
// Idempotent: a pitch whose video already has an "en" caption (ready or in
// progress) is never asked again. The hosted DB is only read (Management
// API, read_only). Storing the VTT as the pitch transcript, and flipping
// caption_state to AVAILABLE, is done by the API's caption sweep under the
// Media context's own rules; this script only gets generation started.
//
// Cost: Stream's AI-generated captions carry no charge beyond Stream
// (Cloudflare docs, "Generate captions with AI"). Reads here are free.
//
// Env: SUPABASE_ACCESS_TOKEN, CLOUDFLARE_STREAM_API_TOKEN (or
// CLOUDFLARE_API_KEY), optional CLOUDFLARE_ACCOUNT_ID (else resolved from
// the token's single account).
const APPLY = process.argv.includes("--apply");
const PROJECT = "vcohxiqsmnkzxnvawgri";
const LANG = "en";
const token =
  process.env.CLOUDFLARE_STREAM_API_TOKEN ?? process.env.CLOUDFLARE_API_KEY;
if (!token || token.startsWith("disabled")) {
  console.error("no Cloudflare Stream token in env");
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

async function cf(method, path) {
  const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

let account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!account) {
  const accounts = await cf("GET", "/accounts");
  const list = accounts.body?.result ?? [];
  if (list.length !== 1) {
    console.error(`set CLOUDFLARE_ACCOUNT_ID (token sees ${list.length})`);
    process.exit(2);
  }
  account = list[0].id;
}

const pitches = await hostedRead(`
  select id, provider_asset_id, caption_state, duration_seconds
    from media.media_assets m
   where purpose = 'FOUNDER_PITCH' and status = 'READY'
     and deleted_at is null and superseded_at is null
     and provider = 'CLOUDFLARE_STREAM' and provider_asset_id is not null
     and not exists (select 1 from media.pitch_transcripts t
                      where t.media_asset_id = m.id)
   order by ready_at`);

const tally = {
  needsRequest: 0,
  inProgress: 0,
  ready: 0,
  error: 0,
  requested: 0,
};
let seconds = 0;
for (const p of pitches) {
  const list = await cf(
    "GET",
    `/accounts/${account}/stream/${p.provider_asset_id}/captions`,
  );
  const entry = (list.body?.result ?? []).find((c) => c.language === LANG);
  const state =
    list.status !== 200
      ? `http-${list.status}`
      : entry === undefined
        ? "none"
        : (entry.status ?? "ready");
  if (state === "none") {
    tally.needsRequest += 1;
    seconds += Number(p.duration_seconds ?? 0);
    if (APPLY) {
      const asked = await cf(
        "POST",
        `/accounts/${account}/stream/${p.provider_asset_id}/captions/${LANG}/generate`,
      );
      if (asked.status === 200) tally.requested += 1;
      console.log(
        p.id,
        "requested",
        asked.status,
        asked.body?.result?.status ?? "",
      );
      continue;
    }
  } else if (state === "inprogress") tally.inProgress += 1;
  else if (state === "ready") tally.ready += 1;
  else tally.error += 1;
  console.log(p.id, p.caption_state, "stream:", state);
}
console.log(
  JSON.stringify({
    mode: APPLY ? "apply" : "dry-run",
    pitchesWithoutTranscript: pitches.length,
    ...tally,
    minutesToCaption: Math.round(seconds / 6) / 10,
    costUsd: 0,
  }),
);
