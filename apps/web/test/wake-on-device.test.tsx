// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Hey Q" on-device listening (ADR 0058 addendum 2026-11-04): Chrome's
 * `processLocally`, `SpeechRecognition.available()` and `.install()`, all
 * feature-detected against a fake recogniser; and one voice line per tab
 * when a wake races a line that just opened.
 */

vi.mock("next/navigation", () => ({ usePathname: () => "/discover" }));
vi.mock("../src/features/q-sound/sound-engine", () => ({
  playSound: vi.fn(),
}));

type EngineInput = { readonly onWake: (phrase: string) => void };
const engineInputs: EngineInput[] = [];
const startWakeEngine = vi.fn((input: EngineInput) => {
  engineInputs.push(input);
  return Promise.resolve({ stop: () => Promise.resolve() });
});
vi.mock("../src/features/wake/engine", () => ({ startWakeEngine }));

import {
  dropVoiceLine,
  openVoiceLine,
  type VoiceLineHolder,
} from "../src/features/voice/voice-line";
import {
  installOnDevice,
  onDeviceAvailability,
  resetOnDevice,
} from "../src/features/wake/on-device";
import { createSpeechDetector } from "../src/features/wake/speech-detector";
import {
  WakeIndicator,
  wakeIndicatorText,
} from "../src/features/wake/wake-indicator";
import {
  readWakePreference,
  storeWakePreference,
} from "../src/features/wake/wake-preference";
import { WakeListeningNote } from "../src/features/wake/wake-setting";
import {
  resetWakeStatus,
  setWakeProcessing,
  setWakeStatus,
} from "../src/features/wake/wake-status";
import { respondToWake, WakeWord } from "../src/features/wake/wake-word";

const DEVICE_TEXT = /Heard on this device/;
const SERVICE_TEXT =
  "Quiet sounds never leave this device. When speech starts, a few seconds may go to your browser’s speech service (Google in Chrome, Apple in Safari) to catch the words; Capital Q never receives or keeps that audio.";

type Options = { readonly langs: readonly string[]; processLocally: boolean };

/**
 * A recogniser shaped like Chrome's: `processLocally` is a prototype
 * accessor (a WebIDL attribute), `available`/`install` are statics.
 */
type Statics = {
  readonly available?: (options: Options) => unknown;
  readonly install?: (options: Options) => unknown;
  readonly attribute?: boolean;
};

function fakeRecognition(statics: Statics) {
  const made: Fake[] = [];
  class Fake {
    lang = "";
    continuous = false;
    interimResults = false;
    maxAlternatives = 1;
    local: boolean | undefined = undefined;
    onresult: ((event: unknown) => void) | null = null;
    onerror: ((event: { readonly error: string }) => void) | null = null;
    onend: (() => void) | null = null;
    start = vi.fn();
    stop = vi.fn();
    abort = vi.fn();
    constructor() {
      made.push(this);
    }
  }
  if (statics.attribute !== false) {
    Object.defineProperty(Fake.prototype, "processLocally", {
      configurable: true,
      get(this: Fake) {
        return this.local ?? false;
      },
      set(this: Fake, value: boolean) {
        this.local = value;
      },
    });
  }
  if (statics.available !== undefined) {
    Reflect.set(Fake, "available", vi.fn(statics.available));
  }
  if (statics.install !== undefined) {
    Reflect.set(Fake, "install", vi.fn(statics.install));
  }
  vi.stubGlobal("SpeechRecognition", Fake);
  return { Fake, made };
}

function stubSupport() {
  vi.stubGlobal("AudioWorkletNode", class {});
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(() =>
        Promise.resolve({ getTracks: () => [{ stop: vi.fn() }] }),
      ),
    },
  });
}

