import { describe, expect, it } from "vitest";

import { jobAttention } from "../src/index.js";

/**
 * QA F-117: a job that failed, is held or was stopped is never shown as
 * "Doing"; its card says plainly why it needs the person.
 */
describe("jobAttention", () => {
  it("gives a plain reason for a failed, held or stopped job, and none otherwise", () => {
    expect(jobAttention("FAILED")).toBe(
      "Q couldn't finish this. Ask Q to try again.",
    );
    expect(jobAttention("HELD")).toBe("Q is waiting for you on the Work page.");
    expect(jobAttention("STOPPED")).toBe("This work was stopped.");
    expect(jobAttention("RUNNING")).toBeNull();
    expect(jobAttention("DONE")).toBeNull();
    expect(jobAttention(undefined)).toBeNull();
  });
});
