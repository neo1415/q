// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * Owner live 10 Nov (onboarding, sectors and preferences asked again):
 * the onboarding call reads Capital Q's steer (what is saved, what to ask
 * next) and gives it to the line through `client.brief`. The duplex client
 * had no `brief`, so every steer was dropped. A brief is a quiet note:
 * into the model's context, never a reply of its own.
 */
const note = vi.fn();
vi.mock("../src/features/voice/provider/duplex-line", () => ({
  DuplexLine: class {
    open() {
      return Promise.resolve(true);
    }
    note(text: string, respond: boolean) {
      note(text, respond);
    }
    close() {}
    speakFirst() {}
  },
  browserDuplexEnvironment: () => ({}),
}));

const { useDuplexVoiceSession } =
  await import("../src/features/voice/provider/duplex-session");

describe("a steer reaches the duplex line", () => {
  it("is a quiet note on the open line, and nothing without one", async () => {
    const { result } = renderHook(() =>
      useDuplexVoiceSession({}, { relays: () => ({}) as never }),
    );
    expect(result.current.brief?.("Saved: sectors.")).toBe(false);
    await act(async () => {
      await result.current.start({
        credential: {
          voiceSessionId: "v1",
          duplex: { clientSecret: "s", model: "m" },
        } as never,
      });
    });
    expect(result.current.brief?.("Saved: sectors. Ask next: models.")).toBe(
      true,
    );
    expect(note).toHaveBeenCalledWith(
      "Saved: sectors. Ask next: models.",
      false,
    );
  });
});
