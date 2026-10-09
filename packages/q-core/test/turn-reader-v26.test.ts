import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V25,
  TURN_READER_V26,
  TURN_READER_V26_HAND_OVER,
} from "../src/index.js";

/**
 * TURN_READER v26 (live 2026-10-02, Zino: "Accept TALUM and send them a
 * message. You can book a meeting with them too." read as a plain
 * TOOL_REQUEST): accepting someone and then messaging them, booking a
 * meeting with them or chatting them up is a hand-over, by meaning.
 */
describe("TURN_READER v26", () => {
  it("v25 and v26 are deprecated (v27 is active)", () => {
    expect(
      createDefaultPromptRegistry().getActive("TURN_READER").definition.version,
    ).toBe(47);
    expect(TURN_READER_V25.status).toBe("DEPRECATED");
    expect(TURN_READER_V26.status).toBe("DEPRECATED");
  });

  it("reads accept-and-message, book a meeting and chat them up as a hand-over with the name as said", () => {
    const template = TURN_READER_V26.template;
    expect(template).toContain(TURN_READER_V26_HAND_OVER);
    expect(template).toContain(
      "Asking you to accept or answer someone and then message them, book a meeting or call with them, or chat them up for them",
    );
    expect(template).toContain("even when the name is misheard");
  });

  it("loses nothing of v25 but the hand-over line it extends", () => {
    for (const line of TURN_READER_V25.template.split("\n")) {
      if (line.startsWith("HAND OVER:")) continue;
      expect(TURN_READER_V26.template).toContain(line);
    }
    expect(TURN_READER_V26.output).toBe(TURN_READER_V25.output);
  });
});
