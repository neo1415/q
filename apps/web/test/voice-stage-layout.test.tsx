// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VoiceSessionClient } from "../src/features/voice/session";
import { VoiceStage } from "../src/features/voice/voice-stage";

/**
 * The voice stage never traps its own controls (UX2 P1).
 *
 * The stage is a fixed full-screen layer. It used to be one fixed flex
 * column with nothing in it allowed to scroll, so a long answer, the
 * options and the transcript together pushed Mute, Type, the voice
 * choice and the volume below the bottom edge of a phone or a laptop at
 * 125% zoom, with no way to reach them. jsdom does no layout, so what is
 * asserted is the structure that makes that impossible: the growing part
 * is the one scroll container, and every control sits outside it.
 */

function client(
  overrides: Partial<VoiceSessionClient> = {},
): VoiceSessionClient {
  const long = Array.from(
    { length: 40 },
    (_, i) => `Sentence ${String(i)}.`,
  ).join(" ");
  return {
    state: "LISTENING",
    connected: true,
    muted: false,
    transcript: [
      { id: "1", role: "q", text: long, partial: false, at: 1 },
      { id: "2", role: "user", text: "Tell me more", partial: false, at: 2 },
      { id: "3", role: "q", text: long, partial: false, at: 3 },
    ],
    start: vi.fn(() => Promise.resolve()),
    end: vi.fn(() => Promise.resolve()),
    sendText: vi.fn(),
    setMuted: vi.fn(),
    setVolume: vi.fn(),
    inputLevel: () => 0,
    outputLevel: () => 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })),
  );
});

function renderStage() {
  return render(
    <VoiceStage
      client={client()}
      voice="FEMALE"
      voices={["FEMALE", "MALE"]}
      onChooseVoice={vi.fn()}
      onEnd={vi.fn()}
      notice={null}
      onDismissNotice={vi.fn()}
      asking={{
        stepKey: "I7",
        kind: "MANY_OF",
        options: Array.from({ length: 12 }, (_, i) => ({
          key: `o${String(i)}`,
          label: `Option ${String(i)}`,
        })),
      }}
      onSay={vi.fn()}
      onUseForm={vi.fn()}
      progress={[]}
    />,
  );
}

describe("the voice stage layout", () => {
  it("scrolls the part that grows, inside a fixed full-screen layer", () => {
    const { container } = renderStage();
    const stage = container.querySelector("[data-q-voice-stage]");
    const body = container.querySelector("[data-q-voice-stage-body]");
    expect(stage?.className).toMatch(/\bfixed\b/);
    expect(stage?.className).toMatch(/\bflex-col\b/);
    expect(body?.className).toMatch(/\boverflow-y-auto\b/);
    // Without min-h-0 a flex child grows to its content and never scrolls.
    expect(body?.className).toMatch(/\bmin-h-0\b/);
    expect(body?.className).toMatch(/\bflex-1\b/);
  });

  it("keeps what Q said and the options in the scrolling part", () => {
    const { container } = renderStage();
    const body = container.querySelector("[data-q-voice-stage-body]");
    expect(body?.querySelector("[data-q-stage-options]")).not.toBeNull();
    expect(body?.textContent).toContain("Sentence 39.");
  });

  it("keeps every control outside it, where no answer can push them off screen", () => {
    const { container } = renderStage();
    const body = container.querySelector("[data-q-voice-stage-body]");
    const controls = container.querySelector("[data-q-voice-stage-controls]");
    expect(controls).not.toBeNull();
    expect(controls?.className).toMatch(/\bflex-none\b/);
    for (const name of [/^Mute$/, /^Type$/, /^Female$/, /^Male$/]) {
      const button = screen.getByRole("button", { name });
      expect(controls?.contains(button)).toBe(true);
      expect(body?.contains(button)).toBe(false);
    }
    const volume = screen.getByRole("slider");
    expect(controls?.contains(volume)).toBe(true);
    // The way out is at the top, also outside the scrolling part.
    const end = screen.getByRole("button", { name: /End/ });
    expect(body?.contains(end)).toBe(false);
  });
});
