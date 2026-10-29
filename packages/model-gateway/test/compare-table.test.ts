import { describe, expect, it } from "vitest";

import { QResultBlockSchema } from "@capital-q/contracts";

import { RunRead, createRunCompanies } from "../src/q/card-subjects.js";
import {
  asksToCompare,
  comparisonFactStatement,
  ledByVerdict,
  comparisonTableBlock,
  compareTargets,
  comparisonSpokenLine,
  newestAnswerCards,
  withoutCompareOffers,
  namesToCompare,
} from "../src/q/compare-table.js";
import { fitsInOutcome } from "../src/q/fit-cards.js";

import { fitFixture } from "./fit-fixture.js";

/**
 * Owner 23 Oct 2026: "compare the top two side by side" (Mizan vs Silo
 * Credit) came back as two sentences and no table. The table is built by
 * code from what this run read, each cell saying where it comes from.
 */

const MIZAN = "7b62eab6-39b9-4cb6-884a-878301f6928f";
const SILO = "7e5a7a76-857a-4528-9641-08c7bab9cc22";

function run() {
  const read = new RunRead();
  read.companyNames.set(MIZAN, "Mizan");
  read.companyNames.set(SILO, "Silo Credit");
  read.companyFacts.set(MIZAN, {
    about: "Sharia-compliant savings for gig workers.",
    stageCode: "SEED",
    city: "Cairo",
    country: "EG",
    founded: null,
    website: null,
  });
  read.companyFacts.set(SILO, {
    about: "Inventory credit for agri-dealers.",
    stageCode: "PRE_SEED",
    city: null,
    country: "KE",
    founded: null,
    website: null,
  });
  const fits = [
    ...fitsInOutcome(
      fitFixture(MIZAN, "Mizan", {
        STAGE: "STRONG",
        SECTOR: "STRONG",
        CHEQUE_SIZE: "STRONG",
      }),
    ),
    ...fitsInOutcome(
      fitFixture(SILO, "Silo Credit", { STAGE: "PARTIAL", SECTOR: "STRONG" }),
    ),
  ];
  return { read, fits };
}

describe("compare side by side", () => {
  it("knows a request to compare", () => {
    for (const asked of [
      "Compare the top two side by side",
      "Mizan vs Silo Credit?",
      "how do they stack up",
      "comparison of my saved companies",
    ]) {
      expect(asksToCompare(asked)).toBe(true);
    }
    expect(asksToCompare("Tell me about Mizan")).toBe(false);
  });

  it("a table from the run's reads, each cell labelled, unknown left empty", () => {
    const { read, fits } = run();
    const block = comparisonTableBlock({
      question: "Compare Silo Credit and Mizan side by side",
      read,
      fits,
    });
    expect(QResultBlockSchema.safeParse(block).success).toBe(true);
    if (block?.kind !== "TABLE") throw new Error("no table");
    // In the order the person named them.
    expect(block.columns.map((c) => c.label)).toEqual(["Silo Credit", "Mizan"]);
    expect(block.columns[0]?.subject).toEqual({
      kind: "COMPANY",
      companyId: SILO,
    });
    const cells = (label: string) =>
      block.rows.find((row) => row.label === label)?.cells;
    expect(cells("What they do")).toEqual([
      "Inventory credit for agri-dealers. (company-stated)",
      "Sharia-compliant savings for gig workers. (company-stated)",
    ]);
    expect(cells("Stage")).toEqual([
      "Pre Seed (company-stated)",
      "Seed (company-stated)",
    ]);
    expect(cells("Mandate fit")?.[1]).toContain("(Capital Q fit)");
    expect(cells("Cheque fit")?.[0]).toMatch(/^Not known: /u);
    expect(cells("Cheque fit")?.[1]).toMatch(/^Strong match: /u);
    expect(cells("Open questions")?.[0]).toContain("Cheque compatibility");
    // No row of nothing; a row the run has nothing for is left out.
    expect(block.rows.find((row) => row.label === "Raise")).toBeUndefined();
  });

  it("only when asked to compare, and only with two companies read", () => {
    const { read, fits } = run();
    expect(
      comparisonTableBlock({ question: "Tell me about Mizan", read, fits }),
    ).toBeNull();
    expect(
      comparisonTableBlock({
        question: "compare them",
        read: new RunRead(),
        fits: fits.slice(0, 1),
      }),
    ).toBeNull();
  });

  // Owner 23 Oct 2026: traction numbers first, as each company states them.
  it("the traction row leads with the company's own figures, dated, never verified", () => {
    const companies = createRunCompanies();
    companies.note("run-1", {
      toolName: "company.figures.read",
      status: "SUCCEEDED",
      classification: "READ_ONLY",
      result: {
        ok: true,
        data: {
          companyId: MIZAN,
          status: "AVAILABLE",
          figures: [
            {
              key: "team.size",
              statement: "12 full-time staff.",
              value: null,
              asOf: "2026-09-01",
              truthClass: "USER_CLAIM",
              evidenceStatus: "SELF_REPORTED",
              lifecycleStatus: "CURRENT",
            },
            {
              key: "revenue.mrr",
              statement: "Monthly recurring revenue is $42,000.",
              value: null,
              asOf: "2026-09-30",
              truthClass: "USER_CLAIM",
              evidenceStatus: "SELF_REPORTED",
              lifecycleStatus: "CURRENT",
            },
            {
              key: "customers.count",
              statement: "1,200 paying customers",
              value: null,
              asOf: null,
              truthClass: "USER_CLAIM",
              evidenceStatus: "SELF_REPORTED",
              lifecycleStatus: "CURRENT",
            },
          ],
        },
      },
    } as never);
    const read = companies.take("run-1");
    const { read: base, fits } = run();
    for (const [id, name] of base.companyNames) read.companyNames.set(id, name);
    for (const [id, facts] of base.companyFacts)
      read.companyFacts.set(id, facts);
    const block = comparisonTableBlock({
      question: "compare Mizan and Silo Credit side by side",
      read,
      fits,
    });
    if (block?.kind !== "TABLE") throw new Error("no table");
    const traction = block.rows.find((row) => row.label === "Traction")?.cells;
    expect(traction?.[0]).toMatch(
      /^Monthly recurring revenue is \$42,000 \(company-stated, Sep 2026\); 1,200 paying customers \(company-stated\)/u,
    );
    // Not a traction figure: not in the traction row.
    expect(traction?.[0]).not.toContain("full-time staff");
    // A company that published none: only what the fit says, never a zero.
    expect(traction?.[1]).not.toContain("company-stated");
  });
});

