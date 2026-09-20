#!/usr/bin/env node
/* global process, console, fetch, URL, crypto, setTimeout */
/**
 * The recommendation journey, end to end, through the real HTTP API
 * (CQ-REC-007R acceptance).
 *
 *   pnpm demo:journey
 *
 * An investor completes their onboarding, a slate is built for them, and
 * they are told why a company is in it. Every step goes through a public
 * path a person uses -- sign-in, the onboarding runtime, the discovery
 * feed, the explanation endpoint -- so nothing here proves anything a
 * person could not reach. No table is touched and no row is written
 * directly: if this script passes, the wiring passes.
 *
 * LOCAL ONLY. It refuses any Supabase host that is not loopback, because
 * it signs in as a synthetic person created by `pnpm dev:bootstrap` and
 * those accounts exist only on this machine.
 *
 * Exit 0 when the investor got an explanation, 1 when they did not.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const env = { ...process.env };
const envFile = resolve(root, ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match === null || env[match[1]] !== undefined) continue;
    const value = match[2].replace(/^["']|["']$/g, "");
    if (value.length > 0) env[match[1]] = value;
  }
}

// The local stack, pinned rather than inherited: a developer's .env.local
// may name the hosted project, and these are synthetic local accounts.
const SUPABASE_URL = env.CQ_JOURNEY_SUPABASE_URL ?? "http://127.0.0.1:54321";
const API_URL = (env.CQ_API_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");
const Q_API_URL = (env.CQ_Q_API_URL ?? "http://127.0.0.1:3002").replace(
  /\/$/,
  "",
);
const PASSWORD = "CapitalQ-dev-2026!";
const INVESTOR = "dev-investor@capitalq.local";
const FOUNDER = "dev-founder@capitalq.local";

if (
  !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(SUPABASE_URL)
) {
  console.error(`journey: refusing a non-loopback Supabase (${SUPABASE_URL})`);
  process.exit(2);
}

const PUBLISHABLE =
  env.CQ_JOURNEY_PUBLISHABLE_KEY ??
  env.SUPABASE_PUBLISHABLE_KEY_LOCAL ??
  "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Steps that narrow what may be recommended rather than widen it. */
const EXCLUDING = /avoid|exclusion|red_flag|hard_exclusions/i;

let failed = false;
const step = (ok, label, detail = "") => {
  console.log(
    `  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? ` -- ${detail}` : ""}`,
  );
  if (!ok) failed = true;
};

async function signIn(email) {
  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: { "content-type": "application/json", apikey: PUBLISHABLE },
      body: JSON.stringify({ email, password: PASSWORD }),
    },
  );
  if (!response.ok) {
    throw new Error(`sign-in failed (${response.status})`);
  }
  const body = await response.json();
  return body.access_token;
}

/**
 * Wait until the service behind a port is the one we mean.
 *
 * Another project listens on these ports on this machine, and a dev stack
 * restarts whenever a package is rebuilt. In that window a request to
 * 127.0.0.1 is answered by whoever else is bound to it, and the answer is
 * a plausible 404 rather than a refused connection. That is how a journey
 * "fails" for reasons that have nothing to do with Capital Q, so the
 * service is asked to name itself first -- the same check `pnpm
 * demo:status` makes.
 */
