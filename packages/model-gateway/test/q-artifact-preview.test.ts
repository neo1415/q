import { describe, expect, it } from "vitest";

import { RunRead } from "../src/q/card-subjects.js";
import {
  createSubjectAnnouncer,
  previewLayoutFor,
  subjectsNamedIn,
  isProductName,
} from "../src/q/artifact-preview.js";
import { companiesTableBlock } from "../src/q/result-blocks.js";

/**
 * Artifacts live (owner 2026-10-20): which subjects a sentence names, by
 * code, from the run's authorised reads only; and the company table both
 * roles get, from what each company states.
 */

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const I = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function read(): RunRead {
  const known = new RunRead();
  known.companyNames.set(A, "Baridi Health Ltd");
  known.companyNames.set(B, "MedTrail (fictional)");
  known.investors.set("savannafund", {
    investorOrganisationId: I,
    name: "Savanna Fund",
    country: "NG",
    basis: [],
  });
  return known;
}

describe("subjectsNamedIn", () => {
  it("finds whole names, the name without its legal suffix, and investors, in the order said", () => {
    const named = subjectsNamedIn(
      "Savanna Fund backed MedTrail, not Baridi Health.",
      read(),
    );
    expect(named.map((one) => one.name)).toEqual([
      "Savanna Fund",
      "MedTrail (fictional)",
      "Baridi Health Ltd",
    ]);
    expect(named[0]?.subject).toEqual({
      kind: "INVESTOR_ORGANISATION",
      investorOrganisationId: I,
    });
  });

  it("never matches part of a word or a name nobody read", () => {
    expect(subjectsNamedIn("MedTrails and Baridiana", read())).toEqual([]);
    expect(subjectsNamedIn("Paystack grew fast.", read())).toEqual([]);
  });
});

describe("createSubjectAnnouncer", () => {
  it("announces each subject once, with everything named so far", () => {
    const announcer = createSubjectAnnouncer({
      read,
      question: "What do you think?",
    });
    expect(announcer.sentence("Here is my view.")).toBeNull();
    expect(announcer.sentence("Baridi Health leads.")).toEqual({
      subjects: [
        {
          subject: { kind: "COMPANY", companyId: A },
          name: "Baridi Health Ltd",
        },
      ],
      layout: "CARD",
    });
    expect(announcer.sentence("Baridi Health again.")).toBeNull();
    const next = announcer.sentence("MedTrail trails.");
    expect(next?.subjects.map((one) => one.name)).toEqual([
      "Baridi Health Ltd",
      "MedTrail (fictional)",
    ]);
    expect(next?.layout).toBe("CARDS");
  });

  it("puts a requested comparison up whole with the first sentence", () => {
    const announcer = createSubjectAnnouncer({
      read,
      question: "compare MedTrail vs Baridi Health",
    });
    const first = announcer.sentence("Both are early.");
    expect(first?.layout).toBe("TABLE");
    expect(first?.subjects.map((one) => one.name)).toEqual([
      "MedTrail (fictional)",
      "Baridi Health Ltd",
    ]);
  });

  it("reads the run's reads as they stand at each sentence", () => {
    let known = new RunRead();
    const announcer = createSubjectAnnouncer({
      read: () => known,
      question: "Who is that?",
    });
    expect(announcer.sentence("Baridi Health is a clinic network.")).toBeNull();
    known = read();
    expect(announcer.sentence("Baridi Health is in Kenya.")).not.toBeNull();
  });
});

describe("previewLayoutFor", () => {
  it("is a table only for a comparison of two or more", () => {
    expect(previewLayoutFor("compare them", 1)).toBe("CARD");
    expect(previewLayoutFor("put those in a table", 3)).toBe("TABLE");
    expect(previewLayoutFor("who are they", 3)).toBe("CARDS");
    expect(previewLayoutFor("who", 0)).toBeNull();
  });
});

describe("companiesTableBlock (either role)", () => {
  it("lays two or more companies side by side from what each states; unknown stays empty", () => {
    const known = read();
    known.companyFacts.set(A, {
      about: "Cold-chain clinics",
      stageCode: "SERIES_A",
      city: "Nairobi",
      country: "KE",
      founded: "2019-04-01",
      website: null,
    });
    const block = companiesTableBlock(known);
    expect(block).not.toBeNull();
    if (block?.kind !== "TABLE") throw new Error("not a table");
    expect(block.columns.map((one) => one.subject)).toEqual([
      { kind: "COMPANY", companyId: A },
      { kind: "COMPANY", companyId: B },
    ]);
    const row = (label: string) =>
      block.rows.find((one) => one.label === label)?.cells;
    expect(row("Stage")).toEqual(["Series A", ""]);
    expect(row("Based in")).toEqual(["Nairobi, KE", ""]);
    expect(row("Founded")).toEqual(["2019", ""]);
    // Nobody stated a website: the row is left out, not filled in.
    expect(row("Website")).toBeUndefined();
  });

  it("draws nothing for one company or when nothing was read", () => {
    const one = new RunRead();
    one.companyNames.set(A, "Baridi Health Ltd");
    expect(companiesTableBlock(one)).toBeNull();
    const two = new RunRead();
    two.companyNames.set(A, "Baridi Health Ltd");
    two.companyNames.set(B, "MedTrail");
    expect(companiesTableBlock(two)).toBeNull();
  });
});

