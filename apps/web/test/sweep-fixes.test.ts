import { describe, expect, it } from "vitest";

import { ApiProblemError } from "@capital-q/api-client";

import { connectedLine } from "../src/features/network/express-interest";
import {
  DOWNLOAD_UNAVAILABLE,
  UNREACHABLE,
  diligenceErrorMessage,
} from "../src/features/relationships/diligence-errors";

/** Browser sweep 2026-10-03: words that said the wrong thing. */
describe("a refused diligence download says so, not that Capital Q was unreachable", () => {
  it("a 404 or other refusal is 'isn't available', with or without a detail", () => {
    for (const error of [
      new ApiProblemError("not found", 404, "RESOURCE_NOT_FOUND"),
      new ApiProblemError("forbidden", 403, "FORBIDDEN", undefined, {
        type: "about:blank",
        title: "Forbidden",
        status: 403,
        detail: "Some server detail.",
      } as never),
    ]) {
      expect(diligenceErrorMessage(error, DOWNLOAD_UNAVAILABLE)).toBe(
        DOWNLOAD_UNAVAILABLE,
      );
    }
  });

  it("only a 5xx or a network failure is 'couldn't reach'", () => {
    expect(
      diligenceErrorMessage(
        new ApiProblemError("down", 503, "PROVIDER_UNAVAILABLE"),
        DOWNLOAD_UNAVAILABLE,
      ),
    ).toBe(UNREACHABLE);
    expect(
      diligenceErrorMessage(
        new TypeError("fetch failed"),
        DOWNLOAD_UNAVAILABLE,
      ),
    ).toBe(UNREACHABLE);
  });
});

describe("the profile's connected line uses the relationship's own state", () => {
  it("says the state once past connecting, and 'Connected' only when connected", () => {
    expect(connectedLine("Ajopot", "IN_DILIGENCE")).toBe(
      "Your relationship with Ajopot: In diligence.",
    );
    expect(connectedLine("Ajopot", "MEETING_HELD")).toBe(
      "Your relationship with Ajopot: Met.",
    );
    expect(connectedLine("Ajopot", "PAUSED")).toBe(
      "Your relationship with Ajopot: Paused.",
    );
    expect(connectedLine("Ajopot", "CONNECTED")).toBe(
      "Connected with Ajopot. Both sides have agreed to connect.",
    );
    expect(connectedLine("Ajopot", null)).toBe(
      "Connected with Ajopot. Both sides have agreed to connect.",
    );
  });
});
