import {
  readMeetingOutcomes,
  type MeetingOutcomes,
} from "@capital-q/communication";
import type { DatabaseExecutor } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";
import { describe, expect, it } from "vitest";

import {
  createInCallShareAnnouncer,
  createMeetingDigestWriter,
  createMeetingFollowUps,
  createMeetingOutcomeFiler,
  inCallShareLine,
} from "../src/composition/meeting-after-call.js";

/**
 * After a held meeting (S5-S7, owner 2026-11-18): what each audience
 * receives from Q's post-call reading. Synthetic people only; the database
 * is a fake that answers by query text.
 */

type Query = { readonly text: string; readonly values: readonly unknown[] };

function fakeSql(
  answer: (text: string, values: readonly unknown[]) => unknown[],
) {
  const queries: Query[] = [];
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    queries.push({ text, values });
    return Promise.resolve(answer(text, values));
  };
  Object.assign(sql, { json: (value: unknown) => value });
  return { sql: sql as unknown as DatabaseExecutor, queries };
}

const FOUNDER = "00000000-0000-4000-8000-0000000000f1";
const INVESTOR = "00000000-0000-4000-8000-0000000000a1";
const MEETING = "5b2a0c5e-8f6e-4a39-9c51-0d7c1c1b2f11";
const RELATIONSHIP = "00000000-0000-4000-8000-0000000005e1";

const outcomes: MeetingOutcomes = readMeetingOutcomes({
  meetingId: MEETING,
  parties: [
    { name: "Adaeze Okafor", side: "FOUNDER", userId: FOUNDER },
    { name: "Bayo Ade", side: "INVESTOR", userId: INVESTOR },
  ],
  lines: [
    {
      speaker: "Bayo Ade",
      text: "We will probably put in around two hundred and fifty thousand if diligence checks out.",
    },
    { speaker: "Bayo Ade", text: "We are in for $100k on the first close." },
    {
      speaker: "Bayo Ade",
      text: "Could you send us the cohort retention data and the cap table by Friday?",
    },
    { speaker: "Adaeze Okafor", text: "Yes I will send both by Friday." },
  ],
});

// The investor's own context, resolved by the server from their user id.
const actorFor = (userId: string) =>
  Promise.resolve(
    userId === INVESTOR
      ? ({ tenantId: "t-inv", userId: INVESTOR } as ActorContext)
      : null,
  );

describe("S5: filing the post-call reading", () => {
  it("files money only with an exact amount and a said currency, at the words' level, and the investor's request with its meeting", async () => {
    const detected: unknown[] = [];
    const requested: unknown[] = [];
    const file = createMeetingOutcomeFiler({
      actorFor,
      detect: (input) => {
        detected.push(input);
        return Promise.resolve(true);
      },
      recordRequest: (input) => {
        requested.push({ ...input, actor: input.actor.userId });
        return Promise.resolve({ outcome: "OK" });
      },
    });
    const filed = await file({
      relationshipId: RELATIONSHIP,
      meetingId: MEETING,
      outcomes,
    });
    // "around two hundred and fifty thousand" names no currency: kept on
    // the record for the investor to confirm, never filed with a guess.
    expect(detected).toEqual([
      expect.objectContaining({
        amount: "100000",
        currencyCode: "USD",
        level: "FIRM",
        statedBySide: "INVESTOR",
        quote: "We are in for $100k on the first close.",
        condition: null,
      }),
    ]);
    expect(filed).toBe(1);
    expect(requested).toEqual([
      expect.objectContaining({
        actor: INVESTOR,
        relationshipId: RELATIONSHIP,
        title: "the cohort retention data and the cap table",
        meetingId: MEETING,
        sourceEventId: outcomes.requests[0]?.id,
        dueText: "friday",
      }),
    ]);
  });

  it("files no request a person did not ask, or that the service refuses", async () => {
    const refused = createMeetingOutcomeFiler({
      actorFor,
      detect: () => Promise.resolve(true),
      recordRequest: () => Promise.resolve({ outcome: "REFUSED" }),
    });
    expect(
      await refused({
        relationshipId: RELATIONSHIP,
        meetingId: MEETING,
        outcomes,
      }),
    ).toBe(0);
    // An asker the server cannot resolve: nothing filed in their name.
    const asked: unknown[] = [];
    const unresolved = createMeetingOutcomeFiler({
      actorFor: () => Promise.resolve(null),
      detect: () => Promise.resolve(true),
      recordRequest: (input) => {
        asked.push(input);
        return Promise.resolve({ outcome: "OK" });
      },
    });
    expect(
      await unresolved({
        relationshipId: RELATIONSHIP,
        meetingId: MEETING,
        outcomes,
      }),
    ).toBe(0);
    expect(asked).toEqual([]);
  });
});

