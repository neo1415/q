import { describe, expect, it } from "vitest";

import type { QOfferedTool } from "@capital-q/q-runtime";

import { stableToolOrder } from "../src/q/tool-order.js";

/** K Part 7: the same tools are sent in the same order on every turn. */
const tool = (name: string): QOfferedTool => ({
  toolName: `t.${name}`,
  toolVersion: 1,
  classification: "READ_ONLY",
  definition: {
    name,
    description: name,
    inputJsonSchema: { type: "object", properties: {} },
  },
  visibleStage: null,
});

describe("stable tool order (K7)", () => {
  it("sends one order for one set, whatever order the offer came in", () => {
    const names = ["use_capability", "get_company", "fit_profile", "Zeta"];
    const a = stableToolOrder(names.map(tool)).map((t) => t.name);
    const b = stableToolOrder([...names].reverse().map(tool)).map(
      (t) => t.name,
    );
    expect(a).toEqual(b);
    expect(a).toEqual(["Zeta", "fit_profile", "get_company", "use_capability"]);
  });
});
