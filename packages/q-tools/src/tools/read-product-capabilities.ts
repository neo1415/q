import { z } from "zod";

import { Q_TASK_CLASSES } from "@capital-q/contracts";
import { allow, defineQTool, deny, type AnyQToolDefinition } from "../definition.js";
import { actorWideScope } from "../plan.js";
import { PRODUCT_CAPABILITY_SNAPSHOT } from "../product-capabilities/snapshot.js";
import { ProductCapabilityEntrySchema, ProductRevisionSchema } from "../product-capabilities/schema.js";

export const READ_PRODUCT_CAPABILITIES = "q.product.capabilities" as const;
export const ReadProductCapabilitiesInputSchema = z.object({
  ids: z.array(z.string().min(1).max(80)).max(12).default([]).describe("Exact inventory entry IDs to read; empty returns this bounded snapshot. An omitted feature is unknown, not absent."),
}).strict();
export const ReadProductCapabilitiesOutputSchema = z.object({
  version: z.string().max(40),
  publishedOn: z.iso.date(),
  coverage: z.literal("BOUNDED"),
  runningQApiRevision: ProductRevisionSchema.nullable(),
  entries: z.array(ProductCapabilityEntrySchema.safeExtend({
    source: z.string().max(160),
    runningQApiMatchesEvidence: z.boolean().nullable(),
    currentRevisionStatus: z.literal("UNVERIFIED"),
    verificationScope: z.literal("BOUNDED_HISTORICAL_EVIDENCE"),
  })).max(24),
  unknownIds: z.array(z.string().max(80)).max(12),
  guidance: z.string().max(1600),
}).strict();

export function createReadProductCapabilitiesTool(runningRevision?: string | null): AnyQToolDefinition {
  const revision = ProductRevisionSchema.safeParse(runningRevision);
  return defineQTool({
    id: READ_PRODUCT_CAPABILITIES, version: 1, status: "ACTIVE",
    providerName: "read_product_capabilities",
    description: "Reads Capital Q's bounded versioned product implementation inventory: LIVE, PARTIAL, PLANNED or UNVERIFIED at a named evidence revision/date, proof summaries and limits. Before comparing competitor offerings against Capital Q, read this inventory and dated vendor web sources. Cite the inventory entry/version as the internal product source; do not infer missing features from omissions or eligibility, and label market-demand gaps as hypotheses requiring validation.",
    classification: "READ_ONLY", riskClass: "SAFE_READ", requiredCapabilities: [],
    supportedPurposes: [...Q_TASK_CLASSES], requiredScopeKinds: ["OWN_Q_CONVERSATION"],
    approval: "NONE", idempotency: "SAFE_TO_REPEAT", owner: "q-tools", visibleStage: null,
    input: ReadProductCapabilitiesInputSchema, output: ReadProductCapabilitiesOutputSchema,
    authorize: (_input, { actor, plan }) => {
      const scope = actorWideScope(plan, "OWN_Q_CONVERSATION");
      return Promise.resolve(scope?.filter.userId === actor.userId ? allow("PUBLIC", null) : deny("NOT_AVAILABLE"));
    },
    execute: async (input) => {
      const snapshot = PRODUCT_CAPABILITY_SNAPSHOT;
      const ids = new Set(input.ids);
      const entries = snapshot.entries.filter(entry => ids.size === 0 || ids.has(entry.id));
      return {
        version: snapshot.version, publishedOn: snapshot.publishedOn, coverage: snapshot.coverage,
        runningQApiRevision: revision.success ? revision.data : null,
        entries: entries.map(entry => ({ ...entry, source: `capital-q-product-inventory/${snapshot.version}/${entry.id}`, runningQApiMatchesEvidence: revision.success ? revision.data === entry.evidenceRevision : null, currentRevisionStatus: "UNVERIFIED" as const, verificationScope: "BOUNDED_HISTORICAL_EVIDENCE" as const })),
        unknownIds: [...ids].filter(id => !snapshot.entries.some(entry => entry.id === id)),
        guidance: "statusAtVerifiedRevision describes only the recorded proof at evidenceRevision/verifiedOn. currentRevisionStatus remains UNVERIFIED: runningQApiMatchesEvidence compares only q-api, never full web/API/workers/provider acceptance. A matching commit is not an independent live verification. CapabilityNote/use_capability tells which actions are available for this actor now; eligibility is never live acceptance. This inventory is bounded: an omitted entry is UNKNOWN, never a demonstrated missing feature. Cite the stable internal inventory source/version; users can ask Q to read that entry. Compare against dated public vendor sources, distinguishing vendor claims, recorded Q state, demonstrated parity/gap and unknowns. Market demand or willingness to pay is a hypothesis until validated; do not claim a full platform audit.",
      };
    },
  });
}
