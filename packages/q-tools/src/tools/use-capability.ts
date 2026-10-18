import { z } from "zod";

import { Q_TASK_CLASSES } from "@capital-q/contracts";
import type { QToolExecutionContext } from "@capital-q/q-runtime";

import { Q_CAPABILITIES } from "../capabilities.js";
import { allow, defineQTool, type AnyQToolDefinition } from "../definition.js";

/**
 * On-demand tools (lead 2026-10-04: "make sure that Q is able to get all
 * its tools whenever it needs them"). A turn is offered what its focus
 * says it is about; anything else this run may use is one call away:
 * `use_capability("book a call")` returns the tools that do it, and the
 * gateway adds them to the offer for the next step of the same turn.
 *
 * What it can return is only what the registry's `available` allows for
 * this run's purpose, plan scopes and actor (the same list that decides
 * what may execute), so a tool the plan does not allow is never loaded;
 * the loaded tool's own authorize step still runs when it is called.
 */

export const USE_CAPABILITY = "q.capability.use" as const;
export const USE_CAPABILITY_TOOL = "use_capability" as const;
/** At most this many tools are loaded by one call. */
export const USE_CAPABILITY_MAX = 4;

/** How the registry hands the tool its run's list (bound at registration). */
export const BIND_CATALOGUE: unique symbol = Symbol("q-tools.bindCatalogue");

export type CapabilityCatalogue = (
  context: QToolExecutionContext,
) => readonly { readonly providerName: string; readonly description: string }[];

export const UseCapabilityInputSchema = z
  .object({
    need: z
      .string()
      .trim()
      .min(2)
      .max(200)
      .describe(
        "The tool's exact name from WHAT CAPITAL Q CAN DO, or a few words for what you need to do (e.g. 'book a call', 'company sharing settings').",
      ),
  })
  .strict();
export type UseCapabilityInput = z.infer<typeof UseCapabilityInputSchema>;

export const UseCapabilityOutputSchema = z
  .object({
    loaded: z
      .array(z.object({ name: z.string().max(64), does: z.string().max(300) }))
      .max(USE_CAPABILITY_MAX),
    message: z.string().max(300),
  })
  .strict();
export type UseCapabilityOutput = z.infer<typeof UseCapabilityOutputSchema>;

const DOES = new Map<string, string>(
  Q_CAPABILITIES.flatMap((capability) =>
    capability.performedBy.kind === "TOOL"
      ? [
          [
            capability.performedBy.providerName,
            `${capability.does} ${capability.area ?? ""} ${capability.group}`,
          ] as const,
        ]
      : [],
  ),
);

const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "their",
  "them",
  "they",
  "this",
  "that",
  "from",
  "into",
  "about",
  "what",
  "who",
  "can",
  "you",
  "use",
  "need",
  "tool",
  "please",
]);

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .filter((word) => word.length >= 3 && !STOP.has(word))
      .map((word) => (word.length > 4 ? word.replace(/(?:es|s)$/u, "") : word)),
  );
}

/**
 * The tools a need names: the exact tool name when given, otherwise the
 * best word matches over the tool's name (counted twice), what its
 * capability does and its description. Deterministic: ties by name.
 */
export function matchCapabilities(
  need: string,
  candidates: readonly {
    readonly providerName: string;
    readonly description: string;
  }[],
): readonly string[] {
  const exact = need
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/gu, "_");
  const named = candidates.find((tool) => tool.providerName === exact);
  if (named !== undefined) return [named.providerName];
  const wanted = words(need);
  if (wanted.size === 0) return [];
  return candidates
    .map((tool) => {
      const name = words(tool.providerName.replace(/_/gu, " "));
      const said = words(
        `${DOES.get(tool.providerName) ?? ""} ${tool.description.slice(0, 300)}`,
      );
      let score = 0;
      for (const word of wanted) {
        if (name.has(word)) score += 2;
        else if (said.has(word)) score += 1;
      }
      return { name: tool.providerName, score };
    })
    .filter((tool) => tool.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, USE_CAPABILITY_MAX)
    .map((tool) => tool.name);
}

export function createUseCapabilityTool(): AnyQToolDefinition {
  let catalogue: CapabilityCatalogue | null = null;
  const definition = defineQTool<UseCapabilityInput, UseCapabilityOutput, null>(
    {
      id: USE_CAPABILITY,
      version: 1,
      status: "ACTIVE",
      providerName: USE_CAPABILITY_TOOL,
      description:
        "Loads a Capital Q tool you were not given this turn, by its name or by what you need to do. Call it whenever what they ask needs a tool you do not have; the tools it returns are yours to call in your next step of this same turn. Never tell them you cannot do something before calling this.",
      classification: "READ_ONLY",
      riskClass: "SAFE_READ",
      requiredCapabilities: [],
      supportedPurposes: [...Q_TASK_CLASSES],
      core: true,
      requiredScopeKinds: [],
      approval: "NONE",
      idempotency: "SAFE_TO_REPEAT",
      owner: "q-tools",
      visibleStage: null,
      input: UseCapabilityInputSchema,
      output: UseCapabilityOutputSchema,
      authorize: () => Promise.resolve(allow<null>("INTERNAL", null)),
      execute: (input, context) => {
        // Only what this run may use: purpose, plan scopes and actor.
        const allowed = (catalogue?.(context) ?? []).filter(
          (tool) => tool.providerName !== USE_CAPABILITY_TOOL,
        );
        const loaded = matchCapabilities(input.need, allowed).map((name) => ({
          name,
          does: (
            allowed.find((tool) => tool.providerName === name)?.description ??
            ""
          ).slice(0, 300),
        }));
        return Promise.resolve({
          loaded,
          message:
            loaded.length === 0
              ? "No tool available to them here does that."
              : "Loaded: call the one that fits in your next step.",
        });
      },
    },
  );
  return Object.assign(definition, {
    [BIND_CATALOGUE]: (bound: CapabilityCatalogue) => {
      catalogue = bound;
    },
  });
}
