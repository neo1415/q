#!/usr/bin/env node
/* global process, console, Buffer, URL */
/**
 * Recovery G: a loopback stand-in for the model and voice vendors.
 *
 *   node scripts/recovery/fake-vendors.mjs            # port 3990
 *   CQ_FAKE_PORT=3990 CQ_FAKE_SCRIPT=<file.json> node scripts/recovery/fake-vendors.mjs
 *
 * q-api's OpenAI adapter builds `new OpenAI({ apiKey })` with no base URL
 * (packages/model-gateway/src/providers/openai.ts:346), and the SDK then
 * reads OPENAI_BASE_URL. Pointing that here exercises the real adapter, the
 * gateway, the routing policies and the Q answer path with no vendor and no
 * product change. Only the subset of the Responses API the adapter reads is
 * spoken: `output[]` message and function_call items, `usage`, `status`,
 * and the SSE events response.created / response.output_text.delta /
 * response.completed.
 *
 * Answers are scripted, so a browser test knows what Q "decided" and checks
 * that the product carried it out. Rules are first-match:
 *
 *   { "rules": [ {
 *       "name": "open-readiness",
 *       "when": { "user": "readiness", "tool": "operate_screen",
 *                 "instructions": "regex", "afterTool": "operate_screen" },
 *       "reply": { "toolCalls": [ { "name": "operate_screen", "arguments": {…} } ] }
 *     } ] }
 *
 * reply is one of: {text}, {json}, {toolCalls[, text]}, {status, body}
 * (an HTTP failure such as 429 or 500), {hang: true} (never answers; the
 * caller's timeout is under test), each with optional delayMs.
 *
 * No rule matched: an honest, recognisable answer, so a missing rule shows
 * up in the UI instead of looking like Q's judgment.
 *
 * Every request is appended to $CQ_FAKE_LOG (NDJSON) with the full input,
 * so a test can assert what the model was and was not shown (the Context
 * Firewall). Synthetic data only; this file never leaves the machine.
 *
 * Control (loopback only): GET /__fake/health, GET /__fake/requests?since=n,
 * PUT /__fake/script (in-memory script, wins over the file),
 * DELETE /__fake/script.
 */
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.CQ_FAKE_PORT ?? 3990);
const SCRIPT_FILE = resolve(
  process.env.CQ_FAKE_SCRIPT ??
    resolve(here, "../../tests/recovery/fixtures/q-script.json"),
);
const LOG_FILE = process.env.CQ_FAKE_LOG;

const NO_RULE_ANSWER = {
  answer:
    "[scripted vendor] No rule matched this request. This is not Q's judgment.",
  responseShape: "CONCISE",
  insufficientEvidence: true,
};

let memoryScript = null;
const requests = [];

function loadScript() {
  if (memoryScript !== null) return memoryScript;
  if (!existsSync(SCRIPT_FILE)) return { rules: [] };
  try {
    return JSON.parse(readFileSync(SCRIPT_FILE, "utf8"));
  } catch (error) {
    console.error(`fake-vendors: unreadable script ${SCRIPT_FILE}: ${error}`);
    return { rules: [] };
  }
}

function textOfContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("\n");
}

/** What a rule can look at, read from a Responses API request body. */
function view(body) {
  const input = Array.isArray(body.input) ? body.input : [];
  const users = input
    .filter((item) => item?.role === "user")
    .map((item) => textOfContent(item.content));
  const toolOutputs = input.filter(
    (item) => item?.type === "function_call_output",
  );
  const calls = new Map(
    input
      .filter((item) => item?.type === "function_call")
      .map((item) => [item.call_id, item.name]),
  );
  return {
    instructions: typeof body.instructions === "string" ? body.instructions : "",
    lastUser: users.at(-1) ?? "",
    allText: [body.instructions ?? "", ...users].join("\n"),
    tools: (Array.isArray(body.tools) ? body.tools : [])
      .map((tool) => tool?.name ?? tool?.function?.name)
      .filter((name) => typeof name === "string"),
    answeredTools: toolOutputs.map((item) => calls.get(item.call_id) ?? ""),
  };
}

function matches(rule, seen) {
  const when = rule.when ?? {};
  if (when.user !== undefined && !new RegExp(when.user, "iu").test(seen.lastUser))
    return false;
  if (
    when.instructions !== undefined &&
    !new RegExp(when.instructions, "iu").test(seen.instructions)
  )
    return false;
  if (when.tool !== undefined && !seen.tools.includes(when.tool)) return false;
  if (when.afterTool === null && seen.answeredTools.length > 0) return false;
  if (
    typeof when.afterTool === "string" &&
    !seen.answeredTools.includes(when.afterTool)
  )
    return false;
  return true;
}

function usage(text) {
  const output = Math.max(1, Math.ceil(text.length / 4));
  return {
    input_tokens: 100,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: output,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 100 + output,
  };
}

