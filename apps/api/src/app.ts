import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { CONTRACTS_VERSION } from "@capital-q/contracts";
import { ADMISSIBLE_MIME_TYPES } from "@capital-q/evidence";
import type { ApiConfig } from "@capital-q/config/api";
import {
  createFrameworkLogger,
  createLogger,
  createRequestId,
  type Logger,
  type ServiceIdentity,
} from "@capital-q/observability";

import {
  registerCapitalObjectiveRoutes,
  type CapitalRoutesDependencies,
} from "./http/capital-objectives.js";
import {
  registerCompanyRoutes,
  type CompanyRoutesDependencies,
} from "./http/companies.js";
import { registerCompanyTeamRoutes } from "./http/company-team.js";
import {
  registerDocumentRoutes,
  type DocumentRoutesDependencies,
} from "./http/documents.js";
import { registerInvestorMandateRoutes } from "./http/investor-mandates.js";
import {
  registerInvestorRoutes,
  type InvestorRoutesDependencies,
} from "./http/investors.js";
import { registerMeRoute, type MeRouteDependencies } from "./http/me.js";
import {
  registerOnboardingRoutes,
  type OnboardingRoutesDependencies,
} from "./http/onboarding.js";
import {
  registerOrganisationRoutes,
  type OrganisationRoutesDependencies,
} from "./http/organisations.js";
import { registerProblemHandling } from "./http/problem-handler.js";
import {
  registerTaxonomyRoutes,
  type TaxonomyRoutesDependencies,
} from "./http/taxonomy.js";

export const SERVICE_NAME = "api";

/** The resource identity every logger and meter of this deployable carries. */
export function apiServiceIdentity(config: ApiConfig): ServiceIdentity {
  return {
    serviceName: SERVICE_NAME,
    environment: config.runtime.deploymentEnvironment,
    serviceVersion: config.observability.serviceVersion,
    region: config.observability.region,
  };
}

/**
 * The security boundary the composition root hands the application: how a
 * request is authenticated, how a person's organisation context is resolved,
 * and how an auth subject maps to a Person. Production wires Supabase and
 * PostgreSQL; tests hand in doubles. Routes never construct these themselves.
 */
export type ApiSecurityDependencies = MeRouteDependencies;

/**
 * Domain modules the API exposes. Each is an application service from its
 * bounded context; the routes here only adapt HTTP to it. Absent modules
 * register no routes, which is how tests that exercise only the security
 * boundary build an app without a database.
 */
export type ApiModules = {
  readonly organisations?:
    OrganisationRoutesDependencies["organisations"] | undefined;
  readonly companies?: CompanyRoutesDependencies["companies"] | undefined;
  readonly investors?: InvestorRoutesDependencies["investors"] | undefined;
  readonly capital?: CapitalRoutesDependencies["capital"] | undefined;
  readonly taxonomy?: TaxonomyRoutesDependencies["taxonomy"] | undefined;
  readonly onboarding?: OnboardingRoutesDependencies["onboarding"] | undefined;
  readonly evidence?: DocumentRoutesDependencies["evidence"] | undefined;
};

/**
 * Build the API without binding a port.
 *
 * Separating composition from process startup lets tests drive real HTTP
 * behaviour through fastify.inject() instead of opening sockets, which is what
 * makes the error contract testable at all.
 */
export function createApp(
  config: ApiConfig,
  security: ApiSecurityDependencies,
  modules: ApiModules = {},
): {
  readonly app: FastifyInstance;
  readonly logger: Logger;
} {
  const identity = apiServiceIdentity(config);

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

  registerMeRoute(app, security);

  if (modules.organisations !== undefined) {
    registerOrganisationRoutes(app, {
      authenticator: security.authenticator,
      resolver: security.resolver,
      organisations: modules.organisations,
    });
  }

  if (modules.companies !== undefined) {
    registerCompanyRoutes(app, {
      authenticator: security.authenticator,
      resolver: security.resolver,
      companies: modules.companies,
    });
    registerCompanyTeamRoutes(app, {
      authenticator: security.authenticator,
      resolver: security.resolver,
      companies: modules.companies,
    });
  }

  if (modules.investors !== undefined) {
    registerInvestorRoutes(app, {
      authenticator: security.authenticator,
      resolver: security.resolver,
      investors: modules.investors,
    });
    registerInvestorMandateRoutes(app, {
      authenticator: security.authenticator,
      resolver: security.resolver,
      investors: modules.investors,
    });
  }

  if (modules.capital !== undefined) {
    registerCapitalObjectiveRoutes(app, {
      authenticator: security.authenticator,
      resolver: security.resolver,
      capital: modules.capital,
    });
  }

  if (modules.taxonomy !== undefined) {
    registerTaxonomyRoutes(app, {
      authenticator: security.authenticator,
      resolver: security.resolver,
      taxonomy: modules.taxonomy,
    });
  }

  // Onboarding works before a person belongs to an organisation, so its
  // routes resolve the Person identity as well as the optional context.
  if (modules.onboarding !== undefined) {
    registerOnboardingRoutes(app, {
      authenticator: security.authenticator,
      resolver: security.resolver,
      identities: security.identities,
      onboarding: modules.onboarding,
    });
  }

  // Documents register only when the Evidence module is composed. Without
  // a storage credential the upload boundary is closed, not open.
  if (modules.evidence !== undefined) {
    registerDocumentRoutes(app, {
      authenticator: security.authenticator,
      resolver: security.resolver,
      evidence: modules.evidence,
      uploads: {
        maxBytes: config.public.documentUploadMaxBytes,
        allowedMimeTypes: ADMISSIBLE_MIME_TYPES,
      },
    });
  }

  return { app, logger };
}
