// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import type { QVoiceTurnState } from "@capital-q/contracts";

import { performTurnChain } from "../src/features/voice/use-follow-turn";

/**
 * F-61: a spoken story ask is opened by the server's Q_PITCH move when the
 * browser did not take the words itself; when it did (its interceptors hear
 * them first), the story is already asked for and the server's move is not
 * made again, so it never swaps the cut they asked for for the full one.
 */

const TURN = {
  navigate: "Q_PITCH",
  clientAction: null,
  clientActions: [],
} as unknown as QVoiceTurnState;

function moves(): string[] {
  const made: string[] = [];
  performTurnChain(
    TURN,
    () => true,
    (path) => {
      made.push(path);
    },
    () => undefined,
  );
  return made;
}

describe("following a spoken story ask", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("opens Q Pitch when no story is asked for yet", () => {
    window.history.replaceState(null, "", "/home");
    expect(moves()).toEqual(["/q-pitch?start=1"]);
  });

  it("leaves a story the browser already started alone", () => {
    window.history.replaceState(
      null,
      "",
      "/home?qpitch=story&new=1&edition=investor",
    );
    expect(moves()).toEqual([]);
  });
});
