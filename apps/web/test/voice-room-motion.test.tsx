// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createLevelEnvelope,
  shapeLevel,
  SPEAKING_ENVELOPE,
} from "@/features/q-aperture/level-envelope";
import { resultCue, useAnchorQuestion } from "@/features/q/follow-newest";
import {
  presenceTransform,
  SPEAKING_SWELL,
  usePresenceDriver,
} from "@/features/q/voice-room-layout";

/**
 * Owner audit 2026-11-15, Phase 4B and 4C: the speaking light is smooth
 * and restrained, and nothing in the voice room moves the reader's scroll.
 */

/** A syllable-shaped meter: a clipped square wave, as the lines report. */
function syllables(ms: number): number {
  return Math.floor(ms / 140) % 2 === 0 ? 1 : 0;
}

describe("the speaking level envelope (4C)", () => {
  for (const fps of [30, 60, 120]) {
    it(`never moves more than a small step per frame at ${String(fps)} fps`, () => {
      const envelope = createLevelEnvelope();
      const dt = 1000 / fps;
      let previous = 0;
      let peak = 0;
      for (let at = 0; at < 3000; at += dt) {
        const level = envelope.step(syllables(at), dt);
        const step = Math.abs(level - previous);
        expect(step).toBeLessThanOrEqual(
          (SPEAKING_ENVELOPE.maxPerSecond * dt) / 1000 + 1e-9,
        );
        expect(level).toBeLessThanOrEqual(SPEAKING_ENVELOPE.cap);
        peak = Math.max(peak, level);
        previous = level;
      }
      // Still visibly with the voice: it rises well into its range.
      expect(peak).toBeGreaterThan(0.4);
    });
  }

  it("does not snap back to zero between syllables (release is slower than attack)", () => {
    const envelope = createLevelEnvelope();
    for (let at = 0; at < 300; at += 16) envelope.step(1, 16);
    const high = envelope.value();
    envelope.step(0, 33);
    // One late frame of silence lets go only a little.
    expect(envelope.value()).toBeGreaterThan(high * 0.8);
  });

  it("is the same envelope at any frame rate", () => {
    const slow = createLevelEnvelope();
    const fast = createLevelEnvelope();
    for (let at = 0; at < 400; at += 1000 / 30) slow.step(0.6, 1000 / 30);
    for (let at = 0; at < 400; at += 1000 / 120) fast.step(0.6, 1000 / 120);
    expect(Math.abs(slow.value() - fast.value())).toBeLessThan(0.05);
  });

  it("shapes with a soft knee under a cap, and treats nonsense as silence", () => {
    expect(shapeLevel(0, SPEAKING_ENVELOPE)).toBe(0);
    expect(shapeLevel(1, SPEAKING_ENVELOPE)).toBeCloseTo(SPEAKING_ENVELOPE.cap);
    expect(shapeLevel(0.5, SPEAKING_ENVELOPE)).toBeGreaterThan(
      0.5 * SPEAKING_ENVELOPE.cap,
    );
    expect(shapeLevel(Number.NaN, SPEAKING_ENVELOPE)).toBe(0);
    expect(shapeLevel(7, SPEAKING_ENVELOPE)).toBeCloseTo(SPEAKING_ENVELOPE.cap);
  });
});

