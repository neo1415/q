// Two bounded internal Q questions using an existing authorized fictional
// investor session. No approval, outreach, voice/video or account creation.
// Protected receipts include private answer text; never commit them.
// CQ_PUBLIC_JSON=... CQ_SESSION_FILE=... CQ_BENCH_REVISION=<deployed SHA>
// NODE_USE_ENV_PROXY=1 node scripts/handoff/live/memory-recall-benchmark.mjs
import { writeFileSync, mkdtempSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { signIn, Q_API } from "./fictional-session.mjs";
const s = await signIn("investor.savanna-seed@fictional.capitalq.local", Q_API);
const dir = mkdtempSync("/tmp/cq-memory-live-");
const cases = [
  {
    name: "review-diligence",
    text: "Which investment memos did your agents revise, what did the reviewers identify, and which decisions are still awaiting me? Use my existing records, with dates, and leave anything requiring approval untouched.",
  },
  {
    name: "mandate-multihop",
    text: "Which companies have we discussed recently that fit my mandate, what did your agents find, and which unresolved risks remain? Use our existing records and distinguish missing evidence from negative evidence.",
  },
];
const results = [];
for (const c of cases) {
  const start = performance.now();
  const res = await fetch(Q_API + "/v1/q/runs", {
    method: "POST",
    headers: {
      authorization: "Bearer " + s.accessToken,
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    body: JSON.stringify({
      capability: "ANSWER",
      message: { text: c.text },
      modality: "TEXT",
    }),
  });
  const created = await res.json();
  if (!created.runId) throw Error("create " + res.status);
  const creationMs = Math.round(performance.now() - start);
  let firstTextMs = null,
    firstStreamTextMs = null,
    first20StreamCharsMs = null,
    streamPreview = "",
    run;
  const controller = new AbortController();
  const stream = fetch(Q_API + "/v1/q/runs/" + created.runId + "/events", {
    headers: { authorization: "Bearer " + s.accessToken },
    signal: controller.signal,
  })
    .then(async (r) => {
      if (!r.ok) return;
      const reader = r.body.getReader();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += new TextDecoder().decode(value);
        let end;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = frame
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trim())
            .join("");
          try {
            const event = JSON.parse(data);
            if (
              event.type === "q.message.delta" &&
              typeof event.data?.text === "string"
            ) {
              const elapsed = Math.round(performance.now() - start);
              streamPreview = (streamPreview + event.data.text).slice(0, 2_000);
              if (event.data.text.trim() && firstStreamTextMs === null)
                firstStreamTextMs = elapsed;
              if (
                streamPreview.trim().length >= 20 &&
                first20StreamCharsMs === null
              )
                first20StreamCharsMs = elapsed;
            }
          } catch {
            // Heartbeats and malformed frames do not establish response text.
          }
        }
      }
    })
    .catch(() => {});
  for (let i = 0; i < 160; i++) {
    const r = await fetch(Q_API + "/v1/q/runs/" + created.runId, {
      headers: { authorization: "Bearer " + s.accessToken },
    });
    run = await r.json();
    if (
      (run.messages ?? []).some((m) => m.role === "Q" && m.text?.trim()) &&
      firstTextMs === null
    )
      firstTextMs = Math.round(performance.now() - start);
    if (
      [
        "COMPLETED",
        "FAILED",
        "CANCELLED",
        "AWAITING_APPROVAL",
        "AWAITING_INPUT",
      ].includes(run.status)
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  controller.abort();
  await stream;
  writeFileSync(
    dir + "/" + c.name + ".json",
    JSON.stringify({ request: c, created, run, streamPreview }),
    { mode: 0o600 },
  );
  const q =
    (run.messages ?? []).filter((m) => m.role === "Q").at(-1)?.text ?? "";
  const record = {
    case: c.name,
    creationMs,
    firstTextMs,
    firstStreamTextMs,
    first20StreamCharsMs,
    totalMs: Math.round(performance.now() - start),
    status: run.status,
    replyChars: q.length,
  };
  results.push(record);
  console.log(JSON.stringify(record));
}
writeFileSync(
  dir + "/summary.json",
  JSON.stringify({ revision: process.env.CQ_BENCH_REVISION, results }),
  { mode: 0o600 },
);
console.log(JSON.stringify({ evidenceDir: dir }));
