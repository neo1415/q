// Types for revenue-claims-plan.mjs (apps/workers/test imports it).

export declare const SEED_KEY: string;
export declare const DEMO_STATEMENT_SUFFIX: string;
export declare const MONTHLY_REVENUE_KEY: "financial.monthly_revenue";
export declare const REVENUE_STATUS_KEY: "financial.revenue_status";
export declare const SOURCE_REFERENCE_PREFIX: string;

export type RevenueValue =
  | {
      readonly kind: "MONEY";
      readonly amount: string;
      readonly currency: string;
      readonly asOf: string;
    }
  | {
      readonly kind: "STATUS";
      readonly code: "PRE_REVENUE";
      readonly asOf: string;
    };

export type RevenueFigure = {
  readonly key: string;
  readonly period: string;
  readonly asOf: string;
  readonly value: RevenueValue;
  readonly words: string;
};

export type LiveDocument = {
  readonly file: string;
  readonly document_id: string;
  readonly version_id: string;
  readonly title?: string | null;
  readonly visibility_scope: string;
  readonly sensitivity_class: string;
  readonly status: string;
  readonly level?: string | null;
};

export type ExistingClaim = {
  readonly id: string;
  readonly claim_key: string;
  readonly structured_value: unknown;
  readonly valid_from: string | null;
  readonly visibility_scope: string;
  readonly lifecycle_status: string;
};

export type RevenueSnapshot = {
  readonly company: {
    readonly id: string;
    readonly tenant_id: string;
    readonly organisation_id: string;
    readonly canonical_name: string;
    readonly company_status: string;
  };
  readonly documents: readonly LiveDocument[];
  readonly claims: readonly ExistingClaim[];
};

export type PlannedClaim = {
  readonly id: string;
  readonly revisionId: string;
  readonly sourceId: string;
  readonly itemId: string;
  readonly key: string;
  readonly value: RevenueValue;
  readonly validFrom: string;
  readonly statement: string;
  readonly scope: "network_visible";
  readonly document: {
    readonly file: string;
    readonly documentId: string;
    readonly versionId: string;
    readonly title: string;
    readonly scope: string;
  };
};

export type RevenuePlan = {
  readonly key: string;
  readonly name: string;
  readonly companyId: string | null;
  readonly refused?: readonly string[];
  readonly figure?: RevenueFigure;
  readonly claim?: PlannedClaim | null;
  readonly skipped?: string;
  readonly notes?: readonly string[];
  readonly tenantId?: string;
  readonly organisationId?: string;
};

export declare function seedUuid(...parts: readonly unknown[]): string;
export declare function monthEnd(period: string): string | null;
export declare function revenueFigureOf(fixture: unknown): RevenueFigure | null;
export declare function candidateDocuments(
  manifest: unknown,
  period: string,
): readonly { readonly fileName: string; readonly documentType: string }[];
export declare function documentAdmitsNetwork(doc: LiveDocument): boolean;
export declare function planRevenueClaim(
  source: {
    readonly key: string;
    readonly fixture: unknown;
    readonly manifest: unknown;
  },
  snapshot: RevenueSnapshot | null,
): RevenuePlan;
export declare function renderRevenueSql(
  plan: RevenuePlan,
  options: { readonly now: string },
): string | null;
export declare function renderRevenuePlan(
  plans: readonly RevenuePlan[],
): string;
