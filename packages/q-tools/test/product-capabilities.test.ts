import { describe, expect, it } from "vitest";

import { createQTools } from "../src/default-tools.js";
import { ProductCapabilitySnapshotSchema } from "../src/product-capabilities/schema.js";
import { PRODUCT_CAPABILITY_SNAPSHOT } from "../src/product-capabilities/snapshot.js";
import { ReadProductCapabilitiesOutputSchema } from "../src/tools/read-product-capabilities.js";
import { actorA, contextFor, fakePorts, MARKERS, planFor } from "./support.js";

function context(withScope = true) {
  const plan = planFor(actorA, "GENERAL_QUESTION", withScope ? [{ kind: "OWN_Q_CONVERSATION", sensitivity: "CONFIDENTIAL" }] : []);
  return contextFor(actorA, { ...plan, scopes: plan.scopes.map(scope => ({ ...scope, filter: { ...scope.filter, userId: actorA.userId } })) });
}
function tools(revision: string | null = null) {
  return createQTools({ ports: { ...fakePorts(), productRuntime: { qApiRevision: revision } } }).port;
}
async function read(revision: string | null, arguments_: Record<string, unknown> = {}) {
  const outcome = await tools(revision).execute({ callId: "product", name: "read_product_capabilities", arguments: arguments_ }, context());
  expect(outcome.status).toBe("SUCCEEDED");
  expect(outcome.sensitivity).toBe("PUBLIC");
  if (!outcome.result.ok) throw new Error("Product read failed");
  return ReadProductCapabilitiesOutputSchema.parse(outcome.result.data);
}

describe("bounded public Capital Q implementation inventory", () => {
  it.each([null, "f".repeat(40), "37b5414e0cf7cfe09b21ab91544c391605f193a7"])(
    "keeps historical status separate from current certification for revision %s",
    async revision => {
      const result = await read(revision);
      const discover = result.entries.find(entry => entry.id === "q.discover.analysis-comparison");
      expect(discover?.statusAtVerifiedRevision).toBe("LIVE");
      expect(discover?.currentRevisionStatus).toBe("UNVERIFIED");
      expect(discover?.runningQApiMatchesEvidence).toBe(revision === null ? null : revision === discover?.evidenceRevision);
      expect(result.guidance).toContain("eligibility is never live acceptance");
    },
  );

  it("does not expose invalid runtime metadata or private fixture material", async () => {
    const result = await read("NOT_A_REVISION_PRIVATE_MARKER");
    expect(result.runningQApiRevision).toBeNull();
    const output = JSON.stringify(result);
    expect(output).not.toContain("NOT_A_REVISION_PRIVATE_MARKER");
    expect(output).not.toMatch(/github\.com|\/tmp\/|\/workspace\/|@gmail|access_token|api[_-]?key/iu);
    for (const marker of Object.values(MARKERS)) expect(output).not.toContain(marker);
  });

  it("returns accessible stable inventory entries and explicit unknown IDs", async () => {
    const result = await read(null, { ids: ["gateq.interview", "unknown.feature"] });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.source).toBe("capital-q-product-inventory/2026-10-14.1/gateq.interview");
    expect(result.unknownIds).toEqual(["unknown.feature"]);
    expect(result.coverage).toBe("BOUNDED");
    expect(result.guidance).toContain("omitted entry is UNKNOWN");
    expect(result.guidance).toContain("hypothesis until validated");
  });

  it("requires the actor's own conversation scope", async () => {
    const outcome = await tools().execute({ callId: "product", name: "read_product_capabilities", arguments: {} }, context(false));
    expect(outcome.status).toBe("DENIED");
    const other = context();
    const wrongOwner = { ...other, plan: { ...other.plan, scopes: other.plan.scopes.map(scope => ({ ...scope, filter: { ...scope.filter, userId: "11111111-0000-4000-8000-000000000099" } })) } };
    const refused = await tools().execute({ callId: "product-other", name: "read_product_capabilities", arguments: {} }, wrongOwner);
    expect(refused.status).toBe("DENIED");
  });

  it("lets the existing on-demand loader discover the reader without declaring anything live", async () => {
    const outcome = await tools().execute({ callId: "load-product", name: "use_capability", arguments: { need: "read_product_capabilities" } }, context());
    expect(outcome.status).toBe("SUCCEEDED");
    if (!outcome.result.ok) throw new Error("Capability lookup failed");
    expect(outcome.result.data).toMatchObject({ loaded: [{ name: "read_product_capabilities" }] });
  });

  it("rejects model attempts to supply a runtime revision or override product status", async () => {
    const outcome = await tools().execute({ callId: "product-forged", name: "read_product_capabilities", arguments: { statusAtVerifiedRevision: "LIVE", runningQApiRevision: "f".repeat(40) } }, context());
    expect(outcome.status).toBe("FAILED");
    expect(outcome.failureCode).toBe("INVALID_ARGUMENTS");
  });

  it("rejects LIVE metadata backed only by code inspection", () => {
    const snapshot = structuredClone(PRODUCT_CAPABILITY_SNAPSHOT);
    const entry = snapshot.entries[0];
    if (!entry) throw new Error("Snapshot entry missing");
    entry.proof.kind = "CODE_REVIEW";
    expect(ProductCapabilitySnapshotSchema.safeParse(snapshot).success).toBe(false);
  });
});
