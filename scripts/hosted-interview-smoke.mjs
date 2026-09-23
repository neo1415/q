/* global process, console, URL, fetch, TextDecoder */
/**
 * Hosted interview smoke (QX-004 §0.7, §9, §10).
 *
 * Drives a real onboarding conversation against the DEPLOYED api and
 * q-api, as a browser would: sign up a fresh synthetic person, start
 * their journey, open a voice session bound to it, and send utterances
 * through the same think endpoint the speech provider calls.
 *
 * The point is what a browser transcript cannot give you: Q's words turn
 * by turn, printed next to the step keys the runtime actually recorded,
 * against the hosted routing and the hosted database — so "Q could not
 * think" and "Q thought and said something wrong" stop looking alike.
 *
 *   node scripts/hosted-interview-smoke.mjs --journey investor \
 *     "I'm an angel" "My name is Joe" ...
 *
 * The account it creates is synthetic and disposable. Its password is
 * generated per run and never printed; nothing here reads a secret beyond
 * the publishable key a browser already holds.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const API =
  process.env["CQ_HOSTED_API_URL"] ??
  "https://capital-qapi-production.up.railway.app";
const Q_API =
  process.env["CQ_HOSTED_Q_API_URL"] ??
  "https://capital-qq-api-production.up.railway.app";

function fromEnvFile(name) {
  try {
    const text = readFileSync(
      new URL("../.env.local", import.meta.url),
      "utf8",
    );
    for (const line of text.split(/\r?\n/)) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match !== null && match[1] === name) return match[2].trim();
    }
  } catch {
    // Nothing to read is a fine state: the variable may be in the env.
  }
  return undefined;
}

const SUPABASE_URL =
  process.env["SUPABASE_URL"] ?? fromEnvFile("SUPABASE_URL") ?? "";
const PUBLISHABLE =
  process.env["SUPABASE_PUBLISHABLE_KEY"] ??
  fromEnvFile("SUPABASE_PUBLISHABLE_KEY") ??
  "";

function parseArgs(argv) {
  const utterances = [];
  let journey = "investor";
  let name = null;
  let organisation = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--journey") {
      journey = argv[i + 1] ?? journey;
      i += 1;
      continue;
    }
    if (arg === "--name") {
      name = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--organisation") {
      organisation = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    utterances.push(arg);
  }
  return { journey, name, organisation, utterances };
}

async function json(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 400) };
  }
}

/**
 * A confirmed synthetic person, created the way `dev-bootstrap` creates
 * the local ones: through the admin API, because a script cannot answer a
 * confirmation email, and because Supabase refuses a signup at a domain
 * that takes no mail. The privileged key is read from the local
 * environment and used for this one call; the conversation that follows
 * runs entirely on the person's own session, with exactly the authority a
 * browser would have.
 */
async function createPerson({ journey, name, organisation }) {
  const secret =
    process.env["SUPABASE_SECRET_KEY"] ?? fromEnvFile("SUPABASE_SECRET_KEY");
  if (secret === undefined) {
    throw new Error(
      "SUPABASE_SECRET_KEY is needed to create a synthetic person, or pass " +
        "CQ_SMOKE_EMAIL and CQ_SMOKE_PASSWORD for one that exists",
    );
  }
  const email = `qx004-${journey}-${Date.now().toString(36)}@capitalq.local`;
  // Disposable, per run, never printed, never stored.
  const password = `Qx!${randomUUID()}`;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: secret,
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: name ?? (journey === "founder" ? "Ada" : "Joe"),
        synthetic: true,
        ...(organisation === null ? {} : { organisation_name: organisation }),
      },
    }),
  });
  if (!response.ok) {
    const body = await json(response);
    throw new Error(
      `could not create a synthetic person (${String(response.status)}): ${String(body?.msg ?? body?.message ?? "")}`,
    );
  }
  return signIn(email, password);
}

async function signIn(email, password) {
  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: { apikey: PUBLISHABLE, "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    },
  );
  const body = await json(response);
  if (typeof body.access_token !== "string") {
    throw new Error(`sign-in failed: ${JSON.stringify(body).slice(0, 300)}`);
  }
  return { email, accessToken: body.access_token };
}

async function api(accessToken, path, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  return { status: response.status, body: await json(response) };
}

async function startJourney(accessToken, journeyType) {
  const current = await api(
    accessToken,
    `/v1/onboarding/sessions/current?journeyType=${journeyType}`,
  );
  if (current.status === 200 && current.body?.session?.id !== undefined) {
    return current.body.session.id;
  }
  const created = await api(accessToken, "/v1/onboarding/sessions", {
    method: "POST",
    headers: { "idempotency-key": randomUUID() },
    body: JSON.stringify({ journeyType }),
  });
  if (created.body?.session?.id === undefined) {
    throw new Error(
      `could not start the journey (${String(created.status)}): ${JSON.stringify(created.body).slice(0, 300)}`,
    );
  }
  return created.body.session.id;
}

