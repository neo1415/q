// Types for documents.mjs (the validator in apps/workers/test imports it).

export type Money = number;

export type Invoice = {
  readonly number: string;
  readonly customerId: string;
  readonly issuedOn: string;
  readonly dueOn: string;
  readonly paidOn: string;
  readonly serviceMonth: string;
  readonly kind: string;
  readonly description: string;
  readonly amount: Money;
};

export type Customer = {
  readonly id: string;
  readonly label: string;
  readonly segment: string;
  readonly status: string;
  readonly designPartnerSince?: string;
  readonly contractSignedOn?: string;
  readonly goLiveOn?: string;
  readonly billingStartOn?: string;
  readonly annualFloor?: Money;
  readonly deploymentFee?: Money | null;
  readonly licensedUsersAtFullRollout?: number;
  readonly onboardingFee?: Money;
  readonly contractedSeats?: number;
  readonly seatSchedule?: readonly {
    readonly from: string;
    readonly seats: number;
  }[];
};

export type Lines = {
  readonly lines: Readonly<Record<string, Money>>;
  readonly total: Money;
};

export type Actual = {
  readonly month: string;
  readonly revenue: Lines;
  readonly reconcilingItems: readonly {
    readonly description: string;
    readonly amount: Money;
  }[];
  readonly cogs: Lines;
  readonly opex: Lines;
  readonly headcount: Readonly<Record<string, number>> & {
    readonly total: number;
  };
  readonly kpis: Readonly<Record<string, unknown>>;
  readonly cash: {
    readonly opening: Money;
    readonly receipts: Money;
    readonly fundingReceived: Money;
    readonly payments: Money;
    readonly closing: Money;
  };
  readonly receivablesClosing: Money;
  readonly deferredRevenueClosing: Money;
  readonly netBurn: Money;
  readonly runwayMonths: number | null;
  readonly grossProfit: Money;
  readonly netResult: Money;
};

export type Funding = {
  readonly receivedOn: string;
  readonly round: string;
  readonly instrument: string;
  readonly amount: Money;
  readonly investors: readonly {
    readonly name: string;
    readonly amount: Money;
  }[];
};

export type Holder = {
  readonly holder: string;
  readonly class: string;
  readonly shares: number;
};

export type ProjectionMonth = {
  readonly month: string;
  readonly revenue: Money;
  readonly costs: Money;
  readonly netBurn: Money;
  readonly fundingReceived: Money;
  readonly headcount: number;
  readonly cashOpening: Money;
  readonly cashClosing: Money;
  readonly contractedArr?: Money;
  readonly licensedSeats?: number;
  readonly arr?: Money;
  readonly billedSeats?: number;
};

export type KnownDiscrepancy = {
  readonly id: string;
  readonly topic: string;
  /** What the deck said (Tensorgate, Halyard). */
  readonly deckStatement?: string;
  /** What the recorded profile, KPI pack or deck said (Nixo). */
  readonly profileStatement?: string;
  readonly accountsStatement: string;
  readonly reason: string;
  /** False for a reconciliation the 6 Oct seed forced, not a planted contradiction. */
  readonly deliberate: boolean;
  readonly evidence: readonly {
    readonly documentId: string;
    readonly text: string;
  }[];
};

export type Fixture = {
  readonly schemaVersion: number;
  readonly key: string;
  readonly idPrefix: string;
  /** tavus-20 seed file (Tensorgate, Halyard) or the hosted profile read (Nixo). */
  readonly seedSource: {
    readonly file?: string;
    readonly company: string;
    readonly companyId?: string;
    readonly decision?: string;
  };
  /** Nixo: the profile as recorded in production, read read-only. */
  readonly recordedProfile?: {
    readonly canonicalName: string;
    readonly legalName: string;
    readonly websiteUrl: string;
    readonly foundedDate: string;
    readonly headquartersCity: string;
    readonly headquartersCountry: string;
    readonly stage: string;
    readonly shortDescription: string;
    readonly primaryDescription: string;
    readonly founderName: string;
    readonly founderCount: number;
    readonly teamSize: number;
    readonly teamSizeRecordedOn: string;
    readonly raise: {
      readonly currency: string;
      readonly targetAmount: Money;
      readonly instrument: string;
      readonly targetStage: string;
      readonly useOfFundsSummary: string;
    };
  };
  /** Nixo: every field the fixture invented where nothing was recorded. */
  readonly assumptions?: readonly {
    readonly field: string;
    readonly value: string;
    readonly note: string;
  }[];
  readonly pricing?: { readonly pricePerSeatPerMonth: Money };
  readonly company: {
    readonly name: string;
    readonly legalName: string;
    readonly website: string;
    readonly foundedOn: string;
    readonly headquarters?: string;
    readonly stage?: string;
    readonly oneLiner?: string;
  };
  readonly currency: string;
  readonly documentDefaults: {
    readonly issuedOn: string;
    readonly version: string;
  };
  readonly periods: {
    readonly firstActualMonth: string;
    readonly lastActualMonth: string;
    readonly projectionFirstMonth: string;
    readonly projectionLastMonth: string;
  };
  readonly bank: {
    readonly name: string;
    readonly fictitious: boolean;
    readonly accountMasked: string;
    readonly statementFrom: string;
    readonly statementTo: string;
  };
  readonly openingBalances: {
    readonly asOf: string;
    readonly cash: Money;
    readonly receivables: Money;
    readonly deferredRevenue: Money;
    readonly otherPayablesAndAccruals: Money;
    readonly capitalRaisedToDate: Money;
  };
  readonly customers: readonly Customer[];
  readonly invoices: readonly Invoice[];
  readonly actuals: readonly Actual[];
  readonly funding: readonly Funding[];
  readonly fundingBeforeWindow: readonly Funding[];
  readonly capTable: {
    readonly asOf: string;
    readonly holders: readonly Holder[];
    readonly proForma: {
      readonly newHolder: string;
      readonly newShares: number;
      readonly conversions?: readonly Holder[];
    };
  };
  readonly raise: {
    readonly currency: string;
    readonly targetAmount: Money;
    readonly instrument: string;
    readonly targetCloseOn: string;
    readonly minimumCheque: Money;
    readonly valuationCap?: Money;
    readonly preMoneyValuation?: Money;
    readonly useOfFunds: readonly {
      readonly line: string;
      readonly percent: number;
      readonly amount: Money;
    }[];
    readonly plannedMonthlyNetBurnPostRaise: Money;
  };
  /** The seeded deck's figures (Tensorgate, Halyard); Nixo had no deck. */
  readonly deckStatedFigures?: {
    readonly cash: Money;
    readonly cashAsOf: string;
    readonly monthlyNetBurn: Money;
    readonly runwayMonths: number;
    readonly headcount: number;
  };
  readonly team: {
    readonly founders: readonly {
      readonly name: string;
      readonly role: string;
    }[];
    readonly keyPeople: readonly {
      readonly name: string;
      readonly role: string;
    }[];
  };
  readonly projections: {
    readonly label: string;
    readonly assumptions: readonly string[];
    readonly months: readonly ProjectionMonth[];
  };
  readonly knownDiscrepancies: readonly KnownDiscrepancy[];
  readonly sharingPlan: { readonly investor: string };
};

