import { describe, expect, it } from "vitest";

import {
  ExternalPersonSubjectSchema,
  PersonBriefSchema,
  type ExternalPersonSubject,
} from "@capital-q/contracts";

import { externalEvaluationBasis } from "../src/composition/external-evaluation.js";
import {
  buildExternalPersona,
  claimsToBeRealPerson,
  externalLiveInstructions,
  externalOpeningLine,
} from "../src/composition/external-persona.js";
import { externalSimulation } from "../src/composition/external-presentation.js";
import { scenarioFor } from "../src/composition/external-scenarios.js";

const mk = (
  n: number,
  displayName: string,
  role: string | null,
  organization: string | null,
  entityKind: "PERSON" | "ORGANIZATION" | "GOVERNMENT_AGENCY" = "PERSON",
  extra: Record<string, unknown> = {},
): ExternalPersonSubject =>
  ExternalPersonSubjectSchema.parse({
    entityKind,
    ...extra,
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
    s: mk(2, "QInvest LLC", null, "QInvest LLC", "ORGANIZATION"),
    kind: "ORGANIZATION" as const,
    id: "QINVEST",
  },
  {
    s: mk(3, "Muhannad Taslaq", "Director of Investments", "Alchemist Doha"),
    kind: "PERSON" as const,
    id: "MUHANNAD_TASLAQ",
  },
  {
    s: mk(4, "Invest Qatar", null, "Invest Qatar", "GOVERNMENT_AGENCY"),
    kind: "GOVERNMENT_AGENCY" as const,
    id: "INVEST_QATAR",
  },
  {
    s: mk(5, "AlRayan Investment", null, "AlRayan Investment", "ORGANIZATION"),
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
      /^AI simulation: an? .*\(not a real employee\)$/,
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
  it("passes only our stored asset url and sourced quotes through to the screen, never into the voice", () => {
    const subject = mk(1, "Shadi Qishta", null, null, "PERSON", {
      image: {
        status: "ATTACHED",
        assetUrl: "https://assets.example.test/shadi.jpg",
        attribution: "Official profile",
        licenseNote: "Permission on file",
      },
      quotes: [
        {
          text: "Watch what people spend, and everything else follows.",
          sourceId: "S03",
          speaker: "Shadi Qishta",
          date: null,
          use: "SOURCE_QUOTE_ONLY",
        },
        {
          text: "A quote whose source is not stored.",
          sourceId: "S99",
          speaker: "Shadi Qishta",
          date: null,
          use: "SOURCE_QUOTE_ONLY",
        },
      ],
    });
    const brief = PersonBriefSchema.parse({
      externalPersonId: subject.externalPersonId,
      version: 1,
      builtAt: "2026-10-10",
      freshUntil: "2026-11-10",
      sources: [
        {
          id: "S03",
          url: "https://example.org/s3",
          domain: "example.org",
          title: "Profile",
          publishedAt: null,
          retrievedAt: "2026-10-10",
          provider: "seed",
        },
      ],
      assertions: [],
    });
    const sim = externalSimulation({ subject, brief }, []);
    expect(sim.imageUrl).toBe("https://assets.example.test/shadi.jpg");
    // Only the quote with a stored source is shown.
    expect(sim.quotes).toEqual([
      {
        quote: "Watch what people spend, and everything else follows.",
        sourceLabel: "Profile",
        sourceUrl: "https://example.org/s3",
      },
    ]);
    const built = buildExternalPersona({
      subject,
      brief,
      founder,
      readBy: 1,
    });
    expect(externalLiveInstructions({ subject, built, founder })).not.toContain(
      "Watch what people spend",
    );
  });

  it("shows no image when none is attached", () => {
    const f = FIVE[1];
    if (f === undefined) throw new Error("fixture");
    expect(
      externalSimulation({ subject: f.s, brief: null }, []).imageUrl,
    ).toBeNull();
  });
});

describe("opening line by code", () => {
  it("each of the five opens on its own theme, labelled, with no model", () => {
    const lines = FIVE.map((f) =>
      externalOpeningLine({
        scenario: build(f).scenario,
        companyName: "Acme Freight",
      }),
    );
    expect(new Set(lines).size).toBe(5);
    lines.forEach((line, i) => {
      expect(line).toMatch(/AI rehearsal informed by public sources/u);
      expect(line).toContain("Acme Freight");
      expect(line).toContain(
        build(FIVE[i] as (typeof FIVE)[number]).scenario.openingThemes[0] ?? "",
      );
      expect(claimsToBeRealPerson(line, [FIVE[i]?.s.displayName ?? ""])).toBe(
        false,
      );
    });
  });
});
