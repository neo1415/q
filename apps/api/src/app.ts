import type { CapitalRoundService } from "@capital-q/capital";
import { pitchSummary } from "@capital-q/media";
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
  registerAdminRoutes,
  type AdminRoutesDependencies,
} from "./http/admin.js";
import {
  registerReviewsKybRoutes,
  type ReviewsKybRoutesDependencies,
} from "./http/reviews-kyb.js";
import {
  registerResultsRoutes,
  type ResultsRoutesDependencies,
} from "./http/results.js";
import {
  registerCommitmentRoutes,
  type CommitmentRoutesDependencies,
} from "./http/commitments.js";
import {
  registerCapitalObjectiveRoutes,
  type CapitalRoutesDependencies,
} from "./http/capital-objectives.js";
import {
  registerCompanyRoutes,
  type CompanyRoutesDependencies,
} from "./http/companies.js";
import {
  registerCompanyProfileRoutes,
  type CompanyProfilePorts,
} from "./http/company-profile.js";
import { registerCompanyTeamRoutes } from "./http/company-team.js";
import {
  registerDocumentRoutes,
  type DocumentRoutesDependencies,
} from "./http/documents.js";
import type {
  GateQPolicyExtractionPort,
  QWorkPagePort,
} from "@capital-q/app-actions";

import { deckAudiencePort, documentChangePort } from "./deck-audience-port.js";
import {
  registerAppActionRoutes,
  registerPersonActionRoutes,
} from "./http/app-actions.js";
import { registerInvestorMandateRoutes } from "./http/investor-mandates.js";
import {
  mediaProviderProblem,
  registerMediaRoutes,
  type MediaRoutesDependencies,
} from "./http/media.js";
import {
  registerIntegrationRoutes,
  type IntegrationRoutesDependencies,
} from "./http/integrations.js";
import { registerMediaWebhookRoutes } from "./http/media-webhooks.js";
import {
  registerInboundEmailRoutes,
  type InboundEmailRoutesDependencies,
} from "./http/inbound-email.js";
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
// AUTO block (ADR 0030)
import {
  registerPushRoutes,
  type PushRoutesDependencies,
} from "./http/push.js";
import {
  registerProfileImageRoutes,
  type ProfileImageRoutesDependencies,
} from "./http/profile-images.js";
import type { NamedPhotos } from "./http/named-photos.js";
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
// P5 block: brand theming
import type { BrandThemeStore } from "@capital-q/platform-admin";

