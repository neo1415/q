import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";

import { Q_VOICE_THINK_PATH } from "@capital-q/contracts";
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
import { registerQMcpRoute, type QMcpRouteDependencies } from "./http/q-mcp.js";
import {
  registerQApprovalRoutes,
  type QApprovalRoutesDependencies,
} from "./http/q-approvals.js";
import {
  registerQEventRoutes,
  type QEventRoutesDependencies,
  type QEventStreamRegistry,
} from "./http/q-events.js";
import {
  registerQRunRoutes,
  type QRunRoutesDependencies,
} from "./http/q-runs.js";
import type { RequestAuthenticator } from "./security/actor-context.js";
import {
  registerQVoiceRoutes,
  type QVoiceRoutesDependencies,
} from "./voice/routes.js";
import { registerVoiceThinkRoute } from "./voice/think.js";
import type { VoiceTurnHandler } from "./voice/turn.js";

export const SERVICE_NAME = "q-api";

/**
 * The verified human authentication boundary Q routes protect themselves
 * with, plus the server-side actor-context resolver the run routes need.
 * Composed once in main.ts (Supabase- and PostgreSQL-backed) and handed to
 * route registration, so no Q route ever verifies a token or looks up a
 * membership on its own.
 *
 * The resolver is optional only so a test can build the app without a
 * database to exercise the shared error boundary; registering the run
 * routes without one is a composition error, not a degraded mode.
 */
export type QApiSecurityDependencies = {
  readonly authenticator: RequestAuthenticator;
  readonly resolver?: QRunRoutesDependencies["resolver"] | undefined;
  /** Application identity, for the routes a person may use before any organisation. */
  readonly identity?: QVoiceRoutesDependencies["identity"] | undefined;
};

/**
 * Runtime modules the Q API exposes. Absent modules register no routes,
 * which is how tests that exercise only the security boundary build an app
 * without a database.
 */
