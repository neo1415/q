import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { CONTRACTS_VERSION } from "@capital-q/contracts";
import type { QApiConfig } from "@capital-q/config/q-api";
import {
  createFrameworkLogger,
  createLogger,
  createRequestId,
  type Logger,
  type ServiceIdentity,
} from "@capital-q/observability";

import { registerProblemHandling } from "./http/problem-handler.js";
import type { RequestAuthenticator } from "./security/actor-context.js";

export const SERVICE_NAME = "q-api";

/**
 * The verified human authentication boundary future Q routes protect
 * themselves with. Composed once in main.ts (Supabase-backed) and available
 * to route registration through the instance, so no Q route ever verifies a
 * token on its own. Organisation context resolution is added alongside the
 * first Q route that needs a database.
 */
export type QApiSecurityDependencies = {
  readonly authenticator: RequestAuthenticator;
};

declare module "fastify" {
  interface FastifyInstance {
    security: QApiSecurityDependencies;
  }
}

/**
 * Build the Q API without binding a port.
 *
 * Separating composition from process startup lets tests drive real HTTP
 * behaviour through fastify.inject() instead of opening sockets, which is what
 * makes the error contract testable at all.
 */
export function createApp(
  config: QApiConfig,
  security: QApiSecurityDependencies,
): {
  readonly app: FastifyInstance;
  readonly logger: Logger;
} {
  const identity: ServiceIdentity = {
    serviceName: SERVICE_NAME,
    environment: config.runtime.deploymentEnvironment,
    serviceVersion: config.observability.serviceVersion,
    region: config.observability.region,
  };

  const logger = createLogger(identity, {
    level: config.observability.logLevel,
  });

  // Fastify owns its own request logging, so it is given the same underlying
  // instance rather than running a second logger with different fields.
  //
  // Typed as FastifyBaseLogger rather than the concrete pino Logger: handing
  // Fastify the narrower type specialises its logger generic, which would make
  // this instance incompatible with plain FastifyInstance everywhere else.
  const frameworkLogger: FastifyBaseLogger = createFrameworkLogger(identity, {
    level: config.observability.logLevel,
  });

  const app = Fastify({
    loggerInstance: frameworkLogger,
    // One request identifier for the whole platform. Fastify's default counter
    // is replaced by the observability generator so the id in a log line, the
    // X-Request-Id header and a problem body's requestId are the same value.
    //
    // A client-supplied X-Request-Id is deliberately ignored: an inbound header
    // is untrusted input, and accepting it would let a caller forge or collide
    // with another request's identity in the logs.
    genReqId: () => createRequestId(),
  });

  registerProblemHandling(app, logger);

  app.decorate("security", security);

  // Liveness and readiness are split per doc 21 (74-77): liveness proves the
  // process is alive and performs no dependency checks; readiness will grow to
  // cover configuration and critical initialisation as those are introduced.
  app.get("/health/live", () => ({ status: "ok", service: SERVICE_NAME }));

  app.get("/health/ready", () => ({
    status: "ok",
    service: SERVICE_NAME,
    environment: config.runtime.deploymentEnvironment,
    contracts: CONTRACTS_VERSION,
  }));

  return { app, logger };
}
