/* eslint-disable no-console -- a developer CLI whose whole purpose is to print what Q said and did */
/**
 * Interview smoke (CQ-Q-VOICE-001 rework; QX-004 core gate).
 *
 * Runs the real interviewer against the real model gateway and a real
 * onboarding session, one utterance per argument, and prints what Q
 * said, what the runtime actually recorded, and any failure — the thing
 * a browser transcript cannot show.
 *
 *   pnpm interview:smoke -- "We're at seed" "Two pilots"
 *   pnpm interview:smoke -- --journey investor --fresh "I'm an angel"
 *
 * This is the LOCAL core-gate harness. It exists so that a conversational
 * defect is found in seconds against the local stack rather than in
 * twenty-five minutes against a deployment, and it takes the same path
 * the hosted smoke takes so the two are comparable.
 *
 * `--fresh` creates a synthetic person and a new session; without it the
 * dev founder's current session is used. `--journey investor|founder`
 * picks the journey.
 *
 * The SYNTHETIC_DEMO posture is declared, and the allowance that makes it
 * mean anything is the ordinary LOCAL one — `local` or `test` plus a
 * loopback database, built by the same function the hosted deployment
 * builds its own from. Nothing here pretends to be staging: the two
 * environments reach the same eligibility through their own attestations,
 * which is the point of having two.
 *
 * Nothing here is a secret and nothing is printed but Q's words, the step
 * keys, and the route each turn took.
 */
import { randomUUID } from "node:crypto";

import { createCorrelationId, createLogger } from "@capital-q/observability";
import { loadDatabaseConfig } from "@capital-q/config/database";
import { parseQApiConfig } from "@capital-q/config/q-api";
import { createRequestDatabaseClient } from "@capital-q/database";
import {
  createModelGateway,
  createModelProviderRegistry,
  createPostgresModelCatalog,
  createPostgresModelUsageRepository,
  createProcessLocalProviderHealth,
  createSyntheticDemoRoutingAllowance,
  withTestRouting,
  type ModelProvider,
} from "@capital-q/model-gateway";
import { createOpenAIModelProvider } from "@capital-q/model-gateway/providers/openai";
import { createGoogleModelProvider } from "@capital-q/model-gateway/providers/google";
import { createGroqModelProvider } from "@capital-q/model-gateway/providers/groq";

import {
  createInterviewer,
  signupContextFromToken,
} from "../voice/interviewer.js";

const DEV_EMAIL =
  process.env["DEV_FOUNDER_EMAIL"] ?? "dev-founder@capitalq.local";
const DEV_PASSWORD = "CapitalQ-dev-2026!";

