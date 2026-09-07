import {
  CLAIM_EXTRACTION_PIPELINE_VERSION,
  PERMITTED_CLAIM_KEYS,
  type ClaimProposal,
  type ClaimProposalBatch,
  type ProposedValue,
} from "./contracts.js";
import type { ClaimProposerPort } from "./ports.js";

/**
 * The deterministic proposer (CQ-KNW-001 §15).
 *
 * A spreadsheet row reading `ARR: $2.4m` does not need a language model,
 * and spending one on it is worse than wasteful: it introduces a
 * non-deterministic step into a value that was already unambiguous. This
 * reads labelled lines and nothing else — no prose, no inference, no
 * semantic mapping. Where it is unsure it returns nothing, and the model
 * path handles the passage instead.
 *
 * It never guesses a currency. `2.4m` with no symbol is not dollars, and a
 * claim whose currency was assumed is a claim about the wrong amount of
 * money.
 */

/** Label spellings a source uses for each permitted key. Exact, not fuzzy. */
const LABELS: Readonly<Record<string, readonly string[]>> = {
  "financial.arr": ["arr", "annual recurring revenue"],
  "financial.mrr": ["mrr", "monthly recurring revenue"],
  "financial.revenue": ["revenue"],
  "financial.gross_margin": ["gross margin"],
  "financial.burn_rate": ["burn", "burn rate", "net burn"],
  "traction.customer_count": ["customers", "customer count"],
  "traction.churn_rate": ["churn", "churn rate"],
  "team.employee_count": ["employees", "headcount", "team size"],
  "capital.raise_target": ["raise", "raising", "round size", "target raise"],
  "market.size": ["market size", "tam", "addressable market"],
};

const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  $: "USD",
  "£": "GBP",
  "€": "EUR",
  "₦": "NGN",
};

const MULTIPLIERS: Readonly<Record<string, number>> = {
  k: 1_000,
  m: 1_000_000,
  bn: 1_000_000_000,
  b: 1_000_000_000,
};

/**
 * Parses the value half of a labelled line.
 *
 * Returns null rather than a best effort. Every ambiguity — a bare number
 * where money was expected, an unrecognised unit, a range — is a reason to
 * leave the line to a reader who can ask questions.
 */
export function parseLabelledValue(
  text: string,
  expected: ProposedValue["kind"] | "ANY",
): ProposedValue | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const percentage = /^([0-9]+(?:\.[0-9]+)?)\s*(?:%|percent)$/i.exec(trimmed);
  if (percentage?.[1] !== undefined) {
    const value = Number(percentage[1]);
    return expected === "PERCENTAGE" || expected === "ANY"
      ? { kind: "PERCENTAGE", value }
      : null;
  }
  const money = /^([$£€₦])\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(k|m|bn|b)?$/i.exec(
    trimmed,
  );
  if (money?.[1] !== undefined && money[2] !== undefined) {
    const currency = CURRENCY_SYMBOLS[money[1]];
    if (currency === undefined) {
      return null;
    }
    const base = Number(money[2].replace(/,/g, ""));
    const suffix = money[3]?.toLowerCase();
    const multiplier = suffix === undefined ? 1 : (MULTIPLIERS[suffix] ?? 0);
    if (multiplier === 0 || !Number.isFinite(base)) {
      return null;
    }
    return expected === "MONEY" || expected === "ANY"
      ? { kind: "MONEY", amount: base * multiplier, currency }
      : null;
  }
  const count = /^([0-9][0-9,]*)$/.exec(trimmed);
  if (count?.[1] !== undefined) {
    const value = Number(count[1].replace(/,/g, ""));
    // A bare number where money was expected has lost its currency. That is
    // not a count; it is an amount nobody can spend.
    return expected === "COUNT" || expected === "ANY"
      ? { kind: "COUNT", value }
      : null;
  }
  return null;
}

/**
 * Reads `Label: value` lines out of a passage.
 *
 * A line matches only when its label is one this file knows and its value
 * parses to the shape the claim key requires. Everything else is skipped in
 * silence: a deterministic extractor that guesses is just an unreliable
 * model with no provenance.
 */
export function proposeDeterministically(
  passageText: string,
  claimKeys: readonly string[],
): readonly ClaimProposal[] {
  const permitted = new Set(claimKeys);
  const proposals: ClaimProposal[] = [];
  const seen = new Set<string>();
  for (const rawLine of passageText.split(/\r?\n/)) {
    const line = rawLine.trim();
    const separator = line.indexOf(":");
    if (separator <= 0) {
      continue;
    }
    const label = line.slice(0, separator).trim().toLowerCase();
    const rest = line.slice(separator + 1).trim();
    for (const [claimKey, spellings] of Object.entries(LABELS)) {
      if (!permitted.has(claimKey) || seen.has(claimKey)) {
        continue;
      }
      if (!spellings.includes(label)) {
        continue;
      }
      const spec = PERMITTED_CLAIM_KEYS[claimKey];
      if (spec === undefined) {
        continue;
      }
      const value = parseLabelledValue(rest, spec.value);
      if (value === null) {
        continue;
      }
      seen.add(claimKey);
      proposals.push({
        claimKey,
        statement: line,
        value,
        assertionKind: "SOURCE_ASSERTION",
        // The line itself, verbatim: the service checks this against the
        // passage, and a label-and-value line is its own best quotation.
        excerpt: line,
        asOf: null,
      });
    }
  }
  return proposals;
}

/**
 * A proposer that reads labelled lines and calls no model.
 *
 * This is what normal CI uses: it costs nothing, needs no provider, and
 * gives the security tests a proposer whose output is exactly what the test
 * wrote. `scripted` lets a test hand the service arbitrary proposals —
 * including hostile ones — without a model in the loop.
 */
export function createDeterministicClaimProposer(options?: {
  readonly scripted?: readonly ClaimProposal[] | undefined;
}): ClaimProposerPort {
  return {
    propose: ({ passage, claimKeys }) => {
      const proposals =
        options?.scripted ?? proposeDeterministically(passage.text, claimKeys);
      const produced = new Set(proposals.map((p) => p.claimKey));
      return Promise.resolve({
        proposals,
        // Every permitted key the passage did not establish. Naming them is
        // how "not stated" is recorded without inventing a zero (§36).
        absent: claimKeys.filter((key) => !produced.has(key)),
        provenance: {
          pipelineVersion: CLAIM_EXTRACTION_PIPELINE_VERSION,
          proposerKind: "DETERMINISTIC",
          promptVersionId: null,
          providerCode: null,
          modelCode: null,
        },
      } satisfies ClaimProposalBatch);
    },
  };
}
