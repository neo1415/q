import type { ResearchProviderSecrets } from "@capital-q/config/research-providers";
import type { ModelDataPosture } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { AppEmailSender } from "@capital-q/integrations";
import type { ModelGateway } from "@capital-q/model-gateway";
import type { Logger } from "@capital-q/observability";
import {
  createDailyEditionService,
  createGatewayDailyWriters,
  createPexelsDailyPhotos,
  createPostgresDailyWorkerStore,
  readFeed,
  type DailyTickResult,
} from "@capital-q/q-daily";
import { createCorrelationId } from "@capital-q/observability";
import { createFlagReader } from "@capital-q/platform-admin";

import { abortableSleep, type RunnerLogger } from "../outbox-runner.js";
import { composeWorkerResearchProvider } from "../presence/composition.js";

/**
 * The Q Daily, composed for the worker (DAILY spec §6). The worker is the
 * only place editions are prepared: it acts for nobody, reads each
 * person's own records only to choose topics, and spends within the hard
 * caps in `@capital-q/q-daily`'s budget.
 *
 * Without a research provider the paper is made from publisher feeds
 * alone; without a model, stories print their sources' own words; without
 * Pexels, without photographs; without email, in the reader only.
 */
export function composeWorkerDaily(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly gateway: Pick<ModelGateway, "execute">;
  readonly modelsAvailable: boolean;
  readonly dataPosture?: ModelDataPosture | undefined;
  readonly researchSecrets: ResearchProviderSecrets;
  readonly email: AppEmailSender;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly logger?: Logger | undefined;
}): ReturnType<typeof createDailyEditionService> {
  const { provider } = composeWorkerResearchProvider(
    dependencies.researchSecrets,
  );
  const writers = dependencies.modelsAvailable
    ? createGatewayDailyWriters({
        gateway: dependencies.gateway,
        ...(dependencies.dataPosture === undefined
          ? {}
          : { dataPosture: dependencies.dataPosture }),
        ...(dependencies.logger === undefined
          ? {}
          : { logger: dependencies.logger }),
      })
    : undefined;
  const photos = createPexelsDailyPhotos(
    // The deployment's variable is PEXELS_API (as on q-api).
    dependencies.env["PEXELS_API"] ?? dependencies.env["PEXELS_API_KEY"],
  );
  const cap = Number.parseInt(
    dependencies.env["Q_DAILY_MAX_EDITIONS_PER_DAY"] ?? "",
    10,
  );
  return createDailyEditionService({
    store: createPostgresDailyWorkerStore(dependencies.sql),
    ...(provider === undefined ? {} : { index: provider }),
    feeds: (feed, limit, signal) =>
      readFeed(feed, { limit, ...(signal === undefined ? {} : { signal }) }),
    ...(writers === undefined
      ? {}
      : { writer: writers.writer, take: writers.take }),
    ...(photos === undefined ? {} : { photos }),
    email: dependencies.email,
    webOrigin: webOriginOf(dependencies.env["CQ_WEB_ORIGIN"]),
    // ADMIN kill switch (ADR 0033): before generating and before emailing.
    enabled: (() => {
      const flags = createFlagReader(dependencies.sql);
      return () => flags.isEnabled("q.daily");
    })(),
    ...(Number.isFinite(cap) && cap >= 0 ? { maxEditionsPerDay: cap } : {}),
    ...(dependencies.logger === undefined
      ? {}
      : { logger: dependencies.logger }),
  });
}

function webOriginOf(value: string | undefined): string | null {
  if (value === undefined) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.hostname === "127.0.0.1"
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

export const DAILY_TICK_INTERVAL_MS = 60 * 1000;

/**
 * Every minute: new people get their weekly default, due editions are
 * prepared (a few per tick, within the daily cap). One failed tick is
 * logged and the next one runs. `Q_DAILY_DISABLED=1` turns it off.
 */
export async function runDailyTicker(options: {
  readonly daily: {
    readonly tick: (
      now: Date,
      correlationId: string,
    ) => Promise<DailyTickResult>;
  };
  readonly signal: AbortSignal;
  readonly logger: RunnerLogger;
  readonly intervalMs?: number | undefined;
  readonly now?: (() => Date) | undefined;
  readonly sleep?:
    ((ms: number, signal: AbortSignal) => Promise<void>) | undefined;
}): Promise<void> {
  const sleep = options.sleep ?? abortableSleep;
  const now = options.now ?? (() => new Date());
  const intervalMs = options.intervalMs ?? DAILY_TICK_INTERVAL_MS;
  while (!options.signal.aborted) {
    try {
      const result = await options.daily.tick(now(), createCorrelationId());
      if (result.defaults + result.prepared + result.skipped > 0) {
        options.logger.info({ ...result }, "q daily tick");
      }
    } catch {
      options.logger.warn({}, "q daily tick failed; retrying next interval");
    }
    await sleep(intervalMs, options.signal);
  }
}
