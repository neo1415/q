import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  WELCOME_CONDUCTOR_V1,
  WELCOME_CONDUCTOR_V2,
} from "../src/index.js";

/**
 * Founder live 2026-10-05: the voice welcome greeted a known person with
 * "Good to connect, how can I assist you today?". v2 leads instead.
 */
describe("WELCOME_CONDUCTOR v2", () => {
  it("is the active version, and v1 is kept for history", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("WELCOME_CONDUCTOR").definition.version).toBe(2);
    expect(WELCOME_CONDUCTOR_V1.status).toBe("DEPRECATED");
  });

  it("always asks raise or invest and never offers open-ended help", () => {
    const template = WELCOME_CONDUCTOR_V2.template;
    expect(template).toContain("raising capital for a company, or investing");
    expect(template).toContain('Never ask an open "how can I help"');
    expect(template).not.toContain("ask what brings them here");
  });

  it("knows Q can look things up on the public web", () => {
    expect(WELCOME_CONDUCTOR_V2.template).toContain(
      "You can look things up on the public web",
    );
  });
});