async function waitForService(baseUrl, expected, seconds = 120) {
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    try {
      const response = await fetch(`${baseUrl}/health/ready`);
      if (response.ok) {
        const health = await response.json();
        if (health.service === expected) return true;
      }
    } catch {
      // Not up yet.
    }
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/**
 * One call, and one retry when the answer was not really the service's.
 *
 * A dev stack restarts whenever a package is rebuilt, and another project
 * listens on these ports. During the gap a request either fails to connect
 * or is answered by somebody else with a plausible 404 -- neither is the
 * product's answer. Both are retried once, after the service has named
 * itself again. Every write carries an idempotency key and the session
 * version it was based on, so asking twice is safe.
 */
function client(baseUrl, token, serviceName) {
  const send = (method, path, body) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(method === "GET" ? {} : { "idempotency-key": crypto.randomUUID() }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const read = async (response) => {
    const text = await response.text();
    try {
      return {
        status: response.status,
        body: text.length > 0 ? JSON.parse(text) : null,
      };
    } catch {
      // A non-JSON body is an answer too: the caller reads the status.
      return { status: response.status, body: null };
    }
  };

  return async (method, path, body) => {
    if (env.CQ_JOURNEY_DEBUG) console.log(`  -> ${method} ${baseUrl}${path}`);
    let response = null;
    try {
      response = await send(method, path, body);
      if (response.status !== 404 || serviceName === undefined) {
        return read(response);
      }
    } catch (error) {
      if (serviceName === undefined) throw error;
    }
    // Either nothing answered, or something answered that may not be ours.
    if (!(await waitForService(baseUrl, serviceName, 120))) {
      return { status: response?.status ?? 0, body: null };
    }
    return read(await send(method, path, body));
  };
}

/**
 * An answer for whatever the journey asks next.
 *
 * Deliberately dull: the first option, the middle of a range, a sentence of
 * invented text. The journey's own definition decides what is asked and
 * what is required; this only proves a person can get through it.
 */
function answerFor(view, used) {
  const p = view.presentation;
  // Prefer an option this walk has not used elsewhere. The journey has
  // real cross-step rules -- naming the same sector as "avoid" and as
  // "never show" is a contradiction it rejects, and rightly -- so a driver
  // that always picks the first option argues with the product.
  const fresh = (options) => {
    const unused = options.filter((o) => !used.has(o.optionKey));
    return unused.length > 0 ? unused : options;
  };
  switch (p.stepType) {
    case "single_select": {
      const options = fresh(p.options);
      return options.length === 0
        ? null
        : {
            value: { type: "SINGLE_SELECT", optionKey: options[0].optionKey },
            modality: "SELECTION",
          };
    }
    case "multi_select": {
      const usable = p.options.filter(
        (o) => !p.exclusiveOptionKeys.includes(o.optionKey),
      );
      const pool = usable.length > 0 ? usable : p.options;
      // Generous about what this investor will look at, minimal about what
      // they refuse. A driver that picks one stage and one sector builds a
      // mandate that matches nothing and then reports an empty slate as a
      // failure of the recommendation engine, which it is not.
      const wanted = EXCLUDING.test(view.stepKey)
        ? Math.max(1, p.minSelections)
        : Math.min(p.maxSelections, pool.length);
      const pick = (EXCLUDING.test(view.stepKey) ? fresh(pool) : pool).slice(
        0,
        wanted,
      );
      return pick.length === 0
        ? null
        : {
            value: {
              type: "MULTI_SELECT",
              optionKeys: pick.map((o) => o.optionKey),
            },
            modality: "SELECTION",
          };
    }
    case "range":
      // The bottom of the range, not the middle: the midpoint of a cheque
      // range is hundreds of billions, which is a fixture nobody would
      // recognise as synthetic-but-plausible.
      return {
        value: { type: "RANGE", value: p.min },
        modality: "SELECTION",
      };
    case "short_text": {
      // Some short-text steps are typed values behind the scenes -- a
      // website is parsed as a URL -- so the step is read before it is
      // answered rather than filled with prose that will be rejected.
      const asks =
        `${view.stepKey} ${view.prompt} ${p.placeholder ?? ""}`.toLowerCase();
      const text = /website|url|domain|link/.test(asks)
        ? "https://synthetic-demo.capitalq.local"
        : /e-?mail/.test(asks)
          ? "synthetic-demo@capitalq.local"
          : "Synthetic demo answer";
      return {
        value: { type: "TEXT", text: text.slice(0, p.maxLength) },
        modality: "TYPED_TEXT",
      };
    }
    case "long_text":
    case "voice_text":
      return {
        value: {
          type: "TEXT",
          text: "A synthetic answer written by the acceptance journey. It describes nothing real.".slice(
            0,
            p.maxLength,
          ),
        },
        modality: "TYPED_TEXT",
      };
    case "confirmation":
      return {
        value: { type: "CONFIRMATION", confirmed: true },
        modality: "SELECTION",
      };
    case "reference_select": {
      // The step names its own context, and the server fills it with the
      // references that may be chosen. Nothing is guessed: the ids come
      // from the projection the runtime built for this person.
      const context = view.context ?? {};
      const suggested = Object.entries(context)
        .filter(([key]) => /^suggested.*Id$/.test(key))
        .map(([, value]) => value)
        .filter((value) => typeof value === "string");
      const candidates = Array.isArray(context.candidates)
        ? context.candidates
        : [];
      const ids =
        suggested.length > 0
          ? suggested
          : candidates
              .map(
                (candidate) =>
                  Object.entries(candidate ?? {})
                    .filter(
                      ([key, value]) =>
                        typeof value === "string" &&
                        /Id$|^id$/.test(key) &&
                        UUID.test(value),
                    )
                    .map(([, value]) => value)[0],
              )
              .filter((id) => typeof id === "string");
      const chosen = ids.slice(0, Math.max(1, p.minItems));
      return chosen.length === 0
        ? null
        : {
            value: {
              type: "RESOURCE_REFERENCE",
              resourceType: p.resourceType,
              resourceIds: chosen,
            },
            modality: "SELECTION",
          };
    }
    default:
      // document_upload needs a real artefact; the journey skips it where
      // the runtime allows, and stops honestly where it does not.
      return null;
  }
}

/**
 * Walk the investor journey to its end.
 *
 * The runtime answers with an envelope -- the session, the step it is on
 * and the progress -- rather than a bare session, so each response is the
 * next question. Anything this script cannot answer honestly (a document,
 * a taxonomy reference) is skipped where the journey allows it; a required
 * step it cannot answer stops the walk and says so, because pretending
 * would prove nothing.
 */
async function driveOnboarding(api, journeyType) {
  let envelope = await api(
    "GET",
    `/v1/onboarding/sessions/current?journeyType=${journeyType}`,
  );
  if (envelope.status !== 200 || envelope.body?.session === undefined) {
    step(false, `${journeyType} onboarding session`, `HTTP ${envelope.status}`);
    return null;
  }
  let body = envelope.body;
  let answered = 0;
  let skipped = 0;
  // Seeded from what the session already holds, because a journey can be
  // resumed: a run that forgot the previous run's answers would re-offer
  // an option the runtime has already ruled out.
  const used = new Set();
  const remember = (value) => {
    if (value?.type === "SINGLE_SELECT") used.add(value.optionKey);
    if (value?.type === "MULTI_SELECT")
      for (const key of value.optionKeys) used.add(key);
  };
  for (const response of body.responses ?? []) remember(response.value);
  for (let guard = 0; guard < 80; guard += 1) {
    const sessionId = body.session.id;
    const path = `/v1/onboarding/sessions/${sessionId}`;
    if (body.session.status === "COMPLETED") break;

    if (body.progress?.canComplete === true) {
      const done = await api("POST", `${path}/complete`, {
        expectedSessionVersion: body.session.version,
      });
      if (done.status < 400 && done.body?.session !== undefined) {
        body = done.body;
        continue;
      }
      step(
        false,
        `completing the ${journeyType} journey`,
        `HTTP ${done.status}`,
      );
      return null;
    }

    const view = body.currentStep;
    if (view === undefined || view === null) break;
    const answer =
      // An optional step that says what this investor will not look at is
      // skipped outright: the fixture is about being recommended
      // something, not about ruling things out.
      EXCLUDING.test(view.stepKey) && view.required === false
        ? null
        : answerFor(view, used);
    // Every write carries the session version it was based on: the
    // runtime rejects a response built from a view somebody else moved on.
    const expectedSessionVersion = body.session.version;
    const result =
      answer === null
        ? await api(
            "POST",
            `${path}/steps/${encodeURIComponent(view.stepKey)}/skip`,
            { expectedSessionVersion },
          )
        : await api("POST", `${path}/responses`, {
            stepKey: view.stepKey,
            response: {
              value: answer.value,
              sourceModality: answer.modality,
            },
            expectedSessionVersion,
          });
    if (result.status >= 400) {
      step(
        false,
        `onboarding step ${view.stepKey} (${view.presentation.stepType})`,
        `HTTP ${result.status} ${JSON.stringify(result.body ?? "").slice(0, 300)}`,
      );
      return null;
    }
    if (answer === null) skipped += 1;
    else {
      answered += 1;
      remember(answer.value);
    }
    if (result.body?.session !== undefined) body = result.body;
    else {
      const refreshed = await api("GET", `${path}`);
      if (refreshed.body?.session === undefined) break;
      body = refreshed.body;
    }
  }
  const status = body.session.status;
  step(
    status === "COMPLETED",
    `${journeyType} completed onboarding`,
    `${answered} answered, ${skipped} skipped, status ${status}`,
  );
  return status === "COMPLETED" ? (body.session.subject?.id ?? null) : null;
}

/**
 * The founder's side of the journey.
 *
 * An investor's feed is empty until somebody chooses to be in it, and that
 * choice is the founder's: discoverability is declared, never inferred. So
 * the founder completes their own journey and sets their company
 * network-visible through the same endpoint the product uses.
 */
async function prepareFounder(token) {
  const api = client(API_URL, token, "api");
  const companyId = await driveOnboarding(api, "founder");
  if (companyId === null) return false;

  // Readiness is assessed by the real policy; the only synthetic part is
  // the verification seam, which is why this is a local-only fixture and
  // records itself as SYNTHETIC_LOCAL_FIXTURE.
  const ready = spawnSync(
    process.execPath,
    [resolve(root, "scripts", "dev-marketplace-ready.mjs")],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        CAPITAL_Q_ENV: "local",
        DATABASE_URL:
          env.CQ_JOURNEY_DATABASE_URL ??
          "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      },
    },
  );
  const readyState = /^state\s+(\S+)/m.exec(ready.stdout ?? "")?.[1] ?? "?";

  const company = await api("GET", `/v1/companies/${companyId}`);
  if (company.status !== 200) {
    step(false, "founder's company", `HTTP ${company.status}`);
    return false;
  }
  if (company.body.visibility !== "network_visible") {
    const set = await api("POST", `/v1/companies/${companyId}/visibility`, {
      visibility: "network_visible",
      expectedVersion: company.body.version,
    });
    if (set.status >= 400) {
      step(
        false,
        "founder chose to be discoverable",
        `HTTP ${set.status} ${JSON.stringify(set.body ?? "").slice(0, 200)}`,
      );
      return false;
    }
  }
  // Readiness is re-assessed after visibility, because visibility is one
  // of the requirements it checks.
  const again = spawnSync(
    process.execPath,
    [resolve(root, "scripts", "dev-marketplace-ready.mjs")],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        CAPITAL_Q_ENV: "local",
        DATABASE_URL:
          env.CQ_JOURNEY_DATABASE_URL ??
          "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      },
    },
  );
  const finalState = /^state\s+(\S+)/m.exec(again.stdout ?? "")?.[1] ?? "?";
  step(
    finalState === "marketplace_ready",
    "the company is discoverable and marketplace-ready",
    `${readyState} -> ${finalState}`,
  );
  return finalState === "marketplace_ready";
}

