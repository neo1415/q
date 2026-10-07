// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { demoTop } from "../src/features/q/answer-canvas-fixtures";
import type { QTurn } from "../src/features/q/conversation";
import { QPresenceStage } from "../src/features/q/q-presence-stage";

/**
 * On the Q page (C1, C4): an answer with cards takes the stage with the
 * presence small beside Q's line; when the conversation moves on, the
 * cards fly to the Board (which counts them) and the presence returns.
 */

afterEach(cleanup);

const turn = (id: string, text: string, cards = false): QTurn => ({
  kind: "Q",
  id,
  text,
  streaming: false,
  sourceCount: 0,
  publicSources: [],
  findings: [],
  uncertainties: [],
  blocks: cards ? [demoTop(3)] : [],
});
const person = (id: string, text: string): QTurn => ({
  kind: "PERSON",
  id,
  text,
  unconfirmed: false,
});

function stage(turns: readonly QTurn[], onBoardLanded = vi.fn()) {
  return (
    <QPresenceStage
      presence={(compact, mini) => (
        <span
          data-testid={mini === true ? "mini" : compact ? "compact" : "full"}
        />
      )}
      turns={turns}
      captions={false}
      caption={null}
      onBoardLanded={onBoardLanded}
    />
  );
}

describe("the answer canvas on the stage", () => {
  it("shows the cards with the presence small, then sends them to the Board on a new topic", async () => {
    const first = [
      person("p1", "Top three for my mandate"),
      turn("a1", "Three stand out. Want them side by side?", true),
    ];
    const landed = vi.fn();
    const { rerender, queryByTestId } = render(stage(first, landed));
    // W7: the cards' code loads when they first come on the stage.
    await waitFor(() =>
      expect(document.querySelector('[data-q-canvas="a1"]')).not.toBeNull(),
      { timeout: 10_000 },
    );
    expect(queryByTestId("mini")).not.toBeNull();
    expect(queryByTestId("full")).toBeNull();
    expect(document.querySelector(".cq-ac-asked")?.textContent).toBe(
      "Top three for my mandate",
    );

    rerender(
      stage(
        [
          ...first,
          person("p2", "What's on tomorrow?"),
          turn("a2", "Two meetings tomorrow."),
        ],
        landed,
      ),
    );
    await waitFor(() => expect(landed).toHaveBeenCalledOnce());
    expect(document.querySelector("[data-q-canvas]")).toBeNull();
    expect(queryByTestId("full")).not.toBeNull();
  });

  it("keeps the cards for a follow-up about one of them", async () => {
    const turns = [
      turn("a1", "Three stand out.", true),
      person("p2", "Why is Atlas third?"),
      turn("a2", "Atlas Ledger's revenue is only a claim."),
    ];
    render(stage(turns));
    await waitFor(() =>
      expect(document.querySelector('[data-q-canvas="a1"]')).not.toBeNull(),
      { timeout: 10_000 },
    );
  });
});
