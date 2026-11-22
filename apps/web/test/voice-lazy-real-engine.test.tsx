// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  preloadVoice,
  useLazyVoiceInterview,
} from "../src/features/voice/lazy-voice-interview";

/**
 * W3-C: the real voice engine, loaded behind the session's stub, settles.
 * It hands its value up on every render; the stub redraws only on a real
 * change, so an idle voice costs a few renders, never a loop.
 */

vi.mock("../src/features/voice/actions", () => ({
  startVoiceSessionAction: () => Promise.resolve({ ok: false, message: "" }),
  readVoiceTurnAction: () =>
    Promise.resolve({ ok: false, gone: false, message: "" }),
  sendVoiceScreenAction: () => Promise.resolve({ ok: true }),
}));

let renders = 0;

function Harness({ onRender }: { readonly onRender: () => void }) {
  const voice = useLazyVoiceInterview();
  useEffect(() => {
    onRender();
  });
  return (
    <>
      <button type="button" data-q-control="talk">
        Talk
      </button>
      <span
        data-state={voice.client.state}
        data-active={String(voice.active)}
      />
      {voice.engine}
    </>
  );
}

afterEach(cleanup);

describe("the real engine behind the stub", () => {
  it("mounts on intent and settles idle", async () => {
    const view = render(
      <Harness
        onRender={() => {
          renders += 1;
        }}
      />,
    );
    fireEvent.pointerOver(view.getByRole("button", { name: "Talk" }));
    await act(async () => {
      await preloadVoice();
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    const settled = renders;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(renders).toBe(settled);
    expect(renders).toBeLessThan(10);
    const state = view.container.querySelector("[data-state]");
    expect(state?.getAttribute("data-state")).toBe("IDLE");
    expect(state?.getAttribute("data-active")).toBe("false");
  });
});
