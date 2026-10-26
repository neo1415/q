import { describe, expect, it } from "vitest";

import {
  APP_ACTION_ROUTER_V1,
  createDefaultPromptRegistry,
} from "../src/index.js";

/**
 * Guard F-106-reshown-card (2026-10-26, runs 317bf81f, 61b1fa6d): "Draft a
 * short reply … then send it" named no channel and was routed to an email
 * once every action was listed. A message goes by the channel they named;
 * with none, it is the Capital Q message.
 */
describe("APP_ACTION_ROUTER v2", () => {
  const registry = createDefaultPromptRegistry();

  it("is the active router, and v1 is deprecated", () => {
    expect(registry.getActive("APP_ACTION_ROUTER").definition.version).toBe(2);
    expect(APP_ACTION_ROUTER_V1.status).toBe("DEPRECATED");
  });

  it("routes a message by the channel they named, the Capital Q message when none", () => {
    const template =
      registry.getActive("APP_ACTION_ROUTER").definition.template;
    expect(template).toContain(
      "A message, note or reply goes by the channel they named: an email only when they ask for an email; with no channel named, it is the Capital Q message to that relationship.",
    );
    // Everything v1 said still holds.
    for (const line of APP_ACTION_ROUTER_V1.template.split("\n")) {
      if (line.startsWith('Set "action"')) continue;
      expect(template).toContain(line);
    }
  });
});
