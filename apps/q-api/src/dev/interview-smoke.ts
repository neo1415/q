/* eslint-disable no-console -- a developer CLI whose whole purpose is to print what Q said and did */
/**
 * Interview smoke (CQ-Q-VOICE-001 rework): run the interviewer against the
 * live model gateway and the dev founder's own onboarding session, one
 * utterance per argument, and print what Q said, what it read, and any
 * failure — the thing a browser transcript cannot show.
 *
 *   pnpm interview:smoke -- "We're at seed" "Two pilots"
 *
 * Signs in as the dev founder with the dev password; nothing here is a
 * secret and nothing is printed but Q's words and the step keys.
 */
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
  type ModelProvider,
} from "@capital-q/model-gateway";
import { createGoogleModelProvider } from "@capital-q/model-gateway/providers/google";
import { createGroqModelProvider } from "@capital-q/model-gateway/providers/groq";

import { createInterviewer } from "../voice/interviewer.js";

const DEV_EMAIL =
  process.env["DEV_FOUNDER_EMAIL"] ?? "dev-founder@capitalq.local";
const DEV_PASSWORD = "CapitalQ-dev-2026!";

async function main(): Promise<void> {
  const utterances = process.argv.slice(2).filter((a) => a !== "--");
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
  const tokenRes = await fetch(
    `${supabaseUrl}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: { apikey: publishable, "content-type": "application/json" },
      body: JSON.stringify({ email: DEV_EMAIL, password: DEV_PASSWORD }),
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
  const current = (await (
    await fetch(
      `${apiBaseUrl}/v1/onboarding/sessions/current?journeyType=founder`,
      {
        headers: { authorization: `Bearer ${accessToken}` },
      },
    )
  ).json()) as { session?: { id: string; currentStepKey: string | null } };
  if (current.session === undefined) {
    throw new Error("the dev founder has no current onboarding session");
  }
  console.log(
    `[smoke] session ${current.session.id} at ${current.session.currentStepKey ?? "-"}`,
  );

  const database = createRequestDatabaseClient(loadDatabaseConfig());
  const secrets = config.secrets.modelProviders;
  const providers: ModelProvider[] = [];
  if (secrets.google !== undefined) {
    providers.push(
      createGoogleModelProvider({ apiKey: secrets.google.reveal() }),
    );
  }
  if (secrets.groq !== undefined) {
    providers.push(
      createGroqModelProvider({
        apiKey: secrets.groq.reveal(),
        additionalApiKeys: secrets.groqKeys.slice(1).map((k) => k.reveal()),
      }),
    );
  }
  const gateway = createModelGateway({
    catalog: createPostgresModelCatalog({ sql: database.sql }),
    registry: createModelProviderRegistry(providers),
    usage: createPostgresModelUsageRepository({ sql: database.sql }),
    health: createProcessLocalProviderHealth(),
    logger,
  });
  const interviewer = createInterviewer({ gateway, logger });

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
      claims.tenant_id ??
      claims.app_metadata?.tenant_id ??
      "00000000-0000-4000-8000-000000000000",
    userId: claims.sub ?? "00000000-0000-4000-8000-000000000000",
    correlationId: createCorrelationId(),
  };

  const recent: { role: "person" | "q"; text: string }[] = [];
  for (const utterance of utterances.length === 0 ? [""] : utterances) {
    const started = Date.now();
    const outcome = await interviewer.turn({
      session: { baseUrl: apiBaseUrl, accessToken },
      onboardingSessionId: current.session.id,
      journeyType: "founder",
      channel: "voice",
      attribution,
      utterance,
      recentTurns: recent,
    });
    console.log(`\n> ${utterance === "" ? "(opening)" : utterance}`);
    console.log(`Q: ${outcome.reply}`);
    console.log(
      `   intent=${outcome.intent} recorded=[${outcome.recorded.join(",")}] skipped=[${outcome.skipped.join(",")}] asking=${outcome.asking?.stepKey ?? "-"} options=${String(outcome.asking?.options?.length ?? 0)} degraded=${String(outcome.degraded)} ${String(Date.now() - started)}ms`,
    );
    if (utterance !== "") {
      recent.push({ role: "person", text: utterance });
    }
    recent.push({ role: "q", text: outcome.reply });
  }
  await database.close?.();
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