export type QApiModules = {
  readonly qRuntime?: QRunRoutesDependencies["qRuntime"] | undefined;
  /** The orchestration boundary; absent means runs are only persisted. */
  readonly orchestration?: QRunRoutesDependencies["orchestration"];
  /** The Approval Engine (CQ-Q-008); absent means no approval routes. */
  readonly qActions?: QApprovalRoutesDependencies["qActions"] | undefined;
  /** The resumable run stream (CQ-Q-009); absent means no events route. */
  readonly qStream?:
    | {
        readonly service: QEventRoutesDependencies["qStream"];
        readonly options?: QEventRoutesDependencies["options"];
      }
    | undefined;
  /**
   * Q as an MCP server (doc 12 §34.2); absent means no MCP route. The
   * composition root passes it only when configuration enables it.
   */
  readonly mcp?:
    | Pick<QMcpRouteDependencies, "firewall" | "registry" | "tools" | "logger">
    | undefined;
  /** The realtime voice channel (CQ-Q-VOICE-001 C); absent means no voice routes. */
  readonly voice?:
    | ({
        /** The turn handler, for the Deepgram think route; absent means no think route. */
        readonly turn?: VoiceTurnHandler | undefined;
        readonly logger?: Logger | undefined;
      } & Pick<
        QVoiceRoutesDependencies,
        | "provider"
        | "bindings"
        | "now"
        | "interviewer"
        | "apiBaseUrl"
        | "board"
        | "welcome"
        | "deepgram"
      >)
    | undefined;
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
/**
 * How long active connections may finish after shutdown begins before they
 * are closed (doc 21 §80, §113 of CQ-Q-009). Event streams are ended at
 * once through their own hook; this bounds everything else.
 */
export const SHUTDOWN_GRACE_MS = 5_000;

export function createApp(
  config: QApiConfig,
  security: QApiSecurityDependencies,
  modules: QApiModules = {},
  options: { readonly shutdownGraceMs?: number | undefined } = {},
): {
  readonly app: FastifyInstance;
  readonly logger: Logger;
  /** Open SSE streams in this process; present when the events route is registered. */
  readonly streams: QEventStreamRegistry | undefined;
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

  // Graceful shutdown: no new connections, idle ones closed now, active
  // ones given a bounded grace and then closed, so a deploy never waits
  // forever on a socket (doc 21 §80). Fastify runs this before
  // server.close(); the route-level stream hook runs alongside it.
  app.addHook("preClose", (done) => {
    const server = app.server;
    server.closeIdleConnections();
    const force = setTimeout(() => {
      server.closeAllConnections();
    }, options.shutdownGraceMs ?? SHUTDOWN_GRACE_MS);
    force.unref();
    done();
  });

  app.decorate("security", security);

  // The run lifecycle routes. They need the server-side resolver: a run is
  // owned by a person in a tenant, and both come from trusted resolution,
  // never from the request. Composing the runtime without a resolver is a
  // wiring fault and fails here rather than at the first request.
  if (modules.qRuntime !== undefined) {
    if (security.resolver === undefined) {
      throw new Error(
        "q-api: the Q runtime routes require an actor context resolver",
      );
    }
    registerQRunRoutes(app, {
      authenticator: security.authenticator,
      resolver: security.resolver,
      identity: security.identity,
      qRuntime: modules.qRuntime,
      orchestration: modules.orchestration,
    });
  }

  // The approval routes (CQ-Q-008). Same resolver rule: an approver is a
  // person resolved from the verified session, never from the request.
  if (modules.qActions !== undefined) {
    if (security.resolver === undefined) {
      throw new Error(
        "q-api: the Q approval routes require an actor context resolver",
      );
    }
    registerQApprovalRoutes(app, {
      authenticator: security.authenticator,
      resolver: security.resolver,
      qActions: modules.qActions,
      orchestrator: modules.orchestration?.orchestrator,
    });
  }

  // The events stream (CQ-Q-009). Owner-only, server-resolved actor, and a
  // response that is a projection of the durable run events.
  let streams: QEventStreamRegistry | undefined;
  if (modules.qStream !== undefined) {
    if (security.resolver === undefined) {
      throw new Error(
        "q-api: the Q events route requires an actor context resolver",
      );
    }
    streams = registerQEventRoutes(app, {
      authenticator: security.authenticator,
      resolver: security.resolver,
      identity: security.identity,
      qStream: modules.qStream.service,
      options: modules.qStream.options,
      logger,
    });
  }

  // The voice session route (CQ-Q-VOICE-001 C). A credential is bound to
  // a server-resolved actor before it is issued, so the same resolver rule
  // applies.
  if (modules.voice !== undefined) {
    if (security.resolver === undefined) {
      throw new Error(
        "q-api: the Q voice routes require an actor context resolver",
      );
    }
    registerQVoiceRoutes(app, {
      authenticator: security.authenticator,
      resolver: security.resolver,
      identity: security.identity,
      provider: modules.voice.provider,
      bindings: modules.voice.bindings,
      interviewer: modules.voice.interviewer,
      apiBaseUrl: modules.voice.apiBaseUrl,
      board: modules.voice.board,
      welcome: modules.voice.welcome,
      deepgram: modules.voice.deepgram,
      now: modules.voice.now,
    });
    if (
      modules.voice.deepgram !== undefined &&
      modules.voice.turn !== undefined &&
      modules.voice.logger !== undefined
    ) {
      registerVoiceThinkRoute(app, {
        path: Q_VOICE_THINK_PATH,
        bindings: modules.voice.bindings,
        turn: modules.voice.turn,
        logger: modules.voice.logger,
      });
    }
  }

  // The MCP façade (doc 12 §34.2). A host is a person with a session and an
  // organisation, resolved server-side like every other caller.
  if (modules.mcp !== undefined) {
    if (security.resolver === undefined) {
      throw new Error(
        "q-api: the Q MCP route requires an actor context resolver",
      );
    }
    registerQMcpRoute(app, {
      authenticator: security.authenticator,
      resolver: security.resolver,
      ...modules.mcp,
    });
  }

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

  return { app, logger, streams };
}
