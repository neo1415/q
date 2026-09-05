import { EXTRACTION_LIMITS } from "@capital-q/evidence/contracts";

import type { ParserLimits } from "./protocol.js";

/**
 * The bounds one parse runs under.
 *
 * These are security controls, not tuning knobs: together with the sandbox's
 * timeout and bounded stdout they are what stops a crafted archive, a deeply
 * nested document or a decompression bomb from consuming the worker. The
 * block and character ceilings match the extraction contract exactly, so the
 * parser cannot produce an artifact the schema would then refuse.
 */
export const EXTRACTION_PARSER_LIMITS: ParserLimits = {
  // Package structure. An OOXML business document is a few hundred entries;
  // tens of thousands is an attack, not a deck.
  maxEntries: 512,
  maxEntryBytes: 32 * 1024 * 1024,
  maxExpandedBytes: 128 * 1024 * 1024,
  maxExpansionRatio: 200,
  maxBlocks: EXTRACTION_LIMITS.maxBlocks,
  maxBlockCharacters: EXTRACTION_LIMITS.maxBlockCharacters,
  maxTotalCharacters: EXTRACTION_LIMITS.maxTotalCharacters,
  maxPages: 2_000,
  maxSlides: 1_000,
  maxXmlNodes: 500_000,
  maxXmlDepth: 100,
};
