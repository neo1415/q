import { describe, expect, it } from "vitest";

import { QWorkSuggestionDtoSchema } from "@capital-q/contracts";

import {
  composeSuggestions,
  decodeCursor,
  encodeCursor,
  type SuggestionFacts,
} from "../src/composition/work/page.js";
import {
  delegationRun,
  latestLaneStep,
} from "../src/composition/work/actions.js";

/** WORK-58: what Q suggests on Work, composed by code, never a model. */

const NOW = new Date("2026-10-04T12:00:00Z");
const daysAgo = (days: number) =>
  new Date(NOW.getTime() - days * 86_400_000).toISOString();

const rel = (
  index: number,
  nextStep: string,
  age: number,
): SuggestionFacts["relationships"][number] => ({
  relationshipId: `00000000-0000-4000-8000-00000000000${String(index)}`,
  counterpartKind: "COMPANY",
  counterpartId: `10000000-0000-4000-8000-00000000000${String(index)}`,
  name: `Company ${String(index)}`,
  nextStep,
  stateSince: daysAgo(age),
});

const empty: SuggestionFacts = {
  relationships: [],
  feedUncontacted: 0,
  savedNoInterest: [],
  callsEnded: [],
  deckUnshared: false,
  mandateGaps: [],
  busy: new Set(),
  outreachRunning: false,
  dismissed: new Set(),
};

