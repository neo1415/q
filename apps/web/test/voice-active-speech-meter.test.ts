import { describe, expect, it } from "vitest";
import { createActiveSpeechMeter } from "../src/features/voice/live/active-speech-meter.js";

describe("the live voice active-speech trial meter", () => {
  it("does not charge silent idle, even while the session is open", () => {
    const meter = createActiveSpeechMeter(300_000, 0);
    for (let at = 100; at <= 600_000; at += 100) meter.sample(at, false, false);
    expect(meter.activeMs()).toBe(0);
    expect(meter.remainingMs()).toBe(300_000);
  });
  it("counts actual user or Q speech once when both overlap", () => {
    const meter = createActiveSpeechMeter(300_000, 0);
    meter.sample(100, true, false);
    meter.sample(200, false, true);
    meter.sample(300, true, true);
    meter.sample(400, false, false);
    expect(meter.activeMs()).toBe(300);
  });
  it("reaches zero after five active minutes and never overdraws", () => {
    const meter = createActiveSpeechMeter(300_000, 0);
    for (let at = 100; at <= 310_000; at += 100) meter.sample(at, true, true);
    expect(meter.activeMs()).toBe(300_000);
    expect(meter.remainingMs()).toBe(0);
  });
  it("does not charge an unobserved suspended-tab interval", () => {
    const meter = createActiveSpeechMeter(300_000, 0);
    meter.sample(90_000, false, true);
    expect(meter.activeMs()).toBe(250);
  });
});