describe("the presence driver (4C)", () => {
  let frames: FrameRequestCallback[] = [];
  let clock = 0;
  beforeEach(() => {
    frames = [];
    clock = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function run(count: number) {
    for (let n = 0; n < count; n += 1) {
      const next = frames;
      frames = [];
      clock += 1000 / 60;
      for (const callback of next) callback(clock);
    }
  }

  function Presence(props: {
    readonly speaking: boolean;
    readonly still: boolean;
    readonly scale?: number;
  }) {
    const ref = useRef<HTMLDivElement>(null);
    usePresenceDriver(ref, {
      scale: props.scale ?? 1,
      speaking: props.speaking,
      level: () => syllables(clock),
      still: props.still,
    });
    return <div ref={ref} data-testid="presence" />;
  }

  function scaleOf(container: HTMLElement): number {
    const element = container.querySelector<HTMLElement>(
      "[data-testid=presence]",
    );
    const match = /scale\(([\d.]+)\)/.exec(element?.style.transform ?? "");
    return Number(match?.[1] ?? Number.NaN);
  }

  it("swells with the voice through transform only, within a restrained range", () => {
    const { container } = render(<Presence speaking still={false} />);
    let previous = scaleOf(container);
    let peak = previous;
    for (let n = 0; n < 120; n += 1) {
      run(1);
      const now = scaleOf(container);
      expect(Math.abs(now - previous)).toBeLessThan(0.0025);
      expect(now).toBeGreaterThanOrEqual(1);
      expect(now).toBeLessThanOrEqual(1 + SPEAKING_SWELL + 1e-6);
      peak = Math.max(peak, now);
      previous = now;
    }
    expect(peak).toBeGreaterThan(1.01);
  });

  it("settles gently when Q stops, then schedules nothing", () => {
    const { container, rerender } = render(<Presence speaking still={false} />);
    run(30);
    rerender(<Presence speaking={false} still={false} />);
    let previous = scaleOf(container);
    for (let n = 0; n < 120 && frames.length > 0; n += 1) {
      run(1);
      const now = scaleOf(container);
      expect(Math.abs(now - previous)).toBeLessThan(0.0025);
      previous = now;
    }
    expect(frames).toHaveLength(0);
    expect(scaleOf(container)).toBe(1);
  });

  it("under reduced motion it is static: one write, no frames", () => {
    const { container } = render(<Presence speaking still scale={0.4} />);
    expect(frames).toHaveLength(0);
    expect(scaleOf(container)).toBe(0.4);
  });

  it("composes the compact scale with the swell", () => {
    expect(presenceTransform(0.4, 0)).toBe("scale(0.4000)");
    expect(presenceTransform(0.4, 1)).toBe(
      `scale(${(0.4 * (1 + SPEAKING_SWELL)).toFixed(4)})`,
    );
    expect(presenceTransform(1, 9)).toBe(presenceTransform(1, 1));
  });
});

describe("a new result never moves the reader (4B)", () => {
  const view = { top: 100, bottom: 900 };
  it("is in view: no cue", () => {
    expect(resultCue({ top: 200, bottom: 600 }, view)).toBeNull();
    // A tall result whose top was scrolled past is still in view.
    expect(resultCue({ top: -400, bottom: 700 }, view)).toBeNull();
  });
  it("lands below or above the view: a cue that says which way", () => {
    expect(resultCue({ top: 880, bottom: 1400 }, view)).toBe("below");
    expect(resultCue({ top: -900, bottom: 120 }, view)).toBe("above");
  });
});

describe("useAnchorQuestion (4B)", () => {
  afterEach(cleanup);

  function Panel({
    questionKey,
    text,
  }: {
    readonly questionKey: string;
    readonly text: string;
  }) {
    const ref = useRef<HTMLParagraphElement>(null);
    useAnchorQuestion(ref, questionKey);
    return (
      <div data-testid="scroller" style={{ overflowY: "auto" }}>
        <p ref={ref}>{text}</p>
      </div>
    );
  }

  it("does not anchor the same question again when only its key changes", () => {
    const scrollTo = vi.fn();
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollTo",
    );
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });
    try {
      const { rerender } = render(
        <Panel questionKey="spoken words" text="Who is raising?" />,
      );
      expect(scrollTo).toHaveBeenCalledTimes(1);
      // The spoken line lands as its turn: a new key, the same question.
      act(() => {
        rerender(<Panel questionKey="turn-1" text="Who is raising?" />);
      });
      expect(scrollTo).toHaveBeenCalledTimes(1);
      act(() => {
        rerender(<Panel questionKey="turn-2" text="And in fintech?" />);
      });
      expect(scrollTo).toHaveBeenCalledTimes(2);
    } finally {
      if (descriptor === undefined) {
        Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
      } else {
        Object.defineProperty(HTMLElement.prototype, "scrollTo", descriptor);
      }
    }
  });
});
