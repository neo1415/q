import type { loadWorkerConfig } from "@capital-q/config/workers";
import type { ModelDataPosture } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import {
  createModelGateway,
  createModelProviderRegistry,
  createPostgresModelCatalog,
  createPostgresModelUsageRepository,
  createProcessLocalProviderHealth,
  createSyntheticDemoRoutingAllowance,
  type ModelProvider,
} from "@capital-q/model-gateway";
import { createGoogleModelProvider } from "@capital-q/model-gateway/providers/google";
import { createGroqModelProvider } from "@capital-q/model-gateway/providers/groq";
import { createOpenAIModelProvider } from "@capital-q/model-gateway/providers/openai";

type WorkerConfig = ReturnType<typeof loadWorkerConfig>;

/**
 * The worker's one governed model path: the same Model Gateway, catalogue
 * and reviewed provider ceilings the Q service uses. Shared by the worker
 * runtime and its operator scripts (the deck-reading backfill), so a
 * backfill reads through exactly the pipeline a live upload does.
 */
export function composeWorkerModelGateway(options: {
  readonly config: WorkerConfig;
  readonly databaseUrl: string;
  readonly sql: DatabaseExecutor;
  readonly logger: Parameters<typeof createModelGateway>[0]["logger"];
}) {
  const { config } = options;
  const providerSecrets = config.secrets.modelProviders;
  const providers: ModelProvider[] = [];
  if (providerSecrets.google !== undefined) {
    providers.push(
      createGoogleModelProvider({ apiKey: providerSecrets.google.reveal() }),
    );
  }
  if (providerSecrets.groq !== undefined) {
    providers.push(
      createGroqModelProvider({
        apiKey: providerSecrets.groq.reveal(),
        additionalApiKeys: providerSecrets.groqKeys
          .slice(1)
          .map((key) => key.reveal()),
      }),
    );
  }
  // The routing policies name gpt-5.6-luna first for every task class
  // (20261008130000). A provider the catalogue routes to but nobody
  // registered is PROVIDER_UNCONFIGURED on every call, so every request
  // silently fell to the Gemini fallbacks and failed with them.
  if (providerSecrets.openai !== undefined) {
    providers.push(
      createOpenAIModelProvider({ apiKey: providerSecrets.openai.reveal() }),
    );
  }

  /**
   * Doc 15 §62: free/shared inference may be used aggressively for synthetic
   * data and development, while confidential customer information still
   * requires an approved provider. This is the attestation that this
   * deployment holds the former — an operator opt-in, checked again against
   * the environment and the database before it counts for anything. Null
   * everywhere a real customer is served, which is what makes a
   * SYNTHETIC_DEMO posture inert there.
   */
  const syntheticDemo = createSyntheticDemoRoutingAllowance({
    operatorEnabled: providerSecrets.syntheticDemoRouting,
    environment: config.runtime.deploymentEnvironment,
    databaseUrl: options.databaseUrl,
    // Hosted staging attests the same way q-api does (QX-004 §0.3): without
    // these the opt-in throws at startup on Railway, so the worker could only
    // ever run REAL_CUSTOMER there while q-api ran the synthetic posture.
    hostedAttested: providerSecrets.syntheticDemoAttested,
    ...(providerSecrets.syntheticDemoProjectRef === undefined
      ? {}
      : { syntheticProjectRef: providerSecrets.syntheticDemoProjectRef }),
    supabaseUrl: config.public.supabaseUrl,
  });
  /**
   * What kind of material this worker handles (CQ-REC-008 entry gate).
   * The attestation already proves the whole deployment is synthetic;
   * nothing about an individual job decides this, because nothing about an
   * individual job could be trusted to.
   */
  const dataPosture: ModelDataPosture =
    syntheticDemo === null ? "REAL_CUSTOMER" : "SYNTHETIC_DEMO";

  const gateway = createModelGateway({
    catalog: createPostgresModelCatalog({ sql: options.sql }),
    registry: createModelProviderRegistry(providers),
    usage: createPostgresModelUsageRepository({ sql: options.sql }),
    health: createProcessLocalProviderHealth(),
    syntheticDemo,
    logger: options.logger,
  });
  return { providers, syntheticDemo, dataPosture, gateway };
}
