// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RelationshipBrief } from "@capital-q/contracts";

import {
  ARRIVAL_ANY_GAP_MS,
  ARRIVAL_PAGE_GAP_MS,
  ARRIVAL_STORAGE_PREFIX,
  arrivalNews,
  browserArrivalStore,
  clearArrivalSnapshots,
  resetArrivalNews,
  type ArrivalFact,
  type ArrivalSnapshot,
  type ArrivalStore,
} from "@/features/q/arrival-news";
import { ArrivalFacts, QArrivalNews } from "@/features/q/arrival-news-line";
import {
  companyArrivalFacts,
  relationshipArrivalFacts,
} from "@/features/q/arrival-page-facts";

/**
 * W5.2: one line on arrival only when something material is new since the
 * person last looked; silent otherwise; never repeated; rate-limited.
 */

function memoryStore(): ArrivalStore & {
  readonly pages: Map<string, ArrivalSnapshot>;
} {
  const pages = new Map<string, ArrivalSnapshot>();
  return {
    pages,
    read: (page) => pages.get(page) ?? null,
    write: (page, snapshot) => {
      pages.set(page, snapshot);
    },
  };
}

const deck = (version: number | null): ArrivalFact => ({
  key: "deck-version",
  value: version,
  news: "INCREASED",
  subject: "Brightwell",
  line: "posted a new deck since you were last here.",
  ask: "What changed in their latest deck?",
});
const stage = (value: string | null): ArrivalFact => ({
  key: "stage",
  value,
  news: "CHANGED",
  line: "This relationship has moved to a new stage since you were last here.",
});

const HOUR = 60 * 60_000;
let store: ReturnType<typeof memoryStore>;
beforeEach(() => {
  resetArrivalNews();
  store = memoryStore();
});

