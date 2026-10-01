import { describe, expect, it } from "vitest";

import { composeBriefing } from "../src/features/home/briefing";
import { recordPagePath } from "../src/features/q/client-actions";
import {
  elapsedLabel,
  greySignature,
  initialsOf,
  OUTCOME_WORDS,
  screenChanged,
} from "../src/features/rehearsal/meet";

/**
 * REHEARSE (founder direction 2026-10-01): the room's timer and tiles, the
 * shared-screen change test that decides whether a frame is sent, Q's
 * suggestion to rehearse an upcoming call on Home, and Q opening a
 * rehearsal by name.
 */

describe("rehearsal room helpers", () => {
  it("counts the call like Meet's timer", () => {
    expect(elapsedLabel(0, 7_000)).toBe("0:07");
    expect(elapsedLabel(0, 247_000)).toBe("4:07");
    expect(elapsedLabel(0, 3_729_000)).toBe("1:02:09");
    expect(elapsedLabel(10_000, 0)).toBe("0:00");
  });

  it("puts initials on a tile", () => {
    expect(initialsOf("Ventures Platform")).toBe("VP");
    expect(initialsOf("kola")).toBe("K");
    expect(initialsOf("  ")).toBe("?");
  });

  it("sends a shared frame only when the screen changed", () => {
    const slide = new Uint8Array(32 * 18).fill(200);
    const cursor = Uint8Array.from(slide, (v, i) => (i === 5 ? 0 : v));
    const next = new Uint8Array(32 * 18).fill(40);
    expect(screenChanged(null, slide)).toBe(true);
    expect(screenChanged(slide, cursor)).toBe(false);
    expect(screenChanged(slide, next)).toBe(true);
  });

  it("reads RGBA as one grey byte a pixel", () => {
    expect(
      Array.from(greySignature(new Uint8ClampedArray([255, 255, 255, 255]))),
    ).toEqual([255]);
  });

  it("names every outcome in words", () => {
    expect(OUTCOME_WORDS.STRONG_LATER).toBe("Strong chance later");
    expect(OUTCOME_WORDS.ADJOURNED).toContain("missing");
  });
});

describe("Q and rehearsals", () => {
  it("opens a rehearsal with either side by its own route", () => {
    const id = "44444444-4444-4444-8444-444444444444";
    expect(recordPagePath("INVESTOR_REHEARSAL", id)).toBe(
      `/rehearsals/investor/${id}`,
    );
    expect(recordPagePath("COMPANY_REHEARSAL", id)).toBe(
      `/rehearsals/company/${id}`,
    );
  });

  it("suggests rehearsing an upcoming call on Home", () => {
    const now = Date.parse("2026-10-01T09:00:00Z");
    const briefing = composeBriefing({
      role: "INVESTOR",
      since: new Date(now - 7 * 24 * 3_600_000).toISOString(),
      upcomingCalls: [
        {
          meetingId: "77777777-7777-4777-8777-777777777777",
          counterpartName: "Nixo",
          startsAt: "2026-10-03T10:00:00Z",
        },
      ],
    });
    expect(briefing?.items[0]).toEqual({
      id: "rehearse:77777777-7777-4777-8777-777777777777",
      title: "Rehearse your call with Nixo",
      description: "It's in 2 days. Q plays them so you can practise first.",
      href: "/rehearsals/meeting/77777777-7777-4777-8777-777777777777",
    });
  });
});
