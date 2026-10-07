import type {
  DeckSectionCode,
  EvidenceStatus,
  ReadinessEvidenceLine,
} from "@capital-q/contracts";

import type { ReadinessSignal } from "../rules/v1.js";
import type { ReadinessClaimInput, ReadinessInputs } from "./inputs.js";

/**
 * Each signal reads one thing from the company's own records and says
 * what state it is in. No signal judges the business: EVIDENCED means a
 * document, a verification or the company's own record stands behind it;
 * STATED means the founder said it; MISSING means nothing is shared;
 * CONTRADICTED means two readings disagree and nobody has chosen.
 *
 * `null` means the signal does not apply or cannot be read yet (a deck Q
 * has not read): the check is left out, never counted as missing.
 */

export type SignalState = "EVIDENCED" | "STATED" | "MISSING" | "CONTRADICTED";

export type SignalResult = {
  readonly state: SignalState;
  readonly evidence: readonly ReadinessEvidenceLine[];
  /** A coaching line from the deck rubric, when the signal is a deck section. */
  readonly improve?: string | undefined;
};

const SUPPORTED: ReadonlySet<EvidenceStatus> = new Set([
  "DOCUMENT_SUPPORTED",
  "MULTI_SOURCE_SUPPORTED",
  "EXTERNALLY_VERIFIED",
  "PLATFORM_VERIFIED",
]);

const LIVE_LIFECYCLES = new Set([
  "CURRENT",
  "DISPUTED",
  "CONTRADICTORY",
  "STALE",
]);

const REVENUE_KEY = /(^|[._])(revenue|mrr|arr|gmv|sales)([._]|$)/;
const ECONOMICS_KEY =
  /(margin|burn|runway|payback|cac|ltv|nrr|irr|unit|cash|ebitda|profit)/;

/** Pending CONTRADICTION follow-ups mark these signals contradicted. */
const FACT_SIGNAL: Readonly<Record<string, ReadinessSignal>> = {
  customers: "claims.traction",
  growth: "claims.traction",
  pilots: "claims.traction",
  signal: "claims.traction",
  revenue_status: "claims.revenue",
  founder_count: "team.founders",
  full_time: "team.founders",
  team_size: "team.size",
  target_amount: "raise.target",
  currency: "raise.target",
  use_of_funds: "raise.use_of_funds",
  instrument: "raise.terms",
};

function claimLine(claim: ReadinessClaimInput): ReadinessEvidenceLine {
  const statement =
    claim.statement.length > 200
      ? `${claim.statement.slice(0, 197)}...`
      : claim.statement;
  return {
    label: statement,
    source: "CLAIM",
    truthClass: claim.truthClass,
    evidenceStatus: claim.evidenceStatus,
    note:
      claim.lifecycleStatus === "CURRENT"
        ? null
        : claim.lifecycleStatus.toLowerCase(),
    ref: { kind: "CLAIM", claimId: claim.id },
  };
}

const profileLine = (label: string): ReadinessEvidenceLine => ({
  label,
  source: "PROFILE",
  truthClass: "USER_CLAIM",
  evidenceStatus: "SELF_REPORTED",
  note: "Your profile",
  ref: null,
});

const recordLine = (
  label: string,
  source: ReadinessEvidenceLine["source"],
  note: string,
): ReadinessEvidenceLine => ({
  label,
  source,
  truthClass: null,
  evidenceStatus: null,
  note,
  ref: null,
});

const verifiedLine = (label: string): ReadinessEvidenceLine => ({
  label,
  source: "VERIFICATION",
  truthClass: "VERIFIED",
  evidenceStatus: "PLATFORM_VERIFIED",
  note: "Verified",
  ref: null,
});

