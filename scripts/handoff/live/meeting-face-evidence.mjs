// Read-only timeline of one meeting's face (lane 6, 2026-10-21). Reads
// only: the hosted DB via the Supabase Management API (select), and Tavus
// GET /v2/conversations/{id}?verbose=true. No starts, ends or writes; no
// transcript words are printed (role, time and length only).
//
// SUPABASE_ACCESS_TOKEN=... CQ_TAVUS_READ_KEY=... NODE_USE_ENV_PROXY=1 \
//   node scripts/handoff/live/meeting-face-evidence.mjs [--day 2026-10-21]
const PROJECT = "vcohxiqsmnkzxnvawgri";
const at = process.argv.indexOf("--day");
const day =
  at === -1 ? new Date().toISOString().slice(0, 10) : process.argv[at + 1];
if (!/^\d{4}-\d{2}-\d{2}$/u.test(day ?? ""))
  throw new Error("--day YYYY-MM-DD");

async function select(sql) {
  const response = await fetch(
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
  if (!response.ok) throw new Error(`supabase ${String(response.status)}`);
  return response.json();
}

const sessions = await select(`
  select f.meeting_id, f.status, f.ended_reason, f.face_id,
         f.created_at, f.provider_request_started_at, f.ended_at,
         f.provider_conversation_id, m.starts_at, m.status as meeting_status
    from communication.meeting_face_sessions f
    join communication.meetings m on m.id = f.meeting_id
   where f.created_at >= '${day}'::date and f.created_at < '${day}'::date + 1
   order by f.created_at`);

const ms = (a, b) =>
  a === null || b === null
    ? null
    : new Date(b).getTime() - new Date(a).getTime();

for (const row of sessions) {
  console.log(
    JSON.stringify({
      meetingId: row.meeting_id,
      faceId: row.face_id,
      status: row.status,
      ended: row.ended_reason,
      claimToPaidRequestMs: ms(row.created_at, row.provider_request_started_at),
      startsAt: row.starts_at,
    }),
  );
  const key = process.env.CQ_TAVUS_READ_KEY;
  if (key === undefined || row.provider_conversation_id === null) continue;
  const response = await fetch(
    `https://tavusapi.com/v2/conversations/${encodeURIComponent(row.provider_conversation_id)}?verbose=true`,
    { headers: { "x-api-key": key } },
  );
  if (!response.ok) {
    console.log(`  tavus ${String(response.status)}`);
    continue;
  }
  const conversation = await response.json();
  for (const event of conversation.events ?? []) {
    const props = event.properties ?? {};
    const transcript = Array.isArray(props.transcript) ? props.transcript : [];
    console.log(
      `  ${String(event.timestamp ?? event.created_at ?? "")} ${String(event.event_type ?? "")}` +
        (transcript.length === 0
          ? ""
          : ` turns=${transcript
              .map(
                (t) =>
                  `${String(t.role ?? "?")[0]}${String((t.content ?? "").length)}`,
              )
              .join(",")}`),
    );
  }
}
