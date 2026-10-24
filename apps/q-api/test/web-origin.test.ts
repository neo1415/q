import { describe, expect, it } from "vitest";

import {
  HandleClaimPayloadSchema,
  describeHandleClaim,
} from "../src/composition/handle-claim-action.js";
import {
  DEFAULT_WEB_ORIGIN,
  qCardUrl,
  webOriginFrom,
} from "../src/composition/web-origin.js";

/**
 * QA F-85: the Q Card link said "https://capitalq.example/@maji-loop".
 * q-api knew only "/@handle"; the origin now comes from CQ_WEB_ORIGIN.
 */
describe("the public web origin q-api writes links from", () => {
  it("is the bare https origin of CQ_WEB_ORIGIN", () => {
    expect(webOriginFrom("https://app.capitalq.ai/")).toBe(
      "https://app.capitalq.ai",
    );
    expect(webOriginFrom(" https://app.capitalq.ai/some/path ")).toBe(
      "https://app.capitalq.ai",
    );
  });

  it("keeps the deployed web service when unset", () => {
    expect(webOriginFrom(undefined)).toBe(DEFAULT_WEB_ORIGIN);
    expect(webOriginFrom("")).toBe(DEFAULT_WEB_ORIGIN);
  });

  it("refuses to start on anything but an https URL", () => {
    for (const bad of [
      "http://app.capitalq.ai",
      "capitalq.ai",
      "ftp://capitalq.ai",
      "https://user:secret@capitalq.ai",
    ]) {
      expect(() => webOriginFrom(bad), bad).toThrow(/https URL/u);
    }
  });

  it("gives the Q Card's whole address in the approval text", () => {
    expect(qCardUrl("https://app.capitalq.ai", "maji-loop")).toBe(
      "https://app.capitalq.ai/@maji-loop",
    );
    const described = describeHandleClaim(
      HandleClaimPayloadSchema.parse({
        subjectType: "COMPANY",
        subjectId: "4f9b1c7e-5d1a-4b7e-9a7e-2f0c1d3b4a5e",
        handle: "maji-loop",
      }),
      "https://app.capitalq.ai",
    );
    expect(described.summary).toContain("https://app.capitalq.ai/@maji-loop");
  });
});