function fromClaims(claims: readonly ReadinessClaimInput[]): SignalResult {
  const live = claims.filter((claim) =>
    LIVE_LIFECYCLES.has(claim.lifecycleStatus),
  );
  if (live.length === 0) return { state: "MISSING", evidence: [] };
  const evidence = live.slice(0, 8).map(claimLine);
  if (
    live.some(
      (claim) =>
        claim.lifecycleStatus === "CONTRADICTORY" ||
        claim.lifecycleStatus === "DISPUTED",
    )
  ) {
    return { state: "CONTRADICTED", evidence };
  }
  const supported = live.some(
    (claim) =>
      SUPPORTED.has(claim.evidenceStatus) &&
      claim.truthClass !== "Q_INFERENCE" &&
      claim.truthClass !== "UNKNOWN",
  );
  return { state: supported ? "EVIDENCED" : "STATED", evidence };
}

const LEVEL_WORDS: Readonly<Record<string, string>> = {
  MISSING: "Missing",
  MENTIONED: "Mentioned",
  BASIC: "Basic",
  CLEAR: "Clear",
  STRONG: "Strong",
  EXCEPTIONAL: "Exceptional",
};

/**
 * F29: figures from the founder's confirmed deck reading count as what
 * they are, the founder's own stated claims (STATED, never EVIDENCED: a
 * deck is self-reported). They close "not shared yet" and the step then
 * asks for a source, never for figures the deck already gives.
 */
function withDeckFigures(
  claims: SignalResult,
  inputs: ReadinessInputs,
  section: DeckSectionCode,
  improve: string,
): SignalResult {
  const figures = (inputs.deck?.figures ?? []).filter(
    (figure) => figure.section === section,
  );
  if (figures.length === 0 || inputs.deck === null) return claims;
  const documentId = inputs.deck.documentId;
  const lines: ReadinessEvidenceLine[] = figures.map((figure) => ({
    label: `${figure.label}: ${figure.value}`.slice(0, 200),
    source: "DECK",
    truthClass: "USER_CLAIM",
    evidenceStatus: "SELF_REPORTED",
    note:
      figure.asOf === null
        ? "Your deck, confirmed"
        : `Your deck, confirmed · as of ${figure.asOf}`,
    ref: { kind: "DOCUMENT", documentId },
  }));
  if (claims.state === "MISSING") {
    return { state: "STATED", evidence: lines.slice(0, 8), improve };
  }
  return {
    ...claims,
    evidence: [...claims.evidence, ...lines].slice(0, 8),
    ...(claims.state === "STATED" ? { improve } : {}),
  };
}

function deckSection(
  inputs: ReadinessInputs,
  section: DeckSectionCode,
): SignalResult | null {
  // No deck: "raise.deck" says so once. Not read yet: unknown, not missing.
  if (inputs.deck === null || inputs.deck.sections === null) return null;
  const found = inputs.deck.sections.find((item) => item.section === section);
  if (found === undefined || found.score === 0) {
    return {
      state: "MISSING",
      evidence: [],
      improve: found?.improve ?? undefined,
    };
  }
  const line: ReadinessEvidenceLine = {
    label: `Deck: ${section.toLowerCase().replace(/_/g, " ")} section`,
    source: "DECK",
    truthClass: null,
    evidenceStatus: null,
    note: `Coaching: ${LEVEL_WORDS[found.level] ?? found.level}`,
    ref: { kind: "DOCUMENT", documentId: inputs.deck.documentId },
  };
  return {
    // The deck is a document: a section at the rubric's standard is
    // document-backed; below it, the deck only mentions it.
    state: found.atStandard ? "EVIDENCED" : "STATED",
    evidence: [line],
    improve: found.improve ?? undefined,
  };
}

function checklist(
  inputs: ReadinessInputs,
  folders: readonly string[],
): SignalResult | null {
  if (inputs.dataRoom === null) return null;
  const items = inputs.dataRoom.checklist.filter((item) =>
    folders.includes(item.folderCode),
  );
  // Nothing expected at this stage in these folders: not applicable.
  if (items.length === 0) return null;
  const present = items.filter((item) => item.present);
  const evidence = present
    .slice(0, 8)
    .map((item) => recordLine(item.label, "DATA_ROOM", "In data room"));
  if (present.length === 0) return { state: "MISSING", evidence };
  return {
    state: present.length === items.length ? "EVIDENCED" : "STATED",
    evidence,
  };
}

