/**
 * What structured retrieval reads. Every port answers with canonical
 * identifiers over discovery-classified companies and declared mandate
 * intent; nothing here returns a name, a description, a document, a
 * memory, a page or a raise. A port that cannot express private material
 * cannot leak it into a candidate (doc 19 §204.8/§204.9).
 *
 * Retrieval is bounded and ordered by canonical id at the source, so the
 * merged pool is reproducible and no dimension scans the platform.
 */

/** A company a dimension retrieval found. Ids and the matched canonical value only. */
export type DiscoverableCompanyRef = {
  readonly companyId: string;
  readonly tenantId: string;
  readonly organisationId: string;
};

export type CompanyStructuredRetrievalPort = {
  /**
   * Active, discovery-classified (network_visible / public_external)
   * companies whose canonical stage is one of the codes. Cross-tenant by
   * design; disclosure and readiness are REC-001's to decide.
   */
  readonly byStageCodes: (
    stageCodes: readonly string[],
    limit: number,
  ) => Promise<readonly DiscoverableCompanyRef[]>;
  /** Likewise, by headquarters country (ISO 3166-1 alpha-2). */
  readonly byHeadquartersCountries: (
    countryCodes: readonly string[],
    limit: number,
  ) => Promise<readonly DiscoverableCompanyRef[]>;
};

/** One ACTIVE company classification under a node the retrieval asked about. */
export type TaxonomySubjectHit = {
  readonly companyId: string;
  readonly tenantId: string;
  readonly nodeId: string;
  readonly vocabularyCode: string;
};

/** A positive preference node expanded through the reference hierarchy. */
export type ExpandedPreferenceNode = {
  readonly preferredNodeId: string;
  readonly vocabularyCode: string;
  /** True for the vocabulary's "anywhere" node (geography `global`): no narrowing signal. */
  readonly unrestricted: boolean;
  /** Descendant node ids (never the node itself), bounded by the reference depth. */
  readonly descendantNodeIds: readonly string[];
};

export type TaxonomyStructuredRetrievalPort = {
  /** Companies with an ACTIVE classification under any of the nodes. Bounded, ordered by company id. */
  readonly subjectsByNodes: (
    nodeIds: readonly string[],
    limit: number,
  ) => Promise<readonly TaxonomySubjectHit[]>;
  /** The reference hierarchy below a declared node; the taxonomy context owns the depth bound. */
  readonly expandPreference: (
    nodeId: string,
  ) => Promise<ExpandedPreferenceNode | null>;
};

/**
 * The cheque seam. In V1 no canonical, discovery-safe projection of a
 * company's raise exists (the capital objective is organisation-internal;
 * its disclosure-safe projection is a later contract), so the only
 * legitimate implementation reports NOT_COMPUTABLE and returns nothing.
 * When such a projection exists, the rule it must express is: the
 * investor's minimum cheque fits inside the company's round target in the
 * same currency — never "max cheque ≥ total round", which is the bug
 * REC-001 refused.
 */
export type ChequeStructuredRetrievalPort = {
  readonly signal: (input: {
    readonly minCheque: string | null;
    readonly maxCheque: string | null;
    readonly currency: string | null;
    readonly limit: number;
  }) => Promise<{
    readonly status: "COMPUTED" | "NOT_COMPUTABLE";
    readonly hits: readonly DiscoverableCompanyRef[];
  }>;
};

export type StructuredRetrievalPorts = {
  readonly companies: CompanyStructuredRetrievalPort;
  readonly taxonomy: TaxonomyStructuredRetrievalPort;
  readonly cheque: ChequeStructuredRetrievalPort;
};

/** The V1 cheque seam: honest, typed, and empty. */
export function createNotComputableChequeRetrieval(): ChequeStructuredRetrievalPort {
  return {
    signal: () => Promise.resolve({ status: "NOT_COMPUTABLE", hits: [] }),
  };
}
