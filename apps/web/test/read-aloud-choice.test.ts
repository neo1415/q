// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readAloudOn,
  resetReadAloudChoiceForTests,
  speakTypedAnswer,
  writeReadAloudOn,
} from "@/features/voice/read-aloud-choice";

describe("Read answers aloud (A6, owner 2026-11-04)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    resetReadAloudChoiceForTests();
  });

  it("is off by default", () => {
    expect(readAloudOn()).toBe(false);
  });

  it("is remembered across visits once turned on, and off again", () => {
    writeReadAloudOn(true);
    resetReadAloudChoiceForTests();
    expect(readAloudOn()).toBe(true);
    writeReadAloudOn(false);
    resetReadAloudChoiceForTests();
    expect(readAloudOn()).toBe(false);
  });

  it("blocked storage means silent, and a choice still lasts for the page", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readAloudOn()).toBe(false);
    writeReadAloudOn(true);
    expect(readAloudOn()).toBe(true);
  });

  it("speaks a typed answer only when chosen, never over a live call or a written turn", () => {
    expect(
      speakTypedAnswer({
        readAloud: false,
        voiceActive: false,
        written: false,
      }),
    ).toBe(false);
    expect(
      speakTypedAnswer({ readAloud: true, voiceActive: false, written: false }),
    ).toBe(true);
    expect(
      speakTypedAnswer({ readAloud: true, voiceActive: true, written: false }),
    ).toBe(false);
    expect(
      speakTypedAnswer({ readAloud: true, voiceActive: false, written: true }),
    ).toBe(false);
  });
});
