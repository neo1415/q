// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import {
  ListeningSetting,
  VoiceSetting,
} from "../src/features/settings/voice-setting";
import {
  LISTENING_PREFERENCE_KEY,
  readListeningPreference,
} from "../src/features/voice/listening-preference";
import {
  readVoicePreference,
  VOICE_PREFERENCE_KEY,
} from "../src/features/voice/voice-preference";

/** Q's voice on the Settings page is remembered on this device (R28). */
describe("R28 · Q's voice setting", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to the female voice and remembers a change", async () => {
    render(<VoiceSetting />);
    const female = screen.getByRole("button", { name: "Female voice" });
    const male = screen.getByRole("button", { name: "Male voice" });
    expect(female.getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(male);
    expect(male.getAttribute("aria-pressed")).toBe("true");
    expect(female.getAttribute("aria-pressed")).toBe("false");
    expect(window.localStorage.getItem(VOICE_PREFERENCE_KEY)).toBe("MALE");
    expect(readVoicePreference()).toBe("MALE");
  });

  it("ignores a stored value that is not a voice", () => {
    window.localStorage.setItem(VOICE_PREFERENCE_KEY, "ROBOT");
    expect(readVoicePreference()).toBe("FEMALE");
  });
});

/** BACKCHANNEL: the listening-sounds toggle, Off / Subtle (default) / Natural. */
describe("Listening sounds setting", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to Subtle and remembers a change with when it was made", async () => {
    render(<ListeningSetting />);
    const subtle = screen.getByRole("button", { name: "Subtle" });
    const off = screen.getByRole("button", { name: "Off" });
    expect(screen.getByRole("button", { name: "Natural" })).toBeTruthy();
    expect(subtle.getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(off);
    expect(off.getAttribute("aria-pressed")).toBe("true");
    const stored = readListeningPreference();
    expect(stored?.level).toBe("OFF");
    expect(Number.isNaN(Date.parse(stored?.setAt ?? ""))).toBe(false);
  });

  it("ignores a stored value that is not a level", () => {
    window.localStorage.setItem(
      LISTENING_PREFERENCE_KEY,
      JSON.stringify({ level: "LOUD", setAt: "2026-10-04T00:00:00Z" }),
    );
    expect(readListeningPreference()).toBeNull();
  });
});
