import type { CapitalRoundService, CapitalService } from "@capital-q/capital";
import type {
  ChatSafetyService,
  ChatService,
  PushSubscriptionStore,
  ScheduleService,
} from "@capital-q/communication";
import type {
  InboundEmailService,
  IntegrationsService,
} from "@capital-q/integrations";
import type { PlatformAdmin } from "@capital-q/platform-admin";
import type {
  CompanyVerificationService,
  KybService,
} from "@capital-q/verification";
import type { CompanyService } from "@capital-q/companies";
import type { PitchSummaryDto } from "@capital-q/contracts";
import type { InteractionSignalService } from "@capital-q/discovery";
import type { EvidenceService } from "@capital-q/evidence";
import type { InvestorService } from "@capital-q/investors";
import type {
  OnboardingNudges,
  OnboardingService,
} from "@capital-q/onboarding";
import type {
  ProfileImageService,
  PublicIdentityService,
} from "@capital-q/public-identity";
import type { MediaService } from "@capital-q/media";
import type {
  CommitmentService,
  ConnectionService,
  InterestService,
  RelationshipOutcomeService,
} from "@capital-q/network";
import type {
  DiligenceService,
  VisibilityCentre,
} from "@capital-q/permissions";
import type { ActorContext, PersonProfileStore } from "@capital-q/security";

import type { DeckAudiencePort } from "./actions/deck.js";
import type { DocumentChangePort } from "./actions/document-manage.js";
import type { QWorkPagePort } from "./actions/work.js";

/**
 * The services the declared actions call (ADR 0040). Each composition (the
 * API for routes, the Q API for tools and approved actions) passes its own
 * instances; an action whose port is absent is not offered and its route
 * refuses, never half-runs.
 */
/** What a document upload may be, as the screen states it to the browser. */
export type DocumentUploadLimits = {
  readonly maxBytes: number;
  readonly allowedMimeTypes: readonly string[];
};

export type AppActionPorts = {
  /** WORK-58: pause/resume their own standing instruction, set a card aside. */
  readonly qWork?: QWorkPagePort | undefined;
  /** ADR 0041: who may download a pitch deck (the Evidence service). */
  readonly deckAudience?: DeckAudiencePort | undefined;
  /** P3: rename and delete (archive) their own documents (Evidence). */
  readonly documentChanges?: DocumentChangePort | undefined;
  readonly media?:
    | Pick<
        MediaService,
        "listCompanyMedia" | "setPitchDetails" | "setPitchDownloadable"
      >
    | undefined;
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
  /** Document uploads: the evidence service and the upload's limits. */
  readonly documentUploads?:
    | Pick<
        EvidenceService,
        | "createDocumentUploadSession"
        | "completeDocumentUploadSession"
        | "cancelDocumentUploadSession"
        | "getDocumentWithVersion"
      >
    | undefined;
  readonly documentUploadLimits?: DocumentUploadLimits | undefined;
  /** Profile photos and covers. */
  readonly profileImages?:
    | Pick<ProfileImageService, "requestUpload" | "completeUpload" | "remove">
    | undefined;
  /** Settings: their notification switches, and whether push can work here. */
  readonly notificationSettings?:
    | (Pick<PushSubscriptionStore, "settings" | "saveSettings"> & {
        readonly pushAvailable: boolean;
      })
    | undefined;
  /** Google (Gmail and Calendar): connect at Google, and disconnect. */
  readonly google?:
    | Pick<IntegrationsService, "available" | "startConnect" | "disconnect">
    | undefined;
  /** Their Q email address: a new one replaces the old (inbound email). */
  readonly inboundEmail?: Pick<InboundEmailService, "rotate"> | undefined;
  /** Their company's verification request. */
  readonly verification?:
    Pick<CompanyVerificationService, "requestCompanyVerification"> | undefined;
  /** Their organisation's business verification (KYB). */
  readonly kyb?: Pick<KybService, "submit"> | undefined;
  /** A person's review, asked for by them. */
  readonly reviews?: Pick<PlatformAdmin, "requestReview"> | undefined;
  /** Onboarding (person-scoped): the runtime and the setup reminders. */
  readonly onboarding?:
    | Pick<
        OnboardingService["runtime"],
        | "submitResponse"
        | "reviseResponse"
        | "skipStep"
        | "withdrawResponse"
        | "completeSession"
        | "resolveSuggestion"
        | "answerInterviewQuestion"
        | "dismissInterviewQuestion"
      >
    | undefined;
  readonly onboardingNudges?: Pick<OnboardingNudges, "choose"> | undefined;
  /** Calls and reminders: the schedule service. */
  readonly schedule?:
    | Pick<
        ScheduleService,
        | "schedule"
        | "cancel"
        | "createReminder"
        | "dismissReminder"
        | "confirmHeld"
        | "joinCall"
      >
    | undefined;
  /** Interest and connection requests: the network services. */
  readonly interests?:
    | Pick<
        InterestService,
        "expressInterest" | "respondToInterest" | "listIncomingInterest"
      >
    | undefined;
  readonly connections?:
    | Pick<
        ConnectionService,
        | "requestConnection"
        | "respondToConnectionRequest"
        | "listConnectionRequests"
      >
    | undefined;
  /** Diligence documents and requests (2026-10-02): the diligence service. */
  readonly diligence?:
    | Pick<
        DiligenceService,
        "view" | "share" | "revoke" | "request" | "uploadAndFulfil"
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
  /** Capital rounds (2026-10-04): the Capital page's rounds. */
  readonly capitalRounds?: CapitalRoundService | undefined;
  /** Commitments' steps (2026-10-04): Network's commitment service. */
  readonly commitments?:
    | Pick<
        CommitmentService,
        | "confirmAmount"
        | "markSent"
        | "confirmReceived"
        | "commitmentFor"
        | "ledger"
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
