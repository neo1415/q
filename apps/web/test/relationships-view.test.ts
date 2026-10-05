import { describe, expect, it } from "vitest";

import type {
  NotificationDto,
  RelationshipSummaryDto,
  ReminderDto,
} from "@capital-q/contracts";

import {
  cursorOf,
  listOrder,
  needsYouCards,
  nextStepFor,
  pageAfter,
  since,
} from "../src/features/relationships/relationships-view";

/**
 * Founder critique 2026-10-04: one obvious next step per relationship, and
 * "Needs you" deduped to one card per relationship and kind, paged by
 * cursor. Pure words and order.
 */

const NOW = Date.parse("2026-10-04T12:00:00.000Z");
const INVESTOR = "11111111-0000-4000-8000-000000000001";

const item = (
  n: number,
  over: Partial<RelationshipSummaryDto> = {},
): RelationshipSummaryDto => ({
  relationshipId: `a0000000-0000-4000-8000-00000000000${String(n)}`,
  counterpart: {
    kind: "INVESTOR_ORGANISATION",
    id: n === 1 ? INVESTOR : `11111111-0000-4000-8000-00000000000${String(n)}`,
    name: `Fund ${String(n)}`,
  },
  state: "CONNECTED",
  stateSince: `2026-10-0${String(n)}T10:00:00.000Z`,
  nextStep: "SCHEDULE_MEETING",
  ...over,
});

const facts = {
  unread: 0,
  followUpDue: false,
  nextCallAt: null,
  lastMessageAt: null,
  diligence: null,
};

const notice = (
  n: number,
  over: Partial<NotificationDto>,
): NotificationDto => ({
  id: `c0000000-0000-4000-8000-00000000000${String(n)}`,
  kind: "MEETING_SCHEDULED",
  title: "New call: check something",
  body: null,
  linkPath: null,
  read: false,
  createdAt: `2026-10-03T0${String(n)}:00:00.000Z`,
  priority: "UPDATE",
  ...over,
});

describe("the one next step", () => {
  it("a founder with an open request is told to upload and share it, first", () => {
    const step = nextStepFor(
      item(1, { state: "IN_DILIGENCE", nextStep: "FOLLOW_UP" }),
      {
        ...facts,
        unread: 2,
        diligence: {
          openRequests: 1,
          firstOpenTitle: "Pitch deck",
          unopenedShares: 0,
        },
      },
      "COMPANY",
      NOW,
      "/relationships/investor/x",
    );
    expect(step).toMatchObject({
      label: "Upload & share",
      href: "/relationships/investor/x/diligence",
      why: "Asked for Pitch deck",
      urgent: true,
    });
  });

  it("an investor with something shared is told to review it", () => {
    expect(
      nextStepFor(
        item(1, { state: "IN_DILIGENCE", nextStep: "NONE" }),
        {
          ...facts,
          diligence: {
            openRequests: 1,
            firstOpenTitle: null,
            unopenedShares: 1,
          },
        },
        "INVESTOR",
        NOW,
        "/r",
      ),
    ).toMatchObject({ label: "Review files", href: "/r/diligence" });
  });

  it("answer, reply, book, wait: in that order", () => {
    expect(
      nextStepFor(
        item(1, { nextStep: "ANSWER_INTEREST" }),
        facts,
        "COMPANY",
        NOW,
        "/r",
      ).label,
    ).toBe("Answer");
    expect(
      nextStepFor(item(1), { ...facts, unread: 1 }, "COMPANY", NOW, "/r"),
    ).toMatchObject({
      label: "Reply",
      href: "/r/messages",
      why: "1 new message",
    });
    expect(nextStepFor(item(1), facts, "COMPANY", NOW, "/r")).toMatchObject({
      label: "Book a call",
      href: "/r#calls",
      urgent: false,
    });
    expect(
      nextStepFor(
        item(1, { nextStep: "AWAIT_ANSWER" }),
        undefined,
        "INVESTOR",
        NOW,
        "/r",
      ),
    ).toMatchObject({ label: null, why: "Waiting on them" });
  });

  it("says the time since briefly", () => {
    expect(since("2026-10-04T10:00:00.000Z", NOW)).toBe("2h");
    expect(since("2026-10-02T12:00:00.000Z", NOW)).toBe("2d");
    expect(since("2026-09-20T12:00:00.000Z", NOW)).toMatch(/20 Sep/);
  });
});

describe("cursor pages", () => {
  it("pages newest first, and a cursor continues exactly after the last row", () => {
    const all = [item(1), item(2), item(3), item(4), item(5)].toSorted(
      listOrder,
    );
    expect(all.map((i) => i.counterpart.name)).toEqual([
      "Fund 5",
      "Fund 4",
      "Fund 3",
      "Fund 2",
      "Fund 1",
    ]);
    const first = pageAfter(all, null, 2);
    expect(first.items.map((i) => i.counterpart.name)).toEqual([
      "Fund 5",
      "Fund 4",
    ]);
    expect(first.next).toBe(cursorOf(all[1] as RelationshipSummaryDto));
    const second = pageAfter(all, first.next, 2);
    expect(second.items.map((i) => i.counterpart.name)).toEqual([
      "Fund 3",
      "Fund 2",
    ]);
    const last = pageAfter(all, second.next, 2);
    expect(last.items.map((i) => i.counterpart.name)).toEqual(["Fund 1"]);
    expect(last.next).toBeNull();
  });
});

describe("Needs you", () => {
  it("folds repeats into one card per relationship and kind, newest first, and skips what was read", () => {
    const reminder: ReminderDto = {
      id: "d0000000-0000-4000-8000-000000000001",
      relationshipId: item(1).relationshipId,
      meetingId: null,
      title: "Chase the term sheet",
      dueAt: "2026-10-04T09:00:00.000Z",
      status: "DELIVERED",
    } as ReminderDto;
    const cards = needsYouCards({
      side: "COMPANY",
      now: NOW,
      items: [item(1)],
      reminders: [reminder],
      notices: [
        notice(1, {}),
        notice(2, {}),
        notice(3, {
          kind: "MEETING_PREP_READY",
          title: "Rehearse your call: intro",
          linkPath: "/rehearsals/meeting/x",
        }),
        notice(4, {
          kind: "MEETING_PREP_READY",
          title: "Rehearse your call: intro",
          linkPath: "/rehearsals/meeting/y",
        }),
        notice(5, {
          kind: "DILIGENCE",
          title: "Fund 1 asked for Pitch deck",
          linkPath: `/relationships/investor/${INVESTOR}/diligence`,
        }),
        notice(6, {
          kind: "DILIGENCE",
          title: "Fund 1 asked for Cap table",
          linkPath: `/relationships/investor/${INVESTOR}/diligence`,
        }),
        notice(7, {
          read: true,
          kind: "Q_SCOUT",
          title: "Q found something new",
        }),
      ],
    });
    expect(cards.map((c) => [c.title, c.count, c.action.label])).toEqual([
      ["Chase the term sheet", 1, "Done"],
      ["Asked for Cap table", 2, "Upload & share"],
      ["Rehearse your call: intro", 2, "Rehearse"],
      ["New call: check something", 2, "Got it"],
    ]);
    expect(cards[1]?.relationship?.counterpart.name).toBe("Fund 1");
    expect(cards[1]?.noticeIds).toHaveLength(2);
  });
});
