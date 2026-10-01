import { describe, expect, it } from "vitest";

import { composeBriefing } from "../src/features/home/briefing";
import { recordPagePath } from "../src/features/q/client-actions";
import { deviceLocale } from "../src/features/voice/device-locale";
import { isLineLive } from "../src/features/voice/session";
import { progressWords } from "../src/features/rehearsal/rehearsal-review";
import {
  elapsedLabel,
  greySignature,
  initialsOf,
  OUTCOME_WORDS,
  screenChanged,
  moodWord,
  shouldNudgeSilence,
  stanceWords,
} from "../src/features/rehearsal/meet";
import {
  MEET_SOUND_GAIN,
  MEET_SOUND_NOTES,
  MEET_SOUNDS,
  meetSoundMs,
  meetSoundsOn,
} from "../src/features/rehearsal/meet-sounds";

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

describe("progress between rehearsals", () => {
  it("says how the score moved since last time", () => {
    expect(progressWords(78, 70)).toBe("Up 8 since last time (70)");
    expect(progressWords(60, 70)).toBe("Down 10 since last time (70)");
    expect(progressWords(70, 70)).toBe("Same as last time (70)");
  });
});

describe("silence on the line", () => {
  const base = {
    state: "LISTENING",
    lastActivityMs: 0,
    nowMs: 30_000,
    alreadyNudged: false,
    micOn: true,
    ended: false,
  };
  it("nudges once after 25 seconds of nobody speaking", () => {
    expect(shouldNudgeSilence(base)).toBe(true);
    expect(shouldNudgeSilence({ ...base, alreadyNudged: true })).toBe(false);
    expect(shouldNudgeSilence({ ...base, nowMs: 20_000 })).toBe(false);
  });
  it("never while they speak, with the mic off, or after the meeting ended", () => {
    expect(shouldNudgeSilence({ ...base, state: "Q_SPEAKING" })).toBe(false);
    expect(shouldNudgeSilence({ ...base, micOn: false })).toBe(false);
    expect(shouldNudgeSilence({ ...base, ended: true })).toBe(false);
  });
});

describe("a dropped voice line", () => {
  it("is not live, so typed answers and Q's moves do not wait on it", () => {
    expect(isLineLive({ connected: true, state: "LISTENING" })).toBe(true);
    expect(isLineLive({ connected: true, state: "ERROR" })).toBe(false);
    expect(isLineLive({ connected: false, state: "LISTENING" })).toBe(false);
  });
});

describe("the rehearsal's voice language", () => {
  it("sends the device locale, so a non-English one is heard and spoken", () => {
    expect(deviceLocale("fr-FR")).toEqual({ locale: "fr-FR" });
    expect(deviceLocale("yo")).toEqual({ locale: "yo" });
    expect(deviceLocale("not a tag")).toEqual({});
    expect(deviceLocale("")).toEqual({});
  });
  it("is passed by the rehearsal room when it opens the line", async () => {
    const { readFile } = await import("node:fs/promises");
    const room = await readFile(
      new URL("../src/features/rehearsal/rehearsal-room.tsx", import.meta.url),
      "utf8",
    );
    expect(room).toMatch(
      /rehearsal: \{ rehearsalId: initial\.id \},[\s\S]{0,200}\.\.\.deviceLocale\(\)/,
    );
  });
});

describe("the played person's tile", () => {
  it("names the mood quietly, and says nothing when neutral", () => {
    expect(moodWord({ mood: "ANGRY", intensity: "RAISED" })).toBe(
      "raising their voice",
    );
    expect(moodWord({ mood: "SAD", reaction: "CRY" })).toBe("in tears");
    expect(moodWord({ mood: "HAPPY" })).toBe("smiling");
    expect(moodWord({ mood: "NEUTRAL" })).toBeNull();
    expect(moodWord(undefined)).toBeNull();
  });
});

describe("meeting sounds (founder live test 2026-10-01)", () => {
  it("are short, quiet, synthesised notes: joining rises, leaving falls", () => {
    for (const sound of MEET_SOUNDS) {
      expect(MEET_SOUND_NOTES[sound].length).toBeGreaterThan(0);
      expect(meetSoundMs(sound)).toBeLessThanOrEqual(500);
    }
    expect(MEET_SOUND_GAIN).toBeLessThanOrEqual(0.1);
    const pitch = (sound: (typeof MEET_SOUNDS)[number]) =>
      MEET_SOUND_NOTES[sound].map((note) => note.frequency);
    const [joinA = 0, joinB = 0] = pitch("JOIN");
    const [leaveA = 0, leaveB = 0] = pitch("LEAVE");
    expect(joinB).toBeGreaterThan(joinA);
    expect(leaveB).toBeLessThan(leaveA);
  });

  it("follow the person's choice, and stay off by default under reduced motion", () => {
    expect(meetSoundsOn(null, false)).toBe(true);
    expect(meetSoundsOn(null, true)).toBe(false);
    expect(meetSoundsOn("on", true)).toBe(true);
    expect(meetSoundsOn("off", false)).toBe(false);
  });
});

describe("who holds the leverage, in the lobby (founder live test 2026-10-01)", () => {
  it("says who leads, and how forward Q reads them, as Q's reading", () => {
    expect(
      stanceWords(
        { leads: "YOU", forwardness: "TYPICAL", why: null },
        "Yamfield Agro",
      ),
    ).toBe(
      "You hold the leverage here: Yamfield Agro is pitching to you, so they'll answer first and keep their own questions for later.",
    );
    const forward = stanceWords(
      { leads: "THEM", forwardness: "FORWARD", why: "Interrupts with numbers" },
      "Zino Aviation",
    );
    expect(forward).toContain("Zino Aviation holds the leverage here");
    expect(forward).toContain(
      "Q reads them as forward (Interrupts with numbers)",
    );
  });
});