beforeEach(() => {
  window.localStorage.clear();
  resetWakeStatus();
  resetOnDevice();
  startWakeEngine.mockClear();
  engineInputs.length = 0;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("on-device available: processLocally is set and Settings says so", () => {
  it("asks for the wake language on the device, and gets 'available'", async () => {
    const { Fake } = fakeRecognition({ available: () => "available" });
    await expect(onDeviceAvailability()).resolves.toBe("available");
    expect(Reflect.get(Fake, "available")).toHaveBeenCalledWith({
      langs: ["en-US"],
      processLocally: true,
    });
  });

  it("the detector tells the recogniser to stay on the device", () => {
    const { made } = fakeRecognition({ available: () => "available" });
    const onProcessing = vi.fn();
    const detector = createSpeechDetector({
      onWake: vi.fn(),
      onFailure: vi.fn(),
      processLocally: true,
      onProcessing,
    });
    detector?.start();
    expect(made[0]?.local).toBe(true);
    expect(onProcessing).toHaveBeenCalledWith("DEVICE");
  });

  it("Settings: “Heard on this device”, not the speech-service disclosure", async () => {
    fakeRecognition({ available: () => "available" });
    render(<WakeListeningNote />);
    await screen.findByText(DEVICE_TEXT);
    expect(screen.queryByText(SERVICE_TEXT)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("the indicator says where the words are heard", () => {
    expect(wakeIndicatorText({ kind: "LISTENING" }, "DEVICE")).toBe(
      "Listening for “Hey Q” · on this device",
    );
    expect(wakeIndicatorText({ kind: "LISTENING" }, "SERVICE")).toBe(
      "Listening for “Hey Q” · browser speech service",
    );
    expect(wakeIndicatorText({ kind: "HEARING" }, "DEVICE")).toMatch(
      /checking on this device/,
    );
  });
});

describe("on-device unavailable or throwing: today's behaviour and disclosure", () => {
  it.each<[string, Statics]>([
    ["no static available()", {}],
    [
      "available() throws",
      {
        available: () => {
          throw new Error("boom");
        },
      },
    ],
    [
      "available() rejects",
      { available: () => Promise.reject(new Error("x")) },
    ],
    ["an unexpected value", { available: () => "yes" }],
    ["'unavailable'", { available: () => "unavailable" }],
    [
      "no processLocally attribute",
      { available: () => "available", attribute: false },
    ],
  ])("%s → unavailable", async (_label, statics) => {
    fakeRecognition(statics);
    await expect(onDeviceAvailability()).resolves.toBe("unavailable");
  });

  it("Settings keeps the exact speech-service disclosure", async () => {
    fakeRecognition({
      available: () => {
        throw new Error("boom");
      },
    });
    render(<WakeListeningNote />);
    await act(() => Promise.resolve());
    expect(screen.getByText(SERVICE_TEXT)).toBeTruthy();
    expect(screen.queryByText(DEVICE_TEXT)).toBeNull();
  });

  it("the detector leaves processLocally alone without the attribute", () => {
    const { made } = fakeRecognition({ attribute: false });
    const onProcessing = vi.fn();
    const detector = createSpeechDetector({
      onWake: vi.fn(),
      onFailure: vi.fn(),
      processLocally: true,
      onProcessing,
    });
    detector?.start();
    expect(made[0]?.local).toBeUndefined();
    expect(Object.keys(made[0] ?? {})).not.toContain("processLocally");
    expect(onProcessing).toHaveBeenCalledWith("SERVICE");
  });

  it("a pack that goes away falls back to the service and says so", () => {
    const { made } = fakeRecognition({ available: () => "available" });
    const onProcessing = vi.fn();
    const onFailure = vi.fn();
    const detector = createSpeechDetector({
      onWake: vi.fn(),
      onFailure,
      processLocally: true,
      onProcessing,
    });
    detector?.start();
    made[0]?.onerror?.({ error: "language-not-supported" });
    expect(onProcessing).toHaveBeenLastCalledWith("SERVICE");
    expect(onFailure).not.toHaveBeenCalled();
    detector?.start();
    expect(made[1]?.local).toBeUndefined();
  });
});

describe("installing the language pack only on the person's click", () => {
  it("offers the action, and does not install until it is clicked", async () => {
    let installed = false;
    const { Fake } = fakeRecognition({
      available: () => (installed ? "available" : "downloadable"),
      install: () => {
        installed = true;
        return Promise.resolve(true);
      },
    });
    render(<WakeListeningNote />);
    const button = await screen.findByRole("button", {
      name: "Use on-device listening",
    });
    expect(Reflect.get(Fake, "install")).not.toHaveBeenCalled();
    // Until then, the disclosure is today's.
    expect(screen.getByText(SERVICE_TEXT)).toBeTruthy();
    await userEvent.click(button);
    expect(Reflect.get(Fake, "install")).toHaveBeenCalledOnce();
    expect(Reflect.get(Fake, "install")).toHaveBeenCalledWith({
      langs: ["en-US"],
      processLocally: true,
    });
    // Re-checked after the install: now heard on this device.
    await screen.findByText(DEVICE_TEXT);
  });

  it("a refused or failed install keeps the service and says so", async () => {
    fakeRecognition({
      available: () => "downloadable",
      install: () => Promise.reject(new DOMException("no", "NotAllowedError")),
    });
    render(<WakeListeningNote />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Use on-device listening" }),
    );
    await screen.findByText(/couldn’t be set up/);
    expect(screen.getByText(SERVICE_TEXT)).toBeTruthy();
  });

  it("install() absent or throwing is false, never a claim", async () => {
    fakeRecognition({});
    await expect(installOnDevice()).resolves.toBe(false);
    fakeRecognition({
      install: () => {
        throw new Error("boom");
      },
    });
    await expect(installOnDevice()).resolves.toBe(false);
  });
});

describe("the indicator: truthful state, Stop always there while armed", () => {
  it.each([
    [{ kind: "LISTENING" } as const],
    [{ kind: "HEARING" } as const],
    [{ kind: "PAUSED", reason: "BY_YOU" } as const],
    [{ kind: "PAUSED", reason: "BATTERY" } as const],
    [{ kind: "BLOCKED" } as const],
  ])("%j shows Turn off", async (status) => {
    storeWakePreference(true);
    setWakeStatus(status);
    setWakeProcessing("SERVICE");
    render(<WakeIndicator />);
    await userEvent.click(screen.getByRole("button", { name: "Turn off" }));
    expect(readWakePreference()).toBe(false);
  });
});

describe("a wake reuses the tab's one voice line, never a second session", () => {
  it("does nothing when a line is already open", () => {
    const calls = { sound: vi.fn(), openQ: vi.fn(), talk: vi.fn() };
    expect(respondToWake({ lineOpen: true, onQPage: false, ...calls })).toBe(
      false,
    );
    expect(calls.sound).not.toHaveBeenCalled();
    expect(calls.openQ).not.toHaveBeenCalled();
    expect(calls.talk).not.toHaveBeenCalled();
    expect(respondToWake({ lineOpen: false, onQPage: false, ...calls })).toBe(
      true,
    );
    expect(calls.talk).toHaveBeenCalledOnce();
    expect(calls.openQ).toHaveBeenCalledOnce();
  });

  it("a wake that races a line just opened by a surface does nothing", async () => {
    stubSupport();
    fakeRecognition({});
    storeWakePreference(true);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    const openQ = vi.fn();
    render(<WakeWord openQ={openQ} />);
    await vi.waitFor(() => expect(startWakeEngine).toHaveBeenCalledOnce());
    const heard = engineInputs[0];

    const surface: VoiceLineHolder = { release: () => Promise.resolve() };
    await act(() => openVoiceLine(surface, () => Promise.resolve()));
    act(() => heard?.onWake("HEY_Q"));
    expect(openQ).not.toHaveBeenCalled();

    act(() => dropVoiceLine(surface));
    await vi.waitFor(() => expect(startWakeEngine).toHaveBeenCalledTimes(2));
    act(() => engineInputs[1]?.onWake("HEY_Q"));
    expect(openQ).toHaveBeenCalledOnce();
  });
});
