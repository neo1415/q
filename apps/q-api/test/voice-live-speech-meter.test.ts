import { describe, expect, it } from "vitest";
import { createSpeechMeter } from "../src/voice/live/trial.js";

describe("speech boundary audit", () => {
  it("audit: authoritative start and stop count speech without transcription deltas", () => {
    const meter = createSpeechMeter();
    meter.signal({ kind: "start", side: "user" }, 1000);
    meter.signal({ kind: "stop", side: "user" }, 31000);
    expect(meter.measuredMs(31000)).toBe(30000);
  });
});
