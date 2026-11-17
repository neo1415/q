import { describe, expect, it } from "vitest";

import type { QNavigateTarget } from "@capital-q/contracts";

import {
  checkAnswer,
  claimCorpus,
  createClaimChecker,
} from "../src/q/claim-check.js";
import { gateByReading } from "../src/q/navigation-decision.js";
import { MANAGEMENT_ACCOUNTS_READ } from "./live-91bb8564-fixture.js";
import {
  D1_QUESTION,
  D1_REPLY,
  D2_FINDINGS,
  D2_QUESTION,
  D2_SHOWN,
  G_DECK_READ,
  G_FIGURES_READ,
  G_QUESTION,
  G_REPLY,
  HIRING_PLAN_READ,
  MONTHLY_ACTUALS_READ,
} from "./live-cdb2dd74e-fixture.js";

/**
 * The full re-run on production cdb2dd74e (17 Nov 2026), replayed from the
 * stored runs (live-cdb2dd74e-fixture.ts). No provider, no network.
 */

const TODAY = new Date("2026-11-17T04:29:44.000Z");

describe("run 82b3f4ac: 'how many of those hires land in the first quarter?'", () => {
  // The run's claim-check line (q-api, 04:29:51): stream {sentences 1,
  // dropped 1}, answer {sentences 2, dropped 1, examined 2, bound 2,
  // contradicted 0}, and "ungrounded claims left out" with kinds ["NAME"]
  // for both. The model's own words are not stored, only what survived:
  // D2_SHOWN. Its sentence is rebuilt from the run's stored FACT finding
  // and the document's title as D1's reply quotes it ("Team and hiring
  // plan"); rebuilt this way, the check reproduces that line exactly --
  // two counts bound to the plan's rows, the sentence lost to a NAME:
  // "Halyard Security Team", the company's name run into the quoted title.
  const sources = [JSON.stringify(HIRING_PLAN_READ), D1_QUESTION, D2_QUESTION];
  const echoes = [D1_REPLY];
  const ANSWERED_QUOTED =
    "The Halyard Security “Team and hiring plan” puts three public-sector account managers and one information security and assurance manager in Q1 2027, four in all.";
  const ANSWERED_TITLED =
    "Halyard Security Hiring Plan puts three public-sector account managers and one information security and assurance manager in Q1 2027.";

  it("the sentence that answers the count is kept, as streamed and as stored", () => {
    for (const sentence of [ANSWERED_QUOTED, ANSWERED_TITLED]) {
      const reply = `${sentence} ${D2_SHOWN}`;
      const checked = checkAnswer(reply, claimCorpus(sources, TODAY, echoes));
      expect(checked.text).toBe(reply);
      expect(checked.ungrounded).toEqual([]);
      expect(checked.stats.counts).toMatchObject({
        examined: 2,
        bound: 2,
        contradicted: 0,
      });
      expect(checked.stats.dropped).toBe(0);

      const stream = createClaimChecker(
        () => sources,
        TODAY,
        () => echoes,
      );
      expect(stream.sentence(sentence).text).toBe(sentence);
      expect(stream.stats().dropped).toBe(0);
    }
  });

  it("the stored FACT finding's own wording is kept too", () => {
    const [fact] = D2_FINDINGS;
    const checked = checkAnswer(
      fact ?? "",
      claimCorpus(sources, TODAY, echoes),
    );
    expect(checked.text).toBe(fact);
  });

  it("an invented name is still left out, even beside counts the rows bind", () => {
    const invented =
      "Northgate Ventures plans three public-sector account managers and one information security and assurance manager in Q1 2027.";
    const checked = checkAnswer(
      `${invented} ${D2_SHOWN}`,
      claimCorpus(sources, TODAY, echoes),
    );
    expect(checked.text).toBe(D2_SHOWN);
    expect(checked.ungrounded).toEqual(["NAME"]);
  });
});

