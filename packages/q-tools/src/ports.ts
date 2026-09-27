import type { CapitalObjectiveQueryPort } from "@capital-q/capital";
import type { CompanyQueryPort } from "@capital-q/companies";
import type {
  CurrentSlateExplanationService,
  DiscoveryService,
} from "@capital-q/discovery";
import type {
  InvestorMandateQueryPort,
  InvestorOrganisationQueryPort,
} from "@capital-q/investors";
import type {
  IncomingInterestDto,
  RelationshipStatusDto,
  VisibilityStateDto,
} from "@capital-q/contracts";
import type { DisclosureAccessService } from "@capital-q/permissions";
import type {
  PublicProfileLookupProvider,
  PublicWebResearchService,
} from "@capital-q/q-research";
import type { ActorContext, AuthorizationService } from "@capital-q/security";

import type { ChatIntelligencePort } from "./tools/chat.js";

/** One company as the investor's feed shows it. */
export type InvestorFeedCompany = {
  readonly companyId: string;
  readonly name: string;
  readonly stageCode: string | null;
  readonly headquartersCountry: string | null;
  readonly shortDescription: string | null;
  readonly websiteUrl: string | null;
  /** The feed's public reason codes, exactly as the card shows them. */
  readonly reasonCodes: readonly string[];
};

/**
 * A Save or Pass the investor recorded, by company identity. Two companies
 * may share a name; the id is what the decision was about, and the stage
 * and country are what tell them apart when Q has to say which.
 */
export type InvestorFeedDecision = {
  readonly companyId: string;
  readonly name: string;
  readonly stageCode: string | null;
  readonly headquartersCountry: string | null;
  readonly decision: "SAVED" | "PASSED";
};

export type InvestorFeedPort = {
  /** The first page of the actor's own feed; null when they are not an investor. */
  readonly page: (
    actor: ActorContext,
    limit: number,
  ) => Promise<{
    readonly items: readonly InvestorFeedCompany[];
    readonly notes: readonly string[];
  } | null>;
  /** Their own saved and passed companies, newest first, bounded, still visible to them. */
  readonly decisions: (
    actor: ActorContext,
    limit: number,
  ) => Promise<readonly InvestorFeedDecision[]>;
};

/**
 * The Network context's relationship capabilities, for Q (CQ-Q-030).
 *
 * Every read answers for the actor's own side only, folded from the
 * history that side may see (CQ-NET-012): a company never learns of an
 * investor's private discovery through Q any more than through the page.
 * The reads throw when the actor may not ask; `null` means nothing this
 * side may see exists.
 *
 * `prepareForApproval` is the one write: it hands a relationship action
 * to this run's Approval Engine proposer. It executes nothing -- the
 * person approves the exact payload, and only then does the action run,
 * through the same command the screen calls.
 */
export type RelationshipIntelligencePort = {
  readonly withCompany: (
    actor: ActorContext,
    companyId: string,
  ) => Promise<RelationshipStatusDto | null>;
  readonly withInvestor: (
    actor: ActorContext,
    investorOrganisationId: string,
  ) => Promise<RelationshipStatusDto | null>;
  /**
   * One relationship named by id (the RELATIONSHIP subject), as the
   * actor's own side sees it. The side is decided by the Network context
   * from the actor's membership; null when the actor is not a party.
   */
  readonly byRelationship: (
    actor: ActorContext,
    relationshipId: string,
  ) => Promise<{
    readonly side: "INVESTOR" | "COMPANY";
    readonly counterpart:
      | { readonly kind: "COMPANY"; readonly id: string }
      | { readonly kind: "INVESTOR_ORGANISATION"; readonly id: string };
    readonly status: RelationshipStatusDto | null;
  } | null>;
  /** Interest addressed to the actor's own company, with its answers. */
  readonly incomingInterest: (
    actor: ActorContext,
    companyId: string,
  ) => Promise<readonly IncomingInterestDto[]>;
  /** The Express Interest command's own authorisation; writes nothing. */
  readonly mayExpressInterest: (
    actor: ActorContext,
    companyId: string,
  ) => Promise<boolean>;
  /** The answer command's own authorisation; writes nothing. */
  readonly mayAnswerInterest: (
    actor: ActorContext,
    interestId: string,
  ) => Promise<boolean>;
  readonly prepareForApproval: (entry: {
    readonly runId: string;
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly actionType:
      "relationship.interest.express" | "relationship.interest.respond";
    readonly payload: Readonly<Record<string, string>>;
  }) => "PREPARED" | "ONE_PER_TURN";
};

