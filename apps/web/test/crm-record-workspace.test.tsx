// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { InterestDto, QWorkDto } from "@capital-q/contracts";

import {
  fitState,
  interestWords,
  recordWork,
} from "@/features/relationships/record-workspace";
import {
  FitAndInterest,
  recordWorkSlot,
} from "@/features/relationships/record-workspace-sections";

afterEach(cleanup);

const COMPANY = "c0000000-0000-4000-8000-000000000001";
const OTHER = "c0000000-0000-4000-8000-000000000002";

function lane(
  id: string,
  counterpartId: string,
  extra: Partial<QWorkDto["lanes"][number]> = {},
): QWorkDto["lanes"][number] {
  return {
    id,
    // The same name on purpose: the join is by id, never by name.
    counterpartName: "Acme",
    counterpart: { kind: "COMPANY", id: counterpartId, photoUrl: null },
    stage: "CHATTING",
    lastStep: null,
    reasons: [],
    offered: [],
    report: null,
    chatPath: null,
    updatedAt: "2026-10-10T09:00:00.000Z",
    ...extra,
  };
}

function work(
  id: string,
  lanes: QWorkDto["lanes"],
  goal: string | null = null,
): QWorkDto {
  return {
    id,
    kind: "INVESTOR_OUTREACH",
    status: "ACTIVE",
    summary: null,
    createdAt: "2026-10-01T09:00:00.000Z",
    expiresAt: "2026-11-01T09:00:00.000Z",
    lanes,
    goal,
    run: null,
    lastStep: null,
    spend: null,
    delegation: null,
  };
}

const day = (iso: string) => iso.slice(0, 10);

describe("record Q Work", () => {
  it("joins Q's lanes to the record by canonical id only, newest first", () => {
    const rows = recordWork(
      [
        work("a0000000-0000-4000-8000-00000000000a", [
          lane("b0000000-0000-4000-8000-000000000001", COMPANY),
          lane("b0000000-0000-4000-8000-000000000002", OTHER),
        ]),
        work(
          "a0000000-0000-4000-8000-00000000000b",
          [
            lane("b0000000-0000-4000-8000-000000000003", COMPANY, {
              stage: "REPORT_READY",
              updatedAt: "2026-10-12T09:00:00.000Z",
              report: { headline: "Strong team", recommendation: "MAYBE" },
            }),
          ],
          "Seed fintech in Lagos",
        ),
      ],
      COMPANY,
    );
    expect(rows.map((row) => row.key)).toEqual([
      "a0000000-0000-4000-8000-00000000000b:b0000000-0000-4000-8000-000000000003",
      "a0000000-0000-4000-8000-00000000000a:b0000000-0000-4000-8000-000000000001",
    ]);
    expect(rows[0]).toMatchObject({
      title: "Seed fintech in Lagos",
      stage: "Report ready",
      href: "/work/a0000000-0000-4000-8000-00000000000b",
      report: {
        verdict: "Q is unsure",
        href: "/work/a0000000-0000-4000-8000-00000000000b/report/b0000000-0000-4000-8000-000000000003",
      },
    });
    expect(rows[1]?.title).toBe("Outreach");
  });

  it("ignores a lane with no counterpart id rather than matching its name", () => {
    expect(
      recordWork(
        [
          work("a0000000-0000-4000-8000-00000000000a", [
            lane("b0000000-0000-4000-8000-000000000001", COMPANY, {
              counterpart: null,
            }),
          ]),
        ],
        COMPANY,
      ),
    ).toEqual([]);
  });

  it("shows no section for no work, and says an unreadable read plainly", () => {
    expect(recordWorkSlot({ kind: "READ", value: [] })).toBeNull();
    render(<>{recordWorkSlot({ kind: "UNAVAILABLE" })}</>);
    expect(screen.getByText(/couldn't be read right now/)).toBeDefined();
  });
});

describe("fit and interest stay separate", () => {
  const interest = (extra: Partial<InterestDto> = {}): InterestDto => ({
    interestId: "d0000000-0000-4000-8000-000000000001",
    relationshipId: "e0000000-0000-4000-8000-000000000001",
    companyId: COMPANY,
    status: "EXPRESSED",
    expressedAt: "2026-10-03T10:00:00.000Z",
    response: "PENDING",
    respondedAt: null,
    connection: null,
    ...extra,
  });

  it("words the investor's own interest without inferring it", () => {
    expect(interestWords({ kind: "READ", value: null }, day)).toBe(
      "Not expressed",
    );
    expect(interestWords({ kind: "UNAVAILABLE" }, day)).toBe(
      "Couldn't be read right now",
    );
    expect(interestWords({ kind: "READ", value: interest() }, day)).toBe(
      "Expressed 2026-10-03 · awaiting their answer",
    );
    expect(
      interestWords(
        { kind: "READ", value: interest({ response: "ACCEPTED" }) },
        day,
      ),
    ).toBe("Expressed 2026-10-03 · they accepted");
    expect(
      interestWords(
        { kind: "READ", value: interest({ status: "WITHDRAWN" }) },
        day,
      ),
    ).toBe("Withdrawn");
  });

  it("keeps an unreadable fit distinct from fit not set up", () => {
    expect(fitState({ kind: "UNAVAILABLE" })).toBe("UNAVAILABLE");
    expect(fitState({ kind: "READ", value: null })).toBe("NOT_SET_UP");
  });

  it("renders both statements, with no number invented for either", () => {
    render(
      <FitAndInterest
        fit={{ kind: "UNAVAILABLE" }}
        interest={{ kind: "READ", value: null }}
      />,
    );
    expect(screen.getByText("Fit with your mandate")).toBeDefined();
    expect(screen.getByText("Your interest")).toBeDefined();
    expect(screen.getByText("Not expressed")).toBeDefined();
    expect(screen.getByText("Couldn't be read right now")).toBeDefined();
    expect(document.body.textContent).not.toMatch(/\d+\s?%/);
  });

  it("says fit is not set up rather than showing a weak fit", () => {
    render(
      <FitAndInterest
        fit={{ kind: "READ", value: null }}
        interest={{ kind: "UNAVAILABLE" }}
      />,
    );
    expect(screen.getByText("Fit not set up")).toBeDefined();
  });
});
