import { describe, expect, it } from "vitest";

import {
  ExternalPersonSubjectSchema,
  type ExternalPersonSubject,
} from "@capital-q/contracts";

import { externalEvaluationBasis } from "../src/composition/external-evaluation.js";
import {
  buildExternalPersona,
  claimsToBeRealPerson,
  externalLiveInstructions,
} from "../src/composition/external-persona.js";
import { externalSimulation } from "../src/composition/external-presentation.js";
import { scenarioFor } from "../src/composition/external-scenarios.js";

const mk = (
  n: number,
  displayName: string,
  role: string | null,
  organization: string | null,
): ExternalPersonSubject =>
  ExternalPersonSubjectSchema.parse({
    externalPersonId: `00000000-0000-4000-8000-0000000c000${String(n)}`,
    displayName,
    nameVariants: [displayName],
    profileUrl: null,
    role,
    organization,
    location: "Doha, Qatar",
    evidenceBundleId: null,
    briefVersion: 0,
    confidence: "STRONG",
  });

const FIVE = [
  {
    s: mk(1, "Shadi Qishta", null, null),
    kind: "PERSON" as const,
    id: "SHADI_QISHTA",
  },
  {
    s: mk(2, "QInvest LLC", null, "QInvest LLC"),
    kind: "ORGANIZATION" as const,
    id: "QINVEST",
  },
  {
    s: mk(3, "Muhannad Taslaq", "Director of Investments", "Alchemist Doha"),
    kind: "PERSON" as const,
    id: "MUHANNAD_TASLAQ",
  },
  {
    s: mk(4, "Invest Qatar", null, "Invest Qatar"),
    kind: "GOVERNMENT_AGENCY" as const,
    id: "INVEST_QATAR",
  },
  {
    s: mk(5, "AlRayan Investment", null, "AlRayan Investment"),
    kind: "ORGANIZATION" as const,
    id: "ALRAYAN_INVESTMENT",
  },
];
const founder = {
  companyName: "Acme Freight",
  businessText:
    "Acme Freight sells freight-matching software to SMEs in the Gulf.",
};
const build = (f: (typeof FIVE)[number]) =>
  buildExternalPersona({
    subject: f.s,
    brief: null,
    founder,
    readBy: 1,
    entityKind: f.kind,
  });

