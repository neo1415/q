// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReadinessDto } from "@capital-q/contracts";

import type { ArrivalData } from "../src/features/briefing/arrival";
import {
  founderStartLines,
  founderStartOf,
} from "../src/features/briefing/founder-start";

/**
 * Coordinator 25 Oct (fresh founder e2e-f-1403): Home's first answer after
 * onboarding was only "Welcome back, Abena. What's on your mind today?".
 * Q now leads with what it already knows -- where they stand, the gaps,
 * the next thing and its own work -- from the stored records only.
 */

vi.mock("../src/features/briefing/arrival-actions", () => ({
  arrivalBriefingAction: vi.fn(),
  decideArrivalCardAction: vi.fn(() => Promise.resolve({ ok: true })),
  readArrivalWordsAction: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("../src/features/work/notice-store", () => ({
  useNotices: () => ({ items: null }),
}));

const { ArrivalBriefing } =
  await import("../src/features/briefing/arrival-briefing");
const { resetArrival } = await import("../src/features/briefing/arrival-store");
const { resetArrivalGate } =
  await import("../src/features/briefing/arrival-gate");

const pillar = (label: string, status: string) =>
  ({
    pillar: label.toUpperCase(),
    label,
    status,
    summary: `${label}.`,
    evidence: [],
    improve: [],
  }) as unknown as ReadinessDto["pillars"][number];

const action = (
  title: string,
  priority: "NOW" | "NEXT" | "LATER",
  state = "OPEN",
) =>
  ({
    key: title.toLowerCase().replace(/\W+/gu, "-").slice(0, 40),
    pillar: "TRACTION",
    closesGapId: "gap",
    priority,
    title,
    why: "Investors ask.",
    next: "Upload it.",
    doneWhen: "Q sees it.",
    owner: "FOUNDER",
    ownerLabel: "You",
    state,
    doneAt: null,
    href: "/company/readiness",
    askQ: null,
  }) as unknown as ReadinessDto["actions"][number];

const READINESS = {
  companyId: "00000000-0000-4000-8000-000000000001",
  rulesVersion: "r1",
  revision: 1,
  assessedAt: "2026-10-25T14:00:00Z",
  stageCode: "seed",
  pillars: [
    pillar("Team", "STRONG"),
    pillar("Market", "DEVELOPING"),
    pillar("Traction", "GAP"),
    pillar("Financials", "UNKNOWN"),
  ],
  blockers: [
    {
      id: "b1",
      pillar: "TRACTION",
      kind: "MISSING",
      title: "Revenue figures not shared",
      why: "Investors ask.",
      actionKey: "revenue",
    },
  ],
  actions: [
    action("Add your financial model", "NEXT"),
    action("Share your monthly revenue", "NOW"),
    action("Done already", "NOW", "MARKED_DONE"),
  ],
  followUps: [],
  uncertainty: [],
} as unknown as ReadinessDto;

const JOBS = [
  { status: "RUNNING", goal: "Draft your investor update." },
  { status: "DONE", goal: "Read your deck" },
];

describe("founderStartOf / founderStartLines", () => {
  it("says where they stand, the gap, the next thing and Q's work, from the records", () => {
    const start = founderStartOf(READINESS, JOBS);
    expect(start).not.toBeNull();
    expect(start === null ? [] : founderStartLines(start)).toEqual([
      "Here's where you stand across the 4 areas investors look at: 1 strong, 1 developing, 1 with a gap and 1 not shared yet.",
      "The gap to close first: Revenue figures not shared.",
      "The one thing to do next: Share your monthly revenue.",
      "What I'm working on: Draft your investor update.",
    ]);
  });

  it("an assessment with nothing shared is said as not assessed, never as gaps", () => {
    const start = founderStartOf(
      {
        ...READINESS,
        pillars: [pillar("Team", "UNKNOWN")],
        blockers: [],
        actions: [],
      },
      [],
    );
    expect(start === null ? [] : founderStartLines(start)).toEqual([
      "I haven't been able to assess your readiness yet: nothing investors look at is shared so far.",
    ]);
  });

  it("no readiness read: no first answer at all", () => {
    expect(founderStartOf(null, JOBS)).toBeNull();
  });
});

const FIRST: ArrivalData = {
  firstName: "Abena Mensah",
  timeZone: "Africa/Accra",
  activity: {},
  hoursAway: null,
  cards: [],
  jobsDone: { n: 0, names: [] },
  start: founderStartOf(READINESS, JOBS) ?? undefined,
};

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  resetArrivalGate();
  resetArrival();
});
afterEach(() => {
  cleanup();
});

async function show(data: ArrivalData) {
  render(
    <ArrivalBriefing
      variant="page"
      load={() => Promise.resolve(data)}
      now={() => new Date("2026-10-25T14:30:00Z")}
    />,
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("a founder's first Home after onboarding", () => {
  it("leads with Q's first answer, then the open question", async () => {
    await show(FIRST);
    const start = document.querySelector("[data-founder-start]");
    expect(start?.textContent).toContain(
      "The one thing to do next: Share your monthly revenue.",
    );
    expect(start?.textContent).toContain(
      "What I'm working on: Draft your investor update.",
    );
    expect(
      document.querySelector("[data-founder-start-next]")?.getAttribute("href"),
    ).toBe("/company/readiness");
    expect(document.querySelector("[data-arrival-lowdown]")?.textContent).toBe(
      "What's on your mind today?",
    );
  });

  it("a later visit greets as before, with no first answer", async () => {
    await show({ ...FIRST, hoursAway: 20 });
    expect(document.querySelector("[data-founder-start]")).toBeNull();
  });
});
