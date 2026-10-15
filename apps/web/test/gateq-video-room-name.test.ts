import { describe, expect, it } from "vitest";

import { joinUrlWithName } from "@/features/gateq/gateq-video-room";

const room = "https://tavus.daily.co/c123?t=meeting-token";

describe("GateQ video room join URL", () => {
  it("names the applicant so Daily Prebuilt skips its name prompt", () => {
    const url = new URL(joinUrlWithName(room, "  Laura Bennett ") ?? "");
    expect(url.searchParams.get("name")).toBe("Laura Bennett");
    // The room's own access token is kept as it was.
    expect(url.searchParams.get("t")).toBe("meeting-token");
    expect(url.hostname).toBe("tavus.daily.co");
  });

  it("encodes the name and bounds its length", () => {
    const url = new URL(
      joinUrlWithName(room, `Ade & Co?#${"x".repeat(80)}`) ?? "",
    );
    const name = url.searchParams.get("name") ?? "";
    expect(name.startsWith("Ade & Co?#")).toBe(true);
    expect(name).toHaveLength(60);
    expect(url.hash).toBe("");
  });

  it("leaves the URL alone without a name or a room", () => {
    expect(joinUrlWithName(room, "   ")).toBe(room);
    expect(joinUrlWithName(null, "Laura")).toBeNull();
  });
});
