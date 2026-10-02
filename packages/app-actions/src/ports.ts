import type { CapitalService } from "@capital-q/capital";
import type {
  ChatSafetyService,
  ChatService,
  ScheduleService,
} from "@capital-q/communication";
import type { CompanyService } from "@capital-q/companies";
import type { PitchSummaryDto } from "@capital-q/contracts";
import type { InteractionSignalService } from "@capital-q/discovery";
import type { InvestorService } from "@capital-q/investors";
import type { PublicIdentityService } from "@capital-q/public-identity";
import type { MediaService } from "@capital-q/media";
import type {
  ConnectionService,
  InterestService,
  RelationshipOutcomeService,
} from "@capital-q/network";
import type { VisibilityCentre } from "@capital-q/permissions";
import type { ActorContext, PersonProfileStore } from "@capital-q/security";

import type { DeckAudiencePort } from "./actions/deck.js";

/**
 * The services the declared actions call (ADR 0040). Each composition (the
 * API for routes, the Q API for tools and approved actions) passes its own
 * instances; an action whose port is absent is not offered and its route
 * refuses, never half-runs.
 */
export type AppActionPorts = {
  /** ADR 0041: who may download a pitch deck (the Evidence service). */
  readonly deckAudience?: DeckAudiencePort | undefined;
  readonly media?:
    Pick<MediaService, "listCompanyMedia" | "setPitchDetails"> | undefined;
  readonly interactions?: Pick<InteractionSignalService, "decide"> | undefined;
  /** Profile and records (ADR 0040 checklist): the owning services. */
  readonly companies?:
    | Pick<
        CompanyService,
        | "getCompany"
        | "getMyCompanyMembership"
        | "setCompanyVisibility"
        | "updateCompany"
        | "upsertMyCompanyMembership"
        | "updateMyFounderProfile"
        | "updateCompanyTeamFacts"
      >
    | undefined;
  readonly investors?:
    | Pick<
        InvestorService,
        | "getInvestorOrganisation"
        | "setInvestorVisibility"
        | "updateInvestorOrganisation"
        | "upsertMyInvestorRepresentative"
        | "getInvestorMandate"
        | "listInvestorMandates"
        | "createInvestorMandate"
        | "updateInvestorMandate"
        | "activateInvestorMandate"
        | "closeInvestorMandate"
      >
    | undefined;
  readonly publicIdentity?:
    | Pick<
        PublicIdentityService,
        "getCard" | "claimHandle" | "updateCard" | "handleAvailable"
      >
    | undefined;
  /** The person's own profile record (what to call them, their time zone). */
  readonly people?: Pick<PersonProfileStore, "read" | "update"> | undefined;
  /** Relationship chat (R34): sending and the person's own safety acts. */
  readonly chat?: Pick<ChatService, "send" | "unsend"> | undefined;
  readonly chatSafety?:
    Pick<ChatSafetyService, "block" | "unblock" | "report"> | undefined;
  /** Pitch media: the record, its upload and playback policy. */
  readonly pitchUploads?:
    | Pick<
        MediaService,
        | "createCompanyPitch"
        | "deleteCompanyPitch"
        | "createUploadSession"
        | "cancelUpload"
        | "setPitchPlaybackPolicy"
      >
    | undefined;
  /** Calls and reminders: the schedule service. */
  readonly schedule?:
    | Pick<
        ScheduleService,
        "schedule" | "cancel" | "createReminder" | "dismissReminder"
      >
    | undefined;
  /** Interest and connection requests: the network services. */
  readonly interests?:
    Pick<InterestService, "expressInterest" | "respondToInterest"> | undefined;
  readonly connections?:
    | Pick<
        ConnectionService,
        "requestConnection" | "respondToConnectionRequest"
      >
    | undefined;
  /** Post-meeting outcomes (2026-10-02): Network's outcome service. */
  readonly outcomes?:
    | Pick<
        RelationshipOutcomeService,
        "pass" | "pause" | "resume" | "recordMeetingOutcome"
      >
    | undefined;
  /** Visibility and shares: the visibility centre the page calls. */
  readonly visibility?:
    Pick<VisibilityCentre, "state" | "share" | "revoke"> | undefined;
  /** Capital (ADR 0040 checklist): the raise form's own service. */
  readonly capital?:
    | Pick<
        CapitalService,
        | "getCapitalObjective"
        | "getCurrentCapitalObjective"
        | "createCapitalObjective"
        | "updateCapitalObjective"
        | "closeCapitalObjective"
        | "replaceCapitalObjective"
      >
    | undefined;
  /** A company's publishable pitch, for the company route's answer. */
  readonly companyPitch?:
    ((companyId: string) => Promise<PitchSummaryDto | null>) | undefined;
  /** The actor's own company, from their membership on the server. */
  readonly ownCompanyId?:
    ((actor: ActorContext) => Promise<string | null>) | undefined;
  /** The actor's own investor organisation, from their organisation. */
  readonly ownInvestorOrganisationId?:
    ((actor: ActorContext) => Promise<string | null>) | undefined;
};
