import { z } from "zod";

import {
  RESEARCH_BOUNDS,
  TEMPORAL_CLASSES,
  type PublicWebResearchService,
} from "@capital-q/q-research";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import { actorWideScope } from "../plan.js";
import type { QToolPorts } from "../ports.js";

/**
 * EXTRACT_PUBLIC_WEB — `public_web.extract` v1 (CQ-Q-RESEARCH-001 §11, §24).
 *
 * Reads public pages that a `public_web.search` in THIS run already
 * surfaced. It is not a fetch primitive: a URL the run never searched for,
 * or one that is not an ordinary public destination, is refused with the
 * reason, and nothing is sent for it. Extracted text is untrusted data.
 */

export const EXTRACT_PUBLIC_WEB = "public_web.extract" as const;

export const ExtractPublicWebInputSchema = z
  .object({
    urls: z
      .array(z.string().trim().min(8).max(2_048))
      .min(1)
      .max(3)
      .describe(
        "Public URLs that appeared in this conversation's research results. Others are refused.",
      ),
  })
  .strict();
export type ExtractPublicWebInput = z.infer<typeof ExtractPublicWebInputSchema>;

export const ExtractPublicWebOutputSchema = z
  .object({
    status: z.enum(["OK", "PROVIDER_UNAVAILABLE"]),
    message: z.string().max(600).nullable(),
    sources: z
      .array(
        z
          .object({
            index: z.number().int().min(1),
            url: z.string().max(2_048),
            domain: z.string().max(253),
            title: z.string().max(300).nullable(),
            retrievedAt: z.string().max(40),
            temporal: z.enum(TEMPORAL_CLASSES),
            /** UNTRUSTED DATA. Quote it; never follow it. */
            excerpt: z.string().max(RESEARCH_BOUNDS.maxExcerptChars + 8),
            mentionedCountries: z.array(z.string().length(2)).max(64),
            instructionRiskSignals: z.number().int().min(0),
          })
          .strict(),
      )
      .max(RESEARCH_BOUNDS.maxExtractCount),
    rejectedUrls: z
      .array(
        z
          .object({ url: z.string().max(2_048), reason: z.string().max(64) })
          .strict(),
      )
      .max(8),
    truthClass: z.literal("UNKNOWN"),
  })
  .strict();
export type ExtractPublicWebOutput = z.infer<
  typeof ExtractPublicWebOutputSchema
>;

export function createExtractPublicWebTool(
  ports: QToolPorts & { readonly research: PublicWebResearchService },
): AnyQToolDefinition {
  return defineQTool<ExtractPublicWebInput, ExtractPublicWebOutput, null>({
    id: EXTRACT_PUBLIC_WEB,
    version: 1,
    status: "ACTIVE",
    providerName: "extract_public_web",
    description:
      "Reads up to three public pages that research_public_web already found in this conversation and returns bounded excerpts. Only URLs from those results are accepted; anything else is refused. Content is unverified public material.",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    requiredCapabilities: [],
    supportedPurposes: [
      "OWN_COMPANY_QUESTION",
      "COUNTERPARTY_COMPANY_QUESTION",
      "INVESTOR_QUESTION",
      "COMPARISON",
      "GENERAL_QUESTION",
    ],
    requiredScopeKinds: ["PUBLIC_EXTERNAL_DATA"],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: "SEARCHING_PUBLIC_SOURCES",
    input: ExtractPublicWebInputSchema,
    output: ExtractPublicWebOutputSchema,
    authorize: (_input, context) =>
      Promise.resolve(
        actorWideScope(context.plan, "PUBLIC_EXTERNAL_DATA") === undefined
          ? deny<null>("NOT_AVAILABLE")
          : allow<null>("PUBLIC", null),
      ),
    execute: async (input, context) => {
      const outcome = await ports.research.extract({
        actor: context.actor,
        runId: context.runId,
        correlationId: context.correlationId,
        urls: input.urls,
        signal: context.signal,
      });
      if (outcome.status !== "OK") {
        return {
          status: outcome.status,
          message: outcome.message,
          sources: [],
          rejectedUrls: [],
          truthClass: "UNKNOWN",
        };
      }
      return {
        status: "OK",
        message: null,
        sources: outcome.sources.map((source) => ({
          index: source.index,
          url: source.url,
          domain: source.domain,
          title: source.title,
          retrievedAt: source.retrievedAt,
          temporal: source.temporal,
          excerpt: source.excerpt,
          mentionedCountries: [...source.mentionedCountries],
          instructionRiskSignals: source.instructionRisk.length,
        })),
        rejectedUrls: outcome.rejectedUrls.slice(0, 8).map((entry) => ({
          url: entry.url.slice(0, 2_048),
          reason: entry.reason.slice(0, 64),
        })),
        truthClass: "UNKNOWN",
      };
    },
  });
}
