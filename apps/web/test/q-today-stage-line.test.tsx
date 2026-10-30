// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  createQStreamState,
  qCurrentStage,
  reduceQStream,
  type QStreamState,
} from "@capital-q/api-client";
import { QStreamEventSchema, type QStreamEvent } from "@capital-q/contracts";

vi.mock("next/navigation", () => ({
  usePathname: () => "/home",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const { StageLine } = await import("../src/features/q/stage-line");
const { loadWire } = await import("../src/features/q/wire");

/**
 * Owner 2026-10-30 ("What should I do today?"): the conversational answer
 * shows what Q is doing -- the same stage line as the plan card -- and its
 * first words (code's priorities) are on the page while the run is still
 * working, before the completed message.
 */
const RUN = "0198f8b2-9c1a-7a3e-8f2b-1c2d3e4f5a6c";
const MSG = "123e4567-e89b-12d3-a456-426614174001";
const NOW = "2026-10-30T10:00:00.000Z";
let counter = 0;
function event(
  type: QStreamEvent["type"],
  data: Record<string, unknown>,
  sequence: number,
): QStreamEvent {
  counter += 1;
  return QStreamEventSchema.parse({
    contractVersion: 1,
    eventId: `${counter.toString(16).padStart(8, "0")}-0000-4000-8000-000000000001`,
    runId: RUN,
    sequence,
    occurredAt: NOW,
    type,
    data,
  });
}

function Surface({ state }: { readonly state: QStreamState }) {
  const now = qCurrentStage(state.stageHistory);
  return (
    <div>
      <StageLine
        current={now === null ? null : { stage: now.stage }}
        size="answer"
        live={false}
      />
      <p data-live-text>{state.partial?.text ?? ""}</p>
    </div>
  );
}

beforeAll(async () => {
  await loadWire();
});
afterEach(() => {
  cleanup();
});

describe("the conversational answer's stage lines (owner 2026-10-30)", () => {
  it("says 'Gathering your situation' on a conversational run, then its first words stream in before completion", () => {
    let state = createQStreamState();
    const view = render(<Surface state={state} />);
    const step = (next: QStreamEvent) => {
      state = reduceQStream(state, next);
      act(() => {
        view.rerender(<Surface state={state} />);
      });
    };
    step(
      event(
        "q.run.started",
        { capability: "INVESTIGATE", status: "RECEIVED" },
        1,
      ),
    );
    step(event("q.stage.changed", { stage: "GATHERING_SITUATION" }, 2));
    expect(view.container.textContent).toContain("Gathering your situation");
    step(
      event(
        "q.message.delta",
        {
          messageId: MSG,
          text: "What to do next for your raise, most important first: ",
        },
        2,
      ),
    );
    expect(view.container.textContent).toContain(
      "What to do next for your raise",
    );
    expect(state.messages).toEqual([]);
  });
});