describe("which companies a compare follow-up means", () => {
  const cards = [
    { companyId: MIZAN, name: "Mizan" },
    { companyId: SILO, name: "Silo Credit" },
    { companyId: "c3", name: "Kora" },
  ];

  it("the top two of the newest answer's cards", () => {
    expect(compareTargets("Compare the top two side by side", cards)).toEqual([
      MIZAN,
      SILO,
    ]);
    expect(compareTargets("compare the first three", cards)).toEqual([
      MIZAN,
      SILO,
      "c3",
    ]);
  });

  it("those it names, in the order named", () => {
    expect(compareTargets("Kora vs Mizan?", cards)).toEqual(["c3", MIZAN]);
  });

  it("nothing for a question that is not a comparison, or one card", () => {
    expect(compareTargets("Tell me more about Mizan", cards)).toEqual([]);
    expect(compareTargets("compare them", cards.slice(0, 1))).toEqual([]);
  });

  it("reads cards from Q's newest answer only", () => {
    const block = (ids: string[]) => ({
      kind: "ANSWER_CARDS",
      cards: ids.map((companyId) => ({
        name: companyId,
        subject: { kind: "COMPANY", companyId },
      })),
    });
    expect(
      newestAnswerCards([
        { role: "Q", blocks: [block(["old"])] },
        { role: "USER" },
        { role: "Q", blocks: [block(["a", "b"])] },
        { role: "USER" },
      ]).map((card) => card.companyId),
    ).toEqual(["a", "b"]);
  });
});

describe("a comparison asked for is done, never offered", () => {
  it("removes the offer and keeps the rest", () => {
    expect(
      withoutCompareOffers(
        "The top two are tied at 7.6. I can compare their stage, sector and round terms side by side. Want me to compare them on traction?",
      ),
    ).toBe("The top two are tied at 7.6.");
    expect(withoutCompareOffers("Mizan is in Cairo.")).toBe(
      "Mizan is in Cairo.",
    );
  });

  it("says the real differences from the table's own cells", () => {
    const { read, fits } = run();
    const block = comparisonTableBlock({
      question: "Compare the top two side by side",
      read,
      fits,
      shown: [MIZAN, SILO],
    });
    if (block === null) throw new Error("no table");
    const line = comparisonSpokenLine(block) ?? "";
    expect(line).toContain(
      "Mizan: sharia-compliant savings for gig workers, based in Cairo, EG",
    );
    expect(line).toContain(
      "Silo Credit: inventory credit for agri-dealers, based in KE",
    );
    expect(line).not.toContain("company-stated)");
  });
});

