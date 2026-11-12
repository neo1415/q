// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { QScheduleBlock } from "@capital-q/contracts";

import { ScheduleBody } from "../src/features/q/blocks/schedule-block";
import {
  ownRelationshipHref,
  relationshipCallsLink,
} from "../src/features/relationships/relationship-href";

/**
 * C4 (13 Nov): every control Q shows does what it says. The schedule card's
 * "Open the prep brief" went to the Relationships hub, losing the call.
 */
const REL = "1b4c2d6e-0f3a-4c5b-9d8e-7a6b5c4d3e2f";
const COMPANY = "2c5d3e7f-1a4b-4d6c-8e9f-8b7c6d5e4f3a";
const own = [
  {
    relationshipId: REL,
    counterpart: { kind: "COMPANY" as const, id: COMPANY },
  },
];

afterEach(cleanup);

describe("one relationship by id", () => {
  it("opens that relationship's calls, from the person's own list", () => {
    expect(ownRelationshipHref({ relationship: REL, open: "calls" }, own)).toBe(
      `/relationships/company/${COMPANY}/calls`,
    );
    expect(ownRelationshipHref({ relationship: REL }, own)).toBe(
      `/relationships/company/${COMPANY}`,
    );
  });

  it("an id that is not theirs, malformed or unread opens the hub", () => {
    expect(
      ownRelationshipHref(
        { relationship: "9e9e9e9e-9e9e-4e9e-8e9e-9e9e9e9e9e9e" },
        own,
      ),
    ).toBeNull();
    expect(ownRelationshipHref({ relationship: "../admin" }, own)).toBeNull();
    expect(ownRelationshipHref({ relationship: REL }, undefined)).toBeNull();
    expect(ownRelationshipHref({}, own)).toBeNull();
  });

  it("the schedule card's prep brief links to that call's relationship", () => {
    const block = {
      kind: "SCHEDULE",
      title: "Your day",
      span: "TODAY",
      timeZone: "Africa/Lagos",
      calls: [
        {
          meetingId: "m1",
          relationshipId: REL,
          purpose: "Intro call",
          startsAt: "2026-11-13T10:00:00.000Z",
          with: ["Ada"],
          organisedByYou: true,
          briefReady: true,
        },
      ],
      reminders: [],
      approvals: [],
    } as unknown as QScheduleBlock;
    const { container } = render(<ScheduleBody block={block} />);
    expect(
      container
        .querySelector('[data-q-schedule-brief="m1"]')
        ?.getAttribute("href"),
    ).toBe(relationshipCallsLink(REL));
  });
});