describe("run a4b412eb: a monthly burn and runway said to cover 12 months", () => {
  // Claim check {contradicted 1, corrected 0} -- the contradiction was a
  // count (that sentence was dropped); the period was never checked. The
  // management accounts give the burn and runway for October 2026 alone
  // ("Summary for October 2026"); only the 29.3% gross margin is for the
  // 12 months to October 2026.
  const sources = [
    JSON.stringify(MANAGEMENT_ACCOUNTS_READ),
    JSON.stringify(MONTHLY_ACTUALS_READ),
    JSON.stringify(G_DECK_READ),
    JSON.stringify(G_FIGURES_READ),
    G_QUESTION,
  ];
  const corpus = () => claimCorpus(sources, TODAY);
  const WRONG = "for the 12 months to October 2026";

  it("the stored answer: the 12-month period is taken off figures it mixes; every figure stays", () => {
    const checked = checkAnswer(G_REPLY, corpus());
    expect(G_REPLY.split(WRONG)).toHaveLength(3);
    expect(checked.text).not.toContain(WRONG);
    expect(checked.text).toContain(
      "Your management accounts are documented as showing 29.3% gross margin, £92,340 net burn and 4.2 months of runway. The deck shows",
    );
    expect(checked.text).toContain(
      "the management-account figures themselves: 29.3% gross margin, £92,340 net burn and 4.2 months of runway, plus the separate 82.0% licence gross-margin calculation",
    );
    // (Sentences grounded on the run's retrieved passages, which are not
    // stored, may fall here; the two period sentences are the point.)
    expect(checked.stats.counts.corrected).toBe(2);
  });

  it("put right where every figure it covers is one month in the accounts", () => {
    const checked = checkAnswer(
      "The accounts show £92,340 net burn and 4.2 months of runway for the 12 months to October 2026.",
      corpus(),
    );
    expect(checked.text).toBe(
      "The accounts show £92,340 net burn and 4.2 months of runway for October 2026.",
    );
  });

  it("a period the accounts do give the figure is kept as written", () => {
    const right =
      "The accounts show 29.3% gross margin for the 12 months to October 2026.";
    expect(checkAnswer(right, corpus()).text).toBe(right);
  });
});

describe("runs 48402c75 and e7191400: no unasked 'is ready to open' above a figures answer", () => {
  // q-api "q page move decided": reading CONTEXT (nobody asked to go), the
  // decision's samples split (one STAY, one OFFER), so an OFFER of the
  // diligence tab, published first as its own message: "The relationship
  // is ready to open." / "The company profile is ready to open."
  const TENSORGATE = "bf55d6e1-567a-470b-954d-054ae05990e2";
  const offerOf = (target: QNavigateTarget) => ({
    decision: "OFFER" as const,
    target,
    openPane: false,
    remembered: null,
    guard: "SPLIT_VOTE" as const,
  });
  const RELATIONSHIP = offerOf({
    page: "RELATIONSHIP_COMPANY",
    recordId: TENSORGATE,
    tab: "diligence",
  });
  const PROFILE = offerOf({
    page: "COMPANY",
    recordId: TENSORGATE,
    tab: "diligence",
  });
  const nav = (mode: "GO" | "CONTEXT" | "OFFER_ONLY") => ({
    mode,
    negated: false,
  });
  const held = {
    decision: "STAY",
    target: null,
    openPane: false,
    remembered: null,
    guard: "ANSWERED_IN_PLACE",
  };

  it("a question answered in the reply: the voted offer is held", () => {
    expect(
      gateByReading(RELATIONSHIP, nav("CONTEXT"), { question: true }),
    ).toEqual(held);
    expect(
      gateByReading(PROFILE, nav("CONTEXT"), {
        question: true,
        followUp: true,
      }),
    ).toEqual(held);
  });

  it("asked to open it, an offer reading, or not a question: it stands", () => {
    expect(gateByReading(PROFILE, nav("GO"), { question: true })).toEqual(
      PROFILE,
    );
    expect(
      gateByReading(PROFILE, nav("OFFER_ONLY"), { question: true }),
    ).toEqual(PROFILE);
    expect(gateByReading(PROFILE, nav("CONTEXT"))).toEqual(PROFILE);
  });

  it("a contextual move, and an offer standing in for a move the pane could not take, stand", () => {
    const move = { ...PROFILE, decision: "MOVE" as const, guard: null };
    expect(gateByReading(move, nav("CONTEXT"), { question: true })).toEqual(
      move,
    );
    const busy = { ...PROFILE, guard: "UNSAVED_WORK" as const };
    expect(gateByReading(busy, nav("CONTEXT"), { question: true })).toEqual(
      busy,
    );
  });
});