describe("Q suggests (WORK-58)", () => {
  it("ranks by kind, the oldest wait first, one per kind before a second, at most five", () => {
    const out = composeSuggestions(
      {
        ...empty,
        relationships: [
          rel(1, "AWAIT_ANSWER", 4),
          rel(2, "AWAIT_ANSWER", 9),
          rel(3, "AWAIT_ANSWER", 6),
          rel(4, "ANSWER_INTEREST", 2),
        ],
        feedUncontacted: 3,
        savedNoInterest: [
          { companyId: "20000000-0000-4000-8000-000000000001", name: "Ajopot" },
        ],
        mandateGaps: ["cheque size", "stage"],
      },
      NOW,
    );
    for (const item of out) QWorkSuggestionDtoSchema.parse(item);
    expect(out.map((item) => [item.kind, item.lead])).toEqual([
      ["CONNECT_WAITING", 2],
      ["STALLED_REPLY", 9],
      ["NEW_MATCHES", 3],
      ["SAVED_NO_INTEREST", 1],
      ["MANDATE_GAPS", 2],
    ]);
    expect(out[1]?.subject).toBe("Company 2 hasn’t replied");
    expect(out[1]?.question).toBe("Follow up?");
    expect(out[1]?.linkPath).toBe(
      "/relationships/company/10000000-0000-4000-8000-000000000002",
    );
  });

  it("waits the nudge age before calling a reply stalled", () => {
    expect(
      composeSuggestions(
        { ...empty, relationships: [rel(1, "AWAIT_ANSWER", 2)] },
        NOW,
      ),
    ).toEqual([]);
  });

  it("skips what is pending, running or set aside", () => {
    const one = rel(1, "AWAIT_ANSWER", 6);
    const two = rel(2, "AWAIT_ANSWER", 6);
    const three = rel(3, "AWAIT_ANSWER", 6);
    const out = composeSuggestions(
      {
        ...empty,
        relationships: [one, two, three],
        busy: new Set([one.relationshipId, two.counterpartId]),
        dismissed: new Set([`stalled_reply:${three.relationshipId}`]),
        feedUncontacted: 4,
        outreachRunning: true,
      },
      NOW,
    );
    expect(out).toEqual([]);
  });

  it("a founder's deck not shared and a call that just ended", () => {
    const one = rel(1, "NONE", 0);
    const out = composeSuggestions(
      {
        ...empty,
        relationships: [{ ...one, counterpartKind: "INVESTOR_ORGANISATION" }],
        callsEnded: [
          {
            meetingId: "30000000-0000-4000-8000-000000000001",
            relationshipId: one.relationshipId,
            endedAt: daysAgo(1),
            followedUp: false,
          },
        ],
        deckUnshared: true,
      },
      NOW,
    );
    expect(out.map((item) => item.kind)).toEqual([
      "CALL_RECAP",
      "DECK_UNSHARED",
    ]);
    expect(out[0]?.subject).toBe("Company 1 call ended yesterday");
    expect(out[0]?.linkPath).toBe(
      `/relationships/investor/${one.counterpartId}`,
    );
  });

  describe("call recaps: one card per counterpart, never repeated", () => {
    const one = rel(1, "NONE", 0);
    const two = rel(2, "NONE", 0);
    const m = (n: number) => `30000000-0000-4000-8000-00000000000${String(n)}`;
    const call = (
      meeting: number,
      item: typeof one,
      age: number,
      followedUp = false,
    ): SuggestionFacts["callsEnded"][number] => ({
      meetingId: m(meeting),
      relationshipId: item.relationshipId,
      endedAt: daysAgo(age),
      followedUp,
    });
    const recaps = (facts: Partial<SuggestionFacts>) =>
      composeSuggestions(
        { ...empty, relationships: [one, two], ...facts },
        NOW,
      ).filter((item) => item.kind === "CALL_RECAP");

    it("the same meeting read twice is one card (the four-card bug)", () => {
      const out = recaps({
        callsEnded: [call(1, one, 0), call(1, one, 0)],
      });
      expect(out).toHaveLength(1);
      expect(out[0]?.subject).toBe("Company 1 call ended today");
      expect(out[0]?.question).toBe("Send the recap?");
      expect(QWorkSuggestionDtoSchema.safeParse(out[0]).success).toBe(true);
    });

    it("several calls with the same side are grouped into one card", () => {
      const out = recaps({
        callsEnded: [
          call(1, one, 0),
          call(1, one, 0),
          call(2, one, 2),
          call(2, one, 2),
          call(3, two, 1),
        ],
      });
      expect(out).toHaveLength(2);
      const grouped = out.find((item) => item.subject.includes("Company 1"));
      expect(grouped?.subject).toBe("2 calls with Company 1");
      expect(grouped?.question).toBe("Send recaps?");
      expect(grouped?.lead).toBe(2);
      expect(grouped?.unit).toBe("calls");
      expect(new Set(out.map((item) => item.key)).size).toBe(2);
      for (const item of out) {
        expect(QWorkSuggestionDtoSchema.safeParse(item).success).toBe(true);
      }
    });

    it("never for a call already followed up (recap sent or cards proposed)", () => {
      expect(recaps({ callsEnded: [call(1, one, 0, true)] })).toEqual([]);
      const out = recaps({
        callsEnded: [call(1, one, 0, true), call(2, one, 2)],
      });
      expect(out).toHaveLength(1);
      expect(out[0]?.subject).toBe("Company 1 call ended 2 days ago");
    });

    it("never while that side is already in a pending card", () => {
      expect(
        recaps({
          callsEnded: [call(1, one, 0)],
          busy: new Set([one.relationshipId]),
        }),
      ).toEqual([]);
    });

    it("Not now covers every call that had ended; a newer call asks again", () => {
      const first = recaps({ callsEnded: [call(1, one, 2), call(2, one, 1)] });
      const key = first[0]?.key ?? "";
      expect(key).toMatch(/^call_recap:/u);
      expect(
        recaps({
          callsEnded: [call(1, one, 2), call(2, one, 1)],
          dismissed: new Set([key]),
        }),
      ).toEqual([]);
      const later = recaps({
        callsEnded: [call(1, one, 2), call(2, one, 1), call(3, one, 0)],
        dismissed: new Set([key]),
      });
      expect(later).toHaveLength(1);
      expect(later[0]?.subject).toBe("Company 1 call ended today");
    });

    it("an older per-meeting dismissal still holds", () => {
      expect(
        recaps({
          callsEnded: [call(1, one, 0)],
          dismissed: new Set([`call_recap:${m(1)}`]),
        }),
      ).toEqual([]);
    });
  });

  it("a cursor round-trips and anything malformed is the first page", () => {
    const at = new Date("2026-10-01T10:00:00.000Z");
    const id = "40000000-0000-4000-8000-000000000001";
    expect(decodeCursor(encodeCursor(at, id))).toEqual({ at, id });
    expect(decodeCursor("garbage")).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
  });
});

describe("Running fields for delegated work (WORK-58)", () => {
  const lane = (stage: string, updatedAt: string, lastStep: string | null) =>
    ({
      id: "50000000-0000-4000-8000-000000000001",
      counterpartName: "Clinicrest",
      stage,
      lastStep,
      reasons: [],
      offered: [],
      report: null,
      chatPath: null,
      updatedAt,
    }) as Parameters<typeof delegationRun>[1][number];

  it("is WAITING while every open founder waits, WORKING otherwise, nothing once ended", () => {
    expect(
      delegationRun("ACTIVE", [lane("WAITING_ACCEPTANCE", daysAgo(1), null)]),
    ).toEqual({ state: "WAITING", pauseReason: null });
    expect(
      delegationRun("ACTIVE", [
        lane("WAITING_ACCEPTANCE", daysAgo(1), null),
        lane("CHATTING", daysAgo(1), null),
      ]),
    ).toEqual({ state: "WORKING", pauseReason: null });
    expect(delegationRun("DONE", [])).toBeNull();
  });

  it("names the latest lane step", () => {
    expect(
      latestLaneStep([
        lane("CHATTING", daysAgo(2), "Said hello"),
        lane("CHATTING", daysAgo(1), "Asked about the pilot"),
      ])?.words,
    ).toBe("Clinicrest: Asked about the pilot");
  });
});