/**
 * Email on a relationship (BIZ-007): the person's own connected mailbox and
 * the people on the other side of ONE relationship they are a party to.
 * The proposal tool writes one thing: a note to this run's Approval Engine
 * proposer. The send runs only as the approved `email.send`, from the
 * approver's mailbox, to exactly the approved recipient.
 */
export type EmailIntelligencePort = {
  /** Null when the actor is not a party to the relationship (or it does not exist). */
  readonly counterpart: (
    actor: ActorContext,
    relationshipId: string,
  ) => Promise<{
    readonly kind: "COMPANY" | "INVESTOR_ORGANISATION";
    readonly id: string;
    readonly name: string;
    readonly contacts: readonly {
      readonly name: string;
      readonly email: string;
    }[];
  } | null>;
  /** The actor's own connected mailbox, or null. */
  readonly mailbox: (
    actor: ActorContext,
  ) => Promise<{ readonly email: string } | null>;
  readonly prepareForApproval: (entry: {
    readonly runId: string;
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly payload: {
      readonly relationshipId: string;
      readonly to: string;
      readonly toName: string;
      readonly counterpartName: string;
      readonly subject: string;
      readonly body: string;
    };
  }) => "PREPARED" | "ONE_PER_TURN";
};

/**
 * Who can see what of the person's own company (CQ-BIZ-003), through the
 * permissions context's visibility centre -- the same answers as the
 * visibility page. The two proposal tools write one thing: a note to this
 * run's Approval Engine proposer. Sharing and revoking run only as the
 * approved action, through the same centre, under the approver.
 */
export type VisibilityIntelligencePort = {
  /** Throws for anyone but the company's own organisation with disclosure.inspect. */
  readonly state: (
    actor: ActorContext,
    companyId: string,
  ) => Promise<VisibilityStateDto>;
  readonly prepareForApproval: (entry: {
    readonly runId: string;
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly actionType: "disclosure.raise.share" | "disclosure.share.revoke";
    readonly payload: Readonly<Record<string, string>>;
  }) => "PREPARED" | "ONE_PER_TURN";
};

/**
 * What is said in a pitch around a moment (R18), read through the media
 * context under exactly the pitch playback rule. Null or a throw: the
 * person may not play this pitch, and there is nothing to read.
 */
export type PitchMomentPort = {
  readonly momentAround: (
    actor: ActorContext,
    query: {
      readonly pitchId: string;
      readonly atMs: number;
      readonly windowMs: number;
    },
  ) => Promise<
    | {
        readonly status: "AVAILABLE";
        readonly cues: readonly {
          readonly startMs: number;
          readonly endMs: number;
          readonly text: string;
        }[];
      }
    | { readonly status: "PENDING" | "NONE" }
    | null
  >;
};

/**
 * Everything the Safe Read tools may reach: the owning contexts' public
 * query ports and the two deterministic authorities. No executor, no
 * connection, no credential — a tool cannot compose a statement, only
 * call a named operation another context owns.
 *
 * `research` is the one capability that reaches outside Capital Q
 * (CQ-Q-RESEARCH-001): a named operation over a provider-neutral port whose
 * outbound query is composed from allowed words, never forwarded. It is
 * optional; without a configured provider the research tools do not exist.
 */