async function main(): Promise<void> {
  const argv = process.argv.slice(2).filter((a) => a !== "--");
  const journeyAt = argv.indexOf("--journey");
  const journeyType: "founder" | "investor" =
    journeyAt !== -1 && argv[journeyAt + 1] === "investor"
      ? "investor"
      : "founder";
  const fresh = argv.includes("--fresh");
  /**
   * Carry on with somebody who already exists (`--as <email>`).
   *
   * A thirty-five step journey re-run from step one after every fix
   * spends the validation window proving what is already covered. This
   * resumes the person's own live session through the ordinary
   * `sessions/current` lookup — the same seam a browser uses on a
   * refresh — so the state under test is real persisted state and not a
   * fixture assembled around the invariants.
   */
  const asAt = argv.indexOf("--as");
  const resumeEmail = asAt === -1 ? undefined : argv[asAt + 1];
  const geminiOnly = argv.includes("--gemini-only");
  // Gemini is in a genuine high-demand outage; this isolates core Q
  // correctness from it rather than disguising it.
  const groqOnly = argv.includes("--groq-only");
  const utterances = argv.filter(
    (a, index) =>
      !a.startsWith("--") &&
      !(journeyAt !== -1 && index === journeyAt + 1) &&
      !(asAt !== -1 && index === asAt + 1),
  );
  const config = parseQApiConfig(process.env);
  const logger = createLogger(
    { serviceName: "interview-smoke", environment: "development" },
    { level: "debug" },
  );

  const supabaseUrl = process.env["SUPABASE_URL"];
  const publishable = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (supabaseUrl === undefined || publishable === undefined) {
    throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are needed");
  }
  /**
   * A synthetic person of this run's own, when asked for.
   *
   * Created through the admin API exactly as `dev-bootstrap` creates the
   * standing dev accounts, because a script cannot answer a confirmation
   * email. Everything after this runs on that person's own session, with
   * exactly the authority a browser would have.
   */
  let email = DEV_EMAIL;
  let password = DEV_PASSWORD;
  if (resumeEmail !== undefined) {
    // Their password is not ours to know; the admin API sets a fresh one
    // for this run. Local synthetic people only, and the same privileged
    // seam `dev-bootstrap` already uses.
    const secret = process.env["SUPABASE_SECRET_KEY"];
    if (secret === undefined) {
      throw new Error("SUPABASE_SECRET_KEY is needed for --as");
    }
    const found = await fetch(
      `${supabaseUrl}/auth/v1/admin/users?filter=${encodeURIComponent(resumeEmail)}`,
      { headers: { apikey: secret, authorization: `Bearer ${secret}` } },
    );
    const body = (await found.json()) as { users?: { id: string }[] };
    const id = body.users?.[0]?.id;
    if (id === undefined) {
      throw new Error(`no local person ${resumeEmail}`);
    }
    password = `Qx!${randomUUID()}`;
    await fetch(`${supabaseUrl}/auth/v1/admin/users/${id}`, {
      method: "PUT",
      headers: {
        apikey: secret,
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ password }),
    });
    email = resumeEmail;
    console.log(`[smoke] resuming as ${email}`);
  } else if (fresh) {
    const secret = process.env["SUPABASE_SECRET_KEY"];
    if (secret === undefined) {
      throw new Error("SUPABASE_SECRET_KEY is needed for --fresh");
    }
    email = `smoke-${journeyType}-${Date.now().toString(36)}@capitalq.local`;
    password = `Qx!${randomUUID()}`;
    const made = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
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
        // What a person types into the sign-up form, so the harness
        // exercises the same candidate context a real registration gives.
        user_metadata: {
          display_name: "Daniel Ademola",
          organisation_name: "Zino Aviation",
          synthetic: true,
        },
        app_metadata: { synthetic: true },
      }),
    });
    if (!made.ok) {
      throw new Error(
        `could not create a synthetic person: ${String(made.status)}`,
      );
    }
    console.log(`[smoke] synthetic person ${email}`);
  }

  const tokenRes = await fetch(
    `${supabaseUrl}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: { apikey: publishable, "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    },
  );
  const tokenBody = (await tokenRes.json()) as { access_token?: string };
  const accessToken = tokenBody.access_token;
  if (accessToken === undefined) {
    throw new Error(`dev sign-in failed: ${String(tokenRes.status)}`);
  }
  const apiBaseUrl = config.voice.apiBaseUrl;
  if (apiBaseUrl === undefined) {
    throw new Error("CQ_API_URL is needed for interview turns");
  }
  /**
   * The local api runs under `node --watch`, and it restarts whenever a
   * package's dist changes — which, during development, is often. A dev
   * harness that gives up on one refused connection is a harness that
   * reports a defect where there is only a restart.
   */
  const apiFetch = async (
    path: string,
    init: RequestInit = {},
  ): Promise<Response> => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      try {
        return await fetch(`${apiBaseUrl}${path}`, {
          ...init,
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
            ...(init.headers ?? {}),
          },
        });
      } catch (error: unknown) {
        lastError = error;
        console.log(
          `[smoke] ${apiBaseUrl} not answering; retry ${String(attempt)}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 3_000));
      }
    }
    throw lastError;
  };

  // The first authenticated read is what copies the sign-up name onto the
  // profile, exactly as the first page load does in a browser.
  await apiFetch("/v1/me");

  let current = (await (
    await apiFetch(`/v1/onboarding/sessions/current?journeyType=${journeyType}`)
  ).json()) as { session?: { id: string; currentStepKey: string | null } };
  if (current.session === undefined) {
    current = (await (
      await apiFetch("/v1/onboarding/sessions", {
        method: "POST",
        headers: { "idempotency-key": randomUUID() },
        body: JSON.stringify({ journeyType }),
      })
    ).json()) as typeof current;
  }
  if (current.session === undefined) {
    throw new Error(`no ${journeyType} onboarding session could be started`);
  }
  console.log(
    `[smoke] session ${current.session.id} at ${current.session.currentStepKey ?? "-"}`,
  );

  const database = createRequestDatabaseClient(loadDatabaseConfig());
  const secrets = config.secrets.modelProviders;
  const providers: ModelProvider[] = [];
  if (!groqOnly && secrets.google !== undefined) {
    providers.push(
      createGoogleModelProvider({ apiKey: secrets.google.reveal() }),
    );
  }
  /**
   * OpenAI, for diagnosis only.
   *
   * Configured whenever the key is present, but never reached unless the
   * deployment also names it in CQ_TEST_MODEL_PROVIDER: no routing policy
   * lists its model, so the catalogue wrapper below is the only way in.
   */
  if (secrets.openai !== undefined) {
    providers.push(
      createOpenAIModelProvider({ apiKey: secrets.openai.reveal() }),
    );
  }
  // `--gemini-only` leaves the Groq adapter unconfigured, which is what a
  // spent free tier looks like from the gateway's side. It is how the
  // demo's real question gets answered without waiting for a deployment.
  if (!geminiOnly && secrets.groq !== undefined) {
    providers.push(
      createGroqModelProvider({
        apiKey: secrets.groq.reveal(),
        additionalApiKeys: secrets.groqKeys.slice(1).map((k) => k.reveal()),
      }),
    );
  }
  const databaseConfig = loadDatabaseConfig();
  /**
   * The ordinary LOCAL attestation: `local` or `test`, and a loopback
   * database. Built by the same function the hosted deployment builds its
   * own from, and it refuses outright against a hosted database — which
   * is the point, not an inconvenience.
   */
  const syntheticDemo = createSyntheticDemoRoutingAllowance({
    operatorEnabled: process.env["CQ_SYNTHETIC_DEMO_ROUTING"] === "true",
    environment: databaseConfig.runtime.deploymentEnvironment,
    databaseUrl: databaseConfig.secrets.url,
  });
  console.log(
    `[smoke] synthetic-demo: ${
      syntheticDemo === null
        ? "not enabled (routing as REAL_CUSTOMER)"
        : syntheticDemo.attestation.join(" · ")
    }`,
  );
  console.log(
    `[smoke] providers: ${providers.map((p) => p.code).join(", ") || "none"}`,
  );

  /**
   * The diagnostic route, when this deployment asked for one. It refuses
   * outright outside `local`/`test` and without the synthetic-demo
   * attestation, so there is nowhere for it to be switched on quietly.
   */
  const testProvider = secrets.testProviderCode;
  if (testProvider !== undefined) {
    console.log(`[smoke] test routing: ${testProvider} first`);
  }
  const catalog = withTestRouting(
    createPostgresModelCatalog({ sql: database.sql }),
    {
      providerCode: testProvider,
      environment: databaseConfig.runtime.deploymentEnvironment,
      syntheticDemoPermitted: syntheticDemo?.permitted === true,
    },
  );

  if (testProvider !== undefined) {
    const snapshot = await catalog.load();
    const dialogue = snapshot.routingPolicies.find(
      (policy) => policy.taskClass === "NORMAL_DIALOGUE",
    );
    console.log(
      `[smoke] dialogue preferred: ${(dialogue?.preferredModels ?? [])
        .map((id) => snapshot.models.find((m) => m.id === id)?.modelCode ?? id)
        .join(", ")}`,
    );
  }

  const gateway = createModelGateway({
    catalog,
    registry: createModelProviderRegistry(providers),
    usage: createPostgresModelUsageRepository({ sql: database.sql }),
    health: createProcessLocalProviderHealth(),
    ...(syntheticDemo === null ? {} : { syntheticDemo }),
    logger,
  });
  const interviewer = createInterviewer({
    gateway,
    logger,
    ...(syntheticDemo === null
      ? {}
      : { dataPosture: "SYNTHETIC_DEMO" as const }),
  });

  /**
   * The tenant the API says this person is in.
   *
   * Read from /v1/me rather than guessed from the token's claims: the
   * claim is not always there on a freshly created person, and the
   * fallback zero-UUID made every usage-ledger write fail a foreign key
   * and fill the diagnosis with noise that looked like a product fault.
   */
  const me = (await (await apiFetch("/v1/me")).json()) as {
    user?: { id?: string };
    context?: { status?: string; tenantId?: string };
  };

  // Decode the actor from the token's claims for attribution only.
  const claims = JSON.parse(
    Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8"),
  ) as {
    sub?: string;
    tenant_id?: string;
    app_metadata?: { tenant_id?: string };
  };
  const attribution = {
    tenantId:
      me.context?.tenantId ??
      claims.tenant_id ??
      claims.app_metadata?.tenant_id ??
      "00000000-0000-4000-8000-000000000000",
    userId: me.user?.id ?? claims.sub ?? "00000000-0000-4000-8000-000000000000",
    correlationId: createCorrelationId(),
  };

  /**
   * The tenant, re-read each turn.
   *
   * A person who has just signed up has no organisation context yet, so
   * /v1/me answers CONTEXT_REQUIRED and there is no tenant to attribute
   * to. One appears part-way through the journey, when the organisation
   * is created. Reading it once at the start attributed every model call
   * to a zero UUID, every usage-ledger write failed a foreign key, and
   * the run finished with no record of what it had spent — which is the
   * one thing a diagnostic run has to be able to say.
   */
  const tenantNow = async (): Promise<string> => {
    try {
      const view = (await (await apiFetch("/v1/me")).json()) as {
        context?: { tenantId?: string };
      };
      return view.context?.tenantId ?? attribution.tenantId;
    } catch {
      return attribution.tenantId;
    }
  };

  const recent: { role: "person" | "q"; text: string }[] = [];
  for (const utterance of utterances.length === 0 ? [""] : utterances) {
    const started = Date.now();
    const outcome = await interviewer.turn({
      attribution: { ...attribution, tenantId: await tenantNow() },
      session: { baseUrl: apiBaseUrl, accessToken },
      onboardingSessionId: current.session.id,
      journeyType,
      signup: signupContextFromToken(accessToken),
      channel: "voice",
      utterance,
      recentTurns: recent,
    });
    console.log(`\n> ${utterance === "" ? "(opening)" : utterance}`);
    console.log(`Q: ${outcome.reply}`);
    console.log(
      `   intent=${outcome.intent} recorded=[${outcome.recorded.join(",")}] skipped=[${outcome.skipped.join(",")}] asking=${outcome.asking?.stepKey ?? "-"} options=${String(outcome.asking?.options?.length ?? 0)} degraded=${String(outcome.degraded)} research=${outcome.researching ?? "-"} ${String(Date.now() - started)}ms`,
    );
    if (utterance !== "") {
      recent.push({ role: "person", text: utterance });
    }
    recent.push({ role: "q", text: outcome.reply });
  }
  /**
   * What the session actually holds at the end.
   *
   * The whole reason this harness exists: Q's prose is not evidence that
   * anything was written down, so the run finishes by reading the session
   * back and printing it.
   */
  const view = (await (
    await apiFetch(`/v1/onboarding/sessions/${current.session.id}`)
  ).json()) as {
    session?: { currentStepKey: string | null };
    responses?: readonly { stepKey: string; value: unknown }[];
  };
  const responses = view.responses ?? [];
  console.log(`\n[smoke] recorded (${String(responses.length)}):`);
  for (const response of responses) {
    console.log(`  ${response.stepKey}  ${JSON.stringify(response.value)}`);
  }
  console.log(`[smoke] current step: ${view.session?.currentStepKey ?? "-"}`);

  await database.close?.();
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