function base(
  signal: ReadinessSignal,
  inputs: ReadinessInputs,
): SignalResult | null {
  const { team, profile, verification, raise } = inputs;
  const byType = (types: readonly string[]) =>
    inputs.claims.filter((claim) => types.includes(claim.claimType));
  switch (signal) {
    case "team.founders":
      if (team.founderCount === null) return { state: "MISSING", evidence: [] };
      return {
        state: team.verifiedFounderIdentities > 0 ? "EVIDENCED" : "STATED",
        evidence: [
          profileLine(
            `${String(team.founderCount)} founder${team.founderCount === 1 ? "" : "s"}${
              team.fullTimeFounderCount === null
                ? ""
                : `, ${String(team.fullTimeFounderCount)} full-time`
            }`,
          ),
        ],
      };
    case "team.backgrounds":
      return team.founderBackgrounds > 0
        ? {
            state: "STATED",
            evidence: [
              profileLine(
                `${String(team.founderBackgrounds)} background line${team.founderBackgrounds === 1 ? "" : "s"}`,
              ),
            ],
          }
        : { state: "MISSING", evidence: [] };
    case "team.identity":
      return team.verifiedFounderIdentities > 0
        ? {
            state: "EVIDENCED",
            evidence: [
              verifiedLine(
                `${String(team.verifiedFounderIdentities)} founder identit${team.verifiedFounderIdentities === 1 ? "y" : "ies"}`,
              ),
            ],
          }
        : { state: "MISSING", evidence: [] };
    case "team.size":
      return team.teamSize === null
        ? { state: "MISSING", evidence: [] }
        : {
            state: "STATED",
            evidence: [profileLine(`Team of ${String(team.teamSize)}`)],
          };
    case "profile.description":
      return profile.description
        ? { state: "STATED", evidence: [profileLine("Company description")] }
        : { state: "MISSING", evidence: [] };
    case "profile.categories":
      return profile.categories > 0
        ? {
            state: "STATED",
            evidence: [
              profileLine(
                `${String(profile.categories)} categor${profile.categories === 1 ? "y" : "ies"}`,
              ),
            ],
          }
        : { state: "MISSING", evidence: [] };
    case "claims.market":
      return withDeckFigures(
        fromClaims(byType(["market"])),
        inputs,
        "MARKET",
        "Your confirmed deck states your market size; add the public source or report behind it.",
      );
    case "claims.traction":
      return withDeckFigures(
        fromClaims(
          inputs.claims.filter(
            (claim) =>
              ["traction", "customers"].includes(claim.claimType) &&
              !REVENUE_KEY.test(claim.claimKey),
          ),
        ),
        inputs,
        "TRACTION",
        "Your confirmed deck states these figures; add the document behind them.",
      );
    case "claims.revenue":
      return fromClaims(
        inputs.claims.filter(
          (claim) =>
            ["financial", "traction"].includes(claim.claimType) &&
            REVENUE_KEY.test(claim.claimKey),
        ),
      );
    case "claims.economics":
      return fromClaims(
        inputs.claims.filter(
          (claim) =>
            claim.claimType === "financial" &&
            !REVENUE_KEY.test(claim.claimKey) &&
            ECONOMICS_KEY.test(claim.claimKey),
        ),
      );
    case "claims.risk":
      return fromClaims(byType(["risk", "compliance"]));
    case "verification.organisation":
      return verification.organisation
        ? { state: "EVIDENCED", evidence: [verifiedLine("Company")] }
        : { state: "MISSING", evidence: [] };
    case "verification.domain":
      return verification.domain
        ? { state: "EVIDENCED", evidence: [verifiedLine("Web domain")] }
        : { state: "MISSING", evidence: [] };
    case "dataroom.financials":
      return checklist(inputs, ["financials"]);
    case "dataroom.corporate":
      return checklist(inputs, ["corporate", "kyc_kyb", "cap_table"]);
    case "dataroom.fundraising": {
      // The deck is its own check; the rest of the folder is this one.
      if (inputs.dataRoom === null) return null;
      return checklist(
        {
          ...inputs,
          dataRoom: {
            checklist: inputs.dataRoom.checklist.filter(
              (item) => item.code !== "pitch_deck",
            ),
          },
        },
        ["fundraising"],
      );
    }
    case "raise.target":
      // The company's own decision, recorded: nothing to evidence.
      return raise === null
        ? { state: "MISSING", evidence: [] }
        : {
            state: "EVIDENCED",
            evidence: [
              recordLine(`Target ${raise.target}`, "RAISE", "Your raise"),
            ],
          };
    case "raise.use_of_funds":
      return raise?.useOfFunds === true
        ? {
            state: "EVIDENCED",
            evidence: [recordLine("Use of funds", "RAISE", "Your raise")],
          }
        : { state: "MISSING", evidence: [] };
    case "raise.terms":
      return raise !== null && (raise.instrument || raise.valuation)
        ? {
            state: "EVIDENCED",
            evidence: [
              recordLine(
                [
                  raise.instrument ? "Instrument" : null,
                  raise.valuation ? "valuation" : null,
                ]
                  .filter((part) => part !== null)
                  .join(" and "),
                "RAISE",
                "Your raise",
              ),
            ],
          }
        : { state: "MISSING", evidence: [] };
    case "deck.present":
      return inputs.deck === null
        ? { state: "MISSING", evidence: [] }
        : {
            state: "EVIDENCED",
            evidence: [
              {
                ...recordLine("Pitch deck", "DECK", "Uploaded"),
                ref: { kind: "DOCUMENT", documentId: inputs.deck.documentId },
              },
            ],
          };
    default: {
      if (signal.startsWith("deck.section.")) {
        return deckSection(
          inputs,
          signal.slice("deck.section.".length) as DeckSectionCode,
        );
      }
      return null;
    }
  }
}