describe("W5.2 arrival news", () => {
  it("is silent on a first visit: nothing is new since a look never taken", () => {
    expect(arrivalNews("company:a", [deck(3)], { store, now: 0 })).toBeNull();
    expect(store.pages.has("company:a")).toBe(true);
  });

  it("is silent when nothing material moved", () => {
    arrivalNews("company:a", [deck(3), stage("MATCHED")], { store, now: 0 });
    expect(
      arrivalNews("company:a", [deck(3), stage("MATCHED")], {
        store,
        now: HOUR,
      }),
    ).toBeNull();
  });

  it("says one line when the deck version rose", () => {
    arrivalNews("company:a", [deck(3)], { store, now: 0 });
    const news = arrivalNews("company:a", [deck(4)], { store, now: HOUR });
    expect(news).toMatchObject({
      key: "deck-version",
      subject: "Brightwell",
      ask: "What changed in their latest deck?",
      more: 0,
    });
  });

  it("a count that fell is not news (a document withdrawn is not 'new')", () => {
    arrivalNews("company:a", [deck(4)], { store, now: 0 });
    expect(
      arrivalNews("company:a", [deck(3)], { store, now: HOUR }),
    ).toBeNull();
  });

  it("unknown stays unknown: a failed read is neither news nor forgotten", () => {
    arrivalNews("company:a", [deck(3)], { store, now: 0 });
    expect(
      arrivalNews("company:a", [deck(null)], { store, now: HOUR }),
    ).toBeNull();
    // The last seen version survives the unknown read, so the rise to 4
    // is still news afterwards (not compared against "nothing").
    expect(
      arrivalNews("company:a", [deck(4)], { store, now: 2 * HOUR }),
    ).not.toBeNull();
  });

  it("a fact the page did not declare before is a baseline, not news", () => {
    arrivalNews("company:a", [deck(3)], { store, now: 0 });
    expect(
      arrivalNews("company:a", [deck(3), stage("MATCHED")], {
        store,
        now: HOUR,
      }),
    ).toBeNull();
  });

  it("several changes are still one line, with a note that there is more", () => {
    arrivalNews("rel:a", [deck(3), stage("MATCHED")], { store, now: 0 });
    const news = arrivalNews("rel:a", [deck(4), stage("IN_DILIGENCE")], {
      store,
      now: HOUR,
    });
    expect(news?.key).toBe("deck-version");
    expect(news?.more).toBe(1);
  });

  it("never says the same news twice on a page", () => {
    arrivalNews("rel:a", [stage("MATCHED")], { store, now: 0 });
    expect(
      arrivalNews("rel:a", [stage("IN_DILIGENCE")], { store, now: HOUR }),
    ).not.toBeNull();
    // Back and forth to a stage already said: not said again.
    arrivalNews("rel:a", [stage("MATCHED")], { store, now: 2 * HOUR });
    expect(
      arrivalNews("rel:a", [stage("IN_DILIGENCE")], { store, now: 3 * HOUR }),
    ).toBeNull();
  });

  it("is rate-limited per page", () => {
    arrivalNews("company:a", [deck(3)], { store, now: 0 });
    expect(
      arrivalNews("company:a", [deck(4)], { store, now: HOUR }),
    ).not.toBeNull();
    resetArrivalNews(); // isolate the per-page gap from the cross-page one
    expect(
      arrivalNews("company:a", [deck(5)], {
        store,
        now: HOUR + ARRIVAL_PAGE_GAP_MS - 1,
      }),
    ).toBeNull();
    expect(
      arrivalNews("company:a", [deck(6)], {
        store,
        now: HOUR + 2 * ARRIVAL_PAGE_GAP_MS,
      }),
    ).not.toBeNull();
  });

  it("is rate-limited across pages, so fast moves stay quiet", () => {
    arrivalNews("company:a", [deck(3)], { store, now: 0 });
    arrivalNews("company:b", [deck(1)], { store, now: 0 });
    expect(
      arrivalNews("company:a", [deck(4)], { store, now: HOUR }),
    ).not.toBeNull();
    expect(
      arrivalNews("company:b", [deck(2)], {
        store,
        now: HOUR + ARRIVAL_ANY_GAP_MS - 1,
      }),
    ).toBeNull();
  });

  it("stores hashes only: no names, versions or ids in the browser", () => {
    window.localStorage.clear();
    const browser = browserArrivalStore();
    arrivalNews(
      "relationship:7d0c3f4e-1111-4222-8333-944445555666",
      [
        {
          key: "their-message",
          value: "2026-11-07T09:00:00Z",
          news: "CHANGED",
          subject: "Brightwell Capital",
          line: "sent a new message since you were last here.",
        },
      ],
      { store: browser, now: 0 },
    );
    const raw = Object.keys(window.localStorage)
      .map((key) => `${key}=${window.localStorage.getItem(key) ?? ""}`)
      .join("\n");
    expect(raw).toContain(ARRIVAL_STORAGE_PREFIX);
    expect(raw).not.toContain("7d0c3f4e");
    expect(raw).not.toContain("Brightwell");
    expect(raw).not.toContain("2026-11-07");
    clearArrivalSnapshots();
    expect(Object.keys(window.localStorage)).toEqual([]);
  });

  it("a damaged snapshot is no snapshot (silent, never wrong)", () => {
    window.localStorage.clear();
    const browser = browserArrivalStore();
    arrivalNews("company:a", [deck(3)], { store: browser, now: 0 });
    for (const key of Object.keys(window.localStorage)) {
      window.localStorage.setItem(key, "{not json");
    }
    expect(
      arrivalNews("company:a", [deck(4)], { store: browser, now: HOUR }),
    ).toBeNull();
    window.localStorage.clear();
  });
});

