import { describe, expect, it } from "vitest";

import {
  createFormation,
  stepFormation,
} from "../src/features/q-presence/particle-field";
import {
  Q_PRESENCE_LABELS,
  Q_PRESENCE_STATES,
  presenceStateFromVoice,
} from "../src/features/q-presence/presence-state";

/**
 * The presence is arithmetic the screen reads; what must hold is that
 * every voice state has a picture and a word, that the still (reduced
 * motion) rendering is the same every time, and that the states are told
 * apart by shape and not only by colour.
 */

describe("Q presence", () => {
  it("maps every voice state to a presence state with a label", () => {
    const voiceStates = [
      "IDLE",
      "CONNECTING",
      "LISTENING",
      "USER_SPEAKING",
      "THINKING",
      "Q_SPEAKING",
      "INTERRUPTED",
      "ERROR",
    ] as const;
    for (const state of voiceStates) {
      const presence = presenceStateFromVoice(state);
      expect(Q_PRESENCE_STATES).toContain(presence);
      expect(Q_PRESENCE_LABELS[presence].length).toBeGreaterThan(0);
    }
    expect(presenceStateFromVoice("INTERRUPTED")).toBe("LISTENING");
    expect(presenceStateFromVoice("CONNECTING")).toBe("THINKING");
  });

  it("settles to the same still frame every time under reduced motion", () => {
    const frame = (state: (typeof Q_PRESENCE_STATES)[number]) => {
      const formation = createFormation(60, 40);
      stepFormation(formation, {
        state,
        time: 0,
        dt: 1,
        sinceState: 1,
        input: 0,
        output: 0,
        still: true,
      });
      return formation.particles.map((p) => [p.x, p.y, p.alpha]);
    };
    expect(frame("IDLE")).toEqual(frame("IDLE"));
    expect(frame("THINKING")).toEqual(frame("THINKING"));
  });

  it("changes shape between states, not only tone", () => {
    const radiusOf = (state: (typeof Q_PRESENCE_STATES)[number]) => {
      const formation = createFormation(60, 40);
      stepFormation(formation, {
        state,
        time: 0,
        dt: 1,
        sinceState: 1,
        input: 0.8,
        output: 0,
        still: true,
      });
      const outer = formation.particles.filter((p) => p.orbit === 0);
      return (
        outer.reduce((sum, p) => sum + Math.hypot(p.x, p.y), 0) / outer.length
      );
    };
    // Listening opens the ring; thinking draws it in.
    expect(radiusOf("LISTENING")).toBeGreaterThan(radiusOf("IDLE"));
    expect(radiusOf("THINKING")).toBeLessThan(radiusOf("IDLE"));
  });
});
