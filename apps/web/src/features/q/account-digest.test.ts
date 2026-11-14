import { describe, expect, it } from "vitest";

import { QAccountDigestSchema } from "@capital-q/contracts";

import {
  accountDigestWaitingLine,
  createQApiAccountDigestReader,
} from "./account-digest";

const U = (n: number) =>
  `9e8d7c6b-5a4f-4e3d-8c2b-${String(n).padStart(12, "0")}`;

const digest = QAccountDigestSchema.parse({
  side: "INVESTOR",
  relationships: [
    {
      relationshipId: U(1),
      counterpart: { kind: "COMPANY", id: U(2), name: "Tensorgate" },
      stage: "CONNECTED",
      stageSince: "2026-11-09T09:00:00.000Z",
      nextStep: "SCHEDULE_MEETING",
      owed: "YOU_OWE_REPLY",
      lastMessageAt: "2026-11-13T15:00:00.000Z",
    },
  ],
  relationshipsTotal: 1,
  byStage: { CONNECTED: 1 },
  relationshipCounterpartIds: [U(2)],
  waiting: [
    {
      key: "msg:x",
      source: "UNANSWERED_MESSAGE",
      title: "Tensorgate is waiting for your reply",
      since: "2026-11-13T15:00:00.000Z",
      decidable: true,
    },
    {
      key: "approval:y",
      source: "APPROVAL",
      title: "Send the reply",
      since: "2026-11-14T08:00:00.000Z",
      decidable: true,
    },
  ],
  waitingTotal: 2,
  meetings: [
    {
      id: U(3),
      relationshipId: null,
      purpose: "Intro call",
      startsAt: "2026-11-15T09:00:00.000Z",
      timeZone: "Africa/Lagos",
      with: ["Ada Obi"],
      hasBrief: false,
    },
  ],
  work: [],
  requests: [],
  gateq: null,
  recent: [],
  unread: [],
  readAt: "2026-11-14T21:20:00.000Z",
});

describe("the account digest for the resume opening", () => {
  it("says what is waiting, by name, and the next call", () => {
    expect(accountDigestWaitingLine(digest)).toBe(
      "Tensorgate is waiting for your reply; 1 approval is waiting on you; your next call is Intro call with Ada Obi.",
    );
  });

  it("says nothing when nothing waits", () => {
    expect(
      accountDigestWaitingLine({
        ...digest,
        relationships: [],
        waiting: [],
        waitingTotal: 0,
        meetings: [],
      }),
    ).toBeNull();
  });

  it("reads the Q API's digest, and a failure is null, never an empty digest", async () => {
    const ok = createQApiAccountDigestReader(
      { baseUrl: "https://q.example.test", accessToken: "t" },
      () =>
        Promise.resolve(new Response(JSON.stringify(digest), { status: 200 })),
    );
    expect(await ok()).toEqual(digest);
    const failed = createQApiAccountDigestReader(
      { baseUrl: "https://q.example.test", accessToken: "t" },
      () => Promise.resolve(new Response("", { status: 500 })),
    );
    expect(await failed()).toBeNull();
    expect(await createQApiAccountDigestReader(null)()).toBeNull();
  });
});
