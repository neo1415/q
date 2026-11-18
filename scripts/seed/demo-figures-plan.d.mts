// Types for demo-figures-plan.mjs (apps/workers/test imports it). Only the
// exports a typed test uses are declared.

export declare const SEED_KEY: string;
export declare const DEMO_STATEMENT_SUFFIX: string;
export declare const COMPANY_STATEMENT_DECISION: string;
export declare const COMPANY_STATEMENT_FIXTURE_DIR: string;

export type CompanyStatementAllowance = {
  readonly companyId: string;
  readonly name: string;
  readonly period: string;
  readonly amount: string;
  readonly currency: string;
};
export declare const COMPANY_STATEMENTS: Readonly<
  Record<string, CompanyStatementAllowance>
>;

export type FigurePoint = {
  readonly period: string | null;
  readonly asOf: string | null;
  readonly decimal: string;
};

export type FigureSpec = {
  readonly key: string;
  readonly type: string;
  readonly label: string | null;
  readonly kind: "MONEY" | "COUNT" | "PERCENT";
  readonly currency: string | null;
  readonly sourceFile: string;
  readonly points: readonly FigurePoint[];
  readonly provenance: string;
};

export type Sourced = {
  readonly figures: readonly FigureSpec[];
  readonly skipped: readonly string[];
  readonly refused?: readonly string[];
};

export type FiguresEntry = {
  readonly companyId: string;
  readonly name: string;
  readonly source: string;
  readonly hold?: string;
};

export type FiguresSnapshot = {
  readonly company: {
    readonly id: string;
    readonly canonical_name: string;
    readonly tenant_id: string;
    readonly organisation_id: string;
    readonly demonstration_data: boolean;
    readonly company_status: string;
  };
  readonly people: readonly {
    readonly profileId: string;
    readonly email: string | null;
    readonly userFictionalDemo: boolean;
    readonly current: boolean;
  }[];
  readonly claims: readonly {
    readonly id: string;
    readonly claim_key: string;
    readonly structured_value: unknown;
    readonly valid_from: string | null;
    readonly visibility_scope: string;
    readonly lifecycle_status: string;
  }[];
};

export type PlannedFigureClaim = {
  readonly id: string;
  readonly revisionId: string;
  readonly sourceId: string;
  readonly itemId: string;
  readonly key: string;
  readonly type: string;
  readonly statement: string;
  readonly value: Readonly<Record<string, unknown>>;
  readonly validFrom: string | null;
  readonly provenance: string;
  readonly sourceFile: string;
  readonly seriesLength: number;
};

export type FiguresPlan = {
  readonly companyId: string;
  readonly name: string;
  readonly source: string;
  readonly refused?: readonly string[];
  readonly tenantId?: string;
  readonly organisationId?: string;
  readonly claims?: readonly PlannedFigureClaim[];
  readonly notes?: readonly string[];
};

export declare function seedUuid(...parts: readonly unknown[]): string;
export declare function companyStatementFigures(
  key: string,
  fixture: unknown,
  companyId: string,
): Sourced;
export declare function devWorldFigures(company: unknown): Sourced;
export declare function planCompanyFigures(
  entry: FiguresEntry,
  snapshot: FiguresSnapshot | null,
  sourced: Sourced,
): FiguresPlan;
export declare function renderFiguresSql(
  plan: FiguresPlan,
  options: { readonly now: string },
): string | null;
export declare function renderFiguresPlan(
  plans: readonly FiguresPlan[],
): string;
