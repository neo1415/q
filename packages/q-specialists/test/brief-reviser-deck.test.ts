import { describe, expect, it } from "vitest";

import type { QArtifactContent } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";

import { createBriefReviser } from "../src/index.js";

/**
 * A deck revision changes the deck (founder live 2026-09-29, ADR 0025).
 * Asked for a green-and-white first page, Q filed five identical versions:
 * only section prose could change. Now the cover and slides do, the look
 * is only what was asked for, and slide text passes the figure check.
 */

const content: QArtifactContent = {
  sections: [
    { heading: "Company", body: "Yamfield Agro processes yams.", findings: [] },
  ],
  gaps: [],
  deck: {
    slides: [
      {
        layout: "TITLE",
        title: "Yamfield Agro",
        subtitle: "Yam processing",
        bullets: [],
        bulletsRight: [],
        section: 0,
      },
      {
        layout: "BULLETS",
        title: "Product",
        bullets: ["Processed yam flour."],
        bulletsRight: [],
        section: 0,
      },
    ],
    direction: "MINIMAL_INSTITUTIONAL",
    markIsDraft: false,
  },
} as unknown as QArtifactContent;

function reviserReturning(value: unknown) {
  const prompts: string[] = [];
  const gateway = {
    execute: (request: { messages: { content: string }[] }) => {
      prompts.push(request.messages.map((m) => m.content).join("\n"));
      return Promise.resolve({
        providerCode: "fake",
        modelCode: "fake-model",
        routingPolicyCode: "normal.test",
        cost: { amount: 0, currency: "USD" },
        output: { kind: "STRUCTURED", value },
      });
    },
  } as unknown as ModelGateway;
  return { reviser: createBriefReviser({ gateway }), prompts };
}

const revise = (reviser: ReturnType<typeof createBriefReviser>) =>
  reviser.revise({
    base: { title: "Yamfield Agro — investor deck", summary: "s", content },
    instruction:
      "Make the first page a green and white gradient, the name in black",
    grounding: ["Yamfield Agro processes yams."],
    sensitivity: "CONFIDENTIAL",
    attribution: {
      tenantId: "t",
      userId: "u",
      qRunId: "r",
      correlationId: "c",
    },
  });

describe("revising a deck", () => {
  it("shows the model the slides and applies the cover it was asked for", async () => {
    const { reviser, prompts } = reviserReturning({
      sections: [],
      slides: [],
      style: {
        coverBackground: ["#2e7d32", "#ffffff"],
        coverTitleInk: "#000000",
        accent: null,
      },
    });
    const revised = await revise(reviser);
    expect(prompts[0]).toContain("[1] Yamfield Agro");
    expect(prompts[0]).toContain("LOOK");
    expect(revised.content.deck?.cover).toEqual({
      background: ["#2e7d32", "#ffffff"],
      titleInk: "#000000",
    });
    // Nothing they did not ask for moved.
    expect(revised.content.deck?.accent).toBeUndefined();
    expect(revised.content.deck?.slides[1]?.bullets).toEqual([
      "Processed yam flour.",
    ]);
  });

  it("rewrites slide text, but never lets a slide add a figure", async () => {
    const { reviser } = reviserReturning({
      sections: [],
      slides: [
        { number: 2, title: "What we make", subtitle: null, bullets: null },
        {
          number: 1,
          title: null,
          subtitle: "Serving 40,000 farmers",
          bullets: null,
        },
      ],
      style: null,
    });
    const revised = await revise(reviser);
    expect(revised.content.deck?.slides[1]?.title).toBe("What we make");
    // The invented figure is refused; the old line stays.
    expect(revised.content.deck?.slides[0]?.subtitle).toBe("Yam processing");
    expect(revised.content.deck?.cover).toBeUndefined();
  });
});