async function main() {
  console.log(`journey: ${API_URL} / ${Q_API_URL}\n`);

  if (!(await waitForService(API_URL, "api"))) {
    console.error("journey: the api did not answer as itself");
    process.exitCode = 1;
    return;
  }
  if (!(await waitForService(Q_API_URL, "q-api"))) {
    console.error("journey: the q-api did not answer as itself");
    process.exitCode = 1;
    return;
  }
  step(true, "both services answered as themselves", "api, q-api");

  const founderToken = await signIn(FOUNDER);
  step(true, "founder signed in", FOUNDER);
  await prepareFounder(founderToken);

  const token = await signIn(INVESTOR);
  step(true, "investor signed in", INVESTOR);
  const api = client(API_URL, token, "api");
  const qApi = client(Q_API_URL, token, "q-api");

  await driveOnboarding(api, "investor");

  // The feed, which is the persisted slate. The first read finds no
  // CURRENT slate, asks for one and says so; the build is a background
  // job, so this polls rather than assuming.
  let slateId = null;
  let companyId = null;
  let notes = [];
  // A dev stack restarts -- `node --watch` reacts to a package rebuild --
  // and during that window a request to the port can be answered by
  // whatever else is listening on this machine. So a bad status is treated
  // as "not yet", not as an answer, and the loop keeps asking.
  let lastStatus = 0;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const feed = await api("GET", "/v1/discovery/companies?limit=5");
    lastStatus = feed.status;
    if (feed.status !== 200) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    notes = feed.body?.notes ?? [];
    if ((feed.body?.items ?? []).length > 0) {
      slateId = feed.body.slateId;
      companyId = feed.body.items[0].companyId;
      break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  step(
    companyId !== null,
    "a slate was built and served",
    companyId === null
      ? `last HTTP ${lastStatus}, notes ${JSON.stringify(notes)}`
      : `slate ${slateId}`,
  );

  if (companyId !== null) {
    const explanation = await qApi(
      "GET",
      `/v1/discovery/slates/${slateId}/companies/${companyId}/explanation`,
    );
    const body = explanation.body;
    step(
      explanation.status === 200 && typeof body?.summary === "string",
      "the investor was told why",
      explanation.status === 200
        ? `${body.matchedFactors?.length ?? 0} matched, ${body.mismatchedFactors?.length ?? 0} not, ${body.uncertainties?.length ?? 0} unknown, from ${body.generatedFromRankingVersion}`
        : `HTTP ${explanation.status}`,
    );
    if (explanation.status === 200) {
      const serialised = JSON.stringify(body);
      step(
        !/\d+(\.\d+)?\s*%/.test(body.summary ?? "") &&
          !serialised.includes("internalScore"),
        "no score or percentage reached the reader",
      );
    }
  }

  console.log(`\njourney: ${failed ? "FAILED" : "PASSED"}`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  console.error(`journey: ${error.message}`);
  process.exitCode = 1;
});
