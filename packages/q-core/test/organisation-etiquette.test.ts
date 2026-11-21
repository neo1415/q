import { describe, expect, it } from "vitest";

import {
  BUILT_IN_ETIQUETTE,
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  etiquetteVersions,
  renderEtiquetteGuidance,
  renderPrompt,
  SYNTHETIC_COMPANY_FACTS,
  type CompanyAnalystVariables,
  type EtiquetteGuides,
} from "../src/index.js";

/**
 * Owner decision 112: the organisation's own guide sits between Capital
 * Q's house guide and the person's own. house < organisation < person on
 * style; without an organisation guide every prompt is byte for byte what
 * it was; and the guide, like the person's, sits in the per-person part of
 * the instructions, after the shared (cached) prefix.
 */
const registry = createDefaultPromptRegistry();

const ORG_TEXT = "ORG-CANARY: we write to investors as 'the Harbour team'.";
const OWN_TEXT = "OWN-CANARY: sign off 'Warmly, Ada'.";

const twoGuides: EtiquetteGuides = {
  platform: BUILT_IN_ETIQUETTE,
  personal: { version: "personal/v2", text: OWN_TEXT },
};
const threeGuides: EtiquetteGuides = {
  ...twoGuides,
  organisation: { version: "organisation/v3", text: ORG_TEXT },
};

describe("the organisation's guide in the etiquette block", () => {
  it("leaves the two-guide rendering exactly as it was without one", () => {
    for (const purpose of ["SPEAK_FOR", "STYLE_ONLY"] as const) {
      const before = renderEtiquetteGuidance(
        { guides: twoGuides, purpose },
        3_200,
      );
      expect(
        renderEtiquetteGuidance(
          { guides: { ...twoGuides, organisation: null }, purpose },
          3_200,
        ),
      ).toBe(before);
      expect(before).toContain(
        "the second, when present, is the person's own, and it wins wherever the two differ on style",
      );
      expect(before).not.toContain("organisation-etiquette-guide");
    }
    expect(etiquetteVersions(twoGuides)).toBe("built-in/v1+personal/v2");
  });

  it("orders house, organisation, person, and says the later wins on style", () => {
    for (const purpose of ["SPEAK_FOR", "STYLE_ONLY"] as const) {
      const block = renderEtiquetteGuidance(
        { guides: threeGuides, purpose },
        3_200,
      );
      const house = block.indexOf("house-etiquette-guide built-in/v1");
      const ours = block.indexOf(
        "organisation-etiquette-guide organisation/v3",
      );
      const own = block.indexOf("personal-etiquette-guide personal/v2");
      expect(house).toBeGreaterThan(0);
      expect(ours).toBeGreaterThan(house);
      expect(own).toBeGreaterThan(ours);
      expect(block).toContain(
        "the next is the organisation's own, which wins over the house guide; the last, when present, is the person's own, which wins over both",
      );
      expect(block).toContain("ORG-CANARY");
      expect(block).toContain("OWN-CANARY");
      expect(block.length).toBeLessThanOrEqual(3_200);
    }
    expect(etiquetteVersions(threeGuides)).toBe(
      "built-in/v1+organisation/v3+personal/v2",
    );
  });

  it("still applies the organisation's guide when the person has none", () => {
    const block = renderEtiquetteGuidance(
      {
        guides: { ...threeGuides, personal: null },
        purpose: "SPEAK_FOR",
      },
      3_200,
    );
    expect(block).toContain("ORG-CANARY");
    expect(block).not.toContain("personal-etiquette-guide");
  });
});

describe("the cached prefix", () => {
  const render = (guides: EtiquetteGuides | undefined) =>
    renderPrompt<CompanyAnalystVariables & { readonly turnNotes: string }>(
      registry,
      {
        task: "COMPANY_ANALYST",
        operatingMode: "DEBRIEF",
        communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
        environmentNotes: "notes",
        variables: {
          capability: "ANSWER",
          userMessage: "Draft a note to the investor.",
          conversation: [],
          authorisedFacts: [...SYNTHETIC_COMPANY_FACTS],
          subjectDescription: "the person's own company",
          turnNotes: "",
        },
        ...(guides === undefined
          ? {}
          : { etiquette: { guides, purpose: "STYLE_ONLY" as const } }),
      },
    );
  const shared = (r: ReturnType<typeof render>) =>
    r.messages
      .filter((m) => "shared" in m && m.shared === true)
      .map((m) => m.content);

  it("is byte-identical with no guide, the house and personal guides, or all three", () => {
    const none = render(undefined);
    const two = render(twoGuides);
    const three = render(threeGuides);
    expect(shared(none)).toHaveLength(2);
    expect(shared(two)).toEqual(shared(none));
    expect(shared(three)).toEqual(shared(none));
  });

  it("carries the organisation's guide only after it, in the per-person part", () => {
    const three = render(threeGuides);
    expect(shared(three).join("")).not.toContain("ORG-CANARY");
    const at = three.messages.findIndex((m) =>
      m.content.includes("ORG-CANARY"),
    );
    const lastShared = three.messages.findLastIndex(
      (m) => "shared" in m && m.shared === true,
    );
    expect(at).toBeGreaterThan(lastShared);
  });
});