describe("the Qatar five are five different rehearsals", () => {
  const built = FIVE.map(build);

  it("resolves each to its own mode", () => {
    expect(built.map((b) => b.scenario.id)).toEqual(FIVE.map((f) => f.id));
  });

  it("opens on different themes", () => {
    const openings = built.map((b) => b.scenario.openingThemes[0]);
    expect(new Set(openings).size).toBe(5);
    const live = built.map((b, i) =>
      externalLiveInstructions({
        subject: FIVE[i]?.s as ExternalPersonSubject,
        built: b,
        founder,
      }),
    );
    // Each live prompt carries its own opening, and not another mode's.
    live.forEach((text, i) => {
      expect(text).toContain(built[i]?.scenario.openingThemes[0] as string);
      built.forEach((other, j) => {
        if (i !== j)
          expect(text).not.toContain(other.scenario.openingThemes[0] as string);
      });
    });
  });

  it("asks different question sets (pairwise mostly disjoint)", () => {
    const sets = built.map(
      (b) => new Set(b.persona.likelyQuestions.map((q) => q.question)),
    );
    for (let i = 0; i < sets.length; i += 1) {
      for (let j = i + 1; j < sets.length; j += 1) {
        const shared = [...(sets[i] as Set<string>)].filter((q) =>
          (sets[j] as Set<string>).has(q),
        );
        // Only the shared generic pitch-clarity / business-model questions may repeat.
        expect(
          shared.length,
          `${String(i)} vs ${String(j)}`,
        ).toBeLessThanOrEqual(2);
      }
    }
  });

  it("each mode asks about its own subject matter", () => {
    const text = (i: number) =>
      (
        built[i]?.persona.likelyQuestions.map((q) => q.question).join(" ") ?? ""
      ).toLowerCase();
    expect(text(0)).toMatch(/afford|purchasing|reliable your numbers/);
    expect(text(1)).toMatch(/sharia/);
    expect(text(1)).toMatch(/exit or repayment/);
    expect(text(2)).toMatch(/months of cash/);
    expect(text(2)).toMatch(/thirty days/);
    expect(text(3)).toMatch(/enter qatar/);
    expect(text(3)).toMatch(/programmes|jobs/);
    expect(text(4)).toMatch(/sukuk/);
    expect(text(4)).toMatch(/risks/);
  });

  it("different scoring focus per mode", () => {
    const labels = built.map((b) =>
      b.scenario.directions.map((d) => d.label).join("|"),
    );
    expect(new Set(labels).size).toBe(5);
    const turns = [
      { from: "THEM" as const, text: "Tell me about the structure." },
      {
        from: "YOU" as const,
        text: "It is a murabaha structure, Sharia compliant, with an exit via repayment at maturity.",
      },
    ];
    const basis = (i: number) =>
      externalEvaluationBasis({
        turns,
        dimensions: [],
        tips: [],
        sources: [],
        scenario: built[i]?.scenario,
      });
    const qinvest = basis(1);
    expect(qinvest.scenario).toBe("QINVEST");
    expect(
      qinvest.modeFocus?.find((f) => f.key === "sharia_financing")?.covered,
    ).toBe(true);
    expect(
      qinvest.modeFocus?.find((f) => f.key === "governance")?.covered,
    ).toBe(false);
    expect(qinvest.beforeTheRealMeeting.join(" ")).toMatch(/governance/);
    // The same answer scores differently against another mode's focus.
    expect(basis(2).modeFocus?.find((f) => f.key === "runway")?.covered).toBe(
      false,
    );
  });

  it("labels: organisations are a synthetic role, people a research-informed simulation", () => {
    const sims = FIVE.map((f) =>
      externalSimulation(
        {
          subject: f.s,
          brief: null,
          presentation: { entityKind: f.kind, image: null, quotes: [] },
        },
        [],
      ),
    );
    expect(sims[0]?.title).toBe(
      "Research-informed simulation of Shadi Qishta's public priorities",
    );
    expect(sims[2]?.title).toBe(
      "Research-informed simulation of Muhannad Taslaq's public priorities",
    );
    expect(sims[1]?.title).toBe(
      "AI simulation: a QInvest investment professional (not a real employee)",
    );
    expect(sims[3]?.title).toMatch(
      /^AI simulation: a .*\(not a real employee\)$/,
    );
    expect(sims[4]?.title).toMatch(/AlRayan/);
    sims.forEach((s) => {
      expect(s.label).toBe("Research-informed simulation");
      expect(s.disclaimer).toMatch(/AI rehearsal informed by public sources/);
      expect(s.imageUrl).toBeNull();
    });
  });

  it("an unknown entity falls back to a generic mode of its kind", () => {
    expect(
      scenarioFor({
        displayName: "Someone Else",
        nameVariants: [],
        entityKind: "ORGANIZATION",
      }).id,
    ).toBe("GENERIC_ORGANIZATION");
    expect(
      scenarioFor({ displayName: "Someone Else", nameVariants: [] }).id,
    ).toBe("GENERIC_PERSON");
  });

  it("no mode's prompt claims identity or carries an accent instruction", () => {
    built.forEach((b, i) => {
      const text = externalLiveInstructions({
        subject: FIVE[i]?.s as ExternalPersonSubject,
        built: b,
        founder,
      });
      expect(text).toMatch(/never put on an accent/);
      expect(text).toMatch(/Never put words in the real person's mouth/);
      expect(
        claimsToBeRealPerson(b.persona.summary, [FIVE[i]?.s.displayName ?? ""]),
      ).toBe(false);
    });
  });
});

describe("display data", () => {
  it("passes only our stored asset url and source quotes through to the screen", () => {
    const f = FIVE[0];
    if (f === undefined) throw new Error("fixture");
    const sim = externalSimulation(
      {
        subject: f.s,
        brief: null,
        presentation: {
          entityKind: "PERSON",
          image: {
            assetUrl: "https://assets.example.test/shadi.jpg",
            attribution: "Official profile",
          },
          quotes: [
            {
              quote: "Watch what people spend.",
              sourceLabel: "S03",
              sourceUrl: "https://example.org/s3",
            },
          ],
        },
      },
      [],
    );
    expect(sim.imageUrl).toBe("https://assets.example.test/shadi.jpg");
    expect(sim.quotes?.[0]?.quote).toBe("Watch what people spend.");
    // Quotes never reach the voice.
    const built = buildExternalPersona({
      subject: f.s,
      brief: null,
      founder,
      readBy: 1,
      entityKind: "PERSON",
    });
    expect(
      externalLiveInstructions({ subject: f.s, built, founder }),
    ).not.toContain("Watch what people spend");
  });
});