describe("S6: the admin digest", () => {
  it("is written once per meeting, with counts and figures only", async () => {
    const { sql, queries } = fakeSql(() => []);
    await createMeetingDigestWriter(sql)({
      meetingId: MEETING,
      relationshipId: RELATIONSHIP,
      heldAt: "2026-11-20T10:00:00.000Z",
      durationSeconds: 115,
      softSignals: 2,
      hardSignals: 0,
      amounts: [{ level: "SOFT", amount: "250000", currencyCode: null }],
      requests: 1,
      requestItems: ["the cohort retention data and the cap table"],
      nextStep: null,
    });
    expect(queries[0]?.text).toContain(
      "insert into platform_ops.meeting_digests",
    );
    expect(queries[0]?.text).toContain("on conflict (meeting_id) do nothing");
  });
});

describe("S6b: a document shared during the call", () => {
  it("is announced once in the call's chat, with a sign-in link, only after its owner shared it", async () => {
    const posted: string[] = [];
    let claimed = false;
    const { sql } = fakeSql((text) => {
      if (text.includes("from communication.meetings m")) {
        return [
          {
            meeting_id: MEETING,
            tenant_id: "t-co",
            bot_id: "bot-1",
            owner_name: "Adaeze Okafor",
            counterpart: "Zino Capital",
            company_id: "00000000-0000-4000-8000-0000000000c1",
          },
        ];
      }
      if (text.includes("'SHARED_IN_CALL'")) {
        if (claimed) return [];
        claimed = true;
        return [{ id: "n-1" }];
      }
      return [];
    });
    const announce = createInCallShareAnnouncer({
      sql,
      bots: {
        sendChat: (_bot, message) => {
          posted.push(message);
          return Promise.resolve();
        },
      },
      webUrl: "https://app.example.test",
    });
    const share = {
      relationshipId: RELATIONSHIP,
      documentTitle: "Cap table",
      sharedByUserId: FOUNDER,
    };
    expect(await announce(share)).toBe(true);
    expect(await announce(share)).toBe(false);
    expect(posted).toEqual([
      'Adaeze Okafor shared "Cap table" with Zino Capital on Capital Q. Sign in to open it: https://app.example.test/relationships/company/00000000-0000-4000-8000-0000000000c1',
    ]);
  });

  it("posts nothing when no call is live, or the chat is not available", async () => {
    const { sql } = fakeSql(() => []);
    const announce = createInCallShareAnnouncer({
      sql,
      bots: { sendChat: () => Promise.reject(new Error("never")) },
      webUrl: "https://app.example.test",
    });
    expect(
      await announce({
        relationshipId: RELATIONSHIP,
        documentTitle: "Cap table",
        sharedByUserId: FOUNDER,
      }),
    ).toBe(false);
    const off = createInCallShareAnnouncer({
      sql,
      bots: undefined,
      webUrl: "https://app.example.test",
    });
    expect(
      await off({
        relationshipId: RELATIONSHIP,
        documentTitle: "Cap table",
        sharedByUserId: FOUNDER,
      }),
    ).toBe(false);
    expect(
      inCallShareLine({
        ownerName: "A",
        documentTitle: "Deck",
        counterpart: "B",
        link: "https://x.test/r",
      }),
    ).toContain("Sign in to open it");
  });
});

describe("S7: the next conversation's opener", () => {
  it("reads only the person's own held meeting not yet opened with, then marks it said", async () => {
    const { sql, queries } = fakeSql((text) => {
      if (text.includes("from communication.meetings m")) {
        return [
          {
            meeting_id: MEETING,
            outcomes,
            side: "FOUNDER",
            counterpart: "Zino Capital",
            company_id: "00000000-0000-4000-8000-0000000000c1",
          },
        ];
      }
      if (text.includes("from evidence.documents d")) {
        return [
          { id: "00000000-0000-4000-8000-00000000d0c1", title: "Cap table" },
        ];
      }
      return [];
    });
    const followUps = createMeetingFollowUps({
      sql,
      now: () => new Date("2026-11-21T09:00:00Z"),
    });
    const actor = { tenantId: "t-co", userId: FOUNDER } as ActorContext;
    const next = await followUps.next(actor);
    expect(next?.meetingId).toBe(MEETING);
    expect(next?.line).toContain(
      "They asked for cohort retention data and the cap table by Friday.",
    );
    // Scoped to them: every query names their user id.
    const read = queries.find((q) =>
      q.text.includes("from communication.meetings m"),
    );
    expect(read?.values).toContain(FOUNDER);
    expect(read?.text).toContain("meeting_follow_up_seen");
    await followUps.seen(actor, MEETING);
    expect(queries.at(-1)?.text).toContain(
      "insert into communication.meeting_follow_up_seen",
    );
  });

  it("opens with nothing when there is no reading", async () => {
    const { sql } = fakeSql(() => []);
    const followUps = createMeetingFollowUps({ sql });
    expect(
      await followUps.next({ tenantId: "t", userId: INVESTOR } as ActorContext),
    ).toBeNull();
  });
});