// Owner QA O-I6 (23 Oct 2026): "Compare Ledgerline, Duplo and Anchor"
// showed Ledgerline vs Ledgerfold, a company the run read for another
// reason. The companies the question names are the table.
describe("the table is the companies the question names", () => {
  it("leaves out a company the run read but the question did not name", () => {
    const { read, fits } = run();
    const LEDGERFOLD = "84b9641f-b618-4fa3-8b35-1d19b1c71d82";
    read.companyNames.set(LEDGERFOLD, "Ledgerfold");
    read.companyFacts.set(LEDGERFOLD, {
      about: "Working-capital loans for Lagos market traders.",
      stageCode: "SEED",
      city: "Lagos",
      country: "NG",
      founded: null,
      website: null,
    });
    const block = comparisonTableBlock({
      question: "Compare Silo Credit and Mizan",
      read,
      fits,
    });
    if (block?.kind !== "TABLE") throw new Error("no table");
    expect(block.columns.map((column) => column.label)).toEqual([
      "Silo Credit",
      "Mizan",
    ]);
  });
});

describe("the reader's comparison decides, never the words", () => {
  const cards = [
    { companyId: MIZAN, name: "Mizan" },
    { companyId: SILO, name: "Silo Credit" },
    { companyId: "c3", name: "Kora" },
  ];
  it("a count over the cards, in words no pattern knows", () => {
    expect(asksToCompare("Lequel des trois est le meilleur ?")).toBe(false);
    expect(
      compareTargets("Lequel des trois est le meilleur ?", cards, {
        count: 3,
        names: [],
      }),
    ).toEqual([MIZAN, SILO, "c3"]);
  });
  it("the names it heard, in their order", () => {
    expect(
      compareTargets("which is better?", cards, {
        count: null,
        names: ["Kora", "Mizan"],
      }),
    ).toEqual(["c3", MIZAN]);
  });
  it("no comparison read: nothing, whatever the words", () => {
    expect(compareTargets("tell me about Kora", cards)).toEqual([]);
  });
});

