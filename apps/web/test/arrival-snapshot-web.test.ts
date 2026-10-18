import { describe, expect, it } from "vitest";

import {
  ArrivalSnapshotSchema,
  relationshipMessagesPath,
  type ArrivalSnapshot,
} from "@capital-q/contracts";

import {
  attentionFromSnapshot,
  createQApiArrivalSnapshotReader,
} from "@/features/briefing/attention";
import { recordPagePath } from "@/features/q/client-actions";
import { isAppRoute } from "@/features/q/control/app-routes";
import {
  arrivedAt,
  routesMatch,
} from "@/features/q/control/navigation-lifecycle";

/**
 * W1: the welcome says what the snapshot says (same headlines, same keys),
 * the snapshot is read from the Q API with failure as null, and "open the
 * conversation" is a real, navigable relationship messages route.
 */

const SESSION = { baseUrl: "https://q.example.test", accessToken: "tok" };
const REL = "7b1c0e55-0000-4000-8000-000000000001";
const INVESTOR = "7b1c0e55-0000-4000-8000-000000000002";
const COMPANY = "7b1c0e55-0000-4000-8000-000000000009";
const NOW = "2026-10-10T09:00:00.000Z";

const EMPTY_FACTS = {
  request: null,
  messageCount: null,
  latestMessage: null,
  theirLatestMessage: null,
  meeting: null,
  decisions: [],
  documents: [],
  openRequests: [],
  relationshipState: null,
  suggestedNextAction: null,
  note: null,
};
const NO_IDS = {
  relationshipId: null,
  companyId: null,
  investorOrganisationId: null,
  meetingId: null,
  approvalId: null,
  jobId: null,
  documentId: null,
  messageId: null,
};

const SNAPSHOT: ArrivalSnapshot = ArrivalSnapshotSchema.parse({
  contractVersion: "arrival-snapshot.v1",
  version: "v1",
  asOf: NOW,
  unread: ["REMINDER"],
  briefsRead: true,
  activity: null,
  items: [
    {
      key: `interest:${REL}`,
      kind: "INTEREST_REQUEST",
      headline: "TensorGate wants to connect and is waiting for your answer",
      availability: "OK",
      counterpart: {
        kind: "INVESTOR_ORGANISATION",
        id: INVESTOR,
        name: "TensorGate",
      },
      ids: { ...NO_IDS, relationshipId: REL, investorOrganisationId: INVESTOR },
      facts: EMPTY_FACTS,
      openPath: relationshipMessagesPath("INVESTOR_ORGANISATION", INVESTOR),
      decidable: true,
      evidence: [],
      sourceVersions: { historySequence: 7, brief: "relationship-brief.v1" },
      since: "2026-10-09T10:00:00.000Z",
      asOf: NOW,
    },
    {
      key: "notice:1",
      kind: "NOTICE",
      headline: "Your profile was viewed",
      availability: "OK",
      counterpart: null,
      ids: NO_IDS,
      facts: { ...EMPTY_FACTS, note: "An investor opened your profile." },
      openPath: null,
      decidable: false,
      evidence: [],
      sourceVersions: { historySequence: null, brief: null },
      since: "2026-10-10T07:00:00.000Z",
      asOf: NOW,
    },
  ],
});

describe("the welcome is the snapshot", () => {
  it("says the same headlines, keys and unread sources", () => {
    const report = attentionFromSnapshot(SNAPSHOT);
    expect(report.items.map((i) => [i.key, i.title])).toEqual(
      SNAPSHOT.items.map((i) => [i.key, i.headline]),
    );
    expect(report.items[0]?.entity).toEqual({ kind: "RELATIONSHIP", id: REL });
    expect(report.items[0]?.counterpart).toBe("TensorGate");
    expect(report.items[1]?.note).toBe("An investor opened your profile.");
    expect(report.unread).toEqual(["REMINDER"]);
  });

  it("is read from the Q API, and a failure is null, never an empty snapshot", async () => {
    const ok = createQApiArrivalSnapshotReader(SESSION, () =>
      Promise.resolve(Response.json(SNAPSHOT)),
    );
    expect((await ok())?.version).toBe("v1");
    const down = createQApiArrivalSnapshotReader(SESSION, () =>
      Promise.resolve(new Response("nope", { status: 503 })),
    );
    expect(await down()).toBeNull();
    const bad = createQApiArrivalSnapshotReader(SESSION, () =>
      Promise.resolve(Response.json({ items: [] })),
    );
    expect(await bad()).toBeNull();
    expect(await createQApiArrivalSnapshotReader(null)()).toBeNull();
  });
});

describe("open the conversation", () => {
  it("the snapshot's path is the page route the app already navigates to", () => {
    expect(relationshipMessagesPath("INVESTOR_ORGANISATION", INVESTOR)).toBe(
      recordPagePath("RELATIONSHIP_INVESTOR_MESSAGES", INVESTOR),
    );
    expect(relationshipMessagesPath("COMPANY", COMPANY)).toBe(
      recordPagePath("RELATIONSHIP_COMPANY_MESSAGES", COMPANY),
    );
  });

  it("is a known app route, and the lifecycle counts arriving there as arrived", () => {
    const path = SNAPSHOT.items[0]?.openPath ?? "";
    expect(isAppRoute(path)).toBe(true);
    expect(routesMatch(path, path)).toBe(true);
    expect(arrivedAt(path, path)).toBe(true);
    expect(arrivedAt(path, "/relationships")).toBe(false);
  });
});
