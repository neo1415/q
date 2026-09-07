import type { AuthorisedFact } from "@capital-q/q-core";

import type { ChunkLocator } from "../contracts/index.js";
import type { AuthorisedRetrievalResult, RetrievalHit } from "./contracts.js";

/**
 * Context assembly (CQ-RAG-004 §31-§34, §38-§39, §41, §89).
 *
 * Turns authorised retrieval hits into the facts a prompt may reason over.
 * It converts; it never fetches, ranks, filters for permission or decides
 * anything. Everything it receives is already authorised, and everything it
 * emits is DATA: `authorisedFacts` is declared untrusted by the company
 * analyst prompt, so a passage saying "ignore your instructions" arrives
 * inside the untrusted fence like every other quoted string.
 *
 * What a hit is NOT, and what this file is careful never to imply:
 *
 *   - not verified. A pitch deck asserting a market size is the company's
 *     own claim, so `truthClass` is USER_CLAIM. Ranking first is not
 *     evidence of anything, and there is no path here that emits VERIFIED.
 *   - not a confidence. No number is invented, and the fusion score never
 *     appears in the model's context.
 *   - not a claim record. CQ-KNW-001 begins interpretation; this packet
 *     hands over source material and stops.
 */

/**
 * A human-readable pointer back into the source, so Q can say "slide 7 of
 * the pitch deck" and the future UI can resolve it. Provenance only: the
 * locator is not authority, and opening the source is checked again there.
 */
export function describeLocator(locator: ChunkLocator): string | null {
  if (locator.slide !== undefined) {
    return locator.slideTitle === undefined
      ? `slide ${String(locator.slide)}`
      : `slide ${String(locator.slide)} (${locator.slideTitle})`;
  }
  if (locator.sheet !== undefined) {
    return locator.range === undefined
      ? `sheet ${locator.sheet}`
      : `sheet ${locator.sheet}, ${locator.range}`;
  }
  if (locator.pageStart !== undefined) {
    const end = locator.pageEnd ?? locator.pageStart;
    return end === locator.pageStart
      ? `page ${String(locator.pageStart)}`
      : `pages ${String(locator.pageStart)}-${String(end)}`;
  }
  const heading = locator.headingPath?.at(-1);
  if (heading !== undefined) {
    return `section "${heading}"`;
  }
  return null;
}

/**
 * How a fact names its source.
 *
 * `canDiscloseExistence` is a separate right from `canUseForReasoning`
 * (§34): a hit may legitimately inform an answer while its title stays
 * private. When it does, the source is described by shape alone — never by
 * title, never by filename, never by identifier — so an answer can be
 * grounded without the wording confirming that a particular document exists.
 */
export function describeSource(hit: RetrievalHit): string {
  const where = describeLocator(hit.locator);
  if (!hit.canDiscloseExistence) {
    return where === null
      ? "an internal source available in this context"
      : `an internal source (${where})`;
  }
  return where === null ? hit.documentTitle : `${hit.documentTitle}, ${where}`;
}

/**
 * The trusted one-line description of what the retrieved material is. Sits
 * outside the untrusted fence, so it says only what the server knows.
 */
export function describeRetrieval(result: AuthorisedRetrievalResult): string {
  if (result.hits.length > 0) {
    return `${String(result.hits.length)} passage(s) retrieved from source documents you are authorised to use; each is source material, not verified fact`;
  }
  if (
    result.degraded.lexical === "UNAVAILABLE" &&
    result.degraded.semantic === "UNAVAILABLE"
  ) {
    return "document search is temporarily unavailable; answer from structured state only, and say that evidence search could not run";
  }
  return "no authorised source material matched this question";
}

/**
 * Converts hits into authorised facts.
 *
 * Order is the fused order, which is the order the model reads them in.
 * `asOf` is absent deliberately: a chunk's creation time is when it was
 * derived, not when its content was true, and presenting one as the other
 * would manufacture recency the source never claimed.
 */
export function assembleAuthorisedFacts(
  result: AuthorisedRetrievalResult,
): readonly AuthorisedFact[] {
  return result.hits.map((hit): AuthorisedFact => {
    return {
      scope: hit.scopeKind,
      statement: hit.content,
      // The company's own document asserting something about itself.
      truthClass: "USER_CLAIM",
      evidenceStatus: "DOCUMENT_SUPPORTED",
      source: describeSource(hit).slice(0, 200),
    };
  });
}
