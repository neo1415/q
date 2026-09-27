import { z } from "zod";

import { quoteOccursIn } from "@capital-q/q-knowledge";
import {
  actorWideScope,
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "@capital-q/q-tools";
import { capability } from "@capital-q/security";

import { spokenUrl } from "./interview-steps.js";
import { textStatedIn } from "./value-support.js";

/**
 * RESEARCH_PUBLIC_LINKS — `onboarding.research.links` v1 (BIZ-009).
 *
 * The investor gave their firm's website or a public profile link of
 * their own. The MODEL decides that a link was given and which kind it
 * is; code checks the link is in the person's own words, that it is a
 * public web address, and then hands it to the research that reads their
 * own public sources. Nothing is written to their onboarding here: what
 * research finds comes back as recommendations for them to confirm.
 */
export const RESEARCH_PUBLIC_LINKS = "onboarding.research.links" as const;

const LinkSchema = z.string().trim().min(4).max(300);

export const ResearchPublicLinksInputSchema = z
  .object({
    website: LinkSchema.nullable().describe(
      "Their firm's own website, exactly as they gave it, or null.",
    ),
    profileLinks: z
      .array(LinkSchema)
      .max(2)
      .describe(
        "Public profile links of their own (their LinkedIn, their firm's page), exactly as they gave them.",
      ),
    quote: z
      .string()
      .trim()
      .min(3)
      .max(400)
      .describe("Their exact words that give the link, verbatim."),
  })
  .strict();
export type ResearchPublicLinksInput = z.infer<
  typeof ResearchPublicLinksInputSchema
>;

export const ResearchPublicLinksOutputSchema = z
  .object({
    outcome: z.enum(["RESEARCHING", "ALREADY_READ", "REFUSED"]),
    reason: z.string().max(200).optional(),
  })
  .strict();
export type ResearchPublicLinksOutput = z.infer<
  typeof ResearchPublicLinksOutputSchema
>;

/** A public web address, or null. Validation of a shape, not of meaning. */
export function publicLink(raw: string): string | null {
  const trimmed = raw.trim();
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username !== "" || url.password !== "") return null;
  // A public name with a dot, never a bare host, a local name or an IP.
  if (!host.includes(".") || host.endsWith(".local") || host === "localhost") {
    return null;
  }
  if (/^[\d.]+$/.test(host) || host.includes(":")) return null;
  return url.toString();
}

/**
 * Whether a link is in the person's words, written or said aloud ("acme
 * ventures dot com"): the spoken form is normalised the way the website
 * step already normalises it, then compared.
 */
export function linkInWords(link: string, words: string): boolean {
  const bare = (text: string) => spokenUrl(text).replace(/^https:\/\//, "");
  return bare(words).includes(bare(link)) || textStatedIn(link, words);
}

export type PublicLinksPort = {
  readonly ownerUserId: string;
  /** What the person has said in this conversation: where a link must be. */
  readonly personTurns: readonly string[];
  /** Hand the links to the research. True when a new read started. */
  readonly research: (links: {
    readonly websiteUrl: string | null;
    readonly profileUrls: readonly string[];
  }) => boolean;
};

type Grant = { readonly userId: string };

export function createResearchPublicLinksTool(
  port: PublicLinksPort,
): AnyQToolDefinition {
  return defineQTool<
    ResearchPublicLinksInput,
    ResearchPublicLinksOutput,
    Grant
  >({
    id: RESEARCH_PUBLIC_LINKS,
    version: 1,
    status: "ACTIVE",
    providerName: "research_public_links",
    description:
      "Hands the investor's own firm website or public profile link to Capital Q's research, which reads their public sources and brings back what it finds as recommendations for them to confirm. Call it only when they have given such a link in their own words, with those words as quote. It records nothing. Result: RESEARCHING, ALREADY_READ or REFUSED (with a reason).",
    classification: "SIDE_EFFECT",
    riskClass: "LOW_RISK_INTERNAL",
    requiredCapabilities: [capability("onboarding.session.respond")],
    supportedPurposes: [
      "GENERAL_QUESTION",
      "OWN_COMPANY_QUESTION",
      "INVESTOR_QUESTION",
    ],
    requiredScopeKinds: ["OWN_ONBOARDING"],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "investor-onboarding",
    visibleStage: null,
    input: ResearchPublicLinksInputSchema,
    output: ResearchPublicLinksOutputSchema,
    authorize: (_input, context) => {
      const scope = actorWideScope(context.plan, "OWN_ONBOARDING");
      if (
        scope === undefined ||
        scope.filter.userId !== context.actor.userId ||
        context.actor.userId !== port.ownerUserId
      ) {
        return Promise.resolve(deny<Grant>("NOT_AVAILABLE"));
      }
      return Promise.resolve(
        allow<Grant>("CONFIDENTIAL", { userId: context.actor.userId }),
      );
    },
    execute: (input) => {
      const said = port.personTurns.some((turn) =>
        quoteOccursIn(input.quote, turn),
      );
      const given = [input.website, ...input.profileLinks].filter(
        (link): link is string => link !== null,
      );
      // Each link must be in the quote, and the quote in their words: a
      // link from a page, a document or a guess never leaves.
      if (
        !said ||
        given.length === 0 ||
        !given.every((link) => linkInWords(link, input.quote))
      ) {
        return Promise.resolve({
          outcome: "REFUSED" as const,
          reason: "That link is not in what the person said.",
        });
      }
      const websiteUrl =
        input.website === null ? null : publicLink(spokenUrl(input.website));
      const profileUrls = input.profileLinks
        .map((link) => publicLink(spokenUrl(link)))
        .filter((link): link is string => link !== null);
      if (
        (input.website !== null && websiteUrl === null) ||
        profileUrls.length !== input.profileLinks.length
      ) {
        return Promise.resolve({
          outcome: "REFUSED" as const,
          reason: "That is not a public web address.",
        });
      }
      const started = port.research({ websiteUrl, profileUrls });
      return Promise.resolve({
        outcome: started ? ("RESEARCHING" as const) : ("ALREADY_READ" as const),
      });
    },
  });
}