// Coordinator 24 Oct 2026: a "which is better" answer named both as the
// better one. The verdict is decided by code, from the computed fit.
describe("one verdict, from Capital Q's fit", () => {
  it("leads with the higher mandate fit", () => {
    const { read } = run();
    const fits = [
      ...fitsInOutcome(
        fitFixture(MIZAN, "Mizan", {
          STAGE: "STRONG",
          SECTOR: "STRONG",
          GEOGRAPHY: "STRONG",
        }),
      ),
      ...fitsInOutcome(
        fitFixture(SILO, "Silo Credit", {
          STAGE: "PARTIAL",
          SECTOR: "STRONG",
          GEOGRAPHY: "PARTIAL",
        }),
      ),
    ];
    const block = comparisonTableBlock({
      question: "Which is better, Silo Credit or Mizan?",
      read,
      fits,
      // The reader read a comparison (TURN_READER v62).
      compareAsked: true,
    });
    if (block === null) throw new Error("no table");
    expect(comparisonFactStatement(block, fits)).toMatch(
      /VERDICT[^\n]*lead with exactly one, Mizan \(Capital Q mandate fit [\d.]+ against Silo Credit's [\d.]+\)/u,
    );
  });

  it("level fits are said as level, with no winner", () => {
    const { read } = run();
    const same = { STAGE: "STRONG", SECTOR: "STRONG", GEOGRAPHY: "PARTIAL" };
    const fits = [
      ...fitsInOutcome(fitFixture(MIZAN, "Mizan", same)),
      ...fitsInOutcome(fitFixture(SILO, "Silo Credit", same)),
    ];
    const block = comparisonTableBlock({
      question: "Compare Mizan and Silo Credit",
      read,
      fits,
    });
    if (block === null) throw new Error("no table");
    const statement = comparisonFactStatement(block, fits) ?? "";
    expect(statement).toContain("are level on Capital Q's mandate fit");
    expect(statement).not.toContain("lead with exactly one");
  });
});

describe("code decides who a comparison leads with", () => {
  const verdict = {
    leader: "Anchor",
    other: "Afyascan",
    leaderScore: "7.6",
    otherScore: "7",
    level: false,
  };
  it("replaces a competing lead, keeps the rest", () => {
    expect(
      ledByVerdict(
        "Afyascan is the better-supported fit on the evidence. Anchor has the clearer fit.",
        verdict,
      ),
    ).toBe(
      "On Capital Q's mandate fit, Anchor leads: 7.6 against Afyascan's 7. Anchor has the clearer fit.",
    );
  });
  it("keeps an opening that already names the leader", () => {
    expect(ledByVerdict("Anchor fits best. Afyascan trails.", verdict)).toBe(
      "On Capital Q's mandate fit, Anchor leads: 7.6 against Afyascan's 7. Anchor fits best. Afyascan trails.",
    );
  });
  it("level fits are said as level", () => {
    expect(
      ledByVerdict("Both are close.", {
        ...verdict,
        otherScore: "7.6",
        level: true,
      }),
    ).toBe(
      "Anchor and Afyascan are level on Capital Q's mandate fit, at 7.6 each. Both are close.",
    );
  });
});

// Live 24 Oct 2026 (9ff4a1118): the lead was right, but the sentence after
// it read "8 million round fits…": the splitter cut "$1.8" at its point.
describe("the verdict keeps the model's numbers whole", () => {
  it("never splits inside a number", () => {
    expect(
      ledByVerdict(
        "Afyascan is the better-supported fit on the evidence currently available. Afyascan's $1.8 million round fits your $250,000–$1 million range; Anchor's round size is still unknown.",
        {
          leader: "Anchor",
          other: "Afyascan",
          leaderScore: "7.6",
          otherScore: "7",
          level: false,
        },
      ),
    ).toBe(
      "On Capital Q's mandate fit, Anchor leads: 7.6 against Afyascan's 7. Afyascan's $1.8 million round fits your $250,000–$1 million range; Anchor's round size is still unknown.",
    );
  });
});

describe("namesToCompare (no reader comparison)", () => {
  it("reads the companies a choice names", () => {
    expect(namesToCompare("Which is better, Anchor or Afyascan?")).toEqual([
      "Anchor",
      "Afyascan",
    ]);
    expect(namesToCompare("Compare Ledgerline and Duplo")).toEqual([
      "Ledgerline",
      "Duplo",
    ]);
  });
  it("names none for a question that is not a choice between companies", () => {
    expect(namesToCompare("Tell me about Anchor")).toEqual([]);
    expect(namesToCompare("Which is better for me?")).toEqual([]);
  });
});

// F-126 (QA on 5630e086f): the Traction and Team rows read "Your mandate
// sets no preference" for both companies. A fact row says the company's
// own facts or "Not stated"; how the mandate weighs them is the fit's.
describe("fact rows are the company's facts (F-126)", () => {
  it("says each company's own traction and team, or nothing (not known), never the mandate's weighting", () => {
    const { read, fits } = run();
    read.companyFacts.set(MIZAN, {
      ...(read.companyFacts.get(MIZAN) ?? {
        about: null,
        stageCode: null,
        city: null,
        country: null,
        founded: null,
        website: null,
      }),
      team: [
        { name: "Amira Saleh", title: "CEO", isFounder: true },
        { name: "Omar Fathy", title: null, isFounder: false },
      ],
    });
    read.companyFigures.set(MIZAN, [
      {
        key: "revenue.mrr",
        statement: "Monthly recurring revenue is $42,000.",
        asOf: "2026-09-30",
        truthClass: "USER_CLAIM",
        evidenceStatus: "SELF_REPORTED",
      },
    ]);
    // The mandate weighs neither traction nor team for these two.
    const unweighted = fits.map((fit) => ({
      ...fit,
      profile: {
        ...fit.profile,
        parameters: fit.profile.parameters.map((parameter) =>
          parameter.parameter === "TRACTION" || parameter.parameter === "TEAM"
            ? { ...parameter, applicable: false }
            : parameter,
        ),
      },
    }));
    const block = comparisonTableBlock({
      question: "Compare Mizan and Silo Credit in a table",
      read,
      fits: unweighted,
    });
    if (block?.kind !== "TABLE") throw new Error("no table");
    const cells = (label: string) =>
      block.rows.find((row) => row.label === label)?.cells ?? [];
    expect(cells("Traction")[0]).toContain("$42,000");
    // Unknown is the contract's empty cell (live 2026-10-29: "Not stated"
    // went into the spreadsheet as words).
    expect(cells("Traction")[1]).toBe("");
    expect(cells("Team")[0]).toBe(
      "Amira Saleh (founder, CEO); Omar Fathy (company-stated)",
    );
    expect(cells("Team")[1]).toBe("");
    for (const label of ["Traction", "Team"]) {
      for (const cell of cells(label)) {
        expect(cell).not.toMatch(/mandate/iu);
      }
    }
    // "Not stated" is not said aloud as a figure.
    expect(comparisonSpokenLine(block)).not.toMatch(/traction: Not stated/u);
  });
});

// Stress 2026-10-28: J1 showed Prumo and Railhead Robotics, J4 Ledgerio and
// Ledgerly beside LedgerBridge, I03 Capital Q's own record. The table is
// the asked subjects or the ranked set shown, never a look-alike the run
// happened to read and never Capital Q itself.
describe("the table never holds strangers", () => {
  const LEDGERIO = "0c1f2a8e-6d3b-4a9e-9d7a-1b2c3d4e5f60";
  const CAPITAL_Q = "ee75a7d8-d457-4b59-9ad8-0d64b3026a3d";
  function withStrangers() {
    const { read, fits } = run();
    for (const [id, name] of [
      [LEDGERIO, "Ledgerio Works"],
      [CAPITAL_Q, "Capital Q"],
    ] as const) {
      read.companyNames.set(id, name);
      read.companyFacts.set(id, {
        about: "Something else.",
        stageCode: "SEED",
        city: null,
        country: "NG",
        founded: null,
        website: null,
      });
    }
    return { read, fits };
  }

  it("no named subjects and no ranked set: no table at all", () => {
    const { read, fits } = withStrangers();
    expect(
      comparisonTableBlock({
        question: "Challenge LedgerBridge's metrics and identify the risks",
        read,
        fits,
        compareAsked: true,
      }),
    ).toBeNull();
  });

  it("traction with no published figures comes from the company's own description (I06)", () => {
    const { read, fits } = run();
    read.companyFacts.set(MIZAN, {
      about: "VAT compliance software.",
      description:
        "Ledgerline is VAT compliance software. Ledgerline charges a monthly subscription per legal entity and serves 1,140 paying businesses at about ₦38m in monthly recurring revenue. Six-month logo retention is 96%.",
      stageCode: "SEED",
      city: "Lagos",
      country: "NG",
      founded: null,
      website: null,
    });
    const block = comparisonTableBlock({
      question: "Compare Mizan and Silo Credit",
      read,
      fits,
    });
    if (block?.kind !== "TABLE") throw new Error("no table");
    const traction = block.rows.find((row) => row.label === "Traction");
    expect(traction?.cells[0]).toContain("₦38m in monthly recurring revenue");
    expect(traction?.cells[0]).toContain("(company-stated, profile)");
    expect(traction?.cells[1]).toBe("");
  });

  it("with a ranked set shown: only those, never Capital Q", () => {
    const { read, fits } = withStrangers();
    const block = comparisonTableBlock({
      question: "Find five companies in Capital Q that fit my mandate",
      read,
      fits,
      compareAsked: true,
      shown: [CAPITAL_Q, MIZAN, SILO],
    });
    if (block?.kind !== "TABLE") throw new Error("no table");
    expect(block.columns.map((column) => column.label)).toEqual([
      "Mizan",
      "Silo Credit",
    ]);
  });
});

// Stress 2026-10-28 (I06): LedgerBridge has no one-line description; its
// "What they do" read "Not known" while its description, with "B2B" taken
// for a number, sat under Traction.
describe("a company with only a full description", () => {
  it("says what it does from its description, and no traction from 'B2B'", () => {
    const { read, fits } = run();
    read.companyFacts.set(SILO, {
      about: null,
      description:
        "LedgerBridge is a B2B payments platform for Nigerian merchants and distributors: it collects invoices, reconciles bank transfers and settles supplier payouts in one ledger. Fictional test company.",
      stageCode: "SEED",
      city: null,
      country: "NG",
      founded: null,
      website: null,
    });
    const block = comparisonTableBlock({
      question: "Compare Silo Credit and Mizan side by side",
      read,
      fits,
    });
    if (block?.kind !== "TABLE") throw new Error("no table");
    const cells = (label: string) =>
      block.rows.find((row) => row.label === label)?.cells;
    expect(cells("What they do")?.[0]).toMatch(
      /^LedgerBridge is a B2B payments platform for Nigerian merchants and distributors/u,
    );
    expect(cells("Traction")?.[0] ?? "").not.toMatch(/B2B payments platform/u);
  });
});
