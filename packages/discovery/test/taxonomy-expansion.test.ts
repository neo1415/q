import { describe, expect, it } from "vitest";

import type { TaxonomyNode } from "@capital-q/taxonomy";

import { nodesUnder } from "../src/infrastructure/taxonomy-expansion.js";

const node = (id: string, vocabularyCode: string) =>
  ({ id, vocabularyCode }) as unknown as TaxonomyNode;

// Live 2026-10-29: Ajali Health declared Telehealth (product_category); the
// investor asked for Healthcare (industry). With no relation followed, the
// sector read as a mismatch.
describe("a preference node stands over what the taxonomy says is under it", () => {
  const healthcare = node("healthcare", "industry");
  const taxonomy = {
    listDescendants: (id: string) =>
      Promise.resolve(
        id === "healthcare" ? [node("digital_health", "industry")] : [],
      ),
    listNarrower: (id: string) =>
      Promise.resolve(
        id === "healthcare"
          ? [
              node("telehealth", "product_category"),
              node("digital_health", "industry"),
            ]
          : [],
      ),
  } as never;

  it("follows broader_than edges across vocabularies, once each", async () => {
    const under = await nodesUnder(taxonomy, healthcare);
    expect(under.map((one) => one.id)).toEqual([
      "digital_health",
      "telehealth",
    ]);
  });

  it("never widens a geography through edges", async () => {
    let asked = false;
    const geo = {
      listDescendants: () => Promise.resolve([]),
      listNarrower: () => {
        asked = true;
        return Promise.resolve([node("x", "geography")]);
      },
    } as never;
    expect(await nodesUnder(geo, node("africa", "geography"))).toEqual([]);
    expect(asked).toBe(false);
  });
});
