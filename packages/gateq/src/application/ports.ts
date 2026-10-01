import type { TransactionContext } from "@capital-q/database";

import type {
  CompanyQualificationProjection,
  Gateway,
  GatewayCriterion,
  GatewayId,
  GatewayPolicy,
  GatewayPublicId,
  GatewayVersion,
  GatewayVersionId,
  NewGatewayCriterion,
} from "../contracts/index.js";

/**
 * What GateQ stores, and what it borrows (CQ-GATE-001 §3).
 *
 * GateQ owns gateways, their versions and their criteria. It owns nothing
 * else: the investor organisation, the company, the taxonomy hierarchy and
 * the capital objective all belong to other contexts and arrive through
 * these ports, typed. There is no cross-schema read anywhere in this
 * package.
 */

export type GatewayRepository = {
  readonly create: (
    tx: TransactionContext,
    gateway: Omit<Gateway, "createdAt" | "updatedAt">,
  ) => Promise<Gateway>;
  readonly findById: (id: GatewayId) => Promise<Gateway | null>;
  readonly findByPublicId: (
    publicId: GatewayPublicId,
  ) => Promise<Gateway | null>;
  readonly listForInvestorOrganisation: (query: {
    readonly tenantId: string;
    readonly investorOrganisationId: string;
    readonly limit: number;
  }) => Promise<readonly Gateway[]>;
  /**
   * BILLING (ADR 0034): how many ACTIVE gateways an organisation has, for
   * its plan's gateway count. Optional so domain-only fakes need not
   * implement it.
   */
  readonly countActiveForOrganisation?: (
    organisationId: string,
  ) => Promise<number>;
  readonly setStatus: (
    tx: TransactionContext,
    id: GatewayId,
    status: Gateway["status"],
  ) => Promise<Gateway>;
};

export type GatewayVersionRepository = {
  /** The next draft for a gateway; the store assigns the version number. */
  readonly createDraft: (
    tx: TransactionContext,
    input: {
      readonly gatewayId: GatewayId;
      readonly tenantId: string;
      readonly inboundMode: GatewayVersion["inboundMode"];
      readonly publicTitle: string;
      readonly publicDescription: string | null;
      readonly qualificationPolicyVersion: string;
      readonly createdByUserId: string;
      readonly criteria: readonly NewGatewayCriterion[];
    },
  ) => Promise<GatewayVersion>;
  readonly findById: (id: GatewayVersionId) => Promise<GatewayVersion | null>;
  readonly listForGateway: (
    gatewayId: GatewayId,
  ) => Promise<readonly GatewayVersion[]>;
  readonly findPublished: (
    gatewayId: GatewayId,
  ) => Promise<GatewayVersion | null>;
  /** Replace a draft's editable content. Refuses anything not DRAFT. */
  readonly replaceDraft: (
    tx: TransactionContext,
    input: {
      readonly versionId: GatewayVersionId;
      readonly inboundMode: GatewayVersion["inboundMode"];
      readonly publicTitle: string;
      readonly publicDescription: string | null;
      readonly criteria: readonly NewGatewayCriterion[];
    },
  ) => Promise<GatewayVersion>;
  /**
   * Publish one draft, superseding whatever was published. One statement
   * per side inside the caller's transaction, under a row lock, so a
   * gateway can never hold two published versions.
   */
  readonly publish: (
    tx: TransactionContext,
    input: {
      readonly versionId: GatewayVersionId;
      readonly publishedByUserId: string;
      readonly publishedAt: string;
    },
  ) => Promise<{
    readonly version: GatewayVersion;
    readonly supersededVersionId: GatewayVersionId | null;
  }>;
  readonly criteriaFor: (
    versionId: GatewayVersionId,
  ) => Promise<readonly GatewayCriterion[]>;
};

/** The published policy a qualification runs against, assembled in one read. */
export type GatewayPolicyPort = {
  readonly publishedPolicy: (
    gatewayId: GatewayId,
  ) => Promise<GatewayPolicy | null>;
  readonly publishedPolicyByPublicId: (
    publicId: GatewayPublicId,
  ) => Promise<GatewayPolicy | null>;
};

/**
 * The company side, bounded (§12).
 *
 * The adapter builds the projection from canonical sources the caller is
 * already authorised for. The port's return type is the boundary: there is
 * no field here through which a document, a conversation or a Q conclusion
 * could arrive, so keeping private material out of an inbound decision is
 * a matter of type rather than of vigilance.
 */
export type CompanyQualificationProjectionPort = {
  readonly projectionFor: (query: {
    readonly tenantId: string;
    readonly companyId: string;
  }) => Promise<CompanyQualificationProjection | null>;
};

/** The owning organisation's display identity, for the public projection. */
export type InvestorOrganisationDisplayPort = {
  readonly displayNameFor: (query: {
    readonly tenantId: string;
    readonly investorOrganisationId: string;
  }) => Promise<string | null>;
};