/** The signal, with any pending contradiction on its fact layered on. */
export function readSignal(
  signal: ReadinessSignal,
  inputs: ReadinessInputs,
): SignalResult | null {
  const result = base(signal, inputs);
  const contradicted = inputs.followUps.some(
    (followUp) =>
      followUp.reason === "CONTRADICTION" &&
      FACT_SIGNAL[followUp.factKey] === signal,
  );
  if (!contradicted) return result;
  return {
    state: "CONTRADICTED",
    evidence: result?.evidence ?? [],
    improve: result?.improve,
  };
}

/** Which pillar a follow-up question's fact belongs to (null: none). */
export const FACT_PILLAR: Readonly<Record<string, string>> = {
  company_name: "PRODUCT_AND_SOLUTION",
  website: "GOVERNANCE_AND_TRUST",
  description: "PRODUCT_AND_SOLUTION",
  categories: "MARKET_OPPORTUNITY",
  stage: "INVESTMENT_READINESS",
  country: "GOVERNANCE_AND_TRUST",
  founder_role: "FOUNDER",
  founder_count: "FOUNDER",
  full_time: "FOUNDER",
  team_size: "EXECUTION_CAPACITY",
  functions: "EXECUTION_CAPACITY",
  signal: "COMMERCIAL_VALIDATION",
  pilots: "COMMERCIAL_VALIDATION",
  revenue_status: "COMMERCIAL_VALIDATION",
  customers: "COMMERCIAL_VALIDATION",
  growth: "COMMERCIAL_VALIDATION",
  raising: "INVESTMENT_READINESS",
  currency: "INVESTMENT_READINESS",
  target_amount: "INVESTMENT_READINESS",
  instrument: "INVESTMENT_READINESS",
  timeframe: "INVESTMENT_READINESS",
  use_of_funds: "INVESTMENT_READINESS",
};
