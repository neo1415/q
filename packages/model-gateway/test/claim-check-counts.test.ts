import { describe, expect, it } from "vitest";

import { checkAnswer, claimCorpus } from "../src/q/claim-check.js";

/**
 * Scenario D rerun on d252444b1 (16 Nov 2026, run b0a877f8): Thames Arc
 * asked how many people per role Halyard Security's hiring plan adds and
 * when. Q read the plan (read_company_document) and said "4 public-sector
 * account managers"; the plan says 3, Q's own finding said 3, and the
 * parts summed to 16 against the stated 15. The hiring-plan rows below are
 * the plan's own text as that read returned it (a synthetic demo
 * document), inside the tool result JSON the claim check reads.
 */

const PLAN_TEXT =
  "Headcount at 31 Oct 2026\n\nFunction | People\n\nEngineering | 9\n\nDeployment | 9\n\nSales | 3\n\nOperations | 2\n\nTotal | 23 Headcount by function: May 2026 to Oct 2026\n\nMay 2026 | Jun 2026 | Jul 2026 | Aug 2026 | Sep 2026 | Oct 2026\n\nEngineering | 8 | 9 | 9 | 9 | 9 | 9\n\nDeployment | 6 | 6 | 7 | 7 | 7 | 9\n\nSales | 3 | 3 | 3 | 3 | 3 | 3\n\nOperations | 2 | 2 | 2 | 2 | 2 | 2\n\nTotal | 19 | 20 | 21 | 21 | 21 | 23 Hiring plan funded by the seed round\n\nRole | Function | People Start by | Use of funds line\n\nDeployment engineer | Deployment | 6 2027-Q2 | Deployment team for NHS trusts and councils\n\nProduct engineer (shared workstations, Engineering | 4 2027-Q2 | Product: shared workstation and lost-device flows\n\nlost devices)\n\nPublic-sector account manager | Sales | 3 2027-Q1 | Public-sector sales and framework listings\n\nInformation security and assurance | Operations | 1 2027-Q1 | Assurance (Cyber Essentials Plus, DSPT, ISO 27001) and\n\nmanager | G&A\n\nFinance and operations manager | Operations | 1 2027-Q3 | Assurance (Cyber Essentials Plus, DSPT, ISO 27001) and\n\nG&A SYNTHETIC DEMO DOCUMENT\n\nHalyard Security Ltd | Team and hiring plan Version 1.0 | Period: May 2025 to Dec 2027 | Issued 13 Nov 2026 | Page 1/1";

/** The read's result as the model got it: JSON, its line breaks escaped. */
const PLAN_READ = JSON.stringify({
  ok: true,
  data: {
    status: "READ",
    documentId: "c0d522b1-ca99-4e7d-ad83-cb99ba7326ef",
    title: "Team and hiring plan",
    folder: "Team",
    pageCount: null,
    text: PLAN_TEXT,
    truncated: false,
    truthClass: "USER_CLAIM",
    evidenceStatus: "DOCUMENT_SUPPORTED",
  },
});

/** Another read of the same turn, full of 4s (the KPI pack). */
const KPI_READ = JSON.stringify({
  ok: true,
  data: {
    status: "READ",
    pages: [
      {
        page: 1,
        text: "NHS trusts, health boards and councils | 3 | 3 | 3 | 4 | 4 | 4\nLicensed seats | 16,800 | 17,900 | 19,400 | 21,600 | 22,700 | 24,000\nRunway 4.2 months at this burn.",
      },
    ],
  },
});

const corpus = claimCorpus(
  [
    "Break that down for me: how many people per role, and in which quarter does each group start?",
    PLAN_READ,
    KPI_READ,
  ],
  new Date("2026-11-16T18:20:00Z"),
);

const LIVE_ANSWER =
  "Halyard Security’s hiring plan names five 2027 groups, adding 15 people in total if the planned seed round closes: 4 public-sector account managers and 1 information security and assurance manager in Q1; 6 deployment engineers and 4 product engineers in Q2; and 1 finance and operations manager in Q3. The plan does not give a specific month or day within each quarter.";

describe("claim check: a count of a named item is held to the lines that name it (live b0a877f8)", () => {
  it("puts the plan's 3 account managers right, so the parts add up to the stated 15", () => {
    const out = checkAnswer(LIVE_ANSWER, corpus);
    expect(out.text).toContain("3 public-sector account managers");
    expect(out.text).not.toContain("4 public-sector account managers");
    // The counts the plan states stand as written.
    expect(out.text).toContain(
      "6 deployment engineers and 4 product engineers",
    );
    expect(out.text).toContain("1 finance and operations manager");
    expect(out.text).toContain("adding 15 people in total");
    expect(out.ungrounded).toEqual(["NUMBER"]);
  });

  it("drops a sentence whose parts do not add up to the total it states", () => {
    const out = checkAnswer(
      "The plan adds 16 people in total: 6 deployment engineers and 4 product engineers in Q2. The plan gives quarters only.",
      corpus,
    );
    expect(out.text).toBe("The plan gives quarters only.");
    expect(out.ungrounded).toEqual(["NUMBER"]);
  });

  it("never puts a count right on the line alone: without a total that agrees, the sentence goes", () => {
    const out = checkAnswer(
      "There were 2 deployment engineers in July. The plan gives quarters only.",
      corpus,
    );
    expect(out.text).toBe("The plan gives quarters only.");
    expect(out.text).not.toContain("6 deployment engineers in July");
  });

  it("drops a count the lines naming the item contradict without settling", () => {
    const twoLines = claimCorpus([
      "Account manager (NHS) | Sales | 3 2027-Q1\nAccount manager (councils) | Sales | 2 2027-Q2",
    ]);
    const out = checkAnswer(
      "It hires 7 account managers. Timing is by quarter.",
      twoLines,
    );
    expect(out.text).toBe("Timing is by quarter.");
    // Their total stands.
    expect(checkAnswer("It hires 5 account managers.", twoLines).text).toBe(
      "It hires 5 account managers.",
    );
  });

  it("never fails a count the sources do not place: measures, unnamed items, prose without a count", () => {
    const prose = claimCorpus([
      "We plan to hire account managers in 2027 as the framework listings land.",
      "Cash 388,070; net burn 92,340.",
    ]);
    for (const sentence of [
      "It plans 3 account managers.",
      "That is about 4 months of runway.",
      "It hires 2 people in Q1.",
      "There are 3 options here.",
    ]) {
      expect(checkAnswer(sentence, prose).text, sentence).toBe(sentence);
    }
    // A list that is only part of a total is not held to it.
    const withTotal = claimCorpus([
      PLAN_READ,
      "Total hires funded by the round | 15",
    ]);
    const partOf =
      "The plan adds 15 hires in total, including: 6 deployment engineers and 4 product engineers.";
    expect(checkAnswer(partOf, withTotal).text).toBe(partOf);
  });
});
