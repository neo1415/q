import {
  billingAccountOf,
  createEntitlementService,
  FEATURE_AI_IMAGES,
} from "@capital-q/billing";
import type { ModelProviderSecrets } from "@capital-q/config/model-providers";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import {
  createPostgresModelUsageRepository,
  type ModelGateway,
} from "@capital-q/model-gateway";
import {
  createImageGateway,
  type ImageProvider,
} from "@capital-q/model-gateway/images";
import { createGoogleImageProvider } from "@capital-q/model-gateway/images/google";
import { createOpenAIImageProvider } from "@capital-q/model-gateway/images/openai";
import { createPexelsStockPhotoProvider } from "@capital-q/model-gateway/images/stock";
import type { Logger } from "@capital-q/observability";
import {
  createArtifactService,
  createDocumentImages,
  createPostgresArtifactRepository,
  createPostgresDocumentJobRepository,
  createSupabaseDocumentImageStore,
} from "@capital-q/q-artifacts";
import { createDeckPolisher } from "@capital-q/q-specialists";

import type { RunnerLogger } from "../outbox-runner.js";
import {
  createDocumentJobRunner,
  type DocumentJobRunner,
} from "./document-jobs.js";

/**
 * The document worker, composed (Q room W5, R8).
 *
 * Stock photos come from Pexels (`PEXELS_API`, founder clarification
 * 2026-10-06). Generated pictures are off unless CQ_DOCUMENT_IMAGES is
 * `enabled` and the private image bucket is reachable; every picture is
 * metered as one unit of the plan's AI images (surface WORKER), counted
 * against the per-document (max 6), per-organisation, per-person-dollar
 * and platform daily budgets, and a billing refusal pauses the key.
 * Disabled provider keys (tests, local stacks) configure nothing.
 */

const usable = (value: string | undefined): value is string =>
  value !== undefined && value.length >= 20 && !value.startsWith("disabled");

function intFrom(raw: string | undefined, fallback: number, max: number) {
  const value = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(value) && value >= 0
    ? Math.min(value, max)
    : fallback;
}

export function composeDocumentJobs(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly gateway: ModelGateway;
  readonly modelsAvailable: boolean;
  readonly providerSecrets: ModelProviderSecrets;
  readonly supabaseUrl: string | undefined;
  readonly supabaseSecretKey: string | undefined;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly logger: Logger & RunnerLogger;
}): DocumentJobRunner {
  const { sql, env, logger } = dependencies;
  const jobs = createPostgresDocumentJobRepository({ sql });
  const artifacts = createArtifactService({
    repository: createPostgresArtifactRepository({ sql }),
    transactions: dependencies.transactions,
    jobs,
    logger,
  });

  // Gemini first: the founder funds a billed Gemini account for pictures;
  // the small OpenAI top-up is only the fallback.
  const providers: ImageProvider[] = [];
  const google = dependencies.providerSecrets.google?.reveal();
  if (usable(google))
    providers.push(createGoogleImageProvider({ apiKey: google }));
  const openai = dependencies.providerSecrets.openai?.reveal();
  if (usable(openai))
    providers.push(createOpenAIImageProvider({ apiKey: openai }));

  const entitlements = createEntitlementService({ sql });
  const images = createDocumentImages({
    sql,
    gateway: createImageGateway({
      enabled: env["CQ_DOCUMENT_IMAGES"] === "enabled",
      providers,
      usage: createPostgresModelUsageRepository({ sql }),
    }),
    store:
      dependencies.supabaseUrl === undefined ||
      dependencies.supabaseSecretKey === undefined
        ? undefined
        : createSupabaseDocumentImageStore({
            supabaseUrl: dependencies.supabaseUrl,
            secretKey: dependencies.supabaseSecretKey,
          }),
    budgets: {
      perDocument: intFrom(env["CQ_DOCUMENT_IMAGES_PER_DOCUMENT"], 6, 6),
      perOrganisationPerDay: intFrom(env["CQ_DOCUMENT_IMAGES_PER_DAY"], 12, 50),
      platformPerDay: intFrom(
        env["CQ_DOCUMENT_IMAGES_PLATFORM_PER_DAY"],
        40,
        500,
      ),
      perUserPerDayUsd: 0.25,
    },
    meter: {
      consume: async (actor, feature, idempotencyKey) => {
        const decision = await entitlements.consume({
          account: billingAccountOf(actor),
          feature,
          idempotencyKey,
          actorUserId: actor.userId,
          surface: "WORKER",
        });
        return { allowed: decision.allowed };
      },
      release: async (actor, feature, idempotencyKey) => {
        await entitlements.release({
          account: billingAccountOf(actor),
          feature,
          idempotencyKey,
          reason: "The picture was not made.",
        });
      },
    },
    meterFeature: FEATURE_AI_IMAGES,
    logger,
  });

  return createDocumentJobRunner({
    jobs,
    artifacts,
    photos: createPexelsStockPhotoProvider(
      env["PEXELS_API"] ?? env["PEXELS_API_KEY"],
    ),
    images,
    polisher: dependencies.modelsAvailable
      ? createDeckPolisher({ gateway: dependencies.gateway, logger })
      : undefined,
    logger,
  });
}