import { registerBrandThemeRoutes } from "./http/brand-theme.js";
// end P5 block
// BILLING block (ADR 0034)
import {
  registerAdminBillingRoutes,
  type AdminBillingRoutesDependencies,
} from "./http/admin-billing.js";
import {
  registerBillingRoutes,
  type BillingRoutesDependencies,
} from "./http/billing.js";
// end BILLING block
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
  /** ADR 0021. Absent: previews offer only videos opened to the network. */
  readonly watchesAsInvestor?:
    CompanyRoutesDependencies["watchesAsInvestor"] | undefined;
  readonly companySectorDeclared?:
    CompanyRoutesDependencies["sectorDeclared"] | undefined;
  /** A company's profile from Discover. Absent: the route is not served. */
  readonly companyProfile?: CompanyProfilePorts | undefined;
  readonly investors?: InvestorRoutesDependencies["investors"] | undefined;
  readonly discovery?:
    | (Pick<DiscoveryRoutesDependencies, "discovery" | "slates"> & {
        /** CQ-REC-008. Absent: the feed reads, and nothing records. */
        readonly interactions?:
          | RecommendationInteractionRoutesDependencies["interactions"]
          | undefined;
        /** CQ-MEDIA-012. Absent: every feed item's pitch is null. */
        readonly pitches?: DiscoveryRoutesDependencies["pitches"] | undefined;
        /** Discover v2. Absent: cards carry no summary. */
        readonly feedSummaries?:
          DiscoveryRoutesDependencies["feedSummaries"] | undefined;
        /** ADR 0021. Absent: the founders' network feed is empty. */
        readonly networkPitches?:
          DiscoveryRoutesDependencies["networkPitches"] | undefined;
        readonly networkCompany?:
          DiscoveryRoutesDependencies["networkCompany"] | undefined;
        /** ADR 0023. Absent: investor cards show initials. */
        readonly investorImages?:
          DiscoveryRoutesDependencies["investorImages"] | undefined;
        /** "Your companies" row (2026-10-02). Absent: the row is empty. */
        readonly yourCompanies?:
          DiscoveryRoutesDependencies["yourCompanies"] | undefined;
        /** The playback rule the row lists by. Absent: the row is empty. */
        readonly mayPlay?: DiscoveryRoutesDependencies["mayPlay"] | undefined;
      })
    | undefined;
  readonly capital?: CapitalRoutesDependencies["capital"] | undefined;
  /** CQ-NET-010: Express Interest. Absent: no interest route registers. */
  readonly interests?:
    NetworkInterestRoutesDependencies["interests"] | undefined;
  /** Capital Q's admin console. Absent: those routes do not register. */
  readonly admin?: AdminRoutesDependencies["admin"] | undefined;
  /** P5: brand colour; registers only alongside `admin`. */
  readonly brand?: BrandThemeStore | undefined;
  // ADMIN block (ADR 0033)
  readonly adminFreshTokens?: AdminRoutesDependencies["freshTokens"];
  readonly adminVerificationDecider?: AdminRoutesDependencies["decideVerification"];
  // ADMIN-3 block
  readonly adminCloseKyb?: AdminRoutesDependencies["closeKyb"];
  readonly adminKybDownload?: AdminRoutesDependencies["kybDownload"];
  readonly kyb?: ReviewsKybRoutesDependencies["kyb"] | undefined;
  // end ADMIN-3 block
  readonly results?: ResultsRoutesDependencies["results"] | undefined;
  // end ADMIN block
  /** Diligence (2026-10-02). Absent: those routes do not register. */
  readonly diligence?:
    NetworkInterestRoutesDependencies["diligence"] | undefined;
  /** Post-meeting outcomes (2026-10-02). Absent: those routes do not register. */
  readonly outcomes?: NetworkInterestRoutesDependencies["outcomes"] | undefined;
  /** Spec 6.6.14: commitments and the raise. Absent: those routes do not register. */
  readonly commitments?:
    CommitmentRoutesDependencies["commitments"] | undefined;
  /** Capital rounds (2026-10-04). Absent: the rounds and the book do not register. */
  readonly capitalRounds?: CapitalRoundService | undefined;
  // BILLING block (ADR 0034): plans, usage, checkout, the Stripe webhook,
  // and the console's billing controls. Absent: none of it registers and
  // nothing is gated.
  readonly billing?:
    Omit<BillingRoutesDependencies, "authenticator" | "resolver"> | undefined;
  readonly adminBilling?:
    | Omit<
        AdminBillingRoutesDependencies,
        "authenticator" | "resolver" | "admin"
      >
    | undefined;
  // end BILLING block
  /** ADR 0023: founders' Connection Requests. Absent: those routes do not register. */
  readonly connections?:
    NetworkInterestRoutesDependencies["connections"] | undefined;
  /** A gateway's submitted applications, for its organisation. */
  readonly gateqInbox?: GateQRoutesDependencies["inbox"] | undefined;
  /** P7: an investor's mandate read into DRAFT gateway rules (ADR 0040 port). */
  readonly gateqPolicyExtraction?: GateQPolicyExtractionPort | undefined;
  /** CQ-GATE-001: the investor organisation's inbound gateway. */
  readonly gateq?: GateQRoutesDependencies["gateq"] | undefined;
  /** The public gateway page's card-scoped organisation images. */
  readonly gateqPublicImages?: GateQRoutesDependencies["publicImages"];
  /** CQ-GATE-002: the public applicant surface. Anonymous by design. */
  readonly gateqApply?: GateQApplyRoutesDependencies | undefined;
  readonly taxonomy?: TaxonomyRoutesDependencies["taxonomy"] | undefined;
  readonly onboarding?: OnboardingRoutesDependencies["onboarding"] | undefined;
  readonly onboardingNudges?: OnboardingRoutesDependencies["nudges"];
  readonly evidence?: DocumentRoutesDependencies["evidence"] | undefined;
  /** P3: the owner's own file, a short-lived link (needs storage). */
  readonly documentFileLink?: DocumentRoutesDependencies["fileLink"];
  readonly media?: MediaRoutesDependencies["media"] | undefined;
  /** CQ-VERIFY-001: a founder asks and reads; nothing here decides. */
  readonly verification?:
    VerificationRoutesDependencies["verification"] | undefined;
  /** CQ-BIZ-003: the visibility control centre. */
  readonly visibility?: VisibilityRoutesDependencies["visibility"] | undefined;
  /** BIZ-007: a person's own connected Gmail and reply push. */
  /** Inbound email (Postmark): the person's Q address and the webhook. */
  readonly inboundEmail?:
    | Pick<InboundEmailRoutesDependencies, "inboundEmail" | "webhookSecret">
    | undefined;
  readonly integrations?:
    | Pick<IntegrationRoutesDependencies, "integrations" | "webOrigin" | "push">
    | undefined;
  /** R34: relationship chat. Absent: no chat route registers. */
  readonly chat?: ChatRoutesDependencies["chat"] | undefined;
  /** R34 safety: block, unblock, report. Registers only beside `chat`. */
  readonly chatSafety?: ChatRoutesDependencies["safety"] | undefined;
  /** BIZ-008: meetings, reminders, notifications. Absent: none register. */
  readonly schedule?: ScheduleRoutesDependencies["schedule"] | undefined;
  /** AUTO: Web Push subscriptions and notification settings. */
  readonly push?:
    Pick<PushRoutesDependencies, "subscriptions" | "publicKey"> | undefined;
  /** BIZ-004: handles and the Q Card. Absent: no card or /@handle route. */
  readonly publicIdentity?:
    QCardRoutesDependencies["publicIdentity"] | undefined;
  /** Profile photos and covers. Absent: no image routes register. */
  readonly profileImages?:
    ProfileImageRoutesDependencies["profileImages"] | undefined;
  /** WORK-58: pause/resume their own instruction, set a suggestion aside. */
  readonly qWork?: QWorkPagePort | undefined;
  /**
   * Pictures of the people and organisations a list names (founder
   * decision 2026-10-04). Absent: those lists read as initials.
   */
  readonly namedPhotos?: NamedPhotos | undefined;
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
      watchesAsInvestor: modules.watchesAsInvestor,
      sectorDeclared: modules.companySectorDeclared,
    });
    registerCompanyTeamRoutes(app, {
      authenticator: security.authenticator,
      resolver: security.resolver,
      companies: modules.companies,
    });
    if (modules.companyProfile !== undefined) {
      registerCompanyProfileRoutes(app, {
        authenticator: security.authenticator,
        resolver: security.resolver,
        companies: modules.companies,
        pitches: modules.companyPitches,
        networkView: modules.companyNetworkView,
        profile: modules.companyProfile,
      });
    }
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
      feedSummaries: modules.discovery.feedSummaries,
      interactions: modules.discovery.interactions,
      networkPitches: modules.discovery.networkPitches,
      networkCompany: modules.discovery.networkCompany,
      investorImages: modules.discovery.investorImages,
      yourCompanies: modules.discovery.yourCompanies,
      mayPlay: modules.discovery.mayPlay,
      namedPhotos: modules.namedPhotos,
    });
    if (modules.discovery.interactions !== undefined) {
      registerRecommendationInteractionRoutes(app, {
        authenticator: security.authenticator,
        resolver: security.resolver,
        interactions: modules.discovery.interactions,
      });
    }
  }

  // ADR 0040 (Proposed): the routes of the app's declared actions, each on
  // its own path, through the services composed above.
  const push = modules.push;
  registerAppActionRoutes(app, {
    authenticator: security.authenticator,
    resolver: security.resolver,
    // The video provider's failures, as the pitch routes always answered.
    problemOf: mediaProviderProblem,
    ports: {
      ...(modules.media === undefined ? {} : { media: modules.media }),
      ...(modules.companies === undefined
        ? {}
        : { companies: modules.companies }),
      ...(modules.investors === undefined
        ? {}
        : { investors: modules.investors }),
      ...(modules.publicIdentity === undefined
        ? {}
        : { publicIdentity: modules.publicIdentity }),
      ...(modules.companyPitches === undefined
        ? {}
        : {
            companyPitch: async (companyId: string) => {
              const pitch = (
                await modules.companyPitches?.findDiscoverablePitches([
                  companyId,
                ])
              )?.get(companyId);
              return pitch === undefined ? null : pitchSummary(pitch);
            },
          }),
      ...(modules.discovery?.interactions === undefined
        ? {}
        : { interactions: modules.discovery.interactions }),
      ...(modules.capital === undefined ? {} : { capital: modules.capital }),
      ...(modules.visibility === undefined
        ? {}
        : { visibility: modules.visibility }),
      ...(modules.interests === undefined
        ? {}
        : { interests: modules.interests }),
      ...(modules.connections === undefined
        ? {}
        : { connections: modules.connections }),
      ...(modules.outcomes === undefined ? {} : { outcomes: modules.outcomes }),
      ...(modules.commitments === undefined
        ? {}
        : { commitments: modules.commitments }),
      ...(modules.capitalRounds === undefined
        ? {}
        : { capitalRounds: modules.capitalRounds }),
      ...(modules.diligence === undefined
        ? {}
        : { diligence: modules.diligence }),
      ...(modules.chat === undefined ? {} : { chat: modules.chat }),
      ...(modules.schedule === undefined ? {} : { schedule: modules.schedule }),
      ...(modules.media === undefined ? {} : { pitchUploads: modules.media }),
      ...(modules.profileImages === undefined
        ? {}
        : { profileImages: modules.profileImages }),
      ...(push === undefined
        ? {}
        : {
            notificationSettings: {
              settings: (actor) => push.subscriptions.settings(actor),
              saveSettings: (actor, input) =>
                push.subscriptions.saveSettings(actor, input),
              pushAvailable: push.publicKey !== null,
            },
          }),
      ...(modules.integrations === undefined
        ? {}
        : { google: modules.integrations.integrations }),
      ...(modules.inboundEmail === undefined
        ? {}
        : { inboundEmail: modules.inboundEmail.inboundEmail }),
      ...(modules.verification === undefined
        ? {}
        : { verification: modules.verification }),
      // The person's side of reviews registers with KYB (ADMIN-3).
      ...(modules.admin === undefined || modules.kyb === undefined
        ? {}
        : { reviews: modules.admin, kyb: modules.kyb }),
      ...(modules.evidence === undefined
        ? {}
        : {
            documentUploads: modules.evidence,
            documentUploadLimits: {
              maxBytes: config.public.documentUploadMaxBytes,
              allowedMimeTypes: ADMISSIBLE_MIME_TYPES,
            },
          }),
      ...(modules.chatSafety === undefined
        ? {}
        : { chatSafety: modules.chatSafety }),
      ...(modules.evidence === undefined
        ? {}
        : {
            deckAudience: deckAudiencePort(modules.evidence),
            documentChanges: documentChangePort(modules.evidence),
          }),
      ...(modules.qWork === undefined ? {} : { qWork: modules.qWork }),
      ...(modules.gateqPolicyExtraction === undefined
        ? {}
        : { gateqPolicyExtraction: modules.gateqPolicyExtraction }),
    },
  });
  // ADR 0040: person-scoped routes (onboarding), under the onboarding actor.
  registerPersonActionRoutes(app, {
    authenticator: security.authenticator,
    resolver: security.resolver,
    identities: security.identities,
    ports: {
      ...(modules.onboarding === undefined
        ? {}
        : { onboarding: modules.onboarding }),
      ...(modules.onboardingNudges === undefined
        ? {}
        : { onboardingNudges: modules.onboardingNudges }),
      ...(security.people === undefined ? {} : { people: security.people }),
    },
  });

  if (modules.admin !== undefined) {
    registerAdminRoutes(app, {
      authenticator: security.authenticator,
      resolver: security.resolver,
      admin: modules.admin,
      freshTokens: modules.adminFreshTokens,
      decideVerification: modules.adminVerificationDecider,
      closeKyb: modules.adminCloseKyb,
      kybDownload: modules.adminKybDownload,
    });
    // ADMIN-3 block: the person's side of reviews and KYB.
    if (modules.kyb !== undefined) {
      registerReviewsKybRoutes(app, {
        authenticator: security.authenticator,
        resolver: security.resolver,
        reviews: modules.admin,
        kyb: modules.kyb,
      });
    }
    // end ADMIN-3 block
    // BILLING block
    // P5 block: brand theming
    if (modules.brand !== undefined) {
      registerBrandThemeRoutes(app, {
        authenticator: security.authenticator,
        resolver: security.resolver,
        admin: modules.admin,
        brand: modules.brand,
      });
    }
    // end P5 block
    if (modules.adminBilling !== undefined) {
      registerAdminBillingRoutes(app, {
        authenticator: security.authenticator,
        resolver: security.resolver,
        admin: modules.admin,
        ...modules.adminBilling,
      });
    }
    // end BILLING block
  }

  // BILLING block
  if (modules.billing !== undefined) {
    registerBillingRoutes(app, {
      authenticator: security.authenticator,
      resolver: security.resolver,
      ...modules.billing,
    });
  }
  // end BILLING block

  // ADMIN block
  if (modules.results !== undefined) {
    registerResultsRoutes(app, {
      authenticator: security.authenticator,
      resolver: security.resolver,
      results: modules.results,
    });
  }
  // end ADMIN block

  if (modules.commitments !== undefined) {
    registerCommitmentRoutes(app, {
      authenticator: security.authenticator,
      resolver: security.resolver,
      commitments: modules.commitments,
      capital: modules.capital,
      capitalRounds: modules.capitalRounds,
    });
  }

  // Express Interest (CQ-NET-010): the relationship spine's one command.
  // Separate from discovery's Save/Pass on purpose: Interest ≠ Save.
  if (modules.interests !== undefined) {
    registerNetworkInterestRoutes(app, {
      authenticator: security.authenticator,
      resolver: security.resolver,
      interests: modules.interests,
      connections: modules.connections,
      outcomes: modules.outcomes,
      diligence: modules.diligence,
      namedPhotos: modules.namedPhotos,
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
      namedPhotos: modules.namedPhotos,
    });
  }

  // AUTO block (ADR 0030): Web Push and notification settings.
  if (modules.push !== undefined) {
    registerPushRoutes(app, {
      authenticator: security.authenticator,
      resolver: security.resolver,
      ...modules.push,
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
      inbox: modules.gateqInbox,
      entitlements: modules.billing?.entitlements,
      publicImages: modules.gateqPublicImages,
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
      ...(modules.documentFileLink === undefined
        ? {}
        : { fileLink: modules.documentFileLink }),
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

  // Inbound email: the webhook's authority is basic auth in the hook URL;
  // without its secret it answers 503 -- a closed door, never an open one.
  if (modules.inboundEmail !== undefined) {
    registerInboundEmailRoutes(app, {
      authenticator: security.authenticator,
      resolver: security.resolver,
      ...modules.inboundEmail,
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
