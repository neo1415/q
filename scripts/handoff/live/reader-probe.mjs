// What TURN_READER reads from one turn, with its recent turns, as the
// active prompt renders it (diagnostic, owner 2026-10-23: call prep did
// not route live and no log showed the reading). The prompt and its output
// schema come from createQTurnReader itself (a capturing gateway); the
// rendered request is then sent once to the OpenAI Responses API, the
// route the reader takes in production. Costs one small classification
// call. Needs OPENAI_API_KEY and READER_MODEL (the production reader's
// model, from the routing policy; no default is written here), and
// NODE_USE_ENV_PROXY=1 in the cloud sandbox.
//
//   node scripts/handoff/live/reader-probe.mjs turns.json
//
// turns.json: ["first user turn", "Q's reply", ..., "the turn to read"]
// (alternating USER / Q, the last one the user's).
import { readFileSync } from "node:fs";

const { createQTurnReader } = await import(
  new URL("../../../packages/model-gateway/dist/q/index.js", import.meta.url)
);
const turns = JSON.parse(readFileSync(process.argv[2], "utf8"));
const utterance = turns.at(-1);
const recentTurns = turns.slice(0, -1).map((text, index) => ({
  role: index % 2 === 0 ? "USER" : "Q",
  text,
}));
let captured = null;
const gateway = {
  execute: async (request) => {
    captured = request;
    throw Object.assign(new Error("captured"), { failureClass: "CANCELLED" });
  },
};
const logger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  child() {
    return logger;
  },
};
await createQTurnReader({ gateway, logger }).read({
  utterance,
  recentTurns,
  modality: "TEXT",
  attribution: { tenantId: "t", userId: "u", correlationId: "probe" },
});
if (captured === null) throw new Error("the reader rendered nothing");
const model = process.env.READER_MODEL;
if (!model) throw new Error("set READER_MODEL");
const system = captured.messages
  .filter((m) => m.role === "SYSTEM")
  .map((m) => m.content)
  .join("\n\n");
const input = captured.messages
  .filter((m) => m.role !== "SYSTEM")
  .map((m) => ({
    role: m.role === "USER" ? "user" : "assistant",
    content: m.content,
  }));
const response = await fetch("https://api.openai.com/v1/responses", {
  method: "POST",
  headers: {
    authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    model,
    instructions: system,
    input,
    reasoning: { effort: "low" },
    store: false,
    text: {
      format: {
        type: "json_schema",
        name: captured.output.schemaName,
        schema: captured.output.jsonSchema,
        strict: false,
      },
    },
  }),
});
const body = await response.json();
if (!response.ok) {
  console.log(response.status, JSON.stringify(body).slice(0, 300));
  process.exit(1);
}
const text = (body.output ?? [])
  .flatMap((item) => item.content ?? [])
  .map((part) => part.text ?? "")
  .join("");
const reading = JSON.parse(text);
console.log(
  JSON.stringify(
    {
      kind: reading.kind,
      confidence: reading.confidence,
      question: reading.question?.kind ?? null,
      teamJob: reading.teamJob,
      meetingPrep: reading.meetingPrep,
      namedOther: reading.namedOther,
      fromShown: reading.fromShown,
      handOver: reading.handOver,
      tool: reading.tool?.kind ?? null,
    },
    null,
    2,
  ),
);