export type QToolPorts = {
  readonly companies: CompanyQueryPort;
  readonly capital: CapitalObjectiveQueryPort;
  readonly mandates: InvestorMandateQueryPort;
  readonly investors: InvestorOrganisationQueryPort;
  readonly authorization: AuthorizationService;
  readonly disclosure: DisclosureAccessService;
  /**
   * The investor's own Discover feed and their own Save/Pass decisions
   * (CQ-QACT-001, ACC round 1b). When present, an investor's "what should
   * I look at" is answered from exactly the feed: the precomputed slate
   * with its declared eligibility, marketplace readiness, visibility,
   * ranking and pass suppression — never from a network listing that
   * bypasses them. Absent: the older network discovery answers.
   */
  readonly investorFeed?: InvestorFeedPort | undefined;
  /** Discovery (doc 19). Absent means the slate tool reports it is unavailable. */
  readonly discovery?: DiscoveryService | undefined;
  /**
   * Why a company is in this person's recommendations (CQ-REC-007R B).
   * Optional: absent, the tool is not offered and Q explains nothing about
   * ranking -- which is the correct behaviour, not a degraded one.
   */
  readonly recommendationExplanations?:
    CurrentSlateExplanationService | undefined;
  readonly research?: PublicWebResearchService | undefined;
  /** Public LinkedIn pages by URL; absent means the lookup tool does not exist. */
  readonly profiles?: PublicProfileLookupProvider | undefined;
  /** Relationships (CQ-Q-030); absent means no relationship tool exists. */
  readonly relationships?: RelationshipIntelligencePort | undefined;
  /** Email on a relationship (BIZ-007); absent means the email tool does not exist. */
  readonly email?: EmailIntelligencePort | undefined;
  /** Relationship chat (R34); absent means no chat tool exists. */
  readonly chat?: ChatIntelligencePort | undefined;
  /** Profile changes for approval (BIZ-002); absent means the tool does not exist. */
  readonly profileChanges?: ProfileChangePort | undefined;
  /** A pitch's transcript around a moment (R18); absent means no pitch tool. */
  readonly pitchMoments?: PitchMomentPort | undefined;
  /** Who can see what (CQ-BIZ-003); absent means no visibility tool exists. */
  readonly visibility?: VisibilityIntelligencePort | undefined;
  /** Handle claims for approval (BIZ-004); absent means the tool does not exist. */
  readonly handleClaims?: HandleClaimPort | undefined;
  /**
   * Approval by conversation (live test 2026-09-27 #1); absent means the
   * approve tool does not exist and approval stays on the card.
   */
  readonly pendingProposals?: PendingProposalPort | undefined;
  /** "Is my card saved?": the Q Card screen's own read. */
  readonly qCards?: QCardReadPort | undefined;
  /**
   * R20/R33: the answer's screen performs client actions (theme, reload,
   * their own website). True where a person's screen reads the answer;
   * absent, the client-action tools do not exist.
   */
  readonly clientActions?: boolean | undefined;
  /** R33: approvals waiting for this person, across conversations. */
  readonly approvalInbox?: ApprovalInboxPort | undefined;
  /** R33: Save, Unsave and Pass from a conversation. */
  readonly discoveryDecisions?: DiscoveryDecisionPort | undefined;
  /** R33: their own documents. */
  readonly documents?: OwnDocumentsPort | undefined;
  /** R33: changes to their own records, for approval. */
  readonly recordChanges?: RecordChangePort | undefined;
  /** R33: reads of their own records. */
  readonly ownRecords?: OwnRecordsPort | undefined;
  /** R33: their organisation's uploaded documents (metadata). */
  readonly evidenceDocuments?: EvidenceDocumentsPort | undefined;
  /** R33 / BIZ-007: a relationship's email thread. */
  readonly relationshipMail?: RelationshipMailPort | undefined;
};

/**
 * A change Q prepared in this conversation, as the Approval Engine holds it
 * for the person reading it now, in plain terms:
 *
 * - PENDING: waiting for their decision; nothing has changed.
 * - SAVING: approved, the change is being applied.
 * - SAVED: applied (the action executed).
 * - NOT_SAVED: approved but the change did not go through.
 * - DECLINED: they declined it.
 * - EXPIRED: it lapsed or was withdrawn before a decision; nothing changed.
 */
export const PROPOSAL_PLAIN_STATUSES = [
  "PENDING",
  "SAVING",
  "SAVED",
  "NOT_SAVED",
  "DECLINED",
  "EXPIRED",
] as const;
export type ProposalPlainStatus = (typeof PROPOSAL_PLAIN_STATUSES)[number];

export type ConversationProposal = {
  readonly proposalId: string;
  readonly summary: string;
  readonly status: ProposalPlainStatus;
};

/** Who is asking, in which run: the composition resolves the conversation from it. */
export type PendingProposalContext = {
  readonly actor: ActorContext;
  readonly runId: string;
  readonly correlationId: string;
};

/**
 * The proposals of the conversation this run belongs to, and the one way
 * to approve one of them: the Approval Engine's own approve, exactly as the
 * card's Approve button calls it (approver authorised, payload hash
 * recomputed, expiry checked, idempotent on a repeat), followed by the
 * paused run's resumption, which executes through the execution gate.
 */
