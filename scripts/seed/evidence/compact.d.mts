// Types for compact.mjs (the validator in apps/workers/test imports it).

import type { DocumentModel, Manifest } from "./documents.mjs";

type Lines = {
  readonly lines: Readonly<Record<string, number>>;
  readonly total: number;
};

export type CompactActual = {
  readonly month: string;
  readonly revenue: Lines;
  readonly cogs: Lines;
  readonly opex: Lines;
  readonly grossProfit: number;
  readonly netResult: number;
  /** Non-cash part of cogs/opex (depreciation); not a payment. */
  readonly depreciation: number;
  readonly capex: number;
  readonly cash: {
    readonly opening: number;
    readonly receipts: number;
    readonly fundingReceived: number;
    readonly payments: number;
    readonly closing: number;
  };
  readonly receivablesClosing: number;
  readonly netBurn: number;
  readonly runwayMonths: number | null;
  readonly headcount: Readonly<Record<string, number>> & {
    readonly total: number;
  };
  readonly kpis: Readonly<Record<string, unknown>>;
};

export type CompactDiscrepancy = {
  readonly id: string;
  readonly deliberate: boolean;
  readonly title: string;
  readonly deck: string;
  readonly accounts: string;
  readonly derivation: {
    readonly kind: "grossMargin" | "runway" | "kpi";
    readonly month: string;
    readonly key?: string;
  };
  readonly note: string;
  readonly evidence: readonly {
    readonly documentId: string;
    readonly text: string;
  }[];
};

export type RecordedFigure = {
  readonly what: string;
  readonly month?: string;
  readonly year?: string;
  readonly kpi?: string;
  readonly field?: string;
  readonly value: number;
  readonly tolerance?: number;
};

export type CompactFixture = {
  readonly schemaVersion: number;
  readonly pack: "compact";
  readonly key: string;
  readonly idPrefix: string;
  readonly company: {
    readonly name: string;
    readonly legalName: string;
    readonly website: string;
    readonly foundedOn: string;
    readonly headquarters: string;
    readonly stage: string;
    readonly oneLiner: string;
  };
  readonly seedSource: {
    readonly kind: "tavus-20" | "recorded-profile";
    readonly file?: string;
    readonly company?: string;
    readonly companyId: string;
    readonly readOn: string;
    readonly decision?: string;
  };
  readonly recordedProfile?: {
    readonly canonicalName: string;
    readonly legalName: string;
    readonly websiteUrl: string;
    readonly foundedDate: string;
    readonly headquartersCity: string;
    readonly stage: string;
    readonly shortDescription: string;
    readonly founders: readonly {
      readonly name: string;
      readonly title: string;
    }[];
    readonly keyPeople?: readonly {
      readonly name: string;
      readonly title: string;
    }[];
    readonly teamSize: number;
    readonly raise: {
      readonly currency: string;
      readonly targetAmount: number;
      readonly instrument: string;
      readonly useOfFundsSummary: string;
      readonly targetCloseDate: string | null;
    };
    readonly figures: readonly RecordedFigure[];
    readonly approximateFigures?: readonly RecordedFigure[];
    readonly yearTotals?: readonly RecordedFigure[];
    readonly pipelineExport?: Readonly<Record<string, number>>;
    readonly deckRunwayMonths?: number;
    readonly octoberRevenueUsd?: number;
    readonly deckKiosks?: Readonly<Record<string, number>>;
    readonly unknownClaims?: readonly string[];
  };
  readonly contractsTitle?: string;
  readonly contractsDocumentType?: string;
  readonly currency: string;
  readonly fx: { readonly usd: number; readonly note: string } | null;
  readonly collection: "same-month" | "next-month";
  readonly openingReceivable?: number;
  readonly documentDefaults: {
    readonly issuedOn: string;
    readonly version: string;
    readonly preparedBy: string;
  };
  readonly bank: { readonly name: string; readonly accountMasked: string };
  readonly periods: {
    readonly firstActualMonth: string;
    readonly lastActualMonth: string;
  };
  readonly basis: readonly string[];
  readonly revenueModel: {
    readonly components: readonly {
      readonly line: string;
      readonly label: string;
      readonly kpi: string;
      readonly unitPrice: number;
    }[];
    readonly byPartner?: { readonly kpi: string; readonly unitPrice: number };
  };
  readonly lineLabels: Readonly<Record<string, string>>;
  readonly kpiDefinitions: readonly {
    readonly key: string;
    readonly label: string;
    readonly unit: string;
    readonly seedCode?: string;
  }[];
  readonly actuals: readonly CompactActual[];
  readonly invoices?: readonly {
    readonly number: string;
    readonly customerId: string;
    readonly serviceMonth: string;
    readonly issuedOn: string;
    readonly dueOn: string;
    readonly warehouses?: number;
    readonly scans?: number;
    readonly amount: number;
  }[];
  readonly contracts?: readonly (Readonly<Record<string, unknown>> & {
    readonly id: string;
    readonly label: string;
    readonly status: string;
  })[];
  readonly team: {
    readonly founders: readonly {
      readonly name: string;
      readonly title: string;
    }[];
    readonly keyPeople: readonly {
      readonly name: string;
      readonly title: string;
    }[];
  };
  readonly capTable: {
    readonly asOf: string;
    readonly basis: string;
    readonly holders: readonly {
      readonly name: string;
      readonly class: string;
      readonly shares: number;
    }[];
  };
  readonly funding: readonly {
    readonly receivedOn: string;
    readonly round: string;
    readonly instrument: string;
    readonly currency: string;
    readonly amount: number;
    readonly investors: string;
  }[];
  readonly raise: {
    readonly currency: string;
    readonly targetAmount: number;
    readonly instrument: string;
    readonly valuationCap?: number;
    readonly preMoneyValuation?: number;
    readonly minimumCheque: number;
    readonly targetCloseOn: string;
    readonly useOfFunds: readonly {
      readonly line: string;
      readonly percent: number;
      readonly amount: number;
    }[];
    readonly plannedMonthlyNetBurnPostRaise?: number;
    readonly runwayMonthsPostRaise?: number;
  };
  readonly deckStatedFigures: Readonly<Record<string, unknown>>;
  readonly knownDiscrepancies: readonly CompactDiscrepancy[];
  readonly sharingPlan: {
    readonly investor: string | null;
    readonly note: string;
  };
  readonly documents: readonly string[];
  readonly assumptions: readonly {
    readonly field: string;
    readonly value: string;
    readonly note: string;
  }[];
};

export const COMPACT_KEYS: readonly string[];
export function loadCompactFixture(key: string): CompactFixture;
export function buildCompactDocuments(fx: CompactFixture): DocumentModel[];
export function buildCompactManifest(
  fx: CompactFixture,
  docs: readonly DocumentModel[],
): Manifest;
export function pathValue(obj: unknown, path: string): unknown;
export function formatValue(value: number, unit: string): string;
export function expectedReceipts(fx: CompactFixture, index: number): number;
export function derivedFigure(
  fx: CompactFixture,
  derivation: CompactDiscrepancy["derivation"],
): string;
export function proFormaHolders(
  fx: CompactFixture,
): { readonly name: string; readonly class: string; readonly shares: number }[];