function brief(over: {
  readonly fromThem?: string | null;
  readonly theirCalls?: number;
  readonly side?: "INVESTOR" | "COMPANY";
  readonly documents?: number;
  readonly messagesRead?: boolean;
}): RelationshipBrief {
  const meetings = Array.from({ length: over.theirCalls ?? 0 }, (_, index) => ({
    id: `00000000-0000-4000-8000-00000000000${String(index)}`,
    status: "SCHEDULED" as const,
    startsAt: "2026-11-10T09:00:00Z",
    endsAt: "2026-11-10T09:30:00Z",
    timing: "UPCOMING" as const,
    organisedByYou: false,
    noShow: false,
  }));
  const value: unknown = {
    yourSide: over.side ?? "INVESTOR",
    messages: {
      count: 1,
      latest:
        over.messagesRead === false
          ? { status: "UNAVAILABLE", reason: "READ_FAILED" }
          : {
              status: "OK",
              message: null,
              fromThem:
                over.fromThem === undefined || over.fromThem === null
                  ? null
                  : { sentAt: over.fromThem },
            },
    },
    meetings: { status: "OK", items: meetings, nextScheduled: null },
    pendingDecisions: { items: [], complete: true },
    obligations: { status: "OK", openRequests: [], answeredCount: 0 },
    documents: {
      status: "OK",
      items: Array.from({ length: over.documents ?? 0 }, (_, index) => ({
        id: String(index),
        title: "Doc",
        openedByYourSide: null,
      })),
    },
  };
  // Only the fields the facts read; the rest of the brief is irrelevant.
  return value as RelationshipBrief;
}

describe("W5.2 page facts", () => {
  it("their first message is news (known 'none' is a value)", () => {
    const before = relationshipArrivalFacts(brief({}), null, "Brightwell");
    arrivalNews("rel:x", before, { store, now: 0 });
    const news = arrivalNews(
      "rel:x",
      relationshipArrivalFacts(
        brief({ fromThem: "2026-11-07T09:00:00Z" }),
        null,
        "Brightwell",
      ),
      { store, now: HOUR },
    );
    expect(news?.key).toBe("their-message");
  });

  it("an unread message source is unknown, not 'they never wrote'", () => {
    const facts = relationshipArrivalFacts(
      brief({ messagesRead: false }),
      null,
      "Brightwell",
    );
    expect(facts.find((one) => one.key === "their-message")?.value).toBeNull();
  });

  it("documents shared are news to the investor, not to the founder who shared them", () => {
    const investor = relationshipArrivalFacts(
      brief({ side: "INVESTOR", documents: 2 }),
      null,
      "Brightwell",
    );
    const founder = relationshipArrivalFacts(
      brief({ side: "COMPANY", documents: 2 }),
      null,
      "Apex",
    );
    expect(investor.some((one) => one.key === "documents-shared")).toBe(true);
    expect(founder.some((one) => one.key === "documents-shared")).toBe(false);
  });

  it("a call they booked is news; the person's own booking is not", () => {
    const facts = relationshipArrivalFacts(
      brief({ theirCalls: 1 }),
      null,
      "Brightwell",
    );
    expect(facts.find((one) => one.key === "their-calls")?.value).toBe(1);
  });

  it("the company's owner gets no arrival news about their own uploads", () => {
    expect(
      companyArrivalFacts(
        {
          viewer: "OWNER",
          companyId: "c",
          deck: null,
          extraction: null,
          coaching: null,
        },
        null,
        "Mine",
      ),
    ).toEqual([]);
  });
});

describe("W5.2 the line on screen", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("says the line once on arrival with a material change, and nothing otherwise", () => {
    window.localStorage.clear();
    render(<QArrivalNews />);
    const first = render(<ArrivalFacts page="company:z" facts={[deck(3)]} />);
    expect(screen.queryByRole("status")).toBeNull();
    first.unmount();
    act(() => {
      render(<ArrivalFacts page="company:z" facts={[deck(4)]} />);
    });
    const line = screen.getByRole("status");
    expect(line.textContent).toContain("Brightwell");
    expect(line.textContent).toContain("posted a new deck");
    expect(screen.getByRole("button", { name: "Ask Q" })).toBeTruthy();
  });
});
