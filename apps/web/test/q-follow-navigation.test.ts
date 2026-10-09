import { beforeAll, describe, expect, it } from "vitest";

import type { QTurn } from "../src/features/q/conversation";
import {
  followOfThread,
  navigationToFollow,
} from "../src/features/q/follow-navigation";
import { destinationPath } from "../src/features/voice/destinations";
import { loadWire } from "../src/features/q/wire";

// W7: the wire's contracts load after the first paint in the browser;
// here they are in before any test reads Q's data.
beforeAll(async () => {
  await loadWire();
});

/**
 * A typed "take me to Discover" moves the screen (CQ-QACT-001, F8): the
 * answer's NAVIGATE intent is followed through the spoken navigation's own
 * route map, once, and never for an answer that was already on screen.
 */

function qTurn(
  id: string,
  blocks: Extract<QTurn, { kind: "Q" }>["blocks"],
  streaming = false,
): QTurn {
  return {
    kind: "Q",
    id,
    text: "Taking you to Discover.",
    streaming,
    sourceCount: 0,
    publicSources: [],
    findings: [],
    uncertainties: [],
    blocks,
  };
}

const toDiscover = [
  {
    kind: "UI_INTENT" as const,
    intent: { kind: "NAVIGATE" as const, destination: "DISCOVER" as const },
  },
];

describe("following a navigation Q announced", () => {
  it("follows a new answer's NAVIGATE intent to the same route voice uses, once", () => {
    const seen = new Set<string>();
    const turns = [qTurn("m1", toDiscover)];
    const destination = navigationToFollow(turns, seen);
    expect(destination).toBe("DISCOVER");
    expect(destinationPath(destination)).toBe("/discover");
    expect(navigationToFollow(turns, seen)).toBeNull();
  });

  it("never follows an answer that was already on screen when the conversation opened", () => {
    const seen = new Set<string>(["m1"]);
    expect(navigationToFollow([qTurn("m1", toDiscover)], seen)).toBeNull();
  });

  it("waits for a streaming answer to finish, and ignores answers without an intent", () => {
    const seen = new Set<string>();
    expect(
      navigationToFollow([qTurn("m2", toDiscover, true)], seen),
    ).toBeNull();
    expect(navigationToFollow([qTurn("m3", [])], seen)).toBeNull();
    expect(navigationToFollow([qTurn("m2", toDiscover)], seen)).toBe(
      "DISCOVER",
    );
  });
});

describe("a typed question's move while a voice line is open (n-founder-strings, 2026-10-09)", () => {
  const toRehearsals = [
    {
      kind: "UI_INTENT" as const,
      intent: { kind: "NAVIGATE" as const, destination: "REHEARSALS" as const },
    },
  ];
  const answerOf = (id: string, runId: string): QTurn => ({
    ...(qTurn(id, toRehearsals) as Extract<QTurn, { kind: "Q" }>),
    runId,
  });

  it("is made here: the voice board never carries a typed answer", () => {
    const seen = new Set<string>();
    const followed = followOfThread([answerOf("m1", "run-typed")], seen, {
      active: true,
      typedRuns: new Set(["run-typed"]),
    });
    expect(followed.navigate).toBe("REHEARSALS");
  });

  it("a spoken answer's move is left to the voice board, and never made here later", () => {
    const seen = new Set<string>();
    const spoken = [answerOf("m2", "run-spoken")];
    expect(
      followOfThread(spoken, seen, { active: true, typedRuns: new Set() })
        .navigate,
    ).toBeNull();
    // The line ends: the spoken answer is not followed a second time.
    expect(
      followOfThread(spoken, seen, { active: false, typedRuns: new Set() })
        .navigate,
    ).toBeNull();
  });

  it("with no voice line, every new answer is followed as before", () => {
    expect(
      followOfThread([answerOf("m3", "run-spoken")], new Set(), {
        active: false,
        typedRuns: new Set(),
      }).navigate,
    ).toBe("REHEARSALS");
  });
});
