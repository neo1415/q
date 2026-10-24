// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import {
  readCaptionsOn,
  resetCaptionsChoiceForTests,
  writeCaptionsOn,
} from "@/features/discover/stage/captions-choice";

describe("Discover captions choice (QA F-31)", () => {
  afterEach(() => {
    window.localStorage.clear();
    resetCaptionsChoiceForTests();
  });

  it("is on by default", () => {
    expect(readCaptionsOn()).toBe(true);
  });

  it("is remembered across visits once turned off", () => {
    writeCaptionsOn(false);
    resetCaptionsChoiceForTests();
    expect(readCaptionsOn()).toBe(false);
    writeCaptionsOn(true);
    resetCaptionsChoiceForTests();
    expect(readCaptionsOn()).toBe(true);
  });
});
