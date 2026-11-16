import type {
  AccountDigestRelationship,
  QAccountDigest,
} from "@capital-q/contracts";
import { describe, expect, it } from "vitest";

import {
  connectedAlready,
  inSecondPerson,
  stageContradictions,
  withReferenceLead,
  withRelationshipStagesChecked,
} from "../src/q/answer-continuity.js";

/**
 * RC4 (voice and conversation audit, 15 Nov 2026): replays of the owner's
 * live turns (investor-turns.jsonl, founder-turns.jsonl) against the code
 * checks at the answer's store point.
 */
const NIXO = "4a4a4a4a-4a4a-44a4-84a4-4a4a4a4a4a4a";
const TENSORGATE = "5b5b5b5b-5b5b-45b5-85b5-5b5b5b5b5b5b";

function row(
  id: string,
  name: string,
  stage: AccountDigestRelationship["stage"],
): AccountDigestRelationship {
  return {
    relationshipId: `${id.slice(0, 8)}-0000-4000-8000-000000000000`,
    counterpart: { kind: "COMPANY", id, name },
    stage,
    stageSince: "2026-11-03T10:00:00Z",
    nextStep: "FOLLOW_UP",
    owed: null,
    lastMessageAt: null,
  };
}

function digest(rows: readonly AccountDigestRelationship[]): QAccountDigest {
  return {
    side: "INVESTOR",
    relationships: [...rows],
    relationshipsTotal: rows.length,
    byStage: {},
    relationshipCounterpartIds: rows.map((one) => one.counterpart.id),
    waiting: [],
    waitingTotal: 0,
    meetings: [],
    work: [],
    requests: [],
    gateq: null,
    recent: [],
    unread: [],
    readAt: "2026-11-15T10:00:00Z",
  };
}

const owner = digest([
  row(NIXO, "Nixo", "INVESTED"),
  row(TENSORGATE, "Tensorgate", "CONNECTED"),
]);

describe("a relationship stage is the projection's (RC4)", () => {
  it("t-55d45f25-11-09_14-53-008: 'not connected yet' about invested Nixo is replaced by the stage on record", () => {
    const said =
      "Nixo is the more urgent reply. You're not connected with Nixo yet, so I've prepared an expression of interest. Tensorgate can wait a day.";
    const checked = withRelationshipStagesChecked(said, owner);
    expect(checked.corrected).toEqual(["Nixo"]);
    expect(checked.content).not.toMatch(/not connected/iu);
    expect(checked.content).toContain(
      "From your records: Nixo is invested since 3 Nov.",
    );
    expect(checked.content).toContain("Tensorgate can wait a day.");
  });

  it("15 Nov run a3bbe2e4: 'hasn't accepted' about a connected relationship is corrected", () => {
    const found = stageContradictions(
      "Tensorgate hasn't accepted your interest yet.",
      owner,
    );
    expect(found.map((one) => one.row.counterpart.name)).toEqual([
      "Tensorgate",
    ]);
  });

  it("a stage that matches the projection, or a sentence naming two counterparts, is left alone", () => {
    const fine =
      "You're connected with Tensorgate. Nixo and Tensorgate are not connected to each other.";
    expect(withRelationshipStagesChecked(fine, owner).content).toBe(fine);
    expect(withRelationshipStagesChecked(fine, null).corrected).toEqual([]);
  });

  it("live recheck 651a3bd50 T4: 'not yet as a pipeline relationship' about Ajopot in diligence is replaced", () => {
    const AJOPOT = "6c6c6c6c-6c6c-46c6-86c6-6c6c6c6c6c6c";
    const savanna = digest([
      {
        ...row(AJOPOT, "Ajopot", "IN_DILIGENCE"),
        stageSince: "2026-10-03T09:00:00Z",
      },
      row(TENSORGATE, "Tensorgate", "CONNECTED"),
    ]);
    const asked = "Do I already have Ajopot in my pipeline?";
    const said =
      "Yes—but only as a diligence item, not yet as a pipeline relationship. Its revenue is company-stated.";
    const checked = withRelationshipStagesChecked(said, savanna, asked);
    expect(checked.corrected).toEqual(["Ajopot"]);
    expect(checked.content).not.toMatch(/not yet as a pipeline/iu);
    expect(checked.content).toContain(
      "From your records: Ajopot is in your pipeline, in diligence since 3 Oct.",
    );
    expect(checked.content).toContain("Its revenue is company-stated.");
    // Named in the sentence itself, in any stage from interest expressed on.
    for (const stage of [
      "INTEREST_EXPRESSED",
      "CONNECTED",
      "MEETING_HELD",
      "INVESTED",
    ] as const) {
      expect(
        stageContradictions(
          "Ajopot isn't in your pipeline yet.",
          digest([row(AJOPOT, "Ajopot", stage)]),
        ),
      ).toHaveLength(1);
    }
    // True of a passed relationship, and of a sentence naming no one when
    // the question did not name exactly one counterpart.
    expect(
      stageContradictions(
        "Ajopot isn't in your pipeline.",
        digest([row(AJOPOT, "Ajopot", "PASSED")]),
      ),
    ).toEqual([]);
    expect(
      stageContradictions(said, savanna, "Is anything in my pipeline?"),
    ).toEqual([]);
  });

  it("a first contact is never prepared for a counterpart already connected", () => {
    expect(connectedAlready(owner, { company: "Nixo" })?.stage).toBe(
      "INVESTED",
    );
    expect(connectedAlready(owner, { companyId: TENSORGATE })?.stage).toBe(
      "CONNECTED",
    );
    expect(connectedAlready(owner, { company: "KUUZA AI" })).toBeNull();
    expect(
      connectedAlready(digest([row(NIXO, "Nixo", "INTEREST_EXPRESSED")]), {
        company: "Nixo",
      }),
    ).toBeNull();
  });
});

describe("a place they pointed at is said with its list (RC4, F7-20)", () => {
  const lead = {
    line: 'By the first one I mean Chidi Nwosu Angel Investments, first in the last list I showed you ("Strongest opportunities"). In the earlier list ("Investors to talk to first"), the first was Zino Aviation; tell me if you meant that one.',
    name: "Chidi Nwosu Angel Investments",
    always: true,
  };

  it("opens the answer when another list had a different record at that place", () => {
    const answer =
      "Yes—the same concern applies to Chidi Nwosu Angel Investments: the available profile is too limited.";
    expect(withReferenceLead(answer, lead)).toBe(`${lead.line}\n\n${answer}`);
  });

  it("an unambiguous place already named in the answer adds nothing", () => {
    const answer = "Chidi Nwosu Angel Investments has a limited profile.";
    expect(withReferenceLead(answer, { ...lead, always: false })).toBe(answer);
    expect(withReferenceLead(answer, undefined)).toBe(answer);
  });
});

describe("Q speaks to the person, never about them (RC4, investor 7 Nov run e8267645)", () => {
  it("third-person internal wording is said in the second person", () => {
    expect(
      inSecondPerson(
        "The Tensorgate rehearsal page is being opened on the person's screen.",
      ),
    ).toBe("The Tensorgate rehearsal page is being opened on your screen.");
    expect(
      inSecondPerson("The user had been discussing Spheros. Here it is."),
    ).toBe("You had been discussing Spheros. Here it is.");
  });

  it("'the user' about someone else's product is left alone", () => {
    const said = "Spheros charges the user per seat.";
    expect(inSecondPerson(said)).toBe(said);
  });
});