export type PendingProposalPort = {
  /**
   * Every proposal in this run's conversation that is addressed to this
   * actor, oldest first, with its CURRENT status read from the Approval
   * Engine as the actor. A proposal the actor may not read is left out.
   */
  readonly inConversation: (
    context: PendingProposalContext,
  ) => Promise<readonly ConversationProposal[]>;
  /**
   * Approves exactly this proposal's stored payload and reports its status
   * afterwards. CHANGED: the stored payload no longer matches what was
   * proposed, so nothing was approved.
   */
  readonly approve: (
    context: PendingProposalContext,
    proposalId: string,
  ) => Promise<{ readonly status: ProposalPlainStatus | "CHANGED" }>;
  /**
   * R33: declines exactly this proposal through the Approval Engine's own
   * reject, the call the card's Decline button makes, and reports its
   * status afterwards. Absent: declining stays on the card.
   */
  readonly decline?: (
    context: PendingProposalContext,
    proposalId: string,
  ) => Promise<{ readonly status: ProposalPlainStatus }>;
  /**
   * R33 (lead decision 2026-09-27): an approval from the person's inbox
   * (another conversation), by its approval id. Read as the actor: one
   * not addressed to them is null. Deciding it is the same engine call,
   * payload-bound and idempotent.
   */
  readonly inboxItem?: (
    context: PendingProposalContext,
    approvalId: string,
  ) => Promise<ConversationProposal | null>;
};

/**
 * R33: a change to one of the person's own records that the app's own
 * forms make (raise, mandate, founder profile and team, their role, Q Card
 * details, the investor organisation's visibility), prepared for the
 * Approval Engine. The tool resolves the subject from the actor and the
 * plan, never from the model; the composition validates `fields` against
 * the route's own request schema, reads what it needs (the current raise,
 * the mandate), and answers REFUSED with a person-facing reason when it
 * does not fit. Nothing here executes.
 */
export type RecordChange =
  | {
      readonly kind: "CAPITAL_OBJECTIVE";
      readonly companyId: string;
      readonly operation: "CREATE" | "UPDATE" | "CLOSE" | "REPLACE";
      readonly fields: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: "INVESTOR_MANDATE";
      readonly investorOrganisationId: string;
      readonly operation: "CREATE" | "UPDATE" | "ACTIVATE" | "CLOSE";
      /** Absent: the organisation's current mandate. */
      readonly mandateId: string | null;
      readonly fields: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: "FOUNDER_PROFILE" | "TEAM_FACTS" | "COMPANY_MEMBERSHIP";
      readonly companyId: string;
      readonly fields: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: "INVESTOR_REPRESENTATIVE" | "INVESTOR_VISIBILITY";
      readonly investorOrganisationId: string;
      readonly fields: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: "Q_CARD";
      readonly subjectType: "COMPANY" | "INVESTOR_ORGANISATION";
      readonly subjectId: string;
      readonly fields: Readonly<Record<string, unknown>>;
    };

export type RecordChangePort = {
  readonly prepare: (entry: {
    readonly runId: string;
    readonly actor: ActorContext;
    readonly change: RecordChange;
  }) => Promise<{
    readonly status: "PREPARED" | "ONE_PER_TURN" | "REFUSED";
    readonly awaitingApprovalOf: string | null;
    readonly reason: string | null;
  }>;
};

/**
 * R33: reads of the person's own records the app's screens show, each
 * through the owning context's service as the actor. `null`: nothing to
 * show, or not theirs (one answer). The data is the screen's own DTO.
 */
export const OWN_RECORD_KINDS = [
  "VERIFICATION_STATUS",
  "MARKETPLACE_READINESS",
  "COMPANY_NETWORK_PREVIEW",
  "COMPANY_AUDIENCE_PREVIEW",
  "COMPANY_TEAM",
  "RAISE_HISTORY",
  "PROFILE_FINDINGS",
  "INVESTOR_ORGANISATION",
  "INVESTOR_NETWORK_PREVIEW",
  "INVESTOR_REPRESENTATIVE",
  "INVESTOR_MANDATES",
] as const;
export type OwnRecordKind = (typeof OWN_RECORD_KINDS)[number];

export type OwnRecordsPort = {
  readonly read: (
    actor: ActorContext,
    query: {
      readonly record: OwnRecordKind;
      readonly subjectType: "COMPANY" | "INVESTOR_ORGANISATION";
      readonly subjectId: string;
      /** COMPANY_AUDIENCE_PREVIEW only. */
      readonly audience?: string | undefined;
      readonly relationshipId?: string | undefined;
    },
  ) => Promise<unknown>;
  /** Re-runs the readiness assessment, as the page's button does. */
  readonly reassessReadiness: (
    actor: ActorContext,
    companyId: string,
    correlationId: string,
  ) => Promise<unknown>;
};

/**
 * R33: the documents the person's organisation uploaded (evidence), read
 * through the evidence service as the actor (document.view). Metadata
 * only: their content reaches Q through authorised retrieval, never here.
 */
