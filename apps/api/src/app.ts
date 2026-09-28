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
  registerMediaRoutes,
  type MediaRoutesDependencies,
} from "./http/media.js";
import {
  registerIntegrationRoutes,
  type IntegrationRoutesDependencies,
} from "./http/integrations.js";
import { registerMediaWebhookRoutes } from "./http/media-webhooks.js";
import {
  registerChatRoutes,
  type ChatRoutesDependencies,
} from "./http/chat.js";
import {
  registerScheduleRoutes,
  type ScheduleRoutesDependencies,
} from "./http/schedule.js";
import {
  registerNetworkInterestRoutes,
  type NetworkInterestRoutesDependencies,
} from "./http/network-interests.js";
import {
  registerVisibilityRoutes,
  type VisibilityRoutesDependencies,
} from "./http/visibility.js";
import {
  registerRecommendationInteractionRoutes,
  type RecommendationInteractionRoutesDependencies,
} from "./http/recommendation-interactions.js";
import {
  registerDiscoveryRoutes,
  type DiscoveryRoutesDependencies,
} from "./http/discovery.js";
import {
  registerGateQApplyRoutes,
  type GateQApplyRoutesDependencies,
} from "./http/gateq-apply.js";
import {
  registerGateQRoutes,
  type GateQRoutesDependencies,
} from "./http/gateq.js";
import {
  registerInvestorRoutes,
  type InvestorRoutesDependencies,
} from "./http/investors.js";
import { registerMeRoute, type MeRouteDependencies } from "./http/me.js";
import {
  registerProfileImageRoutes,
  type ProfileImageRoutesDependencies,
} from "./http/profile-images.js";
import {
  registerQCardRoutes,
  type QCardRoutesDependencies,
} from "./http/q-cards.js";
import {
  registerOnboardingRoutes,
  type OnboardingRoutesDependencies,
} from "./http/onboarding.js";
import { createQInterviewClient } from "./q/interview-client.js";
import {
  registerOrganisationRoutes,
  type OrganisationRoutesDependencies,
} from "./http/organisations.js";
import { registerProblemHandling } from "./http/problem-handler.js";
import {
  registerTaxonomyRoutes,
  type TaxonomyRoutesDependencies,
} from "./http/taxonomy.js";
import {
  registerVerificationRoutes,
  type VerificationRoutesDependencies,
} from "./http/verification.js";

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
  /** CQ-MEDIA-012. Absent: a company's `pitch` is null on every read. */
  readonly companyPitches?: CompanyRoutesDependencies["pitches"] | undefined;
  /** Absent: a company's network preview is readable by its owner only. */
  readonly companyNetworkView?:
    CompanyRoutesDependencies["networkView"] | undefined;
  readonly investors?: InvestorRoutesDependencies["investors"] | undefined;
  readonly discovery?:
    | (Pick<DiscoveryRoutesDependencies, "discovery" | "slates"> & {
        /** CQ-REC-008. Absent: the feed reads, and nothing records. */
        readonly interactions?:
          | RecommendationInteractionRoutesDependencies["interactions"]
          | undefined;
        /** CQ-MEDIA-012. Absent: every feed item's pitch is null. */
        readonly pitches?: DiscoveryRoutesDependencies["pitches"] | undefined;
      })
    | undefined;
  readonly capital?: CapitalRoutesDependencies["capital"] | undefined;
  /** CQ-NET-010: Express Interest. Absent: no interest route registers. */
  readonly interests?:
    NetworkInterestRoutesDependencies["interests"] | undefined;
  /** CQ-GATE-001: the investor organisation's inbound gateway. */
  readonly gateq?: GateQRoutesDependencies["gateq"] | undefined;
  /** CQ-GATE-002: the public applicant surface. Anonymous by design. */
  readonly gateqApply?: GateQApplyRoutesDependencies | undefined;
  readonly taxonomy?: TaxonomyRoutesDependencies["taxonomy"] | undefined;
  readonly onboarding?: OnboardingRoutesDependencies["onboarding"] | undefined;
  readonly onboardingNudges?: OnboardingRoutesDependencies["nudges"];
  readonly evidence?: DocumentRoutesDependencies["evidence"] | undefined;
  readonly media?: MediaRoutesDependencies["media"] | undefined;
  /** CQ-VERIFY-001: a founder asks and reads; nothing here decides. */
  readonly verification?:
    VerificationRoutesDependencies["verification"] | undefined;
  /** CQ-BIZ-003: the visibility control centre. */
  readonly visibility?: VisibilityRoutesDependencies["visibility"] | undefined;
  /** BIZ-007: a person's own connected Gmail and reply push. */
  readonly integrations?:
    | Pick<IntegrationRoutesDependencies, "integrations" | "webOrigin" | "push">
    | undefined;
  /** R34: relationship chat. Absent: no chat route registers. */
  readonly chat?: ChatRoutesDependencies["chat"] | undefined;
  /** R34 safety: block, unblock, report. Registers only beside `chat`. */
  readonly chatSafety?: ChatRoutesDependencies["safety"] | undefined;
  /** BIZ-008: meetings, reminders, notifications. Absent: none register. */
  readonly schedule?: ScheduleRoutesDependencies["schedule"] | undefined;
  /** BIZ-004: handles and the Q Card. Absent: no card or /@handle route. */
  readonly publicIdentity?:
    QCardRoutesDependencies["publicIdentity"] | undefined;
  /** Profile photos and covers. Absent: no image routes register. */
  readonly profileImages?:
    | ProfileImageRoutesDependencies["profileImages"]
    | undefined;
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
      pitches: modules.companyPitches,
      networkView: modules.companyNetworkView,
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

  // Discovery (doc 19): the slate both sides read. Registered on its own
  // because it belongs to neither the company nor the investor context.
  if (modules.discovery !== undefined) {
    registerDiscoveryRoutes(app, {
      authenticator: security.authenticator,
      resolver: security.resolver,
      discovery: modules.discovery.discovery,
      slates: modules.discovery.slates,
      pitches: modules.discovery.pitches,
      interactions: modules.discovery.interactions,
    });
    if (modules.discovery.interactions !== undefined) {
      registerRecommendationInteractionRoutes(app, {
        authenticator: security.authenticator,
        resolver: security.resolver,
        interactions: modules.discovery.interactions,
      });
    }
  }

  // Express Interest (CQ-NET-010): the relationship spine's one command.
  // Separate from discovery's Save/Pass on purpose: Interest ≠ Save.
  if (modules.interests !== undefined) {
    registerNetworkInterestRoutes(app, {
      authenticator: security.authenticator,
      resolver: security.resolver,
      interests: modules.interests,
    });
  }

  // Relationship chat (R34): the thread on a connected relationship.
  if (modules.chat !== undefined) {
    registerChatRoutes(app, {
      authenticator: security.authenticator,
      resolver: security.resolver,
      chat: modules.chat,
      safety: modules.chatSafety,
    });
  }

  // Meetings, reminders and notifications (BIZ-008).
  if (modules.schedule !== undefined) {
    registerScheduleRoutes(app, {
      authenticator: security.authenticator,
      resolver: security.resolver,
      schedule: modules.schedule,
    });
  }

  // GateQ (CQ-GATE-001): the organisation's front door. Its own prefix,
  // because a gateway belongs to neither the company nor the discovery
  // context, and its public route is the one anonymous surface here.
  if (modules.gateq !== undefined) {
    registerGateQRoutes(app, {
      authenticator: security.authenticator,
      resolver: security.resolver,
      gateq: modules.gateq,
    });
  }

  // The applicant side (CQ-GATE-002). Registered separately from the
  // configuration routes because it carries no actor at all: a stranger
  // holding a link is the whole audience.
  if (modules.gateqApply !== undefined) {
    registerGateQApplyRoutes(app, modules.gateqApply);
  }

  // Handles and the Q Card (BIZ-004): the owner's card routes and the two
  // anonymous reads behind /@handle and the QR redirect.
  if (modules.publicIdentity !== undefined) {
    registerQCardRoutes(app, {
      authenticator: security.authenticator,
      resolver: security.resolver,
      identities: security.identities,
      publicIdentity: modules.publicIdentity,
    });
  }

  if (modules.profileImages !== undefined) {
    registerProfileImageRoutes(app, {
      authenticator: security.authenticator,
      resolver: security.resolver,
      profileImages: modules.profileImages,
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
      nudges: modules.onboardingNudges,
      // One Q (QX-004 core gate). The conversational turn belongs to the
      // interviewer in q-api; this service carries it there and adapts the
      // answer into the shape the onboarding screen already reads.
      qInterview:
        config.public.qApiBaseUrl === undefined
          ? undefined
          : createQInterviewClient({ baseUrl: config.public.qApiBaseUrl }),
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

  // Pitch media registers only when the Media module is composed. It
  // creates records, never uploads: no provider integration exists yet.
  if (modules.media !== undefined) {
    registerMediaRoutes(app, {
      authenticator: security.authenticator,
      resolver: security.resolver,
      media: modules.media,
    });
    // Provider deliveries (CQ-MEDIA-012). Registered with the Media module
    // because they act on its records; authenticated by signature, not by
    // a person. Without a signing secret the route answers 503 — a closed
    // door, never an open one.
    registerMediaWebhookRoutes(app, {
      media: modules.media,
      cloudflareStreamWebhookSecret:
        config.secrets.videoProviders.cloudflareStreamWebhookSecret?.reveal(),
    });
  }

  if (modules.verification !== undefined) {
    registerVerificationRoutes(app, {
      authenticator: security.authenticator,
      resolver: security.resolver,
      verification: modules.verification,
    });
  }

  if (modules.integrations !== undefined) {
    registerIntegrationRoutes(app, {
      authenticator: security.authenticator,
      resolver: security.resolver,
      ...modules.integrations,
    });
  }

  if (modules.visibility !== undefined) {
    registerVisibilityRoutes(app, {
      authenticator: security.authenticator,
      resolver: security.resolver,
      visibility: modules.visibility,
    });
  }

  return { app, logger };
}
