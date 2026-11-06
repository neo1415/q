import { describe, expect, it } from "vitest";

import {
  decideWorkspaceMode,
  preferenceOf,
  serverModeOf,
} from "../src/features/workspace/mode-rules";

/** W1.1: the Q Workspace flag (Q_WORKSPACE_PLAN §4.1, DECISIONS 71). */
describe("workspace mode", () => {
  it("is off unless the server switch says labs or on", () => {
    expect(serverModeOf(undefined)).toBe("off");
    expect(serverModeOf("")).toBe("off");
    expect(serverModeOf("yes")).toBe("off");
    expect(serverModeOf(" LABS ")).toBe("labs");
    expect(serverModeOf("on")).toBe("on");
  });

  it("reads only on/off as a preference", () => {
    expect(preferenceOf("on")).toBe("on");
    expect(preferenceOf("off")).toBe("off");
    expect(preferenceOf(true)).toBeNull();
    expect(preferenceOf(undefined)).toBeNull();
  });

  it("server off is a kill switch over every preference", () => {
    for (const preference of ["on", "off", null] as const) {
      expect(decideWorkspaceMode("off", preference)).toEqual({
        enabled: false,
        available: false,
      });
    }
  });

  it("labs: only a person who turned it on", () => {
    expect(decideWorkspaceMode("labs", null).enabled).toBe(false);
    expect(decideWorkspaceMode("labs", "off").enabled).toBe(false);
    expect(decideWorkspaceMode("labs", "on")).toEqual({
      enabled: true,
      available: true,
    });
  });

  it("on: everyone except a person who turned it off", () => {
    expect(decideWorkspaceMode("on", null).enabled).toBe(true);
    expect(decideWorkspaceMode("on", "on").enabled).toBe(true);
    expect(decideWorkspaceMode("on", "off")).toEqual({
      enabled: false,
      available: true,
    });
  });
});
