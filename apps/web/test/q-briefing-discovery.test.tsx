// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/features/home/setup-nudge-actions", () => ({
  remindSetupLaterAction: () => Promise.resolve(),
}));

import type { Briefing } from "../src/features/home/briefing";
import { readinessItems } from "../src/features/home/briefing";
import { QBriefing } from "../src/features/home/q-briefing";

/**
 * Owner 2026-10-30 (MVP item 7): opening Q shows what keeps investors from
 * finding them, from the same marketplace readiness the answer to "what
 * should I do next?" leads with, every time -- the rest of what waits is
 * on the arrival stage, so it is not said twice.
 */
const GAPS = [
  {
    requirement: "FOUNDER_IDENTITY_VERIFIED",
    description: "A founder's identity has not been verified yet.",
    href: "/verification",
  },
];

const briefing = (): Briefing => ({
  line: "Two things need you.",
  spoken: "Two things need you.",
  items: [
    {
      id: "approval:1",
      title: "Approve a message to Aster Africa Ventures",
      description: "Q drafted it.",
      href: "/home?c=x",
    },
    ...readinessItems(GAPS, false),
  ],
});

afterEach(cleanup);

describe("the Q page's discovery gaps", () => {
  it("marks the readiness card as what keeps investors from finding them", () => {
    expect(readinessItems(GAPS, false)[0]?.discovery).toBe(true);
    expect(readinessItems(undefined, true)[0]?.discovery).toBe(true);
    expect(readinessItems(undefined, false)).toEqual([]);
  });

  it("shows only the discovery gap, without the briefing's line, every time Q opens", async () => {
    for (let visit = 0; visit < 2; visit += 1) {
      render(
        <QBriefing briefing={Promise.resolve(briefing())} onlyDiscovery />,
      );
      expect(
        await screen.findByText("One step before investors can find you"),
      ).toBeTruthy();
      expect(
        screen.queryByText("Approve a message to Aster Africa Ventures"),
      ).toBeNull();
      expect(screen.queryByText("Two things need you.")).toBeNull();
      cleanup();
    }
  });
});
