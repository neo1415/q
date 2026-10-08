import { describe, expect, it } from "vitest";

import type {
  DiscoveredCompanyDto,
  FitProfileDto,
  NotificationDto,
} from "@capital-q/contracts";

import {
  activityLines,
  arrivalWords,
  type ArrivalData,
} from "../src/features/briefing/arrival";
import {
  attentionFromReads,
  sourceOfNotice,
  unreadWords,
} from "../src/features/briefing/attention";
import { warmGreeting } from "../src/features/briefing/greeting";
import {
  FIT_IS_NOT_QUALITY,
  matchOpinion,
  matchesWords,
  newMatchesFor,
} from "../src/features/briefing/matches";
import {
  revealedGroups,
  stageFocusFor,
} from "../src/features/briefing/stage-focus";
import { welcomeNow } from "../src/features/q/q-conversation";

/**
 * RECOVERY-2026-10 E2 (Zino, 2026-10-08): greet casually, say what Q did,
 * everything that needs them (and what could not be checked), and for an
 * investor every new matching company with a take that is fit, never
 * quality. Pure rules, so each one is asserted here.
 */

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const AFTERNOON = new Date("2026-10-08T13:30:00Z");

const BASE: ArrivalData = {
  firstName: "Zino",
  timeZone: "Europe/London",
  activity: {},
  hoursAway: 5,
  cards: [],
};

function notice(
  kind: NotificationDto["kind"],
  title: string,
  n: number,
): NotificationDto {
  return {
    id: uuid(n),
    kind,
    title,
    body: null,
    linkPath: null,
    read: false,
    createdAt: "2026-10-08T08:00:00Z",
    priority: "NEEDS_YOU",
  };
}

describe("the greeting is casual and glad to see them", () => {
  it("adds a warm line by day, a 'been a while' after days away, nothing extra late", () => {
    const base = {
      firstName: "Zino",
      timeZone: "Europe/London",
      hoursAway: 5,
      seed: 0,
    };
    expect(warmGreeting({ ...base, now: AFTERNOON })).toBe(
      "Good afternoon, Zino. Good to see you.",
    );
    expect(warmGreeting({ ...base, now: AFTERNOON, hoursAway: 80 })).toBe(
      "Good afternoon, Zino. It's been a few days. Good to see you.",
    );
    expect(
      warmGreeting({ ...base, now: new Date("2026-10-08T23:30:00Z") }),
    ).toBe("Hi Zino, you're up late.");
  });
});

describe("what needs them, unknown never empty", () => {
  it("maps notices to sources, and a failed read to unread", () => {
    expect(sourceOfNotice("CHAT_MESSAGE")).toBe("UNANSWERED_MESSAGE");
    expect(sourceOfNotice("DILIGENCE")).toBe("DOCUMENT_REQUEST");
    expect(sourceOfNotice("INTEREST_RECEIVED")).toBe("INTEREST_REQUEST");
    expect(sourceOfNotice("COMMITMENT")).toBe("NOTICE");
    const report = attentionFromReads({
      cards: [],
      notices: null,
      jobs: null,
      newMatches: null,
      since: "2026-10-08T00:00:00Z",
      now: AFTERNOON,
    });
    expect(report.items).toEqual([]);
    expect(report.unread).toEqual(
      expect.arrayContaining([
        "UNANSWERED_MESSAGE",
        "DOCUMENT_REQUEST",
        "AGENT_BLOCKED",
        "NEW_MATCHES",
      ]),
    );
    expect(report.unread).not.toContain("APPROVAL");
  });

  it("never says 'nothing needs you' when a source could not be read", () => {
    const attention = attentionFromReads({
      cards: [],
      notices: null,
      jobs: [],
      since: "2026-10-08T00:00:00Z",
      now: AFTERNOON,
    });
    const words = arrivalWords({ ...BASE, attention }, AFTERNOON, null);
    expect(words.spoken).not.toMatch(/nothing needs you/u);
    expect(words.lowdown).toMatch(
      /^Quiet on what I could check\. I couldn't check your messages and requests/u,
    );
    expect(words.quiet).toBe(false);
    expect(unreadWords([])).toBeNull();
  });

  it("names the unanswered message and the document request", () => {
    const attention = attentionFromReads({
      cards: [],
      notices: [
        notice("CHAT_MESSAGE", "Zino Aviation is waiting for your reply", 1),
        notice("DILIGENCE", "Apex asked for your cap table", 2),
      ],
      jobs: [],
      since: "2026-10-08T00:00:00Z",
      now: AFTERNOON,
    });
    expect(attention.items.map((item) => item.source)).toEqual([
      "UNANSWERED_MESSAGE",
      "DOCUMENT_REQUEST",
    ]);
    expect(attention.unread).toEqual([]);
  });
});

describe("what Q did", () => {
  it("is a line per kind of work, and says when it could not be read", () => {
    expect(
      activityLines(
        {
          sent: { n: 2, names: ["Halyard", "Apex"] },
          booked: { n: 1, names: ["Northwind"] },
          interest: { n: 4, names: ["A", "B"] },
        },
        { n: 1, names: ["Research five fintech investors."] },
      ),
    ).toEqual([
      "Replied to Halyard and Apex",
      "Booked your call with Northwind",
      "Expressed interest in 4 companies",
      "Finished: Research five fintech investors",
    ]);
    expect(activityLines(null, null)).toBeNull();
    expect(activityLines({}, { n: 0, names: [] })).toEqual([]);
  });
});