describe("artifacts live, round 2", () => {
  it("lays a summary the person asked for out as one, from the answer's findings, keeping each one's truth class", async () => {
    const { summaryBlock } = await import("../src/q/result-blocks.js");
    const block = summaryBlock({
      question: "Can you summarise where Baridi stands?",
      result: {
        findings: [
          {
            statement: "Revenue is GBP 38k a month.",
            truthClass: "USER_CLAIM",
            evidenceStatus: "DOCUMENT_SUPPORTED",
          },
          {
            statement: "The round is likely to close by Q1.",
            truthClass: "Q_INFERENCE",
            evidenceStatus: "NO_EVIDENCE",
          },
        ],
        missingEvidence: ["Audited accounts"],
      },
    });
    expect(block).toEqual({
      kind: "SUMMARY",
      title: "Summary",
      points: [
        {
          text: "Revenue is GBP 38k a month.",
          truthClass: "USER_CLAIM",
          evidenceStatus: "DOCUMENT_SUPPORTED",
        },
        {
          text: "The round is likely to close by Q1.",
          truthClass: "Q_INFERENCE",
          evidenceStatus: "NO_EVIDENCE",
        },
      ],
      missing: ["Audited accounts"],
    });
  });

  it("draws no summary unless asked, or with fewer than two findings", async () => {
    const { summaryBlock } = await import("../src/q/result-blocks.js");
    const findings = [
      {
        statement: "A.",
        truthClass: "VERIFIED",
        evidenceStatus: "PLATFORM_VERIFIED",
      },
      {
        statement: "B.",
        truthClass: "VERIFIED",
        evidenceStatus: "PLATFORM_VERIFIED",
      },
    ];
    expect(
      summaryBlock({ question: "How is Baridi doing?", result: { findings } }),
    ).toBeNull();
    expect(
      summaryBlock({
        question: "sum it up",
        result: { findings: findings.slice(0, 1) },
      }),
    ).toBeNull();
  });

  it("puts a summary's frame up with Q's first words, before anything is named", () => {
    const announcer = createSubjectAnnouncer({
      read: () => new RunRead(),
      question: "Give me a quick recap",
    });
    expect(announcer.sentence("Here is where things stand.")).toEqual({
      subjects: [],
      layout: "SUMMARY",
    });
    expect(announcer.sentence("Nothing new.")).toBeNull();
  });

  it("announces a researched identity by name, ahead of the lookup, once", () => {
    const announcer = createSubjectAnnouncer({
      read,
      question: "Who is Shadi Qishta?",
    });
    const one = {
      subject: null,
      name: "Shadi Qishta",
      kind: "PERSON" as const,
    };
    expect(announcer.ahead(one)).toEqual({ subjects: [one], layout: "CARD" });
    expect(announcer.ahead(one)).toBeNull();
    // Saying the name later announces nothing new.
    expect(
      announcer.sentence("Shadi Qishta is a finance director."),
    ).toBeNull();
  });

  it("previews an identity a lookup tool of this run returned, with its credited image", () => {
    const known = new RunRead();
    known.externals.set("shadiqishta", {
      name: "Shadi Qishta",
      kind: "PERSON",
      externalPersonId: "5b0f6d8e-4f6e-5a3b-8c1d-2e3f4a5b6c7d",
      image: {
        url: "https://images.example/shadi.jpg",
        attribution: "Wiki Commons",
      },
    });
    expect(subjectsNamedIn("I found Shadi Qishta in Doha.", known)).toEqual([
      {
        subject: null,
        name: "Shadi Qishta",
        kind: "PERSON",
        image: {
          url: "https://images.example/shadi.jpg",
          attribution: "Wiki Commons",
        },
      },
    ]);
  });
});

describe("only the subjects the turn is about (owner 2026-10-23)", () => {
  const OWN = "c0000000-0000-4000-8000-0000000000aa";
  const ZINO = "c0000000-0000-4000-8000-0000000000ab";
  const known = (): RunRead => {
    const one = new RunRead();
    // The viewer's own company record, read as context, is "Capital Q".
    one.companyNames.set(OWN, "Capital Q");
    one.companyNames.set(ZINO, "Zino Aviation");
    return one;
  };

  it("never puts up Capital Q's card because Q named itself", () => {
    const announcer = createSubjectAnnouncer({
      read: known,
      question: "Search for Zino Aviation",
    });
    const first = announcer.sentence(
      "Capital Q holds no record of Zino Aviation, so here is what is public.",
    );
    expect(first?.subjects.map((one) => one.name)).toEqual(["Zino Aviation"]);
    expect(announcer.sentence("Capital Q can track it for you.")).toBeNull();
  });

  it("puts it up when the person asked about Capital Q", () => {
    const announcer = createSubjectAnnouncer({
      read: known,
      question: "Tell me about Capital Q",
    });
    expect(
      announcer
        .sentence("Capital Q is a private-capital platform.")
        ?.subjects.map((one) => one.name),
    ).toEqual(["Capital Q"]);
  });

  it("knows the product's name in its forms, and nothing else", () => {
    expect(isProductName("Capital Q")).toBe(true);
    expect(isProductName("CapitalQ")).toBe(true);
    expect(isProductName("Capital Q Ltd")).toBe(true);
    expect(isProductName("Capital Quest")).toBe(false);
    expect(isProductName("Zino Aviation")).toBe(false);
  });
});