export type EvidenceDocumentsPort = {
  readonly list: (
    actor: ActorContext,
    companyId: string,
  ) => Promise<
    readonly {
      readonly documentId: string;
      readonly title: string;
      readonly documentType: string;
      readonly status: string;
      readonly processing: string | null;
      readonly updatedAt: string;
    }[]
  >;
};

/**
 * R33 / BIZ-007: the email exchanged on one relationship, from the
 * person's own connected Gmail (the Relationships page's thread).
 */
export type RelationshipMailPort = {
  readonly list: (
    actor: ActorContext,
    relationshipId: string,
  ) => Promise<
    | readonly {
        readonly direction: string;
        readonly status: string;
        readonly from: string;
        readonly to: string;
        readonly subject: string;
        readonly at: string;
      }[]
    | null
  >;
};

/**
 * R33: every approval waiting for this person, across conversations, read
 * as the approvals list reads it (the Approval Engine's own listing, which
 * returns only approvals requested from this actor).
 */
export type ApprovalInboxPort = {
  readonly pending: (actor: ActorContext) => Promise<
    readonly {
      readonly approvalId: string;
      readonly summary: string;
      readonly requestedAt: string;
      readonly expiresAt: string;
    }[]
  >;
};

/**
 * R33: an investor's own Save, Unsave and Pass, recorded by the same
 * interaction service the Discover buttons call (surface Q_CONVERSATION),
 * which re-runs the feed's own eligibility and refuses a company the
 * person could not act on. NOT_AVAILABLE says nothing about why.
 */
export type DiscoveryDecisionPort = {
  readonly decide: (
    actor: ActorContext,
    decision: {
      readonly type: "SAVE" | "UNSAVE" | "PASS";
      readonly companyId: string;
      /** Idempotency identity, derived by the tool from the run. */
      readonly clientEventId: string;
    },
  ) => Promise<
    | {
        readonly status: "RECORDED";
        readonly deduplicated: boolean;
        readonly saved: boolean | null;
        readonly passed: boolean | null;
      }
    | { readonly status: "NOT_AVAILABLE" }
  >;
};

/**
 * R33: the person's own documents (artifacts Q prepared for them), read as
 * their documents list reads them: the artifact service, as the actor.
 */
export type OwnDocumentsPort = {
  readonly list: (
    actor: ActorContext,
    limit: number,
  ) => Promise<
    readonly {
      readonly artifactId: string;
      readonly type: string;
      readonly status: string;
      readonly title: string;
      readonly currentVersion: number;
      readonly updatedAt: string;
    }[]
  >;
};

/**
 * The person's own Q Card, read as the Q Card screen reads it (the public
 * identity service authorises card.view again). Null: none made yet.
 */
export type QCardReadPort = {
  readonly getCard: (
    actor: ActorContext,
    subject: {
      readonly subjectType: "COMPANY" | "INVESTOR_ORGANISATION";
      readonly subjectId: string;
    },
  ) => Promise<{
    readonly handle: string | null;
    readonly indexable: boolean;
    readonly updatedAt: string;
  } | null>;
};

/**
 * Where a proposed handle waits for the run's Approval Engine proposer
 * (BIZ-004). The composition checks the handle's shape, the reserved list
 * and availability, and answers REFUSED with a person-facing reason.
 */
export type HandleClaimPort = {
  readonly prepareHandleClaim: (entry: {
    readonly runId: string;
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly subjectType: "COMPANY" | "INVESTOR_ORGANISATION";
    /** Resolved by the tool from the actor and the plan, never by the model. */
    readonly subjectId: string;
    readonly handle: string;
  }) => Promise<{
    readonly status: "PREPARED" | "ONE_PER_TURN" | "REFUSED";
    readonly awaitingApprovalOf: string | null;
    readonly reason: string | null;
  }>;
};

/**
 * Where a proposed profile change waits for the run's Approval Engine
 * proposer (BIZ-002). The composition validates the change against the
 * action's own payload schema -- normalising the way the profile page's
 * write path does -- and answers REFUSED with the person-facing reason
 * when it does not fit. Nothing here executes.
 */
export type ProfileChangePort = {
  readonly prepareForApproval: (entry: {
    readonly runId: string;
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly profile: "PERSON" | "COMPANY" | "INVESTOR_ORGANISATION";
    /** Resolved by the tool from the actor and the plan, never by the model. */
    readonly subjectId: string;
    readonly changes: readonly {
      readonly field: string;
      readonly value: string | null;
    }[];
  }) => Promise<{
    readonly status: "PREPARED" | "ONE_PER_TURN" | "REFUSED";
    readonly awaitingApprovalOf: string | null;
    readonly reason: string | null;
  }>;
};