const PROFILE: FitProfileDto = {
  companyId: uuid(21),
  configVersion: "fit.v1",
  configLabel: "v1",
  band: "GOOD_FIT",
  confidence: "MEDIUM",
  parameters: [
    {
      parameter: "STAGE",
      outcome: "STRONG",
      reason: "Seed",
      evidenceStatus: null,
      stale: false,
      applicable: true,
    },
    {
      parameter: "SECTOR",
      outcome: "STRONG",
      reason: "Health",
      evidenceStatus: null,
      stale: false,
      applicable: true,
    },
    {
      parameter: "CHEQUE_SIZE",
      outcome: "UNKNOWN",
      reason: "Raise not shared",
      evidenceStatus: null,
      stale: false,
      applicable: true,
    },
    {
      parameter: "GEOGRAPHY",
      outcome: "MISMATCH",
      reason: "Outside",
      evidenceStatus: null,
      stale: false,
      applicable: true,
    },
  ],
  topReasons: [],
  mainMismatch: null,
  hardRule: null,
  computedAt: "2026-10-08T00:00:00Z",
} as unknown as FitProfileDto;

describe("investor matches: grounded take, fit is not quality", () => {
  it("writes the take from the fit profile, names unknowns, invents no number", () => {
    const take = matchOpinion({ profile: PROFILE, reasons: [] });
    expect(take).toBe(
      `A good fit with your mandate: it lines up on stage and sector and misses on geography. Cheque size isn't known yet. ${FIT_IS_NOT_QUALITY}`,
    );
    expect(take).not.toMatch(/\d/u);
    expect(
      matchOpinion({
        profile: null,
        reasons: [{ kind: "SECTOR_MATCH", detail: "Health" }],
      }),
    ).toContain("matches your mandate on sector");
  });

  it("keeps only companies not acted on and not shown before, in slate order", () => {
    const item = (n: number, saved = false) =>
      ({ companyId: uuid(n), viewerSaved: saved }) as DiscoveredCompanyDto;
    const fresh = newMatchesFor({
      items: [item(1), item(2, true), item(3), item(4)],
      touched: new Set([uuid(3)]),
      seen: new Set([uuid(4)]),
    });
    expect(fresh.map((one) => one.companyId)).toEqual([uuid(1)]);
  });

  it("says every new company by name and which fits best", () => {
    const words = matchesWords({
      label: "SINCE_LAST_VISIT",
      total: 2,
      items: [
        {
          companyId: uuid(1),
          name: "Tamu Pay",
          line: null,
          stage: null,
          country: null,
          band: "PARTIAL_FIT",
          take: "A partial fit with your mandate.",
        },
        {
          companyId: uuid(2),
          name: "Kora Health",
          line: null,
          stage: null,
          country: null,
          band: "GOOD_FIT",
          take: "A good fit with your mandate: it lines up on stage. x",
        },
      ],
    });
    expect(words).toBe(
      "Two new companies in your feed fit your mandate: Tamu Pay and Kora Health. Kora Health fits best. A good fit with your mandate: it lines up on stage.",
    );
    const said = arrivalWords(
      {
        ...BASE,
        matches: {
          label: "NOT_LOOKED_AT",
          total: 1,
          items: [
            {
              companyId: uuid(1),
              name: "Tamu Pay",
              line: null,
              stage: null,
              country: null,
              band: null,
              take: "x",
            },
          ],
        },
      },
      AFTERNOON,
      null,
    );
    expect(said.spoken).toContain(
      "One company in your feed fits your mandate: Tamu Pay.",
    );
  });
});

describe("cards follow what Q says", () => {
  const targets = [
    { key: "c1", group: "NEEDS_YOU" as const, names: ["Halyard Security"] },
    { key: "m1", group: "MATCHES" as const, names: ["Kora Health"] },
  ];
  it("reveals the group Q reaches and focuses the card it names first", () => {
    expect(
      stageFocusFor("While you were away, I replied to two people.", targets),
    ).toEqual({
      reveal: ["ACTIVITY"],
      focus: null,
    });
    const found = stageFocusFor(
      "Kora Health fits best, and Halyard Security is waiting.",
      targets,
    );
    expect(found.focus).toBe("m1");
    expect(found.reveal).toEqual(
      expect.arrayContaining(["MATCHES", "NEEDS_YOU"]),
    );
    expect(stageFocusFor("Okay.", targets)).toEqual({
      reveal: [],
      focus: null,
    });
  });

  it("shows everything at once without a spoken briefing, and in order with one", () => {
    const present = ["ACTIVITY", "NEEDS_YOU", "MATCHES"] as const;
    expect(
      revealedGroups({
        present,
        speaking: false,
        reached: new Set(),
        settled: false,
      }),
    ).toEqual(present);
    expect(
      revealedGroups({
        present,
        speaking: true,
        reached: new Set(["ACTIVITY"]),
        settled: false,
      }),
    ).toEqual(["ACTIVITY"]);
    expect(
      revealedGroups({
        present,
        speaking: true,
        reached: new Set(),
        settled: true,
      }),
    ).toEqual(present);
  });
});

describe("E-05: the first question never waits on the briefing", () => {
  it("uses what is composed now", () => {
    expect(
      welcomeNow({
        arrival: "Good afternoon, Zino. …",
        welcomeLine: "Welcome back.",
        welcomeLead: undefined,
        briefing: null,
      }),
    ).toBe("Good afternoon, Zino. …");
    expect(
      welcomeNow({
        arrival: null,
        welcomeLine: "Welcome back, Zino. What next?",
        welcomeLead: "Welcome back, Zino.",
        briefing: null,
      }),
    ).toBe("Welcome back, Zino. What next?");
  });
});