export type TableBlock = {
  readonly kind: "table";
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly labelWidth: number;
  readonly widths?: readonly number[];
};
export type Block =
  | { readonly kind: "heading"; readonly text: string }
  | { readonly kind: "paragraph"; readonly text: string }
  | { readonly kind: "pageBreak" }
  | TableBlock;

export type DocumentModel = {
  readonly id: string;
  readonly title: string;
  readonly documentType: string;
  readonly format: "pdf" | "csv";
  readonly fileName: string;
  readonly mimeType: string;
  readonly period: { readonly from: string; readonly to: string };
  readonly issuedOn: string;
  readonly version: string;
  readonly pageBanner?: string;
  /** "slides": landscape pages, one slide per page (the generated deck). */
  readonly layout?: "slides";
  readonly blocks?: readonly Block[];
  readonly csv?: {
    readonly header: readonly string[];
    readonly rows: readonly (readonly string[])[];
  };
};

export type ManifestEntry = {
  readonly id: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly title: string;
  readonly documentType: string;
  readonly defaultSensitivity: string;
  readonly readableByInvestorQUnderCurrentRules: boolean;
  readonly period: { readonly from: string; readonly to: string };
  readonly issuedOn: string;
  readonly version: string;
  readonly dataRoomFolder: string;
  readonly checklistItem: string | null;
  readonly intendedDataRoomLevel: string;
  readonly intendedVisibilityScope: string;
  readonly plannedShareWith: string | null;
  readonly plannedGrant: string | null;
};
export type Manifest = {
  readonly schemaVersion: number;
  readonly company: string;
  readonly companyKey: string;
  readonly companyId?: string;
  readonly seedAuthority?: string;
  readonly inventedFields?: readonly string[];
  readonly plannedInvestor: string | null;
  readonly documents: readonly ManifestEntry[];
};

export const SYNTHETIC_HEADER: string;
export const WATERMARK_TEXT: string;
export const FIXTURE_KEYS: readonly string[];
export const FIXTURE_DIR: string;
export const MANIFEST_DIR: string;
export function loadFixture(key: string): Fixture;
export function defaultSensitivityFor(documentType: string): string;
export function monthLabel(month: string): string;
export function monthLong(month: string): string;
export function dateLabel(date: string): string;
export function amount(value: number): string;
export function oneDecimal(value: number): string;
export function percent1(numerator: number, denominator: number): string;
export function ownershipHundredths(shares: readonly number[]): number[];
export function hundredthsLabel(h: number): string;
export function actualMonths(fx: Fixture): string[];
export function lastActual(fx: Fixture): Actual;
export function trailingTwelve(fx: Fixture): {
  readonly from: string;
  readonly to: string;
  readonly revenue: Money;
  readonly cogs: Money;
};
export function licenceMarginTwelve(fx: Fixture): {
  readonly revenue: Money;
  readonly cost: Money;
};
export function subscriptionMarginTwelve(fx: Fixture): {
  readonly revenue: Money;
  readonly cost: Money;
};
export function raiseTermsLine(fx: {
  readonly raise: Pick<
    Fixture["raise"],
    | "currency"
    | "targetAmount"
    | "instrument"
    | "valuationCap"
    | "preMoneyValuation"
    | "minimumCheque"
    | "targetCloseOn"
  >;
}): string;
export function revenueByCustomer(
  fx: Fixture,
  month: string,
): Record<string, Money>;
export function bankTransactions(
  fx: Fixture,
  month: string,
): {
  readonly date: string;
  readonly description: string;
  readonly moneyIn: Money;
  readonly moneyOut: Money;
  readonly balance: Money;
}[];
export function balanceSheet(fx: Fixture): {
  readonly cash: Money;
  readonly receivables: Money;
  readonly deferredRevenue: Money;
  readonly otherPayables: Money;
  readonly totalAssets: Money;
  readonly totalLiabilities: Money;
  readonly netAssets: Money;
  readonly capitalRaised: Money;
  readonly accumulatedLosses: Money;
};
export function buildDocuments(fx: Fixture): DocumentModel[];
export function buildManifest(
  fx: Fixture,
  docs: readonly DocumentModel[],
): Manifest;
export function renderCsv(doc: DocumentModel): string;