function responseObject(model, reply) {
  const output = [];
  let text = "";
  for (const call of reply.toolCalls ?? []) {
    output.push({
      type: "function_call",
      id: `fc_${randomUUID()}`,
      call_id: `call_${randomUUID().slice(0, 12)}`,
      name: call.name,
      arguments: JSON.stringify(call.arguments ?? {}),
      status: "completed",
    });
  }
  if (reply.json !== undefined) text = JSON.stringify(reply.json);
  else if (typeof reply.text === "string") text = reply.text;
  if (text.length > 0) {
    output.push({
      type: "message",
      id: `msg_${randomUUID()}`,
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text, annotations: [] }],
    });
  }
  return {
    id: `resp_${randomUUID()}`,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model: model ?? "scripted",
    output,
    usage: usage(text),
    incomplete_details: null,
    error: null,
  };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function sse(res, response) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
  });
  let seq = 0;
  const event = (type, data) =>
    res.write(
      `event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: seq++, ...data })}\n\n`,
    );
  event("response.created", {
    response: { ...response, status: "in_progress", output: [] },
  });
  for (const item of response.output) {
    if (item.type !== "message") continue;
    const text = item.content[0].text;
    for (let i = 0; i < text.length; i += 24) {
      event("response.output_text.delta", {
        item_id: item.id,
        output_index: 0,
        content_index: 0,
        delta: text.slice(i, i + 24),
      });
    }
  }
  event("response.completed", { response });
  res.end();
}

function readBody(req) {
  return new Promise((resolveBody) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        resolveBody(raw.length === 0 ? {} : JSON.parse(raw));
      } catch {
        resolveBody({ __unparsed: raw.slice(0, 2000) });
      }
    });
  });
}

function record(entry) {
  const line = { n: requests.length, at: new Date().toISOString(), ...entry };
  requests.push(line);
  if (LOG_FILE !== undefined) appendFileSync(LOG_FILE, `${JSON.stringify(line)}\n`);
}

function embedding(text, dimensions) {
  const out = new Array(dimensions);
  let seed = createHash("sha256").update(text).digest();
  for (let i = 0; i < dimensions; i += 1) {
    if (i % 32 === 0 && i > 0) seed = createHash("sha256").update(seed).digest();
    out[i] = seed[i % 32] / 255 - 0.5;
  }
  const norm = Math.hypot(...out) || 1;
  return out.map((v) => v / norm);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  const body = req.method === "GET" ? {} : await readBody(req);

  if (path === "/__fake/health") return send(res, 200, { ok: true, script: SCRIPT_FILE });
  if (path === "/__fake/requests") {
    const since = Number(url.searchParams.get("since") ?? 0);
    return send(res, 200, { requests: requests.slice(since), next: requests.length });
  }
  if (path === "/__fake/script" && req.method === "PUT") {
    memoryScript = body;
    return send(res, 200, { rules: (body.rules ?? []).length });
  }
  if (path === "/__fake/script" && req.method === "DELETE") {
    memoryScript = null;
    return send(res, 200, { reset: true });
  }

  // OpenAI Responses API (text generation, structured output, tool calls).
  if (path === "/v1/responses" && req.method === "POST") {
    const seen = view(body);
    const script = loadScript();
    const rule = (script.rules ?? []).find((candidate) => matches(candidate, seen));
    const reply = rule?.reply ?? { json: NO_RULE_ANSWER };
    record({
      vendor: "openai",
      path,
      model: body.model,
      stream: body.stream === true,
      rule: rule?.name ?? null,
      tools: seen.tools,
      lastUser: seen.lastUser,
      input: seen.allText,
    });
    if (reply.delayMs !== undefined)
      await new Promise((r) => setTimeout(r, reply.delayMs));
    if (reply.hang === true) return; // the caller's own timeout is under test
    if (reply.status !== undefined)
      return send(res, reply.status, reply.body ?? { error: { message: "scripted failure" } });
    const response = responseObject(body.model, reply);
    return body.stream === true ? sse(res, response) : send(res, 200, response);
  }

  // OpenAI embeddings: deterministic unit vectors, so retrieval is repeatable.
  if (path === "/v1/embeddings" && req.method === "POST") {
    const inputs = Array.isArray(body.input) ? body.input : [body.input ?? ""];
    const dimensions = Number(body.dimensions ?? 1536);
    record({ vendor: "openai", path, model: body.model, count: inputs.length });
    return send(res, 200, {
      object: "list",
      model: body.model,
      data: inputs.map((text, index) => ({
        object: "embedding",
        index,
        embedding: embedding(String(text), dimensions),
      })),
      usage: { prompt_tokens: inputs.length, total_tokens: inputs.length },
    });
  }

  // Voice credentials. Reached only once q-api can be pointed here
  // (request G-R2); the browser side is faked in the page.
  if (path === "/v1/auth/grant" && req.method === "POST") {
    record({ vendor: "deepgram", path });
    return send(res, 200, { access_token: `fake-dg-${randomUUID()}`, expires_in: 60 });
  }
  if (path === "/v1/realtime/client_secrets" && req.method === "POST") {
    record({ vendor: "openai-realtime", path });
    return send(res, 200, {
      value: `ek_fake_${randomUUID().replaceAll("-", "")}`,
      expires_at: Math.floor(Date.now() / 1000) + 60,
      session: body.session ?? {},
    });
  }

  record({ vendor: "unknown", path, method: req.method });
  return send(res, 404, { error: { message: `fake-vendors: no route ${path}` } });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    JSON.stringify({ msg: "fake vendors listening", port: PORT, script: SCRIPT_FILE }),
  );
});