async function openVoiceSession(accessToken, sessionId, journeyType) {
  const response = await fetch(`${Q_API}/v1/q/voice/sessions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    body: JSON.stringify({
      voice: "FEMALE",
      onboarding: { sessionId, journeyType },
    }),
  });
  const body = await json(response);
  if (response.status !== 201) {
    throw new Error(
      `voice session refused (${String(response.status)}): ${JSON.stringify(body).slice(0, 300)}`,
    );
  }
  // The think bearer travels inside the agent settings the browser hands
  // to the speech provider. Read it exactly where the provider would.
  const settings = body.deepgram;
  const think = settings?.agent?.think ?? settings?.think;
  const header =
    think?.provider?.headers?.authorization ??
    think?.endpoint?.headers?.authorization;
  const url = think?.provider?.url ?? think?.endpoint?.url;
  if (typeof header !== "string") {
    throw new Error(
      `no think credential in the session: ${JSON.stringify(body).slice(0, 600)}`,
    );
  }
  return {
    firstMessage: body.firstMessage ?? null,
    thinkUrl: typeof url === "string" ? url : `${Q_API}/v1/q/voice/think`,
    thinkToken: header.replace(/^Bearer\s+/i, ""),
  };
}

/** One turn through the think endpoint, reading the SSE back as Q's words. */
async function think(thinkUrl, thinkToken, messages) {
  const response = await fetch(thinkUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${thinkToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: "capital-q", messages, stream: true }),
  });
  if (response.status !== 200 || response.body === null) {
    return {
      text: "",
      error: `think ${String(response.status)}: ${JSON.stringify(await json(response)).slice(0, 300)}`,
    };
  }
  let buffer = "";
  let text = "";
  const decoder = new TextDecoder();
  for await (const part of response.body) {
    buffer += decoder.decode(part, { stream: true });
    let index = buffer.indexOf("\n\n");
    while (index !== -1) {
      const frame = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      index = buffer.indexOf("\n\n");
      const line = frame.split("\n").find((l) => l.startsWith("data: "));
      if (line === undefined) continue;
      const payload = line.slice("data: ".length).trim();
      if (payload === "[DONE]") continue;
      try {
        const chunk = JSON.parse(payload);
        const delta = chunk?.choices?.[0]?.delta?.content;
        if (typeof delta === "string") text += delta;
      } catch {
        // A frame we cannot parse is a frame we do not use.
      }
    }
  }
  return { text: text.trim(), error: null };
}

async function main() {
  const { journey, name, organisation, utterances } = parseArgs(
    process.argv.slice(2),
  );
  if (SUPABASE_URL.length === 0 || PUBLISHABLE.length === 0) {
    throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are needed");
  }
  console.log(`api    ${API}`);
  console.log(`q-api  ${Q_API}`);

  const existingEmail = process.env["CQ_SMOKE_EMAIL"];
  const existingPassword = process.env["CQ_SMOKE_PASSWORD"];
  const person =
    existingEmail !== undefined && existingPassword !== undefined
      ? await signIn(existingEmail, existingPassword)
      : await createPerson({ journey, name, organisation });
  console.log(`person ${person.email}`);

  // The first authenticated read is what copies the sign-up name onto the
  // profile, exactly as the first page load does in a browser.
  await api(person.accessToken, "/v1/me");

  const sessionId = await startJourney(person.accessToken, journey);
  console.log(`journey ${journey} ${sessionId}`);

  const opened = await openVoiceSession(person.accessToken, sessionId, journey);
  if (opened.firstMessage !== null) {
    console.log(`\nQ: ${opened.firstMessage}`);
  }

  const messages = [];
  if (opened.firstMessage !== null) {
    messages.push({ role: "assistant", content: opened.firstMessage });
  }
  for (const utterance of utterances) {
    console.log(`\nYOU: ${utterance}`);
    messages.push({ role: "user", content: utterance });
    const spoken = await think(opened.thinkUrl, opened.thinkToken, messages);
    if (spoken.error !== null) {
      console.log(`!! ${spoken.error}`);
      break;
    }
    console.log(`Q: ${spoken.text}`);
    messages.push({ role: "assistant", content: spoken.text });
  }

  const view = await api(
    person.accessToken,
    `/v1/onboarding/sessions/${sessionId}`,
  );
  const responses = view.body?.responses ?? [];
  console.log(`\nrecorded (${String(responses.length)}):`);
  for (const response of responses) {
    console.log(`  ${response.stepKey}  ${JSON.stringify(response.value)}`);
  }
  console.log(`current step: ${String(view.body?.session?.currentStepKey)}`);
}

main().catch((error) => {
  console.error(String(error instanceof Error ? error.message : error));
  process.exitCode = 1;
});
